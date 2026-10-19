// ─────────────────────────────────────────────────────────────
// Core domain types for Gusteau's cooking session.
// The SessionState is the single source of truth the agent
// reasons over; every replan reads and writes this structure.
// ─────────────────────────────────────────────────────────────

export type Equipment = 'stovetop' | 'oven' | 'microwave';

export type DietTag = 'meat' | 'poultry' | 'fish' | 'shellfish' | 'dairy' | 'egg' | 'gluten' | 'legume' | 'nut' | 'soy';

export type DietRuleId =
  | 'vegetarian'
  | 'vegan'
  | 'dairy-free'
  | 'gluten-free'
  | 'egg-free'
  | 'nut-free'
  | 'legume-free';

export type PreferenceId = 'spicy' | 'high-protein' | 'comfort' | 'fresh' | 'cheesy' | 'minimal-cleanup';

export interface InventoryItem {
  id: string;
  /** Display name as the user sees it (e.g. "Canned black beans"). */
  name: string;
  /** Canonical catalog key, or null if Gusteau doesn't know this ingredient. */
  key: string | null;
  quantityNote: string;
  source: 'photo' | 'manual' | 'chat';
  /** 0–1 detection confidence when source === 'photo'. */
  confidence?: number;
}

export interface RemovedItem {
  name: string;
  key: string | null;
  reason: string;
}

export interface Constraints {
  hardExclusions: DietRuleId[];
  /** Free-text allergies/exclusions, e.g. "peanuts", "cilantro". Treated as HARD. */
  customExclusions: string[];
  preferences: PreferenceId[];
  /** Soft dislikes — avoided when possible, never a reason to fail. */
  dislikes: string[];
  equipment: Equipment[];
  timeMinutes: number;
  servings: number;
  budget: number;
  purchasesAllowed: boolean;
  /** Assume salt, pepper, cooking oil and water are on hand. */
  pantryBasics: boolean;
}

export interface RecipeIngredient {
  role: string;
  key: string;
  name: string;
  emoji: string;
  amount: number;
  unit: string;
  display: string;
  /** true when this must be bought (only ever possible if purchases are allowed). */
  toBuy: boolean;
  price: number;
}

export interface RecipeStep {
  /** Stable key — shared across replans so completed work is preserved. */
  key: string;
  title: string;
  instruction: string;
  /** Roles of ingredients this step uses. */
  uses: string[];
  timerSeconds?: number;
  tip?: string;
}

export interface Recipe {
  templateId: string;
  title: string;
  subtitle: string;
  emoji: string;
  difficulty: 'Easy' | 'Medium';
  equipment: Equipment;
  totalMinutes: number;
  servings: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  whyItFits: string[];
  estimatedCost: number;
  /** Where the plan came from — useful for the demo narrative. */
  source: 'mock-planner' | 'model';
  /** Human label of the model that wrote it, e.g. "Ollama · qwen3.6:35b-mlx". */
  sourceLabel?: string;
  /** Short transparency note, e.g. why the built-in planner stepped in. */
  note?: string;
}

export interface Substitution {
  role: string;
  from: string;
  to: string;
  reason: string;
}

export interface BlockedOption {
  templateId: string;
  title: string;
  reason: string;
}

/** A structured change the agent can apply to the session. */
export type SessionChange =
  | { type: 'remove_ingredient'; name: string }
  | { type: 'add_ingredient'; name: string; note?: string }
  | { type: 'set_time'; minutes: number }
  | { type: 'add_exclusion'; rule?: DietRuleId; custom?: string }
  | { type: 'set_servings'; servings: number }
  | { type: 'set_equipment'; equipment: Equipment[] }
  | { type: 'set_purchases'; allowed: boolean }
  | { type: 'set_budget'; amount: number }
  | { type: 'add_preference'; preference: PreferenceId };

export interface PlanDiff {
  id: string;
  trigger: string;
  titleBefore: string | null;
  titleAfter: string | null;
  minutesBefore: number | null;
  minutesAfter: number | null;
  ingredientsAdded: string[];
  ingredientsRemoved: string[];
  quantityChanges: { name: string; before: string; after: string }[];
  stepsAdded: string[];
  stepsRemoved: string[];
  stepsKept: number;
  newPurchases: string[];
  constraintsKept: string[];
  stateChanges: string[];
  message: string;
  infeasible: boolean;
}

export interface ChatMessage {
  id: string;
  from: 'user' | 'gusteau';
  text: string;
  diffId?: string;
}

export interface SessionState {
  inventory: InventoryItem[];
  removed: RemovedItem[];
  constraints: Constraints;
  recipe: Recipe | null;
  blocked: BlockedOption[];
  currentStepIndex: number;
  completedStepKeys: string[];
  substitutions: Substitution[];
  history: PlanDiff[];
  chat: ChatMessage[];
}

export interface DetectedIngredient {
  name: string;
  key: string | null;
  confidence: number;
  quantityNote: string;
}
