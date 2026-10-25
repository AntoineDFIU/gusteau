# Codex Task: Deploy NVIDIA Nemotron 3.5 Streaming ASR on Remote Mac M5 Max

## 1. Objective

Set up a fully operational, locally hosted NVIDIA Nemotron speech-to-text inference server on my remote MacBook Pro M5 Max, accessible from my development computer via SSH and network APIs.

This is for a hackathon cooking application where users interact conversationally with an AI culinary assistant. The client computer captures microphone audio, streams it to the remote Mac for transcription, and receives real-time text results.

**Important: You are the implementation agent. Execute the installation, configuration, deployment, and testing. Do not merely provide instructions or a proposed plan.**

You have terminal access through VS Code and SSH access to the Mac.

## 2. Environment

**Inference server:**
- Machine: Apple MacBook Pro M5 Max
- Memory: 64 GB unified memory
- Operating system: macOS
- GPU backend: Apple Metal
- Access: SSH from the development workstation
- Role: Host NVIDIA speech recognition inference
- No CUDA or NVIDIA GPU available on this machine

**Development/client computer:**
- Running Visual Studio Code with Codex
- Has SSH access to the inference Mac
- Will capture microphone audio from a web application
- Must connect to the remote inference server over the network

**Required NVIDIA model:**
- NVIDIA Nemotron 3.5 ASR Streaming 0.6B
- Hugging Face: `nvidia/nemotron-3.5-asr-streaming-0.6b`
- Use the official NVIDIA NeMo-Speech.cpp runtime, preferably with its Metal backend

**Official repository:**

https://github.com/NVIDIA/NeMo-Speech.cpp

**Documentation:**
- https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/install.md
- https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/cli.md
- https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/server.md
- https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/clients.md
- https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/asr/models.md

## 3. Execution requirements

Carry out the following phases sequentially.

### Phase A — Discover and verify SSH connectivity

1. Inspect my local SSH configuration at `~/.ssh/config`.
2. Identify the SSH connection corresponding to the M5 Max.
3. If the target is ambiguous, ask me which SSH host alias to use.
4. Verify successful SSH connectivity.
5. Discover the macOS version, Apple Silicon architecture, available RAM, disk space, and installed dependencies.
6. Check whether NVIDIA NeMo-Speech.cpp or another ASR service is already installed.
7. Identify network connectivity between the development computer and the Mac.
8. Determine whether the development workstation can reach the Mac through a LAN address, Tailscale, or another existing secure route.

Do not modify SSH configuration, firewall settings, existing applications, or existing inference services unnecessarily.

Do not display SSH private keys or authentication secrets.

### Phase B — Install NVIDIA NeMo-Speech.cpp

Use the official NVIDIA runtime.

First inspect the current upstream installation documentation and installation script. Confirm that the commands and flags remain valid.

Install using the recommended native Apple Silicon Metal backend.

The current documented installer is:

```bash
curl -fsSL https://github.com/NVIDIA/NeMo-Speech.cpp/raw/main/scripts/install.sh -o /tmp/install-nemo-speech.sh
sh /tmp/install-nemo-speech.sh
```

Inspect the downloaded script before execution.

If the prebuilt Metal installer fails, investigate and use the officially documented source-build process.

Only install missing dependencies that are actually required.

Potential build dependencies:

```bash
brew install cmake ninja sentencepiece abseil
```

Verify successful installation using:

```bash
export PATH="$HOME/.local/bin:$PATH"
nemo-speech --version
nemo-speech doctor
nemo-speech model list
```

Confirm that Metal acceleration is available.

Prefer GPU acceleration over CPU execution.

Do not assume that the GPU is being used just because installation succeeded. Verify the effective inference backend through runtime diagnostics.

### Phase C — Download NVIDIA Nemotron

Download the model using the official CLI:

```bash
nemo-speech pull nemotron-3.5
```

Confirm:

- Exact model identifier and downloaded version
- Model files and cache location
- Model integrity
- Memory usage
- Successful model loading
- Metal backend selection

The expected macOS cache directory is:

```text
~/Library/Caches/NeMoSpeech/models
```

Do not download unrelated large models.

### Phase D — Verify speech recognition locally on the M5

Before attempting remote streaming, confirm that inference works.

Use a short, known English audio sample in WAV format.

For example:

"I'm cooking pasta with tomato sauce. How much garlic should I add?"

Generate or obtain a test WAV without using any secrets or personal recordings.

