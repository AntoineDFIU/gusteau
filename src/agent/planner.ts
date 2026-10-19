import { CATALOG, DIET_RULES, EQUIPMENT, PREFERENCES, formatAmount, phraseAmount, roundAmount } from '../data/ingredients';
import { TEMPLATES, TEMPLATE_NAMES, type BuildCtx, type RecipeTemplate, type SlotOption } from '../data/recipes';
import type { BlockedOption, Constraints, DietTag, Equipment, InventoryItem, Recipe, RecipeIngredient, RecipeStep, SessionState } from '../types';

// ─────────────────────────────────────────────────────────────
// Deterministic, constraint-first planner.
//
// Hard rules (never violated): diet exclusions + custom allergies,
// equipment, time limit, purchase rule, budget.
// Soft rules (scored): use perishables first, preferences, dislikes,
// and CONTINUITY with the current plan so a replan changes as little
// as possible and keeps the user's completed steps.
// ─────────────────────────────────────────────────────────────

export interface PlanResult {
  recipe: Recipe | null;
  blocked: BlockedOption[];
}

export function availableKeys(inventory: InventoryItem[]): Set<string> {
  return new Set(inventory.map((i) => i.key).filter((k): k is string => !!k));
}

const norm = (s: string) => s.toLowerCase().trim();

// Keyword fallback so ingredients outside the catalog (e.g. ones a
// language model suggests) still get checked against diet rules.
const TAG_WORDS: [DietTag, RegExp][] = [
  ['meat', /\b(beef|pork|bacon|ham|sausage|lamb|steak|chorizo|salami|pepperoni|turkey)\b/],
  ['poultry', /\b(chicken|turkey|duck)\b/],
  ['fish', /\b(fish|salmon|tuna|cod|anchov\w*|sardine\w*)\b/],
  ['shellfish', /\b(shrimp|prawn\w*|crab|lobster|clam\w*|mussel\w*|oyster\w*)\b/],
  ['dairy', /\b(milk|cheese|butter|cream|yogurt|yoghurt|ghee|parmesan|feta)\b/],
  ['egg', /\b(egg|eggs|mayo|mayonnaise)\b/],
  ['gluten', /\b(wheat|flour|bread|pasta|noodle\w*|tortilla\w*|couscous|soy sauce)\b/],
  ['legume', /\b(bean\w*|lentil\w*|chickpea\w*|pea|peas|hummus)\b/],
  ['nut', /\b(nut|nuts|peanut\w*|almond\w*|cashew\w*|walnut\w*|pecan\w*)\b/],
  ['soy', /\b(soy|tofu|tempeh|edamame)\b/],
];
export function tagsFor(keyOrName: string): DietTag[] {
  const item = CATALOG[keyOrName];
  if (item) return item.tags;
  const t = norm(keyOrName);
  return TAG_WORDS.filter(([, re]) => re.test(t)).map(([tag]) => tag);
}

export function isExcluded(key: string, c: Constraints): string | null {
  const item = CATALOG[key];
  const tags = tagsFor(key);
  for (const rule of c.hardExclusions) {
    const blocked = DIET_RULES[rule].blocks;
    if (tags.some((t) => blocked.includes(t))) return DIET_RULES[rule].label;
  }
  for (const ex of c.customExclusions) {
    const e = norm(ex);
    if (!e) continue;
    const names = item ? [item.key, item.name, ...item.aliases].map(norm) : [norm(key)];
    if (names.some((n) => n.includes(e) || e.includes(n))) return `No ${ex}`;
    // Category words like "dairy" or "gluten" in a custom allergy.
    if (tags.some((t) => e.includes(t))) return `No ${ex}`;
  }
  return null;
}

const isDisliked = (key: string, c: Constraints) =>
  c.dislikes.some((d) => {
    const item = CATALOG[key];
    const e = norm(d);
    return !!e && !!item && [item.key, item.name, ...item.aliases].map(norm).some((n) => n.includes(e) || e.includes(n));
  });

