import { useEffect, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variant = 'primary' | 'secondary' | 'ghost' | 'olive';
export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100 disabled:cursor-not-allowed disabled:opacity-50',
        size === 'sm' && 'px-3.5 py-1.5 text-sm',
        size === 'md' && 'px-5 py-2.5 text-[15px]',
        size === 'lg' && 'px-7 py-3.5 text-base',
        variant === 'primary' && 'bg-tomato-500 text-white shadow-lift hover:bg-tomato-600 active:scale-[.98]',
        variant === 'secondary' && 'border border-cream-300 bg-white text-charcoal-700 hover:border-tomato-400 hover:text-tomato-600',
        variant === 'ghost' && 'text-charcoal-500 hover:bg-cream-200 hover:text-charcoal-900',
        variant === 'olive' && 'bg-olive-500 text-white hover:bg-olive-700',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('rounded-3xl border border-cream-200 bg-white/90 shadow-card', className)}>{children}</div>;
}

export function Chip({
  active,
  onClick,
  children,
  tone = 'tomato',
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  tone?: 'tomato' | 'olive';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-all',
        active
          ? tone === 'tomato'
            ? 'border-tomato-500 bg-tomato-50 text-tomato-700 shadow-sm'
            : 'border-olive-500 bg-olive-50 text-olive-700 shadow-sm'
          : 'border-cream-300 bg-white text-charcoal-500 hover:border-charcoal-400',
      )}
    >
      {children}
    </button>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-olive-500' : 'bg-cream-300')}
    >
      <span className={cx('absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all', checked ? 'left-6' : 'left-1')} />
    </button>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-xs font-semibold uppercase tracking-[0.14em] text-olive-500', className)}>{children}</p>;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export function GusteauAvatar({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-saffron-100 to-tomato-100 ring-2 ring-white',
        size === 'sm' && 'h-7 w-7 text-base',
        size === 'md' && 'h-9 w-9 text-lg',
        size === 'lg' && 'h-14 w-14 text-3xl',
      )}
      aria-hidden
    >
      👨‍🍳
    </span>
  );
}

/** Full-screen sheet on phones, centered dialog on larger screens. */
export function Modal({
  open,
  onClose,
  label,
  children,
  wide = false,
  chatHostRef,
}: {
  open: boolean;
  onClose: () => void;
  label: string;
  children: ReactNode;
  wide?: boolean;
  chatHostRef?: Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={cx('fixed inset-0 z-50 flex items-end justify-center bg-charcoal-900/40 backdrop-blur-sm sm:items-center sm:p-6')} onClick={onClose}>
      <div
        ref={chatHostRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={cx(
          'relative w-full animate-pop overflow-y-auto rounded-t-3xl bg-cream-50 shadow-card sm:rounded-3xl',
          wide ? 'sm:max-w-4xl' : 'sm:max-w-lg',
          chatHostRef && 'pb-36',
          'max-h-[94vh]',
        )}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-lg text-charcoal-700 shadow hover:bg-white"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}

export function Badge({ children, tone = 'cream', className }: { children: ReactNode; tone?: 'cream' | 'olive' | 'tomato' | 'saffron' | 'dark'; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        tone === 'cream' && 'bg-cream-200 text-charcoal-700',
        tone === 'olive' && 'bg-olive-50 text-olive-700',
        tone === 'tomato' && 'bg-tomato-50 text-tomato-700',
        tone === 'saffron' && 'bg-saffron-100 text-charcoal-700',
        tone === 'dark' && 'bg-charcoal-900 text-white',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal-400', className)}>{children}</h2>;
}

/**
 * A section heading inside the recipe preview: Poppins and one step larger than
 * the shared SectionTitle, so the preview reads well on phones and tablets.
 */
export function PreviewHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('font-head text-xs font-semibold uppercase tracking-[0.14em] text-charcoal-500', className)}>{children}</h2>;
}
