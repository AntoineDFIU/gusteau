import { isStaple } from '../data/ingredients';
import type { ActiveTimer, Recipe, RecipeStep } from '../types';
import { speakable } from './stepSpeech';

// ─────────────────────────────────────────────────────────────
// Timed parts of a step: "Microwave for 8 minutes, then let it stand
// for 2 minutes" has two. Each gets a short label ("Microwave the
// rice", "Rest the rice"), so Gusteau can offer them by name and the
// cook can start, pause and stop them by voice ("pause the rice timer").
// Nothing starts until the cook says so.
// ─────────────────────────────────────────────────────────────

export interface StepTimer {
  /** Stable per step, so a started timer is matched to its offer. */
  key: string;
  label: string;
  seconds: number;
  /** "three to four minutes": the timer is set to the shorter time, so the cook can check. */
  range?: [number, number];
  /** "for 3 minutes per side". */
  perSide?: boolean;
}

/** Quick parts ("add the garlic for 1 minute") don't need a timer. */
const MIN_SECONDS = 120;

const VERBS =
  'cook|simmer|boil|bake|roast|microwave|fry|stir-fry|deep-fry|pan-fry|saut[ée]|sear|steam|rest|soak|marinate|grill|toast|heat|warm|melt|scramble|stir|toss|whisk|brown|reduce|poach|braise|blanch|chill|freeze|knead|proof|rise|wilt|cool|stand|leave|caramelize|caramelise|bloom|infuse|steep|sweat|char|broil|smoke|let it stand|let it rest|let them rest|let it cool|let it sit|let it rise|leave it';
// Ends on a non-letter rather than \b, so "sauté" (whose é isn't a word character) counts.
const VERB = new RegExp(String.raw`\b(${VERBS})(?![a-zé])`, 'gi');
/** Verbs that put something in the pan without timing it: "add the milk and simmer" simmers the milk. */
const PUTS = /\b(?:add|stir in|whisk in|fold in|pour in|return|put|mix|toss|combine|coat|rinse|season)(?![a-zé])/gi;
/** "over medium heat", "the heat": a noun, not something to do. */
const NOT_VERB = /\b(over|medium|high|low|gentle|the|a|of|on)[\s-]*$/i;
const DURATION = /(\d+(?:\.\d+)?|½|¼)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b(\s+(?:per|on each|each) side)?/i;
/** Durations that aren't something to time: "stir every 5 minutes", "keeps for up to 3 days". */
const NOT_A_TIMER = /\b(every|within|up to|at least|ready in|or until|before serving|ahead)\s*$/i;
/** Words that end what a verb is done to: "cook the chicken skin side down" is about the chicken. */
const OBJECT_END = 'skin|cut|side|gently|separately|flat|loosely|covered|thoroughly|well|until|for|over|in|on|with|at|into|to|so|while|and|then';

const unitSeconds = (unit: string) => (/^h/i.test(unit) ? 3600 : /^s/i.test(unit) ? 1 : 60);
const value = (n: string) => (n === '½' ? 0.5 : n === '¼' ? 0.25 : parseFloat(n));
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** The doing word nearest before the duration: "heat the oil and sauté the onion for 5 minutes" is the sauté. */
function verbBefore(text: string): { verb: string; at: number } | null {
  let found: { verb: string; at: number } | null = null;
  for (const m of text.matchAll(VERB)) if (!NOT_VERB.test(text.slice(0, m.index))) found = { verb: m[1], at: m.index! + m[0].length };
  return found;
}

/** What the verb is done to, when it says so straight after: "sauté the onion", "cook the chicken skin side down" → "the chicken". */
function objectAfter(raw: string): string | null {
  // "in the milk", "the rest of the sugar", "half the garam masala": the milk, the sugar, the garam masala.
  const text = raw.replace(/^(\s+)(?:in|into|through)\s+/i, '$1').replace(/\b(?:the )?(?:rest|remainder|half|most) of (?:the )?|\bhalf the /i, 'the ');
  const word = String.raw`(?!(?:${OBJECT_END})\b)[a-z][a-z'-]*`;
  const m = text.match(new RegExp(String.raw`^\s+((?:the|your|some|each|all the)\s+${word}(?:\s+${word}){0,2})`, 'i'));
  // "Roast in the oven" isn't roasting the oven.
  return m && !COOKWARE.test(m[1]) ? m[1].trim() : null;
}

