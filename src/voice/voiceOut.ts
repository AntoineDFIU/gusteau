import { createSpeaker, takeSentences, type Speaker, type VoiceEngine } from './speaker';

// ─────────────────────────────────────────────────────────────
// Gusteau's one voice for the whole app. Everything he says goes
// through here, so there is only ever one thing playing, and the mic
// knows when to pause (onTalking).
//
//   say(text)          interrupt and say this
//   say(text, true)    say it after whatever is playing
//   stream()           a Speaker for a reply that's still being written
//   stop()             silence now
// ─────────────────────────────────────────────────────────────

export class VoiceOut {
  private engine: VoiceEngine = { kind: 'off' };
  private current: Speaker | null = null;
  private chain: Promise<void> = Promise.resolve();
  private generation = 0;
  private talking = 0;

  constructor(private readonly onTalking: (talking: boolean) => void, private readonly onError: (message: string) => void) {}

  setEngine(engine: VoiceEngine) {
    if (JSON.stringify(engine) === JSON.stringify(this.engine)) return;
    this.stop();
    this.engine = engine;
  }

  get kind() {
    return this.engine.kind;
  }

  private make(): Speaker {
    let on = false;
    return createSpeaker(this.engine, {
      onSpeaking: (speaking) => {
        if (speaking === on) return;
        on = speaking;
        this.talking += speaking ? 1 : -1;
        this.onTalking(this.talking > 0);
      },
      onError: this.onError,
    });
  }

  say(text: string, queue = false) {
    if (!text.trim() || this.engine.kind === 'off') return;
    if (!queue) this.stop();
    const gen = this.generation;
    this.chain = this.chain.then(async () => {
      if (gen !== this.generation) return;
      const sp = this.make();
      this.current = sp;
      const { sentences, rest } = takeSentences(`${text} `);
      [...sentences, rest].forEach((s) => sp.say(s));
      await sp.finish();
      if (this.current === sp) this.current = null;
    });
  }

  /** Interrupt, and return a speaker that reads a streamed reply sentence by sentence. Call finish() on it at the end. */
  stream(): Speaker & { push(textSoFar: string): void } {
    this.stop();
    const sp = this.make();
    this.current = sp;
    let used = 0;
    let unspoken = '';
    return {
      push: (textSoFar: string) => {
        const { sentences, rest } = takeSentences(unspoken + textSoFar.slice(used));
        used = textSoFar.length;
        unspoken = rest;
        sentences.forEach((s) => sp.say(s));
      },
      say: (t) => sp.say(t),
      finish: () => {
        if (unspoken.trim()) sp.say(unspoken);
        unspoken = '';
        const finished = sp.finish();
        this.chain = finished.then(() => {
          if (this.current === sp) this.current = null;
        });
        return finished;
      },
      cancel: () => sp.cancel(),
    };
  }

  stop() {
    this.generation++;
    this.current?.cancel();
    this.current = null;
    this.chain = Promise.resolve();
  }
}
