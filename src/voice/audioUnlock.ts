// ─────────────────────────────────────────────────────────────
// Browsers keep audio "suspended" until the page gets a tap or key press.
// Voice is always on, so the mic starts as the page loads; its audio (and
// Gusteau's voice) can only actually run after that first touch. Every
// audio context the voice uses is tracked here and resumed on every tap or
// key press, anywhere on the page, the voice button included.
//
// The same contexts are sent to the speaker the cook picked (audioDevices.ts).
// ─────────────────────────────────────────────────────────────

const contexts = new Set<AudioContext>();
/** The chosen speaker, or "" for the system default. */
let sink = '';

type Routable = AudioContext & { setSinkId?(id: string): Promise<void> };
const route = (ctx: AudioContext) => void (ctx as Routable).setSinkId?.(sink).catch(() => {});

/** Resume every suspended voice audio context. Works only inside, or after, a tap or key press. */
export function unlockAudio(): void {
  for (const ctx of contexts) {
    if (ctx.state === 'closed') contexts.delete(ctx);
    else if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  }
}

/** Track an audio context so the next tap or key press can start it, and it plays on the chosen speaker. */
export function trackAudio(ctx: AudioContext): AudioContext {
  contexts.add(ctx);
  if (sink) route(ctx);
  return ctx;
}

/** Send all of Gusteau's sound to this speaker ("" for the system default). */
export function routeAudio(id: string): void {
  sink = id;
  for (const ctx of contexts) {
    if (ctx.state === 'closed') contexts.delete(ctx);
    else route(ctx);
  }
}

if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(type, unlockAudio, { capture: true });
}
