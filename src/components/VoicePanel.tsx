import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useDebugLog } from '../debug/debugLog';
import { chime } from '../lib/sound';
import { speakerSelectable, useAudioDevices } from '../voice/audioDevices';
import type { Voice } from '../voice/useVoice';
import { GusteauIcon } from './GusteauIcon';
import { cx } from './ui';

// ─────────────────────────────────────────────────────────────
// Talking with Gusteau, in one place at the top left of every screen:
// one button that starts a conversation and stops it, what he's doing,
// the latest message (or four when expanded), and the mic
// and audio device settings. The mic is only open during a conversation.
// ─────────────────────────────────────────────────────────────

/**
 * Where a conversation with Gusteau is: waiting for his name, listening for
 * the cook to start, hearing their request, or answering it.
 */
export type Turn = 'waiting' | 'open' | 'hearing' | 'answering';

type VoiceStatus = 'idle' | 'off' | 'tap' | 'connecting' | 'speaking' | 'muted' | 'listening' | 'hearing' | 'thinking' | 'waiting';
const STATUS: Record<VoiceStatus, { text: string; dot: string }> = {
  idle: { text: 'Not listening · tap Talk to Gusteau to start', dot: 'bg-charcoal-400' },
  off: { text: 'Voice unavailable · tap Talk to Gusteau to retry', dot: 'bg-tomato-500' },
  tap: { text: 'Tap anywhere to turn on voice', dot: 'bg-tomato-500 animate-pulse' },
  connecting: { text: 'Starting the mic…', dot: 'bg-saffron-400 animate-pulse' },
  speaking: { text: 'Speaking', dot: 'bg-saffron-400 animate-pulse' },
  muted: { text: 'Muted · not listening, not even for “Hey Chef”', dot: 'bg-charcoal-400' },
  listening: { text: 'Listening… go ahead', dot: 'bg-olive-500 animate-pulse' },
  hearing: { text: 'Hearing you… take your time', dot: 'bg-olive-500 animate-pulse' },
  thinking: { text: 'Thinking…', dot: 'bg-saffron-400 animate-pulse' },
  waiting: { text: 'Not listening · tap Talk to Gusteau to start', dot: 'bg-charcoal-400' },
};

const pageTouched = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;

function voiceStatus(voice: Voice, turn: Turn): VoiceStatus {
  // The mic is only open during a conversation; between conversations nothing is heard.
  if (!voice.handsFree) return voice.talking ? 'speaking' : voice.notice ? 'off' : 'idle';
  // Browsers only open the mic and speaker after the first tap or key press on the page.
  if (voice.state === 'connecting') return pageTouched() ? 'connecting' : 'tap';
  if (voice.talking || voice.state === 'paused-for-speech') return 'speaking';
  if (voice.micMuted) return 'muted';
  return turn === 'open' ? 'listening' : turn === 'hearing' ? 'hearing' : turn === 'answering' ? 'thinking' : 'waiting';
}

/** A conversation is going on (or starting): the button is Stop. Him talking can always be stopped too. */
const IN_CONVERSATION: VoiceStatus[] = ['connecting', 'listening', 'hearing', 'thinking', 'speaking', 'muted'];

