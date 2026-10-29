// ─────────────────────────────────────────────────────────────
// Finding something to cook, by talking with Gusteau: what he SAYS.
//
// The browse page shows the thumbnails; out loud, Gusteau names one or
// two of them and offers the rest ("Would you like me to read all the
// options?"), reads options and ingredients in small groups that "more"
// continues and "repeat" says again, and introduces the dish you choose.
// Everything he says comes from the recipe data: titles, times, amounts,
// and nutrition only when the recipe database supplies it.
// ─────────────────────────────────────────────────────────────

import { amountOf, type AdaptResult } from './adapt';
import { isEssential } from './kitchen';
import { speakable } from './stepSpeech';
import { grainOf, isStaple, proteinOf, sameIngredient } from '../data/ingredients';
import { soundsLikeIn } from '../services/topic';
import type { Recipe, RecipeIngredient } from '../types';

/** The opening question, on the craving page. */
export const OPENING = 'What are you in the mood for?';

/** How many options or ingredients are read out before Gusteau asks to continue. */
export const GROUP = 4;
const INGREDIENT_GROUP = 6;

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n: number) => NUMBER_WORDS[n] ?? String(n);
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''));

/**
 * What Gusteau says about search results: how many, one or two by name,
 * and how to go on. The thumbnails on screen show the rest.
 */
export function resultsLine(results: Recipe[], what: string, examples: Recipe[] = results): string {
  const names = examples.slice(0, 2).map((r) => r.title);
  if (results.length === 2) return `I found two ${what}: ${and(names)}. Which one would you like?`;
  return `I found ${count(results.length)} ${what}, including ${and(names)}. Would you like me to read all the options, or is there one you’d like?`;
}

/** The cook's top picks, when nothing in particular was asked. */
export function picksLine(picks: Recipe[], nothingLikeThat: boolean): string {
  const lead = nothingLikeThat ? 'I don’t have anything like that yet, but here are a few I’d suggest' : 'Here are a few I’d suggest';
  return `${lead}, like ${and(picks.slice(0, 2).map((r) => r.title))}. Want me to read them all, or tell me a cuisine, an ingredient or how much time you have?`;
}

export interface Reading {
  /** What's being read: recipe options or a recipe's ingredients. */
  kind: 'options' | 'ingredients';
  lines: string[];
  /** How many have been read so far. */
  at: number;
}

/** The next group of a reading, and the reading moved on; "That's all" once it's done. */
export function readNext(r: Reading): { say: string; reading: Reading } {
  const size = r.kind === 'options' ? GROUP : INGREDIENT_GROUP;
  if (r.at >= r.lines.length) {
    return { say: r.kind === 'options' ? 'That’s all of them. Which one would you like?' : 'That’s everything you need.', reading: r };
  }
  const group = r.lines.slice(r.at, r.at + size);
  const at = r.at + group.length;
  const left = r.lines.length - at;
  const first = r.at === 0;
  let say: string;
  if (r.kind === 'options') {
    const opening = first ? (left ? `Here are the first ${count(group.length)}.` : 'Here they are.') : 'Next.';
    const after = left ? ` Say “more” for the next ${count(Math.min(left, size))}, or pick one by name or number.` : ' Which one would you like? Pick one by name or number.';
    say = `${opening} ${group.map((g) => `${g}.`).join(' ')}${after}`;
  } else {
    const opening = first ? 'You’ll need' : 'Then';
    const after = left ? ' Say “more” for the rest.' : first ? '' : ' That’s everything.';
    say = `${opening} ${and(group)}.${after}`;
  }
  return { say: speakable(say), reading: { ...r, at } };
}

/** Options to read aloud, numbered so "number five" can be chosen. */
export const optionsReading = (recipes: Recipe[]): Reading => ({ kind: 'options', lines: recipes.map((r, i) => `${upper(count(i + 1))}, ${r.title}`), at: 0 });
const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** A recipe's ingredients with their amounts, as they're said. */
export const ingredientsReading = (ingredients: RecipeIngredient[]): Reading => ({
  kind: 'ingredients',
  // "one and a half pounds of ground beef", "four burger buns", "half an onion", "lettuce leaves".
  lines: ingredients.map((i) => {
    const name = i.name.toLowerCase();
    const amount = amountOf(i).trim();
    if (!amount || !/^[\d½⅓⅔¼¾⅛]/.test(amount)) return name;
    if (amount === '½') return `half ${/^[aeiou]/.test(name) ? 'an' : 'a'} ${name}`;
    return /^[\d½⅓⅔¼¾⅛.\/\s-]+$/.test(amount) ? `${amount} ${name}` : `${amount} of ${name}`;
  }),
  at: 0,
});

