export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  public: {
    provider: string; label?: string; textModel?: string; visionModel?: string;
    extraBody?: Record<string, unknown>; timeoutMs?: number; available?: boolean;
  };
}

/** Credentials stay in this server-only registry; browsers receive only `public`. */
export function modelProviders(env: Record<string, string>, primary: ProviderConfig): Record<string, ProviderConfig> {
  const providers: Record<string, ProviderConfig> = {};
  for (const provider of ['ollama', 'nebius']) {
    const prefix = provider.toUpperCase();
    const legacy = primary.public.provider === provider ? primary : undefined;
    const baseUrl = (env[`${prefix}_BASE_URL`] || legacy?.baseUrl || (provider === 'nebius' ? 'https://api.tokenfactory.nebius.com/v1' : 'http://localhost:11434/v1')).replace(/\/$/, '');
    const apiKey = env[`${prefix}_API_KEY`] || legacy?.apiKey || '';
    const textModel = env[`${prefix}_MODEL`] || legacy?.public.textModel || (provider === 'nebius' ? 'nvidia/Nemotron-3_5-Lightning' : 'qwen3.6:35b-mlx');
    let extraBody = legacy?.public.extraBody ?? (provider === 'ollama' ? { reasoning_effort: 'none' } : { chat_template_kwargs: { enable_thinking: false } });
    if (env[`${prefix}_EXTRA_BODY`]) {
      try { extraBody = JSON.parse(env[`${prefix}_EXTRA_BODY`]); }
      catch { console.warn(`[gusteau] Invalid ${prefix}_EXTRA_BODY; using provider defaults.`); }
    }
    providers[provider] = {
      baseUrl, apiKey,
      public: {
        provider, label: provider === 'nebius' ? `Nebius · ${textModel}` : `Ollama · ${textModel}`,
        textModel, visionModel: textModel, extraBody,
        timeoutMs: legacy?.public.timeoutMs ?? 120000,
        available: provider === 'nebius' ? !!apiKey : !!(legacy || env.OLLAMA_BASE_URL || env.OLLAMA_MODEL),
      },
    };
  }
  return providers;
}
