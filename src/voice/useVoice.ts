import { useCallback, useEffect, useRef, useState } from 'react';
import { checkAsrServer, startAsr, type AsrServerInfo, type AsrSession } from './nemotronAsr';
import type { VoiceEngine } from './speaker';
import { announceSpeaking, speechSupported, ttsSupported, useSpeech } from './useSpeech';
import { VoiceOut } from './voiceOut';
import { logHeard } from '../debug/debugLog';

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
//   setMicMuted(on)   the mute button: hands-free stays on but hears nothing
//   reopenMic()       another microphone was picked (audioDevices.ts)
//   say / stream / stopTalking   everything Gusteau says
// ─────────────────────────────────────────────────────────────

/** Finalize a phrase after this long without new words: long enough for an "um…" mid-request. */
const PAUSE_MS = 2000;
/** Room echo after Gusteau stops, before the mic opens again. */
const ECHO_TAIL_MS = 300;
const RECONNECT_TRIES = 5;
const RECONNECT_MS = 3000;
const MAGPIE_LANGUAGE = 'en-US';
/** Gusteau's voice on the Magpie server, when it offers it. */
export const GUSTEAU_VOICE = 'Jason';

/** Jason if the server has him, else its first voice. */
export const gusteauVoice = (voices: string[]) => voices.find((v) => v.toLowerCase() === GUSTEAU_VOICE.toLowerCase()) ?? voices[0];

export type VoiceState = 'off' | 'connecting' | 'listening' | 'paused-for-speech' | 'unsupported' | 'blocked';

function outputFor(server: AsrServerInfo | null | undefined): VoiceEngine {
  const voices = server?.tts?.voices ?? [];
  if (voices.length) return { kind: 'magpie', voice: gusteauVoice(voices), language: server!.tts!.languages.includes(MAGPIE_LANGUAGE) ? MAGPIE_LANGUAGE : server!.tts!.languages[0] ?? MAGPIE_LANGUAGE };
  return ttsSupported ? { kind: 'browser' } : { kind: 'off' };
}

export function useVoice(onPhrase: (text: string) => void) {
  const handler = useRef(onPhrase);
  handler.current = onPhrase;
  /** The mute button: while hands-free is on, nothing is heard (not even his name) until unmuted. */
  const [micMuted, setMicMutedState] = useState(false);
  const mutedRef = useRef(false);
  // The browser's recognizer can't be paused mid-phrase, so what it hears while muted is dropped. Push-to-talk always counts.
  const browser = useSpeech((text) => (mutedRef.current && browserHandsFree.current ? undefined : handler.current(text)));
  const browserHandsFree = useRef(false);
  browserHandsFree.current = browser.handsFree;

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
      session.current?.setMuted(mutedRef.current && mode.current === 'continuous');
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
          // A phrase that was finishing as the mute button was pressed doesn't count.
          if (mutedRef.current && mode.current === 'continuous') return;
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
      s.setMuted(talkingRef.current || (mutedRef.current && mode.current === 'continuous'));
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
        if (!on) {
          mutedRef.current = false;
          setMicMutedState(false);
        }
        return browser.setHandsFree(on);
      }
      if (!on) {
        mode.current = 'off';
        setHandsFreeState(false);
        // Turning hands-free off also clears the mute, so it comes back on listening.
        mutedRef.current = false;
        setMicMutedState(false);
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

  /** Another microphone was picked: reopen the mic on it. Hands-free and the mute stay as they were. */
  const reopenMic = useCallback(async () => {
    if (mode.current !== 'continuous' || !session.current) return;
    await closeAsr(false);
    if (mode.current === 'continuous') await openAsr();
  }, [closeAsr, openAsr]);

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
    /** False until we know whether the Mac's speech server is there. */
    ready: server !== undefined,
    state: viaBrowser ? (browser.state as VoiceState) : state,
    interim: micMuted ? '' : viaBrowser ? browser.interim : interim,
    level: viaBrowser || micMuted ? 0 : level,
    micMuted,
    /** Mute or unmute the mic during hands-free. Gusteau can still talk (timers, answers already on their way). */
    setMicMuted: (on: boolean) => {
      mutedRef.current = on;
      setMicMutedState(on);
      if (mode.current === 'continuous') session.current?.setMuted(on || talkingRef.current);
    },
    handsFree: viaBrowser ? browser.handsFree : handsFree,
    talking,
    notice,
    clearNotice: () => setNotice(''),
    listenOnce,
    setHandsFree,
    reopenMic,
    /** A conversation is starting: whatever the mic is hearing right now (the room, before the cook spoke to him) is dropped. */
    discardPending: () => session.current?.discard(),
    enableSpeech: () => out.current!.setEnabled(true),
    disableSpeech: () => out.current!.setEnabled(false),
    say: (text: string, queue = false) => {
      logHeard({ who: 'gusteau', text });
      return out.current!.say(text, queue);
    },
    /** A reply read aloud while it's still being written; the debug log gets it once it's finished. */
    stream: () => {
      const sp = out.current!.stream();
      let said = '';
      return {
        ...sp,
        push: (textSoFar: string) => {
          said = textSoFar;
          sp.push(textSoFar);
        },
        finish: () => {
          if (said.trim()) logHeard({ who: 'gusteau', text: said.trim() });
          return sp.finish();
        },
      };
    },
    stopTalking: () => out.current!.stop(),
  };
}

export type Voice = ReturnType<typeof useVoice>;
