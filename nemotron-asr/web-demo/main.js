const $ = id => document.getElementById(id);
let current = null;
const status = value => { $('status').textContent = value; };
const error = value => { $('error').textContent = value; };

async function fetchModel() {
  try {
    const data = await fetch('/asr/v1/models').then(r => r.json());
    $('model').textContent = data.data?.find(model => model.capability === 'transcription')?.id || 'Unknown';
    const speech = data.data?.find(model => model.capability === 'speech');
    $('speech-model').textContent = speech?.id || 'Unavailable';
    if (speech?.voices) {
      // This installed Magpie checkpoint maps names to baked speaker indices in
      // speakers.json. Its HTTP name order differs, so send indices explicitly.
      const magpieSpeakers = { Aria: 0, Jason: 1, John: 2, Leo: 3, Sofia: 4 };
      const voices = speech.id === 'magpietts'
        ? Object.entries(magpieSpeakers).filter(([name]) => speech.voices.includes(name))
        : speech.voices.map(name => [name, name]);
      if (speech.id === 'magpietts' && voices.length) {
        for (const id of ['voice', 'readback-voice']) $(id).replaceChildren();
      }
      for (const [name, speaker] of voices) {
        for (const id of ['voice', 'readback-voice']) {
          const option = document.createElement('option');
          option.value = String(speaker);
          option.textContent = name;
          $(id).append(option);
        }
      }
      if (speech.id === 'magpietts' && voices.length) {
        for (const id of ['voice', 'readback-voice']) $(id).value = '0';
      }
    }
  } catch (e) { error(`Model lookup: ${e.message}`); }
}

async function synthesize(text, voice = $('voice').value) {
  const response = await fetch('/asr/v1/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'magpie', input: text, voice,
      language: 'en-US', response_format: 'wav' }),
  });
  if (!response.ok) throw new Error(`Speech server returned ${response.status}: ${await response.text()}`);
  return response.blob();
}

async function transcribe(file) {
  const body = new FormData();
  body.append('file', file);
  body.append('model', 'nemotron-3.5');
  body.append('language', 'en-US');
  const response = await fetch('/asr/v1/audio/transcriptions', { method: 'POST', body });
  if (!response.ok) throw new Error(`ASR server returned ${response.status}: ${await response.text()}`);
  return (await response.json()).text || '';
}

function setAudio(id, blob) {
  const player = $(id);
  player.pause();
  if (player.dataset.objectUrl) URL.revokeObjectURL(player.dataset.objectUrl);
  player.dataset.objectUrl = URL.createObjectURL(blob);
  player.src = player.dataset.objectUrl;
  player.style.display = 'block';
  return player;
}

async function speakReply() {
  const input = $('reply').value.trim();
  if (!input) { error('Enter text for the assistant to say.'); return; }
  error(''); $('speak').disabled = true; $('speech-status').textContent = 'Generating audio…';
  const started = performance.now();
  try {
    const audio = setAudio('speech-audio', await synthesize(input));
    $('speech-status').textContent = `Ready in ${Math.round(performance.now() - started)} ms`;
    await audio.play().catch(() => {});
  } catch (e) { error(`Speech generation failed: ${e.message}`); $('speech-status').textContent = 'Failed'; }
  finally { $('speak').disabled = false; }
}

