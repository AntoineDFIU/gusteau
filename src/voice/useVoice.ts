import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAsrServer, startAsr, type AsrServerInfo, type AsrSession } from './nemotronAsr';
import type { VoiceEngine } from './speaker';
import { announceSpeaking, speechSupported, ttsSupported, useSpeech } from './useSpeech';
import { VoiceOut } from './voiceOut';

// ─────────────────────────────────────────────────────────────
// Gusteau's ears and voice for the main app.
//
// Ears: NVIDIA Nemotron ASR on the Mac (NeMo-Speech.cpp behind
// /api/asr) when the speech server answers, otherwise the browser's
// Web Speech API (useSpeech.ts). The Pi deployment has no /api/asr,
// so it uses the browser.
//
// Voice: Magpie TTS on the same server when it's available, otherwise
// the browser's voice. While Gusteau talks the mic is muted, and it
// reopens shortly after he stops so he doesn't hear himself.
//
//   listenOnce()      push-to-talk: one phrase, then off
//   setHandsFree(on)  keep listening until turned off
//   say / stream / stopTalking   everything Gusteau says
// ─────────────────────────────────────────────────────────────

/** Finalize a phrase after this long without new words. */
const PAUSE_MS = 1000;
/** Room echo after Gusteau stops, before the mic opens again. */
const ECHO_TAIL_MS = 300;
const RECONNECT_TRIES = 5;
const RECONNECT_MS = 3000;
const MAGPIE_LANGUAGE = 'en-US';

export type VoiceState = 'off' | 'connecting' | 'listening' | 'paused-for-speech' | 'unsupported' | 'blocked';

function outputFor(server: AsrServerInfo | null | undefined): VoiceEngine {
  const voices = server?.tts?.voices ?? [];
  if (voices.length) return { kind: 'magpie', voice: voices[0], language: server!.tts!.languages.includes(MAGPIE_LANGUAGE) ? MAGPIE_LANGUAGE : server!.tts!.languages[0] ?? MAGPIE_LANGUAGE };
  return ttsSupported ? { kind: 'browser' } : { kind: 'off' };
}

