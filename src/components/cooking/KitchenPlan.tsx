import { amountOf } from '../../agent/adapt';
import { describeRules } from '../../agent/kitchen';
import { emojiFor } from '../../data/ingredients';
import type { CookSession } from '../../types';
import { Card, SectionTitle } from '../ui';

/** Everything Gusteau is keeping track of, shown live. */
export function KitchenPlan({ session: s }: { session: CookSession }) {
  return (
    <Card className="p-5">
      <h2 className="font-display text-lg font-semibold text-charcoal-900">Gusteau’s kitchen plan</h2>
      <p className="text-xs text-charcoal-400">What I’m keeping track of. Every replan keeps all of it.</p>

      <SectionTitle className="mt-4">Hard rules</SectionTitle>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {describeRules(s.rules).map((r) => (
          <span key={r} className="rounded-full bg-charcoal-900 px-2.5 py-1 text-[11px] font-semibold text-white">
            🛡 {r}
          </span>
        ))}
      </div>

      {s.substitutions.length > 0 && (
        <>
          <SectionTitle className="mt-4">Changes to the recipe</SectionTitle>
          <ul className="mt-2 space-y-1 text-sm text-charcoal-700">
            {s.substitutions.map((x) => (
              <li key={`${x.kind}-${x.from}`} className="flex gap-2">
                <span aria-hidden>{x.kind === 'swap' ? '🔁' : x.kind === 'drop' ? '➖' : '🛒'}</span>
                <span>
                  {x.kind === 'swap' ? `${x.from} → ${x.to}` : x.kind === 'drop' ? `No ${x.from.toLowerCase()}` : `Buy ${x.from.toLowerCase()}`}
                  <span className="block text-xs text-charcoal-400">{x.reason.split('. ')[0]}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-charcoal-400">Adapted by Gusteau from {s.original.chef ? `${s.original.chef.name}’s` : 'the original'} {s.original.title}.</p>
        </>
      )}

      <SectionTitle className="mt-4">Ingredients for this plan</SectionTitle>
      <ul className="mt-2 space-y-1 text-sm">
        {s.recipe.ingredients.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-charcoal-700">
            <span aria-hidden>{emojiFor(i.name)}</span>
            <span className="min-w-0 flex-1 truncate">{i.name}</span>
            <span className="shrink-0 text-xs text-charcoal-500">{amountOf(i)}</span>
          </li>
        ))}
      </ul>

      {s.unavailable.length > 0 && (
        <>
          <SectionTitle className="mt-4">Unavailable</SectionTitle>
          <p className="mt-1 text-sm text-charcoal-500">{s.unavailable.join(', ')}</p>
        </>
      )}

      {s.history.length > 0 && (
        <>
          <SectionTitle className="mt-4">Changes this session</SectionTitle>
          <ol className="mt-2 space-y-1 text-xs text-charcoal-500">
            {[...s.history].reverse().map((h, i) => (
              <li key={h.id}>
                {i + 1}. {h.trigger}
                {h.infeasible ? ' · paused' : ''}
              </li>
            ))}
          </ol>
        </>
      )}
    </Card>
  );
}
