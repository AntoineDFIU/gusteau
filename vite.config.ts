import { spawn, type ChildProcess } from 'node:child_process';
import { connect } from 'node:net';
import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import { modelProviders, type ProviderConfig } from './server/modelProviders';

// ─────────────────────────────────────────────────────────────
// Model provider config (server-side only; same variables as
// deploy/gusteau_server.py so dev and the Raspberry Pi behave alike):
//
//   GUSTEAU_PROVIDER   mock | nebius | ollama        (default: mock)
//   LLM_BASE_URL       OpenAI-compatible base URL    (preset per provider)
//   LLM_API_KEY        bearer token, if the provider needs one
//   LLM_MODEL          one model for both vision and text, or:
//   LLM_VISION_MODEL / LLM_TEXT_MODEL
//   LLM_EXTRA_BODY     JSON merged into each request
//   LLM_TIMEOUT_MS     per-request timeout in the browser
//
// The browser calls /api/config and /api/llm/*; keys never leave the server.
// ─────────────────────────────────────────────────────────────

type Env = Record<string, string>;

const PRESETS: Record<string, { baseUrl: string; visionModel: string; textModel: string; extraBody: Record<string, unknown> }> = {
  nebius: {
    baseUrl: 'https://api.tokenfactory.nebius.com/v1',
    visionModel: 'nvidia/Nemotron-Nano-12B-v2-VL',
    textModel: 'nvidia/Nemotron-3_5-Lightning',
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
  },
  // Thinking models on Ollama otherwise spend the whole token budget reasoning.
  ollama: { baseUrl: 'http://localhost:11434/v1', visionModel: '', textModel: '', extraBody: { reasoning_effort: 'none' } },
};

function resolveConfig(env: Env) {
  const provider = (env.GUSTEAU_PROVIDER || (env.VITE_USE_NEBIUS === 'true' ? 'nebius' : 'mock')).toLowerCase();
  const preset = PRESETS[provider] ?? { baseUrl: '', visionModel: '', textModel: '', extraBody: {} };
  const textModel = env.LLM_TEXT_MODEL || env.LLM_MODEL || env.VITE_NEBIUS_TEXT_MODEL || preset.textModel;
  const visionModel = env.LLM_VISION_MODEL || env.LLM_MODEL || env.VITE_NEBIUS_VISION_MODEL || preset.visionModel;
  let extraBody = preset.extraBody;
  if (env.LLM_EXTRA_BODY) {
    try {
      extraBody = JSON.parse(env.LLM_EXTRA_BODY);
    } catch {
      console.warn('[gusteau] LLM_EXTRA_BODY is not valid JSON; ignoring it');
    }
  }
  const label = provider === 'nebius' ? 'NVIDIA Nemotron · Nebius' : provider === 'ollama' ? `Ollama · ${textModel}` : `${provider} · ${textModel}`;
  return {
    baseUrl: (env.LLM_BASE_URL || (provider === 'nebius' ? env.NEBIUS_BASE_URL : '') || preset.baseUrl).replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY || (provider === 'nebius' ? env.NEBIUS_API_KEY : '') || '',
    public:
      provider === 'mock'
        ? { provider: 'mock' }
        : { provider, label, visionModel, textModel, extraBody, timeoutMs: Number(env.LLM_TIMEOUT_MS) || 120000 },
  };
}

