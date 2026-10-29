import { missingIn } from './discovery';
import type { Recipe, RecipeIngredient } from '../types';

const clean = (text: string) => text.toLowerCase().replace(/[‘’]/g, "'").replace(/[?!.]/g, '').trim();
const SWAP = /\b(replac\w*|substitut\w*|swap\w*|switch|alternative\w*|instead|in place of|what (?:else )?can i use)\b/;

/** Ingredient questions belong to the open recipe, even if no ingredient matches. */
export function previewSubstitution(text: string, recipe: Recipe): { ingredient?: RecipeIngredient; to?: string } | null {
  const t = clean(text);
  if (!SWAP.test(t)) return null;
  const direct = t.match(/\b(?:replace|swap|switch) (?:out )?(.+?) (?:with|for) (.+)$/);
  const instead = t.match(/\b(?:use|have|try) (.+?) instead of (.+)$/);
  const substitute = t.match(/\bsubstitute (.+?) for (.+)$/);
  const from = direct?.[1] ?? instead?.[2] ?? substitute?.[2];
  const to = direct?.[2] ?? instead?.[1] ?? substitute?.[1];
  // Reuse recipe-specific matching, including speech recognition corrections.
  const ingredient = from
    ? missingIn(`I don't have ${from}`, recipe)?.found[0]
    : recipe.ingredients.find((i) => i.name.toLowerCase().split(/[^a-z]+/).some((w) => w.length > 2 && new RegExp(`\\b${w}\\b`).test(t)));
  return { ingredient, to: to?.replace(/\s+please$/, '').trim() };
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