const SHORT: Record<string, string> = {
  chicken: 'chicken',
  beans: 'black beans',
  tortillas: 'tortillas',
  rice: 'rice',
  eggs: 'eggs',
  cheese: 'cheese',
  spinach: 'spinach',
  tomatoes: 'tomatoes',
  onion: 'onion',
  garlic: 'garlic',
  salsa: 'salsa',
  lemon: 'lemon',
  avocado: 'avocado',
  pepper: 'bell pepper',
  pasta: 'pasta',
};
export const shortName = (key: string) => SHORT[key] ?? CATALOG[key]?.name.toLowerCase() ?? key;

interface Chosen {
  role: string;
  opt: SlotOption;
  toBuy: boolean;
  required: boolean;
  alternatives: SlotOption[];
}

interface Evaluation {
  recipe?: Recipe;
  reason?: string;
  score: number;
  title: string;
}

function evaluate(t: RecipeTemplate, state: SessionState, prev: Recipe | null, completed: string[]): Evaluation {
  const c = state.constraints;
  const have = availableKeys(state.inventory);
  const prevKeys = new Set(prev?.ingredients.map((i) => i.key) ?? []);
  const fallbackTitle = TEMPLATE_NAMES[t.id] ?? t.id.replace(/-/g, ' ');

  if (!c.equipment.includes(t.equipment)) {
    return { reason: `Needs a ${EQUIPMENT[t.equipment].label.toLowerCase()}`, score: -Infinity, title: fallbackTitle };
  }

  const chosen: Chosen[] = [];
  for (const slot of t.slots) {
    const allowed = slot.options.filter((o) => !isExcluded(o.key, c));
    let avail = allowed.filter((o) => have.has(o.key));
    // Prefer what the current plan already uses (stability), then avoid dislikes.
    avail = [...avail].sort((a, b) => {
      const cont = Number(prevKeys.has(b.key)) - Number(prevKeys.has(a.key));
      if (cont) return cont;
      return Number(isDisliked(a.key, c)) - Number(isDisliked(b.key, c));
    });
    if (!slot.required) avail = avail.filter((o) => !isDisliked(o.key, c));

    if (avail.length) {
      chosen.push({ role: slot.role, opt: avail[0], toBuy: false, required: slot.required, alternatives: avail.slice(1) });
    } else if (slot.required) {
      if (!allowed.length) {
        const why = isExcluded(slot.options[0].key, c);
        return { reason: `Its ${slot.label} conflicts with ${why}`, score: -Infinity, title: fallbackTitle };
      }
      if (!c.purchasesAllowed) {
        return { reason: `Missing ${shortName(allowed[0].key)} (no purchases allowed)`, score: -Infinity, title: fallbackTitle };
      }
      const cheapest = [...allowed].sort((a, b) => CATALOG[a.key].price - CATALOG[b.key].price)[0];
      chosen.push({ role: slot.role, opt: cheapest, toBuy: true, required: true, alternatives: [] });
    }
  }

  // Time: swap or drop slow optional choices until we fit the window.
  const minutesOf = () =>
    Math.round(t.baseMinutes + chosen.reduce((s, ch) => s + (ch.opt.minutes ?? 0), 0) + t.perExtraServing * Math.max(0, c.servings - 2));
  let guard = 0;
  while (minutesOf() > c.timeMinutes && guard++ < 10) {
    const slow = [...chosen].filter((ch) => (ch.opt.minutes ?? 0) > 0).sort((a, b) => (b.opt.minutes ?? 0) - (a.opt.minutes ?? 0))[0];
    if (!slow) break;
    const faster = slow.alternatives.find((a) => (a.minutes ?? 0) < (slow.opt.minutes ?? 0));
    if (faster) {
      slow.alternatives = slow.alternatives.filter((a) => a !== faster);
      slow.opt = faster;
    } else if (!slow.required) {
      chosen.splice(chosen.indexOf(slow), 1);
    } else break;
  }
  const minutes = minutesOf();
  if (minutes > c.timeMinutes) {
    return { reason: `Takes about ${minutes} min (you have ${c.timeMinutes})`, score: -Infinity, title: fallbackTitle };
  }

  const ingredients: RecipeIngredient[] = chosen.map((ch) => {
    const item = CATALOG[ch.opt.key];
    const amount = roundAmount(ch.opt.perServing * c.servings, item.rounding);
    return {
      role: ch.role,
      key: item.key,
      name: item.name,
      emoji: item.emoji,
      amount,
      unit: amount > 1 ? item.unitPlural : item.unit,
      display: formatAmount(amount, item.key),
      toBuy: ch.toBuy,
      price: ch.toBuy ? item.price : 0,
    };
  });
  const cost = +ingredients.reduce((s, i) => s + i.price, 0).toFixed(2);
  if (cost > c.budget) {
    return { reason: `Needs about $${cost.toFixed(2)} of shopping (limit $${c.budget})`, score: -Infinity, title: fallbackTitle };
  }

  const byRole = new Map(ingredients.map((i) => [i.role, i]));
  const ctx: BuildCtx = {
    has: (r) => byRole.has(r),
    is: (r, k) => byRole.get(r)?.key === k,
    q: (r) => (byRole.get(r) ? phraseAmount(byRole.get(r)!.amount, byRole.get(r)!.key) : ''),
    n: (r) => (byRole.get(r) ? shortName(byRole.get(r)!.key) : ''),
    servings: c.servings,
  };
  const steps = t.steps(ctx).filter(Boolean) as RecipeStep[];
  const title = t.title(ctx);

  // ── Scoring ──
  let score = t.priority;
  for (const i of ingredients) if (!i.toBuy) score += 1 + CATALOG[i.key].perishable;
  for (const p of c.preferences) {
    if (t.tags.includes(p)) score += 1.5;
    if (p === 'spicy' && byRole.has('sauce')) score += 1;
    if (p === 'high-protein' && ingredients.some((i) => ['chicken', 'eggs', 'beans'].includes(i.key))) score += 1;
    if (p === 'cheesy' && ingredients.some((i) => i.key === 'cheese')) score += 1;
  }
  score -= ingredients.filter((i) => i.toBuy).length * 4 + cost * 0.3;
  if (prev?.templateId === t.id) score += 3;
  score += steps.filter((s) => completed.includes(s.key)).length * 0.75;

  const recipe: Recipe = {
    templateId: t.id,
    title,
    subtitle: t.subtitle(ctx),
    emoji: t.emoji,
    difficulty: t.difficulty,
    equipment: t.equipment,
    totalMinutes: minutes,
    servings: c.servings,
    ingredients,
    steps,
    whyItFits: [],
    estimatedCost: cost,
    source: 'mock-planner',
  };
  recipe.whyItFits = explainFit(recipe, state);
  return { recipe, score, title };
}

