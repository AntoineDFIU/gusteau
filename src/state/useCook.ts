import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptRecipe, applyChanges, contextOf, finalizeReplan, priorOf, uid } from '../agent/adapt';
import { scaleRecipe } from '../agent/kitchen';
import { techniqueFor } from '../data/techniques';
import { beep, formatClock } from '../lib/sound';
import { modelService } from '../services';
import type { InterpretResult } from '../services/modelService';
import { vetChanges } from '../services/mock/kitchenHelp';
import type { ActiveTimer, CookCommand, CookRules, CookSession, PantryItem, Recipe, SessionChange } from '../types';

export const timerLeft = (t: ActiveTimer, now: number) => (t.endsAt === null ? t.pausedLeft : Math.max(0, (t.endsAt - now) / 1000));

/**
 * The cooking session store. Everything the agent knows lives in
 * `session`; the cooking screens are a view over it. Every change goes
 * through update() → applyChanges → adaptRecipe → model help → finalizeReplan.
 */
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
  const [techniqueOpen, setTechniqueOpen] = useState(false);
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
    const swaps = adapted.substitutions.map((x) => (x.kind === 'swap' ? `${x.from.toLowerCase()} → ${x.to.toLowerCase()}` : x.kind === 'drop' ? `no ${x.from.toLowerCase()}` : x.kind === 'add' ? `plus ${x.from.toLowerCase()}` : `buy ${x.from.toLowerCase()}`));
    setSession(
      say(
        adapted,
        `Bonjour! Let’s make the ${adapted.recipe.title}. ${swaps.length ? `I’ve fitted it to your kitchen (${swaps.join(', ')}). ` : ''}I’m keeping track of your kitchen as we go. If anything changes, like an ingredient you’re out of, the time, the equipment or who’s eating, tell me and I’ll rework the rest of the plan.`,
      ),
    );
    setUndoStack([]);
    setBannerId(null);
    setTechniqueOpen(false);
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
    setTechniqueOpen(false);
    requestRead();
    if (ns.stepIndex >= ns.recipe.steps.length) on.current.onFinish(ns);
  };

  const back = () => {
    const s = ref.current;
    if (!s || s.stepIndex === 0) return;
    const idx = s.stepIndex - 1;
    const key = s.recipe.steps[idx].key;
    setSession({ ...s, stepIndex: idx, completedStepKeys: s.completedStepKeys.filter((k) => k !== key) });
    setTechniqueOpen(false);
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
      case 'show_technique': {
        const step = s.recipe.steps[s.stepIndex];
        const t = step && techniqueFor(step);
        if (t) setTechniqueOpen(true);
        return setSession(say(s, t ? `Here’s how: ${t.howTo}` : 'This step doesn’t need a special technique. Just follow the instruction, and ask me if anything is unclear.', t ? { techniqueId: t.id } : {}));
      }
    }
  };

  const handleInterpretation = async (text: string, input: InterpretResult, before: CookSession, via: 'voice' | undefined, streamed: string) => {
    let r = input;
    if (r.changes.length) {
      const vetted = vetChanges(r.changes, before);
      if (vetted.refusals.length && !vetted.changes.length) r = { ...r, changes: [], reply: vetted.refusals.join(' ') };
      else r = { ...r, changes: vetted.changes };
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
        chat: [
          ...before.chat,
          { id: uid(), from: 'user', text, via },
          // A reply that was already read aloud while it streamed isn't read again.
          { id: uid(), from: 'gusteau', text: reply, techniqueId: r.techniqueId, spoken: !!streamed && reply.trim() === streamed.trim() },
        ],
      });
      if (r.techniqueId) setTechniqueOpen(true);
      // A fix like "give it one more minute" comes with its timer.
      if (r.timerSeconds) addTimer(r.timerSeconds, `${before.recipe.steps[before.stepIndex]?.title ?? 'Extra'} (extra time)`);
    }
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
    techniqueOpen,
    setTechniqueOpen,
    dismissBanner: () => setBannerId(null),
    canUndo: undoStack.length > 0,
    start,
    update,
    sendChat,
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
