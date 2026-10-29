import { isStaple } from '../data/ingredients';
import { techniqueFor, techniqueQuery } from '../data/techniques';
import type { Recipe, RecipeStep } from '../types';

// ─────────────────────────────────────────────────────────────
// "Try asking…" for each step: questions cooks commonly have at that
// point, worded the way Gusteau answers best. How to do the step's
// technique ("Show me how to sear meat in a pan", short videos), and what
// an unfamiliar ingredient or piece of cookware looks like ("What does
// gochujang look like?", a definition with pictures).
// ─────────────────────────────────────────────────────────────

/** Ingredients everyone knows by sight: asking what they look like isn't a common question. */
const FAMILIAR =
  /^((ground |fresh |dried |cooked |shredded |grated |chopped |sliced |large |small |red |yellow |white |brown |unsalted |salted |firm |extra[- ]virgin )*)(onions?|garlic|garlic cloves?|salt|pepper|black pepper|oil|olive oil|vegetable oil|butter|water|eggs?|rice|long-grain rice|chicken|chicken breasts?|chicken thighs?|beef|pork|bacon|sausages?|tomato(es)?|crushed tomatoes|cheese|cheddar( cheese)?|mozzarella|parmesan|milk|flour|sugar|lemons?|limes?|lemon juice|lime juice|potato(es)?|carrots?|bread|buns|burger buns|pasta|spaghetti|macaroni|noodles|beans|black beans|lettuce|lettuce leaves|cream|heavy cream|yogurt|honey|parsley|cilantro|basil|mint|ketchup|mustard|mayonnaise|vinegar|soy sauce|broth|stock|chicken broth|vegetable broth|coconut milk|bell peppers?|green beans|peas|corn|spinach|zucchini|mushrooms?|cucumbers?|apples?|bananas?|tofu|peanuts|ginger|scallions?|green onions?|shrimp|salmon|tortillas?|salsa|oregano|thyme|cumin|paprika|cinnamon|chili flakes|red pepper flakes)$/i;

/** Steps that aren't a technique to learn: "Serve", "Assemble", "Bring it together". */
const NOT_A_TECHNIQUE = /^(serve|to serve|assemble|season( to taste)?|plate|garnish|finish|enjoy|rest|top and serve|bring it together|eat|divide)\b/i;

/** Cookware a step might name, most specific first. */
const COOKWARE = [
  'dutch oven', 'cast-iron skillet', 'cast iron skillet', 'nonstick skillet', 'wok', 'tagine', 'bamboo steamer', 'steamer basket',
  'mortar and pestle', 'mandoline', 'microplane', 'zester', 'box grater', 'food processor', 'immersion blender', 'ramekin',
  'sheet pan', 'roasting pan', 'baking dish', 'stockpot', 'saucepan', 'skillet', 'colander', 'sieve', 'whisk', 'tongs', 'spatula', 'skewers?',
];
const COOKWARE_RE = new RegExp(`\\b(${COOKWARE.join('|')})\\b`, 'i');

/** "a wok", "an immersion blender", "skewers". */
const withArticle = (thing: string) => (/s$/.test(thing) && !/ss$/.test(thing) ? thing : `${/^[aeiou]/i.test(thing) ? 'an' : 'a'} ${thing}`);
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The ingredient's name as you'd say it: "Gochujang (Korean chili paste)" → "gochujang", "pancit canton or egg noodles" → "pancit canton". */
const plainName = (name: string) => name.replace(/\(.*?\)|,.*$|\s+or\s+.*$/g, '').trim().toLowerCase();
/** "What does gochujang look like?", "What do bean sprouts look like?" */
const lookLike = (thing: string) => `What ${/[^s]s$/.test(thing) && !/^(an? )/.test(thing) ? 'do' : 'does'} ${thing} look like?`;

/** Up to two questions worth asking at this step, the technique first. */
export function stepPrompts(step: RecipeStep, recipe: Recipe): string[] {
  const out: string[] = [];
  // How to do it: the known technique, or the step itself ("Shape the patties").
  const t = techniqueFor(step);
  const title = step.title.replace(/[.:!]$/, '').trim();
  const how = t ? techniqueQuery(t) : NOT_A_TECHNIQUE.test(title) ? '' : lowerFirst(title);
  if (how) out.push(`Show me how to ${how}`);
  // What something looks like: an ingredient people may not know, or the cookware it's made in.
  const unfamiliar = recipe.ingredients.find((i) => step.uses.includes(i.id) && !isStaple(i.name) && !FAMILIAR.test(plainName(i.name)));
  const tool = `${step.title}. ${step.text}`.match(COOKWARE_RE)?.[1]?.toLowerCase();
  if (unfamiliar) out.push(lookLike(plainName(unfamiliar.name)));
  else if (tool) out.push(lookLike(withArticle(tool.replace(/^cast iron/, 'cast-iron'))));
  // Every step gets one: "Serve" or "Assemble" borrows the recipe's least familiar ingredient, or asks about the step itself.
  if (!out.length) {
    const any = recipe.ingredients.find((i) => !isStaple(i.name) && !FAMILIAR.test(plainName(i.name)));
    out.push(any ? lookLike(plainName(any.name)) : `Show me how to ${lowerFirst(title)}`);
  }
  return out;
}
