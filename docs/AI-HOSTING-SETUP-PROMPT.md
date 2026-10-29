# Gusteau Cloud Setup — AI Agent Instructions

Paste this document into an AI coding agent with access to the Gusteau
repository and the teammate's Nebius terminal. The agent must perform the
setup, deployment, verification, and reporting—not just explain them.

The teammate should not manually edit code, Docker files, environment files,
or deployment commands. The AI should do all of that. The only required human
input is authorized Nebius access and the private Token Factory key when the
deployment script requests it.

## Goal

Deploy Gusteau for the Nebius x NVIDIA Global AI Hackathon using Nebius AI
Cloud or Token Factory and an NVIDIA open-source model, preferably Nemotron.
Use the **Best Apps and Agents** category unless the owner chooses another.

## Instructions to the AI agent

1. Work on `codex/hackathon-audit`; do not modify `main` directly.
2. Read `README.md`, `Dockerfile`, `deploy/gusteau_server.py`,
   `deploy/gusteau.env.example`, and `docs/NEBIUS-HOSTING-HANDOFF.md`.
3. Run `npm ci` and `npm run build`. Fix small build errors safely if needed.
4. Deploy this architecture:
   `Browser → HTTPS → Nebius VM → Gusteau server → Token Factory → Nemotron`.
5. Use the repository Dockerfile. Keep the API key server-side only.
6. Ask the owner to enter the private Token Factory key through a protected
   terminal or secret manager. Never print, commit, or screenshot the key.
7. Use these runtime values:

   `GUSTEAU_PROVIDER=nebius`

   `GUSTEAU_HOST=0.0.0.0`

   `GUSTEAU_PORT=8080`

   `LLM_API_KEY=<private Token Factory key>`

   `LLM_MODEL=nvidia/Llama-3_3-Nemotron-Super-49B-v1_5`

8. If that model ID is unavailable, query the Token Factory catalog and use
   an available NVIDIA Nemotron or other NVIDIA open-source model.
9. On the VM, run the automated deployment script. It hides the key while it
   is entered, builds the Docker image, starts the service, and checks health:

   `chmod +x scripts/deploy-nebius.sh`

   `./scripts/deploy-nebius.sh`

10. Verify `curl http://127.0.0.1:8080/Gusteau/api/health`, inspect
    `docker logs gusteau`, open the UI, and test a real cooking question.
    The health response must report `provider: nebius` and the UI must not be
    in mock mode.
11. Configure HTTPS with Caddy or Nginx, reverse proxying to port 8080. The
    final URL should be `https://<domain>/Gusteau/`.
12. Update the README with the non-secret provider, model, URL, and setup
    details. Run `npm run build`, `git diff --check`, and `git status`.
13. Report the branch, commit, build result, provider/model actually tested,
    health result, public URL, and any remaining blocker. Do not claim success
    without testing the public URL and a live model request.

## Safety rules

- Never commit or expose credentials.
- Do not create paid resources without owner authorization.
- Do not delete existing deployments or repositories.
- Do not claim Nebius/Nemotron usage if only mock mode was tested.
- Preserve existing validation and application behavior.
- If login, MFA, billing, DNS ownership, YouTube upload, or Devpost submission
  is required, pause only at that exact step and state the single human action
  needed; complete all other work first.

## Human-only actions that may remain

Nebius login/MFA, billing approval, private key entry, DNS ownership,
YouTube upload, and Devpost submission may require the owner. Everything else
should be completed by the AI agent using these instructions.
