# Observed benchmarks (2026-10-23)

Synthetic speech was generated locally with macOS `say` (Samantha), converted to 16 kHz mono PCM16 WAV, and replayed from the development Mac through SSH port forwarding. These are small functional measurements, not a production latency study. HTTP times measure an already-warm model. WebSocket final times include the duration of realtime audio playback.

| Test | HTTP result | HTTP request | WS first partial | WS final | WS result |
|---|---|---:|---:|---:|---|
| Salt question | Exact | 0.261 s | 0.695 s | 2.071 s | Words exact; punctuation omitted |
| Olive oil substitution | Exact | 0.150 s | 0.689 s | 3.450 s | Words exact; punctuation omitted |
| Twelve-minute timer | Exact | 0.090 s | 0.903 s | 2.225 s | Words exact; punctuation omitted |
| Salt with uniform synthetic noise | Exact | 0.108 s | 1.193 s | 2.047 s | Final word clipped: “ad” |
| Three utterances in one WAV | Exact | 0.285 s | 0.686 s | 10.137 s | Words exact; punctuation omitted |

The initial 4.21 s pasta sample matched exactly with offline transcription. Its cold CLI run took 1.08 s total (including model load), a 0.26 real-time factor, and reported 1.82 GB maximum resident set. The warmed HTTP request took 0.315 s. Its realtime replay produced the expected words in 4.88 s and first partial at 1.33 s.

The LaunchAgent process used 1,804,736 KiB resident memory (about 1.72 GiB) after the benchmarks. `ready` reported Metal; the runtime logged `backend=MTL0`. A forced LaunchAgent restart returned to readiness after roughly 30 seconds of model startup. GPU utilization percentage was not available without privileged macOS power metrics. A brief live client microphone run opened a 16 kHz stream, sent frames, and shut down cleanly; no speech was intentionally spoken during that check. Browser UI loaded and its HTTP and WebSocket proxies worked, but a spoken browser-microphone transcript was not observed during automated testing.

Success criteria on these synthetic clips: HTTP 5/5 semantically exact; realtime 4/5 semantically exact (one noisy clip clipped its last word). Latency values are observed single runs, not averages. The continuous session test used concatenated synthetic speech and silence; sustained multi-hour stability was not measured.

## MagpieTTS check

On the M5 Max, MagpieTTS v2607 F16 plus NanoCodec generated “Two cloves of garlic, finely minced.” as a 3.07-second mono 22,050 Hz WAV. A cold CLI run took 1.69 seconds total and reported 892 MB maximum resident set. Nemotron transcribed the generated audio as “Two cloves of garlic finely minced.” A warm HTTP request for “Add two cloves of garlic to the pan.” returned a 2.51-second WAV in 0.590 seconds; ASR transcribed it exactly. Through the persistent server and browser proxy, a short response returned a 2.23-second WAV in 0.560 seconds; the browser UI displayed playback controls and began playing it after 794 ms. The combined ASR/TTS service reported `device=metal`, used 1,838,448 KiB resident memory (about 1.75 GiB) after startup, and still transcribed the short question through WebSocket. These are single runs, not averages.

The browser's **Try Synthetic Sample** round trip used a local `say` WAV. Its first ASR result was “How much salt should I add?”, the Magpie-generated WAV was played, and the second ASR result matched exactly. The UI measured 295 ms for the first ASR request, 362 ms for Magpie, and 74 ms for verification, excluding playback duration. The live microphone readback checkbox uses the same synthesis endpoint and pauses microphone forwarding during playback; a spoken live readback was not measured in this run.
