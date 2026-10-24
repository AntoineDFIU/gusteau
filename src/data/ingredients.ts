import type { DietTag, Equipment } from '../types';

// ─────────────────────────────────────────────────────────────
// Ingredient knowledge. Recipe databases spell ingredients many
// ways ("2 cloves garlic, minced", "jasmine rice"), so everything
// here works on normalized names rather than a fixed catalog:
//
//   normalize / sameIngredient   match pantry items to recipe lines
//   tagsFor                      diet tags, used by every hard rule
//   proteinOf / grainOf / isVeg  browse filters
//   SUBSTITUTES                  what the replanner may swap in
// ─────────────────────────────────────────────────────────────

const DESCRIPTORS =
  /\b(fresh|freshly|dried|chopped|finely|roughly|coarsely|thinly|diced|minced|sliced|grated|shredded|crushed|large|small|medium|ripe|boneless|skinless|skin-on|bone-in|canned|tinned|jarred|cooked|uncooked|raw|frozen|whole|peeled|deseeded|seeded|trimmed|rinsed|drained|packed|heaped|level|extra|virgin|good|quality|plain|unsalted|salted|lean|halved|quartered|cubed|softened|melted|beaten|room temperature|to taste|optional|of|a|an|the|some|few|handful|pinch|dash|splash|bunch|piece|pieces)\b/g;

// Trailing words that name a cut or form, not a different ingredient.
const FORM_WORDS = new Set(['breast', 'thigh', 'fillet', 'leg', 'drumstick', 'wing', 'clove', 'leaf', 'head', 'sprig', 'stalk', 'can', 'tin', 'cube', 'floret', 'wedge', 'strip', 'chunk']);

const SYNONYMS: [RegExp, string][] = [
  [/\b(green onions?|spring onions?|scallions?)\b/g, 'scallion'],
  [/\bcoriander leaves\b/g, 'cilantro'],
  [/\baubergines?\b/g, 'eggplant'],
  [/\bcourgettes?\b/g, 'zucchini'],
  [/\b(capsicums?|bell peppers?|red peppers?|green peppers?|yellow peppers?)\b(?! flakes)/g, 'bell pepper'],
  [/\bprawns?\b/g, 'shrimp'],
  [/\b(garbanzo beans?|garbanzos?)\b/g, 'chickpea'],
  [/\bminced (beef|pork|lamb)\b/g, 'ground $1'],
  [/\b(chile|chilli|chili) peppers?\b/g, 'chili'],
  [/\bstock\b/g, 'broth'],
  [/\bcorn starch\b/g, 'cornstarch'],
  [/\bwraps?\b/g, 'tortilla'],
];

const IRREGULAR: Record<string, string> = { chilies: 'chili', chillies: 'chili', chiles: 'chile', leaves: 'leaf', loaves: 'loaf' };
const singular = (w: string) =>
  IRREGULAR[w] ??
  (w.length > 3 && !/(ss|us|is)$/.test(w)
    ? w.replace(/(tomato|potato|mango)es$/, '$1').replace(/ies$/, 'y').replace(/(ch|sh|x)es$/, '$1').replace(/s$/, '')
    : w);

/** "2 Cloves Garlic, minced (about 1 tbsp)" → "garlic" */
export function normalize(name: string): string {
  let t = name.toLowerCase().replace(/\(.*?\)/g, ' ').split(/[,;]/)[0];
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  t = t.replace(/[^a-z\- ]/g, ' ').replace(DESCRIPTORS, ' ');
  const words = t.split(/\s+/).filter(Boolean).map(singular);
  while (words.length > 1 && FORM_WORDS.has(words[words.length - 1])) words.pop();
  return words.join(' ');
}

/** Words too generic to identify an ingredient on their own ("pepper" in "bell pepper" vs "salt and pepper"). */
export const GENERIC_WORDS = new Set(['white', 'black', 'green', 'yellow', 'brown', 'dark', 'light', 'sweet', 'sour', 'mild', 'thai', 'paste', 'sauce', 'powder', 'seed', 'juice', 'flake', 'stick', 'berry', 'kernel', 'bread', 'pepper', 'spice', 'oil']);

