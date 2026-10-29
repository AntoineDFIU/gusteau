import { useEffect, useState } from 'react';
import { chooseModel, listModels, modelService } from '../services';
import { cx } from './ui';

/**
 * Which model Gusteau's brain runs on, from the models the provider offers.
 * Switching takes effect from the next request and is remembered. In mock
 * mode there's nothing to choose, so it just says so.
 */
export function ModelPicker() {
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState(modelService.textModel);
  useEffect(() => {
    if (modelService.mode === 'llm') void listModels().then(setModels);
  }, []);
  if (modelService.mode === 'mock') {
    return (
      <span className="hidden rounded-full bg-cream-200 px-3 py-1 text-[11px] font-semibold text-charcoal-500 md:inline" title="Using local mock services. See README to connect a model.">
        {modelService.label}
      </span>
    );
  }
  const provider = modelService.label.split(' · ')[0];
  return (
    <label className={cx('flex items-center gap-1.5 rounded-full bg-olive-100 py-1 pl-3 pr-1 text-[11px] font-semibold text-olive-700')} title={`The model Gusteau uses (${provider})`}>
      <span className="hidden lg:inline">{provider}</span>
      <span className="sr-only">Model</span>
      <select
        value={model}
        onChange={(e) => {
          chooseModel(e.target.value);
          setModel(e.target.value);
          // Load it now, so the next question doesn't wait for it.
          void modelService.warmUp().catch(() => {});
        }}
        className="max-w-[8.5rem] cursor-pointer truncate rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-olive-700 focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 sm:max-w-[13rem]"
      >
        {!models.includes(model) && <option value={model}>{model}</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );
}
