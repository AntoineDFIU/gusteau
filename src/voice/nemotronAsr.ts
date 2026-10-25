// ─────────────────────────────────────────────────────────────
// Speech to text with NVIDIA Nemotron ASR, served by NeMo-Speech.cpp
// (`nemo-speech serve`). The mic streams to the server's realtime
// WebSocket as 16-bit PCM; partial and final transcripts come back.
//
// The browser only talks to /api/asr. The dev server forwards it to
// ASR_BASE_URL and adds any API key (see vite.config.ts).
//
//   ← session.created                { session: { model, sample_rate } }
//   → session.update                 { session: { sample_rate, language } }
//   ← session.updated
//   → binary frames                  little-endian PCM16, mono, any rate 8–96 kHz
//   ← …transcription.delta           { delta, audio_processed }  words added to the partial
//   → input_audio_buffer.commit      end of the utterance
//   ← …transcription.completed       { transcript }  the final text
//   ← input_audio_buffer.committed   the next audio starts a new utterance
//
// The server doesn't end utterances by itself (endpointing is off), so
// with `pauseMs` the client commits once no new words arrive for that long.
// ─────────────────────────────────────────────────────────────

export const ASR_BASE = '/api/asr';
const REALTIME_PATH = '/v1/audio/transcriptions/realtime';
const CHUNK_SECONDS = 0.1;
const CONNECT_TIMEOUT_MS = 10000;
const COMMIT_TIMEOUT_MS = 8000;
const DELTA = 'conversation.item.input_audio_transcription.delta';
const COMPLETED = 'conversation.item.input_audio_transcription.completed';

const UNREACHABLE = "Can't reach the ASR server. Is the SSH tunnel to the Mac up?";

export interface AsrServerInfo {
  model: string;
  device?: string;
  version?: string;
  /** Text-to-speech on the same server, if it has a TTS model loaded. */
  tts?: { model: string; voices: string[]; languages: string[] };
}

/** Is the server up, and which model does it serve? Throws a readable message if not. */
export async function checkAsrServer(): Promise<AsrServerInfo> {
  const health = await fetch(`${ASR_BASE}/health`, { cache: 'no-store' })
    .then((r) => r.json() as Promise<{ status?: string; version?: string }>)
    .catch(() => null);
  if (!health) throw new Error(UNREACHABLE);
  if (health.status !== 'ok') throw new Error(`The ASR server is up but its model isn't ready (${health.status ?? 'unknown'}).`);
  type Model = { id: string; capability?: string; device?: string; voices?: string[]; languages?: string[] };
  const models = await fetch(`${ASR_BASE}/v1/models`, { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<{ data?: Model[] }>) : null))
    .catch(() => null);
  const asr = models?.data?.find((m) => m.capability === 'transcription');
  const tts = models?.data?.find((m) => m.capability === 'speech');
  return {
    model: asr?.id ?? 'unknown model',
    device: asr?.device,
    version: health.version,
    tts: tts && { model: tts.id, voices: tts.voices ?? [], languages: tts.languages ?? [] },
  };
}

export type AsrEvent = { type: string } & Record<string, unknown>;

export interface AsrOptions {
  /** BCP-47 code such as en-US; empty for the model's default. */
  language?: string;
  /** Finalize after this long without new words. 0 = only on commit() or stop(). */
  pauseMs?: number;
  /** The unfinished utterance so far ('' once it's final), and how many seconds of sent audio the server hasn't processed yet. */
  onPartial?(text: string, lagSeconds: number): void;
  /** A finished utterance. `unconfirmed` means the server never finalized it and this is the last partial. */
  onFinal?(text: string, info: { commitMs?: number; unconfirmed?: boolean }): void;
  /** Mic loudness from 0 to 1, ten times a second. */
  onLevel?(level: number): void;
  /** Every server event, for debugging. */
  onEvent?(event: AsrEvent): void;
  onError?(message: string): void;
  /** The session ended without stop(): the connection dropped. */
  onClose?(reason: string): void;
}

export interface AsrSession {
  model: string;
  sampleRate: number;
  /** Finalize the current utterance now and keep listening. */
  commit(): void;
  /** Stop sending the mic, e.g. while Gusteau talks so he doesn't transcribe himself. */
  setMuted(muted: boolean): void;
  /** Finalize what's been said, then release the mic and the connection. */
  stop(): Promise<void>;
  /** Drop everything now. */
  cancel(): void;
}

