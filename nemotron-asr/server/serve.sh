#!/bin/sh
set -eu
MODEL=${NEMO_MODEL:-nemotron-3.5}
TTS_MODEL=${NEMO_TTS_MODEL:-magpie}
CODEC_MODEL=${NEMO_CODEC_MODEL:-nano-codec}
PORT=${NEMO_PORT:-8080}
exec "$HOME/.local/bin/nemo-speech" serve --asr-model "$MODEL" --tts-model "$TTS_MODEL" --codec-model "$CODEC_MODEL" --device metal --host 127.0.0.1 --port "$PORT" --no-ui