export function useVoice(onPhrase: (text: string) => void) {
  const handler = useRef(onPhrase);
  handler.current = onPhrase;
  const browser = useSpeech((text) => handler.current(text));

  /** undefined while checking, null when the Mac's speech server can't be reached. */
  const [server, setServer] = useState<AsrServerInfo | null | undefined>(undefined);
  const [state, setState] = useState<VoiceState>('off');
  const [handsFree, setHandsFreeState] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [talking, setTalking] = useState(false);
  const [notice, setNotice] = useState('');
  const session = useRef<AsrSession | null>(null);
  const mode = useRef<'off' | 'once' | 'continuous'>('off');
  const talkingRef = useRef(false);
  const tries = useRef(0);

  // ── Output ──
  const onTalking = useCallback((on: boolean) => {
    talkingRef.current = on;
    setTalking(on);
    announceSpeaking(on);
    if (on) {
      session.current?.setMuted(true);
      if (mode.current === 'continuous' && session.current) setState('paused-for-speech');
      return;
    }
    window.setTimeout(() => {
      if (talkingRef.current) return;
      session.current?.setMuted(false);
      if (session.current) setState('listening');
    }, ECHO_TAIL_MS);
  }, []);
  const out = useRef<VoiceOut>();
  out.current ??= new VoiceOut(onTalking, (message) => setNotice(`Gusteau’s voice failed: ${message}`));
  useEffect(() => out.current!.setEngine(outputFor(server)), [server]);

  // ── Is the Mac's speech server there? ──
  const probe = useCallback(
    () =>
      checkAsrServer().then(
        (info) => {
          setServer(info);
          return info;
        },
        () => {
          setServer(null);
          return null;
        },
      ),
    [],
  );
  useEffect(() => {
    // Only the dev server proxies /api/asr (vite.config.ts); production uses the browser.
    if (import.meta.env.DEV) void probe();
    else setServer(null);
  }, [probe]);

  const engine: 'nemotron' | 'browser' | 'none' = server ? 'nemotron' : speechSupported ? 'browser' : 'none';

  // ── Nemotron sessions ──
  const closeAsr = useCallback(async (graceful: boolean) => {
    const s = session.current;
    session.current = null;
    setInterim('');
    setLevel(0);
    if (!s) return;
    if (graceful) await s.stop();
    else s.cancel();
  }, []);

  const openAsr = useCallback(async (): Promise<boolean> => {
    setState('connecting');
    try {
      const s = await startAsr({
        pauseMs: PAUSE_MS,
        onPartial: (text) => setInterim(text),
        onLevel: setLevel,
        onFinal: (text) => {
          setInterim('');
          if (mode.current === 'once') {
            mode.current = 'off';
            setState('off');
            void closeAsr(false);
          }
          handler.current(text);
        },
        onError: (message) => setNotice(message),
        onClose: (reason) => {
          session.current = null;
          setInterim('');
          setLevel(0);
          if (mode.current !== 'continuous') {
            mode.current = 'off';
            setState('off');
            return;
          }
          // The tunnel or the Mac dropped. The dev server reconnects the tunnel; try again for a bit.
          if (tries.current++ < RECONNECT_TRIES) {
            setNotice('Lost the speech server. Reconnecting…');
            setState('connecting');
            window.setTimeout(() => {
              if (mode.current === 'continuous') void openAsr();
            }, RECONNECT_MS);
          } else {
            mode.current = 'off';
            setHandsFreeState(false);
            setState('off');
            setNotice(`${reason} Hands-free is off.`);
            void probe();
          }
        },
      });
      if (mode.current === 'off') {
        s.cancel();
        setState('off');
        return true;
      }
      tries.current = 0;
      session.current = s;
      s.setMuted(talkingRef.current);
      setState(talkingRef.current && mode.current === 'continuous' ? 'paused-for-speech' : 'listening');
      setNotice('');
      return true;
    } catch (e) {
      const message = (e as Error).message;
      setState(/blocked/i.test(message) ? 'blocked' : 'off');
      setNotice(message);
      return false;
    }
  }, [closeAsr, probe]);

  // ── Public controls ──
  const listenOnce = useCallback(async () => {
    if (engine !== 'nemotron') return browser.listenOnce();
    if (mode.current === 'once') {
      // Tapped again: finish the phrase now.
      mode.current = 'off';
      await closeAsr(true);
      setState('off');
      return;
    }
    if (mode.current === 'continuous') return;
    out.current!.stop();
    mode.current = 'once';
    if (!(await openAsr()) && mode.current === 'once') {
      mode.current = 'off';
      // The Mac isn't answering: fall back to the browser for this phrase.
      if ((await probe()) === null && speechSupported) browser.listenOnce();
    }
  }, [engine, browser, closeAsr, openAsr, probe]);

  const setHandsFree = useCallback(
    async (on: boolean) => {
      if (engine !== 'nemotron') {
        setHandsFreeState(on);
        return browser.setHandsFree(on);
      }
      if (!on) {
        mode.current = 'off';
        setHandsFreeState(false);
        out.current!.stop();
        if (browser.handsFree) browser.setHandsFree(false);
        await closeAsr(false);
        setState('off');
        return;
      }
      if (mode.current === 'once') await closeAsr(false);
      mode.current = 'continuous';
      tries.current = 0;
      setHandsFreeState(true);
      if (!(await openAsr()) && mode.current === 'continuous') {
        mode.current = 'off';
        if ((await probe()) === null && speechSupported) {
          setNotice('The Mac’s speech server isn’t answering, so hands-free is using the browser’s speech recognition.');
          browser.setHandsFree(true);
        } else setHandsFreeState(false);
      }
    },
    [engine, browser, closeAsr, openAsr, probe],
  );

  useEffect(
    () => () => {
      mode.current = 'off';
      session.current?.cancel();
      out.current?.stop();
    },
    [],
  );

  // The browser is in charge when there's no speech server, or when it stood in after the server failed.
  const viaBrowser = engine !== 'nemotron' || browser.handsFree || browser.state === 'listening';
  return {
    engine: viaBrowser ? (speechSupported ? 'browser' : 'none') : 'nemotron',
    /** Who's listening and who's talking, for tooltips. */
    label: `${viaBrowser ? 'Browser speech recognition' : 'Nemotron ASR on the Mac'} · ${out.current.kind === 'magpie' ? 'Magpie voice' : out.current.kind === 'browser' ? 'browser voice' : 'no voice'}`,
    supported: engine !== 'none',
    state: viaBrowser ? (browser.state as VoiceState) : state,
    interim: viaBrowser ? browser.interim : interim,
    level: viaBrowser ? 0 : level,
    handsFree: viaBrowser ? browser.handsFree : handsFree,
    talking,
    notice,
    clearNotice: () => setNotice(''),
    listenOnce,
    setHandsFree,
    say: (text: string, queue = false) => out.current!.say(text, queue),
    stream: () => out.current!.stream(),
    stopTalking: () => out.current!.stop(),
  };
}

export type Voice = ReturnType<typeof useVoice>;
