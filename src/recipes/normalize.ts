import { cuisineById, matchCuisine } from '../data/cuisines';
import { GENERIC_WORDS, emojiFor, normalize, parseIngredientLine, sameIngredient, spellOutSpoons } from '../data/ingredients';
import { DIFFICULTIES, EQUIPMENT_IDS, EQUIPMENT_WORDS } from '../data/rules';
import { groupStages, validateStages } from '../agent/stages';
import type { ChefCredit, Difficulty, Equipment, Nutrition, Recipe, RecipeImageAttribution, RecipeIngredient, RecipeStage, RecipeStep } from '../types';
import { splitList } from './csv';

// ─────────────────────────────────────────────────────────────
// Turns one raw record from the recipe database (a JSON object
// or a CSV row) into a Recipe. Field names are matched loosely
// so most exports load without a conversion script; see
// docs/RECIPE_FORMAT.md for the preferred shape.
// ─────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;

const pick = (r: Raw, ...keys: string[]): unknown => {
  for (const k of keys) {
    const v = r[k] ?? r[k.toLowerCase()] ?? r[k.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v !== 'string' || !v.trim()) return null;
  // ISO 8601 durations like PT1H15M.
  const iso = v.match(/^PT(?:(\d+)H)?(?:(\d+)M)?$/i);
  if (iso) return (+(iso[1] ?? 0)) * 60 + +(iso[2] ?? 0);
  const n = parseFloat(v);
  return isFinite(n) ? n : null;
};
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === 'string' ? splitList(v) : []);
const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'item';

function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function parseIngredients(raw: unknown): RecipeIngredient[] {
  const taken = new Set<string>();
  return list(raw)
    .map((item): RecipeIngredient | null => {
      if (typeof item === 'string') {
        if (!item.trim()) return null;
        const optional = /\boptional\b/i.test(item);
        const p = parseIngredientLine(item.replace(/\(optional\)/i, ''));
        return { id: uniqueId(slug(normalize(p.name) || p.name), taken), name: p.name, amount: p.amount, unit: p.unit, note: p.note, optional: optional || undefined };
      }
      if (!item || typeof item !== 'object') return null;
      const o = item as Raw;
      const name = str(pick(o, 'name', 'ingredient', 'item'));
      if (!name) return null;
      let amount = num(pick(o, 'amount', 'quantity', 'qty'));
      let unit = str(pick(o, 'unit', 'units', 'measure'));
      // "quantity": "1 1/2 cups" style
      const q = pick(o, 'amount', 'quantity', 'qty');
      if (typeof q === 'string' && amount !== null && /[a-z/]/i.test(q)) {
        const p = parseIngredientLine(`${q} ${name}`);
        amount = p.amount;
        unit = unit || p.unit;
      }
      const id = str(pick(o, 'id', 'key'));
      return {
        id: uniqueId(id ? slug(id) : slug(normalize(name) || name), taken),
        name,
        amount,
        unit,
        note: str(pick(o, 'note', 'notes', 'preparation', 'prep')) || undefined,
        optional: pick(o, 'optional') === true || pick(o, 'optional') === 'true' || undefined,
      };
    })
    .filter((x): x is RecipeIngredient => !!x);
}

const PREPOSITIONS = new Set(['in', 'with', 'for', 'until', 'into', 'on', 'onto', 'over', 'to', 'at', 'from', 'under', 'by']);

