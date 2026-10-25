import { streamChat, type ChatMessage } from '../services/llm/chatStream';
import { createSpeaker, takeSentences, type VoiceEngine } from '../voice/speaker';

// ─────────────────────────────────────────────────────────────
// One spoken exchange with Gusteau: the finalized phrase goes to the
// text model configured for the dev server (GUSTEAU_PROVIDER /
// LLM_* in vite.config.ts), and the reply is spoken sentence by
// sentence while it streams in.
// ─────────────────────────────────────────────────────────────

export interface LlmInfo {
  label: string;
  model: string;
  extraBody?: Record<string, unknown>;
  timeoutMs: number;
}

const SYSTEM = `You are Gusteau, a warm, concise chef helping someone cook hands-free. They talk to you while they cook, and your reply is read aloud.
- Answer in one to three short spoken sentences, leading with the answer.
- Plain speech only: no lists, markdown, emoji or headings. Say numbers and units the way you would out loud.
- Their words come from speech recognition and may contain mistakes, so go with the most likely meaning. If you really can't tell, ask one short question.
- Reply in the language they speak.
- Never claim to verify allergens, freshness or food safety.`;

/** Earlier turns sent with each question; enough for follow-ups without growing forever. */
const HISTORY = 16;

/** The text model the dev server is set up with, or null in mock mode. */
export async function loadLlmConfig(): Promise<LlmInfo | null> {
  const cfg = await fetch(`${import.meta.env.BASE_URL}api/config`, { cache: 'no-store' })
    .then((r) => r.json() as Promise<{ provider?: string; label?: string; textModel?: string; extraBody?: Record<string, unknown>; timeoutMs?: number }>)
    .catch(() => null);
  if (!cfg?.provider || cfg.provider === 'mock' || !cfg.textModel) return null;
  return { label: cfg.label ?? cfg.provider, model: cfg.textModel, extraBody: cfg.extraBody, timeoutMs: cfg.timeoutMs ?? 120000 };
}

/** Load the model into memory so the first question doesn't wait for it. Resolves with the time taken. */
export async function warmUp(llm: LlmInfo): Promise<number> {
  const start = performance.now();
  await streamChat({ model: llm.model, extraBody: llm.extraBody, maxTokens: 1, messages: [{ role: 'user', content: 'Hi' }], signal: AbortSignal.timeout(llm.timeoutMs) });
  return Math.round(performance.now() - start);
}

export interface Turn {
  /** The full reply, once it has been spoken. */
  done: Promise<string>;
  cancel(): void;
}

export function startTurn(
  llm: LlmInfo,
  history: ChatMessage[],
  voice: VoiceEngine,
  on: { text(reply: string): void; speaking(on: boolean): void; voiceError(message: string): void },
): Turn {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(new Error(`No answer from ${llm.model} after ${llm.timeoutMs / 1000} s.`)), llm.timeoutMs);
  const speaker = createSpeaker(voice, { onSpeaking: on.speaking, onError: on.voiceError });
  let unspoken = '';
  const done = (async () => {
    try {
      const reply = await streamChat({
        model: llm.model,
        extraBody: llm.extraBody,
        signal: controller.signal,
        messages: [{ role: 'system', content: SYSTEM }, ...history.slice(-HISTORY)],
        onDelta(text, piece) {
          on.text(text);
          const { sentences, rest } = takeSentences(unspoken + piece);
          unspoken = rest;
          sentences.forEach((s) => speaker.say(s));
        },
      });
      window.clearTimeout(timer);
      speaker.say(unspoken);
      await speaker.finish();
      return reply;
    } catch (e) {
      speaker.cancel();
      throw e;
    } finally {
      window.clearTimeout(timer);
    }
  })();
  return {
    done,
    cancel() {
      controller.abort();
      speaker.cancel();
    },
  };
}