function comparable(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

async function runFileTest(file, roundTrip) {
  if (!file) { error('Choose a WAV file first.'); return; }
  error(''); $('upload').disabled = true; $('roundtrip').disabled = true; $('sample').disabled = true;
  $('file-result').textContent = 'Transcribing…';
  $('verified-result').textContent = '—';
  $('roundtrip-status').textContent = '';
  const started = performance.now();
  try {
    const original = await transcribe(file);
    $('file-result').textContent = original || '(No speech detected)';
    const asrMs = Math.round(performance.now() - started);
    if (!roundTrip || !original) {
      $('roundtrip-status').textContent = original ? `ASR: ${asrMs} ms` : 'No speech to read back.';
      return;
    }
    $('roundtrip-status').textContent = 'Generating Magpie audio…';
    const ttsStarted = performance.now();
    const wav = await synthesize(original);
    const ttsMs = Math.round(performance.now() - ttsStarted);
    setAudio('roundtrip-audio', wav).play().catch(() => {});
    $('roundtrip-status').textContent = 'Verifying generated speech with Nemotron…';
    const verifyStarted = performance.now();
    const verified = await transcribe(new File([wav], 'magpie-readback.wav', { type: 'audio/wav' }));
    const verifyMs = Math.round(performance.now() - verifyStarted);
    $('verified-result').textContent = verified || '(No speech detected)';
    const match = comparable(original) === comparable(verified) ? 'Match' : 'Difference detected';
    $('roundtrip-status').textContent = `${match} · ASR ${asrMs} ms · Magpie ${ttsMs} ms · verification ${verifyMs} ms`;
  } catch (e) { error(`Round trip failed: ${e.message}`); $('roundtrip-status').textContent = 'Failed'; }
  finally { $('upload').disabled = false; $('roundtrip').disabled = false; $('sample').disabled = false; }
}

async function sampleRoundTrip() {
  try {
    const response = await fetch('/sample-salt.wav');
    if (!response.ok) throw new Error(`Sample download returned ${response.status}`);
    await runFileTest(new File([await response.blob()], 'sample-salt.wav', { type: 'audio/wav' }), true);
  } catch (e) { error(`Sample test failed: ${e.message}`); }
}

function resample(input, fromRate, toRate = 16000) {
  const size = Math.round(input.length * toRate / fromRate);
  const bytes = new ArrayBuffer(size * 2);
  const pcm = new DataView(bytes);
  for (let i = 0; i < size; i++) {
    const pos = i * fromRate / toRate;
    const lo = Math.floor(pos), hi = Math.min(lo + 1, input.length - 1);
    const value = Math.max(-1, Math.min(1, input[lo] + (input[hi] - input[lo]) * (pos - lo)));
    pcm.setInt16(i * 2, value < 0 ? value * 32768 : value * 32767, true);
  }
  return bytes;
}

async function start() {
  if (current) return;
  error(''); status('Connecting'); $('start').disabled = true;
  const session = { closed: false, chunks: [], count: 0, lastAudio: 0, retries: 0,
    draft: '', finalized: true, speaking: false, committing: false, lastVoice: 0 };
  current = session;
  $('stop').disabled = false;
  $('finish').disabled = false;
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true,
    } });
    session.context = new AudioContext();
    await session.context.audioWorklet.addModule('/audio-worklet.js');
    session.source = session.context.createMediaStreamSource(session.stream);
    session.worklet = new AudioWorkletNode(session.context, 'capture-processor');
    session.source.connect(session.worklet);
    session.worklet.connect(session.context.destination);
    session.worklet.port.onmessage = ({ data }) => {
      if (!current || current !== session || session.speaking || session.committing ||
          session.ws?.readyState !== WebSocket.OPEN) return;
      session.chunks.push(data); session.count += data.length;
      const frameSize = Math.round(session.context.sampleRate / 10);
      if (session.count < frameSize) return;
      const joined = new Float32Array(session.count);
      let offset = 0;
      for (const chunk of session.chunks) { joined.set(chunk, offset); offset += chunk.length; }
      session.chunks = []; session.count = 0;
      session.lastAudio = performance.now();
      session.ws.send(resample(joined, session.context.sampleRate));
      const level = Math.sqrt(joined.reduce((sum, sample) => sum + sample * sample, 0) / joined.length);
      if (level > 0.012) session.lastVoice = session.lastAudio;
      if (session.draft && !session.committing && session.lastVoice &&
          session.lastAudio - session.lastVoice > 1100) finishUtterance(session);
    };
    if (session.closed) { session.stream.getTracks().forEach(track => track.stop()); return; }
    connect(session);
  } catch (e) { error(e.message); await stop(); }
}

function finishUtterance(session = current) {
  if (!session || session.closed || session.speaking || session.committing ||
      !session.draft || session.ws?.readyState !== WebSocket.OPEN) return;
  session.committing = true;
  $('utterance-state').textContent = 'Finalizing…';
  session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
}

