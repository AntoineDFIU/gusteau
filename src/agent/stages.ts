import { STAGE_ICONS, isStageIcon } from '../data/stageIcons';
import type { RecipeStage, RecipeStep, StageIconId } from '../types';

// ─────────────────────────────────────────────────────────────
// Cooking stages: each recipe is grouped into roughly 3–5 short,
// ordered stages, each with an icon from the supported list.
// The database or the model may propose a grouping; the app
// always validates it here and falls back to its own.
// ─────────────────────────────────────────────────────────────

const ICON_WORDS: [StageIconId, RegExp][] = [
  ['microwave', /\bmicrowave/],
  ['blend', /\b(blend|blender|food processor|pur[eé]e)\b/],
  ['knead', /\b(knead|dough|roll out)\b/],
  ['marinate', /\bmarinat/],
  ['grill', /\b(grill|barbecue|char)\b/],
  ['bake', /\b(bake|baking|oven)\b/],
  ['roast', /\broast/],
  ['steam', /\bsteam/],
  ['fry', /\b(deep[- ]fry|shallow[- ]fry|fry in batches|fritters?)\b/],
  ['sear', /\b(sear|brown the|until browned)\b/],
  ['saute', /\b(saut[eé]|stir-?fry|wok|soften|fry|skillet|pan)\b/],
  ['simmer', /\b(simmer|braise|stew|reduce|poach)\b/],
  ['boil', /\b(boil|blanch)\b/],
  ['rest', /\b(rest|chill|stand|cool)\b/],
  ['assemble', /\b(assemble|fill|roll|layer|build|stuff|wrap|spoon .* (into|onto|over))\b/],
  ['plate', /\b(serve|plate|garnish|top with|finish with)\b/],
  ['mix', /\b(mix|whisk|combine|stir together|toss|beat)\b/],
  ['chop', /\b(chop|dice|slice|mince|cut|grate|peel|julienne)\b/],
];

export function iconFromText(text: string): StageIconId {
  const t = text.toLowerCase();
  return ICON_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'prep';
}

type Phase = 'prep' | 'cook' | 'finish';
const PREP: StageIconId[] = ['prep', 'chop', 'mix', 'marinate'];
const FINISH: StageIconId[] = ['assemble', 'plate', 'rest'];
const phaseOf = (step: RecipeStep): Phase => {
  const icon = iconFromText(`${step.title} ${step.text}`);
  return PREP.includes(icon) ? 'prep' : FINISH.includes(icon) ? 'finish' : 'cook';
};

function titleFor(steps: RecipeStep[], phase: Phase): string {
  if (steps.length === 1) return steps[0].title;
  if (phase === 'prep') return 'Prep the ingredients';
  if (phase === 'finish') return 'Finish and serve';
  return steps[0].title;
}

/** Gusteau's own grouping: consecutive steps of the same kind, nudged into 3–5 stages. */
export function groupStages(steps: RecipeStep[]): RecipeStage[] {
  if (!steps.length) return [];
  let groups: { phase: Phase; steps: RecipeStep[] }[] = [];
  for (const s of steps) {
    const p = phaseOf(s);
    const last = groups[groups.length - 1];
    if (last && last.phase === p) last.steps.push(s);
    else groups.push({ phase: p, steps: [s] });
  }
  const target = Math.min(3, steps.length);
  while (groups.length < target) {
    const i = groups.reduce((best, g, j) => (g.steps.length > groups[best].steps.length ? j : best), 0);
    const g = groups[i];
    const half = Math.ceil(g.steps.length / 2);
    groups.splice(i, 1, { phase: g.phase, steps: g.steps.slice(0, half) }, { phase: g.phase, steps: g.steps.slice(half) });
  }
  while (groups.length > 5) {
    // Merge the adjacent pair with the fewest steps, preferring same-phase pairs.
    let best = 0;
    let bestCost = Infinity;
    for (let j = 0; j < groups.length - 1; j++) {
      const cost = groups[j].steps.length + groups[j + 1].steps.length + (groups[j].phase === groups[j + 1].phase ? 0 : 3);
      if (cost < bestCost) {
        bestCost = cost;
        best = j;
      }
    }
    const a = groups[best];
    const b = groups[best + 1];
    groups.splice(best, 2, { phase: a.phase === 'cook' || b.phase === 'cook' ? 'cook' : a.phase, steps: [...a.steps, ...b.steps] });
  }
  groups = groups.filter((g) => g.steps.length);
  return groups.map((g, i) => ({
    key: `stage-${i + 1}`,
    title: titleFor(g.steps, g.phase),
    icon: iconFromText(g.steps.map((s) => `${s.title} ${s.text}`).join(' ')),
    stepKeys: g.steps.map((s) => s.key),
  }));
}

export interface StageCheck {
  ok: boolean;
  problems: string[];
  /** The proposal with fixable issues (unknown icons, long titles) repaired. */
  stages: RecipeStage[];
}

/**
 * Independent check on any stage grouping, whoever wrote it. `strict` enforces
 * the 3–5 stage shape for new groupings; a replan that dropped a step may
 * leave fewer stages, which is fine as long as the structure is consistent.
 */
export function validateStages(steps: RecipeStep[], proposed: unknown, strict = true): StageCheck {
  const problems: string[] = [];
  if (!Array.isArray(proposed) || !proposed.length) return { ok: false, problems: ['No stages given'], stages: [] };
  const known = new Set(steps.map((s) => s.key));
  const stages: RecipeStage[] = [];
  for (const [i, raw] of (proposed as Record<string, unknown>[]).entries()) {
    const stepKeys = Array.isArray(raw?.stepKeys) ? (raw.stepKeys as unknown[]).map(String) : [];
    if (!stepKeys.length) problems.push(`Stage ${i + 1} has no steps`);
    for (const k of stepKeys) if (!known.has(k)) problems.push(`Stage ${i + 1} names an unknown step "${k}"`);
    const text = steps
      .filter((s) => stepKeys.includes(s.key))
      .map((s) => `${s.title} ${s.text}`)
      .join(' ');
    const title = typeof raw?.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 40) : `Stage ${i + 1}`;
    stages.push({ key: `stage-${i + 1}`, title, icon: isStageIcon(raw?.icon) ? raw.icon : iconFromText(text), stepKeys });
  }
  const flat = stages.flatMap((s) => s.stepKeys);
  if (flat.length !== steps.length || flat.some((k, i) => k !== steps[i].key)) problems.push('Stages must cover every step exactly once, in order');
  const min = strict ? Math.min(3, steps.length) : 1;
  const max = strict ? 5 : 6;
  if (stages.length < min || stages.length > max) problems.push(`Needs ${min}–${max} stages, got ${stages.length}`);
  return { ok: problems.length === 0, problems, stages };
}

/** Which stage a step belongs to. */
export function stageIndexOf(stages: RecipeStage[], stepKey: string): number {
  return Math.max(
    0,
    stages.findIndex((s) => s.stepKeys.includes(stepKey)),
  );
}

export const stageGlyph = (icon: StageIconId) => STAGE_ICONS[icon].glyph;
