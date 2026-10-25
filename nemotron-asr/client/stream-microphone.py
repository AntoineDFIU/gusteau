#!/usr/bin/env python3
"""Client-side microphone capture to NeMo's realtime PCM16 WebSocket."""
import argparse
import asyncio
import json
import logging
import signal
import time

import sounddevice as sd
import websockets


async def session(url, sample_rate, stop):
    async with websockets.connect(url, max_size=4_000_000, ping_interval=20) as ws:
        created = json.loads(await ws.recv())
        if created.get("type") != "session.created":
            raise RuntimeError(f"Unexpected handshake: {created}")
        await ws.send(json.dumps({"type": "session.update", "session": {
            "sample_rate": sample_rate, "language": "en-US", "endpointing_ms": 650}}))
        queue = asyncio.Queue(maxsize=100)
        loop = asyncio.get_running_loop()

        def audio_callback(indata, frames, timing, status):
            if status:
                logging.warning("Microphone: %s", status)
            data = bytes(indata)
            def enqueue():
                if not queue.full():
                    queue.put_nowait(data)
            loop.call_soon_threadsafe(enqueue)

        async def send_audio():
            while not stop.is_set():
                try:
                    data = await asyncio.wait_for(queue.get(), 0.2)
                except asyncio.TimeoutError:
                    continue
                await ws.send(data)
            await ws.send(json.dumps({"type": "input_audio_buffer.commit"}))

        async def receive():
            async for raw in ws:
                event = json.loads(raw)
                kind = event.get("type", "")
                if kind.endswith(".delta"):
                    print("\rpartial: " + str(event.get("delta", "")), end="", flush=True)
                elif kind.endswith(".completed"):
                    print("\nfinal:", event.get("transcript", event.get("text", "")), flush=True)
                elif kind == "error":
                    logging.error("Server: %s", event)
                else:
                    logging.debug("Event: %s", event)

        with sd.RawInputStream(samplerate=sample_rate, channels=1, dtype="int16",
                               blocksize=sample_rate // 10, callback=audio_callback):
            logging.info("Listening on client microphone at %d Hz", sample_rate)
            sender = asyncio.create_task(send_audio())
            receiver = asyncio.create_task(receive())
            await stop.wait()
            await sender
            await asyncio.sleep(1)
            receiver.cancel()
            await asyncio.gather(receiver, return_exceptions=True)


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://127.0.0.1:18080/v1/audio/transcriptions/realtime")
    parser.add_argument("--sample-rate", type=int, default=16000)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, stop.set)
    while not stop.is_set():
        try:
            await session(args.url, args.sample_rate, stop)
        except (OSError, websockets.WebSocketException) as exc:
            logging.warning("Connection lost: %s; retrying in 2 seconds", exc)
            await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(main())
