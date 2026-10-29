import { useCallback, useEffect, useState } from 'react';
import { routeAudio } from './audioUnlock';

// ─────────────────────────────────────────────────────────────
// Which microphone Gusteau listens with and which speaker he talks
// through. The choice is remembered in this browser; "" means the
// system default. A device that's been unplugged falls back to the
// default until it's back.
//
// The mic choice applies to Nemotron (nemotronAsr.ts opens it). The
// speaker choice applies to everything played through Web Audio: the
// Magpie voice, the chime and timer beeps. It needs AudioContext.setSinkId
// (Chrome and Edge); elsewhere sound goes to the system's default output.
// The browser's own speech recognition and voice can't be pointed at a
// device at all.
// ─────────────────────────────────────────────────────────────

const MIC_KEY = 'gusteau.mic';
const SPEAKER_KEY = 'gusteau.speaker';

const read = (key: string) => {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};
const write = (key: string, id: string) => {
  try {
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the choice lasts until the page is closed.
  }
};

let mic = read(MIC_KEY);
let speaker = read(SPEAKER_KEY);
routeAudio(speaker);

/** The microphone to open, or "" for the default. */
export const chosenMic = () => mic;

/** Can sound be sent to a chosen speaker in this browser? */
export const speakerSelectable = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;

export interface AudioDevice {
  id: string;
  label: string;
}

export function useAudioDevices() {
  const [mics, setMics] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [micId, setMicId] = useState(mic);
  const [speakerId, setSpeakerId] = useState(speaker);
  /** Browsers hide device names until the page may use the mic. */
  const [named, setNamed] = useState(true);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    const list = (kind: MediaDeviceKind, what: string) =>
      all
        .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `${what} ${i + 1}` }));
    setMics(list('audioinput', 'Microphone'));
    setSpeakers(list('audiooutput', 'Speaker'));
    setNamed(all.some((d) => d.label));
  }, []);

  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
  }, [refresh]);

  return {
    mics,
    speakers,
    named,
    refresh,
    /** "" when the chosen one isn't plugged in (the default is used meanwhile). */
    micId: mics.some((d) => d.id === micId) ? micId : '',
    speakerId: speakers.some((d) => d.id === speakerId) ? speakerId : '',
    /** Remember the microphone; the caller reopens the mic so it takes effect. */
    setMic: (id: string) => {
      mic = id;
      write(MIC_KEY, id);
      setMicId(id);
    },
    setSpeaker: (id: string) => {
      speaker = id;
      write(SPEAKER_KEY, id);
      setSpeakerId(id);
      routeAudio(id);
    },
  };
}
