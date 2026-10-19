import { useState } from 'react';
import { CATALOG, emojiFor, matchIngredient } from '../data/ingredients';
import { uid } from '../agent/replan';
import type { InventoryItem, RemovedItem } from '../types';
import { Button, Card, Eyebrow, cx } from './ui';

const QUICK_ADD = ['rice', 'eggs', 'cheese', 'tortillas', 'beans', 'salsa', 'onion', 'garlic', 'tomatoes', 'spinach', 'chicken', 'lemon', 'avocado', 'pepper', 'pasta'];

export function ReviewScreen({
  initial,
  fromPhoto,
  notice,
  onConfirm,
  onBack,
}: {
  initial: InventoryItem[];
  fromPhoto: boolean;
  notice?: string | null;
  onConfirm: (items: InventoryItem[], removed: RemovedItem[]) => void;
  onBack: () => void;
}) {
  const [items, setItems] = useState<InventoryItem[]>(initial);
  const [removed, setRemoved] = useState<InventoryItem[]>([]);
  const [draft, setDraft] = useState('');

  const add = (text: string) => {
    const t = text.trim();
    if (!t) return;
    const key = matchIngredient(t);
    const name = key ? CATALOG[key].name : t.charAt(0).toUpperCase() + t.slice(1);
    if (items.some((i) => (key && i.key === key) || i.name.toLowerCase() === name.toLowerCase())) return;
    setItems((xs) => [...xs, { id: uid(), name, key, quantityNote: '', source: 'manual' }]);
    setRemoved((r) => r.filter((x) => !(key && x.key === key)));
    setDraft('');
  };

  const remove = (it: InventoryItem) => {
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    setRemoved((r) => [it, ...r]);
  };

  const restore = (it: InventoryItem) => {
    setRemoved((r) => r.filter((x) => x.id !== it.id));
    setItems((xs) => [...xs, it]);
  };

  const suggestions = QUICK_ADD.filter((k) => !items.some((i) => i.key === k));

  return (
    <div className="mx-auto max-w-3xl animate-rise">
      <Eyebrow>Step 2 · Confirm your inventory</Eyebrow>
      <h1 className="mt-2 font-display text-3xl font-semibold text-charcoal-900 sm:text-4xl">
        {fromPhoto ? 'Here’s what Gusteau found' : 'What do you have on hand?'}
      </h1>
      <p className="mt-2 text-charcoal-500">
        {fromPhoto
          ? 'Remove anything that’s wrong, add what I missed, and jot down amounts if you know them.'
          : 'Add the ingredients you have. Amounts are optional but help me scale.'}
      </p>

      {notice && (
        <div className="mt-5 flex gap-3 rounded-2xl border border-tomato-100 bg-tomato-50 p-4 text-sm text-tomato-700">
          <span className="text-lg">📷</span>
          <p>{notice}</p>
        </div>
      )}

      <div className="mt-5 flex gap-3 rounded-2xl border border-saffron-100 bg-saffron-100/50 p-4 text-sm text-charcoal-700">
        <span className="text-lg">⚠️</span>
        <p>
          <span className="font-semibold">Quick check:</span> image recognition can miss or misidentify items, quantities, labels, allergens or
          freshness. Please confirm your inventory, and always check packaging for allergy safety.
        </p>
      </div>

      <Card className="mt-6 divide-y divide-cream-200">
        {items.length === 0 && <p className="p-6 text-center text-charcoal-400">No ingredients yet. Add some below.</p>}
        {items.map((it) => {
          const low = it.source === 'photo' && (it.confidence ?? 1) < 0.75;
          return (
            <div key={it.id} className="flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap sm:p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cream-100 text-2xl">{emojiFor(it.key)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-charcoal-900">{it.name}</p>
                <p className="text-xs text-charcoal-400">
                  {it.source === 'photo' ? (
                    <span className={cx(low && 'font-semibold text-saffron-500')}>
                      {low ? 'Not sure. Please double-check' : `Spotted in photo · ${Math.round((it.confidence ?? 1) * 100)}% sure`}
                    </span>
                  ) : (
                    'Added by you'
                  )}
                  {!it.key && ' · Gusteau will keep it in mind'}
                </p>
              </div>
              <input
                value={it.quantityNote}
                onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, quantityNote: e.target.value } : x)))}
                placeholder="Amount (optional)"
                className="order-last w-full rounded-xl border border-cream-300 bg-cream-50 px-3 py-2 text-sm outline-none placeholder:text-charcoal-400 focus:border-olive-400 sm:order-none sm:w-40"
              />
              <button
                onClick={() => remove(it)}
                aria-label={`Remove ${it.name}`}
                className="rounded-full p-2 text-charcoal-400 transition hover:bg-tomato-50 hover:text-tomato-600"
              >
                ✕
              </button>
            </div>
          );
        })}
      </Card>

      <Card className="mt-4 p-4 sm:p-5">
        <p className="text-sm font-semibold text-charcoal-700">Did I miss something?</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. avocado, frozen peas, black beans"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-cream-50 px-4 py-2.5 text-sm outline-none focus:border-olive-400"
          />
          <Button type="submit" variant="olive">
            Add
          </Button>
        </form>
        {suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {suggestions.slice(0, 10).map((k) => (
              <button
                key={k}
                onClick={() => add(CATALOG[k].name)}
                className="rounded-full border border-dashed border-cream-300 px-3 py-1.5 text-sm text-charcoal-500 hover:border-olive-400 hover:text-olive-700"
              >
                + {CATALOG[k].emoji} {CATALOG[k].name}
              </button>
            ))}
          </div>
        )}
        {removed.length > 0 && (
          <div className="mt-4 border-t border-cream-200 pt-3 text-sm text-charcoal-400">
            Removed:{' '}
            {removed.map((r) => (
              <button key={r.id} onClick={() => restore(r)} className="mr-2 line-through hover:text-olive-700 hover:no-underline" title="Restore">
                {r.name}
              </button>
            ))}
            <span className="text-xs">(tap to restore)</span>
          </div>
        )}
      </Card>

      <div className="sticky bottom-3 z-10 mt-6 flex items-center justify-between gap-3 rounded-full border border-cream-200 bg-white/95 p-2 pl-5 shadow-card backdrop-blur">
        <button onClick={onBack} className="text-sm font-medium text-charcoal-500 hover:text-charcoal-900">
          ← Back
        </button>
        <Button
          disabled={items.length === 0}
          onClick={() => onConfirm(items, removed.map((r) => ({ name: r.name, key: r.key, reason: 'Removed during review' })))}
        >
          Confirm {items.length} ingredient{items.length === 1 ? '' : 's'} →
        </Button>
      </div>
    </div>
  );
}
