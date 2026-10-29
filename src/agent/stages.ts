import { STAGE_ICONS, isStageIcon } from '../data/stageIcons';
import type { Recipe, RecipeStage, RecipeStep, StageIconId } from '../types';

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

/**
 * Gusteau's own stages: one per step, so a step never holds sub-steps. Only the model may combine
 * steps, and only ones that continue the same action on the same food (stageRecipe).
 */
export function groupStages(steps: RecipeStep[]): RecipeStage[] {
  return steps.map((s, i) => ({ key: `stage-${i + 1}`, title: s.title.replace(/[.:]$/, ''), icon: iconFromText(`${s.title} ${s.text}`), stepKeys: [s.key] }));
}

export interface StageCheck {
  ok: boolean;
  problems: string[];
  /** The proposal with fixable issues (unknown icons, long titles) repaired. */
  stages: RecipeStage[];
}

/**
 * Independent check on any stage grouping, whoever wrote it: every step once, in order,
 * in consecutive groups (each group becomes one step for the cook, see mergeStages).
 */
export function validateStages(steps: RecipeStep[], proposed: unknown): StageCheck {
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
  // Each stage becomes one step for the cook, so anything from everything-in-one to one per step is a valid shape.
  const min = 1;
  const max = Math.max(1, steps.length);
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

const sentence = (t: string) => (/[.!?]$/.test(t.trim()) ? t.trim() : `${t.trim()}.`);
/** "Cook Meat" → "Cook meat": a stage name reads as a step title. */
const titleCase = (t: string) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

/**
 * One step per stage. When several steps share a stage ("Smash and sear" and "Flip and melt" in
 * "Cook meat"), they become one step, so there's a single list of steps, with no sub-steps, for the
 * screen, Gusteau and the cook to agree on. Their timed parts stay (agent/stepTimers.ts reads them
 * from the text), and the stage keeps its icon.
 */
export function mergeStages(r: Recipe): Recipe {
  if (r.stages.every((st) => st.stepKeys.length === 1)) return r;
  const byKey = new Map(r.steps.map((s) => [s.key, s]));
  const steps: RecipeStep[] = [];
  const stages: RecipeStage[] = [];
  for (const st of r.stages) {
    const parts = st.stepKeys.map((k) => byKey.get(k)).filter((s): s is RecipeStep => !!s);
    if (!parts.length) continue;
    if (parts.length === 1) {
      steps.push(parts[0]);
      stages.push(st);
      continue;
    }
    const timed = parts.filter((p) => p.timerSeconds);
    const step: RecipeStep = {
      key: parts.map((p) => p.key).join('+'),
      title: titleCase(st.title),
      text: parts.map((p) => sentence(p.text)).join(' '),
      uses: [...new Set(parts.flatMap((p) => p.uses))],
      minutes: parts.reduce((m, p) => m + (p.minutes ?? 0), 0) || undefined,
      timerSeconds: timed.length === 1 ? timed[0].timerSeconds : undefined,
      technique: parts.find((p) => p.technique)?.technique,
      tip: parts.map((p) => p.tip).filter(Boolean).join(' ') || undefined,
    };
    steps.push(step);
    stages.push({ ...st, stepKeys: [step.key] });
  }
  return { ...r, steps, stages };
}
