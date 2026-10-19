import { CATALOG, matchIngredient } from '../../data/ingredients';
import { availableKeys, explainFit, planWithTemplates, validateRecipe, type PlanResult } from '../../agent/planner';
import type { DetectedIngredient, DietRuleId, Equipment, PreferenceId, Recipe, RecipeIngredient, RecipeStep, SessionChange, SessionState } from '../../types';
import type { ChefModelService, InterpretResult, PhotoInput } from '../modelService';
import { parseIntent } from '../mock/intentParser';
import { describeChanges } from '../../agent/replan';

// ─────────────────────────────────────────────────────────────
// REAL MODEL INTEGRATION via any OpenAI-compatible Chat Completions API:
//   • NVIDIA Nemotron on Nebius Token Factory
//   • Ollama (e.g. a Mac on the LAN) at http://<host>:11434/v1
//
// The browser only ever calls /api/llm/chat/completions. The server
// (vite.config.ts in dev, deploy/gusteau_server.py in production)
// forwards it to the configured provider and adds any API key, so
// keys never reach the browser. Which provider and models to use is
// read at startup from /api/config (see services/index.ts).
//
// Design: the model PROPOSES; Gusteau's deterministic validator
// DISPOSES. Every model-written recipe is checked against hard
// constraints and replaced with the template planner on violation
// or error, so the app can never show an unsafe plan.
// ─────────────────────────────────────────────────────────────

export interface LlmConfig {
  provider: 'nebius' | 'ollama' | string;
  label: string;
  visionModel: string;
  textModel: string;
  /** Extra request fields, e.g. {"reasoning_effort":"none"} to stop thinking models from spending the token budget on reasoning. */
  extraBody?: Record<string, unknown>;
  /** Per-request timeout in ms (local models can need a moment to load). */
  timeoutMs?: number;
}

// BASE_URL is "/" in dev and "/Gusteau/" in production builds, so the app also works under a path.
const ENDPOINT = `${import.meta.env.BASE_URL}api/llm/chat/completions`;
const PANTRY_BASICS = /^(salt|kosher salt|sea salt|black pepper|pepper|salt and pepper|oil|olive oil|cooking oil|vegetable oil|water)$/i;

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

/** Pull the first JSON object/array out of a model response (tolerates <think> blocks and fences). */
function extractJson<T>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('No JSON in model response');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function sessionSummary(s: SessionState) {
  const c = s.constraints;
  return {
    confirmed_ingredients: s.inventory.map((i) => ({ name: i.name, quantity: i.quantityNote || 'unspecified' })),
    unavailable: s.removed.map((r) => r.name),
    hard_exclusions: [...c.hardExclusions, ...c.customExclusions],
    preferences: c.preferences,
    dislikes: c.dislikes,
    equipment: c.equipment,
    time_minutes: c.timeMinutes,
    servings: c.servings,
    purchases_allowed: c.purchasesAllowed,
    budget_usd: c.budget,
    pantry_basics_available: c.pantryBasics ? ['salt', 'pepper', 'cooking oil', 'water'] : [],
  };
}

const EQUIPMENT_IDS = ['stovetop', 'oven', 'microwave'];

/** Models write equipment many ways: ["microwave"], "Microwave oven", "skillet"… */
function normalizeEquipment(value: unknown, allowed: Equipment[]): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const s = String(raw ?? '').toLowerCase().trim();
  if (!s) return allowed.length === 1 ? allowed[0] : '';
  if (s.includes('microwave')) return 'microwave';
  if (/oven|bake|roast/.test(s)) return 'oven';
  if (/stove|hob|pan|skillet|burner|cooktop|wok/.test(s)) return 'stovetop';
  return s;
}
const RULE_IDS = ['vegetarian', 'vegan', 'dairy-free', 'gluten-free', 'egg-free', 'nut-free', 'legume-free'];
const PREF_IDS = ['spicy', 'high-protein', 'comfort', 'fresh', 'cheesy', 'minimal-cleanup'];