Run a file transcription using Nemotron 3.5.

Confirm that the expected sentence is recognized and capture the output.

Then test streaming recognition against a prerecorded WAV file, using the runtime's documented `--stream` mode.

Measure:

- Model loading time
- Total transcription time
- Real-time factor, when measurable
- Process memory usage
- Whether Metal is actually used
- Transcription correctness

Do not use the Mac's microphone as the primary test: the eventual microphone is attached to the client computer.

### Phase E — Deploy an inference server

Launch NeMo-Speech.cpp as an HTTP and WebSocket speech recognition service.

Use port 8080 if available. Otherwise choose a free port and document it.

The documented server command is:

```bash
nemo-speech serve \
  --asr-model nemotron-3.5 \
  --host 127.0.0.1 \
  --port 8080
```

Start with localhost binding and verify readiness before configuring remote access.

Verify:

```text
GET /health
GET /ready
GET /v1/models
POST /v1/audio/transcriptions
WebSocket /v1/audio/transcriptions/realtime
```

The WebSocket endpoint accepts PCM16 audio frames.

Read the official protocol documentation and implement the correct session initialization, audio framing, transcription event handling, and connection termination.

Do not guess the WebSocket protocol.

### Phase F — Configure secure access from the client computer

Use the simplest secure network arrangement that works with the existing environment.

**Preferred approach:**

If the two computers have existing SSH connectivity, first evaluate an SSH tunnel from the development computer to the inference Mac.

Example:

```bash
ssh -N -L 8080:127.0.0.1:8080 <ssh-host-alias>
```

Choose another local port if 8080 is occupied.

This permits the client to reach the inference API without publicly exposing the Mac's port.

If an existing private LAN or Tailscale configuration offers a better solution, use it as appropriate.

For direct network access:

- Use a restricted/private interface
- Configure server authentication
- Do not expose an unauthenticated endpoint to the public internet
- Use HTTPS/WSS where required
- Restrict CORS to the actual client frontend origin
- Avoid opening broad firewall access

If HTTPS/TLS is required, follow NVIDIA's documented runtime and build requirements.

Do not make the server publicly reachable unless I explicitly authorize it.

Document the final base URL and WebSocket URL.

### Phase G — Configure persistent inference service

Once successful interactive inference is verified, configure NeMo-Speech.cpp to run as a user-level macOS LaunchAgent.

Requirements:

- Launch at user login
- Automatic restart after unexpected failures
- Startup logs
- Error logs
- Configurable model path
- Configurable listening port
- Documented start, stop, restart and status commands
- No requirement to keep an interactive SSH shell open

Use `launchd` with a user-specific plist.

Do not use `sudo` unless technically essential and justified.

Do not overwrite existing LaunchAgents.

A user LaunchAgent is sufficient for this hackathon. Clearly document that it may not start before user login or remain available while the Mac is asleep.

Do not silently alter system sleep settings.

### Phase H — Create a remote STT integration test

On the development computer, create a small client project in an appropriate new subdirectory.

Prefer Python or TypeScript, based on the existing repository.

Implement both:

**Test 1: File transcription**

Upload a short WAV file to the remote Nemotron HTTP endpoint.

Display:

- Transcribed text
- Request duration
- Model identifier
- Server URL

**Test 2: Real-time WebSocket audio**

Capture microphone audio from the development computer and stream it to the Mac.

Requirements:

- Continuous microphone capture
- Correct audio sample rate
- Mono PCM16 little-endian audio
- Resampling if required
- Small audio frames suitable for streaming
- Partial/final transcription event support, as documented
- Automatic or explicit utterance endpointing
- Graceful connection termination
- Reconnection after transient network errors
- Helpful diagnostic logs

Do not send audio to a third-party cloud service.

The microphone should always be captured on the client computer, never on the M5 inference server.

### Phase I — Create a simple browser test application

Create a minimal frontend to demonstrate the integration.

Preferred stack: React or simple HTML/TypeScript.

The interface should have:

1. Start Listening button
2. Stop Listening button
3. Connection status
4. Live transcription display
5. Finalized utterance history
6. Measured latency
7. Error messages
8. Current model name

The app must use the microphone on the client computer and stream the audio to the Nemotron inference server.

Important browser constraints:

- Browser microphone capture requires a secure context.
- A localhost development origin generally qualifies.
- A remote HTTP origin generally does not.
- Use appropriate WSS/TLS or a development proxy/tunnel.
- Never hardcode an inference API secret into browser-delivered JavaScript.

