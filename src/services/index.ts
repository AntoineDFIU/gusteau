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

// The model picked in the header, remembered in this browser.
const MODEL_KEY = 'gusteau.model';
const remembered = () => {
  try {
    return localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    return '';
  }
};

/** Models that can chat: the provider's list without embedding, image and speech models. */
export async function listModels(): Promise<string[]> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/llm/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id).filter((id) => !/embed|flux|whisper|tts|rerank|diffusion|sdxl/i.test(id)).sort();
  } catch {
    return [];
  }
}

/** Use this model from now on, and next time too. */
export function chooseModel(id: string): void {
  current.setTextModel(id);
  try {
    localStorage.setItem(MODEL_KEY, id);
  } catch {
    // Private mode: the choice lasts until the page is closed.
  }
}

export async function initModelService(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/config`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const cfg = (await res.json()) as Partial<LlmConfig> & { provider?: string };
    if (cfg.provider && cfg.provider !== 'mock' && cfg.textModel) {
      current = new OpenAICompatModelService(cfg as LlmConfig);
      // The model picked last time, if the provider still has it.
      const pick = remembered();
      if (pick && pick !== cfg.textModel && (await listModels()).includes(pick)) current.setTextModel(pick);
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
