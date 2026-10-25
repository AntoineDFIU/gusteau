#!/bin/sh
set -eu
LABEL=com.jpdodel.gusteau.nemotron-asr
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl kickstart -k "gui/$(id -u)/$LABEL"
curl -fsS --retry 30 --retry-all-errors --retry-delay 2 "http://127.0.0.1:${NEMO_PORT:-8080}/ready"