If authentication is required, implement a small backend proxy that securely holds the credential.

Prevent duplicate microphone capture sessions and close all audio resources when listening stops.

Use browser echo cancellation and noise suppression where practical.

### Phase J — Optimize for a hands-free cooking application

The eventual cooking app requires conversations such as:

User: "How much garlic do I need?"

Agent: "Two cloves, finely minced."

User: "Actually, I'm cooking for six people."

Agent: "Then use approximately four cloves."

Nemotron is responsible for recognition, not answering these culinary questions.

Prepare the STT service to integrate with a separate culinary reasoning LLM.

Focus on:

- Accurate transcription with kitchen background noise
- Fast finalization of short questions
- Low streaming latency
- Endpointing for natural pauses
- Stable long-lived microphone sessions
- Minimal resource usage
- Recovery after network interruptions

Where supported, configure `en-US` as the initial transcription language.

Avoid unnecessary model complexity.

### Phase K — Benchmark

Run a small set of representative tests.

At minimum:

1. Short question: "How much salt should I add?"
2. Medium question: "Can I substitute olive oil for butter in this recipe?"
3. Cooking instruction: "Set a timer for twelve minutes."
4. Multiple utterances in one continuous session
5. Speech with simulated background kitchen noise

Record:

- Successful transcription rate
- First partial transcript latency
- Final transcript latency
- End-to-end network delay where measurable
- Model memory consumption
- CPU/GPU utilization
- Stability during a sustained session

Clearly distinguish observed measurements from estimates.

If the benchmarks fail, diagnose and improve the configuration before declaring the deployment complete.

## 4. Deliverables

Create these project artifacts:

```text
nemotron-asr/
├── README.md
├── install/
│   └── setup-remote-mac.sh
├── server/
│   ├── start.sh
│   ├── stop.sh
│   └── launchagent.plist
├── client/
│   ├── transcribe-file.py
│   └── stream-microphone.py
├── web-demo/
│   └── ...
├── tests/
│   └── ...
└── docs/
    ├── deployment.md
    ├── api-integration.md
    ├── benchmarks.md
    └── troubleshooting.md
```

Adapt the structure to my existing project if necessary. Avoid overwriting unrelated files.

The README must contain:

- What was installed
- Model identifier and version
- Inference server details
- How to start and stop the server
- How to test with an audio file
- How to test with a remote microphone
- How to integrate the service into a React application
- How to view logs
- How to troubleshoot connection issues
- How to uninstall only the components introduced by this task

Never include credentials in the README or committed files.

## 5. Completion criteria

Do not consider the task finished until:

- [ ] SSH connectivity to M5 verified
- [ ] NeMo-Speech.cpp installed
- [ ] Nemotron 3.5 ASR downloaded
- [ ] Metal acceleration verified
- [ ] Local WAV transcription succeeds
- [ ] Server starts successfully
- [ ] Server health endpoint succeeds
- [ ] Remote HTTP transcription succeeds
- [ ] Remote WebSocket audio streaming succeeds
- [ ] Client microphone captured on the development computer
- [ ] Live transcription displayed in browser
- [ ] Long-running inference service configured
- [ ] Benchmark results documented
- [ ] All setup scripts and documentation created

If a criterion cannot be completed, explain the precise blocker and leave all other completed components functional.

## 6. Working instructions for Codex

Work autonomously and iteratively.

Inspect the environment before modifying it.

Execute real commands through SSH and validate their results. Do not claim a successful installation or test based only on a command exiting without an error.

Use official NVIDIA documentation as the authoritative reference for CLI flags, compatibility and protocols.

Prefer working, simple solutions suitable for a hackathon over complex infrastructure.

Avoid changing unrelated application code or system configuration.

Do not commit secrets, private keys, access tokens, or personal audio recordings.

If a command fails, inspect logs and diagnose the actual cause rather than repeatedly running the same command.

Ask me only for information that cannot be discovered, such as an ambiguous SSH host or required authentication approval.

At completion, give me:

1. A deployment summary
2. The actual inference server endpoint
3. The actual WebSocket endpoint
4. Installation and model versions
5. Results of successful tests
6. Measured latency and resource usage
7. Exact commands to restart the service
8. Remaining limitations
9. A short explanation of how my cooking application should integrate with the server

**Begin by inspecting SSH connectivity and the target Mac. Then perform the installation and testing.**