/** Keep only well-formed changes. Model output is data, never trusted blindly. */
function sanitizeChanges(raw: unknown): SessionChange[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionChange[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN);
    switch (c.type) {
      case 'remove_ingredient':
      case 'add_ingredient':
        if (typeof c.name === 'string' && c.name.trim()) {
          out.push(c.type === 'add_ingredient' ? { type: 'add_ingredient', name: c.name.trim(), note: typeof c.note === 'string' ? c.note : undefined } : { type: 'remove_ingredient', name: c.name.trim() });
        }
        break;
      case 'set_time':
        if (num(c.minutes) > 0) out.push({ type: 'set_time', minutes: num(c.minutes) });
        break;
      case 'set_servings':
        if (num(c.servings) > 0) out.push({ type: 'set_servings', servings: num(c.servings) });
        break;
      case 'set_budget':
        if (num(c.amount) >= 0) out.push({ type: 'set_budget', amount: num(c.amount) });
        break;
      case 'set_purchases':
        if (typeof c.allowed === 'boolean') out.push({ type: 'set_purchases', allowed: c.allowed });
        break;
      case 'set_equipment': {
        const eq = Array.isArray(c.equipment) ? (c.equipment as unknown[]).filter((e): e is Equipment => EQUIPMENT_IDS.includes(e as string)) : [];
        if (eq.length) out.push({ type: 'set_equipment', equipment: eq });
        break;
      }
      case 'add_exclusion': {
        const rule = RULE_IDS.includes(c.rule as string) ? (c.rule as DietRuleId) : undefined;
        const custom = typeof c.custom === 'string' && c.custom.trim() ? c.custom.trim() : undefined;
        if (rule || custom) out.push({ type: 'add_exclusion', rule, custom });
        break;
      }
      case 'add_preference':
        if (PREF_IDS.includes(c.preference as string)) out.push({ type: 'add_preference', preference: c.preference as PreferenceId });
        break;
    }
  }
  return out;
}

export class OpenAICompatModelService implements ChefModelService {
  readonly mode = 'llm' as const;
  readonly label: string;

  constructor(private readonly cfg: LlmConfig) {
    this.label = cfg.label;
  }

