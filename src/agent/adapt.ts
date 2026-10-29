import { GENERIC_WORDS, formatAmount, normalize, parseIngredientLine, roundAmount, sameIngredient, substitutesFor, type SubstituteOption } from '../data/ingredients';
import { DIET_RULES, EQUIPMENT } from '../data/rules';
import type { Addition, CookRules, CookSession, PantryItem, PlanDiff, Recipe, RecipeIngredient, RecipeStep, SessionChange, Substitution } from '../types';
import { availability, breaksRule, describeRules, isEssential, remainingMinutes, scaleRecipe, stepEquipment } from './kitchen';
import { validateStages } from './stages';

// ─────────────────────────────────────────────────────────────
// The replanning loop:
//   1. applyChanges  → update rules, pantry and unavailable items
//   2. adaptRecipe   → re-derive the remaining plan from the
//                      ORIGINAL recipe plus everything known now
//                      (swap or drop each problem ingredient)
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
  preferredSwaps: { from: string; to: string }[];
  additions: Addition[];
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
  /** The ingredients behind those problems, so the UI can offer "leave it out". */
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
  preferredSwaps: s.preferredSwaps,
  additions: s.additions,
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
    // "Flip, top with the cheese, and cook" → "Flip, and cook".
    .replace(new RegExp(`(,\\s*then|,?\\s+and(\\s+then)?|\\s+then|,)?\\s+(top(ped)?|garnish(ed)?|sprinkled?|scatter(ed)?|served?)( it| them)? with (the |some )?${p}`, 'gi'), '')
    // "tomatoes, chipotle and oregano" → "tomatoes and chipotle"
    .replace(new RegExp(`,\\s*([^,.;]+?)\\s+and\\s+(the |some |a little )?${p}`, 'gi'), ' and $1')
    .replace(new RegExp(`(,\\s*|\\s+and\\s+)(the |some |a little )?${p}`, 'gi'), '')
    .replace(new RegExp(`(the |some )?${p}(,\\s*|\\s+and\\s+)`, 'gi'), '');
  return mentionPattern(name).test(cleaned) ? `${cleaned} Skip the ${normalize(name)}.` : cleaned;
}

/** A step that is "about" one ingredient, such as "Cook the rice". */
const isAbout = (step: RecipeStep, ing: RecipeIngredient) => step.uses.length === 1 || mentionPattern(ing.name).test(step.title);

type Choice = { kind: 'swap'; option: SubstituteOption; unsure: boolean } | { kind: 'drop' };

function options(ing: RecipeIngredient, recipe: Recipe, ctx: AdaptContext): SubstituteOption[] {
  return substitutesFor(ing.name).filter(
    (o) =>
      !breaksRule(o.name, ctx.rules) &&
      hasIt(o.name, ctx) !== 'no' &&
      (!o.method || o.method.equipment.some((e) => ctx.rules.equipment.includes(e))) &&
      !recipe.ingredients.some((i) => i.id !== ing.id && sameIngredient(i.name, o.name)),
  );
}

