import { useEffect, useRef, useState } from 'react';
import { chime } from '../lib/sound';
import { speakerSelectable, useAudioDevices } from '../voice/audioDevices';
import type { Voice } from '../voice/useVoice';
import { cx } from './ui';

/** The one label, the same everywhere: you can always do either. */
export const VOICE_LABEL = 'Say “Hey Chef” or Tap Here!';

/**
 * Where a conversation with Gusteau is: waiting for his name, listening for
 * the cook to start (five seconds), hearing their request, or answering it.
 */
export type Turn = 'waiting' | 'open' | 'hearing' | 'answering';

/** The Start / Stop listening button: whether listening is on, and what a press does. */
export interface Power {
  on: boolean;
  toggle(): void;
}

type VoiceStatus = 'stopped' | 'off' | 'tap' | 'connecting' | 'speaking' | 'paused' | 'listening' | 'hearing' | 'thinking' | 'waiting';
const STATUS: Record<VoiceStatus, { text: string; dot: string }> = {
  stopped: { text: 'Listening is off · tap to start', dot: 'bg-charcoal-400' },
  // Voice is always on; "off" only happens when nothing can listen (no speech server and no browser speech).
  off: { text: 'Voice unavailable · tap to retry', dot: 'bg-white/70' },
  tap: { text: 'Tap anywhere to start voice', dot: 'bg-white animate-pulse' },
  connecting: { text: 'Starting the mic…', dot: 'bg-saffron-400 animate-pulse' },
  speaking: { text: 'Gusteau is speaking · tap to interrupt', dot: 'bg-saffron-400 animate-pulse' },
  paused: { text: 'Muted · not listening · tap to unmute', dot: 'bg-charcoal-400' },
  listening: { text: 'Listening… go ahead', dot: 'bg-white animate-pulse' },
  hearing: { text: 'Hearing you… take your time', dot: 'bg-white animate-pulse' },
  thinking: { text: 'One moment…', dot: 'bg-saffron-400 animate-pulse' },
  waiting: { text: 'Waiting for “Hey Chef” or “Hey Gusteau”', dot: 'bg-white' },
};

