import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDebugLog } from '../debug/debugLog';
import type { Cook } from '../state/useCook';
import { GusteauIcon } from './GusteauIcon';
import { cx, Spinner } from './ui';

/** One persistent composer, above page sheets so it also works in recipe previews. */
export function TextChat({ host, onSend, cook, busy, context }: {
  host: HTMLElement | null;
  onSend(text: string): Promise<void>;
  cook: Cook | null;
  busy: boolean;
  context?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const wasExpanded = useRef(false);
  const scroller = useRef<HTMLDivElement>(null);
  const { heard } = useDebugLog();
  const messages = cook?.session
    ? [
        ...cook.session.chat.map((m) => ({ key: m.id, user: m.from === 'user', text: m.text })),
        ...(cook.pending ? [{ key: 'pending-user', user: true, text: cook.pending.text }] : []),
        ...(cook.pending?.reply ? [{ key: 'pending-reply', user: false, text: cook.pending.reply }] : []),
      ]
    : heard.filter((m) => !m.note?.startsWith('ignored')).map((m, i) => ({ key: `${m.at}-${i}`, user: m.who === 'cook', text: m.text }));
  const last = messages[messages.length - 1];
  const working = busy || sending;

  useEffect(() => {
    if (expanded && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [expanded, messages.length, last?.text, working]);

  useEffect(() => {
    if (expanded) input.current?.focus();
    else if (wasExpanded.current) launcher.current?.focus();
    wasExpanded.current = expanded;
  }, [expanded]);

  const send = async () => {
    const message = text.trim();
    if (!message || working || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setExpanded(true);
    setError('');
    setText('');
    try {
      await onSend(message);
    } catch {
      setText(message);
      setError('That message could not be sent. Please try again.');
    } finally {
      inFlight.current = false;
      setSending(false);
      input.current?.focus();
    }
  };

  // Keep chat inside an open dialog's accessible tree, while preserving its draft and state.
  return createPortal(
    <aside aria-label="Chat with Gusteau" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => {
      if (e.key === 'Escape' && expanded) {
        e.stopPropagation();
        setExpanded(false);
      }
    }} className={cx('fixed bottom-3 right-3 z-[70] sm:bottom-5 sm:right-5', expanded && 'w-[calc(100%-1.5rem)] max-w-sm overflow-hidden rounded-3xl border border-cream-300 bg-cream-50 shadow-lift')}>
      {!expanded ? (
        <button ref={launcher} type="button" onClick={() => setExpanded(true)} aria-label="Open chat with Gusteau" aria-expanded={false} title="Chat with Gusteau" className="flex h-14 w-14 items-center justify-center rounded-full bg-tomato-500 text-white shadow-lift transition-colors hover:bg-tomato-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tomato-500">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
            <path d="M8 11h.01M12 11h.01M16 11h.01" strokeWidth="3" />
          </svg>
        </button>
      ) : <>
      <button type="button" onClick={() => setExpanded(false)} aria-expanded={true} aria-controls="gusteau-text-messages" aria-label="Minimize chat with Gusteau" className="flex w-full items-center gap-2.5 px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-tomato-500">
        <GusteauIcon size={28} />
        <span className="min-w-0 flex-1">
          <span className="block font-display font-semibold text-charcoal-900">Chat with Gusteau</span>
          <span className="block truncate text-xs text-charcoal-500">{context ?? 'Find a dish or ask a cooking question'}</span>
        </span>
        <span className="text-xs font-semibold text-olive-700">Minimize</span>
      </button>
      <div id="gusteau-text-messages" hidden={!expanded}>
        <div ref={scroller} role="log" aria-label="Gusteau chat messages" aria-live="polite" aria-relevant="additions text" className="max-h-[min(40dvh,320px)] space-y-3 overflow-y-auto overscroll-contain border-t border-cream-200 px-4 py-3">
          {!messages.length && <p className="text-sm leading-relaxed text-charcoal-500">Hi! Tell me what you’re craving, ask about a recipe, or tell me what ingredients you’re missing.</p>}
          {messages.slice(-60).map((m) => (
            <div key={m.key} className={cx('flex', m.user && 'justify-end')}>
              <div className={cx('max-w-[90%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm leading-relaxed', m.user ? 'rounded-br-md bg-charcoal-900 text-white' : 'rounded-bl-md bg-white text-charcoal-700')}>
                <span className="mb-0.5 block text-[10px] font-semibold opacity-60">{m.user ? 'You' : 'Gusteau'}</span>
                {m.text}
              </div>
            </div>
          ))}
          {working && <p role="status" className="flex items-center gap-2 text-xs text-charcoal-500"><Spinner /> Gusteau is thinking…</p>}
        </div>
      </div>
      {error && <p role="alert" className="px-4 pb-2 text-xs text-tomato-600">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex gap-2 border-t border-cream-200 p-3">
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} aria-label="Type a message to Gusteau" placeholder="Type to Gusteau…" autoComplete="off" enterKeyHint="send" className="min-w-0 flex-1 rounded-full border border-cream-300 bg-white px-3 py-2.5 text-base text-charcoal-900 outline-none focus:border-tomato-500 sm:text-sm" />
        <button type="submit" disabled={working || !text.trim()} className="rounded-full bg-tomato-500 px-4 text-sm font-semibold text-white hover:bg-tomato-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tomato-500 disabled:opacity-40">Send</button>
      </form>
      </>}
    </aside>,
    host ?? document.body,
  );
}
