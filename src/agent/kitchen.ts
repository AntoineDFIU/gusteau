import { GRAINS, PROTEINS, grainOf, isGarnish, isSeasoning, isStaple, isVegetable, proteinOf, roundAmount, sameIngredient, tagsFor, type GrainId, type ProteinId } from '../data/ingredients';
import { DIET_RULES, EQUIPMENT, EQUIPMENT_WORDS } from '../data/rules';
import type { CookRules, DietRuleId, DietTag, Difficulty, Equipment, PantryItem, Profile, Recipe, RecipeIngredient, RecipeStep } from '../types';

// ─────────────────────────────────────────────────────────────
// Kitchen logic shared by browsing and cooking: what a recipe
// contains, what the user already has, and which hard rules a
// recipe or ingredient would break.
// ─────────────────────────────────────────────────────────────

export interface RecipeFacts {
  dietTags: DietTag[];
  proteins: ProteinId[];
  grains: GrainId[];
  vegetableCount: number;
}

const factsCache = new WeakMap<Recipe, RecipeFacts>();
export function factsOf(r: Recipe): RecipeFacts {
  let f = factsCache.get(r);
  if (!f) {
    const names = r.ingredients.map((i) => i.name);
    f = {
      dietTags: [...new Set(names.flatMap(tagsFor))],
      proteins: [...new Set(names.map(proteinOf).filter((x): x is ProteinId => !!x))],
      grains: [...new Set(names.map(grainOf).filter((x): x is GrainId => !!x))],
      vegetableCount: names.filter(isVegetable).length,
    };
    factsCache.set(r, f);
  }
  return f;
}

// ── Hard rules ──────────────────────────────────────────────
type RuleSet = Pick<CookRules, 'hardExclusions' | 'allergies'>;

/** The rule an ingredient breaks, or null. */
export function breaksRule(name: string, rules: RuleSet): string | null {
  const tags = tagsFor(name);
  for (const r of rules.hardExclusions) {
    if (tags.some((t) => DIET_RULES[r].blocks.includes(t))) return DIET_RULES[r].label;
  }
  const lower = name.toLowerCase();
  for (const a of rules.allergies) {
    const al = a.toLowerCase().trim();
    if (!al) continue;
    if (lower.includes(al) || sameIngredient(name, a)) return `No ${a}`;
    // Category words in an allergy, e.g. "dairy", "gluten", "shellfish", "tree nuts".
    if (tags.some((t) => al.includes(t))) return `No ${a}`;
  }
  return null;
}

export function ruleConflicts(r: Recipe, rules: RuleSet): { ingredient: string; rule: string }[] {
  return r.ingredients.map((i) => ({ ingredient: i.name, rule: breaksRule(i.name, rules) })).filter((x): x is { ingredient: string; rule: string } => !!x.rule);
}

/** Appliances a step really needs, judged from its words. */
export function stepEquipment(step: Pick<RecipeStep, 'title' | 'text'>): Equipment[] {
  const t = `${step.title} ${step.text}`.toLowerCase().replace(/microwave[- ]safe/g, 'microwave');
  return EQUIPMENT_WORDS.filter(([, re]) => re.test(t)).map(([e]) => e);
}

export function describeRules(rules: CookRules): string[] {
  return [
    ...rules.hardExclusions.map((r) => DIET_RULES[r].label),
    ...rules.allergies.map((a) => `No ${a}`),
    ...(rules.timeLimit ? [`${rules.timeLimit}-minute limit`] : []),
    rules.equipment.length <= 2 ? `${rules.equipment.map((e) => EQUIPMENT[e].label).join(' + ')} only` : `Your ${rules.equipment.length} appliances`,
    `${rules.servings} ${rules.servings === 1 ? 'serving' : 'servings'}`,
    rules.purchasesAllowed ? 'Purchases OK' : 'No purchases',
  ];
}

// ── Pantry ──────────────────────────────────────────────────
export type Availability = 'have' | 'staple' | 'missing' | 'unknown';

export function availability(name: string, pantry: PantryItem[], basics: boolean): Availability {
  if (basics && isStaple(name)) return 'staple';
  if (!pantry.length) return 'unknown';
  return pantry.some((p) => sameIngredient(p.name, name)) ? 'have' : 'missing';
}

/** Ingredients that matter for "can I make this" (staples, garnishes, seasonings and optional extras don't). */
export const isEssential = (i: RecipeIngredient) => !i.optional && !isGarnish(i.name) && !isSeasoning(i.name);

export function pantryMatch(r: Recipe, pantry: PantryItem[], basics: boolean): { have: number; need: number; missing: string[] } {
  const essentials = r.ingredients.filter((i) => isEssential(i) && !(basics && isStaple(i.name)));
  const missing = essentials.filter((i) => availability(i.name, pantry, basics) === 'missing').map((i) => i.name);
  return { have: essentials.length - missing.length, need: essentials.length, missing };
}

