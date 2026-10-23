# Deployment

The SSH host is `macbook-pro-m5-max.local` with user `jpdodel`; no `~/.ssh/config` file was present. On 2026-10-23 the remote machine reported macOS 27.0.1, arm64, 64 GiB unified memory, and approximately 1.5 TiB free on `/`. The development Mac reached it over local mDNS/LAN and SSH. Tailscale CLI was present locally but did not load preferences, so the already-working SSH route was used.

NeMo-Speech.cpp 0.2.0 Metal binary and the model cache already existed at first detailed inspection. The official `nemo-speech pull nemotron-3.5` confirmed the model location. The official installer was downloaded and inspected, but it was not executed because the correct installation was already present. `nemo-speech doctor` reported the M5 Max GPU and Metal feature. The running server reported `device=metal`; stderr reported `backend=MTL0`.

The user LaunchAgent is installed under `~/Library/LaunchAgents/com.jpdodel.gusteau.nemotron-asr.plist`. It invokes `~/Library/Application Support/GusteauNemotron/serve.sh`, which binds localhost port 8080 and loads ASR plus MagpieTTS and NanoCodec. Output and errors go to `~/Library/Logs/GusteauNemotron/`.

Client access is through the localhost SSH tunnel on port 18080. The inference service is not bound to a LAN interface. No API key, public listener, firewall change, or TLS certificate was introduced. The browser Vite proxy serves the demo on `http://127.0.0.1:8765` and forwards `/asr` to the tunnel.

The development Mac also runs `com.jpdodel.gusteau.nemotron-tunnel` as a user LaunchAgent. It keeps the localhost SSH forward alive and restarts it after SSH disconnects. Its source plist is `server/client-tunnel.launchagent.plist`, and logs are under `~/Library/Logs/GusteauNemotron/` on the development Mac. Check it with `launchctl print gui/$(id -u)/com.jpdodel.gusteau.nemotron-tunnel`.

Sources: [installation](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/install.md), [server](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/server.md), [API](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md).