/** "Boil the spaghetti in salted water for 9 minutes." → "Boil the spaghetti" */
function titleFromText(text: string): string {
  const first = text.split(/[.;:!?]|,\s| and (?=[a-z]+ the)| then /i)[0].trim();
  let words = first.split(/\s+/);
  const cut = words.findIndex((w, i) => i >= 2 && PREPOSITIONS.has(w.toLowerCase()));
  if (cut > 0) words = words.slice(0, cut);
  const t = words.slice(0, 6).join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** First "N minutes" (upper end of a range) in a step that actually cooks or rests. */
function timerFromText(text: string): number | undefined {
  if (!/\b(cook|simmer|boil|bake|roast|microwave|fry|sear|steam|rest|soak|marinate|grill|toast|heat|stand)\b/i.test(text)) return undefined;
  const m = text.match(/(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i);
  if (!m) return undefined;
  const n = parseFloat(m[2] ?? m[1]);
  const unit = m[3].toLowerCase();
  const secs = unit.startsWith('s') ? n : unit.startsWith('h') ? n * 3600 : n * 60;
  return secs >= 15 && secs <= 4 * 3600 ? Math.round(secs) : undefined;
}


/** Ingredient ids a step mentions by name ("the miso" finds "white miso paste"). */
function detectUses(text: string, ingredients: RecipeIngredient[]): string[] {
  const t = ` ${text.toLowerCase()} `;
  const mentioned = (word: string) => new RegExp(`\\b${word.replace(/y$/, '(y|ie)')}(e?s)?\\b`).test(t);
  return ingredients
    .filter((i) => {
      const n = normalize(i.name);
      if (!n) return false;
      const words = n.split(' ');
      const head = words[words.length - 1];
      return t.includes(n) || (head.length > 2 && !GENERIC_WORDS.has(head) && mentioned(head)) || words.some((w) => w.length > 3 && !GENERIC_WORDS.has(w) && mentioned(w));
    })
    .map((i) => i.id);
}

function parseSteps(raw: unknown, ingredients: RecipeIngredient[]): RecipeStep[] {
  const taken = new Set<string>();
  return list(raw)
    .map((item, idx): RecipeStep | null => {
      const o: Raw = typeof item === 'string' ? { text: item } : item && typeof item === 'object' ? (item as Raw) : {};
      const text = spellOutSpoons(str(pick(o, 'text', 'instruction', 'instructions', 'description', 'body', 'step')));
      if (!text) return null;
      const title = spellOutSpoons(str(pick(o, 'title', 'name', 'heading'))) || titleFromText(text);
      const givenKey = str(pick(o, 'key', 'id'));
      const usesRaw = pick(o, 'uses', 'ingredients');
      const uses = usesRaw
        ? list(usesRaw)
            .map(String)
            .map((u) => ingredients.find((i) => i.id === u || sameIngredient(i.name, u))?.id)
            .filter((x): x is string => !!x)
        : detectUses(`${title} ${text}`, ingredients);
      const timerSecs = num(pick(o, 'timerSeconds', 'timer_seconds', 'seconds'));
      const timerMins = num(pick(o, 'timerMinutes', 'timer_minutes', 'minutes'));
      return {
        key: uniqueId(givenKey ? slug(givenKey) : `${idx + 1}-${slug(title)}`.slice(0, 40), taken),
        title,
        text,
        uses: [...new Set(uses)],
        timerSeconds: timerSecs ?? (timerMins !== null ? timerMins * 60 : timerFromText(text)),
        technique: str(pick(o, 'technique')) || undefined,
        tip: spellOutSpoons(str(pick(o, 'tip', 'note'))) || undefined,
      };
    })
    .filter((x): x is RecipeStep => !!x);
}

/** Stages from the database, as objects or a CSV cell like "Prep:chop:1,2 | Cook:saute:3,4". */
function parseStages(raw: unknown, steps: RecipeStep[]): RecipeStage[] | null {
  const items = list(raw);
  if (!items.length) return null;
  const keyFor = (ref: unknown) => {
    const s = String(ref).trim();
    const n = parseInt(s, 10);
    return steps.find((st) => st.key === s)?.key ?? (String(n) === s ? steps[n - 1]?.key : undefined) ?? s;
  };
  const proposed = items.map((it) => {
    if (typeof it === 'string') {
      const [title, icon, refs] = it.split(':');
      return { title, icon: icon?.trim(), stepKeys: (refs ?? '').split(',').filter(Boolean).map(keyFor) };
    }
    const o = it as Raw;
    return { title: str(pick(o, 'title', 'name')), icon: str(pick(o, 'icon')), stepKeys: list(pick(o, 'steps', 'stepKeys', 'step_keys')).map(keyFor) };
  });
  const check = validateStages(steps, proposed);
  if (!check.ok) console.warn('[Gusteau] Ignoring database stages:', check.problems);
  return check.ok ? check.stages : null;
}

function parseChef(raw: Raw): ChefCredit | undefined {
  const c = pick(raw, 'chef', 'author', 'by');
  const url = str(pick(raw, 'chefUrl', 'chef_url', 'sourceUrl', 'source_url', 'url'));
  const relation = str(pick(raw, 'chefRelation', 'chef_relation', 'credit')) || undefined;
  if (typeof c === 'string' && c.trim()) return { name: c.trim(), url: url || undefined, relation };
  if (c && typeof c === 'object') {
    const o = c as Raw;
    const name = str(pick(o, 'name'));
    if (name) return { name, url: str(pick(o, 'url', 'link')) || url || undefined, relation: str(pick(o, 'relation', 'credit')) || relation };
  }
  return undefined;
}

/**
 * Per-serving nutrition, from a nested `nutrition` object or flat columns
 * (`calories`, `protein_g`, `sodium_mg`, …). Values may be numbers or
 * strings like "12 g". `"per": "recipe"` means totals for the whole dish.
 */
function parseNutrition(raw: Raw, servings: number): Nutrition | undefined {
  const src = pick(raw, 'nutrition', 'nutrition_facts', 'nutritionInfo');
  const o: Raw = src && typeof src === 'object' ? (src as Raw) : raw;
  const read = (...keys: string[]) => {
    const v = pick(o, ...keys);
    const n = num(typeof v === 'string' ? v.replace(/,/g, '') : v);
    return n === null || n < 0 ? undefined : n;
  };
  const calories = read('calories', 'kcal', 'energy_kcal', 'energy', 'nutrition_calories');
  if (calories === undefined) return undefined;
  const sodiumRaw = pick(o, 'sodium', 'sodium_mg', 'salt_mg');
  let sodium = read('sodium', 'sodium_mg', 'salt_mg');
  // "1.2 g" of sodium is 1200 mg.
  if (sodium !== undefined && typeof sodiumRaw === 'string' && /\d\s*g\b/i.test(sodiumRaw) && !/mg/i.test(sodiumRaw)) sodium *= 1000;
  const total = /recipe|total|whole/i.test(str(pick(o, 'per', 'basis')));
  const d = total ? Math.max(1, servings) : 1;
  const per = (v: number | undefined) => (v === undefined ? undefined : v / d);
  return {
    calories: calories / d,
    protein: per(read('protein', 'protein_g')) ?? 0,
    carbs: per(read('carbs', 'carbohydrates', 'carbohydrate', 'carbs_g', 'carbohydrates_g')) ?? 0,
    fat: per(read('fat', 'total_fat', 'fat_g')) ?? 0,
    fiber: per(read('fiber', 'fibre', 'fiber_g', 'dietary_fiber')),
    sugar: per(read('sugar', 'sugars', 'sugar_g')),
    sodium: per(sodium),
  };
}

function parseImageAttribution(raw: unknown): RecipeImageAttribution | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Raw;
  const credit = str(pick(o, 'credit'));
  const licence = str(pick(o, 'licence', 'license'));
  const filePage = str(pick(o, 'filePage', 'file_page'));
  if (!credit || !licence || !filePage) return undefined;
  return {
    credit,
    artist: str(pick(o, 'artist')) || undefined,
    licence,
    filePage,
    licenceUrl: str(pick(o, 'licenceUrl', 'licence_url', 'licenseUrl', 'license_url')) || undefined,
  };
}

export function normalizeRecipe(raw: Raw, index: number): Recipe | null {
  const title = str(pick(raw, 'title', 'name', 'recipe'));
  if (!title) return null;
  const ingredients = parseIngredients(pick(raw, 'ingredients'));
  const steps = parseSteps(pick(raw, 'steps', 'instructions', 'method', 'directions'), ingredients);
  if (!ingredients.length || !steps.length) return null;

  const cuisineRaw = str(pick(raw, 'cuisine', 'cuisine_id', 'category'));
  const cuisine = matchCuisine(cuisineRaw) ?? slug(cuisineRaw || 'other');
  const allText = steps.map((s) => s.text.toLowerCase()).join(' ');
  // An explicit empty list means a no-cook recipe; a missing field means "work it out from the steps".
  const declared = pick(raw, 'equipment', 'appliances');
  const equipmentRaw = list(declared).map((e) => String(e).toLowerCase());
  const equipment: Equipment[] = Array.isArray(declared) || equipmentRaw.length
    ? EQUIPMENT_IDS.filter((e) => equipmentRaw.some((r) => r.includes(e) || (e === 'stovetop' && /stove|hob|cooktop/.test(r))))
    : EQUIPMENT_WORDS.filter(([, re]) => re.test(allText)).map(([e]) => e);
  const diffRaw = str(pick(raw, 'difficulty', 'level'));
  const difficulty: Difficulty = DIFFICULTIES.find((d) => d.toLowerCase() === diffRaw.toLowerCase()) ?? (steps.length <= 5 ? 'Easy' : steps.length <= 8 ? 'Medium' : 'Hard');
  const given = parseStages(pick(raw, 'stages'), steps);
  const weights = steps.map((s) => Math.max(1.5, (s.timerSeconds ?? 0) / 60));
  const givenMinutes = num(pick(raw, 'totalMinutes', 'total_minutes', 'total_time', 'time', 'minutes', 'cook_time'));
  const totalMinutes = Math.max(1, Math.round(givenMinutes ?? weights.reduce((a, b) => a + b, 0)));
  // Spread the total over the steps so "time left" can be estimated mid-cook.
  const scale = totalMinutes / weights.reduce((a, b) => a + b, 0);
  steps.forEach((s, i) => (s.minutes = Math.round(weights[i] * scale * 10) / 10));
  const servings = Math.max(1, Math.round(num(pick(raw, 'servings', 'serves', 'yield')) ?? 2));
  const imageMatchRaw = str(pick(raw, 'imageMatch', 'image_match'));
  const imageMatch = imageMatchRaw === 'dish' || imageMatchRaw === 'representative' ? imageMatchRaw : undefined;
  if (imageMatchRaw && !imageMatch) console.warn(`[Gusteau] Ignoring unsupported image match "${imageMatchRaw}" for ${title}.`);
  const imageAttributionRaw = pick(raw, 'imageAttribution', 'image_attribution');
  const imageAttribution = parseImageAttribution(imageAttributionRaw);
  if (imageAttributionRaw !== undefined && !imageAttribution) console.warn(`[Gusteau] Ignoring incomplete image attribution for ${title}.`);

  return {
    id: str(pick(raw, 'id', 'slug')) || `${slug(title)}-${index}`,
    title,
    cuisine,
    description: str(pick(raw, 'description', 'summary', 'intro')),
    chef: parseChef(raw),
    image: str(pick(raw, 'image', 'image_url', 'photo', 'thumbnail')) || undefined,
    imageMatch,
    imageAttribution,
    emoji: str(pick(raw, 'emoji')) || emojiFor(ingredients[0]?.name ?? '') || cuisineById(cuisine).emoji,
    totalMinutes,
    servings,
    difficulty,
    equipment,
    tags: list(pick(raw, 'tags', 'keywords')).map((t) => String(t).toLowerCase()),
    popularity: Math.max(0, Math.min(100, num(pick(raw, 'popularity', 'rating_count', 'score')) ?? 50)),
    ingredients,
    steps,
    stages: given ?? groupStages(steps),
    stagesBy: given ? 'database' : 'gusteau',
    nutrition: parseNutrition(raw, servings),
  };
}
