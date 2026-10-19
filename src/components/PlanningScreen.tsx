import { useEffect, useState } from 'react';
import { describeConstraints } from '../agent/replan';
import type { SessionState } from '../types';
import { Card, GusteauAvatar, cx } from './ui';

export function PlanningScreen({ state }: { state: SessionState }) {
  const checks = [`${state.inventory.length} confirmed ingredients`, ...describeConstraints(state)];
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => Math.min(x + 1, checks.length)), 180);
    return () => clearInterval(t);
  }, [checks.length]);

  return (
    <div className="mx-auto max-w-md animate-rise text-center">
      <GusteauAvatar size="lg" />
      <h1 className="mt-4 font-display text-3xl font-semibold text-charcoal-900">Planning your meal…</h1>
      <p className="mt-1 text-charcoal-500">Checking every idea against your kitchen and your rules.</p>
      <Card className="mt-6 p-5 text-left">
        <ul className="space-y-2.5">
          {checks.map((c, i) => (
            <li key={c} className={cx('flex items-center gap-3 text-sm transition-all duration-300', i < n ? 'opacity-100' : 'opacity-30')}>
              <span
                className={cx(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[11px] text-white transition-colors',
                  i < n ? 'bg-olive-500' : 'bg-cream-300',
                )}
              >
                ✓
              </span>
              <span className="text-charcoal-700">{c}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
