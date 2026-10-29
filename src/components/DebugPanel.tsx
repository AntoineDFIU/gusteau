import { useEffect, useRef, type ReactNode } from 'react';
import { clearLog, useDebugLog, type LlmExchange } from '../debug/debugLog';
import { cx } from './ui';

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const text = (content: unknown) => (typeof content === 'string' ? content : JSON.stringify(content, null, 2));

/**
 * The debug view: what was heard and said, what went to the model, and what
 * came back, side by side. Newest at the bottom of each box.
 */
export function DebugPanel() {
  const { heard, exchanges } = useDebugLog();
  return (
    <section aria-label="Debug" className="border-b border-cream-200 bg-charcoal-900 px-4 py-3 text-[11px] text-cream-100 sm:px-6">
      <div className="mx-auto grid max-w-7xl gap-3 lg:grid-cols-3">
        <Box title="Transcription history" count={heard.length} onClear={() => clearLog('heard')} follow={heard.length}>
          {heard.length ? (
            heard.map((h, i) => (
              <div key={i} className="border-b border-white/10 py-1.5 last:border-0">
                <span className="text-white/40">{time(h.at)} </span>
                <span className={cx('font-semibold', h.who === 'cook' ? 'text-saffron-400' : 'text-olive-400')}>{h.who === 'cook' ? 'Heard' : 'Gusteau'}: </span>
                <span className="whitespace-pre-wrap">{h.text}</span>
                {h.note && <span className="block text-white/45">↳ {h.note}</span>}
              </div>
            ))
          ) : (
            <Empty>Nothing heard yet. Say “Hey Chef”.</Empty>
          )}
        </Box>
        <Box title="Sent to the LLM" count={exchanges.length} onClear={() => clearLog('llm')} follow={exchanges.length}>
          {exchanges.length ? exchanges.map((x) => <Request key={x.id} x={x} />) : <Empty>No model requests yet.</Empty>}
        </Box>
        <Box title="LLM responses" count={exchanges.length} onClear={() => clearLog('llm')} follow={exchanges.map((x) => x.response.length).join()}>
          {exchanges.length ? exchanges.map((x) => <Response key={x.id} x={x} />) : <Empty>No model responses yet.</Empty>}
        </Box>
      </div>
    </section>
  );
}

function Box({ title, count, onClear, follow, children }: { title: string; count: number; onClear: () => void; follow: unknown; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null);
  // Keep the newest entry in view, unless the reader scrolled up to look at something.
  const pinned = useRef(true);
  useEffect(() => {
    const el = body.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [follow]);
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-white/10 bg-black/30">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
        <span className="font-semibold uppercase tracking-wider text-white/70">
          {title} <span className="text-white/35">· {count}</span>
        </span>
        <button onClick={onClear} className="rounded px-1.5 py-0.5 text-white/50 hover:bg-white/10 hover:text-white">
          Clear
        </button>
      </div>
      <div
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="h-64 overflow-y-auto px-3 py-1 font-mono leading-relaxed"
      >
        {children}
      </div>
    </div>
  );
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-2 text-white/40">{children}</p>;

const Head = ({ x }: { x: LlmExchange }) => (
  <span className="text-white/40">
    {time(x.at)} <span className="font-semibold text-saffron-400">#{x.id} {x.purpose}</span> · {x.model}
  </span>
);

function Request({ x }: { x: LlmExchange }) {
  return (
    <details className="border-b border-white/10 py-1.5 last:border-0">
      <summary className="cursor-pointer">
        <Head x={x} />
        <span className="block truncate text-white/70">{text(x.messages[x.messages.length - 1]?.content).slice(0, 160)}</span>
      </summary>
      <div className="mt-1 space-y-1.5">
        {x.messages.map((m, i) => (
          <div key={i}>
            <span className="font-semibold text-olive-400">{m.role}</span>
            <pre className="whitespace-pre-wrap break-words text-white/85">{text(m.content)}</pre>
          </div>
        ))}
        <pre className="whitespace-pre-wrap break-words text-white/40">{JSON.stringify(x.params)}</pre>
      </div>
    </details>
  );
}

function Response({ x }: { x: LlmExchange }) {
  return (
    <div className="border-b border-white/10 py-1.5 last:border-0">
      <Head x={x} />
      <span className="text-white/40">{x.done ? ` · ${((x.ms ?? 0) / 1000).toFixed(1)} s` : ' · streaming…'}</span>
      {x.error ? <pre className="whitespace-pre-wrap break-words text-tomato-400">Error: {x.error}</pre> : <pre className="whitespace-pre-wrap break-words text-white/85">{x.response || (x.done ? '(empty)' : '…')}</pre>}
    </div>
  );
}
