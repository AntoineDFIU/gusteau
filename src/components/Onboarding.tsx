import { useState } from 'react';
import { CUISINES } from '../data/cuisines';
import { DIET_RULES, DIET_RULE_IDS, EQUIPMENT, EQUIPMENT_IDS } from '../data/rules';
import type { DietRuleId, Equipment, Profile } from '../types';
import { Button, Card, Chip, Eyebrow, cx } from './ui';

export function Onboarding({ profile, onDone, editing = false }: { profile: Profile; onDone: (patch: Partial<Profile>) => void; editing?: boolean }) {
  const [step, setStep] = useState<0 | 1>(0);
  const [cuisines, setCuisines] = useState<string[]>(profile.favoriteCuisines);
  const [diet, setDiet] = useState<DietRuleId[]>(profile.hardExclusions);
  const [allergies, setAllergies] = useState(profile.allergies.join(', '));
  const [equipment, setEquipment] = useState<Equipment[]>(profile.equipment);
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const finish = () =>
    onDone({
      onboarded: true,
      favoriteCuisines: cuisines,
      hardExclusions: diet,
      allergies: allergies
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean),
      equipment: equipment.length ? equipment : profile.equipment,
    });

  return (
    <div className="mx-auto max-w-4xl animate-rise">
      <Eyebrow>{editing ? 'Your preferences' : 'Welcome to Gusteau'}</Eyebrow>
      {step === 0 ? (
        <>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-tight text-charcoal-900 sm:text-5xl">
            What do you love to <span className="italic text-tomato-500">eat?</span>
          </h1>
          <p className="mt-3 max-w-xl text-lg text-charcoal-500">Pick your favorite cuisines. They’ll be the first thing you see, and you can change them any time.</p>
          <div className="mt-8 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
            {CUISINES.map((c) => {
              const on = cuisines.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => setCuisines((l) => toggle(l, c.id))}
                  aria-pressed={on}
                  className={cx(
                    'flex items-center gap-2.5 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-all',
                    on ? 'border-tomato-500 bg-tomato-50 text-tomato-700 shadow-sm' : 'border-cream-300 bg-white text-charcoal-700 hover:border-charcoal-400',
                  )}
                >
                  <span className="text-2xl">{c.emoji}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {on && <span aria-hidden>✓</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button size="lg" onClick={() => setStep(1)}>
              {cuisines.length ? `Next: your diet →` : 'Skip for now →'}
            </Button>
            <span className="text-sm text-charcoal-400">{cuisines.length ? `${cuisines.length} selected` : 'You can browse every cuisine either way.'}</span>
          </div>
        </>
      ) : (
        <>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-tight text-charcoal-900 sm:text-5xl">Anything Gusteau should never cook?</h1>
          <p className="mt-3 max-w-xl text-lg text-charcoal-500">These are hard rules. Gusteau won’t suggest or replan anything that breaks them.</p>
          <Card className="mt-8 space-y-6 p-5 sm:p-6">
            <div>
              <p className="mb-3 text-sm font-semibold text-charcoal-900">Diet</p>
              <div className="flex flex-wrap gap-2">
                {DIET_RULE_IDS.map((r) => (
                  <Chip key={r} active={diet.includes(r)} onClick={() => setDiet((l) => toggle(l, r))}>
                    {DIET_RULES[r].label}
                  </Chip>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="allergies" className="mb-2 block text-sm font-semibold text-charcoal-900">
                Allergies or ingredients to avoid
              </label>
              <input
                id="allergies"
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="e.g. peanuts, sesame, cilantro"
                className="w-full rounded-2xl border border-cream-300 bg-white px-4 py-3 text-sm outline-none focus:border-tomato-400"
              />
              <p className="mt-2 text-xs text-charcoal-400">Gusteau checks ingredient names, not labels. Always read the packaging for allergens.</p>
            </div>
            <div>
              <p className="mb-3 text-sm font-semibold text-charcoal-900">Your kitchen has</p>
              <div className="flex flex-wrap gap-2">
                {EQUIPMENT_IDS.map((e) => (
                  <Chip key={e} tone="olive" active={equipment.includes(e)} onClick={() => setEquipment((l) => toggle(l, e))}>
                    {EQUIPMENT[e].emoji} {EQUIPMENT[e].label}
                  </Chip>
                ))}
              </div>
            </div>
          </Card>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button variant="secondary" size="lg" onClick={() => setStep(0)}>
              ← Back
            </Button>
            <Button size="lg" onClick={finish}>
              {editing ? 'Save preferences' : 'Show me what to cook →'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
