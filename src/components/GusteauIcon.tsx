import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { cx } from './ui';

type BurnerState = 'idle' | 'muted' | 'listening' | 'speaking';

export type GusteauIconProps = {
  size?: number;
  className?: string;
  label?: string;
  style?: CSSProperties;
  state?: BurnerState;
  level?: number;
};

function drawBurner(ctx: CanvasRenderingContext2D, time: number, state: BurnerState, level: number) {
  const center = 64;
  const lit = state === 'listening' || state === 'speaking';
  const speaking = state === 'speaking';
  const strength = Math.max(0, Math.min(1, level));

  ctx.clearRect(0, 0, 128, 128);

  const housing = ctx.createRadialGradient(48, 42, 4, center, center, 59);
  housing.addColorStop(0, '#625a50');
  housing.addColorStop(0.65, '#39342f');
  housing.addColorStop(1, '#211f1d');
  ctx.fillStyle = housing;
  ctx.beginPath();
  ctx.arc(center, center, 58, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#aaa093';
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center, center, 54, Math.PI * 1.05, Math.PI * 1.9);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const well = ctx.createRadialGradient(54, 51, 2, center, center, 45);
  well.addColorStop(0, '#171615');
  well.addColorStop(0.72, '#24211e');
  well.addColorStop(1, '#544c42');
  ctx.fillStyle = well;
  ctx.beginPath();
  ctx.arc(center, center, 44, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#81786d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(center, center, 30, 0, Math.PI * 2);
  ctx.stroke();

  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (Math.PI / 2) * i;
    const inner = 15;
    const outer = 42;
    ctx.strokeStyle = '#766d62';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(angle) * inner, center + Math.sin(angle) * inner);
    ctx.lineTo(center + Math.cos(angle) * outer, center + Math.sin(angle) * outer);
    ctx.stroke();
    ctx.strokeStyle = '#b0a494';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(center + Math.cos(angle) * (inner + 2), center + Math.sin(angle) * (inner + 2));
    ctx.lineTo(center + Math.cos(angle) * (outer - 2), center + Math.sin(angle) * (outer - 2));
    ctx.stroke();
  }

  if (lit) {
    for (let i = 0; i < 7; i += 1) {
      const angle = Math.PI / 2 - (Math.PI * 2 * i) / 7;
      const x = center + Math.cos(angle) * 34;
      const y = center - Math.sin(angle) * 34;
      const flicker = 0.88 + 0.12 * Math.sin(time * (5 + (i % 3)) + i * 1.9) * Math.sin(time * 3.1 + i);
      const height = (12 + strength * 9) * flicker;
      const direction = Math.atan2(y - center - 0.9, x - center);

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(direction + Math.PI / 2);
      ctx.shadowColor = '#ff741d';
      ctx.shadowBlur = 12;

      const flame = ctx.createLinearGradient(0, 5, 0, -height);
      flame.addColorStop(0, '#fff3c0');
      flame.addColorStop(0.3, '#ffb338');
      flame.addColorStop(1, '#f14d19');
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-4, 4);
      ctx.bezierCurveTo(-8, -2, -1 + Math.sin(time * 4 + i) * 2, -height * 0.62, 0, -height);
      ctx.bezierCurveTo(6, -height * 0.58, 7, -2, 4, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    if (speaking) {
      const pulse = 0.82 + 0.18 * Math.sin(time * 5);
      const height = 23 * pulse;
      const flame = ctx.createLinearGradient(center, center + 12, center, center - height);
      flame.addColorStop(0, '#fff5ce');
      flame.addColorStop(0.42, '#ffb338');
      flame.addColorStop(1, '#ef4c18');
      ctx.save();
      ctx.shadowColor = '#ff741d';
      ctx.shadowBlur = 14;
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(center - 8, center + 12);
      ctx.bezierCurveTo(center - 14, center - 1, center - 3, center - 9, center, center - height);
      ctx.bezierCurveTo(center + 12, center - 5, center + 14, center + 3, center + 8, center + 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else if (state === 'idle') {
    const cap = ctx.createRadialGradient(55, 53, 2, center, center, 27);
    cap.addColorStop(0, '#746b60');
    cap.addColorStop(0.72, '#4d463e');
    cap.addColorStop(1, '#302c27');
    ctx.fillStyle = cap;
    ctx.beginPath();
    ctx.arc(center, center, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#9b8e7d';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(center, center, 23, Math.PI * 1.08, Math.PI * 1.88);
    ctx.stroke();
  }

  for (let i = 0; i < 7; i += 1) {
    const angle = Math.PI / 2 - (Math.PI * 2 * i) / 7;
    const x = center + Math.cos(angle) * 34;
    const y = center - Math.sin(angle) * 34;
    ctx.fillStyle = lit ? '#ffd48a' : '#171615';
    ctx.beginPath();
    ctx.arc(x, y, lit ? 2.5 : 3, 0, Math.PI * 2);
    ctx.fill();
    if (lit) {
      ctx.fillStyle = '#fff4cf';
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** The shared burner mark. Decorative by default; supply a label when used alone. */
export function GusteauIcon({ size = 36, className, label, style, state = 'idle', level = 0 }: GusteauIconProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(level);
  levelRef.current = level;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frame = 0;
    const draw = (timestamp: number) => {
      drawBurner(ctx, timestamp / 1000, state, levelRef.current);
      if (!reducedMotion && (state === 'listening' || state === 'speaking')) {
        frame = window.requestAnimationFrame(draw);
      }
    };

    draw(performance.now());
    return () => window.cancelAnimationFrame(frame);
  }, [state]);

  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cx('inline-flex shrink-0 items-center justify-center rounded-2xl bg-[#302c27] shadow-lift', className)}
      style={{ width: size, height: size, ...style }}
    >
      <canvas ref={canvasRef} width={128} height={128} className="h-full w-full rounded-[inherit]" aria-hidden />
    </span>
  );
}
