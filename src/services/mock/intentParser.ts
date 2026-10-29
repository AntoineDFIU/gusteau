import { describeChanges } from '../../agent/adapt';
import { sameIngredient } from '../../data/ingredients';
import { EQUIPMENT_IDS } from '../../data/rules';
import { TECHNIQUES, techniqueById, techniqueFor, techniqueFromQuestion, techniqueQuery } from '../../data/techniques';
import type { CookCommand, CookSession, DietRuleId, SessionChange, TimerAction } from '../../types';
import type { InterpretResult } from '../modelService';
import { culinary, kitchenSpelling, offTopicReply, respelled } from '../topic';
import { answerOffer, kitchenHelp, outOfIngredient } from './kitchenHelp';

// ─────────────────────────────────────────────────────────────
// MOCK conversational agent: a rule-based intent parser.
// With a live model, the model produces the same structure and
// this parser is the fallback when the model can't be reached.
// Also used directly for hands-free voice commands, which need
// to be instant.
// ─────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const num = (s: string) => NUMBER_WORDS[s] ?? parseFloat(s);
const NUM = '(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)';

/** Lowercase, with curly quotes from phones and suggestion chips made straight. */
const clean = (s: string) => s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').trim();

export const DIET_PATTERNS: [RegExp, DietRuleId][] = [
  [/\bvegan\b/, 'vegan'],
  [/\b(vegetarian|veggie only|no meat|without (?:any )?meat|meat-?free|meatless)\b/, 'vegetarian'],
  [/\bpescatarian\b/, 'pescatarian'],
  [/\b(dairy[- ]?free|no dairy|lactose)\b/, 'dairy-free'],
  [/\b(gluten[- ]?free|no gluten|celiac|coeliac)\b/, 'gluten-free'],
  [/\b(egg[- ]?free|no eggs?)\b/, 'egg-free'],
  [/\b(nut[- ]?free|no nuts)\b/, 'nut-free'],
  [/\b(shellfish[- ]?free|no shellfish)\b/, 'shellfish-free'],
];

