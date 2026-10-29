# Gusteau Hackathon Setup — AI Agent Instructions

Give this document to an AI coding agent with access to the Gusteau repository
and the teammate's Raspberry Pi terminal. The agent must complete the update,
deployment, verification, and report. The teammate should not manually edit
code or deployment files.

## Goal

Deploy Gusteau for the Nebius x NVIDIA Global AI Hackathon. The app runs on
the Raspberry Pi, text reasoning uses NVIDIA Nemotron through Nebius Token
Factory, and ASR/TTS use the existing Mac speech service.

## Required human input

The teammate only provides authorized SSH access to the Pi and enters the
private Token Factory key when asked. Never request the key in chat or commit it.

## Agent workflow

1. Work on `codex/hackathon-audit` and pull the latest `origin/main` first.
2. Read `README.md`, `deploy/gusteau_server.py`, `deploy/gusteau.service`,
   `docs/NEBIUS-HOSTING-HANDOFF.md`, and this document.
3. Run `npm ci` and `npm run build`; fix safe build issues if necessary.
4. SSH to the authorized Raspberry Pi and pull the branch.
5. Run `chmod +x scripts/deploy-pi-nebius.sh` and
   `./scripts/deploy-pi-nebius.sh` on the Pi. The script builds the frontend,
   prompts for the hidden key, creates protected `gusteau.env`, installs the
   server file, restarts systemd, and checks health.
6. Verify `/api/health`, public HTTPS access, and a real cooking question.
7. Confirm the browser never receives the key and the UI is not mock mode.
8. Preserve the Tailscale Funnel `/Gusteau` route if it shares the address
    with another application.
9. Run `npm run build`, `git diff --check`, and `git status`.
10. Report branch, commit, provider/model tested, health result, public URL,
    and any blocker. Never claim completion without public and live-model tests.

## Safety

- Never commit or expose credentials.
- Do not create paid resources or change DNS without authorization.
- Do not delete the existing Pi deployment.
- Do not claim Nebius/Nemotron use if only mock mode was tested.
- Preserve existing validation and application behavior.
- If login, MFA, key entry, DNS, YouTube, or Devpost requires the owner,
  pause only at that exact step and state the one precise action needed.

## Submission requirements

Provide a public HTTPS demo URL, public repository with license and setup
instructions, public demo video of 3 minutes or less, and Devpost details.
Recommended category: **Best Apps and Agents**.
