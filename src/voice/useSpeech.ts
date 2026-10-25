import { useCallback, useEffect, useRef, useState } from 'react';

// ─────────────────────────────────────────────────────────────
// Voice in and out, using the browser's built-in Web Speech API.
// Recognition works in Chrome, Edge and Safari and needs HTTPS or
// localhost. Where it's missing, the mic button explains why and
// the app works as before with typing.
//
// While Gusteau is speaking, listening pauses so it doesn't hear
// itself, then resumes if hands-free mode is still on.
// ─────────────────────────────────────────────────────────────

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
type RecognitionCtor = new () => RecognitionLike;

const Recognition: RecognitionCtor | undefined =
  typeof window === 'undefined' ? undefined : ((window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: RecognitionCtor }).webkitSpeechRecognition);

export const speechSupported = !!Recognition;
export const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

let speakingListeners: ((speaking: boolean) => void)[] = [];
let pending = 0;

/**
 * Read text aloud. With `queue`, it waits for whatever is being said;
 * otherwise it interrupts. Resolves when finished.
 */
export function speak(text: string, queue = false): Promise<void> {
  if (!ttsSupported || !text) return Promise.resolve();
  return new Promise((resolve) => {
    if (!queue) stopSpeaking();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      pending = Math.max(0, pending - 1);
      if (!pending) speakingListeners.forEach((l) => l(false));
      resolve();
    };
    u.onend = done;
    u.onerror = done;
    if (!pending++) speakingListeners.forEach((l) => l(true));
    window.speechSynthesis.speak(u);
  });
}

/** Another voice (Magpie) started or stopped talking: pause or resume the browser recognizer like for speak(). */
export function announceSpeaking(on: boolean) {
  speakingListeners.forEach((l) => l(on));
}

export function stopSpeaking() {
  if (!ttsSupported) return;
  window.speechSynthesis.cancel();
  if (pending) {
    pending = 0;
    speakingListeners.forEach((l) => l(false));
  }
}

export type MicState = 'off' | 'listening' | 'paused-for-speech' | 'unsupported' | 'blocked';

/**
 * One recognizer for the whole app.
 *   listenOnce()      push-to-talk: one phrase, then off
 *   setHandsFree(on)  keep listening until turned off
 */
export function useSpeech(onPhrase: (text: string) => void) {
  const [state, setState] = useState<MicState>(speechSupported ? 'off' : 'unsupported');
  const [interim, setInterim] = useState('');
  const [handsFree, setHandsFreeState] = useState(false);
  const rec = useRef<RecognitionLike | null>(null);
  const wanted = useRef<'off' | 'once' | 'continuous'>('off');
  const speaking = useRef(false);
  const handler = useRef(onPhrase);
  handler.current = onPhrase;

  const begin = useCallback(() => {
    if (!Recognition || rec.current) return;
    const r = new Recognition();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.continuous = wanted.current === 'continuous';
    r.onresult = (e) => {
      let text = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          const phrase = res[0].transcript.trim();
          if (phrase) handler.current(phrase);
          setInterim('');
          if (wanted.current === 'once') wanted.current = 'off';
        } else text += res[0].transcript;
      }
      if (text) setInterim(text);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wanted.current = 'off';
        setHandsFreeState(false);
        setState('blocked');
      }
    };
    r.onend = () => {
      rec.current = null;
      setInterim('');
      if (speaking.current && wanted.current === 'continuous') return setState('paused-for-speech');
      if (wanted.current === 'continuous') return begin();
      setState((s) => (s === 'blocked' ? s : 'off'));
    };
    rec.current = r;
    try {
      r.start();
      setState('listening');
    } catch {
      rec.current = null;
    }
  }, []);

  const end = useCallback(() => {
    rec.current?.abort();
    rec.current = null;
  }, []);

  // Pause while Gusteau talks; resume afterwards in hands-free mode.
  useEffect(() => {
    const l = (on: boolean) => {
      speaking.current = on;
      if (on && rec.current) end();
      if (!on && wanted.current === 'continuous') window.setTimeout(begin, 250);
    };
    speakingListeners.push(l);
    return () => {
      speakingListeners = speakingListeners.filter((x) => x !== l);
    };
  }, [begin, end]);

  useEffect(() => end, [end]);

  const listenOnce = useCallback(() => {
    if (!speechSupported) return;
    if (rec.current) {
      wanted.current = 'off';
      end();
      setState('off');
      return;
    }
    stopSpeaking();
    wanted.current = 'once';
    begin();
  }, [begin, end]);

  const setHandsFree = useCallback(
    (on: boolean) => {
      setHandsFreeState(on);
      wanted.current = on ? 'continuous' : 'off';
      end();
      if (on) begin();
      else setState(speechSupported ? 'off' : 'unsupported');
    },
    [begin, end],
  );

  return { state, interim, handsFree, listenOnce, setHandsFree, supported: speechSupported };
}

export type Speech = ReturnType<typeof useSpeech>;