// Moving through the recipe by voice. Whole phrases only, so "next, add the
// garlic?" or "go back to the store" aren't mistaken for a command.
const OK = String.raw`(?:(?:ok|okay|alright|all right|right|great|good|cool|yes|yeah|so|and|gusteau|chef|done)\s+)*`;
const PLEASE = String.raw`(?:\s+(?:please|chef|gusteau|then|now))*`;
const STEP_COMMANDS: [RegExp, CookCommand['type']][] = [
  [/^(what'?s next|what is next|what now|next( step| one| please)?|on to the next( step| one)?|done|i'?m done( with (this|that)( step| one)?)?|finished|go on|continue|carry on|keep going|move on|let'?s move on|i'?m ready( for the next( step| one)?)?|ready( for the next( step| one)?)?|let'?s keep going|onwards?)$/, 'next'],
  [/^(go back( one| a step| one step| to the (last|previous) step)?|back( one| a step)?|previous( step| one)?|(the )?last step|step back|what did i just do|what was the (last|previous) step)$/, 'back'],
  [/^(repeat( that| it| this| the step| this step| the last part)?|say (that|it) again|(can|could) you (repeat (that|it|the step)|say (that|it) again)|what was that|come again|read (it|that|the step) again|one more time|again|sorry what|pardon|what did you say)$/, 'repeat'],
  [/^(what step (am i on|are we on|is this)|which step (am i on|are we on|is this)|where (am i|are we)( at)?|how far (along )?(am i|are we)|how many steps (are )?left|what stage (am i|are we) (in|at|on))$/, 'where'],
  [/^(skip( this| that| it| this step| the step| ahead)?|let'?s skip( this| it| this step)?|i'?ll skip( this| it| this step)?|skip to the next( step| one)?)$/, 'skip'],
  [/^(start over|start again|restart( the recipe)?|start from the (beginning|top|start)|go (back )?to the (beginning|start|first step)|from the top|back to (the )?(beginning|start|first step))$/, 'restart'],
  [/^(tell me more|more( detail| details)?|more about (this|that)( step)?|how exactly|what exactly( do i do)?|give me (more|the) detail(s)?|in more detail|read (me )?the (whole|full) step|what does (it|the step|the recipe) say( exactly)?|word for word|the full instructions?|explain (this|that|the) step)$/, 'more'],
];

/** "Next", "go back", "repeat that", "what step am I on?", "skip this step", "start over", "tell me more". */
export function stepCommand(raw: string): CookCommand | null {
  const t = clean(raw)
    .replace(/[?!.,]/g, '')
    .replace(new RegExp(`^${OK}`), '')
    .replace(new RegExp(`${PLEASE}$`), '')
    .trim();
  const hit = STEP_COMMANDS.find(([re]) => re.test(t));
  return hit ? ({ type: hit[1] } as CookCommand) : null;
}

const TIMER = String.raw`(?:timers?|clock|countdown|alarm)`;
const WHICH = String.raw`(?:(?:the|my|that|this|all(?: the)?|both(?: the)?)\s+)?(?:(.+?)\s+)?`;
const AMOUNT: Record<string, number> = { a: 1, an: 1, another: 1, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, fifteen: 15, thirty: 30 };
const TIMER_COMMANDS: [RegExp, TimerAction][] = [
  [new RegExp(String.raw`^(?:how (?:much )?(?:time|long)(?: is| do i have| have i got)? (?:left|remaining)|how long (?:is )?left|how much longer|time left|how(?:'s| is) ${WHICH}${TIMER}(?: doing| going)?|check ${WHICH}${TIMER}|what ${TIMER} (?:are|is) (?:running|on|set|going)|(?:are there )?any ${TIMER}(?: running)?)(?: (?:on|for) (?:the |my )?(.+?))?(?: ${TIMER})?$`), 'status'],
  [new RegExp(String.raw`^(?:(?:i'?m |we'?re )?ready(?: now)?,? )?(?:go ahead and )?(?:start|begin|kick off|set off)(?: up)? ${WHICH}${TIMER}(?: now| for (?:it|that|me))?$|^start (?:it|timing|the clock|the countdown)$`), 'start'],
  [new RegExp(String.raw`^(?:pause|hold|freeze) ${WHICH}${TIMER}(?: for (?:a (?:sec|second|minute|moment)|now))?$|^stop ${WHICH}${TIMER} for (?:a (?:sec|second|minute|moment)|now)$|^pause(?: it)?$`), 'pause'],
  [new RegExp(String.raw`^(?:resume|unpause|continue|restart|carry on with|keep going with|start again) ${WHICH}${TIMER}$|^(?:resume|unpause)(?: it)?$`), 'resume'],
  [new RegExp(String.raw`^(?:stop|cancel|end|kill|turn off|dismiss|clear|delete|remove|silence|reset) ${WHICH}${TIMER}$|^(?:stop|silence|turn off) (?:the )?(?:beeping|ringing|beep)$`), 'stop'],
];

/** "Start the timer", "pause the rice timer", "how long is left on the pasta?", "add a minute", "stop the alarm". */
export function timerCommand(raw: string): CookCommand | null {
  const t = clean(raw)
    .replace(/[?!.,]/g, '')
    .replace(new RegExp(`^${OK}`), '')
    .replace(new RegExp(`${PLEASE}$`), '')
    .trim();
  // "At a minute", "had two minutes": how speech recognition sometimes writes "add".
  const add = t.match(new RegExp(String.raw`^(?:add|at|had|give it|put on) (a|an|another|one|two|three|four|five|ten|fifteen|thirty|\d+)(?: more)? (second|sec|minute|min)s?(?: more)?(?: (?:to|on) ${WHICH}${TIMER})?$`));
  if (add) {
    const n = AMOUNT[add[1]] ?? parseInt(add[1], 10);
    return { type: 'timer_control', action: 'add', seconds: /^s/.test(add[2]) ? n : n * 60, target: timerTarget(t, add[3]) };
  }
  for (const [re, action] of TIMER_COMMANDS) {
    const m = t.match(re);
    // "Stop the beeping", "stop the alarm": only a timer that's ringing.
    if (m) return { type: 'timer_control', action, target: action === 'stop' && /\b(beep\w*|ringing|alarm)\b/.test(t) ? 'ringing' : timerTarget(t, m.slice(1).find(Boolean)) };
  }
  return null;
}

/** "rice" from "pause the rice timer"; "all" from "pause all timers"; nothing for "the timer". */
function timerTarget(t: string, named?: string): string | undefined {
  if (/\b(all|both|every)\b/.test(t)) return 'all';
  const w = named?.replace(/^(?:the|my|that|this|a)\s+/, '').trim();
  return w && !/^(it|that|this|one|the)$/.test(w) ? w : undefined;
}

// Also how speech recognition writes them after "step": "step A", "step won", "step to", "step for".
const ORDINAL: Record<string, number> = { one: 1, first: 1, a: 1, won: 1, two: 2, second: 2, to: 2, too: 2, three: 3, third: 3, four: 4, fourth: 4, for: 4, five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, ate: 8, nine: 9, ninth: 9, ten: 10, tenth: 10 };

/**
 * Gusteau said he's moving the cook along ("Great! Let's move on to step 2: smash and sear",
 * "on to the next step", "let's go back to step 1"): the screen follows what he said.
 */
export function stepTalk(reply: string, s: CookSession): 'next' | 'back' | null {
  const t = reply.toLowerCase().replace(/[‘’]/g, "'");
  const at = s.stepIndex + 1;
  const m = t.match(/\b(?:move on to|moving on to|on to|onto|go to|going to|head to|let'?s do|now for|next up is|up next is|time for|back to|go back to|going back to)\s+(?:the\s+)?(next step|previous step|step (\w+))/);
  if (!m) return null;
  if (m[1] === 'next step') return 'next';
  if (m[1] === 'previous step') return 'back';
  const n = ORDINAL[m[2]] ?? Number(m[2]);
  return n === at + 1 ? 'next' : n === at - 1 && /\bback\b/.test(m[0]) ? 'back' : null;
}
const stemOf = (w: string) => w.replace(/(ing|ed|es|s|e)$/, '');

/**
 * Finishing a step, said in passing: "I'm done with step 1", "the patties are shaped,
 * what's next?", "finished shaping the patties". The screen moves on with the
 * conversation, so it never lags behind what Gusteau is talking about.
 */
export function progressAnswer(raw: string, s: CookSession): InterpretResult | null {
  const step = s.recipe.steps[s.stepIndex];
  if (!step) return null;
  const t = clean(raw).replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  const next: InterpretResult = { reply: null, changes: [], command: { type: 'next' } };
  // "I'm on step 3", "we're already at step four", "go to step 3", "skip to step 5", "back to step 2".
  const jump = t.match(/\b(?:i'?m|we'?re|i am|we are)\s+(?:already\s+|now\s+)?(?:on|at|up to|doing|onto)\s+(?:the\s+)?step\s+(\w+)$|^(?:(?:can we|let'?s|please|ok|okay)\s+)?(?:go|skip|jump|move|head|take me)\s+(?:ahead\s+|forward\s+|back\s+)?to\s+step\s+(\w+)$|^(?:(?:ok|okay|let'?s)\s+)?back\s+to\s+step\s+(\w+)$/);
  if (jump) {
    const said = jump[1] ?? jump[2] ?? jump[3];
    const n = ORDINAL[said] ?? Number(said);
    if (n) return { reply: null, changes: [], command: { type: 'goto', step: n } };
  }
  // "…, what's next?" at the end of a longer sentence.
  if (/\b(what'?s next|what is next|what now|what do i do next|on to the next( step| one)?|let'?s move on|ready for the next( step| one)?)$/.test(t) && !/\b(not|n't)\b/.test(t)) return next;
  // Asking, or not finished: "is it done?", "how do I know when it's done?", "I'm not done".
  if (/\b(not|n't|almost|nearly|how|when|whether|should|do i|is it|are they|until)\b/.test(t)) return null;
  // "Done with step 1", "finished step one", "step 1 is done".
  const numbered = t.match(/\b(?:done|finished|completed?|through) (?:with )?(?:the )?step (\w+)\b|\b(?:the )?(\w+) step (?:is |'s )?(?:done|finished|complete|completed)\b|\bstep (\w+) (?:is |'s )?(?:done|finished|complete|completed)\b/);
  if (numbered) {
    const said = numbered[1] ?? numbered[2] ?? numbered[3];
    const n = ORDINAL[said] ?? Number(said);
    if (!n) return null;
    if (n === s.stepIndex + 1) return next;
    const title = step.title.replace(/[.:]$/, '').toLowerCase();
    return { reply: n <= s.stepIndex ? `That one’s already done. You’re on step ${s.stepIndex + 1}: ${title}.` : `You’re on step ${s.stepIndex + 1}: ${title}. Say “next” when it’s done, or “skip” to move on.`, changes: [] };
  }
  // "Done with the patties", "I've shaped the patties", "finished shaping", "the patties are shaped".
  const finished = /\b(done|finished|completed?|i'?ve \w+ed|i have \w+ed|(are|is) (done|ready|shaped|formed|finished|cooked|chopped|sliced|mixed|browned|seared|toasted|melted))\b/.test(t);
  if (!finished) return null;
  const said = t.split(' ').map(stemOf);
  const about = `${step.title} ${step.text}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !STEP_WORDS.has(w)).map(stemOf);
  return about.some((w) => w.length > 2 && said.includes(w)) ? next : null;
}
/** Past tenses that don't end in -ed. */
const IRREGULAR_PAST = new Set(['put', 'made', 'cut', 'set', 'spread', 'built', 'fried', 'dried', 'laid', 'left', 'threw', 'shook', 'stuck', 'beat', 'ground', 'split', 'tore', 'froze']);
const PAST_STEM: Record<string, string> = { made: 'mak', built: 'build', fried: 'fry', dried: 'dry', laid: 'lay', threw: 'throw', shook: 'shak', ground: 'grind', tore: 'tear', froze: 'freez' };
/** "flipped" → "flip", "toasted" → "toast", "shaped" → "shap" (as stemOf gives for "shape"). */
const pastStem = (w: string) => PAST_STEM[w] ?? stemOf(w.replace(/([b-df-hj-np-tv-z])\1ed$/, '$1').replace(/ied$/, 'y').replace(/ed$/, ''));

/**
 * The cook describes doing a later step: "I flipped them and put the cheese on, how long until
 * it melts?" while the screen still shows step 2. Returns the step (1-based) the screen should be
 * on: that step, or the one after it when they say it's already done ("I've already toasted the
 * buns"). The model then answers about the right step.
 */
export function stepDescribed(raw: string, s: CookSession): number | null {
  const t = clean(raw).replace(/[?!.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (/(\bnot\b|n't\b|\bnever\b|\byet\b|\bshould i\b|\bdo i\b|\bcan i\b|\bbefore i\b|\bafter i\b|\bwill i\b)/.test(t)) return null;
  const past = t.split(' ').filter((w) => /^[a-z]{3,}ed$/.test(w) || IRREGULAR_PAST.has(w)).map(pastStem);
  if (!past.length) return null;
  const steps = s.recipe.steps;
  // The latest later step whose title names something the cook says they did.
  for (let j = steps.length - 1; j > s.stepIndex; j--) {
    const doing = `${steps[j].title} ${steps[j].text}`.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STEP_WORDS.has(w) && !['the', 'and', 'into', 'some'].includes(w)).map(stemOf);
    if (!doing.some((d) => past.includes(d))) continue;
    // Done: they say so, or the step is one action they say they did ("I toasted the buns").
    // "Flip and melt" is two: "I flipped them" means they're in the middle of it.
    const asking = /\?|\b(how|what|when|until)\b/.test(clean(raw));
    // A merged step ("Cook meat": sear, flip and melt) is several actions too.
    const oneAction = !/\band\b|,/.test(steps[j].title) && !steps[j].key.includes('+');
    const finished = !asking && (/\b(already|done|finished|all set|ready)\b/.test(t) || oneAction);
    return finished ? Math.min(j + 2, steps.length) : j + 1;
  }
  return null;
}

/** Words in a step that don't say what the step is about. */
const STEP_WORDS = new Set(['with', 'into', 'from', 'until', 'then', 'each', 'them', 'over', 'your', 'this', 'that', 'minutes', 'minute', 'more', 'about', 'generously', 'very', 'well', 'side']);

/** Instant, local commands for cooking mode (typed or spoken). */
export function parseCommand(m: string): InterpretResult | null {
  const t = clean(m).replace(/[?!.,]/g, '').trim();
  // First, so "add a minute to the timer" isn't read as "set a one-minute timer".
  const timing = timerCommand(t);
  if (timing) return { reply: null, changes: [], command: timing };
  const timer = t.match(new RegExp(`\\b(?:set |start )?(?:a |an )?${NUM}[- ](second|sec|minute|min|hour)s?(?: timer)?\\b|\\btimer for ${NUM} (second|sec|minute|min|hour)s?\\b`));
  if (timer && /timer|set|start/.test(t)) {
    const n = num(timer[1] ?? timer[3]);
    const unit = timer[2] ?? timer[4];
    const seconds = Math.round(unit.startsWith('s') ? n : unit.startsWith('h') ? n * 3600 : n * 60);
    return { reply: null, changes: [], command: { type: 'timer', seconds } };
  }
  const step = stepCommand(t);
  if (step) return { reply: null, changes: [], command: step };
  if (/^(show me how|show me|how do i do (it|that)|show me a video)$|\b(video|demonstrat\w*|clip)\b/.test(t)) return { reply: null, changes: [], command: { type: 'show_technique' } };
  if (/^(ok |okay |thanks |thank you )?(got it|close (it|that|this|the pictures)?|close|dismiss|hide (it|that|them|the pictures)|back to (cooking|the recipe)|that's enough|i see)( thanks| thank you)?$/.test(t)) {
    return { reply: null, changes: [], command: { type: 'dismiss' } };
  }
  return null;
}

// Words that follow "what's" without being an ingredient or a tool.
const NOT_A_THING = /^(how|next|next step|step|steps|time|ingredients|options|rules|plan|recipe|this recipe|for lunch|for breakfast|left|that|this|it|happening|wrong|going on|the time|the plan|up|for dinner|the difference|the point|better|best|in it|in this|the next step|this step|my next step|done|ready|the matter|the problem|on|in)$/;

/**
 * "What is mirin?", "what's a zester?", "what does a colander look like?",
 * "I don't know what a skillet is": the thing to define, or null.
 */
/**
 * "How do I dice an onion?", "how to brown chicken", "show me how to fold",
 * "I don't know how to julienne": the technique to show videos of. "How do I
 * do that?" means the current step. Not "how long", "how much" or "how do I
 * know when it's done", which are answered in words.
 */
export function howToRequest(raw: string, s: CookSession): string | null {
  const t = clean(raw).replace(/[?!.,]/g, '').trim();
  const g =
    t.match(/^(?:so |ok |okay |and |um |sorry )?how (?:do|should|can|would|could) (?:i|you|we|one) (.+)$/) ??
    t.match(/^(?:so |and )?how to (.+)$/) ??
    t.match(/^(?:can you |could you |please )?(?:show|teach) me how to (.+)$/) ??
    t.match(/^what(?:'s| is) the (?:best |right |proper )?way to (.+)$/) ??
    t.match(/^(?:i don't know|i'm not sure|not sure|i've never learned) how to (.+)$/);
  let task = g?.[1]?.replace(/\b(properly|correctly|exactly|again|please|right|here|for this)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!task || /^(know|tell|check|see|make sure|keep|stop|get started|start|begin|go on|continue)\b/.test(task) || /\b(done|ready|cooked|long|much|many)\b/.test(task)) return null;
  // "do that", "do this step", "do it": whatever the current step asks for.
  if (/^(do )?(it|that|this|this step|the step|that part)$/.test(task)) {
    const step = s.recipe.steps[s.stepIndex];
    if (!step) return null;
    const tech = techniqueFor(step);
    task = tech ? techniqueQuery(tech) : step.title.toLowerCase();
  }
  return task.split(' ').length <= 8 ? task : null;
}

export function explainRequest(raw: string): string | null {
  const t = clean(raw).replace(/[?!.,]/g, '').trim();
  const forms = [
    /^(?:so |and |um |sorry |wait )?what(?:'s| is| are)(?: an?| the| some)? (.+?)(?: exactly| again| used for| for| anyway)?$/,
    /^what does (?:an?|the) (.+?) look like$/,
    /^what do(?:es)? (.+?) look like$/,
    /^(?:i don't know|i'm not sure|not sure|i've never heard of|never heard of) what (?:an? |the |some )?\s*(.+?) (?:is|are)$/,
    /^(?:i don't know|i've never heard of|never heard of|i've never used) (?:an? |the |some )?(.+)$/,
    /^(?:what do you mean by|what's meant by|define|explain what) (?:an? |the |some )?(.+?)(?: is| are)?$/,
    /^(?:show me|can you show me) (?:an? |the |some )?(?:picture of |photo of |pictures of )?(?:an?|the )?(.+)$/,
  ];
  for (const re of forms) {
    const g = t.match(re);
    const term = g?.[1]?.trim().replace(/^((an?|the|some) )?(pictures?|photos?|images?) of /, '').replace(/^(an?|the|some) /, '').trim();
    if (term && term.split(' ').length <= 4 && !NOT_A_THING.test(term) && !/^how\b/.test(term) &&!/\b(i|you|we|my|your|it|that|this|they)\b/.test(term)) return kitchenSpelling(term);
  }
  return null;
}

export function parseIntent(raw: string, s: CookSession): InterpretResult {
  const m = clean(raw);
  const cmd = parseCommand(m);
  if (cmd) return cmd;
  const help = answerOffer(raw, s) ?? progressAnswer(raw, s) ?? outOfIngredient(raw, s) ?? kitchenHelp(raw, s);
  if (help) return help;
  const explain = explainRequest(raw);
  if (explain) return { reply: null, changes: [], explain, interpreted: respelled(raw, explain) };
  const howTo = howToRequest(raw, s);
  if (howTo) {
    const tech = techniqueFromQuestion(howTo) ?? TECHNIQUES.find((x) => x.match.test(howTo));
    // "How do I change a tire?" gets no videos: Gusteau only teaches cooking.
    if (!tech && !culinary(howTo, s)) return { reply: offTopicReply(s.recipe.title), changes: [] };
    return { reply: tech ? `${tech.title}: ${tech.howTo}` : `Here are some short videos on how to ${howTo}.`, changes: [], howTo, techniqueId: tech?.id };
  }

  const changes: SessionChange[] = [];
  const r = s.rules;
  const ingredientNames = [...s.original.ingredients.map((i) => i.name), ...s.recipe.ingredients.map((i) => i.name), ...s.pantry.map((p) => p.name)];
  const known = (phrase: string) => ingredientNames.find((n) => sameIngredient(n, phrase) || n.toLowerCase().includes(phrase));


  // ── Equipment ──
  for (const e of EQUIPMENT_IDS) {
    const word = e === 'stovetop' ? '(stove|stovetop|hob|burner)' : e;
    if (new RegExp(`\\b(no|don'?t have (a|an)?|without (a|an|the)?) ?${word}\\b|\\b${word} (is )?(broken|busy|not working|died)`).test(m) && r.equipment.includes(e)) {
      changes.push({ type: 'remove_equipment', equipment: e });
    }
  }

  // ── Diet rules & allergies ──
  for (const [re, rule] of DIET_PATTERNS) {
    if (re.test(m) && !r.hardExclusions.includes(rule)) {
      changes.push({ type: 'add_exclusion', rule });
      break;
    }
  }
  const allergy = m.match(/allergic to ([a-z ]+?)(?:[.,!]|$| and )/);
  if (allergy) changes.push({ type: 'add_exclusion', custom: allergy[1].trim() });

  // ── Time ──
  const mins = m.match(/\b(?:only (?:have )?|got |have )?(\d+)\s*(?:min|mins|minutes)\b(?! timer)/);
  if (mins && /\b(only|have|got|left|need to be done|hurry)\b/.test(m)) changes.push({ type: 'set_time', minutes: parseInt(mins[1], 10) });
  else if (/\bhalf an hour\b/.test(m)) changes.push({ type: 'set_time', minutes: 30 });

  // ── Servings ──
  const people = m.match(/\b(?:for|feed|feeding|serves?|serving)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?! min)/) ?? m.match(/\b(\d+|two|three|four|five|six|seven|eight)\s+(?:people|of us|servings|guests)\b/);
  if (people) {
    const n = num(people[1]);
    if (n && n !== r.servings) changes.push({ type: 'set_servings', servings: n });
  } else if (/\b(more people|friends (are )?coming|extra guests)\b/.test(m)) changes.push({ type: 'set_servings', servings: r.servings + 2 });

  // ── Leave out ──
  const skip = m.match(/\b(?:cook |make it |go )?without (?:the |any )?([a-z ]+?)(?:[.,!?]|$)|\b(?:leave out|skip|drop) (?:the |any )?([a-z ]+?)(?:[.,!?]|$)/);
  if (skip && !changes.some((c) => c.type === 'remove_equipment')) {
    const phrase = (skip[1] ?? skip[2]).trim();
    const name = known(phrase);
    if (name) changes.push({ type: 'leave_out', name });
  }

  // ── Removed ingredients ──
  const removalRe =
    /(?:don'?t|do not|didn'?t) (?:actually )?have (?:any )?([a-z ]+)|(?:out of|ran out of|run out of|used up|no more|i'?m out of|we'?re out of) (?:any |the |my )?([a-z ]+)|(?:the |my )?([a-z ]+?) (?:is|are|went|has gone|have gone) (?:gone|bad|off|spoiled|moldy|mouldy|expired|finished)|\bno ([a-z]+(?: [a-z]+)?)\b/g;
  let rm: RegExpExecArray | null;
  while ((rm = removalRe.exec(m))) {
    const phrase = (rm[1] ?? rm[2] ?? rm[3] ?? rm[4] ?? '').replace(/\b(actually|anymore|left|either|after all|any|the)\b/g, '').trim();
    if (!phrase || /^(time|minutes?|stove|stovetop|oven|microwave|blender|grill|meat|dairy|gluten|eggs?|nuts)$/.test(phrase)) continue;
    // "no X" only counts if X is an ingredient Gusteau knows about.
    const name = known(phrase) ?? (rm[4] ? null : phrase);
    if (!name || changes.some((c) => (c.type === 'remove_ingredient' || c.type === 'leave_out') && sameIngredient(c.name, name))) continue;
    changes.push({ type: 'remove_ingredient', name });
  }

  // ── Found ingredients ──
  const add = m.match(/\b(?:i (?:also |actually )?(?:have|found|got)|there'?s (?:some |also )?|found (?:some )?)\s*(?:some |a |an |the )?([a-z ]+?)(?:[.,!]|$| after all| too| as well)/);
  if (add && !/don'?t have|do not have|only have|have \d/.test(m)) {
    const phrase = add[1].trim();
    if (phrase && phrase.split(' ').length <= 3 && !/^(time|minutes?|a minute|it|that|this)$/.test(phrase)) changes.push({ type: 'add_ingredient', name: known(phrase) ?? phrase });
  }

  if (changes.length) return { reply: null, changes, trigger: describeChanges(changes) };
  return answerQuestion(m, s);
}

function answerQuestion(m: string, s: CookSession): InterpretResult {
  const step = s.recipe.steps[s.stepIndex];
  const asked = techniqueFromQuestion(m);
  if (asked && /\b(how|what|explain|mean|show)\b/.test(m)) {
    return { reply: `${asked.title}: ${asked.howTo}`, changes: [], techniqueId: asked.id };
  }
  if (!step) return { reply: 'You’re all done! Enjoy it. If you want to cook something else, head back to the recipes.', changes: [] };
  const tech = techniqueFor(step);
  if (/\b(how|explain|what does .* mean|i don'?t (get|understand)|confus|hard|difficult|stuck)\b/.test(m) && tech) {
    return { reply: `For “${step.title}”: ${tech.howTo}`, changes: [], techniqueId: tech.id };
  }
  if (/\b(how (do i|can i|will i) )?(know|tell).*(done|ready|cooked)|is it done|how long\b/.test(m)) {
    const mins = step.timerSeconds ? `The timer for this step is ${Math.round(step.timerSeconds / 60) || 1} min. ` : '';
    return { reply: `${mins}${step.tip ?? 'Trust your eyes and nose more than the clock: look for the color and texture the step describes.'}`, changes: [] };
  }
  if (/\b(safe|allerg|expire|spoil|fresh|raw|contaminat)\b/.test(m)) {
    return {
      reply: 'I can share general cooking guidance, but I can’t check allergens, freshness or contamination. Read the packaging and use-by dates, and when in doubt, leave it out. For meat, a food thermometer is the reliable test.',
      changes: [],
    };
  }
  if (/\b(substitut|swap|instead|replace)\b/.test(m)) {
    return { reply: 'Tell me what you’re missing, like “I don’t have cheese”, and I’ll rework the rest of the plan around it without breaking your rules.', changes: [] };
  }
  if (/\b(thanks|thank you|merci|great|awesome|perfect)\b/.test(m)) return { reply: 'Avec plaisir! You’re doing great. Say “next” when this step is done.', changes: [] };
  // A question about something other than cooking gets a polite redirect, not an answer.
  if (/\?\s*$|^(who|what|when|where|why|how|which|can|could|do|does|is|are|will|would|tell me)\b/.test(m) && !culinary(m, s)) return { reply: offTopicReply(s.recipe.title), changes: [] };
  const t = step.technique ? techniqueById(step.technique) : tech;
  return {
    reply: `You’re on “${step.title}”. ${step.tip ?? (t ? `Need a hand? Ask me how to ${t.title.toLowerCase().replace(/^(\w+)ing\b/, '$1')}.` : 'Take it one step at a time.')} If anything changes, like an ingredient, time, equipment or servings, tell me and I’ll replan the rest.`,
    changes: [],
  };
}