  private async chat(model: string, system: string, user: Content, maxTokens = 3000): Promise<string> {
    const extra: Record<string, unknown> = { ...(this.cfg.extraBody ?? {}) };
    // If JSON mode is configured, keep it to text requests (untested with images).
    if (Array.isArray(user)) delete extra.response_format;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...extra,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`${this.cfg.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // ── 1. Fridge/pantry image understanding + ingredient extraction ──
  async analyzePhotos(photos: PhotoInput[]): Promise<DetectedIngredient[]> {
    const text = await this.chat(
      this.cfg.visionModel,
      'You are a careful kitchen inventory assistant. Identify only food items you can actually see. Never guess allergens or freshness.',
      [
        {
          type: 'text',
          text: 'List the food ingredients visible in these fridge/pantry photos. Use plain ingredient names (e.g. "eggs", "baby spinach", "canned black beans"). Respond with ONLY JSON: {"ingredients":[{"name": string, "confidence": number 0-1, "quantity": string (short visual estimate or "")}]}.',
        },
        ...photos.map((p) => ({ type: 'image_url' as const, image_url: { url: p.dataUrl } })),
      ],
      800,
    );
    const parsed = extractJson<{ ingredients?: unknown[] } | unknown[]>(text);
    const items = (Array.isArray(parsed) ? parsed : parsed.ingredients ?? []) as { name?: string; confidence?: number; quantity?: string }[];
    return items
      .filter((i) => typeof i?.name === 'string' && i.name.trim())
      .map((i) => ({
        name: i.name!.trim().replace(/^./, (m) => m.toUpperCase()),
        key: matchIngredient(i.name!),
        confidence: Math.max(0, Math.min(1, typeof i.confidence === 'number' ? i.confidence : 0.7)),
        quantityNote: typeof i.quantity === 'string' ? i.quantity : '',
      }));
  }

  // ── 2. Recipe planning (model proposes, validator disposes) ──
  async planRecipe(state: SessionState, previous: Recipe | null): Promise<PlanResult> {
    const fallback = planWithTemplates(state, previous, state.completedStepKeys);
    const useFallback = (why: string): PlanResult =>
      fallback.recipe ? { ...fallback, recipe: { ...fallback.recipe, note: `Gusteau’s built-in planner stepped in: ${why}.` } } : fallback;
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a practical home-cooking chef. Plan ONE feasible meal. Hard rules you must never break: only use confirmed ingredients (plus pantry basics), never use unavailable ingredients, respect every hard exclusion, use only the listed equipment (no other appliance or pan may appear in any step), fit the time limit, and never add a purchase unless purchases_allowed is true and the total stays within budget_usd. Prefer a dish that uses as many of the confirmed ingredients as make sense together, and use up perishables first. When replanning, keep the same step "key" values for steps that are unchanged so completed work is preserved, and change as little as possible; if the current recipe already satisfies every rule, return it unchanged.`,
        `Session state:\n${JSON.stringify(sessionSummary(state), null, 2)}\n\n${
          previous
            ? `Current recipe (replan the remaining work):\n${JSON.stringify({ title: previous.title, ingredients: previous.ingredients.map((i) => `${i.name}: ${i.display}`), steps: previous.steps.map((s) => ({ key: s.key, title: s.title })), completed_step_keys: state.completedStepKeys })}\n\n`
            : fallback.recipe
              ? `A feasible draft from Gusteau's rule-based planner, already checked against every rule. Use it as your starting point: keep its core ingredients, and improve the dish or the instructions only if you stay within the rules.\n${JSON.stringify({ title: fallback.recipe.title, total_minutes: fallback.recipe.totalMinutes, ingredients: fallback.recipe.ingredients.map((i) => `${i.name}: ${i.display}`), steps: fallback.recipe.steps.map((s) => s.title) })}\n\n`
              : ''
        }Respond with ONLY JSON:
{"title": string, "subtitle": string, "difficulty": "Easy"|"Medium", "equipment": ${state.constraints.equipment.map((e) => `"${e}"`).join(' | ')} (a single string), "total_minutes": number,
 "ingredients": [{"name": string, "amount": string, "to_buy": boolean, "price_usd": number}],
 "steps": [{"key": kebab-case string, "title": string, "instruction": string, "uses": [ingredient names], "timer_seconds": number|null, "tip": string|null}]}`,
      );
      const r = extractJson<{
        title: string;
        subtitle?: string;
        difficulty?: 'Easy' | 'Medium';
        equipment: Equipment;
        total_minutes: number;
        ingredients: { name: string; amount?: string; to_buy?: boolean; price_usd?: number }[];
        steps: { key?: string; title: string; instruction: string; uses?: string[]; timer_seconds?: number | null; tip?: string | null }[];
      }>(text);
      if (!r.title || !Array.isArray(r.ingredients) || !Array.isArray(r.steps) || !r.steps.length) throw new Error('Incomplete recipe JSON');

      const have = availableKeys(state.inventory);
      // Pantry basics are assumed, not listed (if they're NOT assumed, keep them so the validator catches them).
      const isBasic = (name: string) => state.constraints.pantryBasics && PANTRY_BASICS.test(name.trim());
      const ingredients: RecipeIngredient[] = r.ingredients
        .filter((i) => typeof i?.name === 'string' && !isBasic(i.name))
        .map((i) => {
          const key = matchIngredient(i.name) ?? i.name.toLowerCase();
          return {
            role: key,
            key,
            name: i.name,
            emoji: CATALOG[key]?.emoji ?? '🥄',
            amount: 1,
            unit: '',
            display: i.amount ?? '',
            toBuy: !!i.to_buy && !have.has(key),
            price: i.to_buy ? i.price_usd ?? 0 : 0,
          };
        });
      const steps: RecipeStep[] = r.steps.map((s, idx) => ({
        key: s.key || `step-${idx + 1}`,
        title: s.title,
        instruction: s.instruction,
        uses: (s.uses ?? []).map((u) => matchIngredient(u) ?? u.toLowerCase()),
        timerSeconds: typeof s.timer_seconds === 'number' && s.timer_seconds > 0 ? s.timer_seconds : undefined,
        tip: s.tip ?? undefined,
      }));
      const recipe: Recipe = {
        templateId: `model-${r.title}`,
        title: r.title,
        subtitle: r.subtitle ?? '',
        emoji: '🍽️',
        difficulty: r.difficulty === 'Medium' ? 'Medium' : 'Easy',
        equipment: normalizeEquipment(r.equipment, state.constraints.equipment) as Equipment,
        totalMinutes: Math.round(Number(r.total_minutes) || 0),
        servings: state.constraints.servings,
        ingredients,
        steps,
        whyItFits: [],
        estimatedCost: +ingredients.reduce((s, i) => s + i.price, 0).toFixed(2),
        source: 'model',
        sourceLabel: this.cfg.label,
      };
      const violations = validateRecipe(recipe, state);
      if (!recipe.totalMinutes) violations.push('No cooking time given.');
      if (violations.length) {
        console.warn(`[Gusteau] ${this.cfg.label} plan rejected by validator:`, violations);
        return useFallback(`the model’s plan broke a rule (${violations[0].replace(/\.$/, '')})`);
      }
      recipe.whyItFits = explainFit(recipe, state);
      return { recipe, blocked: fallback.blocked };
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} planning failed, using template planner.`, err);
      const name = (err as Error)?.name;
      const why =
        name === 'TimeoutError' || name === 'AbortError'
          ? 'the model didn’t answer in time'
          : err instanceof SyntaxError || /JSON|Incomplete/.test(String((err as Error)?.message))
            ? 'the model’s answer couldn’t be read'
            : 'the model service couldn’t be reached';
      return useFallback(why);
    }
  }

  // ── 3. Conversational replanning → structured state changes ──
  async interpretMessage(message: string, state: SessionState): Promise<InterpretResult> {
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a warm, concise chef helping someone cook. Convert the user's message into structured session changes. Allowed change types:
{"type":"remove_ingredient","name":string} | {"type":"add_ingredient","name":string,"note"?:string} | {"type":"set_time","minutes":number} |
{"type":"add_exclusion","rule"?: "vegetarian"|"vegan"|"dairy-free"|"gluten-free"|"egg-free"|"nut-free"|"legume-free","custom"?:string} |
{"type":"set_servings","servings":number} | {"type":"set_equipment","equipment":("stovetop"|"oven"|"microwave")[]} |
{"type":"set_purchases","allowed":boolean} | {"type":"set_budget","amount":number} |
{"type":"add_preference","preference":"spicy"|"high-protein"|"comfort"|"fresh"|"cheesy"|"minimal-cleanup"}
If the message is just a question, return no changes and a short, practical reply (max 2 sentences). Never claim to verify allergens or food safety.
Respond with ONLY JSON: {"reply": string|null, "changes": [...], "trigger": short human-readable label like "You're out of rice", or null}`,
        `Session: ${JSON.stringify(sessionSummary(state))}\nCurrent step: ${state.recipe?.steps[state.currentStepIndex]?.title ?? 'none'}\nUser: ${message}`,
        600,
      );
      const r = extractJson<{ reply?: string | null; changes?: unknown; trigger?: string | null }>(text);
      const changes = sanitizeChanges(r.changes);
      if (!changes.length && !r.reply) return parseIntent(message, state);
      // Label the update from the validated changes, so it always reads consistently.
      return { reply: typeof r.reply === 'string' ? r.reply : null, changes, trigger: changes.length ? describeChanges(changes) : undefined };
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} chat failed, using local parser.`, err);
      return parseIntent(message, state);
    }
  }
}
