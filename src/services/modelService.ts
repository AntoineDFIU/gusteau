import type { AdaptPrior, AdaptResult } from '../agent/adapt';
import type { CookCommand, CookSession, DetectedIngredient, Recipe, RecipeStage, SessionChange } from '../types';

// ─────────────────────────────────────────────────────────────
// The ONE seam between Gusteau's UI/agent loop and any model.
//
//   MockModelService          → src/services/mock/  (default, offline)
//   OpenAICompatModelService  → src/services/llm/   (NVIDIA Nemotron on
//                               Nebius Token Factory, or Ollama)
//
// The model proposes; Gusteau's validators decide. Every stage
// grouping and every plan a model writes is checked before use.
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
  /** A cooking command such as "next" or "set a timer". */
  command?: CookCommand;
  /** Short label for the "Plan updated" banner, e.g. "You're out of rice". */
  trigger?: string;
  /** Technique clip to offer alongside the reply. */
  techniqueId?: string;
  /** Changes the reply offers ("want me to switch?"); a yes applies them. */
  offer?: SessionChange[];
  /** Start a timer with the reply, e.g. "give it one more minute". */
  timerSeconds?: number;
}

export interface StageResult {
  stages: RecipeStage[];
  by: NonNullable<Recipe['stagesBy']>;
}

export interface ChefModelService {
  readonly mode: 'mock' | 'llm';
  readonly label: string;

  /** Image understanding + ingredient extraction. */
  analyzePhotos(photos: PhotoInput[]): Promise<DetectedIngredient[]>;

  /**
   * Turn a chat or voice message into changes, a command, or a reply.
   * `onReply` receives a plain answer while it's still being written (never
   * for plan changes, whose reply comes from the validated replan), so it
   * can be read aloud early.
   */
  interpretMessage(message: string, session: CookSession, opts?: { onReply?(textSoFar: string): void }): Promise<InterpretResult>;

  /** Load the model so the first spoken question doesn't wait for it. */
  warmUp(): Promise<void>;

  /** Group a recipe's steps into 3–5 stages with supported icons. */
  stageRecipe(recipe: Recipe): Promise<StageResult>;

  /**
   * Gusteau's rule-based replanner has produced `draft`. When it couldn't
   * solve something, a model may propose a fix; it is validated before use.
   */
  adaptPlan(session: CookSession, draft: AdaptResult, prior: AdaptPrior): Promise<AdaptResult>;
}
