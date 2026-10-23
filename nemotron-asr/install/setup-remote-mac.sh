#!/bin/sh
set -eu
HOST=${1:-macbook-pro-m5-max.local}
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ssh "$HOST" '
  if ! test -x "$HOME/.local/bin/nemo-speech"; then
    installer=$(mktemp /tmp/install-nemo-speech.XXXXXX)
    trap '\''rm -f "$installer"'\'' EXIT
    curl -fsSL https://raw.githubusercontent.com/NVIDIA/NeMo-Speech.cpp/main/scripts/install.sh -o "$installer"
    echo "Reviewing installer at $installer before execution" >&2
    sh -n "$installer"
    sh "$installer" --backend metal --no-modify-path
  fi
  "$HOME/.local/bin/nemo-speech" doctor
  "$HOME/.local/bin/nemo-speech" pull nemotron-3.5
  "$HOME/.local/bin/nemo-speech" pull magpie
'
ssh "$HOST" 'mkdir -p "$HOME/Library/Application Support/GusteauNemotron" "$HOME/Library/Logs/GusteauNemotron" "$HOME/Library/LaunchAgents"'
scp "$ROOT/server/serve.sh" "$HOST:Library/Application Support/GusteauNemotron/serve.sh"
scp "$ROOT/server/launchagent.plist" "$HOST:Library/LaunchAgents/com.jpdodel.gusteau.nemotron-asr.plist"
ssh "$HOST" 'chmod 755 "$HOME/Library/Application Support/GusteauNemotron/serve.sh"; plutil -lint "$HOME/Library/LaunchAgents/com.jpdodel.gusteau.nemotron-asr.plist"'
echo 'Files copied. Start after confirming port 8080 is free: ssh HOST "sh ~/Library/Application\ Support/GusteauNemotron/serve.sh" or use launchctl bootstrap.'
