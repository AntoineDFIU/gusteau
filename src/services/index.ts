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

export async function initModelService(): Promise<void> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}api/config`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const cfg = (await res.json()) as Partial<LlmConfig> & { provider?: string };
    if (cfg.provider && cfg.provider !== 'mock' && cfg.textModel && cfg.visionModel) {
      current = new OpenAICompatModelService(cfg as LlmConfig);
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
  analyzePhotos: (photos) => current.analyzePhotos(photos),
  interpretMessage: (message, session) => current.interpretMessage(message, session),
  stageRecipe: (recipe) => current.stageRecipe(recipe),
  adaptPlan: (session, draft, prior) => current.adaptPlan(session, draft, prior),
};

export type { ChefModelService } from './modelService';
