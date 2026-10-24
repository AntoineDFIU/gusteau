import type { Nutrition, Recipe, RecipeIngredient } from '../types';

// ─────────────────────────────────────────────────────────────
// Nutrition estimates from an ingredient list.
//
// Values are per 100 g, rounded from USDA FoodData Central-style
// reference figures for the usual form of each ingredient (raw meat,
// dry pasta and rice, drained canned beans, lemon juice rather than
// whole lemons). They are approximate by design: the app shows them
// as estimates and lists anything it couldn't count. When the recipe
// database supplies nutrition, that is used instead (see
// nutritionFor below).
// ─────────────────────────────────────────────────────────────

/** kcal, protein g, carbs g, fat g, fiber g, sugar g, sodium mg, per 100 g. */
type Per100 = [number, number, number, number, number, number, number];

interface Food {
  match: RegExp;
  per100: Per100;
  /** Grams per unit. Missing units fall back to sensible defaults. */
  g: { cup?: number; tbsp?: number; tsp?: number; piece?: number; can?: number; slice?: number; bunch?: number; stalk?: number; head?: number; clove?: number };
}

const SPICE: Per100 = [300, 12, 55, 10, 25, 3, 50];
const HERB: Per100 = [36, 3, 6.3, 0.8, 3.3, 0.9, 56];
const OIL: Per100 = [884, 0, 0, 100, 0, 0, 0];

