#!/usr/bin/env python3
"""Upload a WAV to the tunneled NeMo transcription API (stdlib only)."""
import argparse
import json
import time
import urllib.request
import uuid
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("--url", default="http://127.0.0.1:18080")
    parser.add_argument("--model", default="nemotron-3.5")
    args = parser.parse_args()
    boundary = uuid.uuid4().hex
    file_bytes = args.wav.read_bytes()
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{args.model}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"language\"\r\n\r\nen-US\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{args.wav.name}\"\r\n"
        "Content-Type: audio/wav\r\n\r\n"
    ).encode() + file_bytes + f"\r\n--{boundary}--\r\n".encode()
    request = urllib.request.Request(
        args.url.rstrip("/") + "/v1/audio/transcriptions",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=120) as response:
        result = json.load(response)
    print(json.dumps({"text": result.get("text"), "seconds": round(time.perf_counter() - start, 3),
                      "model": args.model, "server": args.url}, indent=2))


if __name__ == "__main__":
    main()
