import { useState } from 'react';
import { nutritionFor } from '../data/nutrition';
import type { Recipe } from '../types';
import { SectionTitle, cx } from './ui';

// Validated with the dataviz palette checker against the cream surface
// (#FFFCF7): protein uses Gusteau's tomato, carbs and fat the reference
// yellow and blue. Yellow is under 3:1 on cream, so every segment is also
// labeled in text below the bar.
const MACROS = [
  { key: 'protein', label: 'Protein', color: '#C63F20', kcalPerGram: 4 },
  { key: 'carbs', label: 'Carbs', color: '#EDA100', kcalPerGram: 4 },
  { key: 'fat', label: 'Fat', color: '#2A78D6', kcalPerGram: 9 },
] as const;

const SOURCE_LABEL = {
  database: 'From the recipe',
  'database-adjusted': 'From the recipe, adjusted for Gusteau’s changes',
  estimate: 'Estimated by Gusteau from the ingredients',
};

/** Nutrition per serving for what will actually be cooked. */
export function NutritionPanel({ planned, original }: { planned: Recipe; original: Recipe }) {
  const view = nutritionFor(planned, original);
  const n = view.perServing;
  const [hover, setHover] = useState<number | null>(null);
  const estimate = view.source !== 'database';
  const kcal = (v: number) => (estimate ? Math.round(v / 10) * 10 : Math.round(v));
  const grams = (v: number) => `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)} g`;

  const parts = MACROS.map((m) => ({ ...m, grams: n[m.key], kcal: n[m.key] * m.kcalPerGram }));
  const macroKcal = parts.reduce((s, p) => s + p.kcal, 0);
  const pct = (v: number) => Math.round((v / macroKcal) * 100);
  const extras = [
    n.fiber !== undefined && `Fiber ${grams(n.fiber)}`,
    n.sugar !== undefined && `Sugar ${grams(n.sugar)}`,
    n.sodium !== undefined && `Sodium ${Math.round(n.sodium / 10) * 10} mg`,
  ].filter(Boolean);
  const notCounted = [...view.missing, ...view.unmeasured.map((u) => `${u.toLowerCase()} (no amount given)`)];

  return (
    <section className="mt-6 rounded-3xl border border-cream-200 bg-white p-4" aria-labelledby="nutrition-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <SectionTitle>
          <span id="nutrition-title">Nutrition · per serving</span>
        </SectionTitle>
        <span className="text-[11px] text-charcoal-400">{SOURCE_LABEL[view.source]}</span>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-2xl bg-cream-100 px-3 py-2.5">
          <dt className="text-xs text-charcoal-500">Calories</dt>
          <dd className="mt-0.5 text-xl font-semibold text-charcoal-900">
            {estimate && <span className="text-sm font-medium text-charcoal-400">~</span>}
            {kcal(n.calories).toLocaleString()}
            <span className="ml-1 text-xs font-medium text-charcoal-500">kcal</span>
          </dd>
        </div>
        {parts.map((p) => (
          <div key={p.key} className="rounded-2xl bg-cream-100 px-3 py-2.5">
            <dt className="flex items-center gap-1.5 text-xs text-charcoal-500">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
              {p.label}
            </dt>
            <dd className="mt-0.5 text-xl font-semibold text-charcoal-900">{grams(p.grams)}</dd>
          </div>
        ))}
      </dl>

      {macroKcal > 0 && (
        <div className="mt-4">
          <p className="text-xs text-charcoal-500">Calories from</p>
          <div className="relative mt-1.5" onMouseLeave={() => setHover(null)}>
            <div className="flex gap-[2px]" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.kcal)}%`).join(', ')}>
              {parts.map((p, i) =>
                p.kcal > 0 ? (
                  <button
                    key={p.key}
                    type="button"
                    className="flex h-6 items-center focus:outline-none"
                    style={{ flexGrow: p.kcal, flexBasis: 0 }}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    aria-label={`${p.label}: ${grams(p.grams)}, about ${Math.round(p.kcal)} kcal, ${pct(p.kcal)}% of calories`}
                  >
                    <span
                      className={cx('block h-2.5 w-full transition-opacity', i === 0 && 'rounded-l', i === parts.length - 1 && 'rounded-r', hover !== null && hover !== i && 'opacity-40')}
                      style={{ background: p.color }}
                    />
                  </button>
                ) : null,
              )}
            </div>
            {hover !== null && (
              <div
                role="tooltip"
                className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl bg-charcoal-900 px-3 py-2 text-xs text-white shadow-card"
                style={{ left: `${(parts.slice(0, hover).reduce((s, p) => s + p.kcal, 0) + parts[hover].kcal / 2) / macroKcal * 100}%` }}
              >
                <span className="font-semibold">{parts[hover].label}</span> · {grams(parts[hover].grams)} · ~{Math.round(parts[hover].kcal)} kcal · {pct(parts[hover].kcal)}%
              </div>
            )}
          </div>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal-700">
            {parts.map((p) => (
              <li key={p.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} aria-hidden />
                {p.label} <span className="font-semibold">{pct(p.kcal)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {extras.length > 0 && <p className="mt-3 text-xs text-charcoal-700">{extras.join(' · ')}</p>}
      {notCounted.length > 0 && <p className="mt-2 text-xs text-charcoal-500">Not counted: {notCounted.join(', ')}.</p>}
      <p className="mt-2 text-[11px] text-charcoal-400">
        {estimate ? 'Approximate, excluding salt added to taste. ' : ''}For general information only, not medical or dietary advice.
      </p>
    </section>
  );
}
