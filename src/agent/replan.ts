import { CATALOG, DIET_RULES, EQUIPMENT, PREFERENCES, matchIngredient } from '../data/ingredients';
import type { PlanDiff, Recipe, SessionChange, SessionState, Substitution } from '../types';
import { isExcluded, shortName, type PlanResult } from './planner';

// ─────────────────────────────────────────────────────────────
// The replanning loop:
//   1. applyChanges   → mutate the structured session state
//   2. (service).planRecipe → re-plan the WHOLE remaining meal
//   3. finalizeReplan → diff, keep completed steps, track
//                       substitutions, write Gusteau's summary
// ─────────────────────────────────────────────────────────────

export const uid = () => Math.random().toString(36).slice(2, 10);

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function applyChanges(state: SessionState, changes: SessionChange[]): { state: SessionState; labels: string[] } {
  let s: SessionState = { ...state, constraints: { ...state.constraints }, inventory: [...state.inventory], removed: [...state.removed] };
  const labels: string[] = [];

  for (const ch of changes) {
    const c = s.constraints;
    switch (ch.type) {
      case 'remove_ingredient': {
        const key = matchIngredient(ch.name);
        const lower = ch.name.toLowerCase();
        const hit = s.inventory.find((i) => (key && i.key === key) || i.name.toLowerCase() === lower);
        const name = hit?.name ?? (key ? CATALOG[key].name : titleCase(ch.name));
        s.inventory = s.inventory.filter((i) => i !== hit);
        if (!s.removed.some((r) => (key && r.key === key) || r.name === name)) {
          s.removed.push({ name, key: key ?? hit?.key ?? null, reason: 'You said you’re out' });
        }
        labels.push(`Marked ${name.toLowerCase()} as unavailable`);
        break;
      }
      case 'add_ingredient': {
        const key = matchIngredient(ch.name);
        const name = key ? CATALOG[key].name : titleCase(ch.name.trim());
        if (!s.inventory.some((i) => (key && i.key === key) || i.name.toLowerCase() === name.toLowerCase())) {
          s.inventory.push({ id: uid(), name, key, quantityNote: ch.note ?? '', source: 'chat' });
        }
        s.removed = s.removed.filter((r) => !(key && r.key === key) && r.name.toLowerCase() !== name.toLowerCase());
        labels.push(`Added ${name.toLowerCase()} to your kitchen`);
        break;
      }
      case 'set_time':
        c.timeMinutes = Math.max(3, Math.round(ch.minutes));
        labels.push(`Time limit set to ${c.timeMinutes} minutes`);
        break;
      case 'set_servings':
        labels.push(`Servings ${c.servings} → ${Math.max(1, ch.servings)}`);
        c.servings = Math.max(1, Math.min(12, Math.round(ch.servings)));
        break;
      case 'set_equipment':
        c.equipment = ch.equipment.length ? [...ch.equipment] : c.equipment;
        labels.push(`Equipment: ${c.equipment.map((e) => EQUIPMENT[e].label).join(', ')} only`);
        break;
      case 'set_purchases':
        c.purchasesAllowed = ch.allowed;
        labels.push(ch.allowed ? 'Extra purchases allowed' : 'No extra purchases');
        break;
      case 'set_budget':
        c.budget = Math.max(0, ch.amount);
        labels.push(`Spending limit $${c.budget}`);
        break;
      case 'add_exclusion':
        if (ch.rule && !c.hardExclusions.includes(ch.rule)) {
          c.hardExclusions = [...c.hardExclusions, ch.rule];
          if (ch.rule === 'vegan' && !c.hardExclusions.includes('vegetarian')) c.hardExclusions.push('vegetarian');
          labels.push(`Hard rule added: ${DIET_RULES[ch.rule].label}`);
        }
        if (ch.custom && !c.customExclusions.some((x) => x.toLowerCase() === ch.custom!.toLowerCase())) {
          c.customExclusions = [...c.customExclusions, ch.custom];
          labels.push(`Hard rule added: no ${ch.custom}`);
        }
        break;
      case 'add_preference':
        if (!c.preferences.includes(ch.preference)) c.preferences = [...c.preferences, ch.preference];
        labels.push(`Preference: ${PREFERENCES[ch.preference].label.toLowerCase()}`);
        break;
    }
  }
  s = { ...s };
  return { state: s, labels };
}