export function VoicePanel({
  voice,
  turn,
  interpreted = '',
  onTalk,
  onStop,
  compact = false,
  className,
}: {
  voice: Voice;
  turn: Turn;
  /** How Gusteau understood the cook's last request, when that differs in meaning from what was heard. */
  interpreted?: string;
  /** Start a conversation: voice on if it isn't, then he greets the cook and listens. */
  onTalk: () => void;
  /** End the conversation: he stops talking and the mic closes. */
  onStop: () => void;
  /** Tighter spacing for the top of the recipe preview. */
  compact?: boolean;
  className?: string;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const conversationId = useId();
  // Redraw on the page's first tap or key press, when "tap anywhere" no longer applies.
  const [, touched] = useState(pageTouched());
  useEffect(() => {
    if (pageTouched()) return;
    const done = () => touched(true);
    window.addEventListener('pointerdown', done, { once: true });
    window.addEventListener('keydown', done, { once: true });
    return () => {
      window.removeEventListener('pointerdown', done);
      window.removeEventListener('keydown', done);
    };
  }, []);
  const { heard } = useDebugLog();
  if (!voice.supported) return null;
  const status = voiceStatus(voice, turn);
  const active = IN_CONVERSATION.includes(status);
  const live = (turn === 'open' || turn === 'hearing') && !voice.micMuted ? voice.interim.trim() : '';
  // What was said: everything Gusteau said, and what the cook said to him (not chatter he ignored).
  const conversation = heard.filter((h) => h.who === 'gusteau' || !h.note?.startsWith('ignored'));
  // The live transcript occupies one slot in the visible message count.
  const historySlots = (collapsed ? 1 : 4) - (live ? 1 : 0);
  const lines = historySlots ? conversation.slice(-historySlots).reverse() : [];
  const lastCook = lines.findIndex((l) => l.who === 'cook');

  return (
    <section aria-label="Talk to Gusteau" className={cx('relative z-20 rounded-3xl border border-cream-200 bg-white/85 p-4 shadow-card backdrop-blur', !compact && 'sm:p-5', className)}>
      <div className="flex flex-wrap items-center gap-3">
        <GusteauIcon
          size={44}
          state={
            status === 'speaking'
              ? 'speaking'
              : status === 'listening' || status === 'hearing' || status === 'thinking' || status === 'connecting'
                ? 'listening'
                : status === 'muted' || status === 'off'
                  ? 'muted'
                  : 'idle'
          }
          level={voice.level}
          style={active && voice.level ? { transform: `scale(${1 + voice.level * 0.2})` } : undefined}
          className="transition-transform"
        />
        <div className="min-w-0 flex-1 basis-40">
          <p className="font-display text-lg font-semibold leading-tight text-charcoal-900">Gusteau</p>
          <p className="flex items-center gap-1.5 text-xs text-charcoal-500" aria-live="polite">
            <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', STATUS[status].dot)} aria-hidden />
            <span className="truncate">{STATUS[status].text}</span>
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={active ? onStop : onTalk}
            aria-pressed={active}
            className={cx(
              'inline-flex min-h-[44px] items-center gap-2 rounded-full px-5 text-sm font-semibold text-white shadow-lift transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100',
              active ? 'bg-charcoal-900 hover:bg-charcoal-700' : 'bg-tomato-500 hover:bg-tomato-600',
            )}
          >
            {active ? <span aria-hidden className="h-2.5 w-2.5 rounded-sm bg-white" /> : <span aria-hidden>🎤</span>}
            {active ? 'Stop' : 'Talk to Gusteau'}
          </button>
          {voice.handsFree && (
            <button
              type="button"
              onClick={() => voice.setMicMuted(!voice.micMuted)}
              aria-pressed={voice.micMuted}
              aria-label={voice.micMuted ? 'Unmute the mic' : 'Mute the mic'}
              title={voice.micMuted ? 'Unmute: Gusteau listens again' : 'Mute: Gusteau stops listening, even for “Hey Chef”, until you unmute'}
              className={cx(
                'flex h-11 w-11 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100',
                voice.micMuted ? 'bg-charcoal-900 text-white hover:bg-charcoal-700' : 'border border-cream-300 bg-white text-charcoal-700 hover:bg-cream-100',
              )}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                {voice.micMuted && <path d="M4 4l16 16" />}
              </svg>
            </button>
          )}
          <AudioDevicesButton voice={voice} />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-expanded={!collapsed}
            aria-controls={conversationId}
            aria-label={collapsed ? 'Expand voice conversation' : 'Collapse voice conversation'}
            title={collapsed ? 'Show last four messages' : 'Show latest message only'}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-cream-300 bg-white text-charcoal-700 hover:bg-cream-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cx('transition-transform', collapsed && 'rotate-180')}>
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
        </span>
      </div>

      {/* Collapsed shows one message; expanded shows four, newest first. */}
      <ol id={conversationId} className="mt-3 space-y-2 border-t border-cream-200 pt-3" aria-live="polite" aria-label="Latest conversation messages">
        {lines.length === 0 && !live && <li className="text-sm text-charcoal-500">Tap “Talk to Gusteau”, then tell him what you’re in the mood for. He only listens while you’re talking with him.</li>}
        {live && (
          <li className="pl-7 text-xs italic text-charcoal-500">
            <span className="font-semibold not-italic">You:</span> “{live}”…
          </li>
        )}
        {lines.map((l, i) =>
          l.who === 'gusteau' ? (
            <li key={l.at + l.text} className="flex gap-2">
              <GusteauIcon size={20} className="mt-0.5" />
              <p className="min-w-0 text-[15px] font-medium leading-snug text-charcoal-900">{l.text}</p>
            </li>
          ) : (
            <li key={l.at + l.text} className="pl-7 text-xs text-charcoal-400">
              <span className="font-semibold">You:</span> “{l.text}”
              {i === lastCook && interpreted && <span className="block italic">Interpreted as “{interpreted}”</span>}
            </li>
          ),
        )}
      </ol>

      {voice.notice && (
        <p className="mt-2 flex items-center gap-2 text-xs text-tomato-700">
          <span className="min-w-0 flex-1">{voice.notice}</span>
          <button onClick={voice.clearNotice} className="shrink-0 font-semibold underline-offset-2 hover:underline">
            Dismiss
          </button>
        </p>
      )}
    </section>
  );
}

