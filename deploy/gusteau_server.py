#!/usr/bin/env python3
"""
Gusteau production server (standard library only; made for a Raspberry Pi).

  * Serves the built app from ./dist (next to this file, or $GUSTEAU_DIST).
  * GET  /api/config            -> provider + model names for the browser (no secrets).
  * POST /api/llm/chat/completions -> forwarded to $LLM_BASE_URL/chat/completions,
    adding $LLM_API_KEY if set. Only this one route is proxied.
  * GET  /api/health            -> {"ok": true}

Configuration is the same set of variables vite.config.ts uses in development:
  GUSTEAU_PORT (8080), GUSTEAU_HOST (0.0.0.0), GUSTEAU_PROVIDER (mock|nebius|ollama),
  LLM_BASE_URL, LLM_API_KEY, LLM_MODEL or LLM_VISION_MODEL/LLM_TEXT_MODEL,
  LLM_EXTRA_BODY (JSON), LLM_TIMEOUT_MS.

Sleeping model host (e.g. a MacBook running Ollama):
  LLM_WAKE_PORTS  comma-separated TCP ports the host advertises over Bonjour,
                  e.g. "445,7000,22" (file sharing, AirPlay, SSH). A connection
                  to one of them triggers macOS "Wake on Demand". When set, the
                  server wakes the host before a model request if it doesn't
                  answer, and keeps it awake while the request runs. Off by default.
  LLM_WAKE_WAIT   seconds to wait for the host to wake (default 25).

Technique videos:
  GET /api/videos?q=... returns short YouTube videos for a cooking technique, read
  from YouTube's public search page (no key needed; see search_videos below).
"""

import json
import mimetypes
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PRESETS = {
    "nebius": {
        "base_url": "https://api.tokenfactory.nebius.com/v1",
        "vision": "nvidia/Nemotron-Nano-12B-v2-VL",
        "text": "nvidia/Llama-3_3-Nemotron-Super-49B-v1_5",
        "extra": {},
    },
    # Thinking models on Ollama otherwise spend the whole token budget reasoning.
    "ollama": {"base_url": "http://localhost:11434/v1", "vision": "", "text": "", "extra": {"reasoning_effort": "none"}},
}

MAX_BODY = 25 * 1024 * 1024  # photos are downscaled in the browser; this is a safety cap
UPSTREAM_TIMEOUT = 300  # seconds; a large local model may need to load first


# ── Waking a sleeping model host ─────────────────────────────
def _port_answers(host, port, timeout):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


# ── Technique video search ───────────────────────────────────
# Keyless: reads YouTube's public search results page and the data embedded
# in it. No API key or quota, but YouTube's terms don't allow automated
# access, and it can break whenever YouTube changes that page.
_video_cache = {}
_MAX_VIDEO_SECONDS = 5 * 60
_BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
    "Cookie": "SOCS=CAI; CONSENT=YES+1",
}


def _videos_from_search_page(page):
    start = page.find("var ytInitialData = ")
    end = page.find(";</script>", start)
    if start < 0 or end < 0:
        raise ValueError("YouTube search page changed")
    found = []

    def walk(node):
        if isinstance(node, dict):
            v = node.get("videoRenderer")
            if isinstance(v, dict) and v.get("videoId"):
                parts = (v.get("lengthText") or {}).get("simpleText", "").split(":")
                length = 0
                for part in parts:
                    length = length * 60 + int(part) if part.isdigit() else length
                # Live streams have no length; long videos aren't "short".
                if 0 < length <= _MAX_VIDEO_SECONDS:
                    found.append({
                        "id": v["videoId"],
                        "title": ((v.get("title") or {}).get("runs") or [{}])[0].get("text", ""),
                        "channel": ((v.get("ownerText") or {}).get("runs") or [{}])[0].get("text", ""),
                        "thumb": f"https://i.ytimg.com/vi/{v['videoId']}/mqdefault.jpg",
                    })
                return
            for child in node.values():
                walk(child)
        elif isinstance(node, list):
            for child in node:
                walk(child)

    walk(json.loads(page[start + len("var ytInitialData = "):end]))
    return found[:6]