/** True when a pantry item can stand in for a recipe line ("rice" ↔ "jasmine rice", not "rice vinegar"). */
export function sameIngredient(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = na.split(' ');
  const tb = nb.split(' ');
  if (ta[ta.length - 1] !== tb[tb.length - 1]) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((w) => long.includes(w));
}

// ── Pantry basics ───────────────────────────────────────────
const STAPLES = /^(salt|kosher salt|sea salt|black pepper|pepper|salt and pepper|oil|olive oil|cooking oil|vegetable oil|neutral oil|canola oil|sunflower oil|water)$/;
export const isStaple = (name: string) => STAPLES.test(normalize(name).replace(/ground black pepper/, 'black pepper'));

// ── Diet tags ───────────────────────────────────────────────
const TAG_WORDS: [DietTag, RegExp][] = [
  ['meat', /\b(beef|pork|bacon|ham|prosciutto|pancetta|sausage|chorizo|salami|pepperoni|lamb|mutton|goat|steak|veal|brisket|oxtail|lardon|guanciale|bratwurst|mince|ground beef|ground pork|ground lamb)\b/],
  ['poultry', /\b(chicken|turkey|duck)\b/],
  ['fish', /\b(fish|salmon|tuna|cod|haddock|tilapia|sea bass|snapper|halibut|mackerel|trout|anchov\w*|sardine\w*|bonito|dashi|worcestershire)\b/],
  ['shellfish', /\b(shrimp|crab|lobster|clam\w*|mussel\w*|oyster\w*|scallop\w*|squid|calamari|octopus)\b/],
  ['dairy', /(?<!(coconut|almond|oat|soy|peanut|rice|cashew|nut) )\b(milk|cheese|butter|cream|yogurt|yoghurt|ghee|parmesan|parmigiano|pecorino|feta|mozzarella|cheddar|ricotta|mascarpone|paneer|halloumi|buttermilk|crème fraîche|creme fraiche|gruyere|gruyère|queso|cotija|labneh)\b/],
  ['egg', /\b(egg|eggs|egg yolk|mayo|mayonnaise|aioli)\b/],
  ['gluten', /(?<!(rice|corn|gluten-free) )\b(wheat|flour|bread|breadcrumb\w*|panko|pasta|spaghetti|penne|linguine|fettuccine|macaroni|lasagne|lasagna|noodle\w*|udon|ramen|tortilla\w*|pita|naan|couscous|bulgur|barley|semolina|soy sauce|beer|seitan|baguette|bun|brioche|pastry|dumpling wrapper\w*|cracker\w*)\b/],
  ['legume', /\b(bean\w*|lentil\w*|chickpea\w*|pea|peas|hummus|edamame)\b/],
  ['nut', /\b(nut|nuts|peanut\w*|almond\w*|cashew\w*|walnut\w*|pecan\w*|pistachio\w*|hazelnut\w*|pine nut\w*|macadamia\w*)\b/],
  ['soy', /\b(soy|soya|tofu|tempeh|edamame|miso|tamari)\b/],
];

export function tagsFor(name: string): DietTag[] {
  const t = ` ${name.toLowerCase()} `;
  return TAG_WORDS.filter(([, re]) => re.test(t)).map(([tag]) => tag);
}

// ── Browse categories ───────────────────────────────────────
export const PROTEINS = {
  chicken: { label: 'Chicken', emoji: '🍗', re: /\b(chicken|turkey|duck)\b/ },
  beef: { label: 'Beef', emoji: '🥩', re: /\b(beef|steak|brisket|oxtail|veal)\b/ },
  pork: { label: 'Pork', emoji: '🥓', re: /\b(pork|bacon|ham|sausage|chorizo|pancetta|prosciutto|guanciale|bratwurst)\b/ },
  lamb: { label: 'Lamb', emoji: '🍖', re: /\b(lamb|mutton|goat)\b/ },
  fish: { label: 'Fish', emoji: '🐟', re: /\b(fish|salmon|tuna|cod|haddock|tilapia|sea bass|snapper|halibut|mackerel|trout)\b/ },
  seafood: { label: 'Seafood', emoji: '🦐', re: /\b(shrimp|crab|lobster|clams?|mussels?|squid|calamari|octopus|scallops?)\b/ },
  tofu: { label: 'Tofu', emoji: '🧈', re: /\b(tofu|tempeh|seitan)\b/ },
  eggs: { label: 'Eggs', emoji: '🥚', re: /\beggs?\b/ },
  legumes: { label: 'Beans & lentils', emoji: '🫘', re: /\b(beans?|lentils?|chickpeas?)\b/ },
} as const;
export type ProteinId = keyof typeof PROTEINS;

