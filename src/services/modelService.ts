import type { AdaptPrior, AdaptResult } from '../agent/adapt';
import type { CookCommand, CookSession, PendingChoice, Recipe, RecipeStage, SessionChange } from '../types';

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
  /** Swap options listed in the reply; naming one picks it. */
  choice?: PendingChoice;
  /** An ingredient or tool to define and show pictures of. */
  explain?: string;
  /** A technique to show short videos of, e.g. "dice an onion". */
  howTo?: string;
  /** How a spoken message was understood, when that differs in meaning from the transcript ("…the steaks"). Shown, never swapped in. */
  interpreted?: string;
  /** The cook already agreed to these changes (they answered an offer), so they apply without asking again. */
  confirmed?: boolean;
}

/** What the model knows while helping choose a dish. */
export interface DiscoverContext {
  /** The dishes on screen, in order, as the cook can pick them by name or position. */
  listed: string[];
  /** The search on screen, in words ("Thai, under 30 minutes"), or "" for none. */
  current: string;
  /** The cook's own diet rules, which every search already respects. */
  rules: string[];
  /** The last few turns, "Cook: …" / "Gusteau: …". */
  recent: string[];
}

/**
 * The model's proposal while choosing a dish. It never names results: the
 * app runs the search, checks it, and says what it found.
 */
export interface DiscoverIntent {
  /** The message as the model understood it, when it thinks speech recognition got it wrong. Checked before use. */
  heardAs: string | null;
  onTopic: boolean;
  action: 'search' | 'choose' | 'ask' | 'answer';
  search?: { cuisine: string | null; keywords: string[]; maxMinutes: number | null; diet: string[]; equipment: string[] | null; refine: boolean; describe: string | null };
  choose?: { position: number | null; title: string | null };
  /** For ask and answer, and for off-topic messages. */
  reply?: string;
}

export interface StageResult {
  stages: RecipeStage[];
  by: NonNullable<Recipe['stagesBy']>;
}

export interface ChefModelService {
  readonly mode: 'mock' | 'llm';
  readonly label: string;
  /** The model doing the talking ("" in mock mode). */
  readonly textModel: string;
  /** Switch to another model the provider offers. */
  setTextModel(id: string): void;

  /**
   * Turn a chat or voice message into changes, a command, or a reply.
   * `onReply` receives a plain answer while it's still being written (never
   * for plan changes, whose reply comes from the validated replan), so it
   * can be read aloud early.
   */
  interpretMessage(message: string, session: CookSession, opts?: { onReply?(textSoFar: string): void; onInterpreted?(heard: string): void }): Promise<InterpretResult>;

  /** Load the model so the first spoken question doesn't wait for it. */
  warmUp(): Promise<void>;

  /** Group a recipe's steps into 3–5 stages with supported icons. */
  stageRecipe(recipe: Recipe): Promise<StageResult>;

  /**
   * Gusteau's rule-based replanner has produced `draft`. When it couldn't
   * solve something, a model may propose a fix; it is validated before use.
   */
  adaptPlan(session: CookSession, draft: AdaptResult, prior: AdaptPrior): Promise<AdaptResult>;

  /**
   * How Gusteau says each step out loud, by `lineKey(step)`: short, natural
   * and true to the written step. Steps it can't phrase safely are left out,
   * and Gusteau's own wording (agent/stepSpeech.ts) is used for them.
   */
  phraseSteps(recipe: Recipe): Promise<Record<string, string>>;

  /**
   * Choosing what to cook: what the cook's message asks for, as one
   * structured action. Null when there's no model or it can't tell; the
   * rule-based reading (agent/voiceBrowse.ts) is used then.
   */
  discover(message: string, ctx: DiscoverContext): Promise<DiscoverIntent | null>;
}
