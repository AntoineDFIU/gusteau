// ─────────────────────────────────────────────────────────────
// What Gusteau SAYS for a step, as opposed to what the screen shows.
//
// The screen keeps the title and the full written instruction. Out loud,
// Gusteau sounds like a chef beside you: "Start by shaping the patties.
// Divide the beef into four balls…", with numbers and measurements said
// the way people say them, and no "Step one" or headings read out.
//
// A step's spoken line comes from the model when one is connected (checked
// against the written step, see openAICompatModelService.phraseSteps) or
// from the title and instruction here, so it works without a model too.
// The transition ("Start by", "Next", "While that cooks") is added at the
// moment it's said, since it depends on how the cook got to the step.
// ─────────────────────────────────────────────────────────────

import { stageIndexOf } from './stages';
import type { Recipe, RecipeStep } from '../types';

const ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/**
 * Whole numbers in words: "four", "twenty-five", "three hundred fifty", "two thousand".
 * Gusteau's voice skips digits, so everything he says has its numbers spelled out.
 */
function numberWord(n: number): string | null {
  if (!Number.isInteger(n) || n < 0 || n >= 1e9) return null;
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numberWord(n % 100)}` : ''}`;
  const [size, name] = n < 1e6 ? [1e3, 'thousand'] : [1e6, 'million'];
  return `${numberWord(Math.floor(n / size))} ${name}${n % size ? ` ${numberWord(n % size)}` : ''}`;
}

/** "1.5" → "one and a half", "0.25" → "a quarter", "2.4" → "two point four". */
function decimalWords(n: string): string {
  const [whole, part] = n.split('.');
  const w = Number(whole);
  const named: Record<string, string> = { '5': 'a half', '25': 'a quarter', '75': 'three-quarters' };
  const frac = named[part.replace(/0+$/, '')];
  if (frac) return w ? `${numberWord(w)} and ${frac}` : frac;
  return `${numberWord(w) ?? whole} point ${[...part].map((d) => ONES[Number(d)]).join(' ')}`;
}

const FRACTIONS: Record<string, [string, string]> = {
  // [on its own or after a whole number ("one and a half"), before a unit ("half a cup")]
  '1/2': ['a half', 'half a'],
  '1/3': ['a third', 'a third of a'],
  '2/3': ['two-thirds', 'two-thirds of a'],
  '1/4': ['a quarter', 'a quarter of a'],
  '3/4': ['three-quarters', 'three-quarters of a'],
  '1/8': ['an eighth', 'an eighth of a'],
};
const UNICODE_FRACTIONS: Record<string, string> = { '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅛': '1/8' };

const UNITS: [RegExp, string, string][] = [
  [/^(tbsp|tbs|tbsps|tablespoons?)$/i, 'tablespoon', 'tablespoons'],
  [/^(tsp|tsps|teaspoons?)$/i, 'teaspoon', 'teaspoons'],
  [/^(cups?|c)$/i, 'cup', 'cups'],
  [/^(g|grams?)$/i, 'gram', 'grams'],
  [/^(kg|kilograms?)$/i, 'kilogram', 'kilograms'],
  [/^(ml|milliliters?|millilitres?)$/i, 'milliliter', 'milliliters'],
  [/^(l|liters?|litres?)$/i, 'liter', 'liters'],
  [/^(oz|ounces?)$/i, 'ounce', 'ounces'],
  [/^(lb|lbs|pounds?)$/i, 'pound', 'pounds'],
  [/^(in|inch|inches|")$/i, 'inch', 'inches'],
  [/^(cm|centimeters?|centimetres?)$/i, 'centimeter', 'centimeters'],
  [/^(mm|millimeters?)$/i, 'millimeter', 'millimeters'],
  [/^(min|mins|minutes?)$/i, 'minute', 'minutes'],
  [/^(hr|hrs|hours?)$/i, 'hour', 'hours'],
  [/^(sec|secs|seconds?)$/i, 'second', 'seconds'],
  [/^(qt|quarts?)$/i, 'quart', 'quarts'],
];
const UNIT = String.raw`(tbsps?|tbs|tablespoons?|tsps?|teaspoons?|cups?|c|g|grams?|kg|kilograms?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|ounces?|lbs?|pounds?|in|inch(?:es)?|"|cm|centimet(?:er|re)s?|mm|millimeters?|min|mins|minutes?|hrs?|hours?|secs?|seconds?|qt|quarts?)(?![a-z])`;
const unitOf = (u: string) => UNITS.find(([re]) => re.test(u));
/** "an inch", "a cup": the article before a unit. */
const article = (word: string) => (/^[aeiou]/i.test(word) && !/^(one|u[^n])/i.test(word) ? 'an' : 'a');

const say = (n: string) => (n.includes('.') ? decimalWords(n) : (numberWord(Number(n)) ?? n));

/** Written recipe text made speakable: numbers, fractions, units, temperatures and symbols said in words. */
export function speakable(text: string): string {
  let t = text.replace(/[½⅓⅔¼¾⅛]/g, (f, i, all) => (/\d/.test(all[i - 1] ?? '') ? ' ' : '') + UNICODE_FRACTIONS[f]);
  // "2,000" → "2000"; "1:30" on a timer → "1 minute 30 seconds".
  t = t.replace(/(\d),(?=\d{3}\b)/g, '$1');
  t = t.replace(/\b(\d{1,2}):([0-5]\d)\b/g, (_, m, s) => `${m} minute${m === '1' ? '' : 's'}${s === '00' ? '' : ` ${Number(s)} seconds`}`);
  // Temperatures: "160°F / 71°C" → "160 degrees Fahrenheit" (one scale is enough out loud).
  t = t.replace(/(\d+)\s*°\s*([FC])\b(?:\s*(?:\/|or|\()\s*\d+\s*°\s*[FC]\)?)?/g, (_, n, s) => `${n} degrees ${s === 'F' ? 'Fahrenheit' : 'Celsius'}`);
  t = t.replace(/°/g, ' degrees');
  // "1 1/2 cups" → "one and a half cups"
  t = t.replace(new RegExp(String.raw`\b(\d+)\s+(1/2|1/3|2/3|1/4|3/4|1/8)(?:\s*${UNIT})?`, 'gi'), (_, whole, f, u) => {
    const unit = u && unitOf(u);
    return `${say(whole)} and ${FRACTIONS[f][0]}${unit ? ` ${unit[2]}` : ''}`;
  });
  // "3/4 inch" → "three-quarters of an inch", "1/2 cup" → "half a cup", "1/4" → "a quarter"
  t = t.replace(new RegExp(String.raw`\b(1/2|1/3|2/3|1/4|3/4|1/8)(?:\s*${UNIT})?`, 'gi'), (_, f, u) => {
    const unit = u && unitOf(u);
    if (!unit) return FRACTIONS[f][0];
    return `${FRACTIONS[f][1].replace(/ a$/, ` ${article(unit[1])}`)} ${unit[1]}`;
  });
  // Ranges: "3-4 minutes" → "three to four minutes"
  t = t.replace(new RegExp(String.raw`\b(\d+)\s*(?:-|–|to)\s*(\d+)(?:\s*${UNIT})?`, 'gi'), (_, a, b, u) => {
    const unit = u && unitOf(u);
    return `${say(a)} to ${say(b)}${unit ? ` ${unit[2]}` : ''}`;
  });
  // "a 10-inch skillet" → "a ten-inch skillet"; "2 minutes" → "two minutes"; "1 tbsp" → "one tablespoon"
  t = t.replace(new RegExp(String.raw`\b(\d+(?:\.\d+)?)(\s*-\s*|\s*)${UNIT}`, 'gi'), (_, n, gap, u) => {
    const unit = unitOf(u)!;
    if (gap.includes('-')) return `${say(n)}-${unit[1]}`;
    // "half a teaspoon", "a quarter of a cup", "zero point two grams"
    if (Number(n) < 1) {
      const w = say(n);
      if (w === 'a half') return `half ${article(unit[1])} ${unit[1]}`;
      if (!/point/.test(w)) return `${w} of ${article(unit[1])} ${unit[1]}`;
      return `${w} ${unit[2]}`;
    }
    return `${say(n)} ${Number(n) === 1 ? unit[1] : unit[2]}`;
  });
  // Every number left, decimals included, in words.
  // (A full stop after a number ends the sentence: "Serves 4." is a whole number.)
  t = t.replace(/(?<![\d.])(\d+\.\d+)(?!\.?\d)/g, (n) => decimalWords(n));
  t = t.replace(/(?<!\d|\d\.)(\d+)(?!\.?\d)/g, (n) => say(n));
  t = t
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\bw\/\s*/gi, 'with ')
    .replace(/\be\.g\.,?\s*/gi, 'for example ')
    .replace(/\bapprox\.?\s*/gi, 'about ')
    .replace(/\s*\+\s*/g, ' plus ')
    .replace(/\s{2,}/g, ' ');
  return t.trim();
}

const sentences = (t: string) => t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter(Boolean);
const lowerFirst = (t: string) => (/^[A-Z][a-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const upperFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const withStop = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
const STOP = new Set('the a an and or of to in on with for your into onto over from until then it its this that each all some'.split(' '));
const content = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ing|ed|es|s)$/, '');

/** Safety or doneness notes are worth saying; serving ideas and nice-to-knows are not. */
const SAFETY = /\b(safe|°|degrees|internal|undercook\w*|raw|careful|hot oil|burn\w*|splatter\w*|spatter\w*|steam|sharp|pink|never|don't|do not|avoid)\b/i;
/** A sentence that carries a time, a temperature or a warning stays even when the rest is trimmed. */
const CRITICAL = /\d|[½⅓⅔¼¾⅛]|\b(minutes?|seconds?|hours?|until|degrees|safe|careful|hot|raw|don't|never|avoid|immediately)\b/i;

/**
 * The step as a chef would say it, without a transition: the title when it
 * adds something the instruction doesn't say, then the instruction, trimmed
 * of extra detail but keeping times, temperatures and warnings.
 */
export function plainStepLine(step: RecipeStep): string {
  let body = sentences(step.text.trim());
  if (body.length > 3) body = body.filter((s, i) => i < 2 || CRITICAL.test(s)).slice(0, 4);
  const parts = body.map(withStop);
  if (step.tip && SAFETY.test(step.tip)) parts.push(withStop(step.tip));
  return withTitle(step, speakable(parts.join(' ')));
}

/**
 * The title goes first when it says something the line doesn't ("Shape the
 * patties. Divide the beef…"), and is left out when it would only repeat it
 * ("Smash and sear" before "Smash each ball flat…"). Used for the model's
 * lines too, so every step is introduced the same way.
 */
export function withTitle(step: RecipeStep, line: string): string {
  const title = step.title.trim().replace(/[.:]$/, '');
  const titleWords = content(title);
  const lineWords = new Set(content(line).map(stem));
  const covered = titleWords.filter((w) => lineWords.has(stem(w))).length;
  const sameStart = stem(titleWords[0] ?? '') === stem(content(line)[0] ?? '');
  return title && !sameStart && covered < Math.ceil(titleWords.length * 0.6) ? `${withStop(title)} ${line}` : line;
}

const NOT_A_VERB = /^(the|a|an|in|on|for|while|meanwhile|when|once|if|to|with|your|this|that|all|each|both|some|after|before|as|at|by|from|into|it|its|let|make sure|\d)/i;
/** "shape" → "shaping", "stir" → "stirring", "tie" → "tying". */
function gerund(verb: string): string {
  const w = verb.toLowerCase();
  if (w.endsWith('ie')) return `${w.slice(0, -2)}ying`;
  if (/(ee|ye|oe)$/.test(w)) return `${w}ing`;
  if (/[^aeiou]e$/.test(w)) return `${w.slice(0, -1)}ing`;
  if (/^[^aeiou]*[aeiou][bdgmnprt]$/.test(w)) return `${w}${w.slice(-1)}ing`;
  return `${w}ing`;
}

/** "Shape the patties. …" → "Start by shaping the patties. …", when it reads naturally. */
function startBy(line: string): string | null {
  const [first, ...rest] = sentences(line);
  const words = first.replace(/[.!?]$/, '').split(' ');
  // "Start by starting the stew" doesn't read well either.
  if (NOT_A_VERB.test(first) || !/^[A-Za-z]+$/.test(words[0]) || /^(start|begin)$/i.test(words[0]) || first.includes(',') || words.length > 9) return null;
  // "Smash and sear" both become -ing; "Toast the buns and add…" would not read right, so it isn't tried.
  const and = words.indexOf('and');
  if (and !== -1 && and !== 1) return null;
  const out = [gerund(words[0]), ...words.slice(1)];
  if (and === 1 && words[2]) out[2] = gerund(words[2]);
  return [`Start by ${out.join(' ')}.`, ...rest].join(' ');
}

export type StepArrival = 'start' | 'next' | 'back' | 'repeat' | 'skip' | 'restart';

/**
 * Put a transition in front of a step line, depending on how the cook got
 * here: the first step is introduced, a new step is "Next" or "Now" (or
 * "While that cooks" when a timer is running), going back says so, and a
 * repeat is just the line again.
 */
export function stepSpeech(line: string, at: number, total: number, how: StepArrival, timerRunning = false): string {
  const core = upperFirst(speakable(line.trim()));
  switch (how) {
    case 'repeat':
      return core;
    case 'back':
      return `Back a step. ${core}`;
    case 'restart':
    case 'start':
      return `${how === 'restart' ? 'Back to the beginning. ' : ''}${at === 0 ? (startBy(core) ?? `First, ${lowerFirst(core)}`) : core}`;
    case 'skip':
    case 'next': {
      const skipped = how === 'skip' ? 'Skipped. ' : '';
      if (at === total - 1) return `${skipped}Last one: ${lowerFirst(core)}`;
      if (timerRunning) return `${skipped}While that cooks, ${lowerFirst(core)}`;
      return `${skipped}${at % 2 ? 'Next' : 'Now'}, ${lowerFirst(core)}`;
    }
  }
}

/** "What step am I on?": the stage and step, briefly. */
export function whereWeAre(recipe: Recipe, at: number): string {
  const step = recipe.steps[at];
  if (!step) return `We’ve finished all ${speakable(String(recipe.steps.length))} steps of the ${recipe.title}.`;
  const stage = recipe.stages[stageIndexOf(recipe.stages, step.key)];
  const n = (i: number) => numberWord(i) ?? String(i);
  const title = step.title.replace(/[.:]$/, '');
  const stageName = stage && stage.title.toLowerCase() !== title.toLowerCase() ? `, in the ${stage.title.toLowerCase()} stage` : '';
  return `You’re on step ${n(at + 1)} of ${n(recipe.steps.length)}${stageName}: ${lowerFirst(title)}.`;
}

/** "Tell me more": everything the screen shows for this step. */
export const stepDetail = (step: RecipeStep) => `${withStop(step.title)} ${withStop(step.text)}${step.tip ? ` Tip: ${withStop(step.tip)}` : ''}`;

/** The cache key for a step's spoken line: the same step with different text (after a replan) gets a new line. */
export const lineKey = (step: RecipeStep) => `${step.key}\u0000${step.text}\u0000${step.tip ?? ''}`;

/** Number words and digits in a text, so a model's line can be checked for times or amounts it made up. */
export function numbersIn(text: string): Set<string> {
  const words = speakable(text)
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/s$/, ''));
  const NUMERIC = /^(\d+(\.\d+)?|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|half|third|quarter|eighth|dozen|double|twice|triple)$/;
  return new Set(words.filter((w) => NUMERIC.test(w)));
}