/** Short human label for a set of changes, e.g. "You're out of rice". */
export function describeChanges(changes: SessionChange[]): string {
  const ch = changes[0];
  if (!ch) return 'Plan adjusted';
  switch (ch.type) {
    case 'remove_ingredient':
      return `You're out of ${shortName(matchIngredient(ch.name) ?? ch.name.toLowerCase())}`;
    case 'add_ingredient':
      return `You found ${ch.name.toLowerCase()}`;
    case 'set_time':
      return `Only ${ch.minutes} minutes`;
    case 'add_exclusion':
      return ch.rule ? `Make it ${DIET_RULES[ch.rule].label.toLowerCase()}` : `No ${ch.custom}`;
    case 'set_servings':
      return `Cooking for ${ch.servings}`;
    case 'set_equipment':
      return ch.equipment.length === 1 ? `${EQUIPMENT[ch.equipment[0]].label} only` : 'Equipment changed';
    case 'set_purchases':
      return ch.allowed ? 'Purchases allowed' : 'No extra purchases';
    case 'set_budget':
      return `Budget $${ch.amount}`;
    case 'add_preference':
      return PREFERENCES[ch.preference].label;
  }
}

/** Human-readable list of the hard constraints that were carried through. */
export function describeConstraints(s: SessionState): string[] {
  const c = s.constraints;
  const out = [
    ...c.hardExclusions.map((r) => DIET_RULES[r].label),
    ...c.customExclusions.map((x) => `No ${x}`),
    `${c.timeMinutes}-minute limit`,
    c.equipment.length === 1 ? `${EQUIPMENT[c.equipment[0]].label} only` : c.equipment.map((e) => EQUIPMENT[e].label).join(' + '),
    `${c.servings} ${c.servings === 1 ? 'serving' : 'servings'}`,
    c.purchasesAllowed ? `Spend up to $${c.budget}` : 'No extra purchases',
  ];
  return out;
}

function mergeSubstitutions(existing: Substitution[], prev: Recipe | null, next: Recipe | null, reason: string, after: SessionState): Substitution[] {
  if (!prev || !next) return existing;
  const nextKeys = new Set(next.ingredients.map((i) => i.key));
  const prevKeys = new Set(prev.ingredients.map((i) => i.key));
  let subs = [...existing];
  // Model-written recipes have no shared slots, so also pair an ingredient that was
  // FORCED out (now unavailable or forbidden) with what the new plan brought in.
  const forced = prev.ingredients.filter(
    (p) => !nextKeys.has(p.key) && (after.removed.some((r) => r.key === p.key || r.name === p.name) || !!isExcluded(CATALOG[p.key] ? p.key : p.name, after.constraints)),
  );
  const added = next.ingredients.filter((n) => !prevKeys.has(n.key));
  for (const p of prev.ingredients) {
    const sameRole = next.ingredients.find((i) => i.role === p.role);
    const n = sameRole && sameRole.key !== p.key ? sameRole : forced.includes(p) ? added[forced.indexOf(p)] ?? added[0] : undefined;
    if (!n || n.key === p.key || nextKeys.has(p.key)) continue;
    // Chain A→B then B→C into A→C.
    const chained = subs.find((s) => s.to === shortName(p.key));
    if (chained) {
      subs = subs.map((s) => (s === chained ? { ...s, to: shortName(n.key), reason } : s));
    } else {
      subs.push({ role: p.role, from: shortName(p.key), to: shortName(n.key), reason });
    }
  }
  // Drop substitutions that have been undone.
  return subs.filter(
    (s) => !next.ingredients.some((i) => shortName(i.key) === s.from) && next.ingredients.some((i) => shortName(i.key) === s.to) && s.from !== s.to,
  );
}

