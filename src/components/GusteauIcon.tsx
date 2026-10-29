import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { mountFlame } from './flame';
import type { FlameHandle, FlameState } from './flame';
import { cx } from './ui';

export type GusteauIconProps = {
  size?: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
  /** Gas-burner flame mascot state. Defaults to the closed, idle burner. */
  state?: FlameState;
  /** Voice level (0–1) that drives the flame height while it's lit and listening. */
  level?: number;
};

/** The shared brand mark. Decorative by default; supply label when used alone. */
export function GusteauIcon({ size = 36, className, label, style, state = 'idle', level }: GusteauIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const flame = useRef<FlameHandle | null>(null);
  const [failed, setFailed] = useState(false);
  const animated = !failed;

  useEffect(() => {
    if (!animated || !canvasRef.current) return;
    const handle = mountFlame(canvasRef.current);
    if (!handle) return setFailed(true);
    flame.current = handle;
    return () => {
      handle.destroy();
      flame.current = null;
    };
  }, [animated]);

  useEffect(() => {
    flame.current?.setState(state);
  }, [state, animated]);

  useEffect(() => {
    flame.current?.setLevel(state === 'on' && level !== undefined ? level : null);
  }, [level, state, animated]);

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-[30%] bg-cream-200 shadow-lift',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.52, lineHeight: 1, ...style }}
    >
      {animated ? <canvas ref={canvasRef} className="h-full w-full" /> : null}
    </span>
  );
}
