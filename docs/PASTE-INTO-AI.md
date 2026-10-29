# Copy this into your AI agent

You are deploying the Gusteau hackathon project. Complete the setup instead of
giving me general instructions.

Repository: `https://github.com/AntoineDFIU/gusteau`
Branch: `codex/hackathon-audit`
Deployment: existing Raspberry Pi at `antoineraspi`
Public path: `https://antoineraspi.tailb406ce.ts.net/Gusteau/`

Read `docs/AI-HOSTING-SETUP-PROMPT.md` and
`docs/NEBIUS-HOSTING-HANDOFF.md`, then do the following:

1. Pull the latest `main` into the branch if needed.
2. SSH into the Raspberry Pi.
3. Pull `codex/hackathon-audit`.
4. Run `npm ci` and `npm run build`.
5. Run `chmod +x scripts/deploy-pi-nebius.sh`.
6. Run `./scripts/deploy-pi-nebius.sh`.
7. When the script prompts `Paste Nebius Token Factory API key (hidden):`, ask
   me to enter the key privately in the terminal. Never ask me to paste it into
   chat, never print it, and never commit it.
8. Verify `/api/health` reports `provider: nebius`.
9. Open the public URL and test a real cooking question.
10. Confirm the UI is not mock mode and the browser cannot see the key.
11. Preserve the existing Tailscale Funnel `/Gusteau` route.
12. Report only verified results: commit, build status, provider/model, health
    response, public URL, and any blocker.

Do not manually edit deployment files unless the script fails. Do not create a
new VM. Do not delete the current Pi deployment. Do not claim completion until
the public URL and a live Nemotron response are tested.

The only human input you should request is authorized Pi access and the private
Nebius Token Factory key when the script asks for it. Complete everything else
yourself.
