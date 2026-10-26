import { describeChanges, substitutionHints, validatePlan, contextOf, type AdaptPrior, type AdaptResult } from '../../agent/adapt';
import { validateStages } from '../../agent/stages';
import { grainOf, proteinOf, sameIngredient, substitutesFor } from '../../data/ingredients';
import { DIET_RULE_IDS, EQUIPMENT_IDS } from '../../data/rules';
import { STAGE_ICON_IDS } from '../../data/stageIcons';
import type { CookSession, DetectedIngredient, DietRuleId, Equipment, Recipe, RecipeIngredient, RecipeStep, SessionChange, Substitution } from '../../types';
import { explainRequest, howToRequest, parseCommand, parseIntent } from '../mock/intentParser';
import { answerOffer, groundedAnswer } from '../mock/kitchenHelp';
import { streamChat } from './chatStream';
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
    pantry_basics: s.pantryBasics ? ['salt', 'pepper', 'cooking oil', 'water'] : [],
  };
}

const HINT_STATUS = { have: 'they have it', missing: 'not in their kitchen', unknown: 'pantry unknown' } as const;

const CHEESE = /(cheese|cheddar|mozzarella|parmesan|pecorino|feta|monterey jack|queso|halloumi|paneer|ricotta|gouda|gruy[eè]re)/i;