function choose(ing: RecipeIngredient, recipe: Recipe, ctx: AdaptContext): Choice | null {
  // The cook agreed to go without it: that wins over any swap.
  if (ctx.leaveOut.some((l) => sameIngredient(l, ing.name))) return { kind: 'drop' };
  const opts = options(ing, recipe, ctx);
  const owned = opts.find((o) => hasIt(o.name, ctx) === 'yes');
  if (owned) return { kind: 'swap', option: owned, unsure: false };
  if (!isEssential(ing)) return { kind: 'drop' };
  if (!ctx.pantry.length && opts.length) return { kind: 'swap', option: opts[0], unsure: true };
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

function applySwap(r: Recipe, ing: RecipeIngredient, o: SubstituteOption, completed: string[]): Recipe {
  const id = `${ing.id}~${slug(o.name)}`;
  const amount = o.perServing ? o.perServing.amount * r.servings : ing.amount === null ? null : roundAmount(ing.amount * (o.ratio ?? 1), o.unit ?? ing.unit);
  const swapped: RecipeIngredient = {
    id,
    name: o.name,
    amount,
    unit: o.perServing ? o.perServing.unit : (o.unit ?? ing.unit),
    substitutedFor: ing.name,
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
    else if (s.uses.length === 1 && mentionPattern(ing.name).test(s.title)) keyMap.set(s.key, []);
    else steps.push({ ...s, text: removeMentions(s.text, ing.name), uses: s.uses.filter((u) => u !== ing.id) });
  }
  return {
    ...r,
    ingredients: r.ingredients.filter((i) => i.id !== ing.id),
    steps,
    stages: remapStages(r, keyMap, completed, (t) => t),
  };
}

const titleCaseName = (s: string) => s.trim().charAt(0).toUpperCase() + s.trim().slice(1);

/** A substitute the cook named that isn't in Gusteau's table: used as is, in the same amount. */
const chosenOption = (name: string): SubstituteOption => ({ name: titleCaseName(name), inText: name.trim().toLowerCase(), note: '' });

/** An extra the cook asked for becomes its own short step, before the step that was current when they asked (or before serving). */
function applyAddition(r: Recipe, add: Addition, ctx: AdaptContext): Recipe {
  const key = `extra~${slug(add.name)}`;
  if (r.steps.some((s) => s.key === key)) return r;
  const existing = r.ingredients.find((i) => sameIngredient(i.name, add.name));
  const id = existing?.id ?? `extra-${slug(add.name)}`;
  const parsed = add.amount ? parseIngredientLine(`${add.amount} ${add.name}`) : null;
  const ingredients: RecipeIngredient[] = existing
    ? r.ingredients
    : [
        ...r.ingredients,
        {
          id,
          name: titleCaseName(add.name),
          amount: parsed?.amount ?? null,
          unit: parsed && parsed.amount !== null ? parsed.unit : (add.amount ?? ''),
          note: 'your addition',
        },
      ];
  const step: RecipeStep = { key, title: `Add the ${add.name.trim().toLowerCase()}`, text: add.how, uses: [id], minutes: 1 };
  const open = r.steps.filter((s) => !ctx.completed.includes(s.key));
  const target = (add.beforeKey && open.find((s) => s.key === add.beforeKey)) || open[open.length - 1];
  if (!target) {
    return { ...r, ingredients, steps: [...r.steps, step], stages: r.stages.map((st, i) => (i === r.stages.length - 1 ? { ...st, stepKeys: [...st.stepKeys, key] } : st)) };
  }
  const at = r.steps.indexOf(target);
  return {
    ...r,
    ingredients,
    steps: [...r.steps.slice(0, at), step, ...r.steps.slice(at)],
    stages: r.stages.map((st) => (st.stepKeys.includes(target.key) ? { ...st, stepKeys: st.stepKeys.flatMap((k) => (k === target.key ? [key, k] : [k])) } : st)),
  };
}

export interface SwapHint {
  ingredient: string;
  options: { name: string; status: 'have' | 'missing' | 'unknown'; note: string }[];
}

/**
 * The safe swaps for every ingredient still to be used: they pass the
 * cook's rules and equipment, and are marked with whether the cook has
 * them. This grounds Gusteau's answers to "what can I use instead of…?".
 */
export function substitutionHints(s: CookSession): SwapHint[] {
  const ctx = contextOf(s);
  return s.recipe.ingredients
    .filter((i) => stillNeeded(s.recipe, i, ctx.completed))
    .map((i) => ({
      ingredient: i.name,
      options: substitutesFor(i.substitutedFor ?? i.name)
        .filter((o) => !breaksRule(o.name, ctx.rules) && (!o.method || o.method.equipment.some((e) => ctx.rules.equipment.includes(e))) && !sameIngredient(o.name, i.name))
        .map((o) => {
          const have = hasIt(o.name, ctx);
          const status = have === 'yes' ? 'have' : have === 'unknown' ? 'unknown' : 'missing';
          return { name: o.name, status: status as SwapHint['options'][number]['status'], note: o.note };
        }),
    }))
    .filter((h) => h.options.length);
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
      r = applySwap(r, r.ingredients.find((i) => i.id === ing.id)!, lockedOption, ctx.completed);
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
    // The cook picked the substitute themselves. It still has to pass every rule.
    const pref = ctx.preferredSwaps.find((p) => sameIngredient(p.from, ing.name) || p.from.toLowerCase() === ing.name.toLowerCase());
    if (pref) {
      const option = substitutesFor(ing.name).find((o) => sameIngredient(o.name, pref.to)) ?? chosenOption(pref.to);
      const rule = breaksRule(option.name, ctx.rules);
      const have = hasIt(option.name, ctx);
      const noEquipment = option.method && !option.method.equipment.some((e) => ctx.rules.equipment.includes(e));
      if (rule) violations.push(`${option.name} breaks “${rule}”, so I can’t use it instead of ${ing.name.toLowerCase()}.`);
      else if (have === 'no') violations.push(`You said you don’t have ${option.name.toLowerCase()}.`);
      else if (noEquipment) violations.push(`${option.name} needs equipment you don’t have.`);
      else {
        r = applySwap(r, current, option, ctx.completed);
        substitutions.push({ kind: 'swap', from: ing.name, to: option.name, reason: `Your choice. ${option.note}`.trim() });
        continue;
      }
    }
    const missing = availability(ing.name, ctx.pantry, ctx.basics) === 'missing';
    const why: BlockerKind | null = isUnavailable(ing.name, ctx) ? 'unavailable' : ruleBroken ? 'rule' : missing ? 'missing' : null;
    if (!why) continue;
    const choice = choose(current, r, ctx);
    const reasonFor = why === 'unavailable' ? 'You’re out' : why === 'rule' ? `Breaks “${ruleBroken}”` : 'You don’t have it';
    if (!choice) {
      blockers.push({ name: ing.name, kind: why });
      violations.push(
        why === 'rule'
          ? `${ing.name} breaks “${ruleBroken}”, and I don’t know a safe swap for it.`
          : `This needs ${ing.name.toLowerCase()}, and I can’t find a swap you have.`,
      );
      continue;
    }
    if (choice.kind === 'swap') {
      r = applySwap(r, current, choice.option, ctx.completed);
      substitutions.push({ kind: 'swap', from: ing.name, to: choice.option.name, reason: `${reasonFor}. ${choice.option.note}`, unsure: choice.unsure || undefined });
    } else {
      r = applyDrop(r, current, ctx.completed);
      const agreed = ctx.leaveOut.some((l) => sameIngredient(l, ing.name));
      substitutions.push({ kind: 'drop', from: ing.name, to: '', reason: `${reasonFor}, so ${agreed ? 'as agreed, ' : ''}I left it out${agreed ? '' : '. The dish works without it'}.` });
    }
  }

  for (const add of ctx.additions) {
    if (ctx.leaveOut.some((l) => sameIngredient(l, add.name)) || isUnavailable(add.name, ctx)) continue;
    r = applyAddition(r, add, ctx);
    substitutions.push({ kind: 'add', from: add.name, to: '', reason: add.how });
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
    if (isUnavailable(i.name, ctx)) v.push(`${i.name} is marked unavailable.`);
    if (isEssential(i) && availability(i.name, ctx.pantry, ctx.basics) === 'missing') v.push(`You don’t have ${i.name.toLowerCase()}.`);
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
  let leaveOut = [...s.leaveOut];
  let preferredSwaps = [...s.preferredSwaps];
  let additions = [...s.additions];
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
        labels.push(`You have ${name.toLowerCase()}`);
        break;
      }
      case 'leave_out':
        if (!leaveOut.some((l) => sameIngredient(l, ch.name))) leaveOut.push(ch.name);
        additions = additions.filter((a) => !sameIngredient(a.name, ch.name));
        labels.push(`Cooking without ${ch.name.toLowerCase()}`);
        break;
      case 'swap_ingredient':
        preferredSwaps = [...preferredSwaps.filter((p) => !sameIngredient(p.from, ch.from)), { from: ch.from, to: ch.to }];
        leaveOut = leaveOut.filter((l) => !sameIngredient(l, ch.from));
        labels.push(`Using ${ch.to.toLowerCase()} instead of ${ch.from.toLowerCase()}`);
        break;
      case 'add_to_recipe': {
        const open = s.recipe.steps.filter((st) => !s.completedStepKeys.includes(st.key));
        const beforeKey = ch.when === 'end' ? open[open.length - 1]?.key : s.recipe.steps[s.stepIndex]?.key;
        additions = [...additions.filter((a) => !sameIngredient(a.name, ch.name)), { name: ch.name, amount: ch.amount, how: ch.how, beforeKey }];
        leaveOut = leaveOut.filter((l) => !sameIngredient(l, ch.name));
        labels.push(`Adding ${ch.name.toLowerCase()}`);
        break;
      }
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
  return { session: { ...s, rules, pantry, unavailable, leaveOut, preferredSwaps, additions, original, pendingOffer: undefined, pendingChoice: undefined }, labels };
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
    case 'swap_ingredient':
      return `${ch.to} instead of ${ch.from.toLowerCase()}`;
    case 'add_to_recipe':
      return `Add ${ch.name.toLowerCase()}`;
    case 'set_time':
      return `Only ${ch.minutes} minutes left`;
    case 'add_exclusion':
      return ch.rule ? `Make it ${DIET_RULES[ch.rule].label.toLowerCase()}` : `No ${ch.custom}`;
    case 'set_servings':
      return `Cooking for ${ch.servings}`;
    case 'remove_equipment':
      return `No ${EQUIPMENT[ch.equipment].label.toLowerCase()}`;
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
    rulesKept: describeRules(after.rules),
    stateChanges: labels,
    message: '',
    infeasible,
    offers: infeasible ? pauseOptions(result) : undefined,
  };
  diff.message = gusteauSays(diff, before, after, changes, result, next.steps[stepIndex]?.title);

  return {
    ...after,
    recipe: next,
    // An infeasible change still updates what Gusteau knows (facts like "out of rice" or a new rule), but
    // the plan pauses until the user decides. A swap or addition they asked for that didn't work is dropped.
    paused: infeasible,
    preferredSwaps: infeasible ? before.preferredSwaps : after.preferredSwaps,
    additions: infeasible ? before.additions : after.additions,
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
    case 'swap_ingredient':
      return 'Sure thing.';
    case 'add_to_recipe':
      return `Good idea, let’s add the ${ch.name.toLowerCase()}.`;
    case 'set_time':
      return `${ch.minutes} minutes it is.`;
    case 'add_exclusion':
      return ch.rule ? `${DIET_RULES[ch.rule].label}, absolutely.` : `Got it. No ${ch.custom}, ever.`;
    case 'set_servings':
      return `Cooking for ${ch.servings}? Love a full table.`;
    case 'remove_equipment':
      return `No ${EQUIPMENT[ch.equipment].label.toLowerCase()}. Let’s see.`;
  }
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** What Gusteau can offer when it has to pause. */
export function pauseOptions(result: Pick<AdaptResult, 'blockers'>): { leaveOut: string[] } {
  return { leaveOut: result.blockers.map((b) => b.name) };
}

