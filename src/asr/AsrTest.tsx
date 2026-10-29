import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Eyebrow, GusteauAvatar, SectionTitle, Spinner, Toggle, cx } from '../components/ui';
import type { ChatMessage } from '../services/llm/chatStream';
import { checkAsrServer, startAsr, type AsrEvent, type AsrServerInfo, type AsrSession } from '../voice/nemotronAsr';
import type { VoiceEngine } from '../voice/speaker';
import { ttsSupported } from '../voice/useSpeech';
import { gusteauVoice } from '../voice/useVoice';
import { loadLlmConfig, startTurn, warmUp, type LlmInfo, type Turn } from './assistant';

// ─────────────────────────────────────────────────────────────
// The hands-free loop, end to end: you talk, Nemotron ASR writes it
// down live, each finished phrase goes to the text model, and
// Gusteau's answer streams into a box while it's read aloud. The mic
// pauses while Gusteau speaks so he doesn't hear himself. Timings
// and the raw ASR events are shown for testing.
// ─────────────────────────────────────────────────────────────

type Phase = 'idle' | 'connecting' | 'listening' | 'stopping';
type SpeechServer = { state: 'checking' } | { state: 'ok'; info: AsrServerInfo } | { state: 'down'; message: string };
type Llm = { state: 'checking' } | { state: 'off' } | { state: 'warming'; llm: LlmInfo } | { state: 'ready'; llm: LlmInfo; loadMs: number } | { state: 'down'; llm: LlmInfo; message: string };

interface Heard {
  id: number;
  role: 'user';
  text: string;
  at: Date;
  commitMs?: number;
  unconfirmed?: boolean;
}
interface Answer {
  id: number;
  role: 'gusteau';
  text: string;
  at: Date;
  state: 'thinking' | 'speaking' | 'done' | 'interrupted' | 'error';
  error?: string;
  /** Milliseconds from your finalized phrase to the first words on screen, the first audio, and the end. */
  textMs?: number;
  voiceMs?: number;
  totalMs?: number;
}
type Entry = Heard | Answer;

const LANGUAGES = ['en-US', 'en-GB', 'fr-FR', 'es-ES', 'es-US', 'de-DE', 'it-IT', 'pt-BR', 'nl-NL', 'ja-JP', 'ko-KR', 'zh-CN', 'hi-IN', 'ar-AE'];
const PAUSES = [
  { ms: 0, label: 'Only when I stop' },
  { ms: 600, label: 'After a 0.6 s pause' },
  { ms: 1000, label: 'After a 1 s pause' },
  { ms: 1500, label: 'After a 1.5 s pause' },
  { ms: 2500, label: 'After a 2.5 s pause' },
];
/** The model unloads after a few idle minutes; reload it when listening starts after a break. */
const REWARM_AFTER_MS = 4 * 60 * 1000;
/** Room echo after Gusteau stops, before the mic opens again. */
const ECHO_TAIL_MS = 300;

const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
const modelName = (id: string) => id.replace(/^\./, '').replace(/\.gguf$/i, '');

function describe(e: AsrEvent) {
  const { type, event_id: _id, ...rest } = e;
  const name = type.replace('conversation.item.input_audio_transcription.', '…');
  if (typeof rest.audio_processed === 'number') rest.audio_processed = Number(rest.audio_processed.toFixed(2));
  return `${time(new Date())}  ${name}  ${Object.keys(rest).length ? JSON.stringify(rest) : ''}`;
}

function voiceEngine(choice: string, language: string, server: SpeechServer): VoiceEngine {
  if (choice === 'off') return { kind: 'off' };
  const tts = server.state === 'ok' ? server.info.tts : undefined;
  if (choice.startsWith('magpie:') && tts) {
    return { kind: 'magpie', voice: choice.slice('magpie:'.length), language: tts.languages.includes(language) ? language : 'en-US' };
  }
  return { kind: 'browser' };
}

let nextId = 1;

