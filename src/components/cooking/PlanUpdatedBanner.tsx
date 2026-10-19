import type { PlanDiff } from '../../types';
import { GusteauAvatar, cx } from '../ui';

export function PlanUpdatedBanner({
  diff,
  purchasesAllowed,
  onDismiss,
  onUndo,
  canUndo,
}: {
  diff: PlanDiff;
  purchasesAllowed: boolean;
  onDismiss: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  const titleChanged = diff.titleBefore !== diff.titleAfter;
  const nothingChanged =
    !diff.infeasible &&
    !titleChanged &&
    !diff.ingredientsAdded.length &&
    !diff.ingredientsRemoved.length &&
    !diff.quantityChanges.length &&
    !diff.stepsAdded.length &&
    !diff.stepsRemoved.length;
  const tone = diff.infeasible ? 'hold' : nothingChanged ? 'kept' : 'updated';

  return (
    <div
      key={diff.id}
      role="status"
      aria-live="polite"
      className={cx(
        'animate-pop overflow-hidden rounded-3xl border-2',
        tone === 'hold' && 'border-tomato-400 bg-tomato-50 shadow-lift',
        tone === 'updated' && 'border-saffron-400 bg-gradient-to-br from-saffron-100 via-white to-cream-50 shadow-lift',
        tone === 'kept' && 'border-olive-400 bg-gradient-to-br from-olive-50 via-white to-cream-50 shadow-card',
      )}
    >
      <div className="p-4 sm:p-5">
        {/* Header row */}
        <div className="flex flex-wrap items-center gap-2.5">
          <GusteauAvatar size="sm" />
          <span
            className={cx(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-white',
              tone === 'hold' && 'bg-tomato-600',
              tone === 'updated' && 'bg-saffron-500',
              tone === 'kept' && 'bg-olive-500',
            )}
          >
            {tone === 'hold' ? '⚠ Plan on hold' : tone === 'kept' ? '✓ Still a fit' : '✨ Plan updated'}
          </span>
          <span className="order-last basis-full text-sm font-semibold text-charcoal-700 sm:order-none sm:basis-auto">“{diff.trigger}”</span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {canUndo && (
              <button
                onClick={onUndo}
                className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs font-semibold text-charcoal-700 hover:border-charcoal-400"
              >
                Undo
              </button>
            )}
            <button onClick={onDismiss} aria-label="Dismiss" className="rounded-full p-1.5 text-charcoal-400 hover:bg-white hover:text-charcoal-900">
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        {!diff.infeasible && titleChanged && (
          <p className="mt-3 font-display text-lg leading-snug text-charcoal-900 sm:text-xl">
            <span className="text-charcoal-400 line-through decoration-tomato-400 decoration-2">{diff.titleBefore}</span>
            <span className="mx-2 text-saffron-500">→</span>
            <span className="font-semibold">{diff.titleAfter}</span>
          </p>
        )}
        <p className="mt-2 text-sm leading-relaxed text-charcoal-700">{diff.message}</p>

        {tone === 'updated' && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(diff.ingredientsRemoved.length > 0 || diff.ingredientsAdded.length > 0) && (
              <div className="rounded-2xl bg-white/80 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">Ingredients</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {diff.ingredientsRemoved.map((x) => (
                    <li key={x} className="text-charcoal-400 line-through">
                      − {x}
                    </li>
                  ))}
                  {diff.ingredientsAdded.map((x) => (
                    <li key={x} className="font-medium text-olive-700">
                      + {x}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(diff.stepsRemoved.length > 0 || diff.stepsAdded.length > 0) && (
              <div className="rounded-2xl bg-white/80 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">Steps</p>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {diff.stepsRemoved.map((x) => (
                    <li key={x} className="text-charcoal-400 line-through">
                      − {x}
                    </li>
                  ))}
                  {diff.stepsAdded.map((x) => (
                    <li key={x} className="font-medium text-olive-700">
                      + {x}
                    </li>
                  ))}
                  {diff.stepsKept > 0 && (
                    <li className="text-xs text-charcoal-500">
                      ✓ {diff.stepsKept} finished step{diff.stepsKept > 1 ? 's' : ''} kept
                    </li>
                  )}
                </ul>
              </div>
            )}
            {diff.quantityChanges.length > 0 && (
              <div className="rounded-2xl bg-white/80 p-3 sm:col-span-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-charcoal-400">Quantities</p>
                <ul className="mt-1.5 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {diff.quantityChanges.map((q) => (
                    <li key={q.name} className="text-charcoal-700">
                      {q.name}: <span className="text-charcoal-400 line-through">{q.before}</span> → <span className="font-semibold">{q.after}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Constraints carried through */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {diff.minutesBefore !== null && diff.minutesAfter !== null && diff.minutesBefore !== diff.minutesAfter && !diff.infeasible && (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-charcoal-700">
              ⏱ {diff.minutesBefore} → {diff.minutesAfter} min
            </span>
          )}
          {diff.constraintsKept.map((k) => (
            <span key={k} className="rounded-full bg-olive-50 px-2.5 py-1 text-xs font-semibold text-olive-700">
              ✓ {k}
            </span>
          ))}
          {!diff.infeasible && !purchasesAllowed && (
            <span className="rounded-full bg-charcoal-900 px-2.5 py-1 text-xs font-semibold text-white">🛒 0 new purchases</span>
          )}
          {!diff.infeasible && purchasesAllowed && diff.newPurchases.length > 0 && (
            <span className="rounded-full bg-saffron-100 px-2.5 py-1 text-xs font-semibold text-charcoal-900">🛒 New to buy: {diff.newPurchases.join(', ')}</span>
          )}
        </div>
      </div>
    </div>
  );
}