export const GRAINS = {
  rice: { label: 'Rice', emoji: '🍚', re: /\brice\b(?! (vinegar|wine|paper))/ },
  noodles: { label: 'Pasta & noodles', emoji: '🍜', re: /\b(pasta|spaghetti|penne|linguine|fettuccine|macaroni|lasagn\w*|noodles?|udon|ramen|orzo|gnocchi)\b/ },
  bread: { label: 'Bread & wraps', emoji: '🥖', re: /\b(bread|tortillas?|pitas?|naan|injera|baguette|buns?|flatbreads?|pastry|brioche)\b/ },
  grains: { label: 'Other grains', emoji: '🌾', re: /\b(couscous|quinoa|bulgur|polenta|oats|barley|farro|semolina|cornmeal|grits)\b/ },
  potatoes: { label: 'Potatoes', emoji: '🥔', re: /\b(potato(es)?|yams?|cassava|plantains?)\b/ },
} as const;
export type GrainId = keyof typeof GRAINS;

const VEG =
  /\b(onion|shallot|leek|garlic|tomato\w*|bell pepper|pepper|chili|carrot\w*|celery|cabbage|kale|spinach|chard|lettuce|cucumber\w*|zucchini|eggplant|broccoli|cauliflower|peas?|corn|mushroom\w*|squash|pumpkin|okra|green beans?|bok choy|bean sprouts?|scallion\w*|beet\w*|radish\w*|asparagus|avocado\w*|sweet potato\w*|artichoke\w*|fennel)\b/;

export function proteinOf(name: string): ProteinId | null {
  const t = name.toLowerCase();
  if (/\b(broth|stock|sauce|bouillon|powder)\b/.test(t)) return null;
  return (Object.keys(PROTEINS) as ProteinId[]).find((k) => PROTEINS[k].re.test(t)) ?? null;
}
export function grainOf(name: string): GrainId | null {
  const t = name.toLowerCase();
  return (Object.keys(GRAINS) as GrainId[]).find((k) => GRAINS[k].re.test(t)) ?? null;
}
export const isVegetable = (name: string) => VEG.test(name.toLowerCase()) && !/\b(powder|flakes|paste|sauce)\b/.test(name.toLowerCase());