function gusteauConfigPlugin(publicConfig: object): Plugin {
  const handler = (_req: unknown, res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(publicConfig));
  };
  return {
    name: 'gusteau-config',
    configureServer(server) {
      server.middlewares.use('/api/config', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(`${BUILD_BASE}api/config`, handler);
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Technique videos: GET /api/videos?q=how+to+dice+an+onion returns
// short YouTube videos (5 minutes or less) for a cooking technique.
//
// Keyless: the server reads YouTube's public search results page and
// the data embedded in it. No API key or quota, but YouTube's terms
// don't allow automated access, and it can break whenever YouTube
// changes that page. Same contract as deploy/gusteau_server.py.
// ─────────────────────────────────────────────────────────────

export interface VideoHit {
  id: string;
  title: string;
  channel: string;
  thumb: string;
}

const MAX_VIDEO_SECONDS = 5 * 60;
const seconds = (length = '') => length.split(':').reduce((t, part) => t * 60 + Number(part), 0);

/** Video results from a YouTube search page: the `videoRenderer` entries inside `ytInitialData`. */
function videosFromSearchPage(html: string): VideoHit[] {
  const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
  if (!json) throw new Error('YouTube search page changed');
  const found: VideoHit[] = [];
  type Text = { runs?: { text?: string }[]; simpleText?: string };
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const v = (node as { videoRenderer?: { videoId?: string; title?: Text; ownerText?: Text; lengthText?: Text } }).videoRenderer;
    if (v?.videoId) {
      const length = seconds(v.lengthText?.simpleText);
      // Live streams have no length; long videos aren't "short".
      if (length > 0 && length <= MAX_VIDEO_SECONDS) {
        found.push({ id: v.videoId, title: v.title?.runs?.[0]?.text ?? '', channel: v.ownerText?.runs?.[0]?.text ?? '', thumb: `https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg` });
      }
      return;
    }
    for (const child of Object.values(node)) walk(child);
  };
  walk(JSON.parse(json));
  return found.slice(0, 8);
}

function videoSearchPlugin(): Plugin {
  const cache = new Map<string, VideoHit[]>();
  const handler = async (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    const send = (status: number, body: object) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const q = new URL(req.url ?? '', 'http://x').searchParams.get('q')?.trim().slice(0, 120);
    if (!q) return send(400, { error: 'missing q' });
    const key = q.toLowerCase();
    if (cache.has(key)) return send(200, { videos: cache.get(key) });
    const search = async (filter: string) => {
      const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}${filter}&hl=en&gl=US`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'SOCS=CAI; CONSENT=YES+1' },
      });
      if (!r.ok) throw new Error(`YouTube ${r.status}`);
      return videosFromSearchPage(await r.text());
    };
    try {
      // sp=EgIYAQ%3D%3D is YouTube's "Under 4 minutes" filter. It can leave very few results for an
      // unusual phrasing ("turn the meat into balls"), so then the plain search fills in, still 5 minutes or less.
      let found = await search('&sp=EgIYAQ%253D%253D');
      if (found.length < 3) found = [...found, ...(await search('').catch(() => []))].filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i).slice(0, 8);
      // Keep only videos their owners allow on other sites (oEmbed refuses the rest).
      const embeddable = await Promise.all(
        found.map((v) =>
          fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${v.id}`)}`, { signal: AbortSignal.timeout(5000) })
            .then((o) => o.ok)
            .catch(() => false),
        ),
      );
      const videos = found.filter((_, i) => embeddable[i]);
      cache.set(key, videos);
      send(200, { videos });
    } catch (e) {
      send(502, { error: (e as Error).message });
    }
  };
  return {
    name: 'gusteau-videos',
    configureServer(server) {
      server.middlewares.use('/api/videos', (req, res) => void handler(req, res));
    },
    configurePreviewServer(server) {
      server.middlewares.use(`${BUILD_BASE}api/videos`, (req, res) => void handler(req, res));
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Speech recognition (dev only, used by /asr.html):
//
//   ASR_BASE_URL     NeMo-Speech.cpp server             (default: http://127.0.0.1:8080)
//   ASR_API_KEY      bearer token, if it was started with --api-key
//   ASR_SSH_TARGET   user@host: keep an SSH tunnel from ASR_BASE_URL's port
//                    to that host's 127.0.0.1:ASR_REMOTE_PORT (default 8080)
//                    open while the dev server runs
//
// The browser calls /api/asr/* (HTTP and the realtime WebSocket).
// ─────────────────────────────────────────────────────────────

const portOpen = (port: number) =>
  new Promise<boolean>((resolve) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

/** Holds `ssh -N -L` open and reconnects when it drops (the Mac sleeps, Wi-Fi changes). */
function asrTunnelPlugin(target: string, localPort: number, remotePort: number): Plugin {
  return {
    name: 'gusteau-asr-tunnel',
    configureServer(server) {
      const log = server.config.logger;
      let child: ChildProcess | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      let borrowed = false;
      let backoff = 5000;
      const later = (ms: number) => {
        if (!closed) timer = setTimeout(open, ms);
      };
      const open = async () => {
        // Something already listens there (a tunnel opened by hand, or the
        // previous dev server's ssh still exiting): use it and check back.
        if (await portOpen(localPort)) {
          if (!borrowed) log.info(`[asr] port ${localPort} is already open; using it instead of starting a tunnel`);
          borrowed = true;
          return later(5000);
        }
        borrowed = false;
        if (closed) return;
        child = spawn(
          'ssh',
          ['-N', '-o', 'BatchMode=yes', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-L', `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`, target],
          { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true },
        );
        child.stderr?.on('data', (d) => log.warn(`[asr] ssh: ${String(d).trim()}`));
        child.once('error', (err) => log.error(`[asr] couldn't start ssh: ${err.message}`));
        child.once('exit', () => {
          child = undefined;
          if (closed) return;
          log.warn(`[asr] tunnel closed; reconnecting in ${backoff / 1000} s`);
          later(backoff);
          backoff = Math.min(backoff * 2, 60000);
        });
        setTimeout(async () => {
          if (!child || !(await portOpen(localPort))) return;
          backoff = 5000;
          log.info(`[asr] tunnel up: 127.0.0.1:${localPort} → ${target}:${remotePort}`);
        }, 2000);
      };
      const close = () => {
        closed = true;
        clearTimeout(timer);
        child?.kill();
        process.off('exit', close);
      };
      void open();
      server.httpServer?.once('close', close);
      process.once('exit', close);
    },
  };
}

