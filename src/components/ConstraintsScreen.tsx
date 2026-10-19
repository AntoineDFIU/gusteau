import { useState, type ReactNode } from 'react';
import { DIET_RULES, EQUIPMENT, PREFERENCES } from '../data/ingredients';
import type { Constraints, DietRuleId, Equipment, PreferenceId } from '../types';
import { Button, Card, Chip, Eyebrow, Toggle } from './ui';

const TIMES = [10, 15, 20, 30, 45, 60];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="p-5 sm:p-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-semibold text-charcoal-900">{title}</h2>
        {hint && <span className="text-xs text-charcoal-400">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function TagInput({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim().replace(/,$/, '');
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-cream-300 bg-cream-50 p-2">
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-sm font-medium text-charcoal-700 shadow-sm">
          {v}
          <button onClick={() => onChange(values.filter((x) => x !== v))} className="text-charcoal-400 hover:text-tomato-600" aria-label={`Remove ${v}`}>
            ✕
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={placeholder}
        className="min-w-[10rem] flex-1 bg-transparent px-2 py-1 text-sm outline-none placeholder:text-charcoal-400"
      />
    </div>
  );
}

export function ConstraintsScreen({
  initial,
  onSubmit,
  onBack,
}: {
  initial: Constraints;
  onSubmit: (c: Constraints) => void;
  onBack: () => void;
}) {
  const [c, setC] = useState<Constraints>(initial);
  const set = <K extends keyof Constraints>(k: K, v: Constraints[K]) => setC((x) => ({ ...x, [k]: v }));
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <div className="mx-auto max-w-3xl animate-rise">
      <Eyebrow>Step 3 · Your kitchen rules</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-semibold text-charcoal-900 sm:text-4xl">How are we cooking tonight?</h1>
      <p className="mt-2 text-charcoal-500">Hard rules are never broken. Preferences just steer the choice.</p>

      <Card className="mt-6 divide-y divide-cream-200">
        <Section title="Dietary rules & allergies" hint="Hard rules">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(DIET_RULES) as DietRuleId[]).map((r) => (
              <Chip key={r} active={c.hardExclusions.includes(r)} onClick={() => set('hardExclusions', toggle(c.hardExclusions, r))}>
                {DIET_RULES[r].label}
              </Chip>
            ))}
          </div>
          <div className="mt-3">
            <TagInput values={c.customExclusions} onChange={(v) => set('customExclusions', v)} placeholder="Other allergies or hard no’s, e.g. peanuts" />
          </div>
        </Section>

        <Section title="What sounds good?" hint="Soft preferences">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(PREFERENCES) as PreferenceId[]).map((p) => (
              <Chip key={p} tone="olive" active={c.preferences.includes(p)} onClick={() => set('preferences', toggle(c.preferences, p))}>
                <span>{PREFERENCES[p].emoji}</span>
                {PREFERENCES[p].label}
              </Chip>
            ))}
          </div>
          <div className="mt-3">
            <TagInput values={c.dislikes} onChange={(v) => set('dislikes', v)} placeholder="Rather avoid… e.g. onion" />
          </div>
        </Section>

        <div className="grid divide-y divide-cream-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          <Section title="Time available">
            <div className="flex flex-wrap gap-2">
              {TIMES.map((t) => (
                <Chip key={t} active={c.timeMinutes === t} onClick={() => set('timeMinutes', t)}>
                  {t} min
                </Chip>
              ))}
            </div>
          </Section>
          <Section title="Servings">
            <div className="flex items-center gap-4">
              <button
                onClick={() => set('servings', Math.max(1, c.servings - 1))}
                className="h-11 w-11 rounded-full border border-cream-300 text-xl text-charcoal-700 hover:border-tomato-400"
                aria-label="Fewer servings"
              >
                −
              </button>
              <span className="w-16 text-center font-display text-3xl font-semibold text-charcoal-900">{c.servings}</span>
              <button
                onClick={() => set('servings', Math.min(12, c.servings + 1))}
                className="h-11 w-11 rounded-full border border-cream-300 text-xl text-charcoal-700 hover:border-tomato-400"
                aria-label="More servings"
              >
                +
              </button>
              <span className="text-sm text-charcoal-400">{c.servings === 1 ? 'just me' : 'people'}</span>
            </div>
          </Section>
        </div>

        <Section title="Equipment you can use">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(EQUIPMENT) as Equipment[]).map((e) => (
              <Chip
                key={e}
                tone="olive"
                active={c.equipment.includes(e)}
                onClick={() => {
                  const next = toggle(c.equipment, e);
                  if (next.length) set('equipment', next);
                }}
              >
                <span>{EQUIPMENT[e].emoji}</span>
                {EQUIPMENT[e].label}
              </Chip>
            ))}
          </div>
          <label className="mt-4 flex items-center justify-between gap-4 rounded-2xl bg-cream-100 px-4 py-3">
            <span className="text-sm text-charcoal-700">
              <span className="font-semibold">Pantry basics on hand</span>
              <span className="block text-xs text-charcoal-400">Salt, pepper, cooking oil, water</span>
            </span>
            <Toggle checked={c.pantryBasics} onChange={(v) => set('pantryBasics', v)} label="Pantry basics" />
          </label>
        </Section>

        <Section title="Spending">
          <div className="flex items-center justify-between gap-4 rounded-2xl bg-cream-100 px-4 py-3">
            <span className="text-sm text-charcoal-700">
              <span className="font-semibold">Are extra purchases allowed?</span>
              <span className="block text-xs text-charcoal-400">
                {c.purchasesAllowed ? 'Gusteau may suggest a few cheap extras, always listed clearly.' : 'Gusteau will only use what you already have.'}
              </span>
            </span>
            <Toggle checked={c.purchasesAllowed} onChange={(v) => set('purchasesAllowed', v)} label="Allow purchases" />
          </div>
          {c.purchasesAllowed && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-sm font-medium text-charcoal-700">Spending limit</span>
              <div className="flex items-center rounded-full border border-cream-300 bg-white px-3">
                <span className="text-charcoal-400">$</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={c.budget}
                  onChange={(e) => set('budget', Math.max(0, Number(e.target.value)))}
                  className="w-20 bg-transparent px-1 py-2 outline-none"
                />
              </div>
            </div>
          )}
        </Section>
      </Card>

      <div className="sticky bottom-3 z-10 mt-6 flex items-center justify-between gap-3 rounded-full border border-cream-200 bg-white/95 p-2 pl-5 shadow-card backdrop-blur">
        <button onClick={onBack} className="text-sm font-medium text-charcoal-500 hover:text-charcoal-900">
          ← Ingredients
        </button>
        <Button onClick={() => onSubmit(c)}>Find my meal →</Button>
      </div>
    </div>
  );
}