function gusteauSays(d: PlanDiff, before: CookSession, s: CookSession, changes: SessionChange[], result: AdaptResult, resumeAt: string | undefined): string {
  if (d.infeasible) {
    const why = result.violations
      .slice(0, 2)
      .map((v) => lowerFirst(v.replace(/\.$/, '')))
      .join('; ');
    const opts = pauseOptions(result);
    const offers = [
      ...opts.leaveOut.slice(0, 1).map((n) => `cook without the ${n.toLowerCase()}`),
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
    if (sub.kind === 'add') parts.push(`New step: ${sub.reason.replace(/\.?$/, '.')}`);
  }
  if (d.stepsRemoved.length && !d.stepsAdded.length) parts.push(`That means no “${d.stepsRemoved[0]}” step.`);
  if (d.titleAfter !== d.titleBefore) parts.push(`It’s now a ${d.titleAfter}.`);
  if (d.minutesAfter !== d.minutesBefore) parts.push(`About ${d.minutesAfter} minutes to go.`);
  const changed = d.substitutions.length || d.stepsAdded.length || d.stepsRemoved.length;
  if (!changed && d.titleAfter === d.titleBefore && !removed) parts.push('Your plan already fits, so nothing needs to change.');
  const kept = d.rulesKept.filter((k) => !/serving|appliances/.test(k)).slice(0, 4).map((k) => k.toLowerCase());
  if (kept.length && changed) parts.push(`Still ${kept.join(', ')}.`);
  if (d.stepsKept && changed && resumeAt) parts.push(`Your finished steps still count. Pick up at “${resumeAt}”.`);
  parts.push(...result.notes);
  return parts.join(' ');
}

/** "1 cup", "to serve", "to taste". */
export const amountOf = (i: RecipeIngredient) => (i.amount === null && !i.unit && i.note ? i.note : formatAmount(i.amount, i.unit));
