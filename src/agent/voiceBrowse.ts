// ─────────────────────────────────────────────────────────────
// Choosing what to cook by voice. "I'm craving something Thai",
// "something cheesy", "quick vegetarian dinners", "pad thai", "the second
// one", "let's cook". Turns a spoken request into a search (a SearchSpec),
// runs it against the recipe library with the browse page's own filters,
// and says what was found (agent/discovery.ts). The model can propose a
// search too (services/llm, discover); it goes through the same checks.
// Everything is matched against the recipe library; nothing is invented.
// ─────────────────────────────────────────────────────────────

import { CUISINES, type Cuisine } from '../data/cuisines';
import { DIET_RULE_IDS, EQUIPMENT_IDS } from '../data/rules';
import type { DiscoverIntent } from '../services/modelService';
import { DIET_PATTERNS } from '../services/mock/intentParser';
import type { DietRuleId, Equipment, Profile, Recipe } from '../types';
import { picksLine, resultsLine, selectionIntro } from './discovery';
import { EMPTY_FILTERS, matchesFilters, recommendScore, tasteOf, type Filters } from './kitchen';

/** The recipes the browse page lists for these filters, in the order it shows them. */
export function shownRecipes(recipes: Recipe[], profile: Profile, filters: Filters): Recipe[] {
  const taste = tasteOf(profile, recipes);
  const score = new Map(recipes.map((r) => [r.id, recommendScore(r, profile, taste)]));
  const list = recipes.filter((r) => matchesFilters(r, filters, profile)).sort((a, b) => score.get(b.id)! - score.get(a.id)!);
  // Inside one cuisine, its most popular dishes come first.
  return filters.cuisine ? list.sort((a, b) => b.popularity - a.popularity) : list;
}

/** Top picks for this cook with only their diet rules applied (the browse page's "Picked for you"). */
export const picksFor = (recipes: Recipe[], profile: Profile) => shownRecipes(recipes, profile, { ...EMPTY_FILTERS, diet: profile.hardExclusions }).slice(0, 4);

export type BrowseAction =
  | { kind: 'open'; recipe: Recipe; say: string }
  /** `generic`: nothing specific was asked, so these are just the cook's top picks. */
  | { kind: 'list'; filters: Filters; results: Recipe[]; say: string; generic?: boolean }
  | { kind: 'none'; say: string };

/** A search, from the cook's words or proposed by the model. Checked against the library before use. */
export interface SearchSpec {
  cuisine: string | null;
  /** Words to look for in titles, tags and ingredients ("cheese", "chicken", "spicy"). */
  words: string[];
  maxMinutes: number | null;
  /** Diet rules for this search, on top of the cook's own. */
  diet: DietRuleId[];
  /** Only dishes this equipment can make, when the cook said what they have. */
  equipment: Equipment[] | null;
  /** Narrow what's on screen ("something quicker") instead of starting over. */
  refine: boolean;
  /** How to call the results out loud ("cheesy dishes"), if not built from the search. */
  describe?: string;
  /** Asked for something in particular, even if the library has nothing like it. */
  asked: boolean;
}

