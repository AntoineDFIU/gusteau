import type { AdaptResult } from '../../agent/adapt';
import type { CookSession, Recipe } from '../../types';
import type { ChefModelService, DiscoverIntent, InterpretResult, StageResult } from '../modelService';
import { parseIntent } from './intentParser';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fully local stand-in for a real model.
 * - interpretMessage → rule-based intent parser
 * - stageRecipe      → the stages the database or Gusteau's heuristic already set
 * - adaptPlan        → Gusteau's rule-based replan, unchanged
 * - phraseSteps      → nothing (Gusteau's own spoken wording is used)
 * - discover         → nothing (choosing by voice uses the rule-based reading)
 */
export class MockModelService implements ChefModelService {
  readonly mode = 'mock' as const;
  readonly label = 'Demo mode · mock AI';
  readonly textModel = '';
  setTextModel(): void {}

  async interpretMessage(message: string, session: CookSession): Promise<InterpretResult> {
    await wait(350);
    return parseIntent(message, session);
  }

  async warmUp(): Promise<void> {}

  async stageRecipe(recipe: Recipe): Promise<StageResult> {
    return { stages: recipe.stages, by: recipe.stagesBy ?? 'gusteau' };
  }

  async adaptPlan(_session: CookSession, draft: AdaptResult): Promise<AdaptResult> {
    await wait(500);
    return draft;
  }

  /** No model to phrase steps: Gusteau's own spoken wording is used. */
  async phraseSteps(): Promise<Record<string, string>> {
    return {};
  }

  /** No model: choosing by voice uses the rule-based reading. */
  async discover(): Promise<DiscoverIntent | null> {
    return null;
  }
}
