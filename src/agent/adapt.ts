import { GENERIC_WORDS, formatAmount, normalize, roundAmount, sameIngredient, substitutesFor, type SubstituteOption } from '../data/ingredients';
import { DIET_RULES, EQUIPMENT } from '../data/rules';
import type { CookRules, CookSession, PantryItem, PlanDiff, Recipe, RecipeIngredient, RecipeStep, SessionChange, Substitution } from '../types';
import { availability, breaksRule, describeRules, isEssential, remainingMinutes, scaleRecipe, stepEquipment } from './kitchen';
import { validateStages } from './stages';

// ─────────────────────────────────────────────────────────────
// The replanning loop:
//   1. applyChanges  → update rules, pantry and unavailable items
//   2. adaptRecipe   → re-derive the remaining plan from the
//                      ORIGINAL recipe plus everything known now
//                      (swap, drop or buy each problem ingredient)
//   3. validatePlan  → independent check of every hard rule
//   4. finalizeReplan→ keep completed steps, diff, Gusteau's reply
//
// Re-deriving from the original means "I found the rice after all"
// can undo a swap. A swap that a finished step already relied on is
// locked, and finished steps are never rewritten.
// ─────────────────────────────────────────────────────────────

export const uid = () => Math.random().toString(36).slice(2, 10);

export interface AdaptContext {
  rules: CookRules;
  pantry: PantryItem[];
  basics: boolean;
  unavailable: string[];
  leaveOut: string[];
  completed: string[];
}

/** The plan before this replan, so finished work can be carried over exactly. */
export interface AdaptPrior {
  recipe: Recipe;
  substitutions: Substitution[];
}

export type BlockerKind = 'unavailable' | 'rule' | 'missing';

export interface AdaptResult {
  recipe: Recipe;
  substitutions: Substitution[];
  /** Hard-rule problems Gusteau couldn't solve. Empty means the plan is safe. */
  violations: string[];
  /** The ingredients behind those problems, so the UI can offer "leave it out" or "allow a purchase". */
  blockers: { name: string; kind: BlockerKind }[];
  /** Things the user should know, e.g. an allergen already used in a finished step. */
  notes: string[];
}

export const contextOf = (s: CookSession): AdaptContext => ({
  rules: s.rules,
  pantry: s.pantry,
  basics: s.pantryBasics,
  unavailable: s.unavailable,
  leaveOut: s.leaveOut,
  completed: s.completedStepKeys,
});

export const priorOf = (s: CookSession): AdaptPrior => ({ recipe: s.recipe, substitutions: s.substitutions });

const isUnavailable = (name: string, ctx: AdaptContext) => ctx.unavailable.some((u) => sameIngredient(u, name));

/** 'yes' when the user has it, 'unknown' when Gusteau doesn't know their pantry. */
function hasIt(name: string, ctx: AdaptContext): 'yes' | 'no' | 'unknown' {
  if (isUnavailable(name, ctx)) return 'no';
  const a = availability(name, ctx.pantry, ctx.basics);
  return a === 'have' || a === 'staple' ? 'yes' : a === 'unknown' ? 'unknown' : 'no';
}

