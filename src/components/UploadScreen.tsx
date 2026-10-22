import { useRef, useState, type DragEvent } from 'react';
import { toJpegDataUrl } from '../lib/image';
import type { PhotoInput } from '../services/modelService';
import { SAMPLE_FRIDGE_SVG } from '../services/mock/mockData';
import { Button, Card, Eyebrow, cx } from './ui';

const readFile = (f: File) =>
  new Promise<PhotoInput>((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => resolve({ name: f.name, dataUrl: await toJpegDataUrl(String(r.result)) });
    r.onerror = reject;
    r.readAsDataURL(f);
  });

export function UploadScreen({
  onAnalyze,
  onManual,
  onDemo,
}: {
  onAnalyze: (p: PhotoInput[]) => void;
  onManual: () => void;
  onDemo: () => void;
}) {
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const read = await Promise.all(imgs.map(readFile));
    setPhotos((p) => [...p, ...read].slice(0, 2));
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void addFiles(e.dataTransfer.files);
  };

  return (
    <div className="mx-auto max-w-5xl animate-rise">
      <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <Eyebrow>Your personal chef assistant</Eyebrow>
          <h1 className="mt-3 font-display text-4xl font-semibold leading-[1.05] text-charcoal-900 sm:text-5xl lg:text-6xl">
            What’s in your <span className="italic text-tomato-500">kitchen?</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-charcoal-500">
            Upload a photo of your fridge or pantry or table and Gusteau will help you cook with what you have.
          </p>
          <ol className="mt-8 grid max-w-md gap-3 text-sm text-charcoal-500">
            {[
              ['📸', 'Snap your fridge or pantry'],
              ['✅', 'Confirm what Gusteau found'],
              ['🍳', 'Cook one meal that actually fits, and adapts as you go'],
            ].map(([e, t], i) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-lg shadow-card">{e}</span>
                <span>
                  <span className="mr-1.5 font-semibold text-charcoal-700">{i + 1}.</span>
                  {t}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <Card className="p-4 sm:p-5">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={onDrop}
            onClick={() => input.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
            className={cx(
              'group relative flex min-h-[300px] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-[22px] border-2 border-dashed p-6 text-center transition-all',
              drag ? 'border-tomato-500 bg-tomato-50' : 'border-cream-300 bg-cream-100 hover:border-tomato-400 hover:bg-cream-50',
            )}
          >
            {photos.length ? (
              <div className={cx('grid w-full gap-3', photos.length > 1 && 'grid-cols-2')}>
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    <img src={p.dataUrl} alt={`Upload ${i + 1}`} className="h-56 w-full rounded-2xl object-cover shadow-card" />
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPhotos((ps) => ps.filter((_, j) => j !== i));
                      }}
                      className="absolute right-2 top-2 rounded-full bg-white/90 px-2.5 py-1 text-xs font-semibold text-charcoal-700 shadow hover:bg-white"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="pointer-events-none absolute inset-0 select-none opacity-[0.13]" aria-hidden>
                  <span className="absolute left-6 top-6 text-5xl">🥕</span>
                  <span className="absolute right-8 top-10 text-4xl">🧀</span>
                  <span className="absolute bottom-8 left-10 text-4xl">🍋</span>
                  <span className="absolute bottom-6 right-6 text-5xl">🥬</span>
                </div>
                <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white text-4xl shadow-card transition-transform group-hover:-rotate-6 group-hover:scale-105">
                  📸
                </div>
                <p className="mt-5 font-display text-xl font-semibold text-charcoal-900">Drop a fridge or pantry photo</p>
                <p className="mt-1 text-sm text-charcoal-400">or tap to browse · up to 2 photos</p>
              </>
            )}
            <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void addFiles(e.target.files)} />
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {photos.length > 0 ? (
              <>
                <Button size="lg" className="flex-1" onClick={() => onAnalyze(photos)}>
                  Find my ingredients →
                </Button>
                {photos.length < 2 && (
                  <Button variant="secondary" size="lg" onClick={() => input.current?.click()}>
                    + Add pantry photo
                  </Button>
                )}
              </>
            ) : (
              <>
                <Button size="lg" className="flex-1" onClick={() => input.current?.click()}>
                  Upload a photo
                </Button>
                <Button variant="secondary" size="lg" className="flex-1" onClick={onManual}>
                  Add ingredients manually
                </Button>
              </>
            )}
          </div>
          {photos.length === 0 && (
            <button
              onClick={async () => onAnalyze([{ name: 'sample-fridge.jpg', dataUrl: await toJpegDataUrl(SAMPLE_FRIDGE_SVG) }])}
              className="mt-3 w-full text-center text-sm font-medium text-olive-500 underline-offset-4 hover:underline"
            >
              No photo handy? Use a sample fridge photo
            </button>
          )}
        </Card>
      </div>

      <Card className="mt-10 overflow-hidden border-saffron-100 bg-gradient-to-r from-saffron-100/70 via-white to-tomato-50">
        <div className="flex flex-col items-start gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <span className="text-4xl">🎬</span>
          <div className="flex-1">
            <p className="font-display text-lg font-semibold text-charcoal-900">Try the live replanning demo</p>
            <p className="text-sm text-charcoal-500">
              Rice, canned beans, tortillas, cheese and salsa. Vegetarian, 15 minutes, microwave only, no purchases. Then say “Actually, I
              don’t have rice.”
            </p>
          </div>
          <Button variant="olive" onClick={onDemo}>
            Load demo kitchen
          </Button>
        </div>
      </Card>
    </div>
  );
}
