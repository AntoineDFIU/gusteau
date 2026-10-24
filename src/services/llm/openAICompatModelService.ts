import { describeChanges, validatePlan, contextOf, type AdaptPrior, type AdaptResult } from '../../agent/adapt';
import { validateStages } from '../../agent/stages';
import { sameIngredient } from '../../data/ingredients';
import { DIET_RULE_IDS, EQUIPMENT_IDS } from '../../data/rules';
import { STAGE_ICON_IDS } from '../../data/stageIcons';
import type { CookSession, DetectedIngredient, DietRuleId, Equipment, Recipe, RecipeIngredient, RecipeStep, SessionChange, Substitution } from '../../types';
import { parseCommand, parseIntent } from '../mock/intentParser';
import type { ChefModelService, InterpretResult, PhotoInput, StageResult } from '../modelService';

// ─────────────────────────────────────────────────────────────
// REAL MODEL INTEGRATION via any OpenAI-compatible Chat Completions API:
//   • NVIDIA Nemotron on Nebius Token Factory
//   • Ollama (e.g. a Mac on the LAN) at http://<host>:11434/v1
//
// The browser only ever calls /api/llm/chat/completions. The server
// (vite.config.ts in dev, deploy/gusteau_server.py in production)
// forwards it to the configured provider and adds any API key, so
// keys never reach the browser.
//
// Design: the model PROPOSES; Gusteau's validators DISPOSE. Stage
// groupings, plans and chat changes are all checked or sanitized,
// and Gusteau's own logic takes over on any failure.
// ─────────────────────────────────────────────────────────────

export interface LlmConfig {
  provider: 'nebius' | 'ollama' | string;
  label: string;
  visionModel: string;
  textModel: string;
  /** Extra request fields, e.g. {"reasoning_effort":"none"} for thinking models on Ollama. */
  extraBody?: Record<string, unknown>;
  /** Per-request timeout in ms (local models can need a moment to load). */
  timeoutMs?: number;
}

// BASE_URL is "/" in dev and "/Gusteau/" in production builds.
const ENDPOINT = `${import.meta.env.BASE_URL}api/llm/chat/completions`;

type Content = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

/** Pull the first JSON object/array out of a model response (tolerates <think> blocks and fences). */
function extractJson<T>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start < 0 || end < start) throw new Error('No JSON in model response');
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

function sessionSummary(s: CookSession) {
  const r = s.rules;
  return {
    recipe: s.recipe.title,
    pantry: s.pantry.map((p) => p.name),
    unavailable: s.unavailable,
    hard_rules: [...r.hardExclusions, ...r.allergies.map((a) => `no ${a}`)],
    equipment: r.equipment,
    minutes_left: r.timeLimit,
    servings: r.servings,
    purchases_allowed: r.purchasesAllowed,
    pantry_basics: s.pantryBasics ? ['salt', 'pepper', 'cooking oil', 'water'] : [],
  };
}

/** Keep only well-formed changes. Model output is data, never trusted blindly. */
function sanitizeChanges(raw: unknown): SessionChange[] {
  if (!Array.isArray(raw)) return [];
  const out: SessionChange[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN);
  const name = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') continue;
    switch (c.type) {
      case 'remove_ingredient':
      case 'add_ingredient':
      case 'leave_out': {
        const n = name(c.name);
        if (n) out.push({ type: c.type, name: n });
        break;
      }
      case 'set_time':
        if (num(c.minutes) > 0) out.push({ type: 'set_time', minutes: num(c.minutes) });
        break;
      case 'set_servings':
        if (num(c.servings) > 0) out.push({ type: 'set_servings', servings: num(c.servings) });
        break;
      case 'set_purchases':
        if (typeof c.allowed === 'boolean') out.push({ type: 'set_purchases', allowed: c.allowed });
        break;
      case 'remove_equipment':
        if (EQUIPMENT_IDS.includes(c.equipment as Equipment)) out.push({ type: 'remove_equipment', equipment: c.equipment as Equipment });
        break;
      case 'add_exclusion': {
        const rule = DIET_RULE_IDS.includes(c.rule as DietRuleId) ? (c.rule as DietRuleId) : undefined;
        const custom = name(c.custom) ?? undefined;
        if (rule || custom) out.push({ type: 'add_exclusion', rule, custom });
        break;
      }
    }
  }
  return out;
}

export class OpenAICompatModelService implements ChefModelService {
  readonly mode = 'llm' as const;
  readonly label: string;
  private readonly stageCache = new Map<string, StageResult>();