// Order matters: the first match wins, so specific names come before general ones.
const FOODS: Food[] = [
  // Zero or near-zero
  { match: /\b(water|ice)\b/, per100: [0, 0, 0, 0, 0, 0, 0], g: { cup: 240 } },
  { match: /\b(salt)\b(?! ?and)/, per100: [0, 0, 0, 0, 0, 0, 38758], g: { tsp: 6 } },
  // Sauces and condiments
  { match: /\bsoy sauce|tamari\b/, per100: [53, 8.1, 4.9, 0.6, 0.8, 0.4, 5493], g: { tbsp: 16 } },
  { match: /\bfish sauce\b/, per100: [35, 5, 3.6, 0, 0, 3.6, 7851], g: { tbsp: 18 } },
  { match: /\boyster sauce\b/, per100: [51, 1.4, 11, 0.3, 0.3, 0, 2733], g: { tbsp: 18 } },
  { match: /\bhoisin\b/, per100: [220, 3.3, 44, 3.4, 2.8, 27, 1615], g: { tbsp: 16 } },
  { match: /\bkecap manis\b/, per100: [280, 2, 65, 0, 0, 60, 3800], g: { tbsp: 18 } },
  { match: /\bgochujang\b/, per100: [200, 4, 44, 1.6, 2, 20, 2400], g: { tbsp: 20 } },
  { match: /\bmiso\b/, per100: [198, 12.8, 26, 6, 5.4, 6.2, 3728], g: { tbsp: 17 } },
  { match: /\bcurry paste\b/, per100: [100, 2, 13, 4, 4, 5, 3800], g: { tbsp: 15 } },
  { match: /\bworcestershire\b/, per100: [78, 0, 19.5, 0, 0, 10, 980], g: { tbsp: 17 } },
  { match: /\bmirin\b/, per100: [240, 0.3, 43, 0, 0, 38, 0], g: { tbsp: 18 } },
  { match: /\bsake|wine\b(?! vinegar)/, per100: [134, 0.5, 5, 0, 0, 0, 2], g: { tbsp: 15, cup: 240 } },
  { match: /\bvinegar\b/, per100: [18, 0, 0.1, 0, 0, 0, 2], g: { tbsp: 15, cup: 240 } },
  { match: /\bkimchi juice\b/, per100: [10, 0.5, 2, 0, 0, 1, 900], g: { tbsp: 15 } },
  { match: /\bkimchi\b/, per100: [15, 1.1, 2.4, 0.5, 1.6, 1.1, 498], g: { cup: 150 } },
  { match: /\bsalsa\b/, per100: [36, 1.5, 6.6, 0.2, 1.9, 4, 711], g: { tbsp: 16, cup: 260 } },
  { match: /\bchipotle/, per100: [70, 1.5, 10, 2, 4, 4, 1200], g: { piece: 15 } },
  { match: /\bdashi\b/, per100: [224, 24, 30, 0.5, 0, 0, 16000], g: { tsp: 3 } },
  { match: /\b(broth|stock|bouillon)\b/, per100: [6, 0.6, 0.4, 0.2, 0, 0.3, 350], g: { cup: 240 } },
  { match: /\bcapers?\b/, per100: [23, 2.4, 4.9, 0.9, 3.2, 0.4, 2348], g: { tbsp: 9 } },
  { match: /\bolives?\b(?! oil)/, per100: [145, 1, 3.8, 15, 3.3, 0.5, 1556], g: { cup: 135, piece: 4 } },
  { match: /\btomato paste\b/, per100: [82, 4.3, 19, 0.5, 4.1, 12, 59], g: { tbsp: 16 } },
  { match: /\btomato puree|crushed tomato|canned tomato|tinned tomato|chopped tomatoes \(canned\)/, per100: [35, 1.6, 8, 0.3, 1.9, 4.6, 130], g: { can: 400, cup: 245 } },
  { match: /\bpeanut butter\b/, per100: [588, 25, 20, 50, 6, 9, 430], g: { tbsp: 16, cup: 256 } },
  { match: /\btahini\b/, per100: [595, 17, 21, 54, 9.3, 0.5, 115], g: { tbsp: 15, cup: 240 } },
  { match: /\bcoconut milk\b/, per100: [197, 2, 2.8, 21, 0, 2.8, 13], g: { can: 400, cup: 240 } },
  { match: /\b(sugar)\b/, per100: [387, 0, 100, 0, 0, 100, 1], g: { tbsp: 12.5, tsp: 4, cup: 200 } },
  { match: /\bhoney|maple syrup\b/, per100: [304, 0.3, 82, 0, 0.2, 82, 4], g: { tbsp: 21 } },
  { match: /\bcornstarch|corn starch\b/, per100: [381, 0.3, 91, 0.1, 0.9, 0, 9], g: { tbsp: 8 } },
  { match: /\bbaking powder\b/, per100: [53, 0, 28, 0, 0.2, 0, 10600], g: { tsp: 4.6 } },
  // Fats and dairy
  { match: /\b(sesame oil|olive oil|vegetable oil|cooking oil|canola oil|sunflower oil|neutral oil|oil)\b/, per100: OIL, g: { tbsp: 13.5, cup: 216 } },
  { match: /\bbutter\b/, per100: [717, 0.9, 0.1, 81, 0, 0.1, 576], g: { tbsp: 14, cup: 227 } },
  { match: /\b(heavy|double|whipping) cream|\bcream\b/, per100: [340, 2.8, 2.7, 36, 0, 2.9, 27], g: { cup: 238 } },
  { match: /\bsour cream|creme fraiche|crème fraîche\b/, per100: [198, 2.4, 4.6, 19, 0, 3.4, 31], g: { tbsp: 12, cup: 230 } },
  { match: /\bgreek yogurt\b/, per100: [97, 9, 4, 5, 0, 4, 35], g: { cup: 245 } },
  { match: /\byogh?urt\b/, per100: [61, 3.5, 4.7, 3.3, 0, 4.7, 46], g: { cup: 245 } },
  { match: /\bmilk\b/, per100: [61, 3.2, 4.8, 3.3, 0, 5, 43], g: { cup: 244 } },
  { match: /\bparmesan|parmigiano|pecorino\b/, per100: [392, 36, 3.2, 26, 0, 0.8, 1600], g: { cup: 100, tbsp: 6 } },
  { match: /\bfeta\b/, per100: [264, 14, 4, 21, 0, 4, 917], g: { cup: 150 } },
  { match: /\bmozzarella\b/, per100: [280, 28, 3, 17, 0, 1, 630], g: { cup: 112 } },
  { match: /\b(cheddar|cheese|monterey jack|queso)\b/, per100: [403, 25, 1.3, 33, 0, 0.5, 621], g: { cup: 113, slice: 28 } },
  { match: /\beggs?\b(?! noodles)/, per100: [143, 12.6, 0.7, 9.5, 0, 0.4, 142], g: { piece: 50 } },
  // Meat and fish
  { match: /\bbacon\b/, per100: [541, 37, 1.4, 42, 0, 0, 1717], g: { slice: 9 } },
  { match: /\b(sausage|chorizo)\b/, per100: [300, 12, 2.5, 27, 0, 1, 900], g: { piece: 75 } },
  { match: /\bground chicken|minced chicken\b/, per100: [143, 17.4, 0, 8.1, 0, 0, 60], g: {} },
  { match: /\bdrumsticks?\b/, per100: [161, 19, 0, 9, 0, 0, 90], g: { piece: 75 } },
  { match: /\bchicken thighs?\b/, per100: [121, 19.7, 0, 4.1, 0, 0, 95], g: { piece: 115 } },
  { match: /\b(chicken|turkey)\b(?! broth| stock)/, per100: [120, 22.5, 0, 2.6, 0, 0, 45], g: { piece: 175 } },
  { match: /\bground beef|minced beef|beef mince\b/, per100: [215, 18.6, 0, 15, 0, 0, 66], g: {} },
  { match: /\b(beef|steak|sirloin)\b(?! broth| stock)/, per100: [150, 21, 0, 7, 0, 0, 55], g: {} },
  { match: /\bground lamb|minced lamb|lamb\b/, per100: [282, 16.6, 0, 23.4, 0, 0, 59], g: {} },
  { match: /\bpork\b/, per100: [143, 21, 0, 6, 0, 0, 50], g: { piece: 115 } },
  { match: /\bshrimp|prawns?\b/, per100: [85, 20, 0, 0.5, 0, 0, 119], g: { piece: 10 } },
  { match: /\b(white fish|cod|haddock|tilapia|snapper|sea bass|fish)\b/, per100: [82, 18, 0, 0.7, 0, 0, 54], g: { piece: 150 } },
  { match: /\bsalmon\b/, per100: [208, 20, 0, 13, 0, 0, 59], g: { piece: 150 } },
  { match: /\bsilken tofu\b/, per100: [55, 4.8, 2.9, 2.7, 0.1, 1.3, 5], g: {} },
  { match: /\btofu\b/, per100: [144, 17.3, 2.8, 8.7, 2.3, 0.6, 14], g: {} },
  // Beans, lentils, nuts
  { match: /\bbaked beans\b/, per100: [94, 4.8, 21, 0.4, 4, 8, 380], g: { can: 415 } },
  { match: /\bgreen beans?\b/, per100: [31, 1.8, 7, 0.2, 2.7, 3.3, 6], g: { cup: 110 } },
  { match: /\bbean sprouts?\b/, per100: [30, 3, 5.9, 0.2, 1.8, 4.1, 6], g: { cup: 104 } },
  { match: /\bchickpeas?|garbanzo/, per100: [139, 7, 22.5, 2.7, 7.6, 0, 246], g: { can: 240, cup: 160 } },
  { match: /\bbeans?\b/, per100: [110, 7, 20, 0.4, 7, 0.3, 230], g: { can: 240, cup: 172 } },
  { match: /\blentils?\b/, per100: [358, 24, 63, 2.2, 11, 2, 7], g: { cup: 190 } },
  { match: /\bpeas\b/, per100: [77, 5.2, 13.6, 0.4, 4.5, 4.7, 108], g: { cup: 134 } },
  { match: /\bpeanuts?\b/, per100: [585, 24, 21, 50, 8, 4, 6], g: { cup: 146 } },
  { match: /\bwalnuts?|cashews?|almonds?|pistachios?\b/, per100: [620, 17, 20, 55, 7, 4, 3], g: { cup: 120 } },
  { match: /\bsesame seeds?\b/, per100: [573, 18, 23, 50, 12, 0.3, 11], g: { tsp: 3, tbsp: 9 } },
  // Grains and starches
  { match: /\brice paper\b/, per100: [330, 6, 74, 0.6, 1, 0, 400], g: { piece: 9 } },
  { match: /\brice (noodles|vermicelli)|vermicelli\b/, per100: [364, 6, 80, 0.6, 1.6, 0, 182], g: {} },
  { match: /\begg noodles|pancit|ramen|udon|noodles\b/, per100: [384, 14, 71, 4.4, 3.3, 2, 21], g: {} },
  { match: /\b(spaghetti|macaroni|penne|linguine|fettuccine|pasta|orzo)\b/, per100: [371, 13, 75, 1.5, 3.2, 2.7, 6], g: { cup: 105 } },
  { match: /\bcooked (jasmine |basmati |white )?rice|rice, cooked\b/, per100: [130, 2.7, 28, 0.3, 0.4, 0.1, 1], g: { cup: 158 } },
  { match: /\brice\b(?! vinegar| wine)/, per100: [365, 7.1, 80, 0.7, 1.3, 0.1, 5], g: { cup: 185 } },
  { match: /\bquinoa\b/, per100: [368, 14, 64, 6.1, 7, 0, 5], g: { cup: 170 } },
  { match: /\bcouscous\b/, per100: [376, 12.8, 77, 0.6, 5, 0, 10], g: { cup: 173 } },
  { match: /\bbreadcrumbs?|panko\b/, per100: [395, 13, 72, 5, 4.5, 6, 730], g: { cup: 108 } },
  { match: /\bcorn tortillas?\b/, per100: [218, 5.7, 45, 2.9, 6.3, 0.9, 45], g: { piece: 26 } },
  { match: /\b(flour tortillas?|tortillas?|wraps?)\b/, per100: [304, 8, 51, 7.5, 3.5, 2.5, 620], g: { piece: 45 } },
  { match: /\bflour\b/, per100: [364, 10, 76, 1, 2.7, 0.3, 2], g: { cup: 125, tbsp: 8 } },
  { match: /\bpitas?\b/, per100: [275, 9, 56, 1.2, 2.2, 1.3, 536], g: { piece: 60 } },
  { match: /\bburger buns?|buns?\b/, per100: [279, 9.5, 50, 4.3, 2, 6, 480], g: { piece: 52 } },
  { match: /\b(bread|baguette|toast)\b/, per100: [270, 9, 51, 3, 2.5, 3, 600], g: { slice: 30, piece: 30 } },
  { match: /\bfries\b/, per100: [150, 2.3, 24, 5, 2, 0.3, 280], g: {} },
  { match: /\bsweet potato/, per100: [86, 1.6, 20, 0.1, 3, 4.2, 55], g: { piece: 130 } },
  { match: /\bpotato/, per100: [77, 2, 17, 0.1, 2.2, 0.8, 6], g: { piece: 213 } },
  // Vegetables and fruit
  { match: /\bcorn\b/, per100: [86, 3.3, 19, 1.4, 2, 6.3, 15], g: { cup: 150 } },
  { match: /\blemongrass\b/, per100: [99, 1.8, 25, 0.5, 0, 0, 6], g: { stalk: 20 } },
  { match: /\bpreserved lemon\b/, per100: [30, 1, 8, 0.3, 3, 2, 5000], g: { piece: 30 } },
  { match: /\blemons?\b/, per100: [22, 0.4, 6.9, 0.2, 0.3, 2.5, 1], g: { piece: 48 } },
  { match: /\blimes?\b/, per100: [25, 0.4, 8.4, 0.1, 0.4, 1.7, 2], g: { piece: 44 } },
  { match: /\borange\b/, per100: [47, 0.9, 12, 0.1, 2.4, 9.4, 0], g: { piece: 130 } },
  { match: /\braisins?\b/, per100: [299, 3.1, 79, 0.5, 3.7, 59, 11], g: { cup: 145 } },
  { match: /\bavocados?\b/, per100: [160, 2, 8.5, 14.7, 6.7, 0.7, 7], g: { piece: 136 } },
  { match: /\bshallots?\b/, per100: [72, 2.5, 17, 0.1, 3.2, 7.9, 12], g: { piece: 25 } },
  { match: /\bonions?\b/, per100: [40, 1.1, 9.3, 0.1, 1.7, 4.2, 4], g: { piece: 110, cup: 160 } },
  { match: /\bgarlic\b(?! powder)/, per100: [149, 6.4, 33, 0.5, 2.1, 1, 17], g: { clove: 3, piece: 3 } },
  { match: /\bginger\b(?! powder)(?!.*ground)/, per100: [80, 1.8, 18, 0.8, 2, 1.7, 13], g: { piece: 15 } },
  { match: /\bbell peppers?|capsicum/, per100: [26, 1, 6, 0.3, 2.1, 4.2, 4], g: { piece: 120 } },
  { match: /\b(chil(i|e|li)(e?s)?|jalape|serrano|scotch bonnet|aji)\b(?! powder| flakes)/, per100: [40, 1.9, 9, 0.4, 1.5, 5, 9], g: { piece: 10 } },
  { match: /\btomato/, per100: [18, 0.9, 3.9, 0.2, 1.2, 2.6, 5], g: { piece: 123, cup: 180 } },
  { match: /\bcarrots?\b/, per100: [41, 0.9, 9.6, 0.2, 2.8, 4.7, 69], g: { piece: 61, cup: 128 } },
  { match: /\bzucchini|courgette/, per100: [17, 1.2, 3.1, 0.3, 1, 2.5, 8], g: { piece: 196 } },
  { match: /\beggplant|aubergine/, per100: [25, 1, 5.9, 0.2, 3, 3.5, 2], g: { piece: 458 } },
  { match: /\bcucumbers?\b/, per100: [15, 0.7, 3.6, 0.1, 0.5, 1.7, 2], g: { piece: 300 } },
  { match: /\bspinach\b/, per100: [23, 2.9, 3.6, 0.4, 2.2, 0.4, 79], g: { cup: 30 } },
  { match: /\bcollard|kale|chard\b/, per100: [32, 3, 5.4, 0.6, 4, 0.5, 17], g: { bunch: 350, cup: 36 } },
  { match: /\bcabbage|bok choy\b/, per100: [25, 1.3, 5.8, 0.1, 2.5, 3.2, 18], g: { cup: 70 } },
  { match: /\blettuce|romaine\b/, per100: [17, 1.2, 3.3, 0.3, 2.1, 1.2, 8], g: { cup: 47, head: 500, piece: 500 } },
  { match: /\bradish/, per100: [16, 0.7, 3.4, 0.1, 1.6, 1.9, 39], g: { piece: 5 } },
  { match: /\bmushrooms?\b/, per100: [22, 3.1, 3.3, 0.3, 1, 2, 5], g: { cup: 70 } },
  { match: /\bscallions?|green onions?|spring onions?\b/, per100: [32, 1.8, 7.3, 0.2, 2.6, 2.3, 16], g: { piece: 15 } },
  { match: /\bwakame|seaweed\b/, per100: [45, 3, 9, 0.6, 0.5, 0.7, 870], g: { tbsp: 1 } },
  { match: /\b(cilantro|parsley|dill|mint|basil|chives|tarragon|herbs?)\b/, per100: HERB, g: { cup: 40, tbsp: 4, bunch: 60 } },
  // Spices: tiny amounts, counted so the coverage note stays honest.
  {
    match: /\b(cumin|paprika|oregano|thyme|turmeric|curry powder|garam masala|ras el hanout|sumac|berbere|chili powder|red pepper flakes|chili flakes|cayenne|allspice|cinnamon|nutmeg|peppercorns?|black pepper|saffron|bay lea(f|ves)|mustard powder|ground ginger|garlic powder|spice)\b/,
    per100: SPICE,
    g: { tsp: 2.5, tbsp: 7.5, piece: 0.5 },
  },
];

