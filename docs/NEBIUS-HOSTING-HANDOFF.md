# Gusteau — Raspberry Pi + Nebius Token Factory Handoff

The Raspberry Pi hosts the frontend and API proxy. Nebius Token Factory
provides NVIDIA Nemotron text inference. ASR/TTS continue using the existing
Mac speech service.

```text
Browser → HTTPS/Tailscale Funnel → Raspberry Pi → Token Factory → Nemotron
                                      └────────→ Mac ASR/TTS
```

## Teammate provides

- SSH access to the Raspberry Pi.
- A Nebius Token Factory API key, entered privately on the Pi.
- Mac ASR/TTS access if voice is demonstrated.
- Tailscale/domain access if the public URL changes.

The teammate does not need to edit code or configure Docker.

## One-command deployment

Run this from the repository on the Pi. It asks for the Token Factory key with
hidden input, creates the protected `gusteau.env`, builds the app, restarts the
service, and checks health:

```bash
cd ~/gusteau
git pull origin codex/hackathon-audit
chmod +x scripts/deploy-pi-nebius.sh
./scripts/deploy-pi-nebius.sh
```

The only prompt is `Paste Nebius Token Factory API key (hidden):`. Never paste
the key into chat or a shared document.

## Deployment

On the Pi, pull `codex/hackathon-audit`, run `npm ci` and `npm run build`, and
copy `dist` plus `deploy/gusteau_server.py` into the existing deployment folder.
Create `gusteau.env` with these values:

`GUSTEAU_HOST=0.0.0.0`

`GUSTEAU_PORT=8080`

`GUSTEAU_PROVIDER=nebius`

`LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1`

`LLM_API_KEY=PRIVATE_TOKEN_FACTORY_KEY`

`LLM_MODEL=nvidia/Llama-3_3-Nemotron-Super-49B-v1_5`

Keep the key only on the Pi. Never commit it or expose it to the browser.
Restart the existing `gusteau.service` systemd service after copying the build.

## Verification

Run `curl http://127.0.0.1:8080/api/health`. The response must show
`provider: nebius`. Open the public URL, confirm recipes load, confirm the UI
is not in mock mode, and ask a real cooking question.

Existing public URL:

`https://antoineraspi.tailb406ce.ts.net/Gusteau/`

Preserve the `/Gusteau` Tailscale Funnel path. Do not replace Funnel with
`tailscale serve` if another application shares the same Tailscale address.

Keep the Pi powered on and the Mac speech service awake during judging.

## Update commands

SSH to the Pi, run `git pull origin codex/hackathon-audit`, `npm ci`, and
`npm run build`; copy `dist` and `deploy/gusteau_server.py`, then run
`sudo systemctl restart gusteau`.

## Hackathon checklist

- [ ] Public HTTPS URL works in a fresh browser.
- [ ] UI reports Nebius/Nemotron, not mock mode.
- [ ] A real cooking question returns a live model response.
- [ ] Browser never receives the Token Factory key.
- [ ] Pi and Mac stay powered on and connected.
- [ ] Repository has the root `LICENSE` and setup README.
- [ ] Public demo video is 3 minutes or shorter.
- [ ] Devpost includes repository URL, demo URL, video, category, and description.

Recommended category: **Best Apps and Agents**.
