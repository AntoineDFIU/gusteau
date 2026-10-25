// ─────────────────────────────────────────────────────────────
// Core domain types.
//
//   Recipe       what the recipe database provides (normalized)
//   Profile      what Gusteau remembers about the user
//   CookSession  the live state the agent reasons over while
//                cooking; every replan reads and writes it
// ─────────────────────────────────────────────────────────────

export type Equipment = 'stovetop' | 'oven' | 'microwave' | 'blender' | 'grill';

export type DietTag = 'meat' | 'poultry' | 'fish' | 'shellfish' | 'dairy' | 'egg' | 'gluten' | 'legume' | 'nut' | 'soy';

export type DietRuleId = 'vegetarian' | 'vegan' | 'pescatarian' | 'dairy-free' | 'gluten-free' | 'egg-free' | 'nut-free' | 'shellfish-free';

export type Difficulty = 'Easy' | 'Medium' | 'Hard';

/** The supported stage icons. Models may only pick from this list. */
export type StageIconId =
  | 'prep'
  | 'chop'
  | 'mix'
  | 'marinate'
  | 'boil'
  | 'simmer'
  | 'saute'
  | 'fry'
  | 'sear'
  | 'roast'
  | 'bake'
  | 'grill'
  | 'steam'
  | 'microwave'
  | 'blend'
  | 'knead'
  | 'rest'
  | 'assemble'
  | 'plate';

export interface RecipeIngredient {
  /** Stable within a recipe, e.g. "rice". */
  id: string;
  name: string;
  /** null for "to taste" style amounts. */
  amount: number | null;
  unit: string;
  note?: string;
  optional?: boolean;
  /** Set when Gusteau swapped this in during a replan. */
  substitutedFor?: string;
  /** Not in the user's kitchen and must be bought. */
  toBuy?: boolean;
}

export interface RecipeStep {
  /** Stable key, shared across replans so completed work is preserved. */
  key: string;
  title: string;
  text: string;
  /** Ingredient ids this step uses. */
  uses: string[];
  timerSeconds?: number;
  /** Estimated active + waiting minutes; they add up to the recipe's total. */
  minutes?: number;
  /** Technique id from the clip library, e.g. "dice". */
  technique?: string;
  tip?: string;
}

export interface RecipeStage {
  key: string;
  title: string;
  icon: StageIconId;
  stepKeys: string[];
}

/** Per serving. Calories in kcal; protein, carbs, fat, fiber and sugar in grams; sodium in mg. */
export interface Nutrition {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface ChefCredit {
  name: string;
  /** Link to the chef's published original. */
  url?: string;
  /** How the credit reads, e.g. "Inspired by" or "Recipe by". */
  relation?: string;
}

export interface Recipe {
  id: string;
  title: string;
  cuisine: string;
  description: string;
  chef?: ChefCredit;
  image?: string;
  emoji: string;
  totalMinutes: number;
  servings: number;
  difficulty: Difficulty;
  equipment: Equipment[];
  tags: string[];
  /** 0–100, used to rank "popular" dishes. */
  popularity: number;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
  stages: RecipeStage[];
  /** Where the stage grouping came from. */
  stagesBy?: 'database' | 'gusteau' | 'model';
  /** Per-serving nutrition from the database, if it has it. Otherwise Gusteau estimates it. */
  nutrition?: Nutrition;
  /** Set once Gusteau has changed the recipe, so it's no longer the original. */
  adaptedFrom?: string;
}

export interface PantryItem {
  id: string;
  name: string;
  source: 'manual' | 'photo' | 'chat';
  quantityNote?: string;
  confidence?: number;
}

export interface CookedEntry {
  recipeId: string;
  cuisine: string;
  at: number;
  finished: boolean;
}

export interface Profile {
  onboarded: boolean;
  favoriteCuisines: string[];
  hardExclusions: DietRuleId[];
  allergies: string[];
  equipment: Equipment[];
  pantry: PantryItem[];
  history: CookedEntry[];
  /** Assume salt, pepper, oil and water are on hand. */
  pantryBasics: boolean;
}

/** Hard rules for one cooking session. Gusteau never breaks these. */
export interface CookRules {
  hardExclusions: DietRuleId[];
  allergies: string[];
  equipment: Equipment[];
  /** Minutes the user has left, or null for no limit. */
  timeLimit: number | null;
  purchasesAllowed: boolean;
  servings: number;
}

export interface Substitution {
  kind: 'swap' | 'drop' | 'buy' | 'add';
  from: string;
  /** The ingredient swapped in; empty for drops and purchases. */
  to: string;
  reason: string;
  /** Gusteau doesn't know the pantry, so the user should confirm they have it. */
  unsure?: boolean;
}

/** A structured change the agent can apply to the session. */
export type SessionChange =
  | { type: 'remove_ingredient'; name: string }
  | { type: 'add_ingredient'; name: string }
  | { type: 'set_time'; minutes: number }
  | { type: 'add_exclusion'; rule?: DietRuleId; custom?: string }
  | { type: 'set_servings'; servings: number }
  | { type: 'remove_equipment'; equipment: Equipment }
  | { type: 'set_purchases'; allowed: boolean }
  /** The user agreed to cook without an ingredient Gusteau couldn't replace. */
  | { type: 'leave_out'; name: string }
  /** The user chose what to use instead of an ingredient. */
  | { type: 'swap_ingredient'; from: string; to: string }
  /** Something extra goes into the dish: `how` is one instruction, `when` is now or before serving. */
  | { type: 'add_to_recipe'; name: string; amount?: string; how: string; when?: 'now' | 'end' };

/** Cooking-mode commands, typed or spoken. They never change the plan. */
export type CookCommand =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'repeat' }
  | { type: 'timer'; seconds: number }
  | { type: 'show_technique' };

