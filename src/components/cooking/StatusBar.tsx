import { remainingMinutes } from '../../agent/kitchen';
import { stageIndexOf } from '../../agent/stages';
import { formatClock } from '../../lib/sound';
import { timerLeft, type Cook } from '../../state/useCook';
import type { Voice } from '../../voice/useVoice';
import type { Power, Turn } from '../VoiceDock';
import { StageIcon } from '../RecipeCard';
import { VoiceControl } from '../VoiceDock';
import { cx } from '../ui';

export function StatusBar({ cook, voice, turn, power, onHandsFree }: { cook: Cook; voice: Voice; turn: Turn; power?: Power; onHandsFree: () => void }) {
  const s = cook.session!;
  const r = s.recipe;
  const finished = s.stepIndex >= r.steps.length;
  const step = r.steps[Math.min(s.stepIndex, r.steps.length - 1)];
  const stageIdx = finished ? r.stages.length - 1 : stageIndexOf(r.stages, step.key);
  const stage = r.stages[stageIdx];
  const left = remainingMinutes(r, s.completedStepKeys);
  const stageState = (i: number) => {
    const keys = r.stages[i].stepKeys;
    if (keys.every((k) => s.completedStepKeys.includes(k))) return 'done';
    return i === stageIdx && !finished ? 'current' : 'todo';
  };

  return (
    <div className="sticky top-[61px] z-20 -mx-4 mb-6 border-b border-cream-200 bg-cream-100/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-2">
        {/* Stages */}
        <div className="flex items-center gap-1" aria-label={`Stage ${stageIdx + 1} of ${r.stages.length}`}>
          {r.stages.map((st, i) => (
            <div key={st.key} className="flex items-center gap-1">
              <StageIcon icon={st.icon} state={stageState(i)} size="sm" />
              {i < r.stages.length - 1 && <span className={cx('h-0.5 w-3 rounded-full sm:w-5', stageState(i) === 'done' ? 'bg-olive-500' : 'bg-cream-300')} />}
            </div>
          ))}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-sm font-semibold text-charcoal-900">{finished ? 'All done!' : stage?.title}</p>
          <p className="text-xs text-charcoal-500">
            {finished ? `${r.steps.length} of ${r.steps.length} steps` : `Stage ${stageIdx + 1}/${r.stages.length} · Step ${s.stepIndex + 1}/${r.steps.length}`}
            {!finished && <> · ~{left} min left</>}
            {s.rules.timeLimit ? <> · limit {s.rules.timeLimit} min</> : null}
          </p>
        </div>

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

        {/* Voice: "Hey Chef" or a tap; a tap while he's speaking interrupts him (so does Esc). */}
        {voice.supported && <VoiceControl voice={voice} turn={turn} power={power} onTap={onHandsFree} className="w-full sm:w-auto" />}
      </div>
      {voice.handsFree && voice.interim && <p className="mx-auto mt-1 max-w-7xl truncate text-xs italic text-charcoal-500">“{voice.interim}”</p>}
      {voice.notice && (
        <p className="mx-auto mt-1 flex max-w-7xl items-center gap-2 text-xs text-tomato-700">
          {voice.notice}
          <button onClick={voice.clearNotice} className="font-semibold underline-offset-2 hover:underline">
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
