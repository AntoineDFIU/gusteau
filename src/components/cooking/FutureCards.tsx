import { useEffect, useState } from 'react';
import { lookupFoodSafety, type SafetyResult } from '../../services/foodSafety';
import type { Recipe } from '../../types';
import { Card, Spinner, cx } from '../ui';

/** Prototype state for a personalized narrated cooking video. No real video is generated. */
export function VideoCard({ recipe }: { recipe: Recipe }) {
  const [state, setState] = useState<'idle' | 'building' | 'preview'>('idle');
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (state === 'building') {
      const t = setTimeout(() => setState('preview'), 1800);
      return () => clearTimeout(t);
    }
    if (state === 'preview') {
      const t = setInterval(() => setFrame((f) => (f + 1) % recipe.steps.length), 2200);
      return () => clearInterval(t);
    }
  }, [state, recipe.steps.length]);

  useEffect(() => setState('idle'), [recipe.title]);

  const step = recipe.steps[frame % recipe.steps.length];

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-gradient-to-br from-charcoal-900 via-charcoal-700 to-tomato-700 text-white">
        {state === 'preview' ? (
          <div key={frame} className="absolute inset-0 flex animate-pop flex-col justify-end p-5">
            <span className="absolute right-5 top-4 text-6xl opacity-80">{recipe.emoji}</span>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-saffron-400">
              Scene {frame + 1} / {recipe.steps.length}
            </p>
            <p className="font-display text-xl font-semibold">{step.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-white/80">🎙 “{step.instruction}”</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/20">
              <div className="h-full bg-saffron-400 transition-all" style={{ width: `${((frame + 1) / recipe.steps.length) * 100}%` }} />
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center">
            <span className="text-4xl">🎬</span>
            <p className="mt-2 font-display text-lg font-semibold">Your 60-second cooking video</p>
            <p className="mt-1 max-w-xs text-xs text-white/70">Narrated, using your exact ingredients and today’s adjusted recipe.</p>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider backdrop-blur">Coming soon · prototype</span>
      </div>
      <div className="flex items-center justify-between gap-3 p-4">
        <p className="text-xs text-charcoal-500">
          {state === 'preview' ? 'Storyboard preview only. Real video generation is a future feature.' : 'Short personalized video for your plan as it stands right now.'}
        </p>
        <button
          onClick={() => setState(state === 'preview' ? 'idle' : 'building')}
          disabled={state === 'building'}
          className="flex shrink-0 items-center gap-2 rounded-full bg-charcoal-900 px-4 py-2 text-sm font-semibold text-white hover:bg-charcoal-700"
        >
          {state === 'building' && <Spinner />}
          {state === 'idle' ? 'Preview storyboard' : state === 'building' ? 'Drafting…' : 'Close'}
        </button>
      </div>
    </Card>
  );
}

/** Placeholder for a future Tavily-backed lookup of trusted, general food-safety guidance. */
export function FoodSafetyCard({ recipe }: { recipe: Recipe }) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SafetyResult[] | null>(null);

  const run = async (query: string) => {
    setQ(query);
    setLoading(true);
    setResults(await lookupFoodSafety(query));
    setLoading(false);
  };

  const quick = recipe.ingredients.some((i) => i.key === 'chicken')
    ? 'Safe temperature for chicken'
    : recipe.ingredients.some((i) => i.key === 'eggs')
      ? 'How to cook eggs safely'
      : 'Storing leftovers';

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold text-charcoal-900">🔎 Food-safety lookup</p>
        <span className="rounded-full bg-cream-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-charcoal-500">Placeholder</span>
      </div>
      <p className="mt-1 text-xs text-charcoal-500">
        Finds general guidance from trusted sources (future: Tavily search). It is <span className="font-semibold">not</span> a medical, allergy, freshness or
        contamination check.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void run(q);
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={quick}
          className="min-w-0 flex-1 rounded-full border border-cream-300 bg-cream-50 px-4 py-2 text-sm outline-none focus:border-olive-400"
        />
        <button type="submit" className="rounded-full bg-olive-500 px-4 text-sm font-semibold text-white hover:bg-olive-700">
          Look up
        </button>
      </form>
      {!results && !loading && (
        <button onClick={() => void run(quick)} className="mt-2 text-xs font-medium text-olive-500 hover:underline">
          Try: {quick}
        </button>
      )}
      {loading && (
        <p className="mt-3 flex items-center gap-2 text-sm text-charcoal-500">
          <Spinner className="text-olive-500" /> Searching trusted sources…
        </p>
      )}
      {results && !loading && (
        <ul className="mt-3 space-y-2">
          {results.map((r) => (
            <li key={r.title} className={cx('rounded-2xl bg-cream-100 p-3 text-sm')}>
              <p className="font-semibold text-charcoal-900">{r.title}</p>
              <p className="mt-0.5 text-charcoal-700">{r.summary}</p>
              <a href={r.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs font-medium text-olive-700 hover:underline">
                Source: {r.source} ↗
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
