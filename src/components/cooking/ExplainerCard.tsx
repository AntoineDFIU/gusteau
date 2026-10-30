import { useEffect, useRef } from 'react';
import type { Lookup } from '../../services/lookup';
import { Button, Spinner } from '../ui';

/** "What is a zester?": the definition and a few pictures, out of the way with one tap, Esc, or "got it". */
export function ExplainerCard({ explainer, onClose, returnLabel = 'Got it, back to cooking' }: { explainer: { term: string; lookup?: Lookup; error?: string }; onClose: () => void; returnLabel?: string }) {
  const { term, lookup, error } = explainer;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el && (el.getBoundingClientRect().top < 120 || el.getBoundingClientRect().top > window.innerHeight * 0.6)) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [term, onClose]);

  return (
    <div ref={ref} role="dialog" aria-label={`About ${term}`} className="relative animate-pop scroll-mt-40 overflow-hidden rounded-3xl border border-olive-100 bg-white shadow-card">
      <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg text-charcoal-700 shadow hover:bg-cream-100">
        ×
      </button>
      <div className="p-5 pr-14 sm:p-6 sm:pr-16">
        <p className="text-[11px] font-bold uppercase tracking-wider text-olive-500">What’s that?</p>
        <h2 className="mt-1 font-display text-2xl font-semibold capitalize text-charcoal-900">{lookup?.title ?? term}</h2>
        {!lookup && !error && (
          <p className="mt-3 flex items-center gap-2 text-sm text-charcoal-500">
            <Spinner className="text-olive-500" /> Looking it up…
          </p>
        )}
        {error && <p className="mt-3 text-sm text-tomato-700">{error}</p>}
        {lookup && <p className="mt-2 text-lg leading-relaxed text-charcoal-700">{lookup.definition}</p>}
      </div>
      {lookup && lookup.images.length > 0 && (
        <ul className="grid grid-cols-2 gap-2 px-5 sm:grid-cols-4 sm:px-6">
          {lookup.images.map((img) => (
            <li key={img.src}>
              <a href={img.page} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-2xl bg-cream-100" title={`${img.caption} (opens Wikimedia Commons)`}>
                <img src={img.src} alt={img.caption} loading="lazy" className="aspect-square w-full object-cover transition-transform group-hover:scale-105" />
              </a>
              <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-charcoal-500">{img.caption}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 bg-cream-50 px-5 py-3 sm:px-6">
        <p className="text-[11px] text-charcoal-400">
          {lookup ? (
            <>
              From{' '}
              <a href={lookup.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
                Wikipedia
              </a>
              {lookup.images.length > 0 && ' · pictures from Wikimedia Commons (tap one for its author and license)'}
            </>
          ) : (
            'Esc or “got it” closes this'
          )}
        </p>
        <Button size="sm" onClick={onClose}>
          {returnLabel}
        </Button>
      </div>
    </div>
  );
}
