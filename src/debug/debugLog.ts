import { useSyncExternalStore } from 'react';

// ─────────────────────────────────────────────────────────────
// What the debug panel shows: everything heard and said out loud,
// every request sent to the model (all its messages), and every raw
// reply as it streams in. Recorded all the time (the last 200 of each),
// so turning the panel on shows what already happened.
// ─────────────────────────────────────────────────────────────

const MAX = 200;

export interface HeardEntry {
  at: number;
  who: 'cook' | 'gusteau';
  text: string;
  /** What Gusteau did with it: "called by name", "ignored: no “Hey Chef”"… */
  note?: string;
}

export interface LlmMessage {
  role: string;
  content: unknown;
}

export interface LlmExchange {
  id: number;
  at: number;
  /** Which job the request was for: chat, discovery, stages… */
  purpose: string;
  model: string;
  messages: LlmMessage[];
  params: Record<string, unknown>;
  response: string;
  done: boolean;
  ms?: number;
  error?: string;
}

let heard: HeardEntry[] = [];
let exchanges: LlmExchange[] = [];
let version = 0;
let nextId = 1;
const listeners = new Set<() => void>();
let queued = false;

const changed = () => {
  // Streaming replies change many times a second: redraw at most once a frame.
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    version++;
    listeners.forEach((l) => l());
  });
};

export function logHeard(entry: Omit<HeardEntry, 'at'>): void {
  heard = [...heard, { ...entry, at: Date.now() }].slice(-MAX);
  changed();
}

/** A request is about to go to the model. Returns its id, for the reply. */
export function logRequest(purpose: string, model: string, messages: LlmMessage[], params: Record<string, unknown> = {}): number {
  const id = nextId++;
  exchanges = [...exchanges, { id, at: Date.now(), purpose, model, messages, params, response: '', done: false }].slice(-MAX);
  changed();
  return id;
}

/** The reply so far (streaming), or all of it with `done`. */
export function logResponse(id: number, response: string, done = false, error?: string): void {
  exchanges = exchanges.map((x) => (x.id === id ? { ...x, response, done: done || x.done, error, ms: done ? Date.now() - x.at : x.ms } : x));
  changed();
}

export function clearLog(which: 'heard' | 'llm'): void {
  if (which === 'heard') heard = [];
  else exchanges = [];
  changed();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useDebugLog() {
  useSyncExternalStore(subscribe, () => version);
  return { heard, exchanges };
}
