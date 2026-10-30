import { missingIn } from './discovery';
import { namedThing } from './missing';
import type { PendingChoice, Recipe, RecipeIngredient } from '../types';

const clean = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[?!.]/g, '').trim();
const SWAP = /\b(replac\w*|substitut\w*|swap\w*|switch|alternative\w*|instead|in place of|what (?:else )?can i use)\b/;

export interface PendingPreviewIngredient {
  recipeId: string;
  to?: string;
}

export const PREVIEW_INGREDIENT_QUESTION = 'Which ingredient would you like to replace in this recipe? You can say just its name.';

/** Questions and retries must not become proposed substitute names. */
export function substitutionClarification(text: string): boolean {
  const t = clean(text);
  if (/^(?:what|how) about\b/.test(t)) return false;
  return /^(?:what|which|why|how|huh|pardon|sorry|repeat|say (?:that|it) again|(?:can|could|would) you (?:repeat|explain|say)|do you mean|i (?:don't|do not|didn't|did not) (?:understand|hear|catch))\b/.test(t);
}

/** Ingredient questions belong to the open recipe, even if no ingredient matches. */
export function previewSubstitution(text: string, recipe: Recipe, pending?: PendingPreviewIngredient | null, choice?: Pick<PendingChoice, 'current'> | null): { ingredient?: RecipeIngredient; to?: string } | null {
  const t = clean(text);
  const waiting = pending?.recipeId === recipe.id;
  const requested = SWAP.test(t);
  if (!requested && !waiting) return null;
  const direct = t.match(/\b(?:replace|swap|switch) (?:out )?(.+?) (?:with|for|to) (.+)$/);
  const targetOnly = t.match(/\b(?:replace|swap|switch) (?:with|for|to) (.+)$/);
  const instead = t.match(/\b(?:use|have|try) (.+?) instead of (.+)$/);
  const substitute = t.match(/\bsubstitute (.+?) for (.+)$/);
  const from = direct?.[1] ?? instead?.[2] ?? substitute?.[2];
  const to = direct?.[2] ?? instead?.[1] ?? substitute?.[1] ?? targetOnly?.[1];
  // Reuse recipe-specific matching, including speech recognition corrections.
  let ingredient: RecipeIngredient | undefined;
  if ((from && /^(?:it|that|this|them|that ingredient|this ingredient|the ingredient)$/.test(from)) || targetOnly) {
    // The ingredient was established by the open question: "swap it with Swiss".
    // Never infer the source from a word in the replacement (e.g. "cheese").
    ingredient = recipe.ingredients.find((i) => i.name === choice?.current);
  } else if (from) ingredient = missingIn(`I don't have ${from}`, recipe)?.found[0];
  else if (requested) {
    ingredient = recipe.ingredients.find((i) => i.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 2 && new RegExp(`\\b${w}\\b`).test(t)));
  } else if (!substitutionClarification(t)) {
    const name = namedThing(t.replace(/^i (?:said|meant)\s+/, ''));
    ingredient = missingIn(t, recipe)?.found[0];
    if (!ingredient && name) ingredient = missingIn(`I don't have ${name}`, recipe)?.found[0];
  }
  return { ingredient, to: to?.replace(/\s+please$/, '').trim() ?? (waiting ? pending.to : undefined) };
}

/** Searching from a preview requires an explicit request for dishes. */
export function previewRequestsRecipes(text: string): boolean {
  const t = clean(text);
  if (/\b(?:show|find|search|look for|browse|suggest|recommend)\b/.test(t)
    && /\b(?:recipes|dishes|meals|(?:a|another|other|different) (?:recipe|dish|meal))\b/.test(t)) return true;
  if (SWAP.test(t)) return false;
  return (/\b(?:show|find|search|look for|browse|suggest|recommend)\b/.test(t)
    && /\b(?:recipes?|dishes|meals?|something|options)\b/.test(t))
    || /\b(?:show me|let's (?:make|cook)|i (?:want|would like) to (?:make|cook))\s+(?!(?:it|this|that)(?:\b|$))\S/.test(t);
}