const DEFAULT_G: Required<Food['g']> = { cup: 240, tbsp: 15, tsp: 5, piece: NaN, can: 400, slice: 28, bunch: 100, stalk: 40, head: 500, clove: 3 };

/** Grams for an amount and unit, or null if it can't be worked out. */
function toGrams(food: Food, amount: number, unit: string, name: string): number | null {
  const u = unit.toLowerCase().replace(/\.$/, '');
  const g = { ...DEFAULT_G, ...food.g };
  if (!g.tbsp && g.cup) g.tbsp = g.cup / 16;
  if (food.g.cup && !food.g.tbsp) g.tbsp = food.g.cup / 16;
  if (!food.g.tsp) g.tsp = g.tbsp / 3;
  let per: number;
  if (/^(g|grams?)$/.test(u)) per = 1;
  else if (/^(kg|kilograms?)$/.test(u)) per = 1000;
  else if (/^(oz|ounces?)$/.test(u)) per = 28.35;
  else if (/^(lbs?|pounds?)$/.test(u)) per = 453.6;
  else if (/^(ml|millilit(er|re)s?)$/.test(u)) per = 1;
  else if (/^(l|lit(er|re)s?)$/.test(u)) per = 1000;
  else if (/^(cups?|c)$/.test(u)) per = g.cup;
  else if (/^(tbsp|tbs|tablespoons?)$/.test(u)) per = g.tbsp;
  else if (/^(tsp|teaspoons?)$/.test(u)) per = g.tsp;
  else if (/^(cans?|tins?)$/.test(u)) per = g.can;
  else if (/^cloves?$/.test(u)) per = g.clove;
  else if (/^slices?$/.test(u)) per = g.slice;
  else if (/^bunch(es)?$/.test(u)) per = g.bunch;
  else if (/^stalks?$/.test(u)) per = g.stalk;
  else if (/^heads?$/.test(u)) per = g.head;
  else if (/^thumbs?|knobs?$/.test(u)) per = 15;
  else if (/^handfuls?$/.test(u)) per = 30;
  else if (/^(sprigs?|pinch(es)?|dash(es)?)$/.test(u)) per = 0.5;
  else if (/^(sticks?)$/.test(u)) per = /butter/.test(name) ? 113 : 3;
  else if (!u || /^(pieces?|whole|large|medium|small)$/.test(u)) per = g.piece;
  else return null;
  if (!isFinite(per)) return null;
  // "2 large baking potatoes": size words nudge a per-piece weight.
  if (!u || /^pieces?$/.test(u)) per *= /\blarge\b/.test(name) ? 1.4 : /\bsmall\b/.test(name) ? 0.7 : 1;
  return amount * per;
}