const LEAD_IN =
  /^(?:(?:so|well|um|uh|okay|ok|hmm|yeah|and|maybe)\s+)*(?:i(?:'m| am) (?:craving|in the mood for|thinking|hungry for)|i (?:want|wanna|feel like|would like|'d like|'d love|fancy|need)(?: to (?:eat|make|cook|have|try))?(?: eating| having| making| cooking)?|let's (?:make|cook|have|do|try)|can (?:we|i|you) (?:make|cook|have|find|show me|do)|(?:show|find|give|get) me|how about|what about|do you have|is there|are there|any|suggest)\s+/;
const FILLER = new Set(
  'a an the some something anything any of for with and or me us to tonight today dinner lunch breakfast supper recipe recipes dish dishes food foods meal meals please maybe like really kind sort that this is it good nice tasty delicious one ones idea ideas make cook eat have want try more other else different style kinds type types'.split(
    ' ',
  ),
);
/** Everyday words that aren't a request for anything in particular. */
const COMMON = new Set(
  'what should could would can will shall do does did need get got feel hungry about how which where who why when just also too very much many lot bit little thing things great best new old you your our my we lets let us there here now then up out over hey hi hello right okay yes not mood only without'.split(' '),
);
const QUICK = /\b(quick|quicker|quickly|fast|faster|easy|easier|simple|weeknight|in a hurry|no time)\b/;
const REFINE = /\b(quicker|faster|easier|lighter|simpler|of (those|these|them)|any (of )?(those|these|them)|which (ones?|of)|ones|instead|narrow|just the)\b/;
/** "Something cheesy" is looked up as cheese; the reply still says "cheesy". */
const FLAVORS: Record<string, string> = {
  cheesy: 'cheese',
  creamy: 'cream',
  garlicky: 'garlic',
  lemony: 'lemon',
  herby: 'herb',
  buttery: 'butter',
  chocolatey: 'chocolate',
  chocolaty: 'chocolate',
  saucy: 'sauce',
  zesty: 'lime',
  smoky: 'smok',
  crispy: 'crisp',
  meaty: 'beef',
  comforting: 'comfort',
  cozy: 'comfort',
  cosy: 'comfort',
  hearty: 'comfort',
  eggy: 'egg',
  minty: 'mint',
  gingery: 'ginger',
  peanutty: 'peanut',
  coconutty: 'coconut',
};
const EQUIPMENT_WORDS: Record<string, Equipment> = { oven: 'oven', stove: 'stovetop', stovetop: 'stovetop', hob: 'stovetop', microwave: 'microwave', grill: 'grill', blender: 'blender' };

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(?<=[^s])s$/, '');
const wordsOf = (s: string) => clean(s).split(' ').filter(Boolean).map(stem);

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** "The second one", "number five", "the 3rd", "the last one": a position in what was read out (0-based, -1 for the last). */
export function positionIn(raw: string): number | null {
  const q = clean(raw);
  if (q.split(' ').length > 7) return null;
  if (/\b(last one|the last)\b/.test(q)) return -1;
  const ord = ORDINAL_WORDS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(q));
  if (ord >= 0) return ord;
  const nth = q.match(/\b(\d{1,2})(?:st|nd|rd|th)\b/);
  if (nth) return Number(nth[1]) - 1;
  const num = q.match(/\b(?:number|no|option)\s+(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  if (num) return (/^\d+$/.test(num[1]) ? Number(num[1]) : NUMBER_WORDS.indexOf(num[1]) + 1) - 1;
  if (/^(?:the )?top one$/.test(q)) return 0;
  return null;
}

function cuisineIn(q: string): Cuisine | null {
  return CUISINES.find((c) => new RegExp(`\\b${c.name.toLowerCase()}\\b`).test(q)) ?? null;
}

/** A recipe named in the request: all of its title's words, or most of a longer title, and no tie. */
export function recipeNamed(q: string, recipes: Recipe[]): Recipe | null {
  const asked = new Set(wordsOf(q));
  let best: { r: Recipe; hits: number; score: number }[] = [];
  for (const r of recipes) {
    const title = wordsOf(r.title).filter((w) => w.length > 2 && !FILLER.has(w));
    if (!title.length) continue;
    const hits = title.filter((w) => asked.has(w)).length;
    const score = hits / title.length;
    if (score === 1 || (hits >= 2 && score >= 0.6)) best.push({ r, hits, score });
  }
  best = best.sort((a, b) => b.score - a.score || b.hits - a.hits);
  if (!best.length) return null;
  const [top, next] = best;
  return next && next.score === top.score && next.hits === top.hits ? null : top.r;
}

// Names only, not the prose: "what should I make" must not match a description that says "should".
const haystack = (r: Recipe) => `${r.title} ${r.chef?.name ?? ''} ${r.tags.join(' ')} ${r.ingredients.map((i) => i.name).join(' ')}`.toLowerCase();

/** The cook's words as a search: cuisine, time, diet, equipment and the words worth looking for. */
export function parseSearch(text: string, profile: Profile): SearchSpec {
  let q = clean(text).replace(LEAD_IN, '');
  const cuisine = cuisineIn(q);
  const under = q.match(/\b(?:under|less than|within|in) (\d+) min/);
  // A time the cook gives is used as said; "quick" means half an hour.
  const maxMinutes = under ? Number(under[1]) : QUICK.test(q) ? 30 : null;
  const diet = DIET_PATTERNS.filter(([re]) => re.test(q)).map(([, rule]) => rule);
  for (const [re] of DIET_PATTERNS) q = q.replace(new RegExp(re.source, 'g'), ' ');
  // "I only have a microwave", "no oven", "without a stove".
  let equipment: Equipment[] | null = null;
  const only = q.match(/\bonly (?:have |got )?(?:an? |the |my )?(oven|stove|stovetop|hob|microwave|grill|blender)\b/);
  const without = [...q.matchAll(/\b(?:no|without(?: an?| the| my)?|don'?t have(?: an?| the)?|can'?t use(?: the| my)?)\s+(oven|stove|stovetop|hob|microwave|grill|blender)\b/g)].map((m) => EQUIPMENT_WORDS[m[1]]);
  if (only) equipment = [EQUIPMENT_WORDS[only[1]]];
  else if (without.length) equipment = (profile.equipment.length ? profile.equipment : EQUIPMENT_IDS).filter((e) => !without.includes(e));
  q = q.replace(/\b(?:only (?:have |got )?|no |without |don'?t have |can'?t use )(?:an? |the |my )?(?:oven|stove|stovetop|hob|microwave|grill|blender)\b/g, ' ');
  const cuisineWords = new Set(cuisine ? wordsOf(cuisine.name) : []);
  const raw = q
    .replace(QUICK, ' ')
    .replace(/\b(?:under|less than|within|in) \d+ min\w*/, ' ')
    .split(' ')
    .filter((w) => w.length > 2 && !FILLER.has(w) && !FILLER.has(stem(w)) && !COMMON.has(w) && !cuisineWords.has(stem(w)) && !/^\d+$/.test(w));
  const flavors = raw.filter((w) => FLAVORS[w]);
  const words = raw.map((w) => FLAVORS[w] ?? stem(w));
  const describe = flavors.length && flavors.length === raw.length && !cuisine ? `${flavors.join(' ')} dishes` : undefined;
  // "Something quicker", "any vegetarian ones?", "which of those…": narrow what's on screen. Anything else is a new search.
  const refine = REFINE.test(clean(text));
  return { cuisine: cuisine?.id ?? null, words, maxMinutes, diet, equipment, refine, describe, asked: raw.length > 0 };
}

/**
 * The model's proposed search, checked: only known cuisines, diets and
 * equipment, and diets or equipment the cook clearly said ("without meat",
 * "no oven") always count, whatever the model made of them.
 */
export function modelSearch(text: string, s: NonNullable<DiscoverIntent['search']>, profile: Profile): SearchSpec {
  const own = parseSearch(text, profile);
  const equipment = s.equipment ? s.equipment.filter((e): e is Equipment => EQUIPMENT_IDS.includes(e as Equipment)) : null;
  // What the cook said a dish should NOT have is never searched for ("I don't have butter", "no onions").
  const negated = new Set(
    [...clean(text).matchAll(/\b(?:don'?t|do not|didn'?t|doesn'?t|no|not|without|never|out of|allergic to)\s+(?:have\s+|want\s+|like\s+|eat\s+|any\s+|the\s+|some\s+)*([a-z]+)(?:\s+([a-z]+))?/g)].flatMap((m) => [m[1], m[2]].filter(Boolean).map(stem)),
  );
  return {
    cuisine: s.cuisine && CUISINES.some((c) => c.id === s.cuisine) ? s.cuisine : own.cuisine,
    words: s.keywords.filter((w) => /^[a-z][a-z -]*$/.test(w) && !negated.has(stem(w)) && !/^(meat|meatless|vegetarian|vegan|gluten|dairy|oven|stove|stovetop|microwave)$/.test(w)),
    maxMinutes: s.maxMinutes ?? own.maxMinutes,
    diet: [...new Set([...s.diet.filter((d): d is DietRuleId => DIET_RULE_IDS.includes(d as DietRuleId)), ...own.diet])],
    equipment: own.equipment ?? (equipment?.length ? equipment : null),
    refine: s.refine || own.refine,
    describe: s.describe ?? undefined,
    asked: s.keywords.length > 0,
  };
}

const DESCRIBE_OK = /^[a-z][a-z' -]{2,40}$/;
/** "stovetop mexican dishes" → "stovetop Mexican dishes". */
const properNames = (t: string) => CUISINES.reduce((s, c) => s.replace(new RegExp(`\\b${c.name}\\b`, 'gi'), c.name), t);

/**
 * Run a search the way the browse page would, and say what it found. Words
 * no recipe has are dropped ("spicy chicken please" → chicken, plus spicy if
 * a recipe says so); if all of them together find nothing, the one that
 * finds the most is used. One result opens it.
 */
export function runSearch(spec: SearchSpec, recipes: Recipe[], profile: Profile, current: Filters): BrowseAction {
  const diet = [...new Set([...profile.hardExclusions, ...spec.diet])];
  const base: Filters = { ...EMPTY_FILTERS, diet, equipment: spec.equipment };
  const cuisine = spec.cuisine && CUISINES.some((c) => c.id === spec.cuisine) ? spec.cuisine : null;
  const pool = recipes.filter((r) => matchesFilters(r, { ...base, cuisine }, profile)).map(haystack);
  // "cheesy" is looked up as cheese, "noodles" as noodle; `said` keeps the cook's own word for each.
  const said = new Map<string, string>();
  for (const w of spec.words.map((x) => x.toLowerCase().trim())) {
    if (w.length > 2 && !FILLER.has(w) && !COMMON.has(w) && !said.has(FLAVORS[w] ?? stem(w))) said.set(FLAVORS[w] ?? stem(w), w);
  }
  const asked = [...said.keys()];
  const known = asked.filter((w) => pool.some((h) => h.includes(w)));
  /** Asked for, but no recipe that fits has it: said out loud, never glossed over. */
  const dropped = asked.filter((w) => !known.includes(w));
  const narrowed = spec.diet.length > 0 || !!spec.equipment;

  if (!cuisine && !known.length && !spec.maxMinutes && !narrowed && !spec.refine) {
    // Nothing specific ("what should I make tonight?"): this cook's top picks, saying so if they asked for something we don't have.
    const picks = picksFor(recipes, profile);
    if (!picks.length) return { kind: 'none', say: 'Tell me a cuisine, like Thai, or an ingredient, like chicken, and I’ll find something.' };
    return { kind: 'list', filters: { ...EMPTY_FILTERS, diet: profile.hardExclusions }, results: picks, generic: true, say: picksLine(picks, spec.asked) };
  }

  // "Something quicker" keeps what's on screen and adds to it.
  const refine = spec.refine;
  const start: Filters = refine ? { ...current, diet: [...new Set([...current.diet, ...diet])], equipment: spec.equipment ?? current.equipment } : { ...base, cuisine };
  let filters: Filters = { ...start, cuisine: refine ? (cuisine ?? current.cuisine) : cuisine, maxMinutes: spec.maxMinutes ?? start.maxMinutes, search: known.length ? known.join(' ') : refine ? current.search : '' };
  let results = shownRecipes(recipes, profile, filters);
  // Narrowing what's on screen found nothing: search the whole library instead.
  if (!results.length && refine) {
    const fresh = runSearch({ ...spec, refine: false }, recipes, profile, EMPTY_FILTERS);
    if (fresh.kind !== 'none') return fresh;
  }
  if (!results.length && known.length > 1) {
    const one = known.map((w) => ({ w, n: shownRecipes(recipes, profile, { ...filters, search: w }).length })).sort((a, b) => b.n - a.n)[0];
    if (one.n) {
      filters = { ...filters, search: one.w };
      results = shownRecipes(recipes, profile, filters);
    }
  }
  if (!results.length) return { kind: 'none', say: 'I don’t have anything like that yet. Try a cuisine, like Thai, or an ingredient, like chicken.' };
  if (results.length === 1) return { kind: 'open', recipe: results[0], say: selectionIntro(results[0], 'only') };

  // "cheesy dishes", "quick vegetarian Thai dishes with chicken, ready in 30 minutes or less"
  const isIngredient = (w: string) => results.some((r) => r.ingredients.some((i) => i.name.toLowerCase().includes(w)));
  const searched = filters.search.split(' ').filter(Boolean);
  const described = searched.filter((w) => !isIngredient(w));
  const cuisineName = filters.cuisine ? (CUISINES.find((c) => c.id === filters.cuisine)?.name ?? '') : '';
  // The model's name for the results only when the search really used every word it asked for.
  const searchedAll = asked.length > 0 && asked.every((w) => filters.search.split(' ').includes(w));
  const label = spec.describe && searchedAll && DESCRIBE_OK.test(spec.describe) && spec.describe.split(' ').length <= 5 ? properNames(spec.describe) : null;
  const what = label ?? [filters.maxMinutes ? 'quick' : '', ...filters.diet.filter((d) => !profile.hardExclusions.includes(d)), ...described, cuisineName, 'dishes'].filter(Boolean).join(' ');
  const forWhat = !label && searched.length > described.length ? ` with ${searched.filter(isIngredient).join(' and ')}` : '';
  const within = filters.maxMinutes ? `, ready in ${filters.maxMinutes} minutes or less` : '';
  // Say the most fitting ones by name ("cheesy": the ones with cheese in the title); the screen keeps its order.
  const inTitle = (r: Recipe) => searched.some((w) => r.title.toLowerCase().includes(w));
  const examples = [...results.filter(inTitle), ...results.filter((r) => !inTitle(r))];
  const found = resultsLine(results, `${what}${forWhat}${within}`, examples);
  const missed = dropped.length || (asked.length && !searchedAll) ? asked.filter((w) => !filters.search.split(' ').includes(w)) : [];
  const say = missed.length ? `Nothing I have matches “${missed.map((w) => said.get(w) ?? w).join('” or “')}”. ${found}` : found;
  return { kind: 'list', filters, results, say };
}

/**
 * What to show for a spoken request on the browse page, without a model.
 * `listed` is what's on screen, so "the second one" can be opened.
 */
export function browseByVoice(text: string, recipes: Recipe[], profile: Profile, current: Filters, listed: Recipe[]): BrowseAction {
  const raw = clean(text);
  const base: Filters = { ...EMPTY_FILTERS, diet: profile.hardExclusions };

  // "The second one", "number five".
  const at = listed.length ? positionIn(raw) : null;
  if (at !== null) {
    const recipe = at < 0 ? listed[listed.length - 1] : listed[at];
    if (recipe) return { kind: 'open', recipe, say: selectionIntro(recipe) };
    return { kind: 'none', say: `There are only ${listed.length} on the list. Which one would you like?` };
  }

  // A dish by name: "pad thai", "let's make the chicken tinga".
  const named = recipeNamed(raw.replace(LEAD_IN, ''), recipes.filter((r) => matchesFilters(r, base, profile)));
  if (named) return { kind: 'open', recipe: named, say: selectionIntro(named) };

  const spec = parseSearch(text, profile);
  // "Something quicker" with nothing else: narrow what's on screen.
  if (!spec.cuisine && !spec.words.length && /\b(quicker|faster|easier)\b/.test(raw)) spec.refine = true;
  return runSearch(spec, recipes, profile, current);
}

/** What a phrase means while a recipe preview is open, if it's about the preview. */
export function previewCommand(text: string): 'cook' | 'close' | null {
  const q = clean(text);
  if (/^(no|nope|nah|not (that|this)|never ?mind|cancel)\b|\b(close( it| this)?|go back|back to (the )?(recipes|list)|something else|other options|show me (something|others))\b/.test(q)) return 'close';
  if (/\b(let's (cook|go|do (it|this)|make (it|this|that)|start)|start(ing)? (cooking|it|this)|cook (it|this|that)|i'll (make|cook) (it|this|that)|begin|yes|yeah|yep|sounds good|that one|perfect)\b/.test(q)) return 'cook';
  return null;
}
