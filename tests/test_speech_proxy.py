import base64
import hashlib
import importlib.util
import json
import socket
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


spec = importlib.util.spec_from_file_location("gusteau_server", Path(__file__).parents[1] / "deploy/gusteau_server.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class SpeechBackend(BaseHTTPRequestHandler):
    authorization = None

    def do_GET(self):
        SpeechBackend.authorization = self.headers.get("Authorization")
        if self.headers.get("Upgrade") == "websocket":
            key = self.headers["Sec-WebSocket-Key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
            accept = base64.b64encode(hashlib.sha1(key.encode()).digest()).decode()
            self.connection.sendall((f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").encode() + b"\x81\x02hi")
            self.connection.sendall(self.rfile.read(8))
            self.close_connection = True
        else:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())

    def do_POST(self):
        SpeechBackend.authorization = self.headers.get("Authorization")
        self.rfile.read(int(self.headers["Content-Length"]))
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.end_headers()
        self.wfile.write(b"RIFF-test-audio")

    def log_message(self, *_):
        pass


class QuietProxy(app.Handler):
    def log_message(self, *_):
        pass


class SpeechProxyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = ThreadingHTTPServer(("127.0.0.1", 0), SpeechBackend)
        cls.proxy = ThreadingHTTPServer(("127.0.0.1", 0), QuietProxy)
        for server in [cls.backend, cls.proxy]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        app.ASR_BASE_URL = f"http://127.0.0.1:{cls.backend.server_port}"
        app.ASR_API_KEY = "test-speech-key"
        cls.url = f"http://127.0.0.1:{cls.proxy.server_port}"

    @classmethod
    def tearDownClass(cls):
        for server in [cls.proxy, cls.backend]:
            server.shutdown()
            server.server_close()

    def test_health_works_at_both_lan_and_production_paths(self):
        for prefix in ["", "/Gusteau"]:
            with urllib.request.urlopen(self.url + prefix + "/api/asr/health") as response:
                self.assertEqual(json.load(response)["status"], "ok")
        self.assertEqual(SpeechBackend.authorization, "Bearer test-speech-key")

    def test_magpie_audio_is_returned_as_audio(self):
        request = urllib.request.Request(self.url + "/Gusteau/api/asr/v1/audio/speech", data=b'{"input":"Hello"}')
        with urllib.request.urlopen(request) as response:
            self.assertEqual(response.headers["Content-Type"], "audio/wav")
            self.assertEqual(response.read(), b"RIFF-test-audio")

    def test_other_backend_routes_are_not_exposed(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.url + "/api/asr/admin")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_realtime_preserves_early_server_frames_and_masked_audio_frames(self):
        with socket.create_connection(self.proxy.server_address, timeout=3) as client:
            client.sendall(b"GET /Gusteau/api/asr/v1/audio/transcriptions/realtime HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n")
            stream = client.makefile("rb")
            headers = bytearray()
            while not headers.endswith(b"\r\n\r\n"):
                headers.extend(stream.read(1))
            self.assertIn(b"101 Switching Protocols", headers)
            self.assertEqual(stream.read(4), b"\x81\x02hi")
            frame = b"\x81\x82\x00\x00\x00\x00hi"
            client.sendall(frame)
            self.assertEqual(stream.read(8), frame)
            stream.close()


if __name__ == "__main__":
    unittest.main()