// Runs on the audio thread: float samples in, 100 ms PCM16 chunks out.
// A message from the page flushes the partial chunk, then answers 'flushed'.
const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.chunk;
    this.buf = new Int16Array(this.size);
    this.n = 0;
    this.port.onmessage = () => {
      if (this.n) this.port.postMessage(this.buf.slice(0, this.n).buffer);
      this.n = 0;
      this.port.postMessage('flushed');
    };
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.size) {
        // Transferring detaches this.buf, so the next one is sized from this.size.
        this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
        this.buf = new Int16Array(this.size);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('gusteau-pcm-tap', PcmTap);
`;
let workletUrl: string | undefined;

function level(chunk: Int16Array) {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
  const db = 20 * Math.log10(Math.sqrt(sum / Math.max(1, chunk.length)) / 32768 || 1e-6);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/**
 * Open the mic and a realtime session. Resolves once the server is ready;
 * audio captured while connecting is queued, so the first words aren't lost.
 */
export async function startAsr(opts: AsrOptions): Promise<AsrSession> {
  const media = await navigator.mediaDevices
    .getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    .catch((e: DOMException) => {
      throw new Error(e?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it from the address bar and try again.' : `No microphone available (${e?.message ?? e}).`);
    });
  const ctx = new AudioContext();
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${scheme}://${location.host}${ASR_BASE}${REALTIME_PATH}`);
  ws.binaryType = 'arraybuffer';

  let node: AudioWorkletNode | undefined;
  let model = '';
  let ready = false;
  let ended = false;
  let closing = false; // stop() has sent its final commit; drop any later audio
  let muted = false;
  let stopping: Promise<void> | undefined;
  const queued: ArrayBuffer[] = [];
  let partial = '';
  let lastWordAt = 0;
  let sentSeconds = 0; // audio sent since the last commit
  let uncommitted = false; // audio sent since the last commit
  const commits: number[] = []; // send times of commits the server hasn't confirmed
  let onCommitted: (() => void) | undefined;
  let onFlushed: (() => void) | undefined;

  const release = () => {
    ended = true;
    window.clearInterval(pauseTimer);
    media.getTracks().forEach((t) => t.stop());
    node?.port.close();
    void ctx.close().catch(() => {});
    if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN) ws.close();
  };

  const send = (pcm: ArrayBuffer) => {
    ws.send(pcm);
    sentSeconds += pcm.byteLength / 2 / ctx.sampleRate;
    uncommitted = true;
  };

  const commit = () => {
    if (!ready || ws.readyState !== WebSocket.OPEN || !uncommitted) return;
    ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    commits.push(performance.now());
    sentSeconds = 0;
    uncommitted = false;
  };

  const pauseTimer = window.setInterval(() => {
    if (opts.pauseMs && partial.trim() && !commits.length && performance.now() - lastWordAt >= opts.pauseMs) commit();
  }, 100);

  const settled = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('The ASR server took too long to answer.')), CONNECT_TIMEOUT_MS);
    const fail = (message: string) => {
      window.clearTimeout(timer);
      reject(new Error(message));
    };

    ws.onerror = () => {
      if (!ready) fail(UNREACHABLE);
    };
    ws.onclose = (e) => {
      if (!ready) return fail(e.reason || UNREACHABLE);
      if (ended) return;
      if (partial.trim()) opts.onFinal?.(partial.trim(), { unconfirmed: true });
      partial = '';
      release();
      onCommitted?.();
      if (!stopping) opts.onClose?.(e.reason || 'Lost the connection to the ASR server.');
    };
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const m = JSON.parse(e.data) as AsrEvent;
      opts.onEvent?.(m);
      switch (m.type) {
        case 'session.created': {
          const session = m.session as { model?: string } | undefined;
          model = session?.model ?? '';
          ws.send(
            JSON.stringify({
              type: 'session.update',
              session: { sample_rate: ctx.sampleRate, automatic_punctuation: true, ...(opts.language ? { language: opts.language } : {}) },
            }),
          );
          break;
        }
        case 'session.updated':
          ready = true;
          window.clearTimeout(timer);
          queued.splice(0).forEach(send);
          resolve();
          break;
        case DELTA: {
          const delta = typeof m.delta === 'string' ? m.delta : '';
          if (delta) {
            partial += delta;
            lastWordAt = performance.now();
          }
          const processed = typeof m.audio_processed === 'number' ? m.audio_processed : sentSeconds;
          opts.onPartial?.(partial, Math.max(0, sentSeconds - processed));
          break;
        }
        case COMPLETED: {
          const text = String(m.transcript ?? '').trim();
          partial = '';
          opts.onPartial?.('', 0);
          if (text) opts.onFinal?.(text, { commitMs: commits.length ? Math.round(performance.now() - commits[0]) : undefined });
          break;
        }
        case 'input_audio_buffer.committed':
          commits.shift();
          if (!commits.length) onCommitted?.();
          break;
        case 'error': {
          const message = (m.error as { message?: string } | undefined)?.message ?? 'Unknown server error';
          if (!ready) fail(message);
          else opts.onError?.(message);
          break;
        }
      }
    };
  });
  settled.catch(() => {}); // awaited below; this only keeps an early failure from being reported as unhandled

  try {
    if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await ctx.audioWorklet.addModule(workletUrl);
    node = new AudioWorkletNode(ctx, 'gusteau-pcm-tap', { processorOptions: { chunk: Math.round(ctx.sampleRate * CHUNK_SECONDS) } });
    node.port.onmessage = (e: MessageEvent<ArrayBuffer | 'flushed'>) => {
      if (e.data === 'flushed') return onFlushed?.();
      if (ended || closing) return;
      opts.onLevel?.(muted ? 0 : level(new Int16Array(e.data)));
      if (muted) return;
      if (ready) send(e.data);
      else queued.push(e.data);
    };
    // The node must reach the destination to be pulled; the muted gain keeps the speakers silent.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    ctx.createMediaStreamSource(media).connect(node).connect(mute).connect(ctx.destination);
    await ctx.resume();
    await settled;
  } catch (e) {
    release();
    throw e instanceof Error ? e : new Error(String(e));
  }

  const within = (ms: number, register: (done: () => void) => void) =>
    new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => resolve(false), ms);
      register(() => {
        window.clearTimeout(timer);
        resolve(true);
      });
    });

  return {
    model,
    sampleRate: ctx.sampleRate,
    commit,
    setMuted(on) {
      muted = on;
    },
    cancel: release,
    stop() {
      stopping ??= (async () => {
        window.clearInterval(pauseTimer);
        media.getTracks().forEach((t) => t.stop());
        // Send the last few milliseconds the worklet is still holding, then finalize.
        const flushed = within(300, (done) => (onFlushed = done));
        node?.port.postMessage('flush');
        await flushed;
        closing = true;
        commit();
        if (commits.length && !(await within(COMMIT_TIMEOUT_MS, (done) => (onCommitted = done))) && partial.trim()) {
          opts.onFinal?.(partial.trim(), { unconfirmed: true });
        }
        release();
      })();
      return stopping;
    },
  };
}