export function explainFit(recipe: Recipe, state: SessionState): string[] {
  const c = state.constraints;
  const out: string[] = [];
  const owned = recipe.ingredients.filter((i) => !i.toBuy);
  const buy = recipe.ingredients.filter((i) => i.toBuy);
  const n = owned.length;
  out.push(
    buy.length
      ? `Uses ${n} ingredient${n === 1 ? '' : 's'} you already have and adds ${buy.map((b) => shortName(b.key)).join(', ')} (est. $${recipe.estimatedCost.toFixed(2)}), within your $${c.budget} limit.`
      : `Uses ${n} ingredient${n === 1 ? '' : 's'} you already have. Nothing new to buy.`,
  );
  out.push(`Ready in about ${recipe.totalMinutes} minutes, inside your ${c.timeMinutes}-minute window.`);
  out.push(`Only needs your ${EQUIPMENT[recipe.equipment].label.toLowerCase()}.`);
  const rules = [...c.hardExclusions.map((r) => DIET_RULES[r].label), ...c.customExclusions.map((x) => `no ${x}`)];
  if (rules.length) out.push(`Respects every hard rule: ${rules.join(', ')}.`);
  const perish = owned.filter((i) => CATALOG[i.key]?.perishable >= 1).map((i) => shortName(i.key));
  if (perish.length) out.push(`Uses up your ${perish.join(' and ')} before it turns.`);
  const prefs = c.preferences.filter((p) => TEMPLATES.find((t) => t.id === recipe.templateId)?.tags.includes(p));
  if (prefs.length) out.push(`Matches what you're craving: ${prefs.map((p) => PREFERENCES[p].label.toLowerCase()).join(', ')}.`);
  out.push(`Scaled for ${c.servings} ${c.servings === 1 ? 'serving' : 'servings'}.`);
  return out;
}

