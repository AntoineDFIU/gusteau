import type { ReactNode } from 'react';
import { DIET_RULES, EQUIPMENT, PREFERENCES, emojiFor } from '../../data/ingredients';
import type { SessionState } from '../../types';
import { Card, cx } from '../ui';

function Row({ label, children, flashKey }: { label: string; children: ReactNode; flashKey?: string }) {
  return (
    <div key={flashKey} className={cx('rounded-2xl px-1 py-3', flashKey && 'animate-flash')}>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal-400">{label}</p>
      {children}
    </div>
  );
}

export function KitchenPlanPanel({ state }: { state: SessionState }) {
  const c = state.constraints;
  const r = state.recipe;
  const last = state.history[0];
  const fk = last?.id;
  const used = new Set(r?.ingredients.map((i) => i.key));
  const newSteps = new Set(last?.stepsAdded ?? []);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-cream-200 bg-gradient-to-r from-olive-50 to-cream-50 px-5 py-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal-900">Gusteau’s Kitchen Plan</h2>
          <p className="text-xs text-charcoal-500">Everything I’m keeping track of for you</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-olive-700 shadow-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-olive-500" /> Live
        </span>
      </div>

      <div className="divide-y divide-cream-200 px-4">
        {r && (
          <Row label="Now cooking" flashKey={last?.titleBefore !== last?.titleAfter ? fk : undefined}>
            <p className="font-semibold text-charcoal-900">
              {r.emoji} {r.title}
            </p>
            <p className="text-sm text-charcoal-500">
              {last?.infeasible
                ? '⚠ On hold: no safe plan for the latest change'
                : state.currentStepIndex >= r.steps.length
                  ? 'All steps done 🎉'
                  : `Step ${state.currentStepIndex + 1} of ${r.steps.length}`}{' '}
              · ~{r.totalMinutes} min total
            </p>
          </Row>
        )}

        <Row label="Hard rules · never broken" flashKey={last?.stateChanges.some((s) => /Hard rule/.test(s)) ? fk : undefined}>
          <div className="flex flex-wrap gap-1.5">
            {c.hardExclusions.length + c.customExclusions.length === 0 && <span className="text-sm text-charcoal-400">No dietary restrictions</span>}
            {c.hardExclusions.map((h) => (
              <span key={h} className="rounded-full bg-tomato-50 px-2.5 py-1 text-xs font-semibold text-tomato-700">
                🛡 {DIET_RULES[h].label}
              </span>
            ))}
            {c.customExclusions.map((x) => (
              <span key={x} className="rounded-full bg-tomato-50 px-2.5 py-1 text-xs font-semibold text-tomato-700">
                🛡 No {x}
              </span>
            ))}
          </div>
        </Row>

        <Row label="Kitchen limits" flashKey={last?.stateChanges.some((s) => /Time|Servings|Equipment|purchases|Spending/.test(s)) ? fk : undefined}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-cream-100 px-3 py-2">
              <dt className="text-[11px] text-charcoal-400">Time</dt>
              <dd className={cx('font-semibold', r && r.totalMinutes > c.timeMinutes ? 'text-tomato-600' : 'text-charcoal-900')}>
                {r ? `${r.totalMinutes} of ${c.timeMinutes} min` : `${c.timeMinutes} min`}
              </dd>
            </div>
            <div className="rounded-xl bg-cream-100 px-3 py-2">
              <dt className="text-[11px] text-charcoal-400">Servings</dt>
              <dd className="font-semibold text-charcoal-900">{c.servings}</dd>
            </div>
            <div className="rounded-xl bg-cream-100 px-3 py-2">
              <dt className="text-[11px] text-charcoal-400">Equipment</dt>
              <dd className="font-semibold text-charcoal-900">{c.equipment.map((e) => `${EQUIPMENT[e].emoji} ${EQUIPMENT[e].label}`).join(', ')}</dd>
            </div>
            <div className="rounded-xl bg-cream-100 px-3 py-2">
              <dt className="text-[11px] text-charcoal-400">Shopping</dt>
              <dd className="font-semibold text-charcoal-900">{c.purchasesAllowed ? `Up to $${c.budget}` : '🚫 No purchases'}</dd>
            </div>
          </dl>
        </Row>

        <Row label={`Confirmed ingredients · ${state.inventory.length}`}>
          <div className="flex flex-wrap gap-1.5">
            {state.inventory.map((i) => (
              <span
                key={i.id}
                className={cx(
                  'rounded-full px-2.5 py-1 text-xs font-medium',
                  i.key && used.has(i.key) ? 'bg-olive-100 text-olive-700' : 'bg-cream-100 text-charcoal-500',
                )}
                title={i.key && used.has(i.key) ? 'Used in this recipe' : 'Available, not needed for this dish'}
              >
                {emojiFor(i.key)} {i.name}
                {i.quantityNote && <span className="text-charcoal-400"> · {i.quantityNote}</span>}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-charcoal-400">Green = in this dish. Pantry basics {c.pantryBasics ? 'assumed' : 'not assumed'}.</p>
        </Row>

        {state.removed.length > 0 && (
          <Row label="Unavailable" flashKey={last?.stateChanges.some((s) => /unavailable/.test(s)) ? fk : undefined}>
            <div className="flex flex-wrap gap-1.5">
              {state.removed.map((rm) => (
                <span key={rm.name} className="rounded-full bg-cream-200 px-2.5 py-1 text-xs font-medium text-charcoal-400 line-through" title={rm.reason}>
                  {emojiFor(rm.key)} {rm.name}
                </span>
              ))}
            </div>
          </Row>
        )}

        {state.substitutions.length > 0 && (
          <Row label="Active substitutions" flashKey={fk}>
            <ul className="space-y-1.5">
              {state.substitutions.map((s) => (
                <li key={s.role + s.from} className="flex flex-wrap items-center gap-1.5 text-sm">
                  <span className="text-charcoal-400 line-through">{s.from}</span>
                  <span className="text-saffron-500">⟶</span>
                  <span className="font-semibold text-charcoal-900">{s.to}</span>
                  <span className="text-xs text-charcoal-400">· {s.reason}</span>
                </li>
              ))}
            </ul>
          </Row>
        )}

        {(c.preferences.length > 0 || c.dislikes.length > 0) && (
          <Row label="Soft preferences">
            <p className="text-sm text-charcoal-700">
              {[...c.preferences.map((p) => `${PREFERENCES[p].emoji} ${PREFERENCES[p].label}`), ...c.dislikes.map((d) => `avoid ${d}`)].join(' · ')}
            </p>
          </Row>
        )}

        {r && (
          <Row label="Timeline" flashKey={newSteps.size ? fk : undefined}>
            <ol className="space-y-1.5">
              {r.steps.map((s, i) => {
                const done = state.completedStepKeys.includes(s.key);
                const current = i === state.currentStepIndex;
                return (
                  <li key={s.key} className={cx('flex items-center gap-2.5 rounded-xl px-2 py-1.5 text-sm', current && 'bg-tomato-50')}>
                    <span
                      className={cx(
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                        done ? 'bg-olive-500 text-white' : current ? 'bg-tomato-500 text-white' : 'bg-cream-200 text-charcoal-400',
                      )}
                    >
                      {done ? '✓' : i + 1}
                    </span>
                    <span className={cx('flex-1', done ? 'text-charcoal-400' : current ? 'font-semibold text-charcoal-900' : 'text-charcoal-700')}>{s.title}</span>
                    {newSteps.has(s.title) && <span className="rounded-full bg-saffron-100 px-2 py-0.5 text-[10px] font-bold uppercase text-saffron-500">new</span>}
                  </li>
                );
              })}
            </ol>
          </Row>
        )}

        {state.history.length > 0 && (
          <Row label={`Plan changes · ${state.history.length}`}>
            <ul className="space-y-1 text-xs text-charcoal-500">
              {state.history.slice(0, 5).map((h) => (
                <li key={h.id}>
                  <span className="font-semibold text-charcoal-700">{h.trigger}</span>
                  {h.infeasible ? ' · no safe plan' : h.titleBefore !== h.titleAfter ? ` · now ${h.titleAfter}` : ' · same dish, adjusted'}
                </li>
              ))}
            </ul>
          </Row>
        )}
      </div>
    </Card>
  );
}