def _embeddable(video_id):
    """Whether the owner allows the video on other sites (oEmbed refuses the rest)."""
    watch = urllib.parse.quote(f"https://www.youtube.com/watch?v={video_id}", safe="")
    try:
        with urllib.request.urlopen(f"https://www.youtube.com/oembed?format=json&url={watch}", timeout=5):
            return True
    except (urllib.error.URLError, TimeoutError):
        return False


def search_videos(query):
    """Short YouTube videos (5 minutes or less) for a cooking technique. Cached per query."""
    cache_key = query.lower()
    if cache_key in _video_cache:
        return 200, {"videos": _video_cache[cache_key]}
    # sp=EgIYAQ%3D%3D is YouTube's "Under 4 minutes" filter.
    url = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}&sp=EgIYAQ%253D%253D&hl=en&gl=US"
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=_BROWSER_HEADERS), timeout=10) as r:
            videos = _videos_from_search_page(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return 502, {"error": f"YouTube {e.code}"}
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return 502, {"error": str(e)}
    videos = [v for v in videos if _embeddable(v["id"])]
    _video_cache[cache_key] = videos
    return 200, {"videos": videos}


class HostWaker:
    """Wakes a sleeping Mac via Bonjour Wake on Demand and keeps it awake during a request."""

    def __init__(self, base_url, wake_ports, wait_seconds):
        parsed = urllib.parse.urlparse(base_url)
        self.host = parsed.hostname
        self.port = parsed.port or (443 if parsed.scheme == "https" else 80)
        self.wake_ports = wake_ports
        self.wait = wait_seconds

    @property
    def enabled(self):
        return bool(self.host and self.wake_ports)

    def knock(self):
        for p in self.wake_ports:
            _port_answers(self.host, p, 2)

    def ensure_awake(self):
        """True when the model port answers, waking the host first if needed."""
        if not self.enabled or _port_answers(self.host, self.port, 1.5):
            return True
        print(f"[gusteau] {self.host} is not answering; sending wake-on-demand knock", file=sys.stderr, flush=True)
        self.knock()
        deadline = time.monotonic() + self.wait
        while time.monotonic() < deadline:
            if _port_answers(self.host, self.port, 1.5):
                print(f"[gusteau] {self.host} is awake", file=sys.stderr, flush=True)
                return True
            time.sleep(0.5)
        return False

    def keep_awake(self, stop_event, every=8):
        """Background loop: knock until stop_event is set, so the host can't doze mid-answer."""
        while not stop_event.wait(every):
            self.knock()


def load_config():
    env = os.environ
    provider = env.get("GUSTEAU_PROVIDER", "mock").strip().lower() or "mock"
    preset = PRESETS.get(provider, {"base_url": "", "vision": "", "text": "", "extra": {}})
    text = env.get("LLM_TEXT_MODEL") or env.get("LLM_MODEL") or preset["text"]
    vision = env.get("LLM_VISION_MODEL") or env.get("LLM_MODEL") or preset["vision"]
    extra = preset["extra"]
    if env.get("LLM_EXTRA_BODY"):
        try:
            extra = json.loads(env["LLM_EXTRA_BODY"])
        except json.JSONDecodeError:
            print("[gusteau] LLM_EXTRA_BODY is not valid JSON; ignoring it", file=sys.stderr)
    if provider == "nebius":
        label = "NVIDIA Nemotron · Nebius"
    elif provider == "ollama":
        label = f"Ollama · {text}"
    else:
        label = f"{provider} · {text}"
    public = (
        {"provider": "mock"}
        if provider == "mock"
        else {
            "provider": provider,
            "label": label,
            "visionModel": vision,
            "textModel": text,
            "extraBody": extra,
            "timeoutMs": int(env.get("LLM_TIMEOUT_MS") or 120000),
        }
    )
    wake_ports = [int(p) for p in env.get("LLM_WAKE_PORTS", "").replace(" ", "").split(",") if p.isdigit()]
    return {
        "base_url": (env.get("LLM_BASE_URL") or preset["base_url"]).rstrip("/"),
        "api_key": env.get("LLM_API_KEY", ""),
        "public": public,
        "wake_ports": wake_ports,
        "wake_wait": float(env.get("LLM_WAKE_WAIT") or 25),
    }


CONFIG = load_config()
# The build's base path (vite.config.ts BUILD_BASE). Requests may arrive with or without it.
PATH_PREFIX = "/" + (os.environ.get("GUSTEAU_PATH_PREFIX") or "Gusteau").strip("/")
WAKER = HostWaker(CONFIG["base_url"], CONFIG["wake_ports"], CONFIG["wake_wait"])
DIST = Path(os.environ.get("GUSTEAU_DIST") or Path(__file__).resolve().parent / "dist").resolve()
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(SimpleHTTPRequestHandler):
    server_version = "Gusteau/1.0"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(DIST), **kwargs)

    # ── helpers ──
    def _json(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        path = self.path.split("?", 1)[0]
        if path.startswith("/assets/"):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif not path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    # ── routes ──
    def _strip_prefix(self):
        """Accept /Gusteau/... (public path via Tailscale) and plain /... (LAN) alike."""
        p = self.path
        if p == PATH_PREFIX or p.startswith(PATH_PREFIX + "/") or p.startswith(PATH_PREFIX + "?"):
            rest = p[len(PATH_PREFIX):]
            self.path = rest if rest.startswith("/") else "/" + rest

    def do_HEAD(self):
        self._strip_prefix()
        return super().do_HEAD()

    def do_GET(self):
        self._strip_prefix()
        path = self.path.split("?", 1)[0]
        if path == "/api/config":
            return self._json(200, CONFIG["public"])
        if path == "/api/health":
            return self._json(200, {"ok": True, "provider": CONFIG["public"]["provider"]})
        if path == "/api/videos":
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query).get("q", [""])[0].strip()[:120]
            if not q:
                return self._json(400, {"error": "missing q"})
            return self._json(*search_videos(q))
        if path.startswith("/api/"):
            return self._json(404, {"error": "not found"})
        # Single-page app: unknown non-file paths fall back to index.html.
        target = (DIST / path.lstrip("/")).resolve()
        if path != "/" and (not str(target).startswith(str(DIST)) or not target.exists()):
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self):
        self._strip_prefix()
        path = self.path.split("?", 1)[0]
        if path != "/api/llm/chat/completions":
            return self._json(404, {"error": "not found"})
        if not CONFIG["base_url"] or CONFIG["public"]["provider"] == "mock":
            return self._json(503, {"error": "no model provider configured"})
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self._json(413, {"error": "request body missing or too large"})
        body = self.rfile.read(length)
        if not WAKER.ensure_awake():
            return self._json(503, {"error": f"model host {WAKER.host} is asleep or offline"})
        headers = {"Content-Type": "application/json"}
        if CONFIG["api_key"]:
            headers["Authorization"] = f"Bearer {CONFIG['api_key']}"
        req = urllib.request.Request(f"{CONFIG['base_url']}/chat/completions", data=body, headers=headers, method="POST")
        stop = threading.Event()
        if WAKER.enabled:
            threading.Thread(target=WAKER.keep_awake, args=(stop,), daemon=True).start()
        try:
            with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT) as up:
                data = up.read()
                status = up.status
        except urllib.error.HTTPError as e:
            data, status = e.read(), e.code
        except Exception as e:  # network error, timeout, DNS…
            return self._json(502, {"error": f"model provider unreachable: {e}"})
        finally:
            stop.set()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def list_directory(self, path):  # never expose directory listings
        self.send_error(404, "Not found")
        return None

    def log_message(self, fmt, *args):
        # Keep the journal readable: log API calls and errors, skip static asset hits.
        if self.path.startswith("/api/") or (len(args) > 1 and str(args[1])[:1] in "45"):
            sys.stderr.write("[gusteau] %s %s\n" % (self.address_string(), fmt % args))


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        # A browser that gives up or navigates away is not an error worth a traceback.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def main():
    if not (DIST / "index.html").exists():
        sys.exit(f"[gusteau] no build found at {DIST} (run `npm run build` and copy dist/ here)")
    host = os.environ.get("GUSTEAU_HOST", "0.0.0.0")
    port = int(os.environ.get("GUSTEAU_PORT", "8080"))
    pub = CONFIG["public"]
    where = f" via {CONFIG['base_url']}" if pub["provider"] != "mock" else ""
    print(f"[gusteau] serving {DIST} on http://{host}:{port} · provider: {pub.get('label', 'mock')}{where}", flush=True)
    if WAKER.enabled:
        print(f"[gusteau] wake-on-demand for {WAKER.host} via ports {WAKER.wake_ports}", flush=True)
    Server((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
