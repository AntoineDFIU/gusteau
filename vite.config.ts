import { defineConfig, loadEnv, type Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

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
    textModel: 'nvidia/Llama-3_3-Nemotron-Super-49B-v1_5',
    extraBody: {},
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
    baseUrl: (env.LLM_BASE_URL || env.NEBIUS_BASE_URL || preset.baseUrl).replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY || env.NEBIUS_API_KEY || '',
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

// Production builds live under /Gusteau/ so they can share a host with other apps
// (e.g. https://<pi>.ts.net/Gusteau via Tailscale Funnel). Dev stays at "/".
const BUILD_BASE = '/Gusteau/';

export default defineConfig(({ mode, command }) => {
  const cfg = resolveConfig(loadEnv(mode, process.cwd(), ''));
  const llmProxy = (prefix: string): Record<string, ProxyOptions> =>
    cfg.baseUrl
      ? {
          [`${prefix}api/llm`]: {
            target: cfg.baseUrl,
            changeOrigin: true,
            rewrite: (path) => path.replace(new RegExp(`^${prefix}api/llm`), ''),
            headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
          },
        }
      : {};

  return {
    base: command === 'build' ? BUILD_BASE : '/',
    plugins: [react(), gusteauConfigPlugin(cfg.public)],
    server: { port: 5173, proxy: llmProxy('/') },
    preview: { port: 4173, proxy: llmProxy(BUILD_BASE) },
  };
});