export const foodFor = (name: string) => {
  const t = name.toLowerCase().replace(/\(.*?\)/g, ' ');
  return FOODS.find((f) => f.match.test(t));
};

export interface NutritionEstimate {
  perServing: Nutrition;
  /** Ingredients with an amount that Gusteau couldn't count. */
  missing: string[];
  /** Ingredients listed without an amount ("to serve"), not counted. */
  unmeasured: string[];
}

const ZERO: Nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };

export function estimateNutrition(recipe: Pick<Recipe, 'ingredients' | 'servings'>): NutritionEstimate {
  const total = { ...ZERO };
  const missing: string[] = [];
  const unmeasured: string[] = [];
  for (const i of recipe.ingredients as RecipeIngredient[]) {
    const food = foodFor(i.name);
    if (i.amount === null || i.amount === 0) {
      if (food?.per100 !== SPICE && food?.per100 !== HERB && !/\b(salt|pepper|water)\b/i.test(i.name)) unmeasured.push(i.name);
      continue;
    }
    const grams = food ? toGrams(food, i.amount, i.unit, i.name.toLowerCase()) : null;
    if (!food || grams === null) {
      missing.push(i.name);
      continue;
    }
    // Most frying oil stays in the pan.
    const used = food.per100 === OIL && /\bfry|frying\b/i.test(`${i.name} ${i.note ?? ''}`) ? 0.15 : 1;
    const f = (grams * used) / 100;
    const [kcal, protein, carbs, fat, fiber, sugar, sodium] = food.per100;
    total.calories += kcal * f;
    total.protein += protein * f;
    total.carbs += carbs * f;
    total.fat += fat * f;
    total.fiber! += fiber * f;
    total.sugar! += sugar * f;
    total.sodium! += sodium * f;
  }
  const n = Math.max(1, recipe.servings);
  const per = (v: number) => v / n;
  return {
    perServing: {
      calories: per(total.calories),
      protein: per(total.protein),
      carbs: per(total.carbs),
      fat: per(total.fat),
      fiber: per(total.fiber!),
      sugar: per(total.sugar!),
      sodium: per(total.sodium!),
    },
    missing,
    unmeasured,
  };
}