export interface PlanDiff {
  id: string;
  trigger: string;
  titleBefore: string;
  titleAfter: string;
  minutesBefore: number;
  minutesAfter: number;
  substitutions: Substitution[];
  dropped: string[];
  stepsAdded: string[];
  stepsRemoved: string[];
  stepsKept: number;
  newPurchases: string[];
  rulesKept: string[];
  /** What changed in the session, e.g. "Marked rice as unavailable". */
  stateChanges: string[];
  message: string;
  infeasible: boolean;
  /** When paused: what the user can choose instead of breaking a rule. */
  offers?: { leaveOut: string[]; allowPurchase: boolean };
}

export interface ChatMessage {
  id: string;
  from: 'user' | 'gusteau';
  text: string;
  diffId?: string;
  techniqueId?: string;
  /** The user said it rather than typed it. */
  via?: 'voice';
  /** Already read aloud while it streamed in. */
  spoken?: boolean;
}

export interface ActiveTimer {
  id: string;
  label: string;
  totalSeconds: number;
  /** Epoch ms when it rings, or null while paused. */
  endsAt: number | null;
  /** Seconds left when paused. */
  pausedLeft: number;
}

export interface Addition {
  name: string;
  amount?: string;
  how: string;
  /** Key of the step it goes before; missing means before serving. */
  beforeKey?: string;
}

export interface CookSession {
  /** The recipe as it came from the database, scaled to the user's servings. */
  original: Recipe;
  /** The live plan, after any adaptations. */
  recipe: Recipe;
  rules: CookRules;
  pantry: PantryItem[];
  pantryBasics: boolean;
  /** Ingredient names the user said they don't have. */
  unavailable: string[];
  /** Ingredient names the user agreed to cook without. */
  leaveOut: string[];
  /** Swaps the user asked for, kept across replans. */
  preferredSwaps: { from: string; to: string }[];
  /** Extras the user added, each with the step it goes before. */
  additions: Addition[];
  /** Changes Gusteau just offered ("want me to switch?"), applied if the user says yes. */
  pendingOffer?: SessionChange[];
  stepIndex: number;
  completedStepKeys: string[];
  substitutions: Substitution[];
  history: PlanDiff[];
  chat: ChatMessage[];
  timers: ActiveTimer[];
  /** When the plan can't be made safely, Gusteau pauses and asks. */
  paused: boolean;
}

export interface DetectedIngredient {
  name: string;
  confidence: number;
  quantityNote: string;
}
