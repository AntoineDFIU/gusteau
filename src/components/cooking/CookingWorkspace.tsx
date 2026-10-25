import { useEffect, useRef, useState } from 'react';
import { amountOf } from '../../agent/adapt';
import { stageIndexOf } from '../../agent/stages';
import { emojiFor } from '../../data/ingredients';
import { EQUIPMENT } from '../../data/rules';
import { techniqueFor } from '../../data/techniques';
import { formatClock } from '../../lib/sound';
import type { Cook } from '../../state/useCook';
import type { Voice } from '../../voice/useVoice';
import { RecipeArt, StageIcon } from '../RecipeCard';
import { Button, Card, GusteauAvatar, Modal, SectionTitle, cx } from '../ui';
import { ChatPanel } from './ChatPanel';
import { KitchenPlan } from './KitchenPlan';
import { PlanUpdatedBanner } from './PlanUpdatedBanner';
import { StatusBar } from './StatusBar';
import { TechniqueCard } from './TechniqueCard';

export function CookingWorkspace({ cook, voice, onHandsFree, onExit }: { cook: Cook; voice: Voice; onHandsFree: (on: boolean) => void; onExit: () => void }) {
  const s = cook.session!;
  const r = s.recipe;
  const finished = s.stepIndex >= r.steps.length;
  const step = r.steps[Math.min(s.stepIndex, r.steps.length - 1)];
  const stage = r.stages[stageIndexOf(r.stages, step.key)];
  const stepIngredients = r.ingredients.filter((i) => step.uses.includes(i.id));
  const diff = s.history.find((h) => h.id === cook.bannerId);
  const latest = s.history[0];
  const isNewStep = !!latest && cook.bannerId === latest.id && latest.stepsAdded.includes(step.title);
  const technique = techniqueFor(step);
  const [outOpen, setOutOpen] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  const busy = !!cook.busy;

  // Bring the "Plan updated" moment into view, wherever the change came from.
  useEffect(() => {
    const el = bannerRef.current;
    if (!cook.bannerId || !el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 140 || top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [cook.bannerId]);

  const stepTimerRunning = s.timers.some((t) => t.label === step.title && t.endsAt !== null);

  return (
    <div className="mx-auto max-w-7xl">
      <StatusBar cook={cook} voice={voice} onHandsFree={onHandsFree} />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <RecipeArt recipe={r} className="h-12 w-12 shrink-0 rounded-2xl text-2xl [&>span]:text-2xl" />
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive-500">Cooking with Gusteau</p>
            <h1 key={r.title} className="animate-rise truncate font-display text-2xl font-semibold text-charcoal-900">
              {r.title}
            </h1>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onExit}>
          ← Leave cooking
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="min-w-0 space-y-6">
          {diff && (
            <div ref={bannerRef} className="scroll-mt-40">
              <PlanUpdatedBanner diff={diff} onDismiss={cook.dismissBanner} onUndo={cook.undo} canUndo={cook.canUndo} />
            </div>
          )}

          {finished ? (
            <Card className="p-8 text-center sm:p-10">
              <span className="text-6xl">🎉</span>
              <h2 className="mt-4 font-display text-3xl font-semibold text-charcoal-900">Bon appétit!</h2>
              <p className="mx-auto mt-2 max-w-md text-charcoal-500">
                You made the {r.title}
                {s.history.filter((h) => !h.infeasible).length ? `, and handled ${s.history.filter((h) => !h.infeasible).length} curveball${s.history.length > 1 ? 's' : ''} along the way` : ''}.
                {!s.rules.purchasesAllowed && ' No surprise grocery runs.'}
              </p>
              <p className="mt-2 text-xs text-charcoal-400">Gusteau will use this to suggest dishes you’ll like next time.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button variant="secondary" onClick={cook.back}>
                  ← Back to last step
                </Button>
                <Button onClick={onExit}>Cook something else</Button>
              </div>
            </Card>
          ) : (
            <Card className={cx('relative overflow-hidden p-6 sm:p-8', isNewStep && 'ring-4 ring-saffron-400/60')}>
              {cook.busy === 'replanning' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                  <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 shadow-card">
                    <GusteauAvatar size="sm" />
                    <span className="text-sm font-semibold text-charcoal-700">Re-checking every rule…</span>
                  </div>
                </div>
              )}
              {s.paused && cook.busy !== 'replanning' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center overflow-y-auto bg-cream-50/90 p-6 backdrop-blur-sm">
                  <div className="max-w-md text-center">
                    <span className="text-4xl">✋</span>
                    <p className="mt-2 font-display text-xl font-semibold text-charcoal-900">Paused: the rest of this plan breaks a rule</p>
                    <p className="mt-1 text-sm text-charcoal-500">{latest?.message.split(' I won’t')[0]}</p>
                    <p className="mt-3 text-sm font-semibold text-charcoal-700">How would you like to go on?</p>
                    <div className="mt-3 flex flex-wrap justify-center gap-2">
                      {latest?.offers?.leaveOut.map((n) => (
                        <Button key={n} size="sm" onClick={() => void cook.update([{ type: 'leave_out', name: n }], `Cook without ${n.toLowerCase()}`)}>
                          Cook without {n.toLowerCase()}
                        </Button>
                      ))}
                      {latest?.offers?.allowPurchase && (
                        <Button size="sm" variant="secondary" onClick={() => void cook.update([{ type: 'set_purchases', allowed: true }], 'Purchases allowed')}>
                          Allow a quick purchase
                        </Button>
                      )}
                      {cook.canUndo && (
                        <Button size="sm" variant="secondary" onClick={cook.undo}>
                          ↶ Undo last change
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={onExit}>
                        Pick another recipe
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  {stage && <StageIcon icon={stage.icon} state="current" size="sm" />}
                  <span className="text-xs font-bold uppercase tracking-wider text-tomato-600">
                    {stage?.title} · Step {s.stepIndex + 1} of {r.steps.length}
                  </span>
                </span>
                {isNewStep && <span className="rounded-full bg-saffron-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-saffron-500">✨ New step</span>}
              </div>
              <h2 key={step.key + step.title} className="mt-4 animate-rise font-display text-3xl font-semibold leading-tight text-charcoal-900 sm:text-4xl">
                {step.title}
              </h2>
              <p key={step.text} className="mt-4 animate-rise text-lg leading-relaxed text-charcoal-700 sm:text-xl">
                {step.text}
              </p>
              {step.tip && (
                <p className="mt-4 flex gap-2 rounded-2xl bg-olive-50 px-4 py-3 text-sm text-olive-700">
                  <span>💡</span>
                  <span>
                    <span className="font-semibold">Gusteau’s tip:</span> {step.tip}
                  </span>
                </p>
              )}

              <div className="mt-6">
                <SectionTitle className="mb-2">For this step</SectionTitle>
                {stepIngredients.length ? (
                  <ul className="grid gap-1.5 sm:grid-cols-2">
                    {stepIngredients.map((i) => (
                      <li key={i.id} className={cx('flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm', i.substitutedFor ? 'bg-saffron-100/60' : 'bg-cream-100')}>
                        <span className="text-lg">{emojiFor(i.name)}</span>
                        <span className="min-w-0 truncate font-semibold text-charcoal-900">{i.name}</span>
                        <span className="ml-auto shrink-0 text-right text-charcoal-500">{amountOf(i)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl bg-cream-100 px-3 py-2 text-sm text-charcoal-500">Nothing new to measure for this step.</p>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {step.timerSeconds && (
                  <Button size="sm" variant="secondary" disabled={stepTimerRunning} onClick={() => cook.addTimer(step.timerSeconds!, step.title)}>
                    ⏱ {stepTimerRunning ? 'Timer running' : `Start ${formatClock(step.timerSeconds)} timer`}
                  </Button>
                )}
                {technique && !cook.techniqueOpen && (
                  <Button size="sm" variant="secondary" onClick={() => cook.setTechniqueOpen(true)}>
                    🎬 Show me how
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={cook.repeat}>
                  🔊 Read aloud
                </Button>
              </div>
              {technique && cook.techniqueOpen && <TechniqueCard technique={technique} onClose={() => cook.setTechniqueOpen(false)} />}

              <div className="mt-8 flex items-center justify-between gap-3">
                <Button variant="secondary" onClick={cook.back} disabled={s.stepIndex === 0 || s.paused}>
                  ← Back
                </Button>
                <Button size="lg" onClick={cook.next} disabled={s.paused || busy}>
                  {s.stepIndex === r.steps.length - 1 ? 'Finish 🎉' : 'Done, next step →'}
                </Button>
              </div>
            </Card>
          )}

          {!finished && (
            <Card className="p-4">
              <SectionTitle>Something changed?</SectionTitle>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setOutOpen(true)}>
                  🥲 I’m out of an ingredient
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cook.update([{ type: 'set_time', minutes: 5 }], 'Only 5 minutes left', 'I only have 5 minutes')}>
                  ⏱ Only 5 minutes left
                </Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void cook.update([{ type: 'set_servings', servings: s.rules.servings + 2 }], `Cooking for ${s.rules.servings + 2}`, `${s.rules.servings + 2} people are eating now`)}>
                  👥 Two more people
                </Button>
                {s.rules.equipment.slice(0, 2).map((e) => (
                  <Button key={e} size="sm" variant="secondary" disabled={busy} onClick={() => void cook.update([{ type: 'remove_equipment', equipment: e }], `No ${EQUIPMENT[e].label.toLowerCase()}`, `My ${EQUIPMENT[e].label.toLowerCase()} stopped working`)}>
                    {EQUIPMENT[e].emoji} {EQUIPMENT[e].label} broke
                  </Button>
                ))}
              </div>
            </Card>
          )}

          <ChatPanel cook={cook} onMic={() => void voice.listenOnce()} micActive={(voice.state === 'listening' || voice.state === 'connecting') && !voice.handsFree} micSupported={voice.supported} />
        </div>

        <aside className="min-w-0 space-y-6">
          <KitchenPlan session={s} />
          <p className="px-2 text-xs text-charcoal-400">
            Gusteau gives general cooking guidance. It can’t check allergens, freshness or doneness for you: read labels, and use a thermometer for meat.
          </p>
        </aside>
      </div>

      <Modal open={outOpen} onClose={() => setOutOpen(false)} label="Which ingredient are you out of?">
        <div className="p-5 sm:p-6">
          <h2 className="pr-10 font-display text-xl font-semibold text-charcoal-900">Which ingredient are you out of?</h2>
          <p className="mt-1 text-sm text-charcoal-500">Gusteau will rework the rest of the plan around it.</p>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {r.ingredients
              .filter((i) => r.steps.some((st) => st.uses.includes(i.id) && !s.completedStepKeys.includes(st.key)) || !r.steps.some((st) => st.uses.includes(i.id)))
              .map((i) => (
                <button
                  key={i.id}
                  onClick={() => {
                    setOutOpen(false);
                    void cook.update([{ type: 'remove_ingredient', name: i.name }], `You're out of ${i.name.toLowerCase()}`, `I’m out of ${i.name.toLowerCase()}`);
                  }}
                  className="flex items-center gap-2 rounded-2xl border border-cream-300 bg-white px-3 py-2.5 text-left text-sm font-medium text-charcoal-700 hover:border-tomato-400"
                >
                  <span className="text-lg">{emojiFor(i.name)}</span>
                  {i.name}
                </button>
              ))}
          </div>
        </div>
      </Modal>
    </div>
  );
}
