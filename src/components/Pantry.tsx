import { useRef, useState } from 'react';
import { uid } from '../agent/adapt';
import { emojiFor, sameIngredient } from '../data/ingredients';
import { toJpegDataUrl } from '../lib/image';
import { modelService } from '../services';
import { SAMPLE_FRIDGE_SVG } from '../services/mock/mockData';
import type { PhotoInput } from '../services/modelService';
import type { DetectedIngredient, PantryItem } from '../types';
import { Button, Card, GusteauAvatar, Modal, Spinner, Toggle, cx } from './ui';

const readFile = (f: File) =>
  new Promise<PhotoInput>((resolve, reject) => {
    const r = new FileReader();
    r.onload = async () => resolve({ name: f.name, dataUrl: await toJpegDataUrl(String(r.result)) });
    r.onerror = reject;
    r.readAsDataURL(f);
  });

/** Add names to a pantry, skipping ones already there. */
export function mergePantry(pantry: PantryItem[], names: string[], source: PantryItem['source'], extra: (n: string) => Partial<PantryItem> = () => ({})): PantryItem[] {
  const out = [...pantry];
  for (const raw of names) {
    const name = raw.trim().replace(/^./, (m) => m.toUpperCase());
    if (name && !out.some((p) => sameIngredient(p.name, name) || p.name.toLowerCase() === name.toLowerCase())) out.push({ id: uid(), name, source, ...extra(raw) });
  }
  return out;
}

