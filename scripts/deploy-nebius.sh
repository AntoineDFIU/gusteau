#!/usr/bin/env bash
set -euo pipefail

APP_NAME="gusteau"
IMAGE_NAME="gusteau:hackathon"
PORT="${GUSTEAU_PORT:-8080}"
MODEL="${LLM_MODEL:-nvidia/Llama-3_3-Nemotron-Super-49B-v1_5}"

command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
command -v curl >/dev/null || { echo "curl is required." >&2; exit 1; }

read -r -s -p "Paste Nebius Token Factory API key (hidden): " LLM_API_KEY
echo
[[ -n "${LLM_API_KEY}" ]] || { echo "No API key entered." >&2; exit 1; }

docker build -t "${IMAGE_NAME}" .
docker rm -f "${APP_NAME}" >/dev/null 2>&1 || true
docker run -d --name "${APP_NAME}" --restart unless-stopped \
  -p "${PORT}:8080" \
  -e GUSTEAU_PROVIDER=nebius \
  -e GUSTEAU_HOST=0.0.0.0 \
  -e GUSTEAU_PORT=8080 \
  -e LLM_API_KEY="${LLM_API_KEY}" \
  -e LLM_MODEL="${MODEL}" \
  "${IMAGE_NAME}" >/dev/null
unset LLM_API_KEY
sleep 2
curl --fail --silent --show-error "http://127.0.0.1:${PORT}/Gusteau/api/health"
echo
echo "Gusteau is running on port ${PORT}."
