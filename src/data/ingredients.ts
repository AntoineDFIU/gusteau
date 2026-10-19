import type { DietRuleId, DietTag, Equipment, PreferenceId } from '../types';

export interface CatalogIngredient {
  key: string;
  name: string;
  emoji: string;
  tags: DietTag[];
  unit: string;
  unitPlural: string;
  /** How amounts round when scaled: 'quarter' (cups), 'half', 'whole'. */
  rounding: 'quarter' | 'half' | 'whole';
  /** Estimated store price for one typical package (USD). Shown as "est.". */
  price: number;
  /** Extra weight to use perishables first. */
  perishable: number;
  aliases: string[];
}

export const CATALOG: Record<string, CatalogIngredient> = {
  chicken: { key: 'chicken', name: 'Chicken breast', emoji: '🍗', tags: ['meat', 'poultry'], unit: 'oz', unitPlural: 'oz', rounding: 'whole', price: 5.0, perishable: 2, aliases: ['chicken', 'chicken breast', 'chicken thighs', 'poultry'] },
  eggs: { key: 'eggs', name: 'Eggs', emoji: '🥚', tags: ['egg'], unit: 'egg', unitPlural: 'eggs', rounding: 'whole', price: 3.0, perishable: 0.3, aliases: ['egg', 'eggs'] },
  spinach: { key: 'spinach', name: 'Baby spinach', emoji: '🥬', tags: [], unit: 'handful', unitPlural: 'handfuls', rounding: 'whole', price: 2.5, perishable: 1, aliases: ['spinach', 'baby spinach', 'greens', 'leafy greens'] },
  tomatoes: { key: 'tomatoes', name: 'Tomatoes', emoji: '🍅', tags: [], unit: 'tomato', unitPlural: 'tomatoes', rounding: 'half', price: 1.5, perishable: 0.5, aliases: ['tomato', 'tomatoes', 'cherry tomatoes', 'roma tomatoes'] },
  onion: { key: 'onion', name: 'Onion', emoji: '🧅', tags: [], unit: 'onion', unitPlural: 'onions', rounding: 'half', price: 1.0, perishable: 0, aliases: ['onion', 'onions', 'red onion', 'yellow onion', 'white onion'] },
  garlic: { key: 'garlic', name: 'Garlic', emoji: '🧄', tags: [], unit: 'clove', unitPlural: 'cloves', rounding: 'whole', price: 0.75, perishable: 0, aliases: ['garlic', 'garlic cloves'] },
  rice: { key: 'rice', name: 'Rice', emoji: '🍚', tags: [], unit: 'cup', unitPlural: 'cups', rounding: 'quarter', price: 2.0, perishable: 0, aliases: ['rice', 'white rice', 'jasmine rice', 'basmati rice'] },
  cheese: { key: 'cheese', name: 'Shredded cheese', emoji: '🧀', tags: ['dairy'], unit: 'cup', unitPlural: 'cups', rounding: 'quarter', price: 3.0, perishable: 0.2, aliases: ['cheese', 'cheddar', 'shredded cheese', 'mozzarella', 'monterey jack'] },
  tortillas: { key: 'tortillas', name: 'Flour tortillas', emoji: '🫓', tags: ['gluten'], unit: 'tortilla', unitPlural: 'tortillas', rounding: 'whole', price: 2.5, perishable: 0, aliases: ['tortilla', 'tortillas', 'flour tortillas', 'wraps', 'wrap'] },
  beans: { key: 'beans', name: 'Canned black beans', emoji: '🥫', tags: ['legume'], unit: 'can', unitPlural: 'cans', rounding: 'half', price: 1.2, perishable: 0, aliases: ['beans', 'canned beans', 'black beans', 'pinto beans', 'kidney beans', 'can of beans'] },
  salsa: { key: 'salsa', name: 'Salsa', emoji: '🌶️', tags: [], unit: 'tbsp', unitPlural: 'tbsp', rounding: 'whole', price: 2.8, perishable: 0, aliases: ['salsa', 'jarred salsa', 'hot sauce'] },
  lemon: { key: 'lemon', name: 'Lemon', emoji: '🍋', tags: [], unit: 'lemon', unitPlural: 'lemons', rounding: 'half', price: 0.8, perishable: 0.2, aliases: ['lemon', 'lemons', 'lime', 'limes'] },
  avocado: { key: 'avocado', name: 'Avocado', emoji: '🥑', tags: [], unit: 'avocado', unitPlural: 'avocados', rounding: 'half', price: 1.5, perishable: 1, aliases: ['avocado', 'avocados'] },
  pepper: { key: 'pepper', name: 'Bell pepper', emoji: '🫑', tags: [], unit: 'bell pepper', unitPlural: 'bell peppers', rounding: 'half', price: 1.2, perishable: 0.5, aliases: ['bell pepper', 'bell peppers', 'red pepper', 'green pepper', 'capsicum'] },
  pasta: { key: 'pasta', name: 'Pasta', emoji: '🍝', tags: ['gluten'], unit: 'oz', unitPlural: 'oz', rounding: 'whole', price: 1.5, perishable: 0, aliases: ['pasta', 'spaghetti', 'penne', 'noodles'] },
};