export function PantryPanel({
  pantry,
  basics,
  onChange,
  compact = false,
}: {
  pantry: PantryItem[];
  basics: boolean;
  onChange: (pantry: PantryItem[], basics: boolean) => void;
  compact?: boolean;
}) {
  const [text, setText] = useState('');
  const [scan, setScan] = useState<null | { photos: PhotoInput[]; found: (DetectedIngredient & { keep: boolean })[] | null; error?: string }>(null);
  const file = useRef<HTMLInputElement>(null);

  const add = () => {
    const names = text.split(/,|\n/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    onChange(mergePantry(pantry, names, 'manual'), basics);
    setText('');
  };

  const analyze = async (photos: PhotoInput[]) => {
    setScan({ photos, found: null });
    try {
      const found = await modelService.analyzePhotos(photos);
      setScan({ photos, found: found.map((f) => ({ ...f, keep: true })), error: found.length ? undefined : 'I couldn’t spot any food in that photo. Try a brighter shot, or type what you have.' });
    } catch (err) {
      console.warn('[Gusteau] Photo analysis failed', err);
      setScan({ photos, found: [], error: 'I couldn’t read that photo just now. Type what you have instead, and we’ll keep going.' });
    }
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 2);
    void analyze(await Promise.all(imgs.map(readFile)));
  };

  const confirmScan = () => {
    if (!scan?.found) return;
    const keep = scan.found.filter((f) => f.keep && f.name.trim());
    onChange(mergePantry(pantry, keep.map((k) => k.name), 'photo', (n) => {
      const f = keep.find((k) => k.name === n);
      return { quantityNote: f?.quantityNote || undefined, confidence: f?.confidence };
    }), basics);
    setScan(null);
  };

  return (
    <Card className={cx('p-4 sm:p-5', compact && 'shadow-none')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold text-charcoal-900">What’s in your kitchen</h2>
          <p className="text-xs text-charcoal-500">{pantry.length ? `${pantry.length} item${pantry.length === 1 ? '' : 's'}. Gusteau shows what you have and what’s missing.` : 'Optional. Add what you have to see dishes you can make right now.'}</p>
        </div>
        {pantry.length > 0 && (
          <button onClick={() => onChange([], basics)} className="shrink-0 text-xs font-medium text-charcoal-400 hover:text-tomato-600">
            Clear
          </button>
        )}
      </div>

      {pantry.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {pantry.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded-full bg-cream-100 py-1 pl-2.5 pr-1 text-sm text-charcoal-700">
              <span aria-hidden>{emojiFor(p.name)}</span>
              {p.name}
              <button onClick={() => onChange(pantry.filter((x) => x.id !== p.id), basics)} aria-label={`Remove ${p.name}`} className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full text-charcoal-400 hover:bg-white hover:text-tomato-600">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. rice, eggs, spinach"
          aria-label="Add ingredients"
          className="min-w-0 flex-1 rounded-full border border-cream-300 bg-white px-4 py-2 text-sm outline-none focus:border-tomato-400"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!text.trim()}>
          Add
        </Button>
      </form>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <button onClick={() => file.current?.click()} className="text-sm font-semibold text-olive-500 hover:text-olive-700">
          📸 Scan a fridge or pantry photo
        </button>
        <button
          onClick={async () => analyze([{ name: 'sample-fridge.jpg', dataUrl: await toJpegDataUrl(SAMPLE_FRIDGE_SVG) }])}
          className="text-xs font-medium text-charcoal-400 underline-offset-4 hover:underline"
        >
          or try a sample photo
        </button>
        <input ref={file} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onFiles(e.target.files)} />
      </div>
      <label className="mt-3 flex items-center justify-between gap-3 border-t border-cream-200 pt-3 text-xs text-charcoal-500">
        Assume salt, pepper, oil and water
        <Toggle checked={basics} onChange={(v) => onChange(pantry, v)} label="Assume pantry basics" />
      </label>

      <Modal open={!!scan} onClose={() => setScan(null)} label="Review detected ingredients">
        {scan && (
          <div className="p-5 sm:p-6">
            <div className="flex items-center gap-3 pr-10">
              <GusteauAvatar />
              <h2 className="font-display text-xl font-semibold text-charcoal-900">{scan.found ? 'Here’s what I found' : 'Looking at your photo…'}</h2>
            </div>
            <div className={cx('mt-4 grid gap-2', scan.photos.length > 1 && 'grid-cols-2')}>
              {scan.photos.map((p, i) => (
                <div key={i} className="relative overflow-hidden rounded-2xl">
                  <img src={p.dataUrl} alt={`Kitchen photo ${i + 1}`} className="h-36 w-full object-cover" />
                  {!scan.found && <div className="scanline absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-saffron-400/40 to-transparent" />}
                </div>
              ))}
            </div>
            {!scan.found ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-charcoal-500">
                <Spinner className="text-tomato-500" /> Spotting ingredients with {modelService.mode === 'mock' ? 'the demo detector' : modelService.label}…
              </p>
            ) : (
              <>
                {scan.error && <p className="mt-4 rounded-2xl bg-tomato-50 p-3 text-sm text-tomato-700">{scan.error}</p>}
                <p className="mt-4 rounded-2xl bg-saffron-100/60 p-3 text-xs text-charcoal-700">
                  Photo recognition can miss items, quantities, labels, allergens or freshness. Check each one, fix names, and untick anything that’s wrong. Always check packaging for allergens.
                </p>
                <ul className="mt-3 space-y-1.5">
                  {scan.found.map((f, i) => (
                    <li key={i} className={cx('flex items-center gap-2 rounded-2xl border px-3 py-2', f.keep ? 'border-cream-200 bg-white' : 'border-transparent bg-cream-100 opacity-60')}>
                      <input
                        type="checkbox"
                        checked={f.keep}
                        onChange={(e) => setScan({ ...scan, found: scan.found!.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)) })}
                        aria-label={`Keep ${f.name}`}
                        className="h-4 w-4 accent-olive-500"
                      />
                      <span aria-hidden>{emojiFor(f.name)}</span>
                      <input
                        value={f.name}
                        onChange={(e) => setScan({ ...scan, found: scan.found!.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })}
                        aria-label="Ingredient name"
                        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-charcoal-900 outline-none"
                      />
                      {f.confidence < 0.7 && <span className="shrink-0 rounded-full bg-saffron-100 px-2 py-0.5 text-[10px] font-semibold text-charcoal-700">Please double-check</span>}
                    </li>
                  ))}
                </ul>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={confirmScan} disabled={!scan.found.some((f) => f.keep)}>
                    Add {scan.found.filter((f) => f.keep).length} to my kitchen
                  </Button>
                  <Button variant="secondary" onClick={() => setScan(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>
    </Card>
  );
}
