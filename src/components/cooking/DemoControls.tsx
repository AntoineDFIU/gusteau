import { useState } from 'react';
import { shortName } from '../../agent/planner';
import type { SessionChange, SessionState } from '../../types';
import { Card, cx } from '../ui';

interface Props {
  state: SessionState;
  busy: boolean;
  onUpdate: (changes: SessionChange[], trigger: string, userText: string) => void;
}

export function DemoControls({ state, busy, onUpdate }: Props) {
  const [picking, setPicking] = useState(false);
  const c = state.constraints;
  const owned = state.recipe?.ingredients.filter((i) => !i.toBuy) ?? [];

  const buttons: { emoji: string; label: string; active: boolean; run: () => void }[] = [
    {
      emoji: '🫙',
      label: 'I’m out of an ingredient',
      active: picking,
      run: () => setPicking((p) => !p),
    },
    {
      emoji: '⏱',
      label: 'I only have 15 minutes',
      active: c.timeMinutes <= 15,
      run: () => onUpdate([{ type: 'set_time', minutes: 15 }], 'Only 15 minutes', 'I only have 15 minutes.'),
    },
    {
      emoji: '🥦',
      label: 'Make it vegetarian',
      active: c.hardExclusions.includes('vegetarian'),
      run: () => onUpdate([{ type: 'add_exclusion', rule: 'vegetarian' }], 'Make it vegetarian', 'Can you make it vegetarian?'),
    },
    {
      emoji: '👥',
      label: 'I’m cooking for more people',
      active: false,
      run: () =>
        onUpdate([{ type: 'set_servings', servings: c.servings + 2 }], `Cooking for ${c.servings + 2}`, `Two more people are joining. We’re now ${c.servings + 2}.`),
    },
    {
      emoji: '📟',
      label: 'I only have a microwave',
      active: c.equipment.length === 1 && c.equipment[0] === 'microwave',
      run: () => onUpdate([{ type: 'set_equipment', equipment: ['microwave'] }], 'Microwave only', 'I only have a microwave.'),
    },
    {
      emoji: '🚫',
      label: 'No extra purchases',
      active: !c.purchasesAllowed,
      run: () => onUpdate([{ type: 'set_purchases', allowed: false }], 'No extra purchases', 'No extra purchases, please.'),
    },
  ];

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-lg font-semibold text-charcoal-900">Throw Gusteau a curveball</p>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-olive-500">Live replanning</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {buttons.map((b) => (
          <button
            key={b.label}
            disabled={busy}
            onClick={b.run}
            className={cx(
              'flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm font-semibold transition-all disabled:opacity-50',
              b.active ? 'border-olive-400 bg-olive-50 text-olive-700' : 'border-cream-300 bg-white text-charcoal-700 hover:-translate-y-0.5 hover:border-tomato-400 hover:shadow-card',
            )}
          >
            <span className="text-xl">{b.emoji}</span>
            <span className="leading-tight">{b.label}</span>
          </button>
        ))}
      </div>
      {picking && (
        <div className="mt-3 animate-pop rounded-2xl bg-cream-100 p-3">
          <p className="mb-2 text-xs font-semibold text-charcoal-500">Which one ran out?</p>
          <div className="flex flex-wrap gap-2">
            {owned.map((i) => (
              <button
                key={i.key}
                disabled={busy}
                onClick={() => {
                  setPicking(false);
                  const n = shortName(i.key);
                  onUpdate([{ type: 'remove_ingredient', name: i.name }], `You're out of ${n}`, `Actually, I don’t have ${n}.`);
                }}
                className="rounded-full border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-700 hover:border-tomato-400 hover:text-tomato-600"
              >
                {i.emoji} {i.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