  constructor(private readonly cfg: LlmConfig) {
    this.label = cfg.label;
  }

  private async chat(model: string, system: string, user: Content, maxTokens = 2000): Promise<string> {
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

  // ── 1. Fridge/pantry image understanding ──
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
    const items = (Array.isArray(parsed) ? parsed : (parsed.ingredients ?? [])) as { name?: string; confidence?: number; quantity?: string }[];
    return items
      .filter((i) => typeof i?.name === 'string' && i.name.trim())
      .map((i) => ({
        name: i.name!.trim().replace(/^./, (m) => m.toUpperCase()),
        confidence: Math.max(0, Math.min(1, typeof i.confidence === 'number' ? i.confidence : 0.7)),
        quantityNote: typeof i.quantity === 'string' ? i.quantity : '',
      }));
  }

  // ── 2. Stages: the model groups, the app validates ──
  async stageRecipe(recipe: Recipe): Promise<StageResult> {
    const own: StageResult = { stages: recipe.stages, by: recipe.stagesBy ?? 'gusteau' };
    if (recipe.stagesBy === 'database') return own;
    const cached = this.stageCache.get(recipe.id);
    if (cached) return cached;
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You organize recipes for a cooking app. Group the steps into 3 to 5 short, ordered stages. Every step key must appear exactly once, in the original order, and each stage holds consecutive steps. Give each stage a short title (max 4 words) and pick its icon ONLY from this list: ${STAGE_ICON_IDS.join(', ')}.`,
        `Recipe: ${recipe.title}\nSteps:\n${recipe.steps.map((s) => `- ${s.key}: ${s.title}. ${s.text}`).join('\n')}\n\nRespond with ONLY JSON: {"stages":[{"title": string, "icon": string, "steps": [step keys]}]}`,
        800,
      );
      const parsed = extractJson<{ stages?: { title?: string; icon?: string; steps?: unknown[] }[] }>(text);
      const check = validateStages(
        recipe.steps,
        (parsed.stages ?? []).map((st) => ({ title: st.title, icon: st.icon, stepKeys: Array.isArray(st.steps) ? st.steps.map(String) : [] })),
      );
      if (!check.ok) {
        console.warn(`[Gusteau] ${this.cfg.label} stages rejected:`, check.problems);
        return own;
      }
      const result: StageResult = { stages: check.stages, by: 'model' };
      this.stageCache.set(recipe.id, result);
      return result;
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} staging failed, keeping Gusteau's stages.`, err);
      return own;
    }
  }

  // ── 3. Replanning help when the rule-based replanner is stuck ──
  async adaptPlan(session: CookSession, draft: AdaptResult, prior: AdaptPrior): Promise<AdaptResult> {
    if (!draft.violations.length || !draft.blockers.length) return draft;
    const ctx = contextOf(session);
    const done = new Set(ctx.completed);
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a practical chef. A cook is mid-recipe and some ingredients are a problem. Propose swaps ONLY from the pantry list${session.rules.purchasesAllowed ? ' (or something to buy, marked to_buy)' : ''}, never break a hard rule, use only the listed equipment, and rewrite ONLY the unfinished steps. Keep each unchanged step's "key". Never claim to verify allergens or food safety.`,
        `Session: ${JSON.stringify(sessionSummary(session))}
Problems: ${JSON.stringify(draft.blockers)}
Ingredients: ${JSON.stringify(draft.recipe.ingredients.map((i) => ({ name: i.name, amount: [i.amount, i.unit].filter(Boolean).join(' ') })))}
Unfinished steps: ${JSON.stringify(draft.recipe.steps.filter((s) => !done.has(s.key)).map((s) => ({ key: s.key, title: s.title, text: s.text })))}

Respond with ONLY JSON: {"swaps":[{"from": string, "to": string, "amount": string, "to_buy": boolean}], "steps":[{"key": string, "title": string, "text": string}]}`,
        1500,
      );
      const parsed = extractJson<{ swaps?: { from?: string; to?: string; amount?: string; to_buy?: boolean }[]; steps?: { key?: string; title?: string; text?: string }[] }>(text);
      const swaps = (parsed.swaps ?? []).filter((x) => x?.from && x?.to);
      if (!swaps.length || !Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('Incomplete plan JSON');

      let ingredients: RecipeIngredient[] = draft.recipe.ingredients;
      const substitutions: Substitution[] = [...draft.substitutions];
      for (const sw of swaps) {
        const orig = ingredients.find((i) => sameIngredient(i.name, sw.from!));
        if (!orig) continue;
        const swapped: RecipeIngredient = { id: `${orig.id}~model`, name: sw.to!, amount: null, unit: sw.amount ?? '', substitutedFor: orig.name, toBuy: sw.to_buy || undefined };
        ingredients = ingredients.map((i) => (i === orig ? swapped : i));
        substitutions.push({ kind: 'swap', from: orig.name, to: sw.to!, reason: `Suggested by ${this.cfg.label}, checked by Gusteau.` });
      }
      const byKey = new Map(draft.recipe.steps.map((s) => [s.key, s]));
      const open: RecipeStep[] = parsed.steps
        .filter((s) => s?.text && !done.has(String(s.key)))
        .map((s, i) => {
          const was = byKey.get(String(s.key));
          return {
            key: was ? was.key : `model-${i + 1}`,
            title: s.title || was?.title || `Step ${i + 1}`,
            text: s.text!,
            uses: ingredients.filter((ing) => s.text!.toLowerCase().includes(ing.name.toLowerCase().split(' ').pop()!)).map((ing) => ing.id),
            timerSeconds: was?.timerSeconds,
            minutes: was?.minutes ?? 2,
            technique: was?.technique,
          };
        });
      const steps = [...draft.recipe.steps.filter((s) => done.has(s.key)), ...open];
      // Keep stage order: each step goes to the stage of the step it replaced, or the one before it.
      let lastStage = 0;
      const stageOf = new Map<string, number>();
      for (const s of steps) {
        const idx = draft.recipe.stages.findIndex((st) => st.stepKeys.includes(s.key));
        if (idx >= 0) lastStage = idx;
        stageOf.set(s.key, lastStage);
      }
      const stages = draft.recipe.stages.map((st, i) => ({ ...st, stepKeys: steps.filter((s) => stageOf.get(s.key) === i).map((s) => s.key) })).filter((st) => st.stepKeys.length);
      const recipe: Recipe = {
        ...draft.recipe,
        ingredients,
        steps,
        stages,
        totalMinutes: Math.round(steps.reduce((a, s) => a + (s.minutes ?? 0), 0)),
        adaptedFrom: prior.recipe.adaptedFrom ?? session.original.title,
      };
      const violations = validatePlan(recipe, ctx);
      if (violations.length) {
        console.warn(`[Gusteau] ${this.cfg.label} replan rejected by validator:`, violations);
        return draft;
      }
      return { recipe, substitutions, violations: [], blockers: [], notes: draft.notes };
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} replan help failed; keeping Gusteau's answer.`, err);
      return draft;
    }
  }

  // ── 4. Conversation → structured changes ──
  async interpretMessage(message: string, session: CookSession): Promise<InterpretResult> {
    // Commands ("next", "set a 5 minute timer") are answered locally, instantly.
    const cmd = parseCommand(message);
    if (cmd) return cmd;
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a warm, concise chef helping someone cook. Convert the user's message into structured session changes. Allowed change types:
{"type":"remove_ingredient","name":string} | {"type":"add_ingredient","name":string} | {"type":"leave_out","name":string} | {"type":"set_time","minutes":number} |
{"type":"add_exclusion","rule"?: ${DIET_RULE_IDS.map((r) => `"${r}"`).join('|')},"custom"?:string} |
{"type":"set_servings","servings":number} | {"type":"remove_equipment","equipment":${EQUIPMENT_IDS.map((e) => `"${e}"`).join('|')}} | {"type":"set_purchases","allowed":boolean}
If the message is a question, return no changes and a short, practical reply (max 3 sentences) about the current step. Never claim to verify allergens, freshness or food safety.
Respond with ONLY JSON: {"reply": string|null, "changes": [...]}`,
        `Session: ${JSON.stringify(sessionSummary(session))}\nCurrent step: ${JSON.stringify(session.recipe.steps[session.stepIndex] ?? null)}\nUser: ${message}`,
        600,
      );
      const r = extractJson<{ reply?: string | null; changes?: unknown }>(text);
      const changes = sanitizeChanges(r.changes);
      if (!changes.length && !r.reply) return parseIntent(message, session);
      const local = parseIntent(message, session);
      return {
        reply: typeof r.reply === 'string' ? r.reply : null,
        changes,
        trigger: changes.length ? describeChanges(changes) : undefined,
        techniqueId: changes.length ? undefined : local.techniqueId,
      };
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} chat failed, using local parser.`, err);
      return parseIntent(message, session);
    }
  }
}
