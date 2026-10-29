import { trackAudio } from '../voice/audioUnlock';

let beepCtx: AudioContext | null = null;
/** Three short beeps for a finished timer. Audio is optional, so failures are ignored. */
export function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    // One context, tracked so it plays on the speaker the cook picked.
    const ctx = (beepCtx ??= trackAudio(new Ctx()));
    void ctx.resume().catch(() => {});
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* audio is optional */
  }
}

let chimeCtx: AudioContext | null = null;
/**
 * Gusteau is listening: a short, soft rising chime when he's called or
 * tapped. A sound rather than words, so the cook can start talking at once
 * (his mic is closed while he speaks).
 */
export function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = (chimeCtx ??= trackAudio(new Ctx()));
    [
      [660, 0],
      [990, 0.09],
    ].forEach(([f, t]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.17);
    });
  } catch {
    /* audio is optional */
  }
}

export const formatClock = (s: number) => {
  const secs = Math.max(0, Math.ceil(s));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const r = String(secs % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
};