// ── Scaling and time ────────────────────────────────────────
export function scaleRecipe(r: Recipe, servings: number): Recipe {
  if (servings === r.servings) return r;
  const f = servings / r.servings;
  return {
    ...r,
    servings,
    ingredients: r.ingredients.map((i) => (i.amount === null ? i : { ...i, amount: roundAmount(i.amount * f, i.unit) })),
    // Bigger batches take a little longer to prep; cooking times mostly don't change.
    totalMinutes: Math.round(r.totalMinutes * (f > 1 ? 1 + (f - 1) * 0.15 : 1)),
  };
}

export function remainingMinutes(r: Recipe, completed: string[]): number {
  return Math.round(r.steps.filter((s) => !completed.includes(s.key)).reduce((sum, s) => sum + (s.minutes ?? 0), 0));
}

// ── Browse filters ──────────────────────────────────────────
export interface Filters {
  cuisine: string | null;
  search: string;
  diet: DietRuleId[];
  proteins: ProteinId[];
  grains: GrainId[];
  vegForward: boolean;
  maxMinutes: number | null;
  difficulty: Difficulty[];
  equipment: Equipment[] | null;
  /** Only dishes missing at most this many essentials from the pantry. */
  pantryOnly: boolean;
}

export const EMPTY_FILTERS: Filters = {
  cuisine: null,
  search: '',
  diet: [],
  proteins: [],
  grains: [],
  vegForward: false,
  maxMinutes: null,
  difficulty: [],
  equipment: null,
  pantryOnly: false,
};

export const MAX_MISSING_FOR_PANTRY = 2;

export function matchesFilters(r: Recipe, f: Filters, profile: Profile): boolean {
  const facts = factsOf(r);
  if (f.cuisine && r.cuisine !== f.cuisine) return false;
  if (f.search) {
    const q = f.search.toLowerCase();
    const hay = `${r.title} ${r.description} ${r.chef?.name ?? ''} ${r.tags.join(' ')} ${r.ingredients.map((i) => i.name).join(' ')}`.toLowerCase();
    if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  // Diet filters are hard: a recipe that would need a swap is hidden while browsing.
  if (f.diet.length && ruleConflicts(r, { hardExclusions: f.diet, allergies: [] }).length) return false;
  if (f.proteins.length && !f.proteins.some((p) => facts.proteins.includes(p))) return false;
  if (f.grains.length && !f.grains.some((g) => facts.grains.includes(g))) return false;
  if (f.vegForward && facts.vegetableCount < 3) return false;
  if (f.maxMinutes && r.totalMinutes > f.maxMinutes) return false;
  if (f.difficulty.length && !f.difficulty.includes(r.difficulty)) return false;
  if (f.equipment && !r.equipment.every((e) => f.equipment!.includes(e))) return false;
  if (f.pantryOnly && pantryMatch(r, profile.pantry, profile.pantryBasics).missing.length > MAX_MISSING_FOR_PANTRY) return false;
  return true;
}

export const activeFilterCount = (f: Filters) =>
  f.diet.length + f.proteins.length + f.grains.length + Number(f.vegForward) + Number(!!f.maxMinutes) + f.difficulty.length + Number(!!f.equipment) + Number(f.pantryOnly);

// ── Recommendations ─────────────────────────────────────────
export interface Taste {
  cuisines: Map<string, number>;
  proteins: Set<ProteinId>;
  recent: Set<string>;
}

/** What the user's finished dishes say about them. */
export function tasteOf(profile: Profile, library: Recipe[]): Taste {
  const finished = profile.history.filter((h) => h.finished);
  const cuisines = new Map<string, number>();
  for (const h of finished) cuisines.set(h.cuisine, (cuisines.get(h.cuisine) ?? 0) + 1);
  const byId = new Map(library.map((r) => [r.id, r]));
  const proteins = new Set(finished.flatMap((h) => (byId.get(h.recipeId) ? factsOf(byId.get(h.recipeId)!).proteins : [])));
  return { cuisines, proteins, recent: new Set(profile.history.slice(-8).map((h) => h.recipeId)) };
}

/** Score for "Picked for you": past cooking, favorite cuisines, pantry fit, popularity. */
export function recommendScore(r: Recipe, profile: Profile, taste: Taste): number {
  let s = r.popularity / 25;
  if (profile.favoriteCuisines.includes(r.cuisine)) s += 3;
  s += Math.min(3, taste.cuisines.get(r.cuisine) ?? 0);
  if (factsOf(r).proteins.some((p) => taste.proteins.has(p))) s += 1;
  if (taste.recent.has(r.id)) s -= 4;
  if (profile.pantry.length) {
    const m = pantryMatch(r, profile.pantry, profile.pantryBasics);
    s += m.need ? (m.have / m.need) * 4 : 0;
  }
  if (ruleConflicts(r, profile).length) s -= 10;
  if (!r.equipment.every((e) => profile.equipment.includes(e))) s -= 5;
  return s;
}

export const proteinLabel = (p: ProteinId) => PROTEINS[p];
export const grainLabel = (g: GrainId) => GRAINS[g];