const pageTouched = () => (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive ?? true;

export function voiceStatus(voice: Voice, turn: Turn, power?: Power): VoiceStatus {
  if (power && !power.on) return 'stopped';
  // Not on yet: still starting, unless starting failed (then there's a notice saying why).
  if (!voice.handsFree) return voice.notice ? 'off' : 'connecting';
  // Browsers only open the mic and speaker after the first tap or key press on the page.
  if (voice.state === 'connecting') return pageTouched() ? 'connecting' : 'tap';
  if (voice.talking || voice.state === 'paused-for-speech') return 'speaking';
  if (voice.micMuted) return 'paused';
  return turn === 'open' ? 'listening' : turn === 'hearing' ? 'hearing' : turn === 'answering' ? 'thinking' : 'waiting';
}

/**
 * The voice control, the same on every screen: one button that always says
 * "Say “Hey Chef” or Tap Here!", with what Gusteau is doing underneath, plus
 * Mute / Unmute. Voice is always on. A tap always means "I want to talk":
 * it wakes him, resumes, or interrupts him (and finishes starting voice on a
 * fresh page, where the browser waits for a first tap).
 */
export function VoiceControl({
  voice,
  turn,
  onTap,
  power,
  className,
  menu = 'down',
}: {
  voice: Voice;
  turn: Turn;
  onTap: () => void;
  power?: Power;
  className?: string;
  /** Which way the audio devices panel opens. */
  menu?: 'up' | 'down';
}) {
  // Redraw on the page's first tap or key press, when "tap once to hear him" no longer applies.
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
  const status = voiceStatus(voice, turn, power);
  const { dot } = STATUS[status];
  // Listening can start before the page is touched, but his voice can't play until it is.
  const text = (status === 'waiting' || status === 'listening' || status === 'hearing') && !pageTouched() ? `${STATUS[status].text} · tap once to hear him` : STATUS[status].text;
  const live = status === 'listening' || status === 'hearing';
  return (
    // On a narrow phone the buttons wrap onto their own row, so the label is never squeezed.
    <div className={cx('flex min-w-0 flex-wrap items-center justify-end gap-2 sm:flex-nowrap', className)}>
      <button
        onClick={onTap}
        data-handsfree
        aria-label={`${VOICE_LABEL} ${text}`}
        title={voice.label}
        className={cx(
          'relative flex min-w-0 flex-1 basis-[15.5rem] items-center sm:basis-auto gap-2.5 rounded-full py-2 pl-2 pr-4 text-left text-white shadow-lift transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 active:scale-[.99] sm:flex-none',
          status === 'stopped' ? 'bg-charcoal-500 hover:bg-charcoal-700' : status === 'off' || status === 'tap' ? 'bg-tomato-500 hover:bg-tomato-600' : live ? 'bg-olive-500 hover:bg-olive-700' : 'bg-charcoal-900 hover:bg-charcoal-700',
        )}
      >
        {/* The mic badge grows with your voice while he's listening. */}
        <span
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white transition-transform"
          style={live && voice.level ? { transform: `scale(${1 + voice.level * 0.35})` } : undefined}
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className={cx('h-5 w-5', status === 'off' || status === 'tap' ? 'text-tomato-500' : live ? 'text-olive-500' : 'text-charcoal-900')} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
            {status === 'paused' && <path d="M4 4l16 16" />}
          </svg>
        </span>
        <span className="min-w-0 leading-tight">
          {/* The label is never cut off: it's the one thing that must always show. */}
          <span className="block whitespace-nowrap text-[13px] font-bold sm:text-sm">{VOICE_LABEL}</span>
          <span className="flex items-center gap-1.5 text-[11px] font-medium text-white/85">
            <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', dot)} aria-hidden />
            <span className="truncate">{text}</span>
          </span>
        </span>
      </button>
      {(voice.handsFree || power) && (
        <span className="flex shrink-0 items-center gap-1">
          {power && (
            <button
              onClick={power.toggle}
              data-handsfree
              aria-pressed={power.on}
              aria-label={power.on ? 'Stop listening' : 'Start listening'}
              title={power.on ? 'Stop: Gusteau stops listening, even for “Hey Chef”, until you start him again' : 'Start: Gusteau starts listening and talks to you'}
              className={cx(
                'flex h-10 w-10 items-center justify-center gap-1 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 sm:w-auto sm:px-3',
                power.on ? 'border border-cream-300 bg-white text-charcoal-700 hover:bg-cream-100' : 'bg-olive-500 text-white hover:bg-olive-700',
              )}
            >
              {/* Power */}
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                <path d="M12 3v8M7.05 6.05a7 7 0 1 0 9.9 0" />
              </svg>
              <span className="hidden sm:inline">{power.on ? 'Stop' : 'Start'}</span>
            </button>
          )}
          {voice.handsFree && (
          <button
            onClick={() => voice.setMicMuted(!voice.micMuted)}
            data-handsfree
            aria-pressed={voice.micMuted}
            aria-label={voice.micMuted ? 'Unmute the mic' : 'Mute the mic'}
            title={voice.micMuted ? 'Unmute: Gusteau listens again' : 'Mute: Gusteau stops listening, even for “Hey Chef”, until you unmute'}
            className={cx(
              'flex h-10 w-10 items-center justify-center gap-1 rounded-full text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 sm:w-auto sm:px-3',
              voice.micMuted ? 'bg-charcoal-900 text-white hover:bg-charcoal-700' : 'border border-cream-300 bg-white text-charcoal-700 hover:bg-cream-100',
            )}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
              {voice.micMuted && <path d="M4 4l16 16" />}
            </svg>
            <span className="hidden sm:inline">{voice.micMuted ? 'Unmute' : 'Mute'}</span>
          </button>
          )}
          <AudioDevicesButton voice={voice} up={menu === 'up'} />
        </span>
      )}
    </div>
  );
}

/**
 * Hands-free outside the kitchen: a dock at the bottom of the screen with
 * the switch, what Gusteau heard and what he said last.
 */
export function VoiceDock({
  voice,
  turn,
  heard,
  interpreted = '',
  said,
  onTap,
  power,
}: {
  voice: Voice;
  turn: Turn;
  /** The cook's last request. */
  heard: string;
  /** How Gusteau understood it, when that differs in meaning from what was heard. */
  interpreted?: string;
  /** Gusteau's last answer. */
  said: string;
  onTap: () => void;
  power?: Power;
}) {
  if (!voice.supported) return null;
  const live = voice.handsFree && voice.interim;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
      <div className="pointer-events-auto flex w-full max-w-3xl animate-pop flex-col gap-2 rounded-[28px] border border-cream-200 bg-white/95 p-2 shadow-card backdrop-blur sm:flex-row sm:items-center">
        <VoiceControl voice={voice} turn={turn} onTap={onTap} power={power} menu="up" className="w-full sm:w-auto sm:shrink-0" />
        <div className="min-w-0 flex-1 px-2 pb-1 text-sm leading-snug sm:pb-0" aria-live="polite">
          {voice.notice ? (
            <p className="flex items-center gap-2 text-xs text-tomato-700">
              <span className="min-w-0 flex-1">{voice.notice}</span>
              <button onClick={voice.clearNotice} className="shrink-0 font-semibold underline-offset-2 hover:underline">
                Dismiss
              </button>
            </p>
          ) : voice.handsFree && voice.micMuted ? (
            <p className="text-charcoal-500">Muted. Gusteau isn’t listening, not even for “Hey Chef”, until you tap Unmute.</p>
          ) : live ? (
            <p className="truncate italic text-charcoal-500">“{voice.interim}”</p>
          ) : said ? (
            <>
              {heard && <p className="truncate text-xs text-charcoal-400">You: “{heard}”</p>}
              {heard && interpreted && <p className="truncate text-[11px] italic text-charcoal-400">Interpreted as “{interpreted}”</p>}
              <p className="line-clamp-2 text-charcoal-700">
                <span className="font-semibold text-charcoal-900">Gusteau:</span> {said}
              </p>
            </>
          ) : (
            <p className="text-charcoal-500">
              {voice.handsFree
                ? turn === 'open'
                  ? 'I’m listening. What are you in the mood for? Like “something cheesy” or “a quick chicken dinner”.'
                  : 'Say “Hey Chef” and tell me what you’re in the mood for, like “something cheesy” or “a quick chicken dinner”.'
                : 'What are you in the mood for? Tap the button and tell me. I’ll find it and cook it with you.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Pick the microphone Gusteau listens with and the speaker he talks through.
 * The mic level shows the chosen mic is the one hearing you; "Test" plays
 * the listening chime on the chosen speaker.
 */
function AudioDevicesButton({ voice, up }: { voice: Voice; up: boolean }) {
  const [open, setOpen] = useState(false);
  const devices = useAudioDevices();
  const box = useRef<HTMLSpanElement>(null);
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
          'flex h-10 w-10 items-center justify-center rounded-full border border-cream-300 transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100',
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
          role="dialog"
          aria-label="Audio devices"
          className={cx(
            'absolute right-0 z-[70] block w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-cream-200 bg-white p-4 text-left text-charcoal-700 shadow-card',
            up ? 'bottom-full mb-2' : 'top-full mt-2',
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
