# Gusteau speech service

Local speech recognition and synthesis on `macbook-pro-m5-max.local`, using NVIDIA NeMo-Speech.cpp 0.2.0. ASR uses `nvidia/nemotron-3.5-asr-streaming-0.6b` (Q8_0 GGUF, model revision `1c8deaecc64b91f034d73e08dd8b64625eb3395d`). TTS uses `nvidia/magpie_tts_multilingual_357m` (F16 v2607, revision `19806879b16d3f2ccf28fb112b1bcd16a3c7923e`) and `nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps` (revision `fc00890b604aa2de298d2641ffc6c5f6caf8c4d7`). The existing Metal build was reused. All models run on the M5 Max; the microphone and audio playback stay on the client computer.

## Endpoints

The server binds only `127.0.0.1:8080` on the remote Mac. From the development Mac, start the tunnel if it is not already running:

```sh
ssh -fN -o ExitOnForwardFailure=yes -L 127.0.0.1:18080:127.0.0.1:8080 macbook-pro-m5-max.local
curl http://127.0.0.1:18080/ready
```

HTTP base: `http://127.0.0.1:18080`; ASR WebSocket: `ws://127.0.0.1:18080/v1/audio/transcriptions/realtime`; TTS: `POST http://127.0.0.1:18080/v1/audio/speech`. A user LaunchAgent maintains this tunnel after a client reboot or SSH disconnect. Port 18080 was chosen because the remote service uses 8080. Check it with `launchctl print gui/$(id -u)/com.jpdodel.gusteau.nemotron-tunnel` and read `~/Library/Logs/GusteauNemotron/tunnel-stderr.log` on the development Mac.

## Run and test

```sh
# File upload (16 kHz mono WAV recommended)
python3 nemotron-asr/client/transcribe-file.py your-audio.wav

# Client microphone, using an isolated Python environment
python3 -m venv .venv-asr
.venv-asr/bin/pip install -r nemotron-asr/requirements.txt
.venv-asr/bin/python nemotron-asr/client/stream-microphone.py

# Browser demo, from repository root; uses the existing Vite dependency
./node_modules/.bin/vite --config nemotron-asr/web-demo/vite.config.js
# Open http://127.0.0.1:8765/
```

The browser demo starts with **Cook with Gusteau**. Choose a genre and one of the 900 recipes from the root `recipes/` library; its ingredients and full steps appear below. Choose a voice and click **Start voice conversation**. Gusteau greets you, waits for “ready,” then presents one step at a time. Ask questions or describe a kitchen change without advancing; say “done” after completing a step. The page uses Nemotron's live WebSocket for finalized utterances, Ollama `qwen3.6:35b-mlx` for recipe-aware answers, and Magpie for spoken replies. It sends the selected recipe, current step, kitchen notes, and recent turns to Ollama; only the page advances the step index. The demo's Vite server reads the recipe JSON and proxies `/ollama` to `macbook-pro-m5-max.local:11434` (override with `GUSTEAU_OLLAMA_URL`). This is a standalone test UI, not yet integrated into the main cooking screen.

The lower sections retain WAV upload, live microphone readback, and Magpie playback tests. For a speech-only round trip, click **Try Synthetic Sample** or choose a WAV and click **Transcribe → Speak Back → Verify**. For live microphone readback, check **Speak each finalized transcript back to me** before listening. The demo proxies `/asr` through Vite to the SSH tunnel. A localhost origin meets browser microphone secure-context requirements.

## Remote service

```sh
# Status
ssh macbook-pro-m5-max.local 'launchctl print gui/$(id -u)/com.jpdodel.gusteau.nemotron-asr | head -35'
# Restart
ssh macbook-pro-m5-max.local 'launchctl kickstart -k gui/$(id -u)/com.jpdodel.gusteau.nemotron-asr'
# Stop
ssh macbook-pro-m5-max.local 'launchctl bootout gui/$(id -u)/com.jpdodel.gusteau.nemotron-asr'
# Start after stop
ssh macbook-pro-m5-max.local 'launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.jpdodel.gusteau.nemotron-asr.plist"'
# Logs
ssh macbook-pro-m5-max.local 'tail -f "$HOME/Library/Logs/GusteauNemotron/stderr.log"'
```

The user LaunchAgent starts at login and restarts the service after failure. It cannot serve while the Mac is asleep or before login. Edit `~/Library/Application Support/GusteauNemotron/serve.sh` on the remote Mac to change `NEMO_MODEL` or `NEMO_PORT`; restart afterward. The plist path is specific to this user's Mac account.

For React integration, reuse the WebSocket capture and event handling in `web-demo/main.js`, pointing your development proxy at the local tunnel. Send 16 kHz mono PCM16 little-endian frames and handle delta/completed events. Pass finalized utterances to Gusteau's separate culinary LLM, then send its answer to `/v1/audio/speech` and play the WAV on the client. The TTS HTTP response is buffered, so playback starts after the whole utterance is synthesized.

The main Gusteau cooking screen currently has a text chat and no microphone flow. The standalone speech test UI demonstrates Magpie playback; wiring that flow into the cooking screen is a separate app integration step.

For measured results, see [benchmarks](docs/benchmarks.md). For protocol and troubleshooting, see [API integration](docs/api-integration.md) and [troubleshooting](docs/troubleshooting.md).

## Uninstall this task's components

Stop the remote ASR LaunchAgent, then remove only `~/Library/LaunchAgents/com.jpdodel.gusteau.nemotron-asr.plist`, `~/Library/Application Support/GusteauNemotron`, and `~/Library/Logs/GusteauNemotron` on the remote Mac. The Magpie and NanoCodec cache entries introduced by this task are under `~/Library/Caches/NeMoSpeech/models/nvidia/magpie_tts_multilingual_357m` and `~/Library/Caches/NeMoSpeech/models/nvidia/nemo-nano-codec-22khz-1.89kbps-21.5fps`. On the development Mac, run `launchctl bootout gui/$(id -u)/com.jpdodel.gusteau.nemotron-tunnel`, then remove `~/Library/LaunchAgents/com.jpdodel.gusteau.nemotron-tunnel.plist` and `~/Library/Logs/GusteauNemotron`. Remove the `nemotron-asr/` project directory and the local `.venv-asr` if created. The NeMo-Speech.cpp binary was present before this task and should remain. The Nemotron cache entry was also present at first inspection; leave it unless you independently decide to remove it.
