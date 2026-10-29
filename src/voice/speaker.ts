import { trackAudio } from './audioUnlock';
import { ASR_BASE } from './nemotronAsr';
import { forSpeech } from './spokenUnits';
import { speak, stopSpeaking } from './useSpeech';

// ─────────────────────────────────────────────────────────────
// Gusteau's voice for a streamed reply. Each sentence is spoken as
// soon as it's complete. With Magpie TTS (the same NeMo-Speech.cpp
// server as the ASR, so also behind /api/asr), the next sentence is
// synthesized while the current one plays: after the first sentence
// there are no gaps.
// ─────────────────────────────────────────────────────────────

export type VoiceEngine = { kind: 'magpie'; voice: string; language: string } | { kind: 'browser' } | { kind: 'off' };

export interface Speaker {
  /** Queue a sentence. */
  say(text: string): void;
  /** No more text is coming. Resolves once everything queued has been spoken or cancelled. */
  finish(): Promise<void>;
  /** Stop now and drop the queue. */
  cancel(): void;
}

export interface SpeakerOptions {
  /** True from the first audio until the reply ends, including pauses between sentences. */
  onSpeaking?(speaking: boolean): void;
  onError?(message: string): void;
}

/** Split complete sentences off streamed text; `rest` is the unfinished tail. */
export function takeSentences(text: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  // Punctuation must be followed by whitespace, so "1." in "1.5 cups" isn't an ending yet.
  for (const m of text.matchAll(/[.!?…]+["'”’)\]]*\s+|\n+/g)) {
    const stop = (m.index ?? 0) + m[0].length;
    const sentence = text.slice(start, stop).trim();
    if (sentence) sentences.push(sentence);
    start = stop;
  }
  return { sentences, rest: text.slice(start) };
}

/** What a voice shouldn't read out: markdown symbols and emoji. */
const speakable = (text: string) =>
  forSpeech(text)
    .replace(/[*_#`>~|]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

export function createSpeaker(engine: VoiceEngine, opts: SpeakerOptions = {}): Speaker {
  if (engine.kind === 'magpie') return magpieSpeaker(engine.voice, engine.language, opts);
  if (engine.kind === 'browser') return browserSpeaker(opts);
  return { say() {}, finish: () => Promise.resolve(), cancel() {} };
}

let audio: AudioContext | undefined;

function magpieSpeaker(voice: string, language: string, opts: SpeakerOptions): Speaker {
  // Tracked so a tap anywhere unlocks his voice (browsers block sound until the first one).
  const ctx = (audio ??= trackAudio(new AudioContext()));
  void ctx.resume();
  const controller = new AbortController();
  const clips: Promise<AudioBuffer | null>[] = [];
  let synthesizing: Promise<unknown> = Promise.resolve();
  let playing: AudioBufferSourceNode | undefined;
  let pumping = false;
  let finished = false;
  let cancelled = false;
  let speaking = false;
  let idle!: () => void;
  const done = new Promise<void>((resolve) => (idle = resolve));

  const setSpeaking = (on: boolean) => {
    if (speaking === on) return;
    speaking = on;
    opts.onSpeaking?.(on);
  };

  const synthesize = async (text: string) => {
    const res = await fetch(`${ASR_BASE}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ input: text, voice, language, response_format: 'wav' }),
    });
    if (!res.ok) throw new Error(`Magpie TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  };

  const play = (clip: AudioBuffer) =>
    new Promise<void>((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = clip;
      source.connect(ctx.destination);
      source.onended = () => resolve();
      playing = source;
      source.start();
    });

  const pump = async () => {
    if (pumping) return;
    pumping = true;
    while (clips.length && !cancelled) {
      const clip = await clips[0];
      if (cancelled) break;
      clips.shift();
      if (!clip) continue;
      setSpeaking(true);
      await play(clip);
      playing = undefined;
    }
    pumping = false;
    if (cancelled || (finished && !clips.length)) {
      setSpeaking(false);
      idle();
    }
  };

  return {
    say(text) {
      const input = speakable(text);
      if (!input || cancelled || finished) return;
      // One synthesis at a time keeps the GPU on the sentence that's needed next.
      const clip = synthesizing
        .then(() => synthesize(input))
        .catch((e: Error) => {
          if (!cancelled) opts.onError?.(e.message);
          return null;
        });
      synthesizing = clip;
      clips.push(clip);
      void pump();
    },
    finish() {
      finished = true;
      void pump();
      return done;
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      controller.abort();
      clips.length = 0;
      playing?.stop();
      if (!pumping) {
        setSpeaking(false);
        idle();
      }
    },
  };
}

function browserSpeaker(opts: SpeakerOptions): Speaker {
  let last: Promise<void> = Promise.resolve();
  let speaking = false;
  let cancelled = false;
  const setSpeaking = (on: boolean) => {
    if (speaking === on) return;
    speaking = on;
    opts.onSpeaking?.(on);
  };
  return {
    say(text) {
      const input = speakable(text);
      if (!input || cancelled) return;
      setSpeaking(true);
      last = speak(input, true);
    },
    async finish() {
      await last;
      setSpeaking(false);
    },
    cancel() {
      cancelled = true;
      stopSpeaking();
      setSpeaking(false);
    },
  };
}
