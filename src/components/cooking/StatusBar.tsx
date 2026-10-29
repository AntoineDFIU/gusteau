import { remainingMinutes } from '../../agent/kitchen';
import { stageIndexOf } from '../../agent/stages';
import { formatClock } from '../../lib/sound';
import { timerLeft, type Cook } from '../../state/useCook';
import { StageIcon } from '../RecipeCard';
import { cx } from '../ui';

/** Where the cook is in the recipe, and their timers. Talking with Gusteau is in the voice panel above. */
export function StatusBar({ cook }: { cook: Cook }) {
  const s = cook.session!;
  const r = s.recipe;
  const finished = s.stepIndex >= r.steps.length;
  const step = r.steps[Math.min(s.stepIndex, r.steps.length - 1)];
  const stageIdx = finished ? r.stages.length - 1 : stageIndexOf(r.stages, step.key);
  const left = remainingMinutes(r, s.completedStepKeys);
  const stageState = (i: number) => {
    const keys = r.stages[i].stepKeys;
    if (keys.every((k) => s.completedStepKeys.includes(k))) return 'done';
    return i === stageIdx && !finished ? 'current' : 'todo';
  };

  const done = s.completedStepKeys.filter((k) => r.steps.some((st) => st.key === k)).length;
  const percent = Math.round((done / Math.max(1, r.steps.length)) * 100);
  const stepState = (key: string) => (s.completedStepKeys.includes(key) ? 'done' : !finished && key === step.key ? 'current' : 'todo');

  return (
    <div className="sticky top-[61px] z-20 -mx-4 mb-6 border-b border-cream-200 bg-cream-100/95 px-4 py-3 shadow-sm backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto max-w-7xl">
        {/* Where the cook is: the step, large, then how far along and how long is left. */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-olive-500">
              {finished ? 'Finished' : step.title}
            </p>
            <p className="font-display text-2xl font-semibold text-charcoal-900 sm:text-3xl">
              {finished ? (
                'All done! Bon appétit'
              ) : (
                <>
                  Step {s.stepIndex + 1} <span className="text-charcoal-400">of {r.steps.length}</span>
                </>
              )}
            </p>
          </div>
          <p className="text-sm font-semibold text-charcoal-700">
            {percent}% done{!finished && <> · ~{left} min left</>}
            {s.rules.timeLimit ? <span className="font-normal text-charcoal-500"> · limit {s.rules.timeLimit} min</span> : null}
          </p>
        </div>

        {/* One segment per step, grouped by stage: done, the one you're on, still to do. */}
        <div className="mt-2.5 flex items-center gap-2" role="progressbar" aria-label="Recipe progress" aria-valuemin={0} aria-valuemax={r.steps.length} aria-valuenow={done} aria-valuetext={`${done} of ${r.steps.length} steps done`}>
          {r.stages.map((st, i) => (
            <div key={st.key} className="flex min-w-0 items-center gap-1.5" style={{ flexGrow: st.stepKeys.length, flexBasis: 0 }}>
              <span className="hidden sm:inline-flex">
                <StageIcon icon={st.icon} state={stageState(i)} size="sm" />
              </span>
              <div className="flex min-w-0 flex-1 gap-1">
                {st.stepKeys.map((k) => {
                  const state = stepState(k);
                  return (
                    <span
                      key={k}
                      title={r.steps.find((x) => x.key === k)?.title}
                      className={cx('h-3 min-w-[6px] flex-1 rounded-full transition-colors', state === 'done' ? 'bg-olive-500' : state === 'current' ? 'animate-pulse bg-tomato-500' : 'bg-cream-300')}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-auto mt-2 flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2 empty:hidden">

        {/* Timers */}
        {s.timers.length > 0 && (
          <div className="flex max-w-full gap-1.5 overflow-x-auto" aria-label="Timers">
            {s.timers.map((t) => {
              const secs = timerLeft(t, cook.now);
              const ringing = secs <= 0;
              return (
                <span key={t.id} className={cx('flex shrink-0 items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs font-semibold', ringing ? 'animate-pulse bg-olive-500 text-white' : t.endsAt === null ? 'bg-cream-200 text-charcoal-500' : 'bg-charcoal-900 text-white')}>
                  <button onClick={() => (ringing ? cook.removeTimer(t.id) : cook.toggleTimer(t.id))} title={ringing ? 'Dismiss' : t.endsAt === null ? 'Resume' : 'Pause'} className="flex items-center gap-1.5">
                    <span aria-hidden>{ringing ? '🔔' : t.endsAt === null ? '⏸' : '⏱'}</span>
                    <span className="max-w-[8rem] truncate">{t.label}</span>
                    <span className="tabular-nums">{ringing ? 'Done!' : formatClock(secs)}</span>
                  </button>
                  {!ringing && (
                    <button onClick={() => cook.addTime(t.id, 30)} className="rounded-full px-1.5 hover:bg-white/20" aria-label="Add 30 seconds">
                      +30s
                    </button>
                  )}
                  <button onClick={() => cook.removeTimer(t.id)} className="flex h-5 w-5 items-center justify-center rounded-full hover:bg-white/20" aria-label={`Remove ${t.label} timer`}>
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
