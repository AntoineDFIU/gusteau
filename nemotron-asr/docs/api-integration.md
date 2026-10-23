# API integration

- Readiness: `GET http://127.0.0.1:18080/ready`.
- Model listing: `GET http://127.0.0.1:18080/v1/models`.
- File transcription: multipart `POST http://127.0.0.1:18080/v1/audio/transcriptions`, with `file`, optional `model`, and `language=en-US`.
- Realtime: `ws://127.0.0.1:18080/v1/audio/transcriptions/realtime`.
- Speech synthesis: JSON `POST http://127.0.0.1:18080/v1/audio/speech` with `input`, `voice` (`Aria`, `John`, `Sofia`, `Jason`, or `Leo`), `language: "en-US"`, and `response_format: "wav"`. Play the returned WAV on the client.

The realtime socket first sends `session.created`. Send one `session.update` before audio, with `sample_rate: 16000`, `language: "en-US"`, and `endpointing_ms: 650`. Send binary 16 kHz mono PCM16 little-endian frames, around 100 ms per frame. The server emits `conversation.item.input_audio_transcription.delta` and `.completed`. Send `input_audio_buffer.commit` to flush at the end of an utterance or session; close the socket after receiving the final event. Use an SSH tunnel or a same-origin local proxy for a browser client. The demo implements capture, resampling, reconnect, and cleanup.

The client should pass final text to the culinary reasoning LLM, then synthesize the LLM response with Magpie. Nemotron does not answer cooking questions. The speech HTTP response is buffered; there is no chunked audio in this endpoint. Exact event contract: [NVIDIA API reference](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/api.md#websocket-v1audiotranscriptionsrealtime).
