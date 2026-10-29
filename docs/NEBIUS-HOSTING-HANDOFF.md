# Gusteau — Nebius Hosting Handoff

Use this guide to deploy Gusteau for the Nebius x NVIDIA Global AI Hackathon.

```text
Browser → HTTPS → Nebius VM → Gusteau server → Token Factory → Nemotron
```

Keep the Token Factory key on the VM only. Never commit it or expose it to the browser.

## Prerequisites

- Nebius AI Cloud and Token Factory access
- Token Factory API key
- Ubuntu Nebius VM with public IP and SSH access
- Docker installed on the VM
- Optional domain name for HTTPS

## Deploy

Allow ports 22, 80, 443, and temporary testing port 8080 in the VM security group.

```bash
ssh ubuntu@VM_PUBLIC_IP
sudo apt update
sudo apt install -y docker.io git
sudo systemctl enable --now docker
git clone --branch codex/hackathon-audit https://github.com/AntoineDFIU/gusteau.git
cd gusteau
```

Build and run:

```bash
docker build -t gusteau:hackathon .
docker rm -f gusteau 2>/dev/null || true
docker run -d --name gusteau --restart unless-stopped -p 8080:8080 \
  -e GUSTEAU_PROVIDER=nebius \
  -e GUSTEAU_HOST=0.0.0.0 \
  -e GUSTEAU_PORT=8080 \
  -e LLM_API_KEY='PASTE_TOKEN_FACTORY_KEY_HERE' \
  -e LLM_MODEL='nvidia/Llama-3_3-Nemotron-Super-49B-v1_5' \
  gusteau:hackathon
```

Replace the placeholder with the private key. Do not save the command in a
shared document or commit it with the real key.

## Verify

```bash
curl -fsS http://127.0.0.1:8080/Gusteau/api/health
docker logs -f gusteau
```

Expected health response:

```json
{"ok": true, "provider": "nebius"}
```

Open `http://VM_PUBLIC_IP:8080/Gusteau/`. Confirm recipes load, the badge says
Nebius/Nemotron, and a cooking question receives a live response.

## HTTPS

Point a DNS `A` record such as `gusteau.example.com` to the VM IP, then:

```bash
sudo apt install -y caddy
```

Create `/etc/caddy/Caddyfile`:

```caddy
gusteau.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

Restart Caddy:

```bash
sudo systemctl restart caddy
```

Final demo URL: `https://gusteau.example.com/Gusteau/`.

## Update

```bash
cd gusteau
git pull origin codex/hackathon-audit
docker build -t gusteau:hackathon .
docker rm -f gusteau
```

Run the same `docker run` command again with the private key.

## Hackathon checklist

- [ ] Public HTTPS demo URL works in a fresh browser.
- [ ] App visibly uses Nebius/NVIDIA Nemotron.
- [ ] A real cooking question gets a live response.
- [ ] Public repository has the root `LICENSE` and setup README.
- [ ] No credentials are committed.
- [ ] Public YouTube demo is 3 minutes or shorter.
- [ ] Devpost includes repository, demo URL, video, category, and description.

Recommended category: **Best Apps and Agents**.

If the app says mock mode, recreate the container with
`GUSTEAU_PROVIDER=nebius`. If the page refuses the connection, check
`docker ps`, `docker logs gusteau`, port 8080, and the Nebius security group.
