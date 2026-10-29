// ─────────────────────────────────────────────────────────────
// "Interpreted as…": how Gusteau understood a spoken sentence.
//
// The transcript on screen is never rewritten. When the model reads a
// sentence differently ("how long do I sear the stakes" → steaks), its
// reading is shown as a separate line, but only if it changes the meaning.
// A reading that flips a negation, an amount, a time, a temperature, an
// allergy or a diet is never acted on: Gusteau asks instead.
// ─────────────────────────────────────────────────────────────

import { numbersIn, speakable } from './stepSpeech';

// Numbers as words, so "15" and "fifteen" read the same.
const words = (t: string) =>
  speakable(t)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'°\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(um|uh|er|hmm|like|so|okay|ok|hey|chef|gusteau|please|thanks|thank|you|well|oh|and|then)$/.test(w));

/** True when the reading says something different, not just different punctuation, case or filler words. */
export function changesMeaning(said: string, heard: string): boolean {
  return words(said).join(' ') !== words(heard).join(' ');
}

const NEGATION = /^(not|no|never|none|nothing|without|don't|dont|doesn't|didn't|can't|cannot|won't|isn't|aren't|wasn't|shouldn't|mustn't|n't)$/;
// Allergies, diets, and the units that make an amount, time or temperature.
const SENSITIVE =
  /^(allerg\w*|intoleran\w*|anaphyla\w*|celiac|coeliac|vegan|vegetarian|pescatarian|kosher|halal|gluten\w*|dairy|lactose|nuts?|peanuts?|tree|shellfish|sesame|soy|eggs?|fish|pork|beef|alcohol|degrees?|°|fahrenheit|celsius|minutes?|mins?|seconds?|secs?|hours?|hrs?|cups?|tablespoons?|tbsp|teaspoons?|tsp|grams?|g|kg|ounces?|oz|pounds?|lbs?|ml|liters?|litres?|servings?|people|half|double|twice|triple)$/;

const pick = (t: string, re: RegExp) => words(t).filter((w) => re.test(w)).map((w) => w.replace(/s$/, '')).sort().join(' ');
const sameSet = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * Why a reading can't be trusted without asking, or null. Negations,
 * numbers, allergies, diets, times, temperatures and amounts must come
 * through exactly as the cook said them.
 */
export function riskyReading(said: string, heard: string): 'negation' | 'number' | 'safety' | null {
  if (pick(said, NEGATION) !== pick(heard, NEGATION)) return 'negation';
  if (!sameSet(numbersIn(said), numbersIn(heard))) return 'number';
  if (pick(said, SENSITIVE) !== pick(heard, SENSITIVE)) return 'safety';
  return null;
}

// Number words that speech recognition writes as other words: "add for tablespoons" (four? for?).
const SOUNDS_LIKE_NUMBER: Record<string, string> = { for: 'four', fore: 'four', to: 'two', too: 'two', won: 'one', ate: 'eight', tree: 'three', fife: 'five', sicks: 'six', tin: 'ten', tan: 'ten' };
// Units of measure and time only: "what can I use for eggs" isn't an amount.
const AMOUNT_UNIT = /^(cups?|tablespoons?|teaspoons?|tbsps?|tsps?|grams?|kilos?|ounces?|oz|pounds?|lbs?|ml|liters?|litres?|minutes?|mins?|seconds?|secs?|hours?|degrees|pinch(es)?)$/;

/**
 * "Add for tablespoons of butter": an amount that may have been misheard.
 * Asked about before anything happens (a model will happily guess "two").
 */
export function ambiguousAmount(text: string): string | null {
  const w = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  for (let i = 0; i < w.length - 1; i++) {
    const guess = SOUNDS_LIKE_NUMBER[w[i]];
    // "for two minutes" and "add salt to taste" are fine: only a sound-alike right before a unit.
    if (guess && AMOUNT_UNIT.test(w[i + 1]) && !/^\d|^(one|two|three|four|five|six|seven|eight|nine|ten|a|an|half)$/.test(w[i - 1] ?? '')) {
      return `Just to check: did you say ${guess} ${w[i + 1]}? I want to get the amount right.`;
    }
  }
  return null;
}

/** What Gusteau asks when a reading would change something that matters. */
export const checkFirst = (heard: string) => `Just to check, did you mean “${heard.replace(/[.?!]+$/, '')}”? I don’t want to get that wrong.`;

/**
 * While the model's JSON streams in: its `heard_as` field once it's complete
 * (a string, or null when it read the sentence as said), or undefined until then.
 */
export function partialHeardAs(json: string): string | null | undefined {
  const m = /"heard_as"\s*:\s*(null|"((?:[^"\\]|\\.)*)")/.exec(json);
  if (!m) return undefined;
  if (m[1] === 'null') return null;
  try {
    return JSON.parse(`"${m[2]}"`) as string;
  } catch {
    return undefined;
  }
}
