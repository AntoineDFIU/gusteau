import importlib.util
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

spec = importlib.util.spec_from_file_location("provider_server", Path(__file__).parents[1] / "deploy/gusteau_server.py")
app = importlib.util.module_from_spec(spec)
spec.loader.exec_module(app)


class ModelBackend(BaseHTTPRequestHandler):
    calls = []

    def do_GET(self):
        self._reply()

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        self._reply()

    def _reply(self):
        ModelBackend.calls.append((self.path, self.headers.get("Authorization")))
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"data": [{"id": "test-model"}], "choices": [{"message": {"content": "OK"}}]}).encode())

    def log_message(self, *_):
        pass


class QuietProxy(app.Handler):
    def log_message(self, *_):
        pass


class ProviderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.backend = ThreadingHTTPServer(("127.0.0.1", 0), ModelBackend)
        cls.proxy = ThreadingHTTPServer(("127.0.0.1", 0), QuietProxy)
        for server in [cls.backend, cls.proxy]:
            threading.Thread(target=server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.proxy.server_port}/Gusteau"
        base = f"http://127.0.0.1:{cls.backend.server_port}"
        cls.env = {"GUSTEAU_PROVIDER": "ollama", "LLM_BASE_URL": base + "/ollama",
                   "LLM_MODEL": "qwen", "NEBIUS_BASE_URL": base + "/nebius", "NEBIUS_API_KEY": "cloud-test-secret"}
        app.CONFIG = app.load_config(cls.env)
        app.PROVIDERS = app.model_providers(app.CONFIG, cls.env)
        app.WAKERS = {name: app.HostWaker(config["base_url"], [], 1) for name, config in app.PROVIDERS.items()}
        app.PUBLIC_CONFIG = {**app.CONFIG["public"], "providers": [p["public"] for p in app.PROVIDERS.values()]}

    @classmethod
    def tearDownClass(cls):
        for server in [cls.proxy, cls.backend]:
            server.shutdown()
            server.server_close()

    def test_key_never_enters_public_config_or_ollama_requests(self):
        with urllib.request.urlopen(self.url + "/api/config") as response:
            public = response.read().decode()
        self.assertNotIn("cloud-test-secret", public)
        self.assertTrue(all(p["available"] for p in json.loads(public)["providers"]))
        with urllib.request.urlopen(self.url + "/api/llm/ollama/models"):
            pass
        self.assertEqual(ModelBackend.calls[-1], ("/ollama/models", None))

    def test_nebius_requests_use_only_nebius_credentials(self):
        request = urllib.request.Request(self.url + "/api/llm/nebius/chat/completions", data=b'{"model":"nemotron","messages":[]}')
        with urllib.request.urlopen(request) as response:
            self.assertEqual(json.load(response)["choices"][0]["message"]["content"], "OK")
        self.assertEqual(ModelBackend.calls[-1], ("/nebius/chat/completions", "Bearer cloud-test-secret"))
        with urllib.request.urlopen(self.url + "/api/llm/nebius/models"):
            pass
        self.assertEqual(ModelBackend.calls[-1], ("/nebius/models", "Bearer cloud-test-secret"))

    def test_legacy_route_keeps_the_default_ollama_provider(self):
        request = urllib.request.Request(self.url + "/api/llm/chat/completions", data=b'{"model":"qwen","messages":[]}')
        with urllib.request.urlopen(request):
            pass
        self.assertEqual(ModelBackend.calls[-1], ("/ollama/chat/completions", None))

    def test_missing_key_disables_nebius_without_disabling_ollama(self):
        env = {**self.env, "NEBIUS_API_KEY": ""}
        providers = app.model_providers(app.load_config(env), env)
        self.assertFalse(providers["nebius"]["public"]["available"])
        self.assertTrue(providers["ollama"]["public"]["available"])
        self.assertEqual(providers["nebius"]["wake_ports"], [])
        self.assertEqual(providers["nebius"]["public"]["extraBody"], {"chat_template_kwargs": {"enable_thinking": False}})
        self.assertEqual(providers["ollama"]["public"]["extraBody"], {"reasoning_effort": "none"})
        previous = app.PROVIDERS
        try:
            app.PROVIDERS = providers
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(self.url + "/api/llm/nebius/models")
            self.assertEqual(error.exception.code, 503)
            error.exception.close()
        finally:
            app.PROVIDERS = previous

    def test_unknown_provider_cannot_choose_an_arbitrary_upstream(self):
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(self.url + "/api/llm/other/models")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()


if __name__ == "__main__":
    unittest.main()
