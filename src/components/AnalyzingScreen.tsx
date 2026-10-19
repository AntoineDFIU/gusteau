import { useEffect, useState } from 'react';
import type { PhotoInput } from '../services/modelService';
import { Card, GusteauAvatar } from './ui';

const LINES = ['Scanning the shelves…', 'Spotting fresh produce…', 'Reading jar and can labels…', 'Estimating quantities…', 'Double-checking the crisper drawer…'];

export function AnalyzingScreen({ photos }: { photos: PhotoInput[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % LINES.length), 700);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-xl animate-rise text-center">
      <Card className="relative overflow-hidden p-3">
        <div className="relative overflow-hidden rounded-[20px]">
          {photos[0] ? (
            <img src={photos[0].dataUrl} alt="Your kitchen" className="h-72 w-full object-cover" />
          ) : (
            <div className="h-72 bg-cream-200" />
          )}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-tomato-500/10 to-transparent" />
          <div className="scanline absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-saffron-400/50 to-transparent" />
        </div>
      </Card>
      <div className="mt-8 flex items-center justify-center gap-3">
        <GusteauAvatar />
        <p className="font-display text-2xl font-semibold text-charcoal-900">Gusteau is looking…</p>
      </div>
      <p key={i} className="mt-2 animate-rise text-charcoal-500">
        {LINES[i]}
      </p>
    </div>
  );
}
