// ─────────────────────────────────────────────────────────────
// Streaming chat over the same /api/llm proxy the model service
// uses. Text arrives token by token, so a spoken reply can start
// before the model has finished writing it.
// ─────────────────────────────────────────────────────────────

import { logRequest, logResponse } from '../../debug/debugLog';

const endpoint = (provider?: string) => `${import.meta.env.BASE_URL}api/llm${provider ? `/${encodeURIComponent(provider)}` : ''}/chat/completions`;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamChatOptions {
  provider?: string;
  model: string;
  messages: ChatMessage[];
  /** Provider extras from /api/config, e.g. {"reasoning_effort":"none"} for Ollama. */
  extraBody?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** The reply so far, and the piece that just arrived. */
  onDelta?(text: string, piece: string): void;
  /** What the request is for, shown in the debug panel ("chat", "discovery"…). */
  purpose?: string;
}

/** Stream one reply and resolve with its full text. Reasoning, if a model sends any, is skipped. */
export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const temperature = opts.temperature ?? 0.6;
  const maxTokens = opts.maxTokens ?? 400;
  const logId = logRequest(opts.purpose ?? 'chat', opts.model, opts.messages, { temperature, max_tokens: maxTokens, ...(opts.extraBody ?? {}), stream: true });
  try {
    const text = await streamReply(opts, temperature, maxTokens, (sofar) => logResponse(logId, sofar));
    logResponse(logId, text, true);
    return text;
  } catch (e) {
    logResponse(logId, '', true, (e as Error).message);
    throw e;
  }
}

async function streamReply(opts: StreamChatOptions, temperature: number, maxTokens: number, onRaw: (sofar: string) => void): Promise<string> {
  const res = await fetch(endpoint(opts.provider), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: opts.signal,
    body: JSON.stringify({
      model: opts.model,
      temperature,
      max_tokens: maxTokens,
      ...(opts.extraBody ?? {}),
      stream: true,
      messages: opts.messages,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Model error ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let thinking = false; // inside a <think> block some models put in the content
  let raw = ''; // everything the model sent, thinking included, for the debug panel
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const event = JSON.parse(data) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
      if (event.error) throw new Error(event.error.message ?? 'Model error');
      let piece = event.choices?.[0]?.delta?.content ?? '';
      raw += piece;
      onRaw(raw);
      if (piece.includes('<think>')) thinking = true;
      if (thinking) {
        const end = piece.indexOf('</think>');
        if (end < 0) continue;
        thinking = false;
        piece = piece.slice(end + '</think>'.length);
      }
      if (!text) piece = piece.trimStart();
      if (!piece) continue;
      text += piece;
      opts.onDelta?.(text, piece);
    }
  }
  return text.trim();
}
