import type { AdaptResult } from '../../agent/adapt';
import type { CookSession, DetectedIngredient, Recipe } from '../../types';
import type { ChefModelService, InterpretResult, PhotoInput, StageResult } from '../modelService';
import { parseIntent } from './intentParser';
import { MOCK_FRIDGE_DETECTIONS, MOCK_PANTRY_DETECTIONS } from './mockData';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fully local stand-in for a real model.
 * - analyzePhotos    → canned detections
 * - interpretMessage → rule-based intent parser
 * - stageRecipe      → the stages the database or Gusteau's heuristic already set
 * - adaptPlan        → Gusteau's rule-based replan, unchanged
 */
export class MockModelService implements ChefModelService {
  readonly mode = 'mock' as const;
  readonly label = 'Demo mode · mock AI';

  async analyzePhotos(photos: PhotoInput[]): Promise<DetectedIngredient[]> {
    await wait(2000);
    const hint = photos.map((p) => p.name.toLowerCase()).join(' ');
    if (photos.length === 1 && /pantry|shelf|cupboard/.test(hint)) return MOCK_PANTRY_DETECTIONS;
    return [...MOCK_FRIDGE_DETECTIONS, ...MOCK_PANTRY_DETECTIONS];
  }

  async interpretMessage(message: string, session: CookSession): Promise<InterpretResult> {
    await wait(350);
    return parseIntent(message, session);
  }

  async stageRecipe(recipe: Recipe): Promise<StageResult> {
    return { stages: recipe.stages, by: recipe.stagesBy ?? 'gusteau' };
  }

  async adaptPlan(_session: CookSession, draft: AdaptResult): Promise<AdaptResult> {
    await wait(500);
    return draft;
  }
}
