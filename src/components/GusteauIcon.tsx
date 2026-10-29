import type { CSSProperties } from 'react';
import { cx } from './ui';

export type GusteauIconProps = {
  size?: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
};

/** The shared brand mark. Decorative by default; supply label when used alone. */
export function GusteauIcon({ size = 36, className, label, style }: GusteauIconProps) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-[30%] bg-tomato-500 shadow-lift', className)}
      style={{ width: size, height: size, fontSize: size * 0.52, lineHeight: 1, ...style }}
    >
      👨‍🍳
    </span>
  );
}
