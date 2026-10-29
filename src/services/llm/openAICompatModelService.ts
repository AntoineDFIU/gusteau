import { describeChanges, substitutionHints, validatePlan, contextOf, type AdaptPrior, type AdaptResult } from '../../agent/adapt';
import { validateStages } from '../../agent/stages';
import { lineKey, numbersIn } from '../../agent/stepSpeech';
import { sameRole } from '../../agent/missing';
import { sameIngredient } from '../../data/ingredients';
import { DIET_RULE_IDS, EQUIPMENT_IDS } from '../../data/rules';
import { STAGE_ICON_IDS } from '../../data/stageIcons';
import type { CookSession, DietRuleId, Equipment, Recipe, RecipeIngredient, RecipeStep, SessionChange, Substitution } from '../../types';
import { explainRequest, howToRequest, parseCommand, parseIntent } from '../mock/intentParser';
import { answerOffer, groundedAnswer, outOfIngredient } from '../mock/kitchenHelp';
import { culinary, offTopicReply, respelled } from '../topic';
import { changesMeaning, checkFirst, partialHeardAs, riskyReading } from '../../agent/heardAs';
import { streamChat } from './chatStream';
import { logRequest, logResponse } from '../../debug/debugLog';
import type { ChefModelService, DiscoverContext, DiscoverIntent, InterpretResult, StageResult } from '../modelService';
import { CUISINES } from '../../data/cuisines';

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
  /** Not used by the app any more (there's no photo scanning); the server may still send it. */
  visionModel?: string;
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
    pantry_basics: s.pantryBasics ? ['salt', 'pepper', 'cooking oil', 'water'] : [],
  };
}

const HINT_STATUS = { have: 'they said they have it', missing: 'they said they don’t have it', unknown: 'not mentioned' } as const;

/**
 * Why a model's spoken line can't stand in for a written step, or null if it
 * can: it must not add numbers (times, amounts, temperatures) or ingredients
 * the step doesn't have, read out step labels, or ramble.
 */
