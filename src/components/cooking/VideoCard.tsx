import { useEffect, useRef, useState } from 'react';
import { youtubeSearchUrl } from '../../services/videos';
import type { VideoCard as Card } from '../../state/useCook';
import { Button, Spinner, cx } from '../ui';

/** "How do I dice an onion?": a short video (and a few alternatives), out of the way with one tap, Esc, or "got it". */
export function VideoCard({ card, onClose }: { card: Card; onClose: () => void }) {
  const { query, howTo, videos, error } = card;
  const [pick, setPick] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const video = videos?.[pick];

  useEffect(() => setPick(0), [query]);
  useEffect(() => {
    const el = ref.current;
    if (el && (el.getBoundingClientRect().top < 120 || el.getBoundingClientRect().top > window.innerHeight * 0.6)) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query, onClose]);

  return (
    <div ref={ref} role="dialog" aria-label={`How to ${query}`} className="relative animate-pop scroll-mt-40 overflow-hidden rounded-3xl border border-olive-100 bg-white shadow-card">
      <button onClick={onClose} aria-label="Close" className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg text-charcoal-700 shadow hover:bg-cream-100">
        ×
      </button>
      <div className="p-5 pr-14 sm:p-6 sm:pr-16">
        <p className="text-[11px] font-bold uppercase tracking-wider text-olive-500">Show me how</p>
        <h2 className="mt-1 font-display text-2xl font-semibold text-charcoal-900">How to {query}</h2>
        {howTo && <p className="mt-2 text-base leading-relaxed text-charcoal-700">{howTo}</p>}
      </div>

      {!videos && !error && (
        <p className="flex items-center gap-2 px-5 pb-2 text-sm text-charcoal-500 sm:px-6">
          <Spinner className="text-olive-500" /> Finding short videos…
        </p>
      )}

      {video && (
        <div className="px-5 sm:px-6">
          <div className="aspect-video overflow-hidden rounded-2xl bg-charcoal-900">
            <iframe
              key={video.id}
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${video.id}?rel=0&modestbranding=1&playsinline=1`}
              title={video.title}
              allow="encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
            />
          </div>
          <p className="mt-2 text-sm font-medium text-charcoal-900">{video.title}</p>
          <p className="text-xs text-charcoal-500">{video.channel} · YouTube</p>
          {videos!.length > 1 && (
            <ul className="mt-3 grid grid-cols-4 gap-2" aria-label="Other videos">
              {videos!.map((v, i) => (
                <li key={v.id}>
                  <button
                    onClick={() => setPick(i)}
                    aria-pressed={i === pick}
                    title={v.title}
                    className={cx('block w-full overflow-hidden rounded-xl ring-2 transition', i === pick ? 'ring-tomato-500' : 'ring-transparent hover:ring-cream-300')}
                  >
                    <img src={v.thumb} alt={v.title} loading="lazy" className="aspect-video w-full object-cover" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="mx-5 rounded-2xl bg-cream-100 px-4 py-3 text-sm text-charcoal-700 sm:mx-6">
          {error === 'none' ? 'I couldn’t find a short video about exactly that.' : 'Video search isn’t answering right now.'}{' '}
          <a href={youtubeSearchUrl(query)} target="_blank" rel="noreferrer" className="font-semibold text-olive-500 underline-offset-2 hover:underline">
            Watch on YouTube ↗
          </a>
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-cream-200 bg-cream-50 px-5 py-3 sm:px-6">
        <p className="text-[11px] text-charcoal-400">{videos ? 'Short videos found on YouTube' : 'Esc or “got it” closes this'}</p>
        <Button size="sm" onClick={onClose}>
          Got it, back to cooking
        </Button>
      </div>
    </div>
  );
}
