import { useEffect, useRef, useState, useMemo } from 'react';
import { adaptRecipe, amountOf, pauseOptions } from '../agent/adapt';
import { describeRules, scaleRecipe, stepEquipment } from '../agent/kitchen';
import { adjustmentLine } from '../agent/discovery';
import { cuisineById } from '../data/cuisines';
import { emojiFor, isStaple } from '../data/ingredients';
import { DIET_RULES, EQUIPMENT } from '../data/rules';
import type { CookRules, Equipment, PendingChoice, Profile, Recipe } from '../types';
import { NutritionPanel } from './NutritionPanel';
import { RecipeArt, StageIcon } from './RecipeCard';
import { Badge, Button, SectionTitle, cx } from './ui';


/**
 * Where a recipe is being cooked: the cook's own rules, or a scenario such as
 * the demo. Gusteau doesn't keep an inventory of ingredients; the cook tells
 * him what they're missing.
 */
export interface Kitchen {
  rules?: Partial<CookRules>;
  label?: string;
}

export function RecipePreview({
  recipe,
  profile,
  kitchen,
  onCook,
  onClose,
  busy,
  cookSignal = 0,
  onCantCook,
  unavailable = [],
  swaps = [],
  asking = null,
  onAnswer,
  onAdjusted,
  onMissing,
}: {
  recipe: Recipe;
  profile: Profile;
  kitchen: Kitchen;
  onCook: (rules: CookRules, leaveOut: string[]) => void;
  onClose: () => void;
  busy: boolean;
  /** Goes up when the cook says “let’s cook” hands-free: the same as pressing the button. */
  cookSignal?: number;
  /** Why the button can't be pressed yet, for Gusteau to say. */
  onCantCook?: (why: string) => void;
  /** Ingredients the cook said they don't have ("I don't have cilantro"), once they've said what to do about them. */
  unavailable?: string[];
  /** What the cook agreed to use instead; the rest of `unavailable` is left out. */
  swaps?: { from: string; to: string }[];
  /** Gusteau's open question about a missing ingredient ("Do you have another kind of cheese?"). */
  asking?: (PendingChoice & { say: string }) | null;
  /** An answer tapped or typed on screen, handled like a spoken one. */
  onAnswer?: (text: string) => void;
  /** What Gusteau says once the plan has been adjusted for the latest of them. */
  onAdjusted?: (say: string) => void;
  /** The cook tapped "Don't have it?" on an ingredient (again to undo). */
  onMissing?: (name: string) => void;
}) {
  const base = kitchen.rules ?? {};
  const [servings, setServings] = useState(base.servings ?? recipe.servings);
  // No time to pick here. A limit comes from the scenario (the demo's 15 minutes) or from the cook mid-recipe ("I only have 10 minutes").
  const timeLimit = base.timeLimit ?? null;
  // No equipment to confirm here: the cook starts with everything this recipe needs.
  // If an appliance fails mid-cook ("my oven broke"), Gusteau replans around it then.
  const equipment = useMemo<Equipment[]>(
    () => [...new Set([...(base.equipment ?? profile.equipment), ...recipe.equipment, ...recipe.steps.flatMap(stepEquipment)])],
    [base.equipment, profile.equipment, recipe],
  );
  const [chosenLeaveOut, setLeaveOut] = useState<string[]>([]);
  // Missing ingredients without a swap were agreed to be left out.
  const leaveOut = [...chosenLeaveOut, ...unavailable.filter((u) => !swaps.some((w) => w.from === u))];
  const rules: CookRules = {
    hardExclusions: base.hardExclusions ?? profile.hardExclusions,
    allergies: base.allergies ?? profile.allergies,
    equipment,
    timeLimit,
    servings,
  };
  const scaled = useMemo(() => scaleRecipe(recipe, servings), [recipe, servings]);
  // Cheap enough to recompute on every change, so the preview is always exactly what cooking will start with.
  const plan = adaptRecipe(scaled, { rules, pantry: [], basics: true, unavailable, leaveOut, preferredSwaps: swaps, additions: [], completed: [] });
  const options = pauseOptions(plan);
  // "I don't have cilantro": say how the plan changed for the ones just added.
  // Starts at 0, so anything already known when the preview opens is said once too.
  const reported = useRef(0);
  useEffect(() => {
    const added = unavailable.slice(reported.current);
    reported.current = unavailable.length;
    if (added.length) onAdjusted?.(adjustmentLine(added, plan));
  }, [unavailable]);
  const asked = useRef(cookSignal);
  useEffect(() => {
    if (cookSignal === asked.current) return;
    asked.current = cookSignal;
    if (busy) return;
    if (plan.violations.length) onCantCook?.(plan.violations[0]);
    else onCook(rules, leaveOut);
  }, [cookSignal]);
  const cuisine = cuisineById(recipe.cuisine);

  const rows = scaled.ingredients.map((i) => {
    const sub = plan.substitutions.find((s) => s.from === i.name);
    const swapped = plan.recipe.ingredients.find((x) => x.substitutedFor === i.name);
    const blocked = plan.blockers.some((b) => b.name === i.name);
    // Only what the cook told Gusteau: "I don't have cilantro".
    const out = unavailable.some((u) => u === i.name);
    return { i, sub, swapped, blocked, out };
  });

  return (
    <div>
      <RecipeArt recipe={recipe} big className="h-56 sm:h-64" />
      <div className="p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-olive-500">
          {cuisine.emoji} {cuisine.name}
          {kitchen.label && <span className="ml-2 rounded-full bg-saffron-100 px-2 py-0.5 text-charcoal-700">{kitchen.label}</span>}
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-charcoal-900 sm:text-4xl">{recipe.title}</h1>
        {recipe.chef ? (
          <p className="mt-1 text-sm text-charcoal-500">
            {recipe.chef.relation ?? 'Recipe by'} <span className="font-semibold text-charcoal-700">{recipe.chef.name}</span>
            {recipe.chef.url && (
              <a href={recipe.chef.url} target="_blank" rel="noreferrer" className="ml-2 font-medium text-olive-500 underline-offset-4 hover:underline">
                See the original ↗
              </a>
            )}
          </p>
        ) : (
          <p className="mt-1 text-xs text-charcoal-400">Gusteau sample recipe</p>
        )}
        {recipe.description && <p className="mt-3 max-w-2xl text-charcoal-700">{recipe.description}</p>}

        <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
          <Badge>⏱ {plan.recipe.totalMinutes} min</Badge>
          <Badge>👩‍🍳 {recipe.difficulty}</Badge>
          {recipe.equipment.length ? recipe.equipment.map((e) => <Badge key={e}>{EQUIPMENT[e].emoji} {EQUIPMENT[e].label}</Badge>) : <Badge>🥗 No cooking</Badge>}
          <span className="inline-flex items-center gap-1 rounded-full bg-cream-200 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-charcoal-700">
            🍽 {servings} serving{servings === 1 ? '' : 's'}
            <button onClick={() => setServings((s) => Math.max(1, s - 1))} aria-label="Fewer servings" className="ml-1 h-5 w-5 rounded-full bg-white hover:bg-cream-100">
              −
            </button>
            <button onClick={() => setServings((s) => Math.min(12, s + 1))} aria-label="More servings" className="h-5 w-5 rounded-full bg-white hover:bg-cream-100">
              +
            </button>
          </span>
        </div>

        <div className="mt-8 grid gap-8 md:grid-cols-[1.15fr_1fr]">
          <section>
            <SectionTitle>Ingredients</SectionTitle>
            <ul className="mt-3 space-y-1.5">
              {rows.map(({ i, sub, swapped, blocked, out }) => (
                <li key={i.id} className={cx('flex items-start gap-3 rounded-2xl px-3 py-2', blocked ? 'bg-tomato-50' : sub ? 'bg-saffron-100/50' : 'bg-cream-100')}>
                  <span className="text-xl" aria-hidden>
                    {emojiFor(i.name)}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className={cx('font-semibold text-charcoal-900', sub?.kind === 'drop' && 'line-through decoration-charcoal-400')}>{i.name}</span>
                    <span className="text-charcoal-500"> · {amountOf(i)}</span>
                    {i.optional && <span className="text-charcoal-400"> · optional</span>}
                    {sub?.kind === 'swap' && swapped && (
                      <span className="block text-xs text-charcoal-700">
                        → Gusteau will use <span className="font-semibold">{swapped.name.toLowerCase()}</span> ({amountOf(swapped)}). {sub.reason.split('. ').slice(1).join('. ')}
                      </span>
                    )}
                    {sub?.kind === 'drop' && <span className="block text-xs text-charcoal-500">Left out: {sub.reason.split(', so ').pop()}</span>}
                    {asking?.current === i.name && onAnswer && <MissingAsk asking={asking} onAnswer={onAnswer} />}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {blocked && <Badge tone="tomato">Blocked</Badge>}
                    {onMissing && (
                      <button
                        onClick={() => onMissing(i.name)}
                        aria-pressed={out || asking?.current === i.name}
                        className={cx('rounded-full px-2 py-0.5 text-[11px] font-semibold', out || asking?.current === i.name ? 'bg-charcoal-900 text-white' : 'text-charcoal-400 hover:bg-cream-200 hover:text-charcoal-700')}
                      >
                        {out || asking?.current === i.name ? 'Don’t have it ✕' : 'Don’t have it?'}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-charcoal-400">Missing something? Tap “Don’t have it?” or tell Gusteau, like “I don’t have cilantro”, and he’ll adapt the recipe.</p>
            {scaled.ingredients.every((i) => !isStaple(i.name)) && <p className="mt-1 text-xs text-charcoal-400">Plus salt, pepper, oil and water.</p>}
            <NutritionPanel planned={plan.recipe} original={scaled} />
          </section>

          <section>
            <SectionTitle>The plan · {plan.recipe.stages.length} stages</SectionTitle>
            <ol className="mt-3 space-y-2">
              {plan.recipe.stages.map((st, n) => (
                <li key={st.key} className="flex items-center gap-3">
                  <StageIcon icon={st.icon} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-charcoal-900">
                      {n + 1}. {st.title}
                    </span>
                    {(st.stepKeys.length > 1 || plan.recipe.steps.find((s) => s.key === st.stepKeys[0])?.title !== st.title) && (
                      <span className="block truncate text-xs text-charcoal-500">
                        {st.stepKeys.map((k) => plan.recipe.steps.find((s) => s.key === k)?.title).filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>

            <SectionTitle className="mt-8">Your rules for this cook</SectionTitle>
            <div className="mt-3 space-y-4 rounded-3xl border border-cream-200 bg-white p-4">
              <div className="flex flex-wrap gap-1.5">
                {rules.hardExclusions.map((r) => (
                  <Badge key={r} tone="dark">
                    🛡 {DIET_RULES[r].label}
                  </Badge>
                ))}
                {rules.allergies.map((a) => (
                  <Badge key={a} tone="dark">
                    🛡 No {a}
                  </Badge>
                ))}
                {!rules.hardExclusions.length && !rules.allergies.length && <span className="text-xs text-charcoal-400">No diet rules. Set them in your preferences.</span>}
              </div>
            </div>
          </section>
        </div>

        <div className={cx('mt-8 rounded-3xl p-4 sm:p-5', plan.violations.length ? 'bg-tomato-50' : 'bg-olive-50')}>
          {plan.violations.length ? (
            <>
              <p className="font-semibold text-tomato-700">Gusteau can’t make this safely yet</p>
              <ul className="mt-1 space-y-0.5 text-sm text-tomato-700">
                {plan.violations.slice(0, 4).map((v) => (
                  <li key={v}>✕ {v}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {options.leaveOut.map((n) => (
                  <Button key={n} size="sm" variant="secondary" onClick={() => setLeaveOut((l) => [...l, n])}>
                    Cook without {n.toLowerCase()}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {describeRules(rules)
                .filter((r) => !/( only|appliances)$/.test(r))
                .map((r) => (
                <span key={r} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-olive-700">
                  ✓ {r}
                </span>
              ))}
            </div>
          )}
          {plan.notes.map((n) => (
            <p key={n} className="mt-2 text-xs text-charcoal-700">
              {n}
            </p>
          ))}
        </div>
        {plan.recipe.adaptedFrom && !plan.violations.length && (
          <p className="mt-2 text-xs text-charcoal-500">Gusteau adapted this recipe for you, so it’s no longer exactly the original.</p>
        )}

        <div className="sticky bottom-0 -mx-5 mt-6 flex flex-col gap-2 border-t border-cream-200 bg-cream-50/95 px-5 py-4 backdrop-blur sm:-mx-8 sm:flex-row sm:px-8">
          <Button size="lg" className="flex-1" disabled={plan.violations.length > 0 || busy} onClick={() => onCook(rules, leaveOut)}>
            {busy ? 'Setting up…' : '👨‍🍳 Cook with Gusteau'}
          </Button>
          <Button size="lg" variant="secondary" onClick={onClose}>
            ← Back to recipes
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Gusteau's question about a missing ingredient, answerable by tapping or typing as well as by voice. */
function MissingAsk({ asking, onAnswer }: { asking: PendingChoice & { say: string }; onAnswer: (text: string) => void }) {
  const [other, setOther] = useState('');
  const chip = 'rounded-full bg-white px-3 py-1 text-xs font-semibold text-charcoal-700 ring-1 ring-cream-200 hover:bg-cream-100';
  return (
    <span className="mt-2 block rounded-2xl bg-white/80 p-3 text-xs text-charcoal-700" role="group" aria-label={`What to do without ${asking.current.toLowerCase()}`}>
      <span className="block font-medium text-charcoal-900">🧑‍🍳 {asking.say}</span>
      <span className="mt-2 flex flex-wrap gap-1.5">
        {asking.confirming ? (
          <>
            <button className={chip} onClick={() => onAnswer('yes')}>
              Yes, use {asking.confirming.toLowerCase()}
            </button>
            <button className={chip} onClick={() => onAnswer('no')}>
              No
            </button>
          </>
        ) : (
          <>
            {asking.options.slice(0, 3).map((o) => (
              <button key={o} className={chip} onClick={() => onAnswer(o)}>
                Use {o.toLowerCase()}
              </button>
            ))}
            {!asking.core && (
              <button className={chip} onClick={() => onAnswer('leave it out')}>
                Leave it out
              </button>
            )}
          </>
        )}
      </span>
      {!asking.confirming && (
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!other.trim()) return;
            onAnswer(other.trim());
            setOther('');
          }}
        >
          <input
            value={other}
            onChange={(e) => setOther(e.target.value)}
            placeholder="What you have…"
            aria-label={`What to use instead of ${asking.current.toLowerCase()}`}
            className="min-w-0 flex-1 rounded-full border border-cream-200 bg-white px-3 py-1 text-xs"
          />
          <button type="submit" className={chip}>
            Use this
          </button>
        </form>
      )}
    </span>
  );
}