/** A swap a model proposes must do the same job in the dish: a known substitute, or the same kind of ingredient. */
function sameRole(from: string, to: string): boolean {
  if (substitutesFor(from).some((o) => sameIngredient(o.name, to))) return true;
  const kind = (f: (n: string) => string | null) => !!f(from) && f(from) === f(to);
  return kind(proteinOf) || kind(grainOf) || (CHEESE.test(from) && CHEESE.test(to)) || sameIngredient(from, to);
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
        if (from && to) out.push({ type: 'swap_ingredient', from, to });
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
        `You are Gusteau, a practical chef. A cook is mid-recipe and some ingredients are a problem. Propose swaps ONLY from the pantry list, never break a hard rule, use only the listed equipment, and rewrite ONLY the unfinished steps. Only swap in something that plays the same role in the dish (another melting cheese for cheese, another grain or bread for rice). If nothing they have fits, return {\"swaps\": [], \"steps\": []} and Gusteau will ask them what to do. Keep each unchanged step's "key". Never claim to verify allergens or food safety.`,
        `Session: ${JSON.stringify(sessionSummary(session))}
Problems: ${JSON.stringify(draft.blockers)}
Ingredients: ${JSON.stringify(draft.recipe.ingredients.map((i) => ({ name: i.name, amount: [i.amount, i.unit].filter(Boolean).join(' ') })))}
Unfinished steps: ${JSON.stringify(draft.recipe.steps.filter((s) => !done.has(s.key)).map((s) => ({ key: s.key, title: s.title, text: s.text })))}

Respond with ONLY JSON: {"swaps":[{"from": string, "to": string, "amount": string}], "steps":[{"key": string, "title": string, "text": string}]}`,
        1500,
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

  async warmUp(): Promise<void> {
    await streamChat({ model: this.cfg.textModel, extraBody: this.cfg.extraBody, maxTokens: 1, messages: [{ role: 'user', content: 'Hi' }], signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000) });
  }

  // ── 4. Conversation → structured changes ──
  async interpretMessage(message: string, session: CookSession, opts: { onReply?(textSoFar: string): void } = {}): Promise<InterpretResult> {
    // Commands ("next", "set a 5 minute timer") are answered locally, instantly.
    const cmd = parseCommand(message);
    if (cmd) return cmd;
    // "Yes" or "no" to a swap Gusteau just offered is answered instantly too.
    const answered = answerOffer(message, session) ?? groundedAnswer(message, session);
    if (answered) return answered;
    // "What is mirin?" is answered from Wikipedia, with pictures.
    const explain = explainRequest(message);
    if (explain) return { reply: null, changes: [], explain };
    const step = session.recipe.steps[session.stepIndex];
    const hints = substitutionHints(session).map((h) => `${h.ingredient}: ${h.options.map((o) => `${o.name} (${HINT_STATUS[o.status]})`).join(', ')}`);
    const unused = session.pantry.filter((p) => !session.recipe.ingredients.some((i) => sameIngredient(i.name, p.name))).map((p) => p.name);
    const recent = session.chat
      .slice(-RECENT_TURNS)
      .map((m) => `${m.from === 'user' ? 'Cook' : 'Gusteau'}: ${m.text}`)
      .join('\n');
    try {
      let streamed = '';
      const text = await streamChat({
        model: this.cfg.textModel,
        extraBody: this.cfg.extraBody,
        temperature: 0.2,
        maxTokens: 600,
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? 120_000),
        messages: [
          {
            role: 'system',
            content: `You are Gusteau, a warm, concise chef helping someone cook. Their messages may come from speech recognition, so go with the most likely meaning. Convert the message into structured session changes. Allowed change types:
{"type":"remove_ingredient","name":string} | {"type":"add_ingredient","name":string} | {"type":"leave_out","name":string} | {"type":"set_time","minutes":number} |
{"type":"add_exclusion","rule"?: ${DIET_RULE_IDS.map((r) => `"${r}"`).join('|')},"custom"?:string} |
{"type":"set_servings","servings":number} | {"type":"remove_equipment","equipment":${EQUIPMENT_IDS.map((e) => `"${e}"`).join('|')}} |
{"type":"swap_ingredient","from": recipe ingredient name,"to":string} | {"type":"add_to_recipe","name":string,"amount"?:string,"how": one short instruction,"when":"now"|"end"}

How to help:
- Substitutions. "What can I use instead of X?": answer from the safe swaps listed (they already fit the cook's rules and equipment), preferring ones the cook has, and say why in a few words. Then ask if they want to switch, and put that swap_ingredient in "offer". "Use Y instead of X" or "yes, use Y": return swap_ingredient as a change. Never suggest anything that breaks their hard rules.
- Changes to the recipe. "Add spinach", "make it spicier": use add_to_recipe with one practical instruction that needs no equipment they lack. Only add things that fit their rules and that they have in their kitchen. If you're only suggesting, put it in "offer" and ask. Out of something, a diet change, fewer minutes, more people or a broken appliance: use the matching change type.
- Challenges along the way: burning, too salty, too thin, sticking, not cooked through, soggy and so on. Lead with a quick, practical fix for their current step. If the fix needs more cooking time, set "timer_seconds". If an ingredient is ruined, say so and offer remove_ingredient for it, so Gusteau can rework the plan.
- Any other question: answer about their recipe and current step.

The reply is read aloud: one to three short sentences that sound natural spoken, leading with the answer, with no lists, markdown or emoji, and numbers and units written the way you'd say them. If "changes" isn't empty, set "reply" to null; Gusteau explains the checked plan himself. Never claim to verify allergens, freshness or food safety.
Respond with ONLY JSON, in this order: {"changes": [...], "reply": string|null, "offer": [...], "timer_seconds": number|null}`,
          },
          {
            role: 'user',
            content: `Session: ${JSON.stringify(sessionSummary(session))}
Recipe steps: ${JSON.stringify(session.recipe.steps.map((s, i) => `${i + 1}. ${s.title}${session.completedStepKeys.includes(s.key) ? ' (done)' : ''}`))}
Current step: ${JSON.stringify(step ? { title: step.title, text: step.text, tip: step.tip, timer_seconds: step.timerSeconds } : 'all steps finished')}
Ingredients: ${JSON.stringify(session.recipe.ingredients.map((i) => `${i.name}${i.amount !== null ? ` ${i.amount} ${i.unit}`.trimEnd() : ''}`))}
Safe swaps for what's still to be used: ${hints.length ? hints.join('; ') : 'none known'}
Also in their kitchen: ${unused.length ? unused.join(', ') : 'nothing else listed'}
${recent ? `Recent conversation:\n${recent}\n` : ''}Cook: ${message}`,
          },
        ],
        onDelta: (sofar) => {
          const reply = opts.onReply && partialReply(sofar);
          if (reply && reply !== streamed) {
            streamed = reply;
            opts.onReply!(reply);
          }
        },
      });
      const r = extractJson<{ reply?: string | null; changes?: unknown; offer?: unknown; timer_seconds?: unknown }>(text);
      const proposed = sanitizeChanges(r.changes);
      const changes = proposed.filter((c) => grounded(c, message));
      if (changes.length < proposed.length) console.warn(`[Gusteau] Ignored changes the cook didn't ask for:`, proposed.filter((c) => !changes.includes(c)));
      if (!changes.length && !r.reply) return parseIntent(message, session);
      const local = parseIntent(message, session);
      const timer = Number(r.timer_seconds);
      return {
        reply: typeof r.reply === 'string' ? r.reply : null,
        changes,
        trigger: changes.length ? describeChanges(changes) : undefined,
        techniqueId: changes.length ? undefined : local.techniqueId,
        // "How do I dice an onion?": the model answers in words, and videos come with it.
        howTo: changes.length ? undefined : (howToRequest(message, session) ?? undefined),
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
