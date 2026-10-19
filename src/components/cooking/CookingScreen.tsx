import { useEffect, useRef } from 'react';
import { quantityWarnings } from '../../agent/planner';
import { DIET_RULES, EQUIPMENT } from '../../data/ingredients';
import type { Session } from '../../state/useSession';
import { Button, Card, GusteauAvatar, cx } from '../ui';
import { ChatPanel } from './ChatPanel';
import { DemoControls } from './DemoControls';
import { FoodSafetyCard, VideoCard } from './FutureCards';
import { KitchenPlanPanel } from './KitchenPlanPanel';
import { PlanUpdatedBanner } from './PlanUpdatedBanner';
import { Timer } from './Timer';

export function CookingScreen({ session }: { session: Session }) {
  const { state, busy } = session;
  const r = state.recipe!;
  const c = state.constraints;
  const idx = state.currentStepIndex;
  const finished = idx >= r.steps.length;
  const step = r.steps[Math.min(idx, r.steps.length - 1)];
  const stepIngredients = r.ingredients.filter((i) => step.uses.includes(i.role));
  const diff = state.history.find((h) => h.id === session.bannerId);
  const latest = state.history[0];
  const onHold = !!latest?.infeasible;
  const newStep = !!latest && session.bannerId === latest.id && latest.stepsAdded.includes(step.title);
  const warnings = quantityWarnings(r, state.inventory);
  const bannerRef = useRef<HTMLDivElement>(null);

  // Bring the "Plan updated" moment into view, wherever the change was triggered from.
  useEffect(() => {
    const el = bannerRef.current;
    if (!session.bannerId || !el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 72 || top > window.innerHeight * 0.55) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [session.bannerId]);

  return (
    <div className="mx-auto max-w-7xl animate-rise">
      {/* Header + progress */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive-500">Cooking with Gusteau</p>
          <h1 key={r.title} className="mt-1 animate-rise font-display text-2xl font-semibold text-charcoal-900 sm:text-3xl">
            {r.emoji} {r.title}
          </h1>
        </div>
        <div className="text-sm text-charcoal-500">
          <span className="font-semibold text-charcoal-900">{Math.min(state.completedStepKeys.length, r.steps.length)}</span> of {r.steps.length} steps done · ~
          {r.totalMinutes} min
        </div>
      </div>
      <div className="mb-4 flex gap-1.5" aria-hidden>
        {r.steps.map((s, i) => (
          <div
            key={s.key}
            title={s.title}
            className={cx(
              'h-2 flex-1 rounded-full transition-all duration-500',
              state.completedStepKeys.includes(s.key) ? 'bg-olive-500' : i === idx ? 'bg-tomato-500' : 'bg-cream-300',
            )}
          />
        ))}
      </div>

      {/* Compact session state for phones; the full panel lives further down. */}
      <a
        href="#kitchen-plan"
        className="mb-5 flex gap-1.5 overflow-x-auto rounded-2xl border border-cream-200 bg-white/80 p-2 text-xs font-semibold text-charcoal-700 shadow-card lg:hidden"
      >
        {[
          ...c.hardExclusions.map((h) => `🛡 ${DIET_RULES[h].label}`),
          ...c.customExclusions.map((x) => `🛡 No ${x}`),
          `⏱ ${r.totalMinutes}/${c.timeMinutes} min`,
          `🍽 ${c.servings}`,
          c.equipment.map((e) => EQUIPMENT[e].emoji).join(' '),
          c.purchasesAllowed ? `🛒 ≤ $${c.budget}` : '🚫 No purchases',
          ...state.substitutions.map((s) => `${s.from} → ${s.to}`),
        ].map((t) => (
          <span key={t} className="shrink-0 rounded-full bg-cream-100 px-2.5 py-1">
            {t}
          </span>
        ))}
        <span className="shrink-0 rounded-full bg-olive-500 px-2.5 py-1 text-white">Kitchen plan ↓</span>
      </a>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          {diff && (
            <div ref={bannerRef} className="scroll-mt-24">
              <PlanUpdatedBanner
                diff={diff}
                purchasesAllowed={c.purchasesAllowed}
                onDismiss={session.dismissBanner}
                onUndo={session.undo}
                canUndo={session.canUndo}
              />
            </div>
          )}

          {finished ? (
            <Card className="p-8 text-center sm:p-10">
              <span className="text-6xl">🎉</span>
              <h2 className="mt-4 font-display text-3xl font-semibold text-charcoal-900">Bon appétit!</h2>
              <p className="mx-auto mt-2 max-w-md text-charcoal-500">
                You made the {r.title} with what you had
                {state.history.length ? `, and handled ${state.history.length} curveball${state.history.length > 1 ? 's' : ''} along the way` : ''}.
                {!c.purchasesAllowed && ' No surprise grocery runs.'}
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <Button variant="secondary" onClick={session.back}>
                  ← Back to last step
                </Button>
                <Button onClick={session.restart}>Cook something else</Button>
              </div>
            </Card>
          ) : (
            <Card className={cx('relative overflow-hidden p-6 sm:p-8', newStep && 'ring-4 ring-saffron-400/60')}>
              {busy === 'replanning' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                  <div className="flex items-center gap-3 rounded-full bg-white px-5 py-3 shadow-card">
                    <GusteauAvatar size="sm" />
                    <span className="text-sm font-semibold text-charcoal-700">Re-checking every constraint…</span>
                  </div>
                </div>
              )}
              {onHold && busy !== 'replanning' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-cream-50/85 p-6 backdrop-blur-sm">
                  <div className="max-w-sm text-center">
                    <span className="text-4xl">✋</span>
                    <p className="mt-2 font-display text-xl font-semibold text-charcoal-900">Paused: this step no longer fits your rules</p>
                    <p className="mt-1 text-sm text-charcoal-500">Undo the last change, or tell me something else that changed, and I’ll find a safe plan.</p>
                    {session.canUndo && (
                      <Button className="mt-4" onClick={session.undo}>
                        Undo last change
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <span className="rounded-full bg-tomato-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-tomato-600">
                  Step {idx + 1} of {r.steps.length}
                </span>
                {newStep && <span className="rounded-full bg-saffron-100 px-3 py-1 text-xs font-bold uppercase tracking-wider text-saffron-500">✨ New step</span>}
              </div>
              <h2 key={step.key + step.title} className="mt-4 animate-rise font-display text-3xl font-semibold leading-tight text-charcoal-900 sm:text-4xl">
                {step.title}
              </h2>
              <p key={step.instruction} className="mt-4 animate-rise text-lg leading-relaxed text-charcoal-700 sm:text-xl">
                {step.instruction}
              </p>
              {step.tip && (
                <p className="mt-4 flex gap-2 rounded-2xl bg-olive-50 px-4 py-3 text-sm text-olive-700">
                  <span>💡</span>
                  <span>
                    <span className="font-semibold">Gusteau’s tip:</span> {step.tip}
                  </span>
                </p>
              )}

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal-400">For this step</p>
                  {stepIngredients.length ? (
                    <ul className="space-y-1.5">
                      {stepIngredients.map((i) => (
                        <li key={i.key} className="flex items-center gap-2.5 rounded-xl bg-cream-100 px-3 py-2 text-sm">
                          <span className="text-lg">{i.emoji}</span>
                          <span className="font-semibold text-charcoal-900">{i.name}</span>
                          <span className="ml-auto text-right text-charcoal-500">{i.display}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-xl bg-cream-100 px-3 py-2 text-sm text-charcoal-500">Just your hands and a little patience.</p>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-charcoal-400">Timer</p>
                  <Timer seconds={step.timerSeconds} resetKey={step.key + r.title} />
                </div>
              </div>

              <div className="mt-8 flex items-center justify-between gap-3">
                <Button variant="secondary" onClick={session.back} disabled={idx === 0 || onHold}>
                  ← Back
                </Button>
                <Button size="lg" onClick={session.next} disabled={onHold || !!busy}>
                  {idx === r.steps.length - 1 ? 'Finish 🎉' : 'Done, next step →'}
                </Button>
              </div>
            </Card>
          )}

          {warnings.length > 0 && !finished && (
            <div className="space-y-1 rounded-2xl bg-tomato-50 p-3 text-xs text-tomato-700">
              {warnings.map((w) => (
                <p key={w}>⚖️ {w}</p>
              ))}
            </div>
          )}

          <DemoControls state={state} busy={!!busy} onUpdate={(ch, t, u) => void session.update(ch, t, u)} />
          <ChatPanel state={state} busy={busy} onSend={(t) => void session.sendChat(t)} />
        </div>

        <aside className="space-y-6">
          <div id="kitchen-plan" className="scroll-mt-24">
            <KitchenPlanPanel state={state} />
          </div>
          <VideoCard recipe={r} />
          <FoodSafetyCard recipe={r} />
        </aside>
      </div>
    </div>
  );
}