function asrConfig(env: Env) {
  const baseUrl = (env.ASR_BASE_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
  const proxy: ProxyOptions = {
    target: baseUrl,
    ws: true,
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api\/asr/, ''),
    headers: env.ASR_API_KEY ? { Authorization: `Bearer ${env.ASR_API_KEY}` } : {},
  };
  const tunnel = env.ASR_SSH_TARGET ? asrTunnelPlugin(env.ASR_SSH_TARGET, Number(new URL(baseUrl).port) || 8080, Number(env.ASR_REMOTE_PORT) || 8080) : null;
  return { proxy: { '/api/asr': proxy }, tunnel };
}

// Production builds live under /Gusteau/ so they can share a host with other apps
// (e.g. https://<pi>.ts.net/Gusteau via Tailscale Funnel). Dev stays at "/".
const BUILD_BASE = '/Gusteau/';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const cfg = resolveConfig(env);
  const providers = modelProviders(env, cfg);
  const asr = asrConfig(env);
  const llmProxy = (prefix: string): Record<string, ProxyOptions> => {
    const routes: Record<string, ProxyOptions> = {};
    const configs: [string, ProviderConfig][] = [...Object.entries(providers), ['', cfg]];
    for (const [name, config] of configs) {
      if (!config.baseUrl) continue;
      const route = `${prefix}api/llm${name ? `/${name}` : ''}`;
      routes[route] = {
        target: config.baseUrl,
        changeOrigin: true,
        rewrite: (path) => path.slice(route.length),
        headers: config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {},
      };
    }
    return routes;
  };

  return {
    base: command === 'build' ? BUILD_BASE : '/',
    plugins: [react(), gusteauConfigPlugin({ ...cfg.public, providers: Object.values(providers).map((p) => p.public) }), videoSearchPlugin(), asr.tunnel],
    server: { port: 5173, proxy: { ...llmProxy('/'), ...asr.proxy } },
    preview: { port: 4173, proxy: llmProxy(BUILD_BASE) },
  };
});
