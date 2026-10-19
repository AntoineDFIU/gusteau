import { useState } from 'react';
import { quantityWarnings, validateRecipe } from '../agent/planner';
import { describeConstraints } from '../agent/replan';
import { EQUIPMENT } from '../data/ingredients';
import type { SessionState } from '../types';
import { Button, Card, Eyebrow, GusteauAvatar } from './ui';

export function RecipeHero({ state, compact = false }: { state: SessionState; compact?: boolean }) {
  const r = state.recipe!;
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-tomato-500 via-tomato-400 to-saffron-400 p-6 text-white sm:p-8">
      <div className="pointer-events-none absolute -right-6 -top-8 select-none text-[9rem] opacity-25 sm:text-[11rem]" aria-hidden>
        {r.emoji}
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/80">Gusteau recommends</p>
      <h1 className={compact ? 'mt-2 max-w-xl font-display text-2xl font-semibold leading-tight sm:text-3xl' : 'mt-2 max-w-xl font-display text-3xl font-semibold leading-tight sm:text-5xl'}>
        {r.title}
      </h1>
      {!compact && <p className="mt-3 max-w-lg text-white/90">{r.subtitle}</p>}
      <div className="mt-5 flex flex-wrap gap-2 text-sm font-medium">
        {[
          `⏱ ${r.totalMinutes} min`,
          `👩‍🍳 ${r.difficulty}`,
          `🍽 ${r.servings} serving${r.servings === 1 ? '' : 's'}`,
          `${EQUIPMENT[r.equipment]?.emoji ?? '🔥'} ${EQUIPMENT[r.equipment]?.label ?? r.equipment}`,
          r.estimatedCost > 0 ? `🛒 ~$${r.estimatedCost.toFixed(2)} to buy` : '🛒 $0 extra',
        ].map((t) => (
          <span key={t} className="rounded-full bg-white/20 px-3 py-1 backdrop-blur">
            {t}
          </span>
        ))}
      </div>
      {r.source === 'model' && (
        <p className="mt-3 text-xs text-white/80">Written by {r.sourceLabel ?? 'the model'} · verified by Gusteau’s constraint check</p>
      )}
      {r.note && <p className="mt-3 text-xs text-white/80">{r.note}</p>}
    </div>
  );
}

export function RecipeScreen({
  state,
  onCook,
  onEdit,
  onEditIngredients,
}: {
  state: SessionState;
  onCook: () => void;
  onEdit: () => void;
  onEditIngredients: () => void;
}) {
  const [showBlocked, setShowBlocked] = useState(false);
  const r = state.recipe;

  if (!r) {
    return (
      <div className="mx-auto max-w-2xl animate-rise">
        <Card className="p-8 text-center">
          <span className="text-5xl">🤔</span>
          <h1 className="mt-4 font-display text-3xl font-semibold text-charcoal-900">I can’t find a safe, feasible meal yet</h1>
          <p className="mt-2 text-charcoal-500">I won’t break a hard rule to force a recipe. Here’s what’s in the way:</p>
          <ul className="mx-auto mt-5 max-w-md space-y-2 text-left text-sm">
            {[...new Map(state.blocked.map((b) => [b.reason, b])).values()].slice(0, 5).map((b) => (
              <li key={b.templateId} className="rounded-xl bg-cream-100 px-4 py-2">
                <span className="font-semibold capitalize text-charcoal-700">{b.title}</span>
                <span className="text-charcoal-500"> · {b.reason}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button onClick={onEdit}>Adjust my rules</Button>
            <Button variant="secondary" onClick={onEditIngredients}>
              Add ingredients
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const violations = validateRecipe(r, state);
  const warnings = quantityWarnings(r, state.inventory);
  const owned = r.ingredients.filter((i) => !i.toBuy);
  const buy = r.ingredients.filter((i) => i.toBuy);

  return (
    <div className="mx-auto max-w-5xl animate-rise">
      <Eyebrow className="mb-3">Step 4 · One meal that fits</Eyebrow>
      <RecipeHero state={state} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Card className="p-5 sm:p-6">
          <h2 className="font-display text-xl font-semibold text-charcoal-900">From your kitchen</h2>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {owned.map((i) => (
              <li key={i.key} className="flex items-center gap-3 rounded-2xl bg-cream-100 px-3 py-2.5">
                <span className="text-2xl">{i.emoji}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-charcoal-900">{i.name}</span>
                  <span className="block text-xs text-charcoal-500">{i.display}</span>
                </span>
              </li>
            ))}
          </ul>
          {state.constraints.pantryBasics && <p className="mt-3 text-xs text-charcoal-400">Plus pantry basics: salt, pepper, oil, water.</p>}

          {buy.length > 0 && (
            <div className="mt-5 rounded-2xl border border-saffron-100 bg-saffron-100/40 p-4">
              <p className="text-sm font-semibold text-charcoal-900">🛒 You’d need to pick up</p>
              <ul className="mt-2 space-y-1 text-sm text-charcoal-700">
                {buy.map((i) => (
                  <li key={i.key} className="flex justify-between">
                    <span>
                      {i.emoji} {i.name} · {i.display}
                    </span>
                    <span className="text-charcoal-500">~${i.price.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-charcoal-500">Estimated prices. Within your ${state.constraints.budget} limit.</p>
            </div>
          )}

          {warnings.length > 0 && (
            <div className="mt-4 space-y-1 rounded-2xl bg-tomato-50 p-3 text-xs text-tomato-700">
              {warnings.map((w) => (
                <p key={w}>⚖️ {w}</p>
              ))}
            </div>
          )}

          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-charcoal-400">The plan · {r.steps.length} steps</h3>
          <ol className="mt-3 space-y-2">
            {r.steps.map((s, i) => (
              <li key={s.key} className="flex gap-3 text-sm text-charcoal-700">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-olive-50 text-xs font-semibold text-olive-700">{i + 1}</span>
                {s.title}
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-6">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <GusteauAvatar />
              <h2 className="font-display text-xl font-semibold text-charcoal-900">Why this fits you</h2>
            </div>
            <ul className="mt-4 space-y-2.5">
              {r.whyItFits.map((w) => (
                <li key={w} className="flex gap-2.5 text-sm text-charcoal-700">
                  <span className="mt-0.5 text-olive-500">●</span>
                  {w}
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-5 sm:p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-charcoal-400">Constraint check</h2>
            {violations.length === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {describeConstraints(state).map((c) => (
                  <span key={c} className="rounded-full bg-olive-50 px-3 py-1 text-xs font-semibold text-olive-700">
                    ✓ {c}
                  </span>
                ))}
              </div>
            ) : (
              <ul className="mt-3 space-y-1 text-sm text-tomato-700">
                {violations.map((v) => (
                  <li key={v}>✕ {v}</li>
                ))}
              </ul>
            )}
            {state.blocked.length > 0 && (
              <button onClick={() => setShowBlocked((x) => !x)} className="mt-4 text-xs font-medium text-charcoal-400 underline-offset-4 hover:underline">
                {showBlocked ? 'Hide' : 'See'} the {state.blocked.length} dish{state.blocked.length === 1 ? '' : 'es'} I ruled out
              </button>
            )}
            {showBlocked && (
              <ul className="mt-2 space-y-1 text-xs text-charcoal-500">
                {state.blocked.map((b) => (
                  <li key={b.templateId}>
                    <span className="font-medium capitalize">{b.title}</span> · {b.reason}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="flex-1" onClick={onCook} disabled={violations.length > 0}>
              👨‍🍳 Cook with Gusteau
            </Button>
            <Button size="lg" variant="secondary" onClick={onEdit}>
              Adjust
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
