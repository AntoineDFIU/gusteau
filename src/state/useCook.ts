import { useCallback, useEffect, useRef, useState } from 'react';
import { adaptRecipe, applyChanges, contextOf, describeChanges, finalizeReplan, priorOf, uid } from '../agent/adapt';
import { scaleRecipe } from '../agent/kitchen';
import { techniqueById, techniqueFor, techniqueQuery } from '../data/techniques';
import { beep, formatClock } from '../lib/sound';
import { modelService } from '../services';
import type { InterpretResult } from '../services/modelService';
import { LookupError, lookupTerm, type Lookup } from '../services/lookup';
import { searchVideos, VideoError, type Video } from '../services/videos';
import { stepDescribed, stepTalk } from '../services/mock/intentParser';
import { proposeIngredientChange, vetChanges } from '../services/mock/kitchenHelp';
import { ambiguousAmount } from '../agent/heardAs';
import { lineKey, plainStepLine, stepDetail, stepSpeech, whereWeAre, withTitle, type StepArrival } from '../agent/stepSpeech';
import { controlTimers, notStarted, sayDuration, stepTimers, timerName, timerOffer, type StepTimer } from '../agent/stepTimers';
import { mergeStages } from '../agent/stages';
import type { ActiveTimer, CookCommand, CookRules, CookSession, PantryItem, Recipe, SessionChange } from '../types';

/** A timer that's still ringing gets a reminder this often, this many times. */
const REMIND_MS = 30_000;
const REMINDERS = 4;

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
  /** Whether a recipe (by its original id) is already in the cook's favorites. */
  isFavorite?(recipeId: string): boolean;
  /** The cook said yes to "add it to your favorites?". */
  onFavorite?(recipeId: string): void;
}

