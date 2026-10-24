import type { Recipe } from '../types';
import { parseCsv } from './csv';
import { normalizeRecipe } from './normalize';

// ─────────────────────────────────────────────────────────────
// Where recipes come from. The app only talks to RecipeSource,
// so moving from the bundled sample file to the real recipe
// database means writing one new source, not touching screens.
//
// Today: StaticFileRecipeSource reads public/recipes/recipes.json
// (or recipes.csv). Drop a new export in that folder to replace
// the sample recipes; no rebuild is needed on the Pi.
// ─────────────────────────────────────────────────────────────

export interface RecipeLibrary {
  recipes: Recipe[];
  /** Records that couldn't be read, for the console and the README checklist. */
  skipped: number;
  origin: string;
}

export interface RecipeSource {
  load(): Promise<RecipeLibrary>;
}

export function parseRecipeFile(text: string, kind: 'json' | 'csv'): { recipes: Recipe[]; skipped: number } {
  let rows: Record<string, unknown>[];
  if (kind === 'csv') rows = parseCsv(text);
  else {
    const data = JSON.parse(text) as unknown;
    rows = (Array.isArray(data) ? data : ((data as { recipes?: unknown[] })?.recipes ?? [])) as Record<string, unknown>[];
  }
  const recipes: Recipe[] = [];
  const ids = new Set<string>();
  rows.forEach((row, i) => {
    const r = row && typeof row === 'object' ? normalizeRecipe(row, i) : null;
    if (!r) return;
    while (ids.has(r.id)) r.id = `${r.id}-${i}`;
    ids.add(r.id);
    recipes.push(r);
  });
  return { recipes, skipped: rows.length - recipes.length };
}

export class StaticFileRecipeSource implements RecipeSource {
  constructor(private readonly base = `${import.meta.env.BASE_URL}recipes/`) {}

  async load(): Promise<RecipeLibrary> {
    for (const [file, kind] of [
      ['recipes.json', 'json'],
      ['recipes.csv', 'csv'],
    ] as const) {
      try {
        const res = await fetch(`${this.base}${file}`, { cache: 'no-cache' });
        if (!res.ok) continue;
        const { recipes, skipped } = parseRecipeFile(await res.text(), kind);
        if (skipped) console.warn(`[Gusteau] Skipped ${skipped} recipe record(s) in ${file} that had no title, ingredients or steps.`);
        if (recipes.length) return { recipes, skipped, origin: file };
      } catch (err) {
        console.warn(`[Gusteau] Couldn't read ${file}`, err);
      }
    }
    return { recipes: [], skipped: 0, origin: 'none' };
  }
}

export const recipeSource: RecipeSource = new StaticFileRecipeSource();