/** The one or two ingredients that define a dish: its protein and grain first, never salt or oil. */
function mainIngredients(r: Recipe): string[] {
  const essentials = r.ingredients.filter((i) => isEssential(i) && !isStaple(i.name));
  // The ones in its name first ("cheese" for mac and cheese), then its protein and grain.
  const title = r.title.toLowerCase();
  const titleWords = new Set(title.split(/[^a-z]+/).map((w) => w.replace(/(?<=[^s])e?s$/, '')));
  const named = essentials.filter((i) => i.name.toLowerCase().split(/\s+/).some((w) => w.length > 3 && titleWords.has(w.replace(/(?<=[^s])e?s$/, ''))));
  const ranked = [...named, ...essentials.filter((i) => proteinOf(i.name)), ...essentials.filter((i) => grainOf(i.name) && !proteinOf(i.name)), ...essentials];
  return [...new Set(ranked.map((i) => i.name.toLowerCase()))].slice(0, 2);
}

/** A nutrition highlight, only from the recipe database's own numbers (Gusteau's estimates don't count). */
function nutritionHighlight(r: Recipe): string | null {
  const n = r.nutrition;
  if (!n) return null;
  if (n.protein >= 25) return 'high in protein';
  if ((n.fiber ?? 0) >= 8) return 'high in fiber';
  if (n.calories > 0 && n.calories <= 450) return `fairly light, at about ${Math.round(n.calories / 10) * 10} calories a serving`;
  return null;
}

/**
 * Gusteau's introduction when a dish is chosen: the time, one or two main
 * ingredients, a nutrition highlight if the data supports one, and an
 * invitation to say what's missing. He doesn't guess what the cook has.
 */
export function selectionIntro(r: Recipe, how: 'chosen' | 'only' = 'chosen'): string {
  // "This chicken burrito bowl takes…", "These chicken tinga tacos take…"
  const name = r.title.replace(/\s*\([^)]*\)/g, '').trim();
  // Plural by its head noun: "Chicken Tinga Tacos" are, "Green Curry with Vegetables" is.
  const head = name.split(/\s+(?:with|in|and|&|e)\s+/i)[0];
  const plural = /[^s]s$/i.test(head) && !/(hummus|couscous|peas)$/i.test(head);
  const lead = how === 'chosen' ? `Great choice. ${plural ? 'These' : 'This'} ${name}` : `I found just one that fits: ${r.title}. ${plural ? 'They' : 'It'}`;
  const verb = (v: 'is' | 'takes') => (plural ? (v === 'is' ? 'are' : 'take') : v);
  const health = nutritionHighlight(r);
  const facts = [health, `${verb('takes')} about ${r.totalMinutes} minutes`].filter(Boolean) as string[];
  const main = mainIngredients(r);
  const more = r.ingredients.filter((i) => !isStaple(i.name)).length > main.length;
  const need = main.length ? ` You’ll need ${and(main)}${more ? ', and a few other ingredients' : ''}.` : '';
  return speakable(`${lead} ${facts.length > 1 ? `${verb('is')} ${facts[0]}, and ${facts[1]}` : facts[0]}.${need} If you’re missing anything, just let me know and I can adjust the recipe. When you’re ready, say “let’s cook”.`);
}

export type DiscoveryCommand = 'read_all' | 'more' | 'repeat' | 'ingredients';

