import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptRecipe, applyChanges, contextOf, describeChanges, finalizeReplan, priorOf, uid } from '../agent/adapt';
import { scaleRecipe } from '../agent/kitchen';
import { techniqueById, techniqueFor, techniqueQuery } from '../data/techniques';
import { beep, formatClock } from '../lib/sound';
import { modelService } from '../services';
import type { InterpretResult } from '../services/modelService';
import { LookupError, lookupTerm, type Lookup } from '../services/lookup';
import { searchVideos, VideoError, type Video } from '../services/videos';
import { proposeIngredientChange, vetChanges } from '../services/mock/kitchenHelp';
import type { ActiveTimer, CookCommand, CookRules, CookSession, PantryItem, Recipe, SessionChange } from '../types';

export const timerLeft = (t: ActiveTimer, now: number) => (t.endsAt === null ? t.pausedLeft : Math.max(0, (t.endsAt - now) / 1000));

/**
 * The cooking session store. Everything the agent knows lives in
 * `session`; the cooking screens are a view over it. Every change goes
 * through update() → applyChanges → adaptRecipe → model help → finalizeReplan.
 */
export interface VideoCard {
  query: string;
  /** Gusteau's written how-to, when it's a technique he knows. */
  howTo?: string;
  videos?: Video[];
  error?: VideoError['reason'];
}

export interface CookEvents {
  onFinish(s: CookSession): void;
  /** A timer just ran out (it has already beeped). */
  onTimerDone?(label: string): void;
}