export function finalizeReplan(
  before: SessionState,
  after: SessionState,
  plan: PlanResult,
  trigger: string,
  labels: string[],
  changes: SessionChange[],
): SessionState {
  const prev = before.recipe;
  const next = plan.recipe;
  const prevKeys = new Set(prev?.ingredients.map((i) => i.key) ?? []);
  const nextKeys = new Set(next?.ingredients.map((i) => i.key) ?? []);
  const prevSteps = new Set(prev?.steps.map((s) => s.key) ?? []);
  const nextSteps = new Set(next?.steps.map((s) => s.key) ?? []);

  const completed = before.completedStepKeys.filter((k) => nextSteps.has(k));
  const firstOpen = next ? next.steps.findIndex((s) => !completed.includes(s.key)) : 0;
  const currentStepIndex = next && firstOpen === -1 ? next.steps.length : Math.max(0, firstOpen);
  const stepsDone = next && firstOpen === -1;

  const diff: PlanDiff = {
    id: uid(),
    trigger,
    titleBefore: prev?.title ?? null,
    titleAfter: next?.title ?? null,
    minutesBefore: prev?.totalMinutes ?? null,
    minutesAfter: next?.totalMinutes ?? null,
    ingredientsAdded: next?.ingredients.filter((i) => !prevKeys.has(i.key)).map((i) => `${i.emoji} ${i.name}, ${i.display}`) ?? [],
    ingredientsRemoved: prev?.ingredients.filter((i) => !nextKeys.has(i.key)).map((i) => `${i.emoji} ${i.name}`) ?? [],
    quantityChanges:
      next?.ingredients
        .filter((i) => prevKeys.has(i.key))
        .map((i) => ({ name: i.name, before: prev!.ingredients.find((p) => p.key === i.key)!.display, after: i.display }))
        .filter((q) => q.before !== q.after) ?? [],
    stepsAdded: next?.steps.filter((s) => !prevSteps.has(s.key)).map((s) => s.title) ?? [],
    stepsRemoved: prev?.steps.filter((s) => !nextSteps.has(s.key)).map((s) => s.title) ?? [],
    stepsKept: completed.length,
    newPurchases: next?.ingredients.filter((i) => i.toBuy && !prev?.ingredients.some((p) => p.key === i.key && p.toBuy)).map((i) => i.name) ?? [],
    constraintsKept: describeConstraints(after),
    stateChanges: labels,
    message: '',
    infeasible: !next,
  };
  const substitutions = mergeSubstitutions(before.substitutions, prev, next, trigger, after);
  diff.message = gusteauSays(diff, after, changes, next, completed.length > 0 && !stepsDone ? next!.steps[currentStepIndex]?.title : null, plan);

  return {
    ...after,
    recipe: next ?? before.recipe,
    blocked: plan.blocked,
    completedStepKeys: next ? completed : before.completedStepKeys,
    currentStepIndex: next ? currentStepIndex : before.currentStepIndex,
    substitutions: next ? substitutions : before.substitutions,
    history: [diff, ...before.history],
    chat: [...after.chat, { id: uid(), from: 'gusteau', text: diff.message, diffId: diff.id }],
  };
}

// ── Gusteau's voice: warm, concise, practical ───────────────────
function opener(changes: SessionChange[]): string {
  const ch = changes[0];
  if (!ch) return 'Got it.';
  switch (ch.type) {
    case 'remove_ingredient':
      return `No ${shortName(matchIngredient(ch.name) ?? ch.name.toLowerCase())}? No problem.`;
    case 'add_ingredient':
      return `Ooh, ${ch.name.toLowerCase()}. Let me put that to work.`;
    case 'set_time':
      return `${ch.minutes} minutes it is. Let's move.`;
    case 'add_exclusion':
      return ch.rule ? `${DIET_RULES[ch.rule].label}, absolutely.` : `Got it. No ${ch.custom}, ever.`;
    case 'set_servings':
      return `Cooking for ${ch.servings}? Love a full table.`;
    case 'set_equipment':
      return ch.equipment.length === 1 ? `${EQUIPMENT[ch.equipment[0]].label}-only works.` : 'Equipment noted.';
    case 'set_purchases':
      return ch.allowed ? 'Shopping allowed. Noted.' : 'No shopping. We cook with what you have.';
    case 'set_budget':
      return `Budget set to $${ch.amount}.`;
    case 'add_preference':
      return `${PREFERENCES[ch.preference].label}, coming up.`;
  }
}