export interface NutritionView {
  perServing: Nutrition;
  source: 'database' | 'database-adjusted' | 'estimate';
  missing: string[];
  unmeasured: string[];
}

/**
 * Nutrition for what will actually be cooked. Database figures win; when
 * Gusteau has changed the recipe, they're shifted by the estimated
 * difference its changes make.
 */
export function nutritionFor(planned: Recipe, original: Recipe): NutritionView {
  const est = estimateNutrition(planned);
  if (!original.nutrition) return { perServing: est.perServing, source: 'estimate', missing: est.missing, unmeasured: est.unmeasured };
  if (!planned.adaptedFrom) return { perServing: original.nutrition, source: 'database', missing: [], unmeasured: [] };
  const base = estimateNutrition(original).perServing;
  const db = original.nutrition;
  const shift = (k: keyof Nutrition) => (db[k] === undefined ? undefined : Math.max(0, db[k]! + (est.perServing[k]! - base[k]!)));
  return {
    perServing: {
      calories: shift('calories')!,
      protein: shift('protein')!,
      carbs: shift('carbs')!,
      fat: shift('fat')!,
      fiber: shift('fiber'),
      sugar: shift('sugar'),
      sodium: shift('sodium'),
    },
    source: 'database-adjusted',
    missing: est.missing,
    unmeasured: [],
  };
}