// ── Emoji ───────────────────────────────────────────────────
const EMOJI: [RegExp, string][] = [
  [/\brice\b(?! (vinegar|wine))/, '🍚'],
  [/\b(tortilla|wrap|flatbread|pita|naan|injera)/, '🫓'],
  [/\b(bread|baguette|bun|breadcrumb|panko)/, '🥖'],
  [/\b(pasta|spaghetti|penne|linguine|noodle|udon|ramen)/, '🍝'],
  [/\b(bean|lentil|chickpea)/, '🫘'],
  [/\bchicken|turkey|duck\b/, '🍗'],
  [/\b(beef|steak|lamb|pork|veal|brisket|mince)\b/, '🥩'],
  [/\b(bacon|pancetta|ham|prosciutto)\b/, '🥓'],
  [/\b(sausage|chorizo)\b/, '🌭'],
  [/\b(fish|salmon|tuna|cod|tilapia|snapper|mackerel)\b/, '🐟'],
  [/\b(shrimp|prawn)/, '🦐'],
  [/\b(squid|octopus|calamari)\b/, '🦑'],
  [/\b(mussel|clam|oyster)/, '🦪'],
  [/\btofu\b/, '🧈'],
  [/\beggs?\b/, '🥚'],
  [/\b(cheese|parmesan|feta|mozzarella|cheddar|paneer|halloumi|ricotta)\b/, '🧀'],
  [/\bbutter|ghee\b/, '🧈'],
  [/\b(milk|cream|yogurt|yoghurt)\b/, '🥛'],
  [/\btomato/, '🍅'],
  [/\bonion|shallot|leek\b/, '🧅'],
  [/\bgarlic\b/, '🧄'],
  [/\bginger\b/, '🫚'],
  [/\b(chili|chile|jalape|serrano|scotch bonnet|gochu|sriracha|harissa)/, '🌶️'],
  [/\bbell pepper\b/, '🫑'],
  [/\bcarrot/, '🥕'],
  [/\bpotato/, '🥔'],
  [/\b(spinach|kale|chard|lettuce|cabbage|bok choy|greens)\b/, '🥬'],
  [/\bbroccoli\b/, '🥦'],
  [/\bcucumber/, '🥒'],
  [/\beggplant\b/, '🍆'],
  [/\b(mushroom)/, '🍄'],
  [/\bcorn\b/, '🌽'],
  [/\bavocado/, '🥑'],
  [/\b(lemon|lime)/, '🍋'],
  [/\b(coconut)/, '🥥'],
  [/\b(peanut|cashew|almond|walnut|pistachio|nut)/, '🥜'],
  [/\b(cilantro|parsley|basil|mint|dill|thyme|rosemary|oregano|herb|scallion)/, '🌿'],
  [/\b(oil)\b/, '🫒'],
  [/\b(salsa)\b/, '🫙'],
  [/\b(sauce|vinegar|paste|broth|stock)\b/, '🫙'],
  [/\b(honey)\b/, '🍯'],
  [/\b(apple)\b/, '🍎'],
  [/\b(mango)\b/, '🥭'],
  [/\b(pineapple)\b/, '🍍'],
  [/\b(flour|sugar|salt|cumin|paprika|turmeric|spice|powder|cinnamon|masala|seed)/, '🧂'],
];
export function emojiFor(name: string): string {
  const t = name.toLowerCase();
  return EMOJI.find(([re]) => re.test(t))?.[1] ?? '🥄';
}

// ── Amounts ─────────────────────────────────────────────────
const FRACTIONS: [number, string][] = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
];
const UNICODE_FRAC: Record<string, number> = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };

export function formatNumber(n: number): string {
  const whole = Math.floor(n + 1e-6);
  const frac = n - whole;
  if (frac < 0.06) return String(whole || (n > 0 ? '' : '0')) || '0';
  const hit = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.06);
  if (!hit) return String(Math.round(n * 10) / 10);
  return `${whole || ''}${hit[1]}`;
}

/** Round a scaled amount to something a cook can measure. */
export function roundAmount(n: number, unit: string): number {
  if (/^(tsp|tbsp|cups?|teaspoons?|tablespoons?)$/i.test(unit)) return Math.max(0.25, Math.round(n * 4) / 4);
  if (/^(g|ml|grams?)$/i.test(unit)) return Math.max(5, Math.round(n / 5) * 5);
  if (n >= 3) return Math.round(n);
  return Math.max(0.5, Math.round(n * 2) / 2);
}

export function formatAmount(amount: number | null, unit: string): string {
  if (amount === null) return unit || 'to taste';
  return `${formatNumber(amount)}${unit ? ` ${unit}` : ''}`.trim();
}

const UNITS =
  'cups?|c\\.|tablespoons?|tbsp|tbs|teaspoons?|tsp|grams?|g|kg|kilograms?|ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|oz|ounces?|lbs?|pounds?|cloves?|cans?|tins?|pinch(?:es)?|handfuls?|bunch(?:es)?|slices?|sprigs?|stalks?|packets?|pieces?|sticks?|heads?|knobs?|thumbs?|inch(?:es)?';

