import type { ChefModelService } from './modelService';
import { MockModelService } from './mock/mockModelService';
import { OpenAICompatModelService, type LlmConfig } from './llm/openAICompatModelService';

// ─────────────────────────────────────────────────────────────
// Service selection happens at RUNTIME, not build time.
// The server answers GET /api/config (vite.config.ts in dev,
// deploy/gusteau_server.py in production) with the provider and
// model names from its environment. One build therefore runs in
// mock, Nebius or Ollama mode depending only on server config.
// No /api/config (e.g. static hosting) → mock mode.
// ─────────────────────────────────────────────────────────────

let current: ChefModelService = new MockModelService();
export const DEFAULT_NEBIUS_MODEL = 'nvidia/nemotron-3-super-120b-a12b';
export type ModelProvider = LlmConfig & { available: boolean };
let providers: ModelProvider[] = [];
let activeProvider = '';
export const modelProviders = () => providers;
export const selectedProvider = () => activeProvider;

// The model picked in the header, remembered in this browser.
// Start existing browsers on the new default once; later explicit choices persist.
const MODEL_KEY = 'gusteau.model.v2';
const remembered = () => {
  try {
    return localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Models that can chat: the provider's list without embedding, image and speech models. */
export async function listModels(provider = activeProvider): Promise<string[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/llm/${encodeURIComponent(provider)}/models`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id)
      .filter((id) => !/embed|flux|whisper|tts|rerank|diffusion|sdxl/i.test(id))
      .filter((id) => provider !== 'nebius' || /nemotron/i.test(id)).sort();
  } catch {
    return [];
  }
}

/** Use this model from now on, and next time too. */
export function chooseModel(id: string, provider = activeProvider): void {
  const config = providers.find((p) => p.provider === provider && p.available);
  if (!config) throw new Error('This model provider is not configured on the server.');
  if (provider === activeProvider) current.setTextModel(id);
  else current = new OpenAICompatModelService({ ...config, textModel: id });
  activeProvider = provider;
  try {
    localStorage.setItem(MODEL_KEY, JSON.stringify({ provider, model: id }));
  } catch {
    // Private mode: the choice lasts until the page is closed.
  }
}

export async function initModelService(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/config`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const cfg = (await res.json()) as Partial<LlmConfig> & { providers?: ModelProvider[] };
    providers = cfg.providers ?? (cfg.provider && cfg.provider !== 'mock' && cfg.textModel ? [{ ...cfg, available: true } as ModelProvider] : []);
    const initial = providers.find((p) => p.provider === 'nebius' && p.available)
      ?? providers.find((p) => p.provider === cfg.provider && p.available)
      ?? providers.find((p) => p.available);
    if (!initial) return;
    activeProvider = initial.provider;
    current = new OpenAICompatModelService({ ...initial, textModel: initial.provider === 'nebius' ? DEFAULT_NEBIUS_MODEL : initial.textModel });
    const raw = remembered();
    if (raw) {
      let pick: { provider: string; model: string };
      try { pick = JSON.parse(raw); } catch { pick = { provider: initial.provider, model: raw }; }
      if (pick && providers.some((p) => p.provider === pick.provider && p.available)
        && (await listModels(pick.provider)).includes(pick.model)) chooseModel(pick.model, pick.provider);
    }
  } catch {
    /* stay in mock mode */
  }
}

/** Stable facade so callers never hold a stale reference. */
export const modelService: ChefModelService = {
  get mode() {
    return current.mode;
  },
  get label() {
    return current.label;
  },
  get textModel() {
    return current.textModel;
  },
  setTextModel: (id) => chooseModel(id),
  interpretMessage: (message, session, opts) => current.interpretMessage(message, session, opts),
  warmUp: () => current.warmUp(),
  stageRecipe: (recipe) => current.stageRecipe(recipe),
  adaptPlan: (session, draft, prior) => current.adaptPlan(session, draft, prior),
  phraseSteps: (recipe) => current.phraseSteps(recipe),
  discover: (message, ctx) => current.discover(message, ctx),
};

export type { ChefModelService } from './modelService';
