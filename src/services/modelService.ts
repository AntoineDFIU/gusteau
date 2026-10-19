import type { PlanResult } from '../agent/planner';
import type { DetectedIngredient, Recipe, SessionChange, SessionState } from '../types';

// ─────────────────────────────────────────────────────────────
// The ONE seam between Gusteau's UI/agent loop and any model.
//
//   MockModelService          → src/services/mock/  (default, offline)
//   OpenAICompatModelService  → src/services/llm/   (NVIDIA Nemotron on
//                               Nebius Token Factory, or Ollama)
//
// The UI only ever talks to `ChefModelService`, so swapping the
// mock for a real model is a config change, not a rewrite.
// ─────────────────────────────────────────────────────────────

export interface PhotoInput {
  name: string;
  /** data: URL (base64) of the image */
  dataUrl: string;
}

export interface InterpretResult {
  /** A direct reply when the message is a question, not a change. */
  reply: string | null;
  /** Structured state changes that trigger a full replan. */
  changes: SessionChange[];
  /** Short label for the "Plan updated" banner, e.g. "You're out of rice". */
  trigger?: string;
}

export interface ChefModelService {
  readonly mode: 'mock' | 'llm';
  readonly label: string;

  /** Image understanding + ingredient extraction. */
  analyzePhotos(photos: PhotoInput[]): Promise<DetectedIngredient[]>;

  /** Recipe planning. Must respect every hard constraint in `state`. */
  planRecipe(state: SessionState, previous: Recipe | null): Promise<PlanResult>;

  /** Conversational replanning: turn a chat message into state changes. */
  interpretMessage(message: string, state: SessionState): Promise<InterpretResult>;
}