async function readBack(session, text) {
  session.speaking = true;
  session.chunks = [];
  session.count = 0;
  status('Generating readback');
  $('readback-status').textContent = `Speaking back: ${text}`;
  const started = performance.now();
  try {
    const wav = await synthesize(text, $('readback-voice').value);
    if (session.closed) return;
    const audio = setAudio('readback-audio', wav);
    $('readback-status').textContent = `Readback ready in ${Math.round(performance.now() - started)} ms: ${text}`;
    audio.onplay = () => { session.speaking = true; status('Speaking back'); };
    audio.onpause = () => { if (!session.closed) session.speaking = false; };
    audio.onended = () => { if (!session.closed) { session.speaking = false; status('Listening'); } };
    try {
      await audio.play();
    } catch {
      $('readback-status').textContent += ' · Press play below to hear it.';
      session.speaking = false;
      status('Listening');
    }
  } catch (e) {
    error(`Readback failed: ${e.message}`);
    session.speaking = false;
    if (!session.closed) status('Listening');
  }
}

function connect(session) {
  if (session.closed) return;
  status(session.retries ? 'Reconnecting' : 'Connecting');
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${scheme}//${location.host}/asr/v1/audio/transcriptions/realtime`);
  session.ws = ws;
  ws.onmessage = ({ data }) => {
    const event = JSON.parse(data);
    switch (event.type) {
      case 'session.created':
        ws.send(JSON.stringify({ type: 'session.update', session: {
          sample_rate: 16000, language: 'en-US', endpointing_ms: 650,
        } }));
        status('Listening'); session.retries = 0; session.committing = false; break;
      case 'conversation.item.input_audio_transcription.delta':
        if (!event.delta) break;
        if (session.finalized) { session.draft = ''; session.finalized = false; }
        if (!session.lastVoice) session.lastVoice = performance.now();
        session.draft += event.delta;
        $('live').textContent = session.draft;
        $('utterance-state').textContent = session.committing ? 'Finalizing…' : 'Draft · updating';
        break;
      case 'conversation.item.input_audio_transcription.completed': {
        const text = event.transcript || event.text || '';
        if (text) { const item = document.createElement('li'); item.textContent = text; $('history').prepend(item); }
        $('live').textContent = text || session.draft || '—';
        $('utterance-state').textContent = 'Final · saved below';
        session.draft = '';
        session.finalized = true;
        session.committing = false;
        session.lastVoice = 0;
        if (session.lastAudio) $('latency').textContent = `${Math.round(performance.now() - session.lastAudio)} ms since latest audio frame`;
        if (text && $('auto-readback').checked && !session.speaking && !session.closed) readBack(session, text);
        break;
      }
      case 'error':
        session.committing = false;
        error(event.error?.message || JSON.stringify(event));
        break;
    }
  };
  ws.onerror = () => error('WebSocket connection failed. Check the SSH tunnel and server.');
  ws.onclose = () => {
    if (!session.closed) {
      status('Disconnected');
      session.retries++;
      session.timer = setTimeout(() => connect(session), Math.min(1000 * 2 ** session.retries, 10000));
    }
  };
}

async function stop() {
  const session = current;
  if (!session) return;
  current = null; session.closed = true;
  $('readback-audio').pause();
  clearTimeout(session.timer);
  session.worklet?.disconnect(); session.source?.disconnect();
  session.stream?.getTracks().forEach(track => track.stop());
  if (session.ws?.readyState === WebSocket.OPEN) {
    session.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  session.ws?.close();
  await session.context?.close();
  $('start').disabled = false; $('finish').disabled = true; $('stop').disabled = true; status('Stopped');
}

$('start').addEventListener('click', start);
$('finish').addEventListener('click', () => finishUtterance());
$('stop').addEventListener('click', stop);
$('upload').addEventListener('click', () => runFileTest($('file').files?.[0], false));
$('roundtrip').addEventListener('click', () => runFileTest($('file').files?.[0], true));
$('sample').addEventListener('click', sampleRoundTrip);
$('speak').addEventListener('click', speakReply);
window.addEventListener('pagehide', () => {
  stop();
  for (const player of document.querySelectorAll('audio')) {
    if (player.dataset.objectUrl) URL.revokeObjectURL(player.dataset.objectUrl);
  }
});
fetchModel();