const stepsUsing = (r: Recipe, id: string) => r.steps.filter((s) => s.uses.includes(id));
/** Still needed: used by an unfinished step, or not tied to any step. */
const stillNeeded = (r: Recipe, i: RecipeIngredient, completed: string[]) => {
  const used = stepsUsing(r, i.id);
  return !used.length || used.some((s) => !completed.includes(s.key));
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Every way a step might mention an ingredient, longest first. */
function mentionPattern(name: string): RegExp {
  const n = normalize(name);
  const head = n.split(' ').pop() ?? n;
  const forms = [name.toLowerCase(), n, GENERIC_WORDS.has(head) ? '' : head].filter((f) => f.length > 2);
  const unique = [...new Set(forms)].sort((a, b) => b.length - a.length);
  return new RegExp(`\\b(${unique.map(escapeRe).join('|')})(e?s)?\\b`, 'gi');
}

function replaceMentions(text: string, name: string, replacement: string): string {
  return text.replace(mentionPattern(name), (m) => (m[0] === m[0].toUpperCase() ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement));
}

function removeMentions(text: string, name: string): string {
  const p = mentionPattern(name).source;
  const cleaned = text
    // "…, then scatter with the cheese." → "…."
    .replace(new RegExp(`(,\\s*then|,?\\s+and(\\s+then)?|\\s+then)?\\s+(top(ped)?|garnish(ed)?|sprinkled?|scatter(ed)?|served?)( it| them)? with (the |some )?${p}`, 'gi'), '')
    // "tomatoes, chipotle and oregano" → "tomatoes and chipotle"
    .replace(new RegExp(`,\\s*([^,.;]+?)\\s+and\\s+(the |some |a little )?${p}`, 'gi'), ' and $1')
    .replace(new RegExp(`(,\\s*|\\s+and\\s+)(the |some |a little )?${p}`, 'gi'), '')
    .replace(new RegExp(`(the |some )?${p}(,\\s*|\\s+and\\s+)`, 'gi'), '');
  return mentionPattern(name).test(cleaned) ? `${cleaned} Skip the ${normalize(name)}.` : cleaned;
}

/** A step that is "about" one ingredient, such as "Cook the rice". */
const isAbout = (step: RecipeStep, ing: RecipeIngredient) => step.uses.length === 1 || mentionPattern(ing.name).test(step.title);

type Choice = { kind: 'swap'; option: SubstituteOption; toBuy: boolean; unsure: boolean } | { kind: 'drop' } | { kind: 'buy' };

function options(ing: RecipeIngredient, recipe: Recipe, ctx: AdaptContext): SubstituteOption[] {
  return substitutesFor(ing.name).filter(
    (o) =>
      !breaksRule(o.name, ctx.rules) &&
      hasIt(o.name, ctx) !== 'no' &&
      (!o.method || o.method.equipment.some((e) => ctx.rules.equipment.includes(e))) &&
      !recipe.ingredients.some((i) => i.id !== ing.id && sameIngredient(i.name, o.name)),
  );
}

function choose(ing: RecipeIngredient, why: BlockerKind, recipe: Recipe, ctx: AdaptContext): Choice | null {
  const opts = options(ing, recipe, ctx);
  const owned = opts.find((o) => hasIt(o.name, ctx) === 'yes');
  if (owned) return { kind: 'swap', option: owned, toBuy: false, unsure: false };
  if (!isEssential(ing) || ctx.leaveOut.some((l) => sameIngredient(l, ing.name))) return { kind: 'drop' };
  if (!ctx.pantry.length && opts.length) return { kind: 'swap', option: opts[0], toBuy: false, unsure: true };
  if (ctx.rules.purchasesAllowed) {
    if (opts.length) return { kind: 'swap', option: opts[0], toBuy: true, unsure: false };
    if (why !== 'rule') return { kind: 'buy' };
  }
  return null;
}

function remapStages(r: Recipe, keyMap: Map<string, string[]>, completed: string[], retitle: (title: string, onlyStepReplaced: boolean) => string): Recipe['stages'] {
  return r.stages
    .map((st) => {
      if (st.stepKeys.every((k) => completed.includes(k))) return st;
      const stepKeys = st.stepKeys.flatMap((k) => keyMap.get(k) ?? [k]);
      const only = st.stepKeys.length === 1 && keyMap.has(st.stepKeys[0]);
      return { ...st, stepKeys, title: retitle(st.title, only) };
    })
    .filter((st) => st.stepKeys.length);
}

function applySwap(r: Recipe, ing: RecipeIngredient, o: SubstituteOption, toBuy: boolean, completed: string[]): Recipe {
  const id = `${ing.id}~${slug(o.name)}`;
  const amount = o.perServing ? o.perServing.amount * r.servings : ing.amount === null ? null : roundAmount(ing.amount * (o.ratio ?? 1), o.unit ?? ing.unit);
  const swapped: RecipeIngredient = {
    id,
    name: o.name,
    amount,
    unit: o.perServing ? o.perServing.unit : (o.unit ?? ing.unit),
    substitutedFor: ing.name,
    toBuy: toBuy || undefined,
  };
  const word = o.inText ?? o.name.toLowerCase();
  const methodStep = (key: string): RecipeStep => {
    const m = o.method!;
    return { key, title: m.title, text: m.text, uses: [id], timerSeconds: m.timerSeconds, minutes: m.minutes, technique: m.technique };
  };
  let steps: RecipeStep[] = [];
  let methodPlaced = !o.method;
  const keyMap = new Map<string, string[]>();
  for (const s of r.steps) {
    if (completed.includes(s.key) || !s.uses.includes(ing.id)) {
      steps.push(s);
      continue;
    }
    if (!methodPlaced && isAbout(s, ing)) {
      const ns = methodStep(`${s.key}~${slug(o.name)}`);
      steps.push(ns);
      keyMap.set(s.key, [ns.key]);
      methodPlaced = true;
      continue;
    }
    steps.push({ ...s, title: replaceMentions(s.title, ing.name, word), text: replaceMentions(s.text, ing.name, word), uses: s.uses.map((u) => (u === ing.id ? id : u)) });
  }
  if (!methodPlaced) {
    // The original came ready to use; prepare the substitute just before it's first needed.
    const at = Math.max(0, steps.findIndex((s) => s.uses.includes(id) && !completed.includes(s.key)));
    const ns = methodStep(`prep~${slug(o.name)}`);
    const before = steps[at]?.key;
    steps = [...steps.slice(0, at), ns, ...steps.slice(at)];
    if (before) keyMap.set(before, [ns.key, before]);
  }
  let title = r.title;
  if (o.titleWord !== undefined && mentionPattern(ing.name).test(title)) {
    title = replaceMentions(title, ing.name, o.titleWord)
      .replace(/\s*&\s*(?=&|$)|^\s*&\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }
  return {
    ...r,
    title,
    ingredients: r.ingredients.map((i) => (i.id === ing.id ? swapped : i)),
    steps,
    stages: remapStages(r, keyMap, completed, (t, only) => (only && o.method ? o.method.title : replaceMentions(t, ing.name, word))),
  };
}

function applyDrop(r: Recipe, ing: RecipeIngredient, completed: string[]): Recipe {
  const keyMap = new Map<string, string[]>();
  const steps: RecipeStep[] = [];
  for (const s of r.steps) {
    if (completed.includes(s.key) || !s.uses.includes(ing.id)) steps.push(s);
    // A step that only handled this ingredient ("Melt the cheese") goes away entirely.
    else if (s.uses.length === 1 && isAbout(s, ing)) keyMap.set(s.key, []);
    else steps.push({ ...s, text: removeMentions(s.text, ing.name), uses: s.uses.filter((u) => u !== ing.id) });
  }
  return {
    ...r,
    ingredients: r.ingredients.filter((i) => i.id !== ing.id),
    steps,
    stages: remapStages(r, keyMap, completed, (t) => t),
  };
}

/**
 * Re-derive the plan from the original recipe for the current context.
 * With `prior`, swaps that finished steps rely on are kept, and finished
 * steps read exactly as they did when the user cooked them.
 */
export function adaptRecipe(original: Recipe, ctx: AdaptContext, prior?: AdaptPrior): AdaptResult {
  let r: Recipe = { ...original };
  const substitutions: Substitution[] = [];
  const violations: string[] = [];
  const blockers: AdaptResult['blockers'] = [];
  const notes: string[] = [];
  const locked = prior ? lockedSwaps(prior, ctx.completed) : [];

  for (const ing of original.ingredients) {
    const lock = locked.find((l) => l.from === ing.name);
    const lockedOption = lock && substitutesFor(ing.name).find((x) => x.name === lock.to);
    if (lockedOption) {
      r = applySwap(r, r.ingredients.find((i) => i.id === ing.id)!, lockedOption, false, ctx.completed);
      substitutions.push(lock);
      continue;
    }
    const current = r.ingredients.find((i) => i.id === ing.id);
    if (!current) continue;
    const ruleBroken = breaksRule(ing.name, ctx.rules);
    if (!stillNeeded(r, current, ctx.completed)) {
      // Only finished steps use it: keep whatever the last plan decided.
      const earlier = prior?.substitutions.find((x) => x.from === ing.name);
      if (earlier?.kind === 'drop') {
        r = { ...r, ingredients: r.ingredients.filter((i) => i.id !== ing.id) };
        substitutions.push(earlier);
      }
      if (ruleBroken) notes.push(`${ing.name} already went into a step you finished, and it breaks “${ruleBroken}”. I can’t take it back out, so please check before serving.`);
      continue;
    }
    const missing = availability(ing.name, ctx.pantry, ctx.basics) === 'missing';
    const why: BlockerKind | 'shop' | null = isUnavailable(ing.name, ctx)
      ? 'unavailable'
      : ruleBroken
        ? 'rule'
        : missing
          ? ctx.rules.purchasesAllowed
            ? 'shop'
            : 'missing'
          : null;
    if (!why) continue;
    if (why === 'shop') {
      // Allowed to shop and the user doesn't have it: prefer something they own, otherwise add it to the list.
      const owned = options(current, r, ctx).find((o) => hasIt(o.name, ctx) === 'yes');
      if (owned) {
        r = applySwap(r, current, owned, false, ctx.completed);
        substitutions.push({ kind: 'swap', from: ing.name, to: owned.name, reason: `Not in your kitchen. ${owned.note}` });
      } else if (isEssential(current)) {
        r = { ...r, ingredients: r.ingredients.map((i) => (i.id === ing.id ? { ...i, toBuy: true } : i)) };
        substitutions.push({ kind: 'buy', from: ing.name, to: '', reason: 'Not in your kitchen, so it’s on your shopping list.' });
      } else {
        r = applyDrop(r, current, ctx.completed);
        substitutions.push({ kind: 'drop', from: ing.name, to: '', reason: 'It’s optional, so I left it out instead of adding a purchase.' });
      }
      continue;
    }
    const choice = choose(current, why, r, ctx);
    const reasonFor = why === 'unavailable' ? 'You’re out' : why === 'rule' ? `Breaks “${ruleBroken}”` : 'Not in your kitchen';
    if (!choice) {
      blockers.push({ name: ing.name, kind: why });
      violations.push(
        why === 'rule'
          ? `${ing.name} breaks “${ruleBroken}”, and I don’t know a safe swap for it.`
          : `This needs ${ing.name.toLowerCase()}, and I can’t find a swap you have${ctx.rules.purchasesAllowed ? '' : ' (purchases are off)'}.`,
      );
      continue;
    }
    if (choice.kind === 'swap') {
      r = applySwap(r, current, choice.option, choice.toBuy, ctx.completed);
      substitutions.push({ kind: 'swap', from: ing.name, to: choice.option.name, reason: `${reasonFor}. ${choice.option.note}`, unsure: choice.unsure || undefined });
    } else if (choice.kind === 'drop') {
      r = applyDrop(r, current, ctx.completed);
      const agreed = ctx.leaveOut.some((l) => sameIngredient(l, ing.name));
      substitutions.push({ kind: 'drop', from: ing.name, to: '', reason: `${reasonFor}, so ${agreed ? 'as agreed, ' : ''}I left it out${agreed ? '' : '. The dish works without it'}.` });
    } else {
      r = { ...r, ingredients: r.ingredients.map((i) => (i.id === ing.id ? { ...i, toBuy: true } : i)) };
      substitutions.push({ kind: 'buy', from: ing.name, to: '', reason: `${reasonFor}. There’s no swap you have, so it’s on your shopping list.` });
    }
  }

  if (prior) {
    // Finished steps stay exactly as the user saw them.
    const done = new Map(prior.recipe.steps.filter((s) => ctx.completed.includes(s.key)).map((s) => [s.key, s]));
    r = { ...r, steps: r.steps.map((s) => done.get(s.key) ?? s) };
  }
  r.totalMinutes = Math.max(1, Math.round(r.steps.reduce((s, st) => s + (st.minutes ?? 0), 0)));
  r.adaptedFrom = substitutions.length ? original.title : undefined;
  // Don't repeat a problem the loop already explained.
  const checks = validatePlan(r, ctx).filter((v) => !blockers.some((b) => v.startsWith(b.name)));
  return { recipe: r, substitutions, violations: [...violations, ...checks], blockers, notes };
}

/** Independent safety check on the remaining plan, including model-written ones. */
export function validatePlan(r: Recipe, ctx: AdaptContext): string[] {
  const v: string[] = [];
  for (const i of r.ingredients) {
    if (!stillNeeded(r, i, ctx.completed)) continue;
    const rule = breaksRule(i.name, ctx.rules);
    if (rule) v.push(`${i.name} breaks “${rule}”.`);
    if (isUnavailable(i.name, ctx) && !i.toBuy) v.push(`${i.name} is marked unavailable.`);
    if (i.toBuy && !ctx.rules.purchasesAllowed) v.push(`${i.name} would need to be bought, but purchases are off.`);
    if (!i.toBuy && !ctx.rules.purchasesAllowed && isEssential(i) && availability(i.name, ctx.pantry, ctx.basics) === 'missing') v.push(`${i.name} isn’t in your kitchen.`);
  }
  for (const s of r.steps.filter((st) => !ctx.completed.includes(st.key))) {
    for (const e of stepEquipment(s)) {
      if (!ctx.rules.equipment.includes(e)) v.push(`“${s.title}” needs a ${EQUIPMENT[e].label.toLowerCase()}, which you don’t have.`);
    }
  }
  const left = remainingMinutes(r, ctx.completed);
  if (ctx.rules.timeLimit && left > ctx.rules.timeLimit) v.push(`The rest takes about ${left} minutes, and you have ${ctx.rules.timeLimit}.`);
  const stages = validateStages(r.steps, r.stages, false);
  if (!stages.ok) v.push(`The stage plan is inconsistent (${stages.problems[0]}).`);
  return [...new Set(v)];
}

/** Swaps that finished steps depend on, so a replan must keep them. */
export function lockedSwaps(prior: AdaptPrior, completed: string[]): Substitution[] {
  return prior.substitutions.filter((sub) => {
    if (sub.kind !== 'swap') return false;
    const ing = prior.recipe.ingredients.find((i) => i.substitutedFor === sub.from);
    return !!ing && prior.recipe.steps.some((st) => completed.includes(st.key) && st.uses.includes(ing.id));
  });
}

// ── Changes ─────────────────────────────────────────────────
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function applyChanges(s: CookSession, changes: SessionChange[]): { session: CookSession; labels: string[] } {
  const rules = { ...s.rules };
  let pantry = [...s.pantry];
  let unavailable = [...s.unavailable];
  const leaveOut = [...s.leaveOut];
  let original = s.original;
  const labels: string[] = [];
  for (const ch of changes) {
    switch (ch.type) {
      case 'remove_ingredient': {
        const name = titleCase(ch.name.trim());
        pantry = pantry.filter((p) => !sameIngredient(p.name, name));
        if (!unavailable.some((u) => sameIngredient(u, name))) unavailable.push(name);
        labels.push(`Marked ${name.toLowerCase()} as unavailable`);
        break;
      }
      case 'add_ingredient': {
        const name = titleCase(ch.name.trim());
        unavailable = unavailable.filter((u) => !sameIngredient(u, name));
        if (!pantry.some((p) => sameIngredient(p.name, name))) pantry.push({ id: uid(), name, source: 'chat' });
        labels.push(`Added ${name.toLowerCase()} to your kitchen`);
        break;
      }
      case 'leave_out':
        if (!leaveOut.some((l) => sameIngredient(l, ch.name))) leaveOut.push(ch.name);
        labels.push(`Cooking without ${ch.name.toLowerCase()}`);
        break;
      case 'set_time':
        rules.timeLimit = Math.max(1, Math.round(ch.minutes));
        labels.push(`${rules.timeLimit} minutes left`);
        break;
      case 'set_servings': {
        const n = Math.max(1, Math.min(12, Math.round(ch.servings)));
        labels.push(`Servings ${rules.servings} → ${n}`);
        rules.servings = n;
        original = scaleRecipe(s.original, n);
        break;
      }
      case 'remove_equipment':
        rules.equipment = rules.equipment.filter((e) => e !== ch.equipment);
        labels.push(`No ${EQUIPMENT[ch.equipment].label.toLowerCase()}`);
        break;
      case 'set_purchases':
        rules.purchasesAllowed = ch.allowed;
        labels.push(ch.allowed ? 'Purchases allowed' : 'No purchases');
        break;
      case 'add_exclusion':
        if (ch.rule && !rules.hardExclusions.includes(ch.rule)) {
          rules.hardExclusions = [...rules.hardExclusions, ch.rule];
          labels.push(`Hard rule added: ${DIET_RULES[ch.rule].label}`);
        }
        if (ch.custom && !rules.allergies.some((a) => a.toLowerCase() === ch.custom!.toLowerCase())) {
          rules.allergies = [...rules.allergies, ch.custom];
          labels.push(`Hard rule added: no ${ch.custom}`);
        }
        break;
    }
  }
  return { session: { ...s, rules, pantry, unavailable, leaveOut, original }, labels };
}

/** Short label for a set of changes, e.g. "You're out of rice". */
export function describeChanges(changes: SessionChange[]): string {
  const ch = changes[0];
  if (!ch) return 'Plan adjusted';
  switch (ch.type) {
    case 'remove_ingredient':
      return `You're out of ${ch.name.toLowerCase()}`;
    case 'add_ingredient':
      return `You found ${ch.name.toLowerCase()}`;
    case 'leave_out':
      return `Cook without ${ch.name.toLowerCase()}`;
    case 'set_time':
      return `Only ${ch.minutes} minutes left`;
    case 'add_exclusion':
      return ch.rule ? `Make it ${DIET_RULES[ch.rule].label.toLowerCase()}` : `No ${ch.custom}`;
    case 'set_servings':
      return `Cooking for ${ch.servings}`;
    case 'remove_equipment':
      return `No ${EQUIPMENT[ch.equipment].label.toLowerCase()}`;
    case 'set_purchases':
      return ch.allowed ? 'Purchases allowed' : 'No purchases';
  }
}

// ── Finalize ────────────────────────────────────────────────
export function finalizeReplan(before: CookSession, after: CookSession, result: AdaptResult, trigger: string, changes: SessionChange[], labels: string[]): CookSession {
  const prev = before.recipe;
  const infeasible = result.violations.length > 0;
  const next = infeasible ? prev : result.recipe;
  const nextKeys = new Set(next.steps.map((s) => s.key));
  const prevKeys = new Set(prev.steps.map((s) => s.key));
  const completed = before.completedStepKeys.filter((k) => nextKeys.has(k));
  const firstOpen = next.steps.findIndex((s) => !completed.includes(s.key));
  const stepIndex = firstOpen === -1 ? next.steps.length : firstOpen;
  const isNew = (sub: Substitution) => !before.substitutions.some((b) => b.kind === sub.kind && b.from === sub.from && b.to === sub.to);
  const fresh = infeasible ? [] : result.substitutions.filter(isNew);

  const diff: PlanDiff = {
    id: uid(),
    trigger,
    titleBefore: prev.title,
    titleAfter: next.title,
    minutesBefore: remainingMinutes(prev, before.completedStepKeys),
    minutesAfter: remainingMinutes(next, completed),
    substitutions: fresh,
    dropped: fresh.filter((x) => x.kind === 'drop').map((x) => x.from),
    stepsAdded: infeasible ? [] : next.steps.filter((s) => !prevKeys.has(s.key)).map((s) => s.title),
    stepsRemoved: infeasible ? [] : prev.steps.filter((s) => !nextKeys.has(s.key)).map((s) => s.title),
    stepsKept: completed.length,
    newPurchases: infeasible ? [] : next.ingredients.filter((i) => i.toBuy && !prev.ingredients.some((p) => p.id === i.id && p.toBuy)).map((i) => i.name),
    rulesKept: describeRules(after.rules),
    stateChanges: labels,
    message: '',
    infeasible,
    offers: infeasible ? pauseOptions(result, after.rules) : undefined,
  };
  diff.message = gusteauSays(diff, before, after, changes, result, next.steps[stepIndex]?.title);

  return {
    ...after,
    recipe: next,
    // An infeasible change still updates what Gusteau knows, but the plan pauses until the user decides.
    paused: infeasible,
    substitutions: infeasible ? before.substitutions : result.substitutions,
    completedStepKeys: completed,
    stepIndex: infeasible ? before.stepIndex : stepIndex,
    history: [diff, ...before.history],
    chat: [...after.chat, { id: uid(), from: 'gusteau', text: diff.message, diffId: diff.id }],
  };
}

// ── Gusteau's voice: warm, concise, practical ───────────────
function opener(ch: SessionChange | undefined): string {
  if (!ch) return 'Got it.';
  switch (ch.type) {
    case 'remove_ingredient':
      return `No ${ch.name.toLowerCase()}? No problem.`;
    case 'add_ingredient':
      return `Ooh, ${ch.name.toLowerCase()}. Let me put that to work.`;
    case 'leave_out':
      return `Okay, we’ll cook without the ${ch.name.toLowerCase()}.`;
    case 'set_time':
      return `${ch.minutes} minutes it is.`;
    case 'add_exclusion':
      return ch.rule ? `${DIET_RULES[ch.rule].label}, absolutely.` : `Got it. No ${ch.custom}, ever.`;
    case 'set_servings':
      return `Cooking for ${ch.servings}? Love a full table.`;
    case 'remove_equipment':
      return `No ${EQUIPMENT[ch.equipment].label.toLowerCase()}. Let’s see.`;
    case 'set_purchases':
      return ch.allowed ? 'Shopping is allowed. Noted.' : 'No shopping. We cook with what you have.';
  }
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What Gusteau can offer when it has to pause. */
export function pauseOptions(result: Pick<AdaptResult, 'blockers'>, rules: CookRules): { leaveOut: string[]; allowPurchase: boolean } {
  return {
    leaveOut: result.blockers.map((b) => b.name),
    allowPurchase: !rules.purchasesAllowed && result.blockers.some((b) => b.kind !== 'rule'),
  };
}

function gusteauSays(d: PlanDiff, before: CookSession, s: CookSession, changes: SessionChange[], result: AdaptResult, resumeAt: string | undefined): string {
  if (d.infeasible) {
    const why = result.violations
      .slice(0, 2)
      .map((v) => lowerFirst(v.replace(/\.$/, '')))
      .join('; ');
    const opts = pauseOptions(result, s.rules);
    const offers = [
      ...opts.leaveOut.slice(0, 1).map((n) => `cook without the ${n.toLowerCase()}`),
      opts.allowPurchase && 'allow a quick purchase',
      'undo that change',
      'pick a different recipe',
    ].filter(Boolean);
    return `I can’t make the rest of this plan safely: ${why}. I won’t break a hard rule, so I’ve paused here. Would you like to ${offers.join(', ')}?`.replace(/, ([^,]*)\?$/, ', or $1?');
  }
  const first = changes[0];
  const parts: string[] = [];
  if (first?.type === 'add_ingredient') {
    const kept = result.substitutions.find((x) => x.kind === 'swap' && sameIngredient(x.from, first.name));
    if (kept) return `Good to know. The ${kept.to.toLowerCase()} already went into a step you finished, so we’ll stick with ${kept.to.toLowerCase()} this time. I’ll remember the ${first.name.toLowerCase()} for next time.`;
  }
  const removed = first?.type === 'remove_ingredient' ? first.name : null;
  if (removed && !d.substitutions.some((x) => sameIngredient(x.from, removed))) {
    const inRecipe = s.original.ingredients.some((i) => sameIngredient(i.name, removed));
    const alreadySwapped = before.substitutions.some((x) => sameIngredient(x.from, removed));
    parts.push(
      alreadySwapped
        ? `Already handled: I’d swapped out the ${removed.toLowerCase()}.`
        : inRecipe
          ? `Good news: the ${removed.toLowerCase()} already went into a step you finished, so nothing changes.`
          : `Good news: this dish doesn’t use ${removed.toLowerCase()}.`,
    );
  } else parts.push(opener(first));
  for (const sub of d.substitutions) {
    const why = sub.reason.split('. ').slice(1).join('. ');
    if (sub.kind === 'swap') parts.push(`I swapped the ${sub.from.toLowerCase()} for ${sub.to.toLowerCase()}${sub.unsure ? ' (tell me if you don’t have it)' : ''}.${why ? ` ${why}` : ''}`);
    if (sub.kind === 'drop') parts.push(`I left out the ${sub.from.toLowerCase()}.`);
    if (sub.kind === 'buy') parts.push(`${sub.from} goes on your shopping list.`);
  }
  if (d.stepsRemoved.length && !d.stepsAdded.length) parts.push(`That means no “${d.stepsRemoved[0]}” step.`);
  if (d.titleAfter !== d.titleBefore) parts.push(`It’s now a ${d.titleAfter}.`);
  if (d.minutesAfter !== d.minutesBefore) parts.push(`About ${d.minutesAfter} minutes to go.`);
  const changed = d.substitutions.length || d.stepsAdded.length || d.stepsRemoved.length;
  if (!changed && d.titleAfter === d.titleBefore && !removed) parts.push('Your plan already fits, so nothing needs to change.');
  const kept = d.rulesKept.filter((k) => !/serving|appliances|Purchases/.test(k)).slice(0, 4).map((k) => k.toLowerCase());
  if (kept.length && changed) parts.push(`Still ${kept.join(', ')}.`);
  if (d.stepsKept && changed && resumeAt) parts.push(`Your finished steps still count. Pick up at “${resumeAt}”.`);
  if (d.newPurchases.length) parts.push(`Heads up: this adds ${d.newPurchases.join(', ')} to your shopping list.`);
  else if (!s.rules.purchasesAllowed && changed) parts.push('Nothing new to buy.');
  parts.push(...result.notes);
  return parts.join(' ');
}

/** "1 cup", "to serve", "to taste". */
export const amountOf = (i: RecipeIngredient) => (i.amount === null && !i.unit && i.note ? i.note : formatAmount(i.amount, i.unit));
