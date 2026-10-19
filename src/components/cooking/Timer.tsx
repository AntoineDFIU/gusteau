import { useEffect, useRef, useState } from 'react';
import { cx } from '../ui';

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch {
    /* audio is optional */
  }
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function Timer({ seconds, resetKey }: { seconds?: number; resetKey: string }) {
  const initial = seconds ?? 120;
  const [total, setTotal] = useState(initial);
  const [left, setLeft] = useState(initial);
  const [running, setRunning] = useState(false);
  const tick = useRef<number>();

  useEffect(() => {
    setTotal(initial);
    setLeft(initial);
    setRunning(false);
  }, [resetKey, initial]);

  useEffect(() => {
    if (!running) return;
    tick.current = window.setInterval(() => {
      setLeft((l) => {
        if (l <= 1) {
          setRunning(false);
          beep();
          return 0;
        }
        return l - 1;
      });
    }, 1000);
    return () => window.clearInterval(tick.current);
  }, [running]);

  const pct = total ? left / total : 0;
  const R = 34;
  const C = 2 * Math.PI * R;
  const done = left === 0;

  return (
    <div className={cx('flex items-center gap-4 rounded-2xl p-3 pr-4', done ? 'bg-olive-50' : 'bg-cream-100')}>
      <div className="relative h-20 w-20 shrink-0">
        <svg viewBox="0 0 80 80" className="h-20 w-20 -rotate-90">
          <circle cx="40" cy="40" r={R} fill="none" stroke="#EADBC4" strokeWidth="6" />
          <circle
            cx="40"
            cy="40"
            r={R}
            fill="none"
            stroke={done ? '#6B7A3A' : '#E2512F'}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-display text-lg font-semibold tabular-nums text-charcoal-900">
          {done ? '✓' : fmt(left)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-charcoal-900">{done ? 'Time’s up! Check it.' : seconds ? 'Step timer' : 'Quick timer'}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {!done && (
            <button
              onClick={() => setRunning((r) => !r)}
              className="rounded-full bg-charcoal-900 px-4 py-1.5 text-sm font-semibold text-white hover:bg-charcoal-700"
            >
              {running ? 'Pause' : left < total ? 'Resume' : 'Start'}
            </button>
          )}
          <button
            onClick={() => {
              setLeft(total);
              setRunning(false);
            }}
            className="rounded-full border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-700 hover:border-charcoal-400"
          >
            Reset
          </button>
          <button
            onClick={() => {
              setTotal((t) => t + 30);
              setLeft((l) => l + 30);
            }}
            className="rounded-full border border-cream-300 bg-white px-3 py-1.5 text-sm font-medium text-charcoal-700 hover:border-charcoal-400"
          >
            +30s
          </button>
        </div>
      </div>
    </div>
  );
}