/** Not what a timer is named after: cookware, and (when it's only going in the pan) the fat or water. */
const COOKWARE = /\b(oven|pan|skillet|wok|pot|saucepan|tray|sheet|grill|heat|lid)\b/i;
const FAT = /\b(oil|butter|ghee|fat|water|salt)\b/i;

/** "the rice": the step's main ingredient, by its last two words ("long-grain white rice" → "white rice"). */
function mainIngredient(step: RecipeStep, recipe?: Recipe): string | null {
  const ing = recipe?.ingredients.find((i) => step.uses.includes(i.id) && !isStaple(i.name) && !FAT.test(i.name));
  if (!ing) return null;
  const words = ing.name.toLowerCase().replace(/\(.*?\)|,.*$/g, '').trim().split(/\s+/);
  return `the ${words.slice(-2).join(' ')}`;
}

/** The timed parts of a step, in order. Falls back to the step's own timer from the recipe database. */
export function stepTimers(step: RecipeStep, recipe?: Recipe): StepTimer[] {
  const out: StepTimer[] = [];
  // Clauses: sentences, and "…, then …" within them.
  const clauses = step.text.split(/(?<=[.;!?])\s+|,?\s+then\s+|,\s+(?=(?:and\s+)?(?:let|leave|rest|cover)\b)/i);
  let lastObject: string | null = null;
  // A merged step ("Cook meat": sear, then flip and melt) mixes its parts' ingredients, so none of them names a timer.
  const main = step.key.includes('+') ? null : mainIngredient(step, recipe);
  for (const clause of clauses) {
    const d = clause.match(DURATION);
    const found = verbBefore(d ? clause.slice(0, d.index) : clause);
    const object = found ? objectAfter(clause.slice(found.at)) : null;
    // What the clause put in the pan, in order ("heat the oil, pour in the mixture": the mixture).
    // The fat or water it went into isn't what's being timed.
    const named = [...(d ? clause.slice(0, d.index) : clause).matchAll(new RegExp(`${PUTS.source}|${VERB.source}`, 'gi'))];
    for (const m of named) {
      const put = NOT_VERB.test(clause.slice(0, m.index)) ? null : objectAfter(clause.slice(m.index! + m[0].length));
      if (put && !FAT.test(put)) lastObject = put;
    }
    if (!d || !found || NOT_A_TIMER.test(clause.slice(0, d.index))) continue;
    const lo = value(d[1]) * unitSeconds(d[3]);
    const hi = d[2] ? value(d[2]) * unitSeconds(d[3]) : null;
    if (lo < MIN_SECONDS || lo > 12 * 3600) continue;
    // "Let it stand", "leave for 15 minutes": a rest. Named after what the verb is done to, or what the
    // step last put in the pan, or (except for a rest) the step's main ingredient, or just the verb.
    const resting = /^(let|leave|stand|rest)\b/i.test(found.verb);
    const action = resting ? 'rest' : found.verb.toLowerCase();
    const what = object ?? lastObject ?? (resting ? null : main) ?? '';
    const label = cap(`${action}${what ? ` ${what}` : ''}`.replace(/\s+/g, ' ').trim()) + (d[4] ? ', first side' : '');
    out.push({ key: `${step.key}#${out.length}`, label, seconds: Math.round(lo), range: hi ? [Math.round(lo), Math.round(hi)] : undefined, perSide: !!d[4] });
  }
  if (!out.length && step.timerSeconds && step.timerSeconds >= MIN_SECONDS) out.push({ key: `${step.key}#0`, label: step.title.replace(/[.:]$/, ''), seconds: step.timerSeconds });
  return out;
}

/** "eight minutes", "three to four minutes", "one and a half hours". */
export function sayDuration(seconds: number, range?: [number, number]): string {
  const one = (s: number) => {
    if (s >= 3600 && s % 3600 === 0) return `${s / 3600} hour${s === 3600 ? '' : 's'}`;
    if (s >= 60 && s % 60 === 0) return `${s / 60} minute${s === 60 ? '' : 's'}`;
    if (s >= 60) return `${Math.floor(s / 60)} minute${s < 120 ? '' : 's'} ${s % 60} seconds`;
    return `${s} seconds`;
  };
  if (range && range[1] !== range[0]) {
    const [a, b] = range;
    const unit = b % 3600 === 0 && a % 3600 === 0 ? 3600 : 60;
    if (a % unit === 0 && b % unit === 0) return speakable(`${a / unit} to ${one(b)}`);
  }
  return speakable(one(seconds));
}