export function AsrTest() {
  const [server, setServer] = useState<SpeechServer>({ state: 'checking' });
  const [llm, setLlm] = useState<Llm>({ state: 'checking' });
  const [phase, setPhase] = useState<Phase>('idle');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [partial, setPartial] = useState('');
  const [lag, setLag] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const [language, setLanguage] = useState('');
  const [pauseMs, setPauseMs] = useState(1000);
  const [voiceChoice, setVoiceChoice] = useState('');
  const [replies, setReplies] = useState(true);
  const [gusteau, setGusteau] = useState<'quiet' | 'thinking' | 'speaking'>('quiet');
  const [events, setEvents] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const session = useRef<AsrSession | null>(null);
  const turn = useRef<{ id: number; turn: Turn } | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const speaking = useRef(false);
  const lastLlmUse = useRef(0);
  const alive = useRef(true);

  // Default voice: Gusteau's Magpie voice (Jason), else the browser's.
  const tts = server.state === 'ok' ? server.info.tts : undefined;
  const voice = voiceChoice || (tts?.voices.length ? `magpie:${gusteauVoice(tts.voices)}` : ttsSupported ? 'browser' : 'off');
  const activeLlm = llm.state === 'ready' || llm.state === 'warming' ? llm.llm : null;
  // Handlers created when listening starts read the current settings from here.
  const now = useRef({ replies, activeLlm, voice, language, server });
  now.current = { replies, activeLlm, voice, language, server };

  const checkSpeech = useCallback(() => {
    setServer({ state: 'checking' });
    checkAsrServer().then(
      (info) => setServer({ state: 'ok', info }),
      (e: Error) => setServer({ state: 'down', message: e.message }),
    );
  }, []);

  const checkLlm = useCallback(async () => {
    setLlm({ state: 'checking' });
    const cfg = await loadLlmConfig();
    if (!cfg) return setLlm({ state: 'off' });
    setLlm({ state: 'warming', llm: cfg });
    try {
      const loadMs = await warmUp(cfg);
      lastLlmUse.current = Date.now();
      setLlm({ state: 'ready', llm: cfg, loadMs });
    } catch (e) {
      setLlm({ state: 'down', llm: cfg, message: (e as Error).message });
    }
  }, []);

  const interrupt = useCallback(() => {
    const t = turn.current;
    if (!t) return;
    turn.current = null;
    t.turn.cancel();
    setGusteau('quiet');
    setEntries((es) => es.map((e) => (e.id === t.id && e.role === 'gusteau' && (e.state === 'thinking' || e.state === 'speaking') ? { ...e, state: 'interrupted' } : e)));
  }, []);

  useEffect(() => {
    alive.current = true;
    checkSpeech();
    void checkLlm();
    return () => {
      alive.current = false;
      session.current?.cancel();
      session.current = null;
      turn.current?.turn.cancel();
      turn.current = null;
    };
  }, [checkSpeech, checkLlm]);

  /** Mute the mic while Gusteau talks; reopen it once he's done and the room is quiet. */
  const onSpeaking = useCallback((on: boolean) => {
    speaking.current = on;
    if (on) return session.current?.setMuted(true);
    window.setTimeout(() => {
      if (!speaking.current) session.current?.setMuted(false);
    }, ECHO_TAIL_MS);
  }, []);

  /** Send a finished phrase to Gusteau. A new phrase interrupts whatever he was still answering. */
  const ask = useCallback(
    (question: string) => {
      const { replies: on, activeLlm: model, voice: choice, language: lang, server: speech } = now.current;
      if (!on || !model) return;
      interrupt();
      history.current.push({ role: 'user', content: question });
      const id = nextId++;
      const start = performance.now();
      const since = () => Math.round(performance.now() - start);
      const patch = (p: Partial<Answer>) => setEntries((es) => es.map((e) => (e.id === id && e.role === 'gusteau' ? { ...e, ...p } : e)));
      setEntries((es) => [...es, { id, role: 'gusteau', text: '', at: new Date(), state: 'thinking' }]);
      setGusteau('thinking');
      let textMs = 0;
      let voiceMs = 0;
      const t = startTurn(model, history.current, voiceEngine(choice, lang, speech), {
        text(reply) {
          textMs ||= since();
          patch({ text: reply, textMs });
        },
        speaking(on) {
          onSpeaking(on);
          if (!on || voiceMs || turn.current?.id !== id) return;
          voiceMs = since();
          setGusteau('speaking');
          patch({ state: 'speaking', voiceMs });
        },
        voiceError: (message) => setError(`Gusteau's voice failed: ${message}`),
      });
      turn.current = { id, turn: t };
      lastLlmUse.current = Date.now();
      t.done.then(
        (reply) => {
          if (turn.current?.id !== id) return; // interrupted; already marked
          turn.current = null;
          history.current.push({ role: 'assistant', content: reply });
          setGusteau('quiet');
          patch({ state: 'done', totalMs: since() });
        },
        (e: Error) => {
          if (turn.current?.id !== id) return;
          turn.current = null;
          setGusteau('quiet');
          patch({ state: 'error', error: e.message });
        },
      );
    },
    [interrupt, onSpeaking],
  );

  const finish = useCallback(() => {
    session.current = null;
    setPhase('idle');
    setPartial('');
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError('');
    setPhase('connecting');
    if (activeLlm && Date.now() - lastLlmUse.current > REWARM_AFTER_MS) {
      lastLlmUse.current = Date.now();
      void warmUp(activeLlm).catch(() => {});
    }
    try {
      const s = await startAsr({
        language: language.trim(),
        pauseMs,
        onPartial: (text, behind) => {
          setPartial(text);
          setLag(behind);
        },
        onFinal: (text, info) => {
          setEntries((es) => [...es, { id: nextId++, role: 'user', text, at: new Date(), ...info }]);
          ask(text);
        },
        onLevel: setLevel,
        onEvent: (e) => {
          if (e.type.endsWith('.delta') && !e.delta) return; // most deltas are empty; they'd drown the log
          setEvents((ev) => [describe(e), ...ev].slice(0, 200));
        },
        onError: setError,
        onClose: (reason) => {
          finish();
          setError(reason);
          checkSpeech();
        },
      });
      if (!alive.current) return s.cancel();
      s.setMuted(speaking.current);
      session.current = s;
      setPhase('listening');
      if (server.state !== 'ok') checkSpeech();
    } catch (e) {
      setPhase('idle');
      setError((e as Error).message);
    }
  }, [language, pauseMs, activeLlm, server.state, ask, checkSpeech, finish]);

  const stop = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    setPhase('stopping');
    await s.stop();
    finish();
  }, [finish]);

  const toggle = useCallback(() => {
    if (phase === 'idle') void start();
    else if (phase === 'listening') void stop();
  }, [phase, start, stop]);

  // Space starts and stops listening, Escape stops Gusteau, unless you're on another control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return interrupt();
      if (e.code !== 'Space' || e.repeat || (e.target as HTMLElement).closest('input, select, textarea, button, summary')) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, interrupt]);

  const recheck = () => {
    checkSpeech();
    void checkLlm();
  };

  const copy = async () => {
    await navigator.clipboard.writeText(entries.filter((e) => e.text).map((e) => `${e.role === 'user' ? 'You' : 'Gusteau'}: ${e.text}`).join('\n'));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const clear = () => {
    interrupt();
    history.current = [];
    setEntries([]);
  };

  const busy = phase === 'connecting' || phase === 'stopping';
  const live = phase === 'listening';
  const micPaused = live && gusteau === 'speaking';

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <header className="mb-6">
        <Eyebrow>Gusteau · dev tool</Eyebrow>
        <h1 className="mt-1 font-display text-3xl font-semibold text-charcoal-900 sm:text-4xl">Hands-free test</h1>
        <p className="mt-2 text-charcoal-500">Talk to Gusteau. Nemotron ASR hears you, the text model answers, and the reply is read aloud, all on the M5 Max.</p>
      </header>

      <Card className="divide-y divide-cream-200 text-sm">
        <SpeechStatus server={server} />
        <LlmStatus llm={llm} />
        <div className="flex justify-end px-5 py-2">
          <Button variant="ghost" size="sm" onClick={recheck} disabled={server.state === 'checking' || llm.state === 'checking' || llm.state === 'warming'}>
            Check again
          </Button>
        </div>
      </Card>

      <Card className="mt-4 p-6 sm:p-8">
        <div className="flex flex-col items-center text-center">
          <button
            type="button"
            onClick={toggle}
            disabled={busy}
            aria-label={live ? 'Stop listening' : 'Start listening'}
            aria-pressed={live}
            className={cx(
              'flex h-28 w-28 items-center justify-center rounded-full text-4xl text-white transition-all duration-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 disabled:cursor-wait',
              live ? (micPaused ? 'bg-charcoal-400' : 'bg-tomato-600') : 'bg-tomato-500 shadow-lift hover:bg-tomato-600 active:scale-[.98]',
              busy && 'opacity-70',
            )}
            style={live && !micPaused ? { boxShadow: `0 0 0 ${6 + level * 26}px rgba(226,81,47,${0.12 + level * 0.18})` } : undefined}
          >
            {busy ? <Spinner className="h-8 w-8 border-[3px]" /> : live ? '■' : '🎤'}
          </button>
          <p className="mt-5 font-medium text-charcoal-700" aria-live="polite">
            {phase === 'idle' && 'Press to talk'}
            {phase === 'connecting' && 'Connecting to the Mac…'}
            {live && gusteau === 'quiet' && (pauseMs ? 'Listening. Pause when you’re done with a phrase.' : 'Listening. Press again when you’re done.')}
            {live && gusteau === 'thinking' && 'Gusteau is thinking…'}
            {live && gusteau === 'speaking' && 'Gusteau is speaking. Your mic is paused.'}
            {phase === 'stopping' && 'Finishing your last words…'}
          </p>
          <p className="mt-1 text-sm text-charcoal-400">
            {gusteau !== 'quiet'
              ? 'Esc stops Gusteau'
              : live && partial
                ? lag < 0.25
                  ? 'The server is keeping up in real time'
                  : `The server is ${lag.toFixed(1)} s behind your voice`
                : phase === 'idle'
                  ? 'Space works too'
                  : ' '}
          </p>
          {error && <p className="mt-3 rounded-2xl bg-tomato-50 px-4 py-2 text-sm text-tomato-700">{error}</p>}
        </div>

        <div className="mt-6 grid gap-4 border-t border-cream-200 pt-5 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="font-medium text-charcoal-700">Language</span>
            <input
              list="asr-languages"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={phase !== 'idle'}
              placeholder="Model default"
              className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-charcoal-700 focus:border-tomato-400 focus:outline-none disabled:opacity-60"
            />
            <datalist id="asr-languages">
              {LANGUAGES.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-charcoal-700">Finalize each phrase</span>
            <select
              value={pauseMs}
              onChange={(e) => setPauseMs(Number(e.target.value))}
              disabled={phase !== 'idle'}
              className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-charcoal-700 focus:border-tomato-400 focus:outline-none disabled:opacity-60"
            >
              {PAUSES.map((p) => (
                <option key={p.ms} value={p.ms}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-medium text-charcoal-700">Gusteau’s voice</span>
            <select
              value={voice}
              onChange={(e) => setVoiceChoice(e.target.value)}
              className="mt-1 w-full rounded-xl border border-cream-300 bg-white px-3 py-2 text-charcoal-700 focus:border-tomato-400 focus:outline-none"
            >
              {tts?.voices.map((v) => (
                <option key={v} value={`magpie:${v}`}>
                  {v} (Magpie on the Mac)
                </option>
              ))}
              {ttsSupported && <option value="browser">Browser voice</option>}
              <option value="off">Off, text only</option>
            </select>
          </label>
          <div className="flex items-center justify-between gap-3 text-sm sm:pt-6">
            <span className="font-medium text-charcoal-700">Gusteau answers each phrase</span>
            <Toggle checked={replies} onChange={setReplies} label="Gusteau answers each phrase" />
          </div>
          {phase !== 'idle' && <p className="text-xs text-charcoal-400 sm:col-span-2">Language and phrase timing apply the next time you start.</p>}
        </div>
      </Card>

      <Card className="mt-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>Conversation</SectionTitle>
          <div className="flex gap-1">
            {live && (
              <Button variant="ghost" size="sm" onClick={() => session.current?.commit()} disabled={!partial}>
                Finalize now
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={copy} disabled={!entries.length}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button variant="ghost" size="sm" onClick={clear} disabled={!entries.length}>
              New conversation
            </Button>
          </div>
        </div>
        <div className="mt-3 min-h-[8rem] space-y-4 text-lg leading-relaxed">
          {!entries.length && !partial && <p className="text-charcoal-400">Nothing yet. Try “I’m making a burrito bowl and I’m out of rice. What can I use instead?”</p>}
          {entries.map((e) => (e.role === 'user' ? <HeardLine key={e.id} entry={e} /> : <AnswerBox key={e.id} entry={e} onStop={interrupt} />))}
          {partial && (
            <p className="text-charcoal-400">
              {partial}
              <span className="ml-0.5 inline-block h-5 w-0.5 translate-y-1 animate-pulse bg-tomato-400" aria-hidden />
            </p>
          )}
        </div>
      </Card>

      <details className="mt-4 rounded-3xl border border-cream-200 bg-white/60 px-6 py-4">
        <summary className="cursor-pointer text-sm font-medium text-charcoal-500">Speech recognition events ({events.length})</summary>
        <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed text-charcoal-500">
          {events.length ? events.join('\n') : 'Events appear here once you start.'}
        </pre>
      </details>
    </div>
  );
}

function HeardLine({ entry }: { entry: Heard }) {
  return (
    <div className="animate-rise">
      <p className="text-charcoal-900">{entry.text}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-charcoal-400">
        You · {time(entry.at)}
        {entry.commitMs !== undefined && <span>· final in {entry.commitMs} ms</span>}
        {entry.unconfirmed && <Badge tone="saffron">not finalized by the server</Badge>}
      </p>
    </div>
  );
}

function AnswerBox({ entry, onStop }: { entry: Answer; onStop: () => void }) {
  const active = entry.state === 'thinking' || entry.state === 'speaking';
  const timings = [
    entry.textMs !== undefined && `first words ${seconds(entry.textMs)}`,
    entry.voiceMs !== undefined && `voice ${seconds(entry.voiceMs)}`,
    entry.totalMs !== undefined && `finished ${seconds(entry.totalMs)}`,
  ].filter(Boolean);
  return (
    <div className={cx('ml-4 animate-rise rounded-2xl border p-4 sm:ml-8', entry.state === 'error' ? 'border-tomato-100 bg-tomato-50' : 'border-saffron-100 bg-cream-50')}>
      <div className="flex items-center gap-2 text-xs font-semibold text-charcoal-500">
        <GusteauAvatar size="sm" />
        Gusteau
        {entry.state === 'thinking' && <Badge tone="saffron">{entry.text ? 'answering' : 'thinking'}</Badge>}
        {entry.state === 'speaking' && <Badge tone="olive">speaking</Badge>}
        {entry.state === 'interrupted' && <Badge>interrupted</Badge>}
        {active && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onStop}>
            Stop
          </Button>
        )}
      </div>
      {entry.text ? (
        <p className="mt-2 text-charcoal-900">{entry.text}</p>
      ) : entry.state === 'thinking' ? (
        <p className="mt-2 flex items-center gap-2 text-charcoal-400">
          <Spinner /> Thinking…
        </p>
      ) : null}
      {entry.error && <p className="mt-2 text-sm text-tomato-700">{entry.error}</p>}
      {timings.length > 0 && (
        <p className="mt-2 text-xs text-charcoal-400" title="Measured from when your phrase was finalized">
          {timings.join(' · ')}
        </p>
      )}
    </div>
  );
}

function SpeechStatus({ server }: { server: SpeechServer }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-charcoal-400">Speech</span>
      {server.state === 'checking' && (
        <>
          <Spinner className="text-charcoal-400" />
          <span className="text-charcoal-500">Checking the speech server…</span>
        </>
      )}
      {server.state === 'ok' && (
        <>
          <span className="h-2.5 w-2.5 rounded-full bg-olive-500" aria-hidden />
          <span className="font-mono text-xs text-charcoal-700">{modelName(server.info.model)}</span>
          {server.info.tts && <span className="font-mono text-xs text-charcoal-500">+ {server.info.tts.model}</span>}
          {server.info.device && <Badge tone="olive">{server.info.device}</Badge>}
          {server.info.version && <Badge>NeMo-Speech {server.info.version}</Badge>}
        </>
      )}
      {server.state === 'down' && (
        <>
          <span className="h-2.5 w-2.5 rounded-full bg-tomato-500" aria-hidden />
          <span className="font-medium text-charcoal-700">{server.message}</span>
          <p className="w-full text-charcoal-500">
            The dev server forwards <code className="font-mono text-xs">/api/asr</code> to <code className="font-mono text-xs">ASR_BASE_URL</code>. Set{' '}
            <code className="font-mono text-xs">ASR_SSH_TARGET</code> in <code className="font-mono text-xs">.env.local</code> and{' '}
            <code className="font-mono text-xs">npm run dev</code> keeps the tunnel open, or open one yourself:{' '}
            <code className="font-mono text-xs">ssh -N -L 8080:127.0.0.1:8080 user@mac</code>
          </p>
        </>
      )}
    </div>
  );
}

function LlmStatus({ llm }: { llm: Llm }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4">
      <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-[0.14em] text-charcoal-400">Model</span>
      {llm.state === 'checking' && (
        <>
          <Spinner className="text-charcoal-400" />
          <span className="text-charcoal-500">Checking the text model…</span>
        </>
      )}
      {llm.state === 'off' && (
        <>
          <span className="h-2.5 w-2.5 rounded-full bg-tomato-500" aria-hidden />
          <span className="font-medium text-charcoal-700">No text model configured (mock mode).</span>
          <p className="w-full text-charcoal-500">
            Set <code className="font-mono text-xs">GUSTEAU_PROVIDER=ollama</code>, <code className="font-mono text-xs">LLM_BASE_URL</code> and{' '}
            <code className="font-mono text-xs">LLM_MODEL</code> in <code className="font-mono text-xs">.env.local</code>, then reload.
          </p>
        </>
      )}
      {(llm.state === 'warming' || llm.state === 'ready' || llm.state === 'down') && (
        <>
          {llm.state === 'warming' ? <Spinner className="text-saffron-500" /> : <span className={cx('h-2.5 w-2.5 rounded-full', llm.state === 'ready' ? 'bg-olive-500' : 'bg-tomato-500')} aria-hidden />}
          <span className="font-mono text-xs text-charcoal-700">{llm.llm.model}</span>
          <Badge>{llm.llm.label.split(' · ')[0]}</Badge>
          <span className="text-charcoal-500">
            {llm.state === 'warming' && 'Loading the model on the Mac (about 5 s the first time)…'}
            {llm.state === 'ready' && `Ready · warm-up took ${seconds(llm.loadMs)}`}
            {llm.state === 'down' && llm.message}
          </span>
        </>
      )}
    </div>
  );
}