/** Fuzzy-match free text ("a can of black beans") to a catalog key. */
export function matchIngredient(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  let best: { key: string; len: number } | null = null;
  for (const item of Object.values(CATALOG)) {
    for (const alias of item.aliases) {
      if (t.includes(` ${alias} `) || t.includes(` ${alias}s `)) {
        if (!best || alias.length > best.len) best = { key: item.key, len: alias.length };
      }
    }
  }
  return best?.key ?? null;
}

export function emojiFor(key: string | null): string {
  return (key && CATALOG[key]?.emoji) || '🧺';
}

export const DIET_RULES: Record<DietRuleId, { label: string; blocks: DietTag[]; short: string }> = {
  vegetarian: { label: 'Vegetarian', blocks: ['meat', 'poultry', 'fish', 'shellfish'], short: 'No meat or fish' },
  vegan: { label: 'Vegan', blocks: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg'], short: 'No animal products' },
  'dairy-free': { label: 'Dairy-free', blocks: ['dairy'], short: 'No milk or cheese' },
  'gluten-free': { label: 'Gluten-free', blocks: ['gluten'], short: 'No wheat/gluten' },
  'egg-free': { label: 'Egg-free', blocks: ['egg'], short: 'No eggs' },
  'nut-free': { label: 'Nut-free', blocks: ['nut'], short: 'No nuts' },
  'legume-free': { label: 'No beans/legumes', blocks: ['legume'], short: 'No beans or lentils' },
};

export const PREFERENCES: Record<PreferenceId, { label: string; emoji: string }> = {
  spicy: { label: 'A little spicy', emoji: '🌶️' },
  'high-protein': { label: 'High protein', emoji: '💪' },
  comfort: { label: 'Comfort food', emoji: '🫶' },
  fresh: { label: 'Fresh & light', emoji: '🌿' },
  cheesy: { label: 'Extra cheesy', emoji: '🧀' },
  'minimal-cleanup': { label: 'Minimal cleanup', emoji: '🧽' },
};

export const EQUIPMENT: Record<Equipment, { label: string; emoji: string }> = {
  stovetop: { label: 'Stovetop', emoji: '🍳' },
  oven: { label: 'Oven', emoji: '🔥' },
  microwave: { label: 'Microwave', emoji: '📟' },
};

const FRACTIONS: [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];

export function roundAmount(amount: number, rounding: CatalogIngredient['rounding']): number {
  if (rounding === 'whole') return Math.max(1, Math.ceil(amount - 0.001));
  if (rounding === 'half') return Math.max(0.5, Math.ceil(amount * 2 - 0.001) / 2);
  return Math.max(0.25, Math.round(amount * 4) / 4);
}

function fractionString(amount: number): string {
  const whole = Math.floor(amount + 1e-6);
  const frac = amount - whole;
  let fracStr = '';
  if (frac > 0.01) {
    const hit = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.04);
    fracStr = hit ? hit[1] : frac.toFixed(2).replace(/^0/, '');
  }
  return `${whole > 0 ? whole : ''}${fracStr}` || '0';
}

/** Number + unit, converting big spoon measures to cups. */
function numberAndUnit(amount: number, key: string): { num: string; unit: string } {
  const item = CATALOG[key];
  let a = amount;
  let singular = item.unit;
  let plural = item.unitPlural;
  if (item.unit === 'tbsp' && amount >= 8) {
    a = Math.round((amount / 16) * 4) / 4;
    singular = 'cup';
    plural = 'cups';
  }
  return { num: fractionString(a), unit: a > 1 ? plural : singular };
}

/** Short form for ingredient lists: "1 cup uncooked", "1½ cans (15 oz)". */
export function formatAmount(amount: number, key: string): string {
  const { num, unit } = numberAndUnit(amount, key);
  if (key === 'cheese') return `${num} ${unit} shredded`;
  if (key === 'rice') return `${num} ${unit} uncooked`;
  if (key === 'beans') return `${num} ${unit} (15 oz)`;
  return `${num} ${unit}`;
}

// Mass nouns read as "<amount> <unit> of <noun>"; count nouns are their own unit.
const MASS_NOUNS: Record<string, string> = {
  rice: 'rice',
  beans: 'black beans',
  cheese: 'shredded cheese',
  spinach: 'spinach',
  garlic: 'garlic',
  salsa: 'salsa',
  chicken: 'chicken',
  pasta: 'pasta',
};

/** Sentence form for recipe steps: "1 cup of rice", "6 tortillas", "3 cloves of garlic". */
export function phraseAmount(amount: number, key: string): string {
  const { num, unit } = numberAndUnit(amount, key);
  const noun = MASS_NOUNS[key];
  return noun ? `${num} ${unit} of ${noun}` : `${num} ${unit}`;
}
