import { useEffect, useRef, useState } from 'react';
import { spellOutSpoons } from '../../data/ingredients';
import { techniqueById, techniqueQuery } from '../../data/techniques';
import type { Cook } from '../../state/useCook';
import { Card, GusteauAvatar, Spinner, cx } from '../ui';

export function ChatPanel({ cook, onMic, micActive, micSupported, interim }: { cook: Cook; onMic: () => void; micActive: boolean; micSupported: boolean; interim?: string }) {
  const s = cook.session!;
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [s.chat.length, cook.busy]);

  const has = (word: RegExp) => s.recipe.ingredients.find((i) => word.test(i.name.toLowerCase()));
  const rice = has(/\brice\b/);
  const firstEssential = s.recipe.ingredients.find((i) => !i.optional);
  const suggestions = [
    rice ? 'Actually, I don’t have rice.' : firstEssential && `I’m out of ${firstEssential.name.toLowerCase()}`,
    'What’s next?',
    'Set a 5 minute timer',
    'How do I know when it’s done?',
    'I only have 5 minutes',
    'I’m cooking for 4',
  ].filter(Boolean) as string[];

  const send = (t: string) => {
    if (!t.trim() || cook.busy) return;
    void cook.sendChat(t.trim());
    setText('');
  };

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-cream-200 px-5 py-3.5">
        <GusteauAvatar size="sm" />
        <div>
          <p className="font-display font-semibold text-charcoal-900">Talk to Gusteau</p>
          <p className="text-xs text-charcoal-400">Ask anything, or tell me what changed. I’ll replan the rest.</p>
        </div>
      </div>
      <div ref={scroller} className="max-h-[360px] min-h-[180px] flex-1 space-y-3 overflow-y-auto bg-cream-50/60 px-4 py-4" aria-live="polite">
        {s.chat.map((m) => {
          const tech = techniqueById(m.techniqueId);
          return (
            <div key={m.id} className={cx('flex gap-2', m.from === 'user' && 'justify-end')}>
              {m.from === 'gusteau' && <GusteauAvatar size="sm" />}
              <div className={cx('max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed', m.from === 'user' ? 'rounded-br-md bg-charcoal-900 text-white' : 'rounded-tl-md bg-white text-charcoal-700 shadow-sm')}>
                {m.diffId && <span className="mb-1 block text-[10px] font-bold uppercase tracking-wider text-saffron-500">✨ Plan updated</span>}
                {spellOutSpoons(m.text)}
                {m.videoQuery && !tech && (
                  <button onClick={() => cook.showVideos(m.videoQuery!)} className="mt-1.5 block text-xs font-semibold text-olive-500 hover:text-olive-700">
                    ▶ Show videos: how to {m.videoQuery}
                  </button>
                )}
                {m.explainTerm && (
                  <button onClick={() => cook.showPictures(m.explainTerm!)} className="mt-1.5 block text-xs font-semibold text-olive-500 hover:text-olive-700">
                    🖼 Show pictures of {m.explainTerm}
                  </button>
                )}
                {tech && (
                  <button onClick={() => cook.showVideos(techniqueQuery(tech), tech.howTo)} className="mt-1.5 block text-xs font-semibold text-olive-500 hover:text-olive-700">
                    🎬 Show me: {tech.title.toLowerCase()}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {cook.busy && cook.busy !== 'starting' && (
          <div className="flex items-center gap-2 text-sm text-charcoal-500">
            <GusteauAvatar size="sm" />
            <span className="flex items-center gap-2 rounded-2xl bg-white px-3.5 py-2.5 shadow-sm">
              <Spinner className="text-tomato-500" /> {cook.busy === 'replanning' ? 'Replanning the rest of your meal…' : 'Thinking…'}
            </span>
          </div>
        )}
      </div>
      <div className="border-t border-cream-200 p-3">
        {micActive && <p className="mb-2 truncate rounded-full bg-tomato-50 px-3 py-1.5 text-xs italic text-tomato-700">{interim ? `“${interim}”` : 'Listening… tap the mic again when you’re done'}</p>}
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {suggestions.map((q) => (
            <button
              key={q}
              onClick={() => send(q)}
              disabled={!!cook.busy}
              className="shrink-0 rounded-full border border-cream-300 bg-white px-3 py-1 text-xs font-medium text-charcoal-500 hover:border-tomato-400 hover:text-tomato-600 disabled:opacity-50"
            >
              {q}
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
          {micSupported && (
            <button
              type="button"
              onClick={onMic}
              aria-label={micActive ? 'Stop listening' : 'Speak to Gusteau'}
              aria-pressed={micActive}
              className={cx('flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg transition-colors', micActive ? 'animate-pulse bg-tomato-500 text-white' : 'bg-cream-200 hover:bg-cream-300')}
            >
              🎤
            </button>
          )}
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. “Actually, I don’t have rice.”"
            aria-label="Message Gusteau"
            className="min-w-0 flex-1 rounded-full border border-cream-300 bg-cream-50 px-4 py-2.5 text-sm outline-none focus:border-tomato-400"
          />
          <button type="submit" disabled={!!cook.busy || !text.trim()} className="rounded-full bg-tomato-500 px-4 text-sm font-semibold text-white hover:bg-tomato-600 disabled:opacity-40">
            Send
          </button>
        </form>
      </div>
    </Card>
  );
}
