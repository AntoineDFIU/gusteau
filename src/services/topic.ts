// ─────────────────────────────────────────────────────────────
// Gusteau only talks about food and cooking. The live model is told so
// (and flags off-topic messages itself); this is the local check used
// where no model decides: Wikipedia lookups, "how do I…" video searches
// and the offline parser.
// ─────────────────────────────────────────────────────────────

import type { CookSession } from '../types';

/** Words that place a text in the kitchen. */
export const COOKING_WORDS =
  /\b(food|foods|cook\w*|cuisines?|culinary|kitchens?|dish(es)?|ingredients?|recipes?|spices?|herbs?|seasonings?|condiments?|sauces?|vegetables?|veg|fruits?|meats?|poultry|chicken|beef|pork|lamb|fish|seafood|shellfish|molluscs?|mollusks?|crustaceans?|eggs?|cheeses?|dairy|milk|butter|cream|grains?|rice|pasta|noodles?|flour|dough|bread|bak(e|ed|ing)|fr(y|ied|ying)|roast\w*|grill\w*|boil(s|ed|ing)?|simmer\w*|steam(s|ed|ing|er)?|poach(ed|ing)?|sear(s|ed|ing)?|saut[eé]\w*|braise\w*|stews?|stew(ed|ing)|soups?|brown(ing|ed)?|caramel\w*|deglaze\w*|marinat\w*|knead\w*|whisk\w*|stir(s|red|ring)?|fold(ing)?|chop(s|ped|ping)?|dic(e|ed|ing)|minc(e|ed|ing)|julienne|peel\w*|zest\w*|grat(e|ed|er|ing)|slic(e|ed|er|ing)|fillet\w*|debone|butcher\w*|blanch(ed|ing)?|reduc(e|tion)|emulsi\w*|thicken\w*|temper(ing)?|proofing|ferment\w*|pickl\w*|utensils?|cookware|knife|knives|cutting board|pans?|pots?|skillet|wok|ovens?|stoves?|stovetop|hob|microwave|blender|mixer|whisk|spatula|ladle|tongs|eat(en|ing)?|edible|flavou?rs?\w*|tastes?|salty|spicy|sweet|sour|bitter|drinks?|beverages?|wines?|beers?|cocktails?|juices?|coffee|tea|pair(s|ing|ed)?( well)? with|oils?|vinegar|salt|sugars?|legumes?|beans?|peppers?|garlic|onions?|tomato(es)?|snacks?|meals?|breakfast|lunch|dinner|dessert|chefs?|servings?|portions?|leftovers?|nutrition|calories|protein|vegan|vegetarian|gluten|allerg\w*)\b/i;

/** True when a message is about food or cooking: kitchen words, or anything in the recipe being cooked. */
export function culinary(text: string, session?: CookSession | null): boolean {
  if (COOKING_WORDS.test(text)) return true;
  if (!session) return false;
  const t = text.toLowerCase();
  const names = [
    ...session.recipe.ingredients.map((i) => i.name),
    ...session.pantry.map((p) => p.name),
    ...session.rules.equipment,
    ...session.recipe.steps.map((s) => s.title),
    session.recipe.title,
  ];
  // Any meaningful word of an ingredient, tool or step name ("the cotija", "the comal").
  return names.some((n) => n.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 3 && new RegExp(`\\b${w}s?\\b`).test(t)));
}

/** What Gusteau says to anything that isn't about cooking. */
export const offTopicReply = (recipe?: string) =>
  `I’m only here for cooking, so I’ll leave that one alone.${recipe ? ` Ask me anything about your ${recipe}: ingredients, swaps, techniques or timing.` : ''}`;

/**
 * Words speech recognition writes for kitchen things that sound the same. Only
 * applied to the name of something the cook asked to see or have explained,
 * so "show me a leak" is the vegetable, never a leak.
 */
const SOUNDS_LIKE: Record<string, string> = {
  leak: 'leek', leaks: 'leeks', time: 'thyme', flower: 'flour', moose: 'mousse', muscle: 'mussel', muscles: 'mussels',
  current: 'currant', currants: 'currants', currents: 'currants', serial: 'cereal', colonel: 'kernel', colonels: 'kernels',
  beats: 'beets', chilly: 'chili', chillies: 'chilies', walk: 'wok', greater: 'grater', peal: 'peel', stake: 'steak',
  stakes: 'steaks', bury: 'berry', lyme: 'lime', plumb: 'plum', pi: 'pie', nan: 'naan', bree: 'brie', guda: 'gouda', gooda: 'gouda', tarot: 'taro',
  doe: 'dough', bred: 'bread', caret: 'carrot', karat: 'carrot', carat: 'carrot', mustered: 'mustard', pairs: 'pears',
  rue: 'roux',
};

/** A rough sound key: "chedder" and "cheddar" both give "chdr", "flower" and "flour" "flr". */
function soundKey(w: string): string {
  const s = w
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ph/g, 'f')
    .replace(/ck/g, 'k')
    .replace(/c(?=[eiy])/g, 's')
    .replace(/[cq]/g, 'k')
    .replace(/x/g, 'ks')
    .replace(/z/g, 's')
    .replace(/w(?![aeiou])/g, '')
    .replace(/(.)\1+/g, '$1');
  return s.charAt(0) + s.slice(1).replace(/[aeiouy]/g, '');
}

/**
 * The word in `vocabulary` (the recipe's own ingredient words) that a heard
 * word most likely was: a known kitchen sound-alike ("flower" → flour) or the
 * same sound key ("chedder" → cheddar). Null when nothing is close enough;
 * the caller asks rather than guesses.
 */
export function soundsLikeIn(heard: string, vocabulary: string[]): string | null {
  const w = heard.toLowerCase();
  if (vocabulary.includes(w)) return w;
  const known = SOUNDS_LIKE[w];
  if (known && vocabulary.includes(known)) return known;
  const k = soundKey(w);
  if (k.length < 3) return null;
  const hits = [...new Set(vocabulary.filter((v) => Math.abs(v.length - w.length) <= 2 && soundKey(v) === k))];
  return hits.length === 1 ? hits[0] : null;
}

/** The kitchen spelling of a heard name: "leak" → "leek", "fresh time" → "fresh thyme". */
export const kitchenSpelling = (term: string) => term.replace(/[a-z]+/gi, (w) => SOUNDS_LIKE[w.toLowerCase()] ?? w);

/**
 * The message with only the words a lookup respelled ("show me a leak" asked
 * about leek → "show me a leek"), or undefined when nothing was respelled.
 */
export function respelled(message: string, term: string): string | undefined {
  const wanted = new Set(term.toLowerCase().split(/\s+/));
  let changed = false;
  const out = message.replace(/[a-z]+/gi, (w) => {
    const k = SOUNDS_LIKE[w.toLowerCase()];
    if (!k || !wanted.has(k)) return w;
    changed = true;
    return k;
  });
  return changed ? out : undefined;
}
