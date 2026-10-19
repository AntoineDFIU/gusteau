import { planWithTemplates, type PlanResult } from '../../agent/planner';
import type { DetectedIngredient, Recipe, SessionState } from '../../types';
import type { ChefModelService, InterpretResult, PhotoInput } from '../modelService';
import { MOCK_FRIDGE_DETECTIONS, MOCK_PANTRY_DETECTIONS } from './mockData';
import { parseIntent } from './intentParser';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fully local stand-in for the NVIDIA Nemotron model.
 * - analyzePhotos  → canned detections (photo 1 = fridge, photo 2 = pantry)
 * - planRecipe     → deterministic template planner
 * - interpretMessage → rule-based intent parser
 */
export class MockModelService implements ChefModelService {
  readonly mode = 'mock' as const;
  readonly label = 'Demo mode · mock AI';

  async analyzePhotos(photos: PhotoInput[]): Promise<DetectedIngredient[]> {
    await wait(2400);
    if (photos.length >= 2) return [...MOCK_FRIDGE_DETECTIONS, ...MOCK_PANTRY_DETECTIONS];
    const hint = (photos[0]?.name ?? '').toLowerCase();
    if (/pantry|shelf|cupboard/.test(hint)) return MOCK_PANTRY_DETECTIONS;
    // One photo: show the full believable fridge-and-shelf haul.
    return [...MOCK_FRIDGE_DETECTIONS, ...MOCK_PANTRY_DETECTIONS];
  }

  async planRecipe(state: SessionState, previous: Recipe | null): Promise<PlanResult> {
    await wait(previous ? 700 : 1400);
    return planWithTemplates(state, previous, state.completedStepKeys);
  }

  async interpretMessage(message: string, state: SessionState): Promise<InterpretResult> {
    await wait(450);
    return parseIntent(message, state);
  }
}