/** Parse "1 1/2 cups jasmine rice, rinsed" → { amount: 1.5, unit: "cups", name: "jasmine rice", note: "rinsed" }. */
export function parseIngredientLine(line: string): { amount: number | null; unit: string; name: string; note?: string } {
  let s = line.trim().replace(/^[-•*]\s*/, '');
  for (const [ch, v] of Object.entries(UNICODE_FRAC)) s = s.replace(new RegExp(`(\\d)?\\s*${ch}`), (_, d) => ` ${(d ? +d : 0) + v} `);
  s = s.trim();
  const m = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?(?:\\s+\\d+/\\d+)?|\\d+/\\d+)(?:\\s*(?:-|to)\\s*\\d+(?:\\.\\d+)?)?\\s*(${UNITS})?\\.?\\s+(?:of\\s+)?(.+)$`, 'i'));
  let amount: number | null = null;
  let unit = '';
  let rest = s;
  if (m) {
    amount = m[1].split(/\s+/).reduce((sum, part) => {
      const [a, b] = part.split('/');
      return sum + (b ? +a / +b : +a);
    }, 0);
    unit = (m[2] ?? '').toLowerCase();
    rest = m[3];
  }
  const [name, ...noteParts] = rest.split(',');
  const note = noteParts.join(',').trim();
  return { amount, unit, name: name.trim(), note: note || undefined };
}

// ── Substitutions ───────────────────────────────────────────
export interface SubstituteOption {
  name: string;
  /** Word that replaces the original in step text, e.g. "tortilla cups". */
  inText?: string;
  /** Word that replaces the original in the recipe title. */
  titleWord?: string;
  ratio?: number;
  /** Unit for the substitute when it isn't measured like the original. */
  unit?: string;
  /** Amount per serving when the original's amount doesn't translate (cups of rice → tortillas). */
  perServing?: { amount: number; unit: string };
  note: string;
  /** When the substitute cooks differently, its own step replaces the old one. */
  method?: { title: string; text: string; timerSeconds?: number; minutes: number; equipment: Equipment[]; technique?: string };
}

export interface SubstituteRule {
  match: RegExp;
  options: SubstituteOption[];
}

// Matched against normalized names, first hit wins. Gusteau only offers an
// option if it passes every hard rule and the user has it (or may buy it).
export const SUBSTITUTES: SubstituteRule[] = [
  {
    match: /\brice\b(?! (vinegar|wine|noodle|paper))/,
    options: [
      {
        name: 'Tortillas',
        inText: 'tortilla cups',
        titleWord: 'Tortilla',
        perServing: { amount: 1, unit: '' },
        note: 'Crisp tortilla cups make a sturdy base, and they’re faster than rice.',
        method: {
          title: 'Make tortilla cups',
          text: 'Press each tortilla into a microwave-safe bowl so it forms a cup. Microwave one at a time for 1 to 1½ minutes until it holds its shape. It crisps more as it cools.',
          timerSeconds: 90,
          minutes: 3,
          equipment: ['microwave'],
          technique: 'tortilla-cups',
        },
      },
      {
        name: 'Couscous',
        inText: 'couscous',
        titleWord: 'Couscous',
        ratio: 1,
        note: 'Couscous only needs hot water and five minutes.',
        method: {
          title: 'Soak the couscous',
          text: 'Put the couscous in a bowl with a pinch of salt and pour over an equal volume of just-boiled water from a kettle. Cover for 5 minutes, then fluff with a fork.',
          timerSeconds: 300,
          minutes: 6,
          equipment: ['stovetop', 'microwave'],
        },
      },
      {
        name: 'Quinoa',
        inText: 'quinoa',
        titleWord: 'Quinoa',
        ratio: 1,
        note: 'Quinoa cooks like rice in about 15 minutes.',
        method: {
          title: 'Cook the quinoa',
          text: 'Rinse the quinoa, then simmer it covered in twice its volume of salted water for 15 minutes. Rest 5 minutes and fluff.',
          timerSeconds: 900,
          minutes: 20,
          equipment: ['stovetop'],
        },
      },
      { name: 'Bread', inText: 'warm bread', titleWord: '', perServing: { amount: 1, unit: 'slice' }, note: 'Serve it with bread on the side instead.' },
    ],
  },
  {
    match: /\btortilla\b/,
    options: [
      { name: 'Corn tortillas', inText: 'corn tortillas', titleWord: 'Corn Tortilla', note: 'Corn tortillas work the same way and are gluten-free.' },
      { name: 'Pita', inText: 'pita', note: 'Warm pita makes a good wrap.' },
      { name: 'Lettuce', inText: 'lettuce cups', titleWord: 'Lettuce', note: 'Crisp lettuce leaves make light cups.' },
    ],
  },
  { match: /\b(spaghetti|penne|linguine|fettuccine|pasta|macaroni)\b/, options: [{ name: 'Pasta', inText: 'pasta', note: 'Any pasta shape works.' }, { name: 'Rice noodles', inText: 'rice noodles', note: 'Rice noodles are gluten-free; soak or boil them per the pack.' }] },
  { match: /\bnoodle\b/, options: [{ name: 'Spaghetti', inText: 'spaghetti', note: 'Spaghetti stands in well for noodles.' }, { name: 'Rice noodles', inText: 'rice noodles', note: 'Rice noodles are gluten-free.' }] },
  { match: /\bbutter\b(?! bean)/, options: [{ name: 'Olive oil', inText: 'olive oil', ratio: 0.75, note: 'Use a little less oil than butter.' }] },
  { match: /\b(heavy cream|double cream|cream)\b/, options: [{ name: 'Coconut milk', inText: 'coconut milk', note: 'Coconut milk adds body and a light coconut flavor.' }, { name: 'Milk', inText: 'milk', note: 'Milk is lighter; simmer a little longer to thicken.' }] },
  { match: /\bmilk\b(?<!coconut milk)/, options: [{ name: 'Oat milk', inText: 'oat milk', note: 'Oat milk swaps in one for one.' }, { name: 'Soy milk', inText: 'soy milk', note: 'Soy milk swaps in one for one.' }] },
  { match: /\b(sour cream|creme fraiche|crème fraîche)\b/, options: [{ name: 'Greek yogurt', inText: 'Greek yogurt', note: 'Greek yogurt gives the same tang.' }] },
  { match: /\byogurt\b/, options: [{ name: 'Sour cream', inText: 'sour cream', note: 'Sour cream has the same tang.' }] },
  { match: /\bparmesan|parmigiano\b/, options: [{ name: 'Pecorino', inText: 'pecorino', note: 'Pecorino is saltier, so add it gradually.' }] },
  { match: /\bfeta\b/, options: [{ name: 'Goat cheese', inText: 'goat cheese', note: 'Goat cheese crumbles the same way.' }] },
  { match: /\b(cheese|cheddar|mozzarella|monterey jack)\b/, options: [{ name: 'Shredded cheese', inText: 'cheese', note: 'Any melting cheese works.' }] },
  { match: /\bchicken\b/, options: [{ name: 'Chicken thighs', inText: 'chicken', note: 'Thighs stay juicy; cook until no pink remains.' }, { name: 'Tofu', inText: 'tofu', titleWord: 'Tofu', note: 'Press firm tofu dry, then cook it the same way until golden.' }, { name: 'Chickpeas', inText: 'chickpeas', titleWord: 'Chickpea', note: 'Chickpeas only need warming through.' }] },
  { match: /\b(beef|steak)\b/, options: [{ name: 'Lamb', inText: 'lamb', titleWord: 'Lamb', note: 'Lamb cooks in about the same time.' }, { name: 'Mushrooms', inText: 'mushrooms', titleWord: 'Mushroom', note: 'Meaty mushrooms brown well; cook until their liquid evaporates.' }] },
  { match: /\bpork\b/, options: [{ name: 'Chicken thighs', inText: 'chicken', titleWord: 'Chicken', note: 'Chicken thighs cook in about the same time.' }] },
  { match: /\bshrimp\b/, options: [{ name: 'Chicken', inText: 'chicken', titleWord: 'Chicken', note: 'Cut chicken small so it cooks as fast.' }, { name: 'Tofu', inText: 'tofu', titleWord: 'Tofu', note: 'Firm tofu, pressed and cubed.' }] },
  { match: /\b(white fish|cod|haddock|tilapia|snapper|sea bass)\b/, options: [{ name: 'Salmon', inText: 'salmon', titleWord: 'Salmon', note: 'Salmon takes a minute or two longer.' }, { name: 'White fish', inText: 'white fish', note: 'Any firm white fish works.' }] },
  { match: /\bsoy sauce\b/, options: [{ name: 'Tamari', inText: 'tamari', note: 'Tamari is usually gluten-free; check the label.' }, { name: 'Coconut aminos', inText: 'coconut aminos', note: 'Sweeter and milder; add a pinch of salt.' }] },
  { match: /\bfish sauce\b/, options: [{ name: 'Soy sauce', inText: 'soy sauce', note: 'Soy sauce gives the salty depth without fish.' }] },
  { match: /\blemon\b/, options: [{ name: 'Lime', inText: 'lime', note: 'Lime swaps in one for one.' }, { name: 'Vinegar', inText: 'a splash of vinegar', note: 'A little vinegar brings the acidity.' }] },
  { match: /\blime\b/, options: [{ name: 'Lemon', inText: 'lemon', note: 'Lemon swaps in one for one.' }] },
  { match: /\bcilantro\b/, options: [{ name: 'Parsley', inText: 'parsley', note: 'Parsley gives the same fresh finish.' }] },
  { match: /\bparsley\b/, options: [{ name: 'Cilantro', inText: 'cilantro', note: 'Cilantro gives a fresh finish.' }] },
  { match: /\b(basil|mint)\b/, options: [{ name: 'Parsley', inText: 'parsley', note: 'Parsley keeps it fresh and green.' }] },
  { match: /\bonion\b/, options: [{ name: 'Shallot', inText: 'shallot', note: 'Shallots are milder and cook faster.' }, { name: 'Leek', inText: 'leek', note: 'Use the white and pale green parts.' }, { name: 'Scallion', inText: 'scallion', note: 'Scallions need only a minute in the pan.' }] },
  { match: /\bshallot\b/, options: [{ name: 'Onion', inText: 'onion', note: 'Use a little less onion than shallot.' }] },
  { match: /\bscallion\b/, options: [{ name: 'Chives', inText: 'chives', note: 'Chives give the same mild onion bite.' }] },
  { match: /\bgarlic\b/, options: [{ name: 'Garlic powder', inText: 'garlic powder', ratio: 0.25, unit: 'tsp', note: 'About ¼ tsp of powder per clove.' }] },
  { match: /\bginger\b/, options: [{ name: 'Ground ginger', inText: 'ground ginger', ratio: 0.25, unit: 'tsp', note: 'Use about ¼ tsp ground ginger per thumb of fresh.' }] },
  { match: /\b(spinach)\b/, options: [{ name: 'Kale', inText: 'kale', note: 'Strip the stems; kale needs a minute longer.' }, { name: 'Chard', inText: 'chard', note: 'Chard wilts just like spinach.' }] },
  { match: /\bkale\b/, options: [{ name: 'Spinach', inText: 'spinach', note: 'Spinach wilts in seconds.' }] },
  { match: /\btomato\b/, options: [{ name: 'Canned tomatoes', inText: 'canned tomatoes', note: 'Canned tomatoes are often better out of season.' }] },
  { match: /\bcanned tomato|crushed tomato|tomato puree\b/, options: [{ name: 'Tomatoes', inText: 'chopped tomatoes', note: 'Chop fresh tomatoes and simmer a few minutes longer.' }] },
  { match: /\bblack bean\b/, options: [{ name: 'Pinto beans', inText: 'pinto beans', note: 'Pinto beans swap in one for one.' }, { name: 'Kidney beans', inText: 'kidney beans', note: 'Kidney beans swap in one for one.' }, { name: 'Chickpeas', inText: 'chickpeas', note: 'Chickpeas hold their shape.' }] },
  { match: /\bchickpea\b/, options: [{ name: 'White beans', inText: 'white beans', note: 'White beans are creamier.' }] },
  { match: /\bbean\b/, options: [{ name: 'Black beans', inText: 'black beans', note: 'Any canned bean works.' }, { name: 'Chickpeas', inText: 'chickpeas', note: 'Chickpeas hold their shape.' }] },
  { match: /\blentil\b/, options: [{ name: 'Split peas', inText: 'split peas', note: 'Split peas need a little longer.' }] },
  { match: /\bsweet potato\b/, options: [{ name: 'Potatoes', inText: 'potatoes', note: 'Regular potatoes work the same way.' }] },
  { match: /\bpotato\b/, options: [{ name: 'Sweet potatoes', inText: 'sweet potatoes', note: 'Sweet potatoes cook a little faster.' }] },
  { match: /\bbell pepper\b/, options: [{ name: 'Zucchini', inText: 'zucchini', note: 'Zucchini adds the same color and crunch.' }] },
  { match: /\bzucchini\b/, options: [{ name: 'Eggplant', inText: 'eggplant', note: 'Eggplant needs a little more oil.' }] },
  { match: /\bcoconut milk\b/, options: [{ name: 'Cream', inText: 'cream', note: 'Cream makes it richer and less sweet.' }] },
  { match: /\bbroth\b/, options: [{ name: 'Water', inText: 'water', note: 'Water works; season a little more to make up the flavor.' }] },
  { match: /\bwine\b(?<!rice wine)/, options: [{ name: 'Broth', inText: 'broth', note: 'Broth with a splash of vinegar stands in for wine.' }, { name: 'Water', inText: 'water with a splash of vinegar', note: 'Add a splash of vinegar for acidity.' }] },
  { match: /\bhoney\b/, options: [{ name: 'Sugar', inText: 'sugar', note: 'Use a little less sugar.' }, { name: 'Maple syrup', inText: 'maple syrup', note: 'Maple syrup swaps in one for one.' }] },
  { match: /\bsugar\b/, options: [{ name: 'Honey', inText: 'honey', note: 'Use a little less honey.' }] },
  { match: /\b(breadcrumb|panko)\b/, options: [{ name: 'Crushed crackers', inText: 'crushed crackers', note: 'Crushed crackers give the same crunch.' }] },
  { match: /\b(mayo|mayonnaise)\b/, options: [{ name: 'Greek yogurt', inText: 'Greek yogurt', note: 'Greek yogurt is lighter but just as creamy.' }] },
  { match: /\bsalsa\b/, options: [{ name: 'Tomatoes', inText: 'chopped tomato', note: 'Chopped tomato with a pinch of salt does the job.' }, { name: 'Hot sauce', inText: 'hot sauce', note: 'A few dashes of hot sauce for heat.' }] },
  { match: /\b(chili|jalapeno|jalapeño|serrano)\b/, options: [{ name: 'Chili flakes', inText: 'chili flakes', note: 'A pinch of flakes gives the heat.' }, { name: 'Hot sauce', inText: 'hot sauce', note: 'Add hot sauce to taste.' }] },
];

export function substitutesFor(name: string): SubstituteOption[] {
  const n = normalize(name);
  return SUBSTITUTES.find((r) => r.match.test(n))?.options ?? [];
}

/** Garnishes and toppings can simply be left out. */
export const isGarnish = (name: string) =>
  /\b(cilantro|parsley|basil|mint|dill|chives|scallions?|sesame seeds?|lime wedges?|lemon wedges?|avocado|sour cream|hot sauce|chili flakes|red pepper flakes|toasted|for serving|to serve|garnish|microgreens?)\b/.test(name.toLowerCase());

/**
 * Dried herbs, ground spices and other seasonings. The dish still works
 * without one, so Gusteau may leave it out (and says so) instead of
 * blocking the recipe, and they don't count against "what I have".
 */
export const isSeasoning = (name: string) =>
  /\b(dried|ground)\b|\b(paprika|cumin|oregano|thyme|cinnamon|allspice|peppercorns?|bay lea(f|ves)|turmeric|garam masala|curry powder|ras el hanout|sumac|saffron|chili powder|cayenne|nutmeg|five[- ]spice|mustard powder|sesame oil|baking powder)\b/.test(name.toLowerCase()) &&
  !/\b(ground (beef|pork|lamb|chicken|turkey))\b/.test(name.toLowerCase());
