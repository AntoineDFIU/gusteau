import type { PlanDiff } from '../../types';
import { Button, GusteauAvatar } from '../ui';

export function PlanUpdatedBanner({ diff, onDismiss, onUndo, canUndo }: { diff: PlanDiff; onDismiss: () => void; onUndo: () => void; canUndo: boolean }) {
  const rows: [string, string][] = [
    ...diff.substitutions.map((s): [string, string] =>
      s.kind === 'swap' ? ['🔁', `${s.from} → ${s.to}${s.unsure ? ' (if you have it)' : ''}`] : s.kind === 'drop' ? ['➖', `Left out ${s.from.toLowerCase()}`] : ['🛒', `Buy ${s.from.toLowerCase()}`],
    ),
    ...diff.stepsAdded.map((t): [string, string] => ['✨', `New step: ${t}`]),
    ...diff.stepsRemoved.map((t): [string, string] => ['✕', `Removed: ${t}`]),
  ];
  if (diff.minutesBefore !== diff.minutesAfter) rows.push(['⏱', `${diff.minutesBefore} → ${diff.minutesAfter} min to go`]);
  if (diff.stepsKept) rows.push(['✓', `${diff.stepsKept} finished step${diff.stepsKept === 1 ? '' : 's'} kept`]);

  if (diff.infeasible) return null;
  return (
    <div className="animate-pop overflow-hidden rounded-3xl border border-saffron-400/60 bg-gradient-to-br from-saffron-100 via-white to-white shadow-card">
      <div className="flex items-start gap-3 p-4 sm:p-5">
        <GusteauAvatar />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wider text-saffron-500">✨ Plan updated · {diff.trigger}</p>
          {diff.titleAfter !== diff.titleBefore && (
            <p className="mt-1 font-display text-lg font-semibold text-charcoal-900">
              <span className="text-charcoal-400 line-through decoration-1">{diff.titleBefore}</span> → {diff.titleAfter}
            </p>
          )}
          {rows.length > 0 && (
            <ul className="mt-2 grid gap-1 text-sm text-charcoal-700 sm:grid-cols-2">
              {rows.map(([icon, text]) => (
                <li key={text} className="flex gap-2">
                  <span aria-hidden>{icon}</span>
                  {text}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {diff.rulesKept.map((r) => (
              <span key={r} className="rounded-full bg-olive-50 px-2.5 py-0.5 text-[11px] font-semibold text-olive-700">
                ✓ {r}
              </span>
            ))}
            {diff.newPurchases.length === 0 && <span className="rounded-full bg-olive-50 px-2.5 py-0.5 text-[11px] font-semibold text-olive-700">✓ 0 new purchases</span>}
          </div>
        </div>
      </div>
      <div className="flex gap-2 border-t border-saffron-100 bg-white/60 px-4 py-2.5 sm:px-5">
        {canUndo && (
          <Button size="sm" variant="secondary" onClick={onUndo}>
            ↶ Undo
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Got it
        </Button>
      </div>
    </div>
  );
}