function lineProblem(line: string, step: RecipeStep, recipe: Recipe): string | null {
  const source = `${step.title}. ${step.text} ${step.tip ?? ''}`;
  if (line.length < 8) return 'empty';
  if (line.length > Math.max(160, source.length * 1.6)) return 'too long';
  if (/\bstep\b|[*#•]/i.test(line)) return 'reads labels';
  const allowed = numbersIn(source);
  const extra = [...numbersIn(line)].filter((n) => !allowed.has(n) && n !== 'one');
  if (extra.length) return `adds ${extra.join(', ')}`;
  const said = line.toLowerCase();
  const own = source.toLowerCase();
  const added = recipe.ingredients.map((i) => i.name.toLowerCase().split(/\s+/).pop()!).find((w) => w.length > 3 && new RegExp(`\\b${w}`).test(said) && !own.includes(w.replace(/e?s$/, '')));
  return added ? `adds ${added}` : null;
}

/** Earlier messages sent along, so follow-ups like "and how long for that?" make sense. */
const RECENT_TURNS = 6;

/**
 * While {"changes": [...], "reply": "..."} streams in: the reply so far,
 * once the changes list is complete and empty. Null until then, and null
 * when there are changes (the validated replan message is said instead).
 */
export function partialReply(json: string): string | null {
  const head = /"changes"\s*:\s*\[/.exec(json);
  if (!head) return null;
  let i = head.index + head[0].length;
  let depth = 1;
  let inString = false;
  for (; i < json.length && depth; i++) {
    const ch = json[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') depth--;
  }
  if (depth || json.slice(head.index + head[0].length, i - 1).trim()) return null;
  const start = /"reply"\s*:\s*"/.exec(json.slice(i));
  if (!start) return null;
  let out = '';
  for (let j = i + start.index + start[0].length; j < json.length; j++) {
    const ch = json[j];
    if (ch === '"') break;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = json[j + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const hex = json.slice(j + 2, j + 6);
      if (hex.length < 4) break;
      out += String.fromCharCode(parseInt(hex, 16));
      j += 5;
    } else {
      out += ({ n: '\n', t: ' ', r: '', b: '', f: '' } as Record<string, string>)[next] ?? next;
      j++;
    }
  }
  return out;
}

const NUMBER = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|half|an?)';

/**
 * Changes to the cook's own settings only count when their words ask for
 * them: a model must not loosen a time limit or add guests because
 * someone said "it's still cold in the middle".
 */
function grounded(c: SessionChange, message: string): boolean {
  const m = message.toLowerCase().replace(/[‘’]/g, "'");
  switch (c.type) {
    case 'set_time':
      return new RegExp(`\\b${NUMBER}\\s*(-\\s*)?(min|mins|minutes?|hours?|hrs?)\\b|half an hour|\\bin a (hurry|rush)\\b`).test(m);
    case 'set_servings':
      return new RegExp(`\\b${NUMBER}\\b|\\b(people|person|guests?|servings?|portions?|feed|feeding|friends|kids|family|more of us)\\b`).test(m);
    case 'remove_equipment':
      return /\b(stove|stovetop|hob|burner|oven|microwave|blender|grill|broke|broken|working|died|busy)\b/.test(m);
    case 'add_exclusion':
      return /\b(allerg\w*|intoleran\w*|can't eat|cannot eat|don't eat|doesn't eat|avoid|no |free|vegan|vegetarian|pescatarian|celiac|coeliac|kosher|halal)\b/.test(m);
    default:
      // Ingredient changes can follow from earlier turns ("it's ruined"), and the replanner checks them.
      return true;
  }
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
      case 'swap_ingredient': {
        const from = name(c.from);
        const to = name(c.to);
        // "Swap flour for none" means leaving it out.
        if (from && to && /^(none|nothing|no\b.*|skip( it)?|leave( it)? out)$/i.test(to)) out.push({ type: 'leave_out', name: from });
        else if (from && to) out.push({ type: 'swap_ingredient', from, to });
        break;
      }
      case 'add_to_recipe': {
        const n = name(c.name);
        // One short instruction; anything longer is not a step a cook can follow hands-free.
        const how = name(c.how)?.slice(0, 220);
        if (n && how) out.push({ type: 'add_to_recipe', name: n, amount: name(c.amount) ?? undefined, how, when: c.when === 'end' ? 'end' : 'now' });
        break;
      }
      case 'set_time':
        if (num(c.minutes) > 0) out.push({ type: 'set_time', minutes: num(c.minutes) });
        break;
      case 'set_servings':
        if (num(c.servings) > 0) out.push({ type: 'set_servings', servings: num(c.servings) });
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
  private readonly stageCache = new Map<string, StageResult>();
  private readonly lineCache = new Map<string, Record<string, string>>();

  constructor(private cfg: LlmConfig) {}

  get label() {
    return this.cfg.label;
  }
  get textModel() {
    return this.cfg.textModel;
  }
  /** Talk to another model. What the last one wrote (stages, spoken lines) is forgotten, so the new one's work shows. */
  setTextModel(id: string): void {
    if (id === this.cfg.textModel) return;
    const provider = this.cfg.label.split(' · ')[0];
    this.cfg = { ...this.cfg, textModel: id, label: `${provider} · ${id}` };
    this.stageCache.clear();
    this.lineCache.clear();
  }

  private async chat(model: string, system: string, user: Content, maxTokens = 2000, purpose = 'request'): Promise<string> {
    const extra: Record<string, unknown> = { ...(this.cfg.extraBody ?? {}) };
    // If JSON mode is configured, keep it to text requests (untested with images).
    if (Array.isArray(user)) delete extra.response_format;
    const messages = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    const logId = logRequest(purpose, model, messages, { temperature: 0.2, max_tokens: maxTokens, ...extra });
    try {
      const text = await this.post(model, messages, maxTokens, extra);
      logResponse(logId, text, true);
      return text;
    } catch (e) {
      logResponse(logId, '', true, (e as Error).message);
      throw e;
    }
  }

  private async post(model: string, messages: { role: string; content: Content }[], maxTokens: number, extra: Record<string, unknown>): Promise<string> {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000),
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: maxTokens,
        ...extra,
        messages,
      }),
    });
    if (!res.ok) throw new Error(`${this.cfg.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  // ── 1. Stages: the model groups, the app validates ──
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
        800, 'stages'
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

  // ── 2. Replanning help when the rule-based replanner is stuck ──
  async adaptPlan(session: CookSession, draft: AdaptResult, prior: AdaptPrior): Promise<AdaptResult> {
    if (!draft.violations.length || !draft.blockers.length) return draft;
    const ctx = contextOf(session);
    const done = new Set(ctx.completed);
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a practical chef. A cook is mid-recipe and some ingredients are a problem. Propose swaps that play the same role, preferring ingredients they have mentioned (the pantry list holds only those; don't assume they have anything else, so pick common ingredients), never break a hard rule, use only the listed equipment, and rewrite ONLY the unfinished steps. Only swap in something that plays the same role in the dish (another melting cheese for cheese, another grain or bread for rice). If nothing fits, return {\"swaps\": [], \"steps\": []} and Gusteau will ask them what to do. Keep each unchanged step's "key". Never claim to verify allergens or food safety.`,
        `Session: ${JSON.stringify(sessionSummary(session))}
Problems: ${JSON.stringify(draft.blockers)}
Ingredients: ${JSON.stringify(draft.recipe.ingredients.map((i) => ({ name: i.name, amount: [i.amount, i.unit].filter(Boolean).join(' ') })))}
Unfinished steps: ${JSON.stringify(draft.recipe.steps.filter((s) => !done.has(s.key)).map((s) => ({ key: s.key, title: s.title, text: s.text })))}

Respond with ONLY JSON: {"swaps":[{"from": string, "to": string, "amount": string}], "steps":[{"key": string, "title": string, "text": string}]}`,
        1500, 'replan'
      );
      const parsed = extractJson<{ swaps?: { from?: string; to?: string; amount?: string }[]; steps?: { key?: string; title?: string; text?: string }[] }>(text);
      const swaps = (parsed.swaps ?? []).filter((x) => x?.from && x?.to);
      if (!swaps.length || !Array.isArray(parsed.steps) || !parsed.steps.length) throw new Error('No swap that fits');
      const offRole = swaps.find((x) => !sameRole(x.from!, x.to!));
      if (offRole) throw new Error(`${offRole.to} doesn't do the job of ${offRole.from}`);

      let ingredients: RecipeIngredient[] = draft.recipe.ingredients;
      const substitutions: Substitution[] = [...draft.substitutions];
      for (const sw of swaps) {
        const orig = ingredients.find((i) => sameIngredient(i.name, sw.from!));
        if (!orig) continue;
        const swapped: RecipeIngredient = { id: `${orig.id}~model`, name: sw.to!, amount: null, unit: sw.amount ?? '', substitutedFor: orig.name };
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
      // Every unfinished step that doesn't involve a problem ingredient must still be there.
      const problemIds = draft.recipe.ingredients.filter((i) => draft.blockers.some((b) => sameIngredient(b.name, i.name))).map((i) => i.id);
      const dropped = draft.recipe.steps.filter((s) => !done.has(s.key) && !s.uses.some((u) => problemIds.includes(u)) && !open.some((o) => o.key === s.key));
      if (dropped.length) throw new Error(`The rewrite dropped "${dropped[0].title}"`);
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

  // ── 3. How each step is said out loud ──
  async phraseSteps(recipe: Recipe): Promise<Record<string, string>> {
    const cacheKey = recipe.steps.map(lineKey).join('\u0001');
    const cached = this.lineCache.get(cacheKey);
    if (cached) return cached;
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a chef talking a cook through a recipe out loud while they cook. Turn each written step into what you would say: one or two short spoken sentences that start with the action, as an instruction. Say numbers and measurements in words ("four balls", "three-quarters of an inch", "two minutes"), but keep numbers above ninety-nine as digits ("350 degrees"). Keep every amount, time, temperature and safety warning in the step. Add nothing that isn't in the step: no new ingredients, tools, times, temperatures or steps. Don't say step numbers, the word "step", or transitions like "first", "next", "now" or "then" at the start; the app adds those. No lists, markdown or emoji.`,
        `Recipe: ${recipe.title}
Steps: ${JSON.stringify(recipe.steps.map((s) => ({ key: s.key, title: s.title, text: s.text, ...(s.tip ? { tip: s.tip } : {}) })))}

Example: {"key":"x","title":"Shape the patties","text":"Divide the beef into 4 balls. Gently flatten each ball into a patty about ¾ inch thick."} → "Shape the patties: divide the beef into four balls, then gently flatten each one into a patty about three-quarters of an inch thick."

Respond with ONLY JSON: {"lines":[{"key": string, "say": string}]}`,
        1500, 'step phrasing'
      );
      const parsed = extractJson<{ lines?: { key?: unknown; say?: unknown }[] }>(text);
      const out: Record<string, string> = {};
      for (const l of parsed.lines ?? []) {
        const step = recipe.steps.find((s) => s.key === String(l?.key));
        const line = typeof l?.say === 'string' ? l.say.trim().replace(/^(first|next|now|then|finally|okay|alright)[,:]?\s+/i, '') : '';
        const problem = step ? lineProblem(line, step, recipe) : 'unknown step';
        if (problem) console.warn(`[Gusteau] ${this.cfg.label} spoken line rejected (${problem}):`, line);
        else out[lineKey(step!)] = line.charAt(0).toUpperCase() + line.slice(1);
      }
      this.lineCache.set(cacheKey, out);
      return out;
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} step phrasing failed; Gusteau phrases the steps himself.`, err);
      return {};
    }
  }

  // ── 4. Choosing what to cook: the model picks an action, the app runs it ──
  async discover(message: string, ctx: DiscoverContext): Promise<DiscoverIntent | null> {
    try {
      const text = await this.chat(
        this.cfg.textModel,
        `You are Gusteau, a warm, practical personal chef assistant. Right now you are helping someone decide what to cook, through conversation, before they start cooking.

Style: talk like a friendly chef, briefly. Your words are read aloud, so keep any reply to one or two short sentences, with no lists, markdown or emoji. Work with whatever they share (a cuisine, an ingredient, a craving, a diet, how much time they have, their equipment) and search right away. Ask one short follow-up question only when there is nothing yet to search on; never make them answer a questionnaire before seeing options.

Boundaries: you only talk about food and cooking. Dishes come only from the app's recipe library, and the app searches it for you and tells the cook what it found, so never name a dish, say how many there are, or claim a recipe exists. Never assume what ingredients they have. Never claim to verify allergens or food safety. Their words come from speech recognition and may contain mistakes: go with the most likely food meaning.`,
        `Cuisines in the library: ${CUISINES.map((c) => c.id).join(', ')}
Diet rules you can search by: ${DIET_RULE_IDS.join(', ')}
Equipment: ${EQUIPMENT_IDS.join(', ')}
The cook's own rules (already applied to every search): ${ctx.rules.length ? ctx.rules.join(', ') : 'none'}
On screen now: ${ctx.listed.length ? ctx.listed.map((t, i) => `${i + 1}. ${t}`).join('; ') : 'nothing searched yet'}${ctx.current ? ` (search: ${ctx.current})` : ''}
${ctx.recent.length ? `Recent conversation:\n${ctx.recent.join('\n')}\n` : ''}Cook: ${message}

Choose ONE action:
- "search": they said anything you can search on. keywords are short food words for what the dish should have, from what they said ("cheese", "chicken", "spicy", "noodles"), never what it shouldn't ("without meat" is the vegetarian diet, not a keyword); cuisine is one id from the list or null; max_minutes only if they gave a time or want something quick (quick means 30); diet only if they said it; equipment lists what they can use, only if they said so; refine is true when they're narrowing what's on screen ("something quicker", "any vegetarian ones?"); describe names the results in two or three words for speech, like "cheesy dishes" or "quick noodle dishes".
- "choose": they picked a dish on screen, by name or by position.
- "ask": there's nothing to search on yet; reply is one short, open question.
- "answer": a food or cooking question that isn't a search; reply answers it in one or two sentences.
If the message is not about food or cooking, set on_topic to false and reply with one friendly sentence steering back to what they'd like to cook.
heard_as is their message as you understood it, only when that differs in meaning from their exact words because of a likely speech recognition error ("something with leaks" → "something with leeks"); otherwise null. Never change a negation, number, time, allergy or diet in it: if one of those is unclear, use "ask" instead.

Respond with ONLY JSON: {"heard_as": string|null, "on_topic": boolean, "action": "search"|"choose"|"ask"|"answer", "search": {"cuisine": string|null, "keywords": [string], "max_minutes": number|null, "diet": [string], "equipment": [string]|null, "refine": boolean, "describe": string|null} | null, "choose": {"position": number|null, "title": string|null} | null, "reply": string|null}`,
        400, 'discovery'
      );
      const r = extractJson<{ heard_as?: unknown; on_topic?: unknown; action?: unknown; search?: Record<string, unknown> | null; choose?: Record<string, unknown> | null; reply?: unknown }>(text);
      const action = (['search', 'choose', 'ask', 'answer'] as const).find((a) => a === r.action);
      if (!action) return null;
      const s = r.search ?? {};
      const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim().toLowerCase()) : []);
      const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : typeof v === 'string' && Number(v) > 0 ? Number(v) : null);
      return {
        heardAs: typeof r.heard_as === 'string' && r.heard_as.trim() ? r.heard_as.trim() : null,
        onTopic: r.on_topic !== false,
        action,
        search:
          action === 'search'
            ? {
                cuisine: typeof s.cuisine === 'string' ? s.cuisine.toLowerCase() : null,
                keywords: strings(s.keywords).slice(0, 4),
                maxMinutes: num(s.max_minutes),
                diet: strings(s.diet),
                equipment: Array.isArray(s.equipment) ? strings(s.equipment) : null,
                refine: s.refine === true,
                describe: typeof s.describe === 'string' ? s.describe.trim().toLowerCase() : null,
              }
            : undefined,
        choose: action === 'choose' && r.choose ? { position: num(r.choose.position), title: typeof r.choose.title === 'string' ? r.choose.title : null } : undefined,
        reply: typeof r.reply === 'string' && r.reply.trim() ? r.reply.trim() : undefined,
      };
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} discovery failed; using Gusteau's own reading.`, err);
      return null;
    }
  }

  async warmUp(): Promise<void> {
    await streamChat({ purpose: 'warm-up', model: this.cfg.textModel, extraBody: this.cfg.extraBody, maxTokens: 1, messages: [{ role: 'user', content: 'Hi' }], signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000) });
  }

  // ── 5. Conversation → structured changes ──
  async interpretMessage(message: string, session: CookSession, opts: { onReply?(textSoFar: string): void; onInterpreted?(heard: string): void } = {}): Promise<InterpretResult> {
    // Commands ("next", "set a 5 minute timer") are answered locally, instantly.
    const cmd = parseCommand(message);
    if (cmd) return cmd;
    // "Yes" or "no" to a swap Gusteau just offered is answered instantly too.
    const answered = answerOffer(message, session) ?? outOfIngredient(message, session) ?? groundedAnswer(message, session);
    if (answered) return answered;
    // "What is mirin?" is answered from Wikipedia, with pictures.
    const explain = explainRequest(message);
    if (explain) return { reply: null, changes: [], explain, interpreted: respelled(message, explain) };
    const step = session.recipe.steps[session.stepIndex];
    const hints = substitutionHints(session).map((h) => `${h.ingredient}: ${h.options.map((o) => `${o.name} (${HINT_STATUS[o.status]})`).join(', ')}`);
    const unused = session.pantry.filter((p) => !session.recipe.ingredients.some((i) => sameIngredient(i.name, p.name))).map((p) => p.name);
    const recent = session.chat
      .slice(-RECENT_TURNS)
      .map((m) => `${m.from === 'user' ? 'Cook' : 'Gusteau'}: ${m.text}`)
      .join('\n');
    try {
      let streamed = '';
      // How the model read the message (it comes first in the JSON); a risky reading holds the reply back.
      let heard: string | null | undefined;
      let hold = false;
      const text = await streamChat({
        purpose: 'kitchen chat',
        model: this.cfg.textModel,
        extraBody: this.cfg.extraBody,
        temperature: 0.2,
        maxTokens: 600,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000),
        messages: [
          {
            role: 'system',
            content: `You are Gusteau, a warm, practical personal chef assistant. Help users cook with confidence and adapt when their situation changes.

Speak like a helpful chef beside the user: natural, concise, encouraging, and focused on the next useful thing. Messages may contain speech recognition errors. Use context to interpret likely meanings, but ask a brief clarifying question when uncertain, especially about allergies, restrictions, amounts, temperatures, or times. Preserve negations and avoid assuming that similar-sounding words are always ingredients.

Treat the user's stated dietary restrictions, time, servings, available equipment, and missing ingredients as firm constraints. Do not assume the user has an ingredient merely because it is part of the recipe. The pantry data represents only ingredients the user has explicitly confirmed.

Help with the active recipe, cooking techniques, timing, substitutions, serving, food storage, nutrition, drinks, and meal pairings. If the user asks about an unrelated topic, politely explain that you are here to help with cooking and steer back to the recipe. Do not answer the unrelated question.

When an ingredient is missing, a constraint changes, or something goes wrong during cooking, help the user preserve their goal and adjust the remaining plan. Offer practical options before making an optional recipe change. Prefer substitutions already confirmed in the user's pantry when available, and never suggest something that conflicts with a hard restriction or unavailable equipment.

Your response is read aloud. Normally use one to three short sentences, without markdown or emoji. Summarize lists rather than reading them by default: mention at most one or two relevant examples and offer to read the full list. When showing recipe options, invite the user to choose by name or position, or ask to hear all options. If the user explicitly asks for a full list, provide it using the supplied data, including ingredient quantities when available; for a long list, provide a manageable group and offer to continue or repeat. Never invent items or quantities. Never claim to verify allergies, food freshness, or food safety.

Return only JSON in this exact shape and order:
{"heard_as":string|null,"on_topic":boolean,"changes":[],"reply":string|null,"offer":[],"timer_seconds":number|null}

"heard_as" is the cook's message as you understood it, only when that differs in meaning from their exact words because of a likely speech recognition error (for example "how long do I sear the stakes" → "how long do I sear the steaks"); otherwise null. Keep their wording apart from the fix. Never change a negation, number, amount, time, temperature, allergy or diet in it: if one of those is unclear, set "heard_as" to null and ask in "reply".

Allowed changes:
{"type":"remove_ingredient","name":string}
{"type":"add_ingredient","name":string}
{"type":"leave_out","name":string}
{"type":"set_time","minutes":number}
{"type":"add_exclusion","rule"?:${DIET_RULE_IDS.map((r) => `"${r}"`).join('|')},"custom"?:string}
{"type":"set_servings","servings":number}
{"type":"remove_equipment","equipment":${EQUIPMENT_IDS.map((e) => `"${e}"`).join('|')}}
{"type":"swap_ingredient","from":string,"to":string}
{"type":"add_to_recipe","name":string,"amount"?:string,"how":string,"when":"now"|"end"}

Use only the actions defined above. Never invent an action, recipe change, ingredient availability, timer, or app state. If the user needs to decide, ask a short question or return an offer.

Example offer, only when quinoa fits the user's constraints:
{"heard_as":null,"on_topic":true,"changes":[],"reply":"You could use quinoa instead. Would you like to make that swap?","offer":[{"type":"swap_ingredient","from":"rice","to":"quinoa"}],"timer_seconds":null}

Use "changes" only when the user clearly asks for a change. Use "offer" for a suggested change that needs their confirmation. If "changes" is not empty, set "reply" to null. Use "timer_seconds" only when extra cooking time would help with the current step.`,
          },
          {
            role: 'user',
            content: `Session: ${JSON.stringify(sessionSummary(session))}
Recipe steps: ${JSON.stringify(session.recipe.steps.map((s, i) => `${i + 1}. ${s.title}${session.completedStepKeys.includes(s.key) ? ' (done)' : ''}`))}
Current step: ${JSON.stringify(step ? { title: step.title, text: step.text, tip: step.tip, timer_seconds: step.timerSeconds } : 'all steps finished')}
Ingredients: ${JSON.stringify(session.recipe.ingredients.map((i) => `${i.name}${i.amount !== null ? ` ${i.amount} ${i.unit}`.trimEnd() : ''}`))}
Safe swaps for what's still to be used: ${hints.length ? hints.join('; ') : 'none known'}
They've mentioned also having: ${unused.length ? unused.join(', ') : 'nothing'} (they haven't listed what they have, so never assume they lack anything they didn't say they lack)
${recent ? `Recent conversation:\n${recent}\n` : ''}Cook: ${message}`,
          },
        ],
        onDelta: (sofar) => {
          if (heard === undefined) {
            heard = partialHeardAs(sofar);
            if (heard && changesMeaning(message, heard)) {
              hold = !!riskyReading(message, heard);
              if (!hold) opts.onInterpreted?.(heard);
            }
          }
          const reply = !hold && opts.onReply && partialReply(sofar);
          if (reply && reply !== streamed) {
            streamed = reply;
            opts.onReply!(reply);
          }
        },
      });
      const r = extractJson<{ heard_as?: unknown; on_topic?: unknown; reply?: string | null; changes?: unknown; offer?: unknown; timer_seconds?: unknown }>(text);
      // "Interpreted as…" only when the reading changes the meaning; one that would change a negation, number,
      // allergy, diet, time or temperature isn't acted on: Gusteau asks.
      const reading = typeof r.heard_as === 'string' && r.heard_as.trim() && changesMeaning(message, r.heard_as) ? r.heard_as.trim() : undefined;
      if (reading && riskyReading(message, reading)) return { reply: checkFirst(reading), changes: [] };
      const interpreted = reading;
      // Not about cooking: a polite redirect and nothing else (no changes, videos or timers).
      if (r.on_topic === false && !culinary(interpreted ?? message, session)) return { reply: typeof r.reply === 'string' && r.reply.trim() ? r.reply : offTopicReply(session.recipe.title), changes: [], interpreted };
      const proposed = sanitizeChanges(r.changes);
      const changes = proposed.filter((c) => grounded(c, message));
      if (changes.length < proposed.length) console.warn(`[Gusteau] Ignored changes the cook didn't ask for:`, proposed.filter((c) => !changes.includes(c)));
      if (!changes.length && !r.reply) return parseIntent(message, session);
      const local = parseIntent(message, session);
      const timer = Number(r.timer_seconds);
      return {
        reply: typeof r.reply === 'string' ? r.reply : null,
        interpreted,
        changes,
        trigger: changes.length ? describeChanges(changes) : undefined,
        techniqueId: changes.length ? undefined : local.techniqueId,
        // "How do I dice an onion?": the model answers in words, and videos come with it.
        howTo: changes.length || r.on_topic === false ? undefined : (howToRequest(message, session) ?? undefined),
        offer: changes.length ? undefined : sanitizeChanges(r.offer),
        // Extra cooking time only: between 10 seconds and 30 minutes.
        timerSeconds: !changes.length && timer >= 10 && timer <= 1800 ? Math.round(timer) : undefined,
      };
    } catch (err) {
      console.warn(`[Gusteau] ${this.cfg.label} chat failed, using local parser.`, err);
      return parseIntent(message, session);
    }
  }
}
