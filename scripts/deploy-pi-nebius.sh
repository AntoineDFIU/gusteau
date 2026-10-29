#!/usr/bin/env bash
set -euo pipefail

# One-command Raspberry Pi deployment. Run from the Gusteau repository.
APP_DIR="${APP_DIR:-$PWD}"
SERVICE_NAME="${SERVICE_NAME:-gusteau}"
ENV_FILE="${ENV_FILE:-$APP_DIR/gusteau.env}"
PORT="${GUSTEAU_PORT:-8080}"
MODEL="${LLM_MODEL:-nvidia/Llama-3_3-Nemotron-Super-49B-v1_5}"

[[ -f "$APP_DIR/package.json" ]] || { echo "Run from the Gusteau repository." >&2; exit 1; }
command -v npm >/dev/null || { echo "Node.js/npm is required." >&2; exit 1; }
command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 1; }

read -r -s -p "Paste Nebius Token Factory API key (hidden): " LLM_API_KEY
echo
[[ -n "$LLM_API_KEY" ]] || { echo "No API key entered." >&2; exit 1; }

umask 077
cat > "$ENV_FILE" <<EOF
GUSTEAU_HOST=0.0.0.0
GUSTEAU_PORT=$PORT
GUSTEAU_PROVIDER=nebius
LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1
LLM_API_KEY=$LLM_API_KEY
LLM_MODEL=$MODEL
EOF
unset LLM_API_KEY
chmod 600 "$ENV_FILE"

npm ci
npm run build
cp "$APP_DIR/deploy/gusteau_server.py" "$APP_DIR/"
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl restart "$SERVICE_NAME"
sleep 2
curl --fail --silent --show-error "http://127.0.0.1:$PORT/api/health"
echo
echo "Gusteau is running."