/**
 * Pick the microphone Gusteau listens with and the speaker he talks through.
 * The mic level shows the chosen mic is the one hearing you; "Test" plays
 * the listening chime on the chosen speaker.
 */
function AudioDevicesButton({ voice }: { voice: Voice }) {
  const [open, setOpen] = useState(false);
  const [menuLeft, setMenuLeft] = useState(0);
  const devices = useAudioDevices();
  const box = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      if (!box.current || !menu.current) return;
      const anchor = box.current.getBoundingClientRect();
      const width = menu.current.getBoundingClientRect().width;
      // Open to the right, shifting left only enough to fit inside the viewport.
      setMenuLeft(Math.max(16 - anchor.left, Math.min(0, window.innerWidth - 16 - anchor.left - width)));
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    // Names and newly plugged-in devices show up once the mic is allowed, so look again on opening.
    void devices.refresh();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const browserEars = voice.engine === 'browser';
  const browserVoice = !/Magpie/.test(voice.label);
  const select = 'mt-1 w-full rounded-xl border border-cream-300 bg-white px-2 py-1.5 text-sm text-charcoal-900 focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100';
  return (
    <span ref={box} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Audio devices"
        title="Choose the microphone and speaker"
        className={cx(
          'flex h-11 w-11 items-center justify-center rounded-full border border-cream-300 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100',
          open ? 'bg-cream-200 text-charcoal-900' : 'bg-white text-charcoal-700 hover:bg-cream-100',
        )}
      >
        {/* Sliders */}
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      </button>
      {open && (
        <span
          ref={menu}
          role="dialog"
          aria-label="Audio devices"
          style={{ left: menuLeft }}
          className={cx(
            'absolute z-[70] block w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-cream-200 bg-white p-4 text-left text-charcoal-700 shadow-card',
            'top-full mt-2',
          )}
        >
          <span className="block text-sm font-semibold text-charcoal-900">Audio devices</span>
          <label className="mt-3 block text-xs font-semibold">
            Microphone
            <select
              className={select}
              value={devices.micId}
              disabled={browserEars}
              onChange={(e) => {
                devices.setMic(e.target.value);
                void voice.reopenMic();
              }}
            >
              <option value="">System default</option>
              {devices.mics.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          {/* The mic level, so it's clear which mic is hearing you. */}
          <span className="mt-1.5 flex items-center gap-2 text-[11px] text-charcoal-500" aria-hidden>
            Level
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-cream-200">
              <span className="block h-full rounded-full bg-olive-500 transition-[width] duration-100" style={{ width: `${Math.round((voice.micMuted ? 0 : voice.level) * 100)}%` }} />
            </span>
          </span>
          {browserEars && <span className="mt-1 block text-[11px] text-charcoal-500">The browser’s speech recognition always uses the system’s default microphone.</span>}
          <label className="mt-3 block text-xs font-semibold">
            Speaker
            <span className="mt-1 flex gap-1.5">
              <select className={cx(select, 'mt-0 min-w-0 flex-1')} value={devices.speakerId} disabled={!speakerSelectable} onChange={(e) => devices.setSpeaker(e.target.value)}>
                <option value="">System default</option>
                {devices.speakers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => chime()} className="shrink-0 rounded-xl border border-cream-300 bg-white px-2.5 text-xs font-semibold hover:bg-cream-100">
                Test
              </button>
            </span>
          </label>
          {!speakerSelectable && <span className="mt-1 block text-[11px] text-charcoal-500">This browser always plays sound on the system’s default speaker. Chrome and Edge can choose one.</span>}
          {speakerSelectable && browserVoice && <span className="mt-1 block text-[11px] text-charcoal-500">Gusteau is using the browser’s voice right now, which always plays on the system’s default speaker.</span>}
          {!devices.named && <span className="mt-2 block text-[11px] text-charcoal-500">Device names appear once Gusteau is allowed to use the microphone.</span>}
        </span>
      )}
    </span>
  );
}