/** Offered timers for this step that haven't been started yet, or that ran to the end (`done`). */
export const notStarted = (step: RecipeStep | undefined, timers: ActiveTimer[], recipe?: Recipe, done: string[] = []) =>
  step ? stepTimers(step, recipe).filter((t) => !done.includes(t.key) && !timers.some((a) => a.key === t.key)) : [];

/** What Gusteau adds when he reads a step with timed parts. */
export function timerOffer(step: RecipeStep, timers: ActiveTimer[], recipe?: Recipe, done: string[] = []): string {
  const open = notStarted(step, timers, recipe, done);
  if (!open.length) return '';
  const item = (t: StepTimer) => `${t.label.toLowerCase()}, ${sayDuration(t.seconds, t.range)}${t.perSide ? ' per side' : ''}`;
  if (open.length === 1) return ` I can time this for you: ${item(open[0])}. Say “start the timer” when you’re ready.`;
  return ` This step has ${speakable(String(open.length))} timed parts: ${open.map(item).join(', then ')}. Say “start the timer” when you’re ready for the first one.`;
}

/** How a timer is named out loud: "the timer to microwave the rice", "the five-minute timer". */
export function timerName(t: Pick<ActiveTimer, 'label'>): string {
  const label = t.label.replace(/ timer$/i, '').trim();
  if (/^\d+:\d\d$/.test(label)) {
    const [m, s] = label.split(':').map(Number);
    return `the ${sayDuration(m * 60 + s).replace(/s$/, '').replace(/ /g, '-')} timer`;
  }
  return new RegExp(`^(${VERBS})(?![a-zé])`, 'i').test(label) ? `the timer to ${label.toLowerCase()}` : `the ${label.toLowerCase()} timer`;
}

// ── Controlling timers by voice ─────────────────────────────

const leftOf = (t: ActiveTimer, now: number) => (t.endsAt === null ? t.pausedLeft : Math.max(0, (t.endsAt - now) / 1000));
const isRinging = (t: ActiveTimer, now: number) => t.endsAt !== null && t.endsAt <= now;
const isRunning = (t: ActiveTimer, now: number) => t.endsAt !== null && t.endsAt > now;

/** "four minutes", "two minutes thirty seconds", "forty seconds". */
function sayLeft(seconds: number): string {
  const s = Math.ceil(seconds);
  if (s < 60) return speakable(`${s} seconds`);
  const m = Math.floor(s / 60);
  const r = s % 60;
  // Close enough: "about four minutes" past five minutes, to the half minute before that.
  if (m >= 5) return speakable(`${r >= 30 ? m + 1 : m} minutes`);
  const half = r >= 45 ? 60 : r >= 15 ? 30 : 0;
  return speakable(half === 60 ? `${m + 1} minutes` : `${m} minute${m === 1 ? '' : 's'}${half ? ' 30 seconds' : ''}`);
}

/** Does the cook's "rice" (or "the microwave") name this timer? */
function names(target: string, label: string): boolean {
  const words = label.toLowerCase().split(/[^a-zé]+/);
  const said = target.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'one', 'for'].includes(w));
  return said.length > 0 && said.every((w) => words.some((l) => l.startsWith(w.replace(/(?<=[^s])e?s$/, '')) || w.startsWith(l) && l.length > 3));
}


