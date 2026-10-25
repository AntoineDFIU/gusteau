# Troubleshooting

1. Check remote readiness: `ssh macbook-pro-m5-max.local 'curl -fsS http://127.0.0.1:8080/ready'`.
2. Check the local tunnel: `curl -fsS http://127.0.0.1:18080/ready`. If it fails, restart the SSH forwarding command in the README.
3. Check the LaunchAgent: `ssh macbook-pro-m5-max.local 'launchctl print gui/$(id -u)/com.jpdodel.gusteau.nemotron-asr'` and read `~/Library/Logs/GusteauNemotron/stderr.log`.
4. If port 8080 is occupied, update `NEMO_PORT` in `serve.sh` and the SSH tunnel's remote port, then restart the agent.
5. If the browser does not start listening, grant microphone permission to `http://127.0.0.1:8765`, verify the local origin, and inspect the page error message. The terminal microphone client can diagnose device availability separately.
6. If results are clipped under background noise, use a quieter microphone position, leave a short silence after speech before commit, or adjust endpointing. The synthetic noise test clipped one word over WebSocket.

The remote Mac must be awake and logged in. The server never listens on a public interface.