export function useCook(events: CookEvents) {
  const on = useRef(events);
  on.current = events;
  const [session, setSessionRaw] = useState<CookSession | null>(null);
  const [busy, setBusy] = useState<null | 'starting' | 'thinking' | 'replanning'>(null);
  const [bannerId, setBannerId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<CookSession[]>([]);
  /**
   * Bumps whenever the current step should be read aloud: `force` for an
   * explicit request, otherwise only in hands-free mode. `how` is how the cook
   * got to the step, which sets how Gusteau introduces it.
   */
  const [readRequest, setReadRequest] = useState<{ n: number; force: boolean; how: StepArrival }>({ n: 0, force: false, how: 'start' });
  const requestRead = (how: StepArrival, force = false) => setReadRequest((r) => ({ n: r.n + 1, force, how }));
  /** The model's spoken line for each step, by lineKey; Gusteau's own wording fills any gaps. */
  const lines = useRef<Record<string, string>>({});
  const phrase = (recipe: Recipe) =>
    modelService.phraseSteps(recipe).then(
      (got) => void (lines.current = { ...lines.current, ...got }),
      () => {},
    );
  /** Short videos for a technique ("how to dice an onion"), when the card is open. */
  const [videoCard, setVideoCard] = useState<VideoCard | null>(null);
  /** The message being answered right now: shown as heard, with how it was understood and the reply as it streams in. */
  const [pending, setPending] = useState<null | { text: string; via?: 'voice'; interpreted?: string; reply?: string }>(null);
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
  /** How many reminders each ringing timer has had. */
  const reminded = useRef(new Map<string, number>());
  useEffect(() => {
    for (const t of session?.timers ?? []) {
      if (t.endsAt !== null && t.endsAt <= now && !rung.current.has(t.id)) {
        rung.current.add(t.id);
        beep();
        on.current.onTimerDone?.(t.label);
        // "Time's up: the timer to microwave the rice. Next, rest the rice for two minutes…"
        const cur = ref.current;
        if (cur) {
          const step = cur.recipe.steps[cur.stepIndex];
          const next = notStarted(step, cur.timers, cur.recipe, cur.timersDone)[0];
          const side = t.key && /first side$/.test(t.label) ? ' Flip it, and say “start the timer” for the second side.' : '';
          const then = !side && next ? ` Next, ${timerName(next).replace(/^the timer to /, '')} for ${sayDuration(next.seconds, next.range)}. Say “start the timer” when you’re ready.` : '';
          setSession(say(cur, `Time’s up: ${timerName(t)}.${side}${then} Say “stop the timer” to silence it.`));
        }
      }
      // Still ringing: a beep and a reminder of which timer it is, every half minute, a few times.
      if (t.endsAt !== null && rung.current.has(t.id)) {
        const due = Math.floor((now - t.endsAt) / REMIND_MS);
        if (due >= 1 && due <= REMINDERS && (reminded.current.get(t.id) ?? 0) < due) {
          reminded.current.set(t.id, due);
          beep();
          const cur = ref.current;
          if (cur) setSession(say(cur, `Reminder: ${timerName(t)} went off ${sayDuration((due * REMIND_MS) / 1000)} ago. Say “stop the timer” to silence it.`));
        }
      }
    }
  }, [now, session?.timers]);

  /** `unavailable`: what the cook said they don't have while choosing ("I don't have cilantro"); `preferredSwaps`: what they agreed to use instead. */
  const start = async (recipe: Recipe, rules: CookRules, pantry: PantryItem[], pantryBasics: boolean, leaveOut: string[] = [], unavailable: string[] = [], preferredSwaps: CookSession['preferredSwaps'] = []) => {
    setBusy('starting');
    const began = Date.now();
    // The steps are phrased for speaking while the stages are worked out.
    lines.current = {};
    const scaled = scaleRecipe(recipe, rules.servings);
    const phrasing = phrase(scaled);
    const staged = await modelService.stageRecipe(recipe);
    // One step per stage, with no sub-steps: "Smash and sear" and "Flip and melt" are one "Cook meat" step.
    const original = scaleRecipe(mergeStages({ ...recipe, stages: staged.stages, stagesBy: staged.by }), rules.servings);
    const blank: CookSession = {
      original,
      recipe: original,
      rules,
      pantry,
      pantryBasics,
      unavailable,
      leaveOut,
      preferredSwaps,
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
    // Fitting the recipe to the kitchen can reword steps (a swap); those get phrased too.
    const known = new Set(scaled.steps.map(lineKey));
    if (adapted.recipe.steps.some((st) => !known.has(lineKey(st)))) void phrasing.then(() => phrase(adapted.recipe));
    // The first step is said right away: give the model a few seconds, then go on with Gusteau's own wording.
    await Promise.race([phrasing, new Promise((r) => setTimeout(r, Math.max(0, 4000 - (Date.now() - began))))]);
    const swaps = adapted.substitutions.map((x) => (x.kind === 'swap' ? `${x.from.toLowerCase()} → ${x.to.toLowerCase()}` : x.kind === 'drop' ? `no ${x.from.toLowerCase()}` : `plus ${x.from.toLowerCase()}`));
    setSession(
      say(
        adapted,
        `Bonjour! Let’s make the ${adapted.recipe.title}. ${swaps.length ? `I’ve adjusted it for you (${swaps.join(', ')}). ` : ''}If anything changes as we go, like an ingredient you don’t have, the time, the equipment or who’s eating, tell me and I’ll rework the rest of the plan.`,
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
      void phrase(final.recipe);
      if (final.stepIndex !== before.stepIndex || final.recipe.steps[final.stepIndex]?.key !== before.recipe.steps[before.stepIndex]?.key) requestRead('repeat');
    } catch (err) {
      console.warn('[Gusteau] Replanning failed', err);
      setSession(say(withUser, 'I hit a snag replanning, so I kept your current plan exactly as it was. Try that again in a moment.'));
    } finally {
      setBusy(null);
    }
  };

  const next = (how: StepArrival = 'next') => {
    const s = ref.current;
    if (!s || s.paused) return;
    const step = s.recipe.steps[s.stepIndex];
    if (!step) return;
    const completed = s.completedStepKeys.includes(step.key) ? s.completedStepKeys : [...s.completedStepKeys, step.key];
    const stepIndex = Math.min(s.stepIndex + 1, s.recipe.steps.length);
    const finishing = stepIndex >= s.recipe.steps.length;
    // The last step done: Gusteau congratulates the cook and asks to save the dish, unless it's already a favorite.
    const ask = finishing && !on.current.isFavorite?.(s.original.id) ? ('favorite' as const) : undefined;
    const ns = { ...s, pendingConfirm: ask, completedStepKeys: completed, stepIndex };
    setSession(ns);
    setVideoCard(null);
    requestRead(how);
    if (ns.stepIndex >= ns.recipe.steps.length) on.current.onFinish(ns);
  };

  const back = () => {
    const s = ref.current;
    if (!s || s.stepIndex === 0) return;
    const idx = s.stepIndex - 1;
    const key = s.recipe.steps[idx].key;
    setSession({ ...s, pendingConfirm: undefined, stepIndex: idx, completedStepKeys: s.completedStepKeys.filter((k) => k !== key) });
    setVideoCard(null);
    requestRead('back');
  };

  /**
   * To step `n` (1-based): the steps before it count as done, the ones after as still to do.
   * `read`: say it aloud (not when Gusteau has just talked about it himself).
   */
  const goTo = (n: number, read: boolean) => {
    const s = ref.current;
    if (!s || n < 1 || n > s.recipe.steps.length || n === s.stepIndex + 1) return;
    const idx = n - 1;
    const before = new Set(s.recipe.steps.slice(0, idx).map((st) => st.key));
    const completed = [...new Set([...s.completedStepKeys.filter((k) => before.has(k)), ...before])];
    setSession({ ...s, pendingConfirm: undefined, stepIndex: idx, completedStepKeys: completed });
    setVideoCard(null);
    if (read) requestRead(idx > s.stepIndex ? 'next' : 'back');
  };

  /** Back to the first step, with every step to do again. */
  const restart = () => {
    const s = ref.current;
    if (!s) return;
    setSession({ ...s, pendingConfirm: undefined, stepIndex: 0, completedStepKeys: [] });
    setVideoCard(null);
    requestRead('restart');
  };

  /** What Gusteau says for the current step, introduced for how the cook got there. */
  const stepLine = (how: StepArrival): string => {
    const s = ref.current;
    const step = s?.recipe.steps[s.stepIndex];
    if (!s) return 'All done. Bon appétit!';
    if (!step) {
      const saved = s.pendingConfirm === 'favorite' ? ' Would you like me to add it to your favorites, so you can find it easily next time?' : '';
      return `Congratulations, you made the ${s.recipe.title}! Bon appétit.${saved}`;
    }
    const timerRunning = s.timers.some((t) => t.endsAt !== null && t.endsAt > Date.now());
    const modelLine = lines.current[lineKey(step)];
    // Timed parts are offered, never started: "I can time this for you… say “start the timer” when you're ready."
    return stepSpeech(modelLine ? withTitle(step, modelLine) : plainStepLine(step), s.stepIndex, s.recipe.steps.length, how, timerRunning) + timerOffer(step, s.timers, s.recipe, s.timersDone);
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
    reminded.current.delete(id);
    setSession({
      ...s,
      timers: s.timers.map((t) =>
        t.id !== id ? t : { ...t, totalSeconds: t.totalSeconds + seconds, endsAt: t.endsAt === null ? null : Math.max(t.endsAt, Date.now()) + seconds * 1000, pausedLeft: t.pausedLeft + seconds },
      ),
    });
  };
  /** One of the step's timed parts, started from its button. */
  const startStepTimer = (o: StepTimer) => {
    const s = ref.current;
    if (!s || s.timers.some((t) => t.key === o.key)) return;
    const at = Date.now();
    setNow(at);
    setSession({ ...s, timers: [...s.timers, { id: uid(), key: o.key, label: o.label, totalSeconds: o.seconds, endsAt: at + o.seconds * 1000, pausedLeft: o.seconds }] });
  };
  const removeTimer = (id: string) => {
    const s = ref.current;
    if (!s) return;
    // Dismissing a timer that rang finishes that timed part, so it isn't offered again.
    const rang = s.timers.find((t) => t.id === id && t.key && t.endsAt !== null && t.endsAt <= Date.now());
    setSession({ ...s, timers: s.timers.filter((t) => t.id !== id), timersDone: rang ? [...new Set([...(s.timersDone ?? []), rang.key!])] : s.timersDone });
  };

  const runCommand = (cmd: CookCommand, s: CookSession) => {
    switch (cmd.type) {
      case 'next':
        if (s.paused) return setSession(say(s, 'We’re paused until we sort out the plan. Pick one of the options above, or tell me what changed.'));
        if (s.stepIndex >= s.recipe.steps.length) return setSession(say(s, 'That was the last step. Bon appétit!'));
        return next();
      case 'back':
        if (s.stepIndex === 0) return setSession(say(s, 'This is the first step, so there’s nothing before it. Say “repeat that” to hear it again.'));
        return back();
      case 'repeat':
        return requestRead('repeat', true);
      case 'goto':
        if (cmd.step < 1 || cmd.step > s.recipe.steps.length) return setSession(say(s, `This recipe has ${s.recipe.steps.length} steps.`));
        if (cmd.step === s.stepIndex + 1) return setSession(say(s, whereWeAre(s.recipe, s.stepIndex)));
        return goTo(cmd.step, true);
      case 'where':
        return setSession(say(s, whereWeAre(s.recipe, s.stepIndex)));
      case 'more': {
        const step = s.recipe.steps[s.stepIndex];
        return setSession(say(s, step ? `Here’s the whole step. ${stepDetail(step)}` : 'We’ve finished every step. Bon appétit!'));
      }
      case 'skip': {
        const step = s.recipe.steps[s.stepIndex];
        if (!step) return setSession(say(s, 'There’s nothing left to skip. Bon appétit!'));
        if (s.paused) return setSession(say(s, 'We’re paused until we sort out the plan. Pick one of the options above, or tell me what changed.'));
        return setSession(say({ ...s, pendingConfirm: 'skip' }, `Skip “${step.title}”? Say yes to move on, or no to stay here.`));
      }
      case 'restart':
        return setSession(say({ ...s, pendingConfirm: 'restart' }, 'Start over from the first step? Say yes to go back to the beginning, or no to stay here.'));
      case 'timer_control': {
        // "Start the timer", "pause the rice timer", "how long is left?": see agent/stepTimers.ts.
        const at = Date.now();
        const r = controlTimers(cmd, s.timers, s.recipe.steps[s.stepIndex], s.recipe, at, uid, s.timersDone);
        r.restarted?.forEach((id) => {
          rung.current.delete(id);
          reminded.current.delete(id);
        });
        setNow(at);
        return setSession(say({ ...s, timers: r.timers, timersDone: r.done }, r.say));
      }
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
      // The screen follows the conversation: when Gusteau says "Let's move on to step 2", it moves on (and reads it).
      // The model says which step the cook is on now ("finished flipping, the cheese is melting" → step 3);
      // without that, its own words ("let's move on to step 2") are the cue.
      const moved = r.goToStep ? 'goto' : stepTalk(reply, before);
      if (r.goToStep) goTo(r.goToStep, false);
      else if (moved === 'next') next();
      else if (moved === 'back') back();
      // "How do I dice an onion?": short videos alongside the answer.
      if (r.howTo) showVideos(r.howTo, techniqueById(r.techniqueId)?.howTo);
      // A fix like "give it one more minute" comes with its timer, but only for a step that's cooking
      // something and when the cook said it needs longer: "done with the patties" never starts one.
      const step = before.recipe.steps[before.stepIndex];
      const cooking = !!step && (stepTimers(step, before.recipe).length > 0 || !!step.timerSeconds || /\b(cook|simmer|boil|bake|roast|fry|sear|steam|microwave|toast|grill|melt|brown|reduce|braise|poach)/i.test(step.text));
      const needsLonger = /\b(not (done|ready|cooked|soft|tender|set|crisp)|isn'?t (done|ready|cooked)|aren'?t (done|ready|cooked)|still (raw|pink|hard|firm|crunchy|runny|cold|frozen)|undercooked|needs? (more|longer)|more time|longer|another minute|few more minutes|extra time|too (runny|thin|watery)|runny|watery|soupy)\b/i.test(text);
      // A timer that matches a timed part of the step ("three minutes" for the sear) is that part's own
      // labelled timer, so when Gusteau says "the timer is set", it is.
      const offered = r.timerSeconds && !moved ? notStarted(step, ref.current?.timers ?? before.timers, before.recipe, before.timersDone).find((o) => Math.abs(o.seconds - r.timerSeconds!) <= 60) : undefined;
      if (offered) startStepTimer(offered);
      else if (r.timerSeconds && cooking && needsLonger) addTimer(r.timerSeconds, `${step?.title ?? 'Extra'} (extra time)`);
    }
  };

  /** Search short videos for a technique and open the video card. */
  const showVideos = (query: string, howTo?: string) => {
    setExplainer(null);
    setVideoCard({ query, howTo });
    searchVideos(query).then(
      (videos) => setVideoCard((c) => (c?.query === query ? { ...c, videos } : c)),
      (err: unknown) => {
        // Nothing for the cook's own words ("turn the meat into balls")? The current step's technique
        // ("shape burger patties") usually has plenty, and Gusteau says that's what he's showing.
        const s = ref.current;
        const step = s?.recipe.steps[s.stepIndex];
        const t = step && techniqueFor(step);
        const instead = step ? (t ? techniqueQuery(t) : step.title.toLowerCase()) : '';
        if (!instead || instead.toLowerCase() === query.toLowerCase()) {
          return setVideoCard((c) => (c?.query === query ? { ...c, error: err instanceof VideoError ? err.reason : 'unavailable' } : c));
        }
        searchVideos(instead).then(
          (videos) => {
            setVideoCard((c) => (c?.query === query ? { query: instead, howTo: c.howTo ?? t?.howTo, videos } : c));
            const cur = ref.current;
            if (cur) setSession(say(cur, `I couldn’t find short videos for exactly that, so here’s how to ${instead}.`));
          },
          (again: unknown) => setVideoCard((c) => (c?.query === query ? { ...c, error: again instanceof VideoError ? again.reason : 'unavailable' } : c)),
        );
      },
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
        ? `I couldn’t find ${term} as a food or kitchen item, and I only look up cooking things, so I won’t guess. If it’s an ingredient, check the label or tell me more about it.`
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
    let before = ref.current;
    if (!before) return;
    // "Skip this step?" / "Start over?": a yes does it, a no stays put, anything else drops the question.
    if (before.pendingConfirm) {
      const answer = confirmation(text);
      const asked = before.pendingConfirm;
      before = { ...before, pendingConfirm: undefined, chat: answer ? [...before.chat, { id: uid(), from: 'user', text, via: opts.via }] : before.chat };
      setSession(before);
      if (asked === 'favorite') {
        if (answer === 'yes') {
          on.current.onFavorite?.(before.original.id);
          return setSession(say(before, `Done! The ${before.recipe.title} is in your favorites. You’ll find it at the top of the recipes next time.`));
        }
        if (answer === 'no') return setSession(say(before, 'No problem. Enjoy your meal!'));
      }
      if (answer === 'yes') return asked === 'skip' ? next('skip') : restart();
      if (answer === 'no') return setSession(say(before, `Okay, staying on “${before.recipe.steps[before.stepIndex]?.title ?? 'this step'}”.`));
    }
    // "Add for tablespoons of butter": a possibly misheard amount is checked before anything else.
    const amount = ambiguousAmount(text);
    if (amount) {
      setSession({ ...before, chat: [...before.chat, { id: uid(), from: 'user', text, via: opts.via }, { id: uid(), from: 'gusteau', text: amount }] });
      return;
    }
    // "I flipped them and put the cheese on, how long until it melts?" on step 2: the screen moves to
    // step 3 first, so the answer (and any timer) is about the step they're really on.
    const described = stepDescribed(text, before);
    if (described) {
      goTo(described, false);
      before = ref.current ?? before;
    }
    setBusy('thinking');
    // The message shows at once, exactly as heard; how Gusteau understood it and his reply fill in as they stream.
    setPending({ text, via: opts.via });
    let r: InterpretResult;
    let streamed = '';
    try {
      r = await modelService.interpretMessage(text, before, {
        onReply: (sofar) => {
          setPending((p) => p && { ...p, reply: sofar });
          if (!opts.onReply) return;
          streamed = sofar;
          opts.onReply(sofar);
        },
        onInterpreted: (heard) => setPending((p) => p && { ...p, interpreted: heard }),
      });
    } catch (err) {
      console.warn('[Gusteau] Chat failed', err);
      r = { reply: 'Sorry, I lost that one. Could you say it again?', changes: [] };
    }
    setBusy(null);
    setPending(null);
    await handleInterpretation(text, r, ref.current ?? before, opts.via, streamed);
    // Keep "Interpreted as…" under the message in the chat.
    if (r.interpreted) {
      const cur = ref.current;
      const at = cur ? cur.chat.map((m) => m.from === 'user' && m.text === text && !m.interpreted).lastIndexOf(true) : -1;
      if (cur && at >= 0) setSession({ ...cur, chat: cur.chat.map((m, i) => (i === at ? { ...m, interpreted: r.interpreted } : m)) });
    }
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
    pending,
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
    next: () => next(),
    back,
    undo,
    stop,
    addTimer,
    startStepTimer,
    toggleTimer,
    addTime,
    removeTimer,
    repeat: () => requestRead('repeat', true),
    /** Introduce the first step in hands-free mode, after anything Gusteau is already saying. */
    readStep: () => requestRead('start'),
    stepLine,
  };
}

/** A yes or no to "skip this step?", "start over?" or "add it to your favorites?", or null when it's neither. */
export function confirmation(text: string): 'yes' | 'no' | null {
  const t = text.toLowerCase().replace(/[‘’]/g, "'").replace(/[?!.,]/g, '').trim();
  if (/^(no|nope|nah|not yet|not now|cancel|never ?mind|don'?t|wait|stay( here)?|no thanks?)\b/.test(t)) return 'no';
  if (/^(yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|please( do)?|confirm|correct|skip it|start over|let'?s do it|absolutely|definitely|of course|add it|save it)\b/.test(t)) return 'yes';
  return null;
}

export type Cook = ReturnType<typeof useCook>;
