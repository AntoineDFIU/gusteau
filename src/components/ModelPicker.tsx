import { useEffect, useState } from 'react';
import { chooseModel, DEFAULT_NEBIUS_MODEL, listModels, modelProviders, modelService, selectedProvider } from '../services';
import { cx } from './ui';

const NEBIUS_MODEL = DEFAULT_NEBIUS_MODEL;

/**
 * Which model Gusteau's brain runs on, from the models the provider offers.
 * Switching takes effect from the next request and is remembered. In mock
 * mode there's nothing to choose, so it just says so.
 */
export function ModelPicker() {
  const providers = modelProviders();
  const [models, setModels] = useState<Record<string, string[]>>({});
  const [model, setModel] = useState(modelService.textModel);
  const [chosenProvider, setProvider] = useState(selectedProvider());
  useEffect(() => {
    if (selectedProvider() === 'nebius' && modelService.textModel !== NEBIUS_MODEL) {
      chooseModel(NEBIUS_MODEL, 'nebius');
      setModel(NEBIUS_MODEL);
    }
    let live = true;
    for (const provider of providers.filter((p) => p.available)) {
      void listModels(provider.provider).then((ids) => {
        if (live) setModels((existing) => ({ ...existing, [provider.provider]: ids }));
      });
    }
    return () => { live = false; };
  }, []);
  if (modelService.mode === 'mock') {
    return (
      <span className="hidden rounded-full bg-cream-200 px-3 py-1 text-[11px] font-semibold text-charcoal-500 md:inline" title="Using local mock services. See README to connect a model.">
        {modelService.label}
      </span>
    );
  }
  const provider = chosenProvider === 'nebius' ? 'Nebius' : modelService.label.split(' · ')[0];
  return (
    <label className={cx('flex items-center gap-1.5 rounded-full bg-olive-100 py-1 pl-3 pr-1 text-[11px] font-semibold text-olive-700')} title={`The model Gusteau uses (${provider})`}>
      <span className="hidden lg:inline">{provider}</span>
      <span className="sr-only">Model</span>
      <select
        value={JSON.stringify([chosenProvider, model])}
        onChange={(e) => {
          const [nextProvider, nextModel] = JSON.parse(e.target.value) as [string, string];
          chooseModel(nextModel, nextProvider);
          setProvider(nextProvider);
          setModel(nextModel);
          // Load it now, so the next question doesn't wait for it.
          void modelService.warmUp().catch(() => {});
        }}
        className="max-w-[8.5rem] cursor-pointer truncate rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-olive-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 sm:max-w-[13rem]"
      >
        {providers.map((p) => (
          <optgroup key={p.provider} label={p.provider === 'nebius' ? 'Nebius Token Factory · Nemotron' : 'Ollama · local models'}>
            {p.available ? (p.provider === 'nebius' ? [NEBIUS_MODEL] : [...new Set([p.textModel, ...(p.provider === chosenProvider ? [model] : []), ...(models[p.provider] ?? [])])]).map((id) => (
              <option key={id} value={JSON.stringify([p.provider, id])}>{id}</option>
            )) : <option disabled value={JSON.stringify([p.provider, p.textModel])}>{p.provider === 'nebius' ? 'Add NEBIUS_API_KEY on the server' : 'Configure Ollama on the server'}</option>}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
