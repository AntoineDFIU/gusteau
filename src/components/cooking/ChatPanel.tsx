import { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../../types';
import { Card, GusteauAvatar, Spinner, cx } from '../ui';

export function ChatPanel({
  state,
  busy,
  onSend,
}: {
  state: SessionState;
  busy: null | 'thinking' | 'replanning';
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [state.chat.length, busy]);

  const r = state.recipe;
  const suggestions = [
    r?.ingredients.some((i) => i.key === 'rice') && 'Actually, I don’t have rice.',
    r?.ingredients.some((i) => i.key === 'cheese') && 'I’m out of cheese',
    'How do I know when it’s done?',
    'I’m allergic to dairy',
    'I found an avocado',
  ].filter(Boolean) as string[];

  const send = (t: string) => {
    if (!t.trim() || busy) return;
    onSend(t.trim());
    setText('');
  };

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-cream-200 px-5 py-3.5">
        <GusteauAvatar size="sm" />
        <div>
          <p className="font-display font-semibold text-charcoal-900">Chat with Gusteau</p>
          <p className="text-xs text-charcoal-400">Tell me what changed. I’ll replan the rest.</p>
        </div>
      </div>
      <div ref={scroller} className="max-h-[360px] min-h-[200px] flex-1 space-y-3 overflow-y-auto bg-cream-50/60 px-4 py-4">
        {state.chat.map((m) => (
          <div key={m.id} className={cx('flex gap-2', m.from === 'user' && 'justify-end')}>
            {m.from === 'gusteau' && <GusteauAvatar size="sm" />}
            <div
              className={cx(
                'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                m.from === 'user' ? 'rounded-br-md bg-charcoal-900 text-white' : 'rounded-tl-md bg-white text-charcoal-700 shadow-sm',
              )}
            >
              {m.diffId && <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-saffron-500">✨ Plan updated</span>}
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-charcoal-500">
            <GusteauAvatar size="sm" />
            <span className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 shadow-sm">
              <Spinner className="text-tomato-500" /> {busy === 'replanning' ? 'Replanning the rest of your meal…' : 'Thinking…'}
            </span>
          </div>
        )}
      </div>
      <div className="border-t border-cream-200 p-3">
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              disabled={!!busy}
              className="shrink-0 rounded-full border border-cream-300 bg-white px-3 py-1 text-xs font-medium text-charcoal-500 hover:border-tomato-400 hover:text-tomato-600 disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex gap-2"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. “Actually, I don’t have rice.”"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-cream-50 px-4 py-2.5 text-sm outline-none focus:border-tomato-400"
          />
          <button
            type="submit"
            disabled={!!busy || !text.trim()}
            className="rounded-full bg-tomato-500 px-4 text-sm font-semibold text-white hover:bg-tomato-600 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </Card>
  );
}