export function planWithTemplates(state: SessionState, prev: Recipe | null, completed: string[] = []): PlanResult {
  const evals = TEMPLATES.map((t) => evaluate(t, state, prev, completed));
  const feasible = evals.filter((e) => e.recipe).sort((a, b) => b.score - a.score);
  const blocked = evals
    .map((e, i) => ({ e, id: TEMPLATES[i].id }))
    .filter(({ e }) => !e.recipe)
    .map(({ e, id }) => ({ templateId: id, title: e.title, reason: e.reason! }));
  return { recipe: feasible[0]?.recipe ?? null, blocked };
}

/**
 * Independent safety check that runs on EVERY plan, including ones
 * written by the language model. Returns human-readable violations.
 */
export function validateRecipe(recipe: Recipe, state: SessionState): string[] {
  const c = state.constraints;
  const v: string[] = [];
  const have = availableKeys(state.inventory);
  const invNames = state.inventory.map((i) => norm(i.name));
  if (!c.equipment.includes(recipe.equipment)) v.push(`Uses a ${recipe.equipment || 'piece of equipment'}, which you don't have.`);
  if (recipe.source === 'model') {
    // A model can name one appliance but sneak another into the steps.
    const text = recipe.steps
      .map((s) => `${s.title} ${s.instruction}`)
      .join(' ')
      .toLowerCase()
      .replace(/microwave[- ]?oven/g, 'microwave');
    const mentions: [Equipment, RegExp][] = [
      ['stovetop', /\b(stove|stovetop|skillet|frying pan|saucepan|sauté pan|saute pan|hob|burner|wok)\b/],
      ['oven', /\b(oven|bake|baking|broil)\b/],
      ['microwave', /\bmicrowave\b/],
    ];
    for (const [eq, re] of mentions) {
      if (!c.equipment.includes(eq) && re.test(text)) v.push(`A step needs a ${EQUIPMENT[eq].label.toLowerCase()}, which you don't have.`);
    }
  }
  if (recipe.totalMinutes > c.timeMinutes) v.push(`Takes ${recipe.totalMinutes} min, over your ${c.timeMinutes}-minute limit.`);
  for (const i of recipe.ingredients) {
    const why = isExcluded(CATALOG[i.key] ? i.key : i.name, c);
    if (why) v.push(`${i.name} breaks “${why}”.`);
    const basic = c.pantryBasics && /\b(salt|black pepper|pepper flakes|oil|water)\b/.test(norm(i.name)) && !CATALOG[i.key];
    const owned = basic || have.has(i.key) || invNames.some((n) => n.includes(norm(i.name)) || norm(i.name).includes(n));
    if (!owned && !i.toBuy) v.push(`${i.name} isn't in your confirmed inventory.`);
    if (i.toBuy && !c.purchasesAllowed) v.push(`${i.name} would need to be bought, but purchases are off.`);
    if (state.removed.some((r) => r.key && r.key === i.key)) v.push(`${i.name} was marked unavailable.`);
  }
  if (recipe.estimatedCost > c.budget) v.push(`Shopping cost $${recipe.estimatedCost} exceeds your $${c.budget} limit.`);
  return v;
}

/** Compare recipe amounts against user quantity notes like "1 can" or "3 eggs". */
export function quantityWarnings(recipe: Recipe, inventory: InventoryItem[]): string[] {
  const out: string[] = [];
  for (const ing of recipe.ingredients) {
    const inv = inventory.find((i) => i.key === ing.key);
    if (!inv?.quantityNote) continue;
    const m = inv.quantityNote.match(/(\d+(?:\.\d+)?)\s*([a-z]+)?/i);
    if (!m) continue;
    const have = parseFloat(m[1]);
    const unitWord = (m[2] ?? '').toLowerCase();
    const cat = CATALOG[ing.key];
    const unitMatches = !unitWord || [cat.unit, cat.unitPlural, ing.key].some((u) => u.startsWith(unitWord.slice(0, 3)));
    if (unitMatches && have < ing.amount) {
      out.push(`${ing.name}: recipe needs ${ing.display}, you noted ${inv.quantityNote}. I'd stretch it with extra toppings or reduce a serving.`);
    }
  }
  return out;
}
