import type { Technique } from '../../data/techniques';

/** A short, preselected technique clip with its written how-to. */
export function TechniqueCard({ technique, onClose }: { technique: Technique; onClose: () => void }) {
  const clip = technique.clip;
  return (
    <div className="mt-6 overflow-hidden rounded-3xl border border-olive-100 bg-olive-50">
      {clip?.kind === 'youtube' && (
        <div className="aspect-video bg-charcoal-900">
          <iframe
            className="h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${clip.id}?rel=0&modestbranding=1${clip.start ? `&start=${clip.start}` : ''}${clip.end ? `&end=${clip.end}` : ''}`}
            title={technique.title}
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
      {clip?.kind === 'file' && <video className="aspect-video w-full bg-charcoal-900" src={`${import.meta.env.BASE_URL}${clip.src}`} controls playsInline muted />}
      <div className="flex items-start gap-3 p-4">
        <span className="text-2xl" aria-hidden>
          🎬
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-olive-700">{technique.title}</p>
          <p className="mt-1 text-sm text-charcoal-700">{technique.howTo}</p>
          <p className="mt-2 text-[11px] text-charcoal-400">{clip ? `Clip: ${clip.credit}` : 'A short demo clip for this technique is coming soon.'}</p>
        </div>
        <button onClick={onClose} aria-label="Hide technique" className="shrink-0 text-lg text-charcoal-400 hover:text-charcoal-700">
          ×
        </button>
      </div>
    </div>
  );
}