export function useCook(events: CookEvents) {
  const on = useRef(events);
  on.current = events;
  const [session, setSessionRaw] = useState<CookSession | null>(null);
  const [busy, setBusy] = useState<null | 'starting' | 'thinking' | 'replanning'>(null);
  const [bannerId, setBannerId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<CookSession[]>([]);
  /** Bumps whenever the current step should be read aloud: `force` for an explicit request, otherwise only in hands-free mode. */
  const [readRequest, setReadRequest] = useState({ n: 0, force: false });
  const requestRead = (force = false) => setReadRequest((r) => ({ n: r.n + 1, force }));
  /** Short videos for a technique ("how to dice an onion"), when the card is open. */
  const [videoCard, setVideoCard] = useState<VideoCard | null>(null);
  /** The definition-and-pictures card, when one is open. */
  const [explainer, setExplainer] = useState<null | { term: string; lookup?: Lookup; error?: string }>(null);
  const [now, setNow] = useState(Date.now());
  const ref = useRef<CookSession | null>(null);
  const setSession = useCallback((s: CookSession | null) => {
    ref.current = s;
    setSessionRaw(s);
  }, []);
  const say = (s: CookSession, text: string, extra: Partial<CookSession['chat'][number]> = {}): CookSession => ({
    ...s,
    chat: [...s.chat, { id: uid(), from: 'gusteau', text, ...extra }],
  });

  // ── Timers tick once a second while any are running ──
  const running = !!session?.timers.some((t) => t.endsAt !== null);
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [running]);
  const rung = useRef(new Set<string>());
  useEffect(() => {
    for (const t of session?.timers ?? []) {
      if (t.endsAt !== null && t.endsAt <= now && !rung.current.has(t.id)) {
        rung.current.add(t.id);
        beep();
        on.current.onTimerDone?.(t.label);
      }
    }
  }, [now, session?.timers]);

  const start = async (recipe: Recipe, rules: CookRules, pantry: PantryItem[], pantryBasics: boolean, leaveOut: string[] = []) => {
    setBusy('starting');
    const staged = await modelService.stageRecipe(recipe);
    const original = scaleRecipe({ ...recipe, stages: staged.stages, stagesBy: staged.by }, rules.servings);
    const blank: CookSession = {
      original,
      recipe: original,
      rules,
      pantry,
      pantryBasics,
      unavailable: [],
      leaveOut,
      preferredSwaps: [],
      additions: [],
      stepIndex: 0,
      completedStepKeys: [],
      substitutions: [],
      history: [],
      chat: [],
      timers: [],
      paused: false,
    };
    const first = adaptRecipe(original, contextOf(blank));
    const adapted: CookSession = { ...blank, recipe: first.violations.length ? original : first.recipe, substitutions: first.violations.length ? [] : first.substitutions };
    const swaps = adapted.substitutions.map((x) => (x.kind === 'swap' ? `${x.from.toLowerCase()} → ${x.to.toLowerCase()}` : x.kind === 'drop' ? `no ${x.from.toLowerCase()}` : `plus ${x.from.toLowerCase()}`));
    setSession(
      say(
        adapted,
        `Bonjour! Let’s make the ${adapted.recipe.title}. ${swaps.length ? `I’ve fitted it to your kitchen (${swaps.join(', ')}). ` : ''}I’m keeping track of your kitchen as we go. If anything changes, like an ingredient you’re out of, the time, the equipment or who’s eating, tell me and I’ll rework the rest of the plan.`,
      ),
    );
    setUndoStack([]);
    setBannerId(null);
    setVideoCard(null);
    rung.current.clear();
    setBusy(null);
  };

  const update = async (changes: SessionChange[], trigger: string, userText?: string, via?: 'voice') => {
    const before = ref.current;
    if (!before || !changes.length) return;
    const withUser: CookSession = userText ? { ...before, chat: [...before.chat, { id: uid(), from: 'user', text: userText, via }] } : before;
    setSession(withUser);
    setBusy('replanning');
    try {
      const { session: after, labels } = applyChanges(withUser, changes);
      const prior = priorOf(withUser);
      const draft = adaptRecipe(after.original, contextOf(after), prior);
      const result = await modelService.adaptPlan(after, draft, prior);
      const final = finalizeReplan(withUser, after, result, trigger, changes, labels);
      setUndoStack((u) => [before, ...u].slice(0, 20));
      setSession(final);
      setBannerId(final.history[0]?.id ?? null);
      if (final.stepIndex !== before.stepIndex || final.recipe.steps[final.stepIndex]?.key !== before.recipe.steps[before.stepIndex]?.key) requestRead();
    } catch (err) {
      console.warn('[Gusteau] Replanning failed', err);
      setSession(say(withUser, 'I hit a snag replanning, so I kept your current plan exactly as it was. Try that again in a moment.'));
    } finally {
      setBusy(null);
    }
  };

  const next = () => {
    const s = ref.current;
    if (!s || s.paused) return;
    const step = s.recipe.steps[s.stepIndex];
    if (!step) return;
    const completed = s.completedStepKeys.includes(step.key) ? s.completedStepKeys : [...s.completedStepKeys, step.key];
    const ns = { ...s, completedStepKeys: completed, stepIndex: Math.min(s.stepIndex + 1, s.recipe.steps.length) };
    setSession(ns);
    setVideoCard(null);
    requestRead();
    if (ns.stepIndex >= ns.recipe.steps.length) on.current.onFinish(ns);
  };

  const back = () => {
    const s = ref.current;
    if (!s || s.stepIndex === 0) return;
    const idx = s.stepIndex - 1;
    const key = s.recipe.steps[idx].key;
    setSession({ ...s, stepIndex: idx, completedStepKeys: s.completedStepKeys.filter((k) => k !== key) });
    setVideoCard(null);
    requestRead();
  };

  // ── Timers ──
  const addTimer = (seconds: number, label?: string) => {
    const s = ref.current;
    if (!s) return;
    const step = s.recipe.steps[s.stepIndex];
    const t: ActiveTimer = { id: uid(), label: label ?? step?.title ?? 'Timer', totalSeconds: seconds, endsAt: Date.now() + seconds * 1000, pausedLeft: seconds };
    setNow(Date.now());
    setSession({ ...s, timers: [...s.timers, t] });
  };
  const toggleTimer = (id: string) => {
    const s = ref.current;
    if (!s) return;
    const at = Date.now();
    setNow(at);
    setSession({
      ...s,
      timers: s.timers.map((t) => (t.id !== id ? t : t.endsAt === null ? { ...t, endsAt: at + t.pausedLeft * 1000 } : { ...t, endsAt: null, pausedLeft: timerLeft(t, at) })),
    });
  };
  const addTime = (id: string, seconds: number) => {
    const s = ref.current;
    if (!s) return;
    rung.current.delete(id);
    setSession({
      ...s,
      timers: s.timers.map((t) =>
        t.id !== id ? t : { ...t, totalSeconds: t.totalSeconds + seconds, endsAt: t.endsAt === null ? null : Math.max(t.endsAt, Date.now()) + seconds * 1000, pausedLeft: t.pausedLeft + seconds },
      ),
    });
  };
  const removeTimer = (id: string) => {
    const s = ref.current;
    if (s) setSession({ ...s, timers: s.timers.filter((t) => t.id !== id) });
  };

  const runCommand = (cmd: CookCommand, s: CookSession) => {
    switch (cmd.type) {
      case 'next':
        if (s.paused) return setSession(say(s, 'We’re paused until we sort out the plan. Pick one of the options above, or tell me what changed.'));
        return next();
      case 'back':
        return back();
      case 'repeat':
        return requestRead(true);
      case 'timer':
        addTimer(cmd.seconds, `${formatClock(cmd.seconds)} timer`);
        return setSession(say(ref.current!, `Timer set for ${cmd.seconds >= 60 ? `${Math.round(cmd.seconds / 60)} minute${cmd.seconds >= 120 ? 's' : ''}` : `${cmd.seconds} seconds`}. I’ll beep when it’s done.`));
      case 'dismiss':
        setExplainer(null);
        setVideoCard(null);
        return;
      case 'show_technique': {
        // "Show me how": videos for whatever this step asks the cook to do.
        const step = s.recipe.steps[s.stepIndex];
        if (!step) return;
        const t = techniqueFor(step);
        const query = t ? techniqueQuery(t) : step.title.toLowerCase();
        showVideos(query, t?.howTo);
        return setSession(say(s, t ? `Here’s how: ${t.howTo}` : `Here are some short videos on how to ${query}.`, { videoQuery: query }));
      }
    }
  };

  const handleInterpretation = async (text: string, input: InterpretResult, before: CookSession, via: 'voice' | undefined, streamed: string) => {
    let r = input;
    if (r.changes.length) {
      const vetted = vetChanges(r.changes, before);
      // If part of the request can't be used, apply none of it: the rest may only make sense together
      // ("out of rice, use couscous"). Any options Gusteau listed stay open.
      if (vetted.refusals.length) {
        const still = before.pendingChoice;
        const options = still?.options.length ? ` You could still use ${still.options.map((o) => o.toLowerCase()).join(' or ')}, or I can leave it out.` : '';
        r = { ...r, changes: [], reply: `${vetted.refusals.join(' ')}${options}`, offer: before.pendingOffer, choice: still };
      }
    }
    // Running out of an ingredient or asking for a swap: suggest options and ask first.
    const proposed = r.changes.length && !r.confirmed ? proposeIngredientChange(r.changes, before) : null;
    if (proposed) {
      let base = before;
      if (proposed.rest.length) {
        // Anything else in the same message (time, servings…) applies as usual.
        await update(proposed.rest, describeChanges(proposed.rest), text, via);
        base = ref.current ?? before;
      } else base = { ...before, chat: [...before.chat, { id: uid(), from: 'user', text, via }] };
      const p = proposed.proposal;
      setSession({ ...base, pendingOffer: p.offer, pendingChoice: p.choice, chat: [...base.chat, { id: uid(), from: 'gusteau', text: p.reply! }] });
      return;
    }
    if (r.explain) {
      await explain(r.explain, text, via, before);
      return;
    }
    if (r.command) {
      const withUser = { ...before, pendingOffer: undefined, chat: [...before.chat, { id: uid(), from: 'user' as const, text, via }] };
      setSession(withUser);
      runCommand(r.command, withUser);
    } else if (r.changes.length) {
      await update(r.changes, r.trigger ?? text, text, via);
    } else {
      const reply = r.reply ?? 'I’m here. Tell me what changed and I’ll replan.';
      setSession({
        ...before,
        // Anything offered ("want me to switch?") waits for a yes on the next message.
        pendingOffer: r.offer?.length ? r.offer : undefined,
        pendingChoice: r.choice,
        chat: [
          ...before.chat,
          { id: uid(), from: 'user', text, via },
          // A reply that was already read aloud while it streamed isn't read again.
          { id: uid(), from: 'gusteau', text: reply, techniqueId: r.techniqueId, videoQuery: r.howTo, spoken: !!streamed && reply.trim() === streamed.trim() },
        ],
      });
      // "How do I dice an onion?": short videos alongside the answer.
      if (r.howTo) showVideos(r.howTo, techniqueById(r.techniqueId)?.howTo);
      // A fix like "give it one more minute" comes with its timer.
      if (r.timerSeconds) addTimer(r.timerSeconds, `${before.recipe.steps[before.stepIndex]?.title ?? 'Extra'} (extra time)`);
    }
  };

  /** Search short videos for a technique and open the video card. */
  const showVideos = (query: string, howTo?: string) => {
    setExplainer(null);
    setVideoCard({ query, howTo });
    searchVideos(query).then(
      (videos) => setVideoCard((c) => (c?.query === query ? { ...c, videos } : c)),
      (err: unknown) => setVideoCard((c) => (c?.query === query ? { ...c, error: err instanceof VideoError ? err.reason : 'unavailable' } : c)),
    );
  };

  /**
   * Define an ingredient or tool and show pictures of it. The definition is
   * also said in the chat (and read aloud in hands-free mode).
   */
  const explain = async (term: string, text?: string, via?: 'voice', base = ref.current) => {
    if (!base) return;
    if (text) setSession({ ...base, chat: [...base.chat, { id: uid(), from: 'user', text, via }] });
    setVideoCard(null);
    setExplainer({ term });
    let reply: string;
    try {
      const found = await lookupTerm(term);
      setExplainer((e) => (e?.term === term ? { term, lookup: found } : e));
      reply = found.definition;
    } catch (err) {
      // Rather than show pictures of something else, say so.
      const notFound = err instanceof LookupError && err.reason === 'not-found';
      reply = notFound
        ? `I couldn’t find a reliable description of ${term}, and I don’t want to show you the wrong thing. Check the label, or tell me more about it.`
        : `I couldn’t reach Wikipedia to look up ${term} just now. Ask me again in a moment.`;
      setExplainer((e) => (e?.term === term ? { term, error: reply } : e));
    }
    // Only a new question gets a new answer in the chat; reopening the pictures doesn't.
    if (!text) return;
    const cur = ref.current ?? base;
    setSession({ ...cur, chat: [...cur.chat, { id: uid(), from: 'gusteau', text: reply, explainTerm: term }] });
  };

  /** Report changes directly, e.g. from a button, with the same ask-first rules as a message. */
  const tell = (changes: SessionChange[], text: string) => {
    const before = ref.current;
    if (before) void handleInterpretation(text, { reply: null, changes, trigger: describeChanges(changes) }, before, undefined, '');
  };

  /**
   * A typed or spoken message. `onReply` gets a plain answer while the model is
   * still writing it, so a voice can start reading before it's finished.
   */
  const sendChat = async (text: string, opts: { via?: 'voice'; onReply?(textSoFar: string): void } = {}) => {
    const before = ref.current;
    if (!before) return;
    setBusy('thinking');
    let r: InterpretResult;
    let streamed = '';
    try {
      r = await modelService.interpretMessage(text, before, {
        onReply: opts.onReply
          ? (sofar) => {
              streamed = sofar;
              opts.onReply!(sofar);
            }
          : undefined,
      });
    } catch (err) {
      console.warn('[Gusteau] Chat failed', err);
      r = { reply: 'Sorry, I lost that one. Could you say it again?', changes: [] };
    }
    setBusy(null);
    await handleInterpretation(text, r, ref.current ?? before, opts.via, streamed);
  };

  const undo = () => {
    const [prev, ...rest] = undoStack;
    const cur = ref.current;
    if (!prev || !cur) return;
    setSession({ ...prev, timers: cur.timers, chat: [...cur.chat, { id: uid(), from: 'gusteau', text: 'Undone. Back to the previous plan, with all your earlier progress intact.' }] });
    setUndoStack(rest);
    setBannerId(null);
  };

  const stop = () => {
    setSession(null);
    setUndoStack([]);
    setBannerId(null);
  };

  return {
    session,
    busy,
    bannerId,
    now,
    readRequest,
    videoCard,
    showVideos,
    closeVideos: () => setVideoCard(null),
    explainer,
    /** Show the pictures for a term again. */
    showPictures: (term: string) => void explain(term),
    closeExplainer: () => setExplainer(null),
    dismissBanner: () => setBannerId(null),
    canUndo: undoStack.length > 0,
    start,
    update,
    sendChat,
    tell,
    next,
    back,
    undo,
    stop,
    addTimer,
    toggleTimer,
    addTime,
    removeTimer,
    repeat: () => requestRead(true),
  };
}

export type Cook = ReturnType<typeof useCook>;