/** Reading-out requests while choosing: "read them all", "more", "say that again", "what do I need?". */
export function discoveryCommand(text: string): DiscoveryCommand | null {
  const t = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[?!.,]/g, '')
    .replace(/^(?:(?:ok|okay|yes|yeah|sure|please|so|and|um|uh)\s+)+/, '')
    .replace(/\s+please$/, '')
    // "Rid them all", "reed them all": how speech recognition sometimes writes "read".
    .replace(/^(rid|reed)\b/, 'read')
    .trim();
  if (/^(read (me )?(all|them all|all of them|all the options|the (whole |full )?list|the options|them)|(all|list) (of )?the options|(all|every) (the )?options|list them( all)?|what are (all )?the options|what (are|were) they|tell me (all )?(the )?options|(yes )?(read|hear) (them|all)( all)?|i'?d like to hear (them|all)( all)?( the options)?|all of them|all)$/.test(t)) return 'read_all';
  // "Moore": how speech recognition sometimes writes "more".
  if (/^(more|moore|mor|next( ones?| few| group)?|continue|keep going|go on|and then|what else|any more|anything else|the rest|more options|read more|tell me more)$/.test(t)) return 'more';
  if (/^(repeat( that| it| them)?|say (that|it|them) again|(can|could) you repeat (that|it|them)|what was that|come again|again|sorry what|pardon|what did you say|one more time)$/.test(t)) return 'repeat';
  if (/^(what do i need|what (are|were) the ingredients|(read|tell me|list|give me) (me )?(all )?the (whole |full )?ingredients?( list)?|(the )?(full |whole )?ingredients?( list)?|what goes (in|into) it|what('s| is) in it|what ingredients( do i need)?)$/.test(t)) return 'ingredients';
  return null;
}

/** "I don't have cilantro or limes", "I'm out of butter": the things named, or null when it isn't about missing something. */
export function missingNames(text: string): string[] | null {
  const t = text.toLowerCase().replace(/[‘’]/g, "'").replace(/[?!.]/g, '');
  const m = t.match(/(?:i\s+)?(?:don'?t|do not|didn'?t)\s+have\s+(?:any\s+|the\s+)?(.+)|(?:i'?m|we'?re|i am)\s+(?:out of|missing)\s+(?:any\s+|the\s+|some\s+)?(.+)|^(?:i\s+)?(?:ran|run) out of\s+(?:the\s+)?(.+)|^(?:no|missing)\s+(.+)/);
  if (!m) return null;
  const names = (m[1] ?? m[2] ?? m[3] ?? m[4])
    .split(/,|\band\b|\bor\b|\beither\b/)
    .map((s) => s.replace(/\b(any|the|some|my|either|anymore|at home|right now|today)\b/g, '').trim())
    .filter(Boolean);
  return names.length ? names : null;
}

/**
 * "I don't have cilantro", "I'm missing the rice", "I'm out of limes": the
 * recipe ingredients named, and anything named that isn't in the recipe.
 * Null when the phrase isn't about missing something.
 */
export function missingIn(text: string, r: Recipe): { found: RecipeIngredient[]; elsewhere: string[]; respelled: [string, string][] } | null {
  const names = missingNames(text);
  if (!names) return null;
  const found: RecipeIngredient[] = [];
  const elsewhere: string[] = [];
  /** Heard words matched to the recipe by sound ("flower" → flour), so the change can be shown. */
  const respelled: [string, string][] = [];
  const vocabulary = [...new Set(r.ingredients.flatMap((i) => i.name.toLowerCase().split(/[^a-z]+/)).filter((w) => w.length > 2))];
  for (const n of names) {
    const one = n.replace(/(?<=[^s])e?s$/, '');
    const hit = r.ingredients.find((i) => sameIngredient(i.name, n) || i.name.toLowerCase().includes(n) || i.name.toLowerCase().split(/\s+/).some((w) => w.replace(/(?<=[^s])e?s$/, '') === one));
    if (hit) {
      if (!found.includes(hit)) found.push(hit);
      continue;
    }
    // Misheard? Match each word against the recipe's own ingredient words by sound.
    const words = n.split(/\s+/);
    const fixed = words.map((w) => soundsLikeIn(w, vocabulary) ?? w);
    const again = fixed.join(' ');
    const sounded = again !== n && r.ingredients.find((i) => i.name.toLowerCase().split(/[^a-z]+/).some((w) => fixed.includes(w)));
    if (sounded) {
      if (!found.includes(sounded)) found.push(sounded);
      respelled.push([n, again]);
    } else elsewhere.push(n);
  }
  return { found, elsewhere, respelled };
}

/** What Gusteau says after the plan was adjusted for something the cook doesn't have. */
export function adjustmentLine(names: string[], plan: AdaptResult): string {
  const parts = names.map((name) => {
    const sub = plan.substitutions.find((s) => sameIngredient(s.from, name) || s.from.toLowerCase() === name.toLowerCase());
    const blocked = plan.blockers.some((b) => sameIngredient(b.name, name) || b.name.toLowerCase() === name.toLowerCase());
    const n = name.toLowerCase();
    if (sub?.kind === 'swap') return `I’ll use ${sub.to.toLowerCase()} instead of ${n}${sub.unsure ? ', if you have it' : ''}`;
    if (sub?.kind === 'drop') return `we’ll leave out the ${n}; the dish works without it`;
    if (blocked) return `${n} is hard to replace here, and I don’t have a swap that fits`;
    return null;
  });
  const said = parts.filter(Boolean) as string[];
  if (!said.length) return 'Got it. I’ve noted that on the recipe.';
  const stuck = plan.blockers.length > 0;
  return `${said.length === 1 && !stuck ? 'No problem. ' : ''}${said.map((s, i) => (i ? s : s.charAt(0).toUpperCase() + s.slice(1))).join('. ')}.${stuck ? ' Tell me what you have instead, or pick another recipe.' : ' The recipe on screen is updated.'}`;
}