/** "x, y or z" for a question, "x, y and z" for what was done. */
const list = (xs: string[], joiner: 'or' | 'and' = 'and') => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${joiner} ${xs[xs.length - 1]}`);

export interface TimerControl {
  action: 'start' | 'pause' | 'resume' | 'stop' | 'status' | 'add';
  /** Words naming the timer ("rice"), "all", or "ringing" ("stop the beeping"). */
  target?: string;
  seconds?: number;
}

/**
 * What a timer command does, and what Gusteau says. Pure: the caller stores
 * `timers` and `done` (timed parts that ran to the end, so they aren't offered
 * again). `restarted`: timers given more time after they rang, so they ring again.
 */
export function controlTimers(
  cmd: TimerControl,
  timers: ActiveTimer[],
  step: RecipeStep | undefined,
  recipe: Recipe | undefined,
  now: number,
  newId: () => string,
  done: string[] = [],
): { timers: ActiveTimer[]; say: string; done: string[]; restarted?: string[] } {
  const all = cmd.target === 'all';
  const ringingOnly = cmd.target === 'ringing';
  const target = all || ringingOnly ? undefined : cmd.target;
  const pick = (ts: ActiveTimer[]) => (target ? ts.filter((t) => names(target, t.label)) : ts);
  const nameList = (ts: { label: string }[], joiner: 'or' | 'and' = 'and') => list(ts.map((t) => timerName(t)), joiner);
  const which = (ts: ActiveTimer[], verb: string) => `Which one: ${nameList(ts, 'or')}? Or say “${verb} all timers”.`;
  const start = (o: StepTimer): ActiveTimer => ({ id: newId(), key: o.key, label: o.label, totalSeconds: o.seconds, endsAt: now + o.seconds * 1000, pausedLeft: o.seconds });
  const resume = (t: ActiveTimer): ActiveTimer => ({ ...t, endsAt: now + t.pausedLeft * 1000 });
  const pause = (t: ActiveTimer): ActiveTimer => ({ ...t, endsAt: null, pausedLeft: leftOf(t, now) });
  const update = (changed: ActiveTimer[]) => timers.map((t) => changed.find((c) => c.id === t.id) ?? t);
  const offers = notStarted(step, timers, recipe, done);
  const nextUp = (o: StepTimer | undefined) => (o ? ` Next, ${timerName(o).replace(/^the timer to /, '')} for ${sayDuration(o.seconds, o.range)}. Say “start the timer” when you’re ready.` : '');
  const same = (say: string) => ({ timers, say, done });

  switch (cmd.action) {
    case 'start': {
      const offer = target ? offers.find((o) => names(target, o.label)) : all ? undefined : offers[0];
      if (all && offers.length) {
        const started = offers.map(start);
        return { timers: [...timers, ...started], done, say: `Started ${nameList(started)}. I’ll tell you when each one is done.` };
      }
      if (offer) {
        const t = start(offer);
        const next = offers.find((o) => o.key !== offer.key);
        const range = offer.range ? ` That’s the shorter time, so check it then; it can take up to ${sayDuration(offer.range[1])}.` : '';
        const side = offer.perSide ? ' That’s for the first side; say “start the timer” again for the second.' : '';
        const after = next && !side ? ` After that, ${timerName(next).replace(/^the timer to /, '')} for ${sayDuration(next.seconds, next.range)}.` : '';
        return { timers: [...timers, t], done, say: `Started ${timerName(t)}: ${sayDuration(offer.seconds)}.${range}${side} I’ll tell you when it’s done.${after}` };
      }
      // "Start the timer" for one that's paused.
      const paused = pick(timers.filter((t) => t.endsAt === null));
      if (paused.length === 1 || (paused.length && all)) return { timers: update(paused.map(resume)), done, say: `Resumed ${nameList(paused)}, with ${sayLeft(paused[0].pausedLeft)} left.` };
      // The second side, once the first one has rung.
      const firstSide = step && stepTimers(step, recipe).find((o) => o.perSide && !done.includes(`${o.key}~2`) && !timers.some((t) => t.key === `${o.key}~2`) && (done.includes(o.key) || timers.some((t) => t.key === o.key && isRinging(t, now))));
      if (firstSide) {
        const t = { ...start(firstSide), key: `${firstSide.key}~2`, label: firstSide.label.replace(/first side$/, 'second side') };
        return { timers: [...timers.filter((x) => x.key !== firstSide.key), t], done: [...new Set([...done, firstSide.key])], say: `Started ${timerName(t)}: ${sayDuration(firstSide.seconds)}. I’ll tell you when it’s done.` };
      }
      if (target) return same(`I don’t have a ${target} timer for this step.${offers.length ? ` I can start ${nameList(offers, 'or')}.` : ''}`);
      const running = timers.filter((t) => isRunning(t, now));
      if (running.length) return same(`${upper(nameList(running))} ${running.length === 1 ? 'is' : 'are'} already running, and this step has no other timer. Say “set a five-minute timer” if you need one.`);
      const had = step ? stepTimers(step, recipe).length : 0;
      if (had) return same(`${had > 1 ? 'All the timers' : 'The timer'} for this step ${had > 1 ? 'are' : 'is'} done. Say “next” when you’re ready, or “set a five-minute timer” if you need more time.`);
      return same('This step doesn’t have a timer. Say “set a five-minute timer” if you need one.');
    }
    case 'pause': {
      const running = pick(timers.filter((t) => isRunning(t, now)));
      if (!running.length) return same(pick(timers.filter((t) => t.endsAt === null)).length ? 'That timer is already paused. Say “resume the timer” to carry on.' : 'No timer is running.');
      if (running.length > 1 && !target && !all) return same(which(running, 'pause'));
      return { timers: update(running.map(pause)), done, say: `Paused ${nameList(running)}${running.length === 1 ? `, with ${sayLeft(leftOf(running[0], now))} left` : ''}. Say “resume the timer” when you’re ready.` };
    }
    case 'resume': {
      const paused = pick(timers.filter((t) => t.endsAt === null));
      if (!paused.length) return same(pick(timers.filter((t) => isRunning(t, now))).length ? 'That timer is already running.' : 'There’s no paused timer.');
      if (paused.length > 1 && !target && !all) return same(which(paused, 'resume'));
      return { timers: update(paused.map(resume)), done, say: `Resumed ${nameList(paused)}${paused.length === 1 ? `, with ${sayLeft(paused[0].pausedLeft)} left` : ''}.` };
    }
    case 'stop': {
      const ringing = pick(timers.filter((t) => isRinging(t, now)));
      if (ringingOnly && !ringing.length) return same('Nothing is ringing.');
      const matching = ringingOnly ? ringing : target || all ? pick(timers) : ringing.length ? ringing : timers;
      if (!matching.length) return same(target ? `I don’t have a ${target} timer.` : 'There’s no timer to stop.');
      if (matching.length > 1 && !target && !all && !ringingOnly) return same(which(matching, 'stop'));
      const gone = new Set(matching.map((t) => t.id));
      // A timer that rang is finished: it isn't offered again, and the next one is.
      const finished = matching.filter((t) => isRinging(t, now) && t.key).map((t) => t.key!);
      const nowDone = [...new Set([...done, ...finished])];
      const left = timers.filter((t) => !gone.has(t.id));
      const rang = matching.every((t) => isRinging(t, now));
      return { timers: left, done: nowDone, say: `${rang ? 'Done' : 'Stopped'}: ${nameList(matching)}.${rang ? nextUp(notStarted(step, left, recipe, nowDone)[0]) : ''}` };
    }
    case 'add': {
      const seconds = cmd.seconds ?? 60;
      const ts = pick(timers);
      if (!ts.length) return same('There’s no timer to add time to. Say “set a five-minute timer” for a new one.');
      if (ts.length > 1 && !target && !all) return same(`Which one: ${nameList(ts, 'or')}?`);
      const longer = ts.map((t) =>
        t.endsAt === null ? { ...t, totalSeconds: t.totalSeconds + seconds, pausedLeft: t.pausedLeft + seconds } : { ...t, totalSeconds: t.totalSeconds + seconds, endsAt: Math.max(t.endsAt, now) + seconds * 1000 },
      );
      return { timers: update(longer), done, restarted: ts.filter((t) => isRinging(t, now)).map((t) => t.id), say: `Added ${sayDuration(seconds)} to ${nameList(ts)}. ${upper(sayLeft(leftOf(longer[0], now)))} left.` };
    }
    case 'status': {
      const ts = target || all ? pick(timers) : timers;
      if (!ts.length) return same(target ? `I don’t have a ${target} timer.` : offers.length ? `No timers are running. I can start ${nameList(offers, 'or')}: say “start the timer”.` : 'No timers are running.');
      const one = (t: ActiveTimer) => `${upper(timerName(t))}: ${isRinging(t, now) ? 'done' : t.endsAt === null ? `paused, ${sayLeft(t.pausedLeft)} left` : `${sayLeft(leftOf(t, now))} left`}`;
      return same(`${ts.map(one).join('. ')}.`);
    }
  }
}

const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
