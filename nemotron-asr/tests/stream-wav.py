#!/usr/bin/env python3
"""Replay a 16 kHz mono PCM16 WAV into the documented realtime socket."""
import argparse
import asyncio
import json
import time
import wave

import websockets


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('wav')
    parser.add_argument('--url', default='ws://127.0.0.1:18080/v1/audio/transcriptions/realtime')
    parser.add_argument('--realtime', action='store_true')
    args = parser.parse_args()
    with wave.open(args.wav) as audio:
        assert audio.getnchannels() == 1 and audio.getsampwidth() == 2 and audio.getframerate() == 16000
        frames = [audio.readframes(1600) for _ in range((audio.getnframes() + 1599) // 1600)]
    start = time.perf_counter()
    first_partial = None
    final = None
    async with websockets.connect(args.url, max_size=4_000_000) as ws:
        assert json.loads(await ws.recv())['type'] == 'session.created'
        await ws.send(json.dumps({'type': 'session.update', 'session': {
            'sample_rate': 16000, 'language': 'en-US', 'endpointing_ms': 650}}))

        async def receive():
            nonlocal first_partial, final
            async for raw in ws:
                event = json.loads(raw)
                if event.get('type', '').endswith('.delta') and first_partial is None:
                    first_partial = time.perf_counter() - start
                if event.get('type', '').endswith('.completed'):
                    final = event.get('transcript', event.get('text'))
                    break
                if event.get('type') == 'error':
                    raise RuntimeError(event)

        listener = asyncio.create_task(receive())
        for frame in frames:
            await ws.send(frame)
            if args.realtime:
                await asyncio.sleep(len(frame) / 32000)
        await ws.send(json.dumps({'type': 'input_audio_buffer.commit'}))
        await asyncio.wait_for(listener, timeout=90)
    print(json.dumps({'text': final, 'first_partial_seconds': first_partial,
                      'final_seconds': time.perf_counter() - start,
                      'audio_seconds': sum(map(len, frames)) / 32000}, indent=2))


if __name__ == '__main__':
    asyncio.run(main())
