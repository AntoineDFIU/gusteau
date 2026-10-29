import { useId, type ReactNode } from 'react';
import { GusteauIcon } from './GusteauIcon';
import { cx } from './ui';

export type GusteauPromptProps = {
  onAsk: () => void;
  listening?: boolean;
  connecting?: boolean;
  supported?: boolean;
  blocked?: boolean;
  disabled?: boolean;
  transcript?: string;
  notice?: string;
  className?: string;
  icon?: ReactNode;
  children?: ReactNode;
};

/** Presentation only: callers own microphone state and the voice controller. */
export function GusteauPrompt({
  onAsk, listening = false, connecting = false, supported = true,
  blocked = false, disabled = false, transcript, notice, className,
  icon, children,
}: GusteauPromptProps) {
  const id = useId();
  const active = listening || connecting;
  const helper = blocked
    ? 'Microphone access is blocked. Allow it in browser settings, or find a dish below.'
    : !supported
      ? 'Voice input isn’t available in this browser. Find a dish below instead.'
      : connecting
        ? 'Connecting to your microphone… Tap again to stop.'
        : listening
          ? 'I’m listening. Tell me what you’d like to cook, then tap again to finish.'
          : children ?? 'Tell me what sounds good. Try “something Thai under 20 minutes”.';

  return (
    <section aria-labelledby={`${id}-title`} className={cx('rounded-3xl border border-cream-200 bg-white/70 p-5 shadow-card sm:p-7', className)}>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {icon ?? <GusteauIcon size={64} />}
          <div className="min-w-0">
            <h1 id={`${id}-title`} className="font-display text-2xl font-semibold text-charcoal-900 sm:text-3xl">Order with Chef</h1>
            <p id={`${id}-helper`} className="mt-1 max-w-xl text-sm leading-relaxed text-charcoal-500">{helper}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onAsk}
          disabled={disabled || !supported}
          aria-pressed={active}
          aria-describedby={`${id}-helper`}
          aria-label={active ? 'Stop listening' : 'Ask Gusteau'}
          className={cx(
            'inline-flex min-h-[48px] shrink-0 items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-white transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-tomato-500 disabled:cursor-not-allowed disabled:opacity-50',
            active ? 'bg-tomato-500 hover:bg-tomato-600' : 'bg-olive-700 hover:bg-olive-500',
          )}
        >
          {active ? <span aria-hidden className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> : <span aria-hidden>🎤</span>}
          {connecting ? 'Connecting… tap to stop' : listening ? 'Listening… tap to finish' : 'Ask Gusteau'}
        </button>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">
        {transcript && <p className="mt-4 rounded-2xl bg-cream-100 px-4 py-3 text-sm italic text-charcoal-700">“{transcript}”</p>}
        {notice && <p className="mt-3 text-sm text-tomato-600">{notice}</p>}
      </div>
    </section>
  );
}