function gusteauSays(
  d: PlanDiff,
  s: SessionState,
  changes: SessionChange[],
  next: Recipe | null,
  resumeAt: string | null,
  plan: PlanResult,
): string {
  if (!next) {
    // Lead with why the CURRENT dish fails, then the next-closest option.
    const currentId = s.recipe?.templateId;
    const sorted = [...plan.blocked].sort((a, b) => Number(b.templateId === currentId) - Number(a.templateId === currentId));
    const seen = new Set<string>();
    const reasons = sorted
      .filter((b) => (seen.has(b.reason) ? false : (seen.add(b.reason), true)))
      .slice(0, 2)
      .map((b) => `${b.title}: ${b.reason.charAt(0).toLowerCase()}${b.reason.slice(1)}`);
    return `That's a tough one. I can't build a safe plan with that change. ${reasons.join('; ')}. I won't bend a hard rule, so try loosening the time, equipment or purchase setting, or undo that change.`;
  }
  const first = changes[0];
  const removedName = first?.type === 'remove_ingredient' ? first.name : null;
  const removedKey = removedName ? matchIngredient(removedName) ?? removedName.toLowerCase() : null;
  const notUsed =
    !!removedName && !!s.recipe && !s.recipe.ingredients.some((i) => i.key === removedKey || i.name.toLowerCase() === removedName.toLowerCase());
  const parts: string[] = [notUsed ? `Good news: this dish doesn't use ${shortName(removedKey!)}.` : opener(changes)];
  if (d.titleBefore && d.titleAfter !== d.titleBefore) {
    const prevBlock = s.recipe && plan.blocked.find((b) => b.templateId === s.recipe!.templateId);
    if (prevBlock && s.recipe!.templateId !== next.templateId) {
      parts.push(`The old plan no longer fits: it ${prevBlock.reason.charAt(0).toLowerCase()}${prevBlock.reason.slice(1)}.`);
    }
    parts.push(`New plan: ${next.title}.`);
  } else if (d.titleBefore) {
    const bits: string[] = [];
    if (d.quantityChanges.length) bits.push(`rescaled ${d.quantityChanges.length} ingredient${d.quantityChanges.length > 1 ? 's' : ''}`);
    if (d.ingredientsRemoved.length) bits.push(`dropped ${d.ingredientsRemoved.map((x) => x.replace(/^\S+\s/, '').toLowerCase()).join(', ')}`);
    if (d.ingredientsAdded.length) bits.push(`brought in ${d.ingredientsAdded.map((x) => x.replace(/^\S+\s/, '').split(',')[0].toLowerCase()).join(', ')}`);
    if (!bits.length && (d.stepsAdded.length || d.stepsRemoved.length)) bits.push('reworked the remaining steps');
    parts.push(bits.length ? `Same dish, adjusted: I ${bits.join(' and ')}.` : 'Your current plan already fits, so nothing needs to change.');
  } else {
    parts.push(`I'd make the ${next.title}.`);
  }
  if (d.minutesBefore !== null && d.minutesAfter !== d.minutesBefore) parts.push(`Now about ${d.minutesAfter} minutes.`);
  const kept = d.constraintsKept.filter((k) => !/servings|purchases|Spend/.test(k)).slice(0, 4).map((k) => k.toLowerCase());
  if (kept.length) parts.push(`Still ${kept.join(', ')}.`);
  if (resumeAt && (d.stepsAdded.length || d.stepsRemoved.length)) parts.push(`Your finished steps still count. Pick up at “${resumeAt}”.`);
  if (!s.constraints.purchasesAllowed) parts.push('Nothing new to buy.');
  else if (d.newPurchases.length) parts.push(`Heads up: this adds ${d.newPurchases.join(', ')} to your shopping list.`);
  return parts.join(' ');
}
