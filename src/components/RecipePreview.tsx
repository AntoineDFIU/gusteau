import { useMemo, useState } from 'react';
import { adaptRecipe, amountOf, pauseOptions } from '../agent/adapt';
import { availability, describeRules, scaleRecipe } from '../agent/kitchen';
import { cuisineById } from '../data/cuisines';
import { emojiFor, isStaple } from '../data/ingredients';
import { DIET_RULES, EQUIPMENT } from '../data/rules';
import type { CookRules, Equipment, PantryItem, Profile, Recipe } from '../types';
import { NutritionPanel } from './NutritionPanel';
import { RecipeArt, StageIcon } from './RecipeCard';
import { Badge, Button, Chip, SectionTitle, Toggle, cx } from './ui';

const TIME_CHOICES: (number | null)[] = [null, 15, 30, 45, 60];

export interface Kitchen {
  pantry: PantryItem[];
  basics: boolean;
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
}: {
  recipe: Recipe;
  profile: Profile;
  kitchen: Kitchen;
  onCook: (rules: CookRules, leaveOut: string[]) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const base = kitchen.rules ?? {};
  const [servings, setServings] = useState(base.servings ?? recipe.servings);
  const [timeLimit, setTimeLimit] = useState<number | null>(base.timeLimit ?? null);
  const [purchases, setPurchases] = useState(base.purchasesAllowed ?? false);
  const [equipment, setEquipment] = useState<Equipment[]>(base.equipment ?? profile.equipment);
  const [leaveOut, setLeaveOut] = useState<string[]>([]);
  const rules: CookRules = {
    hardExclusions: base.hardExclusions ?? profile.hardExclusions,
    allergies: base.allergies ?? profile.allergies,
    equipment,
    timeLimit,
    purchasesAllowed: purchases,
    servings,
  };
  const scaled = useMemo(() => scaleRecipe(recipe, servings), [recipe, servings]);
  // Cheap enough to recompute on every change, so the preview is always exactly what cooking will start with.
  const plan = adaptRecipe(scaled, { rules, pantry: kitchen.pantry, basics: kitchen.basics, unavailable: [], leaveOut, preferredSwaps: [], additions: [], completed: [] });
  const options = pauseOptions(plan, rules);
  const known = kitchen.pantry.length > 0;
  const cuisine = cuisineById(recipe.cuisine);

  const rows = scaled.ingredients.map((i) => {
    const sub = plan.substitutions.find((s) => s.from === i.name);
    const swapped = plan.recipe.ingredients.find((x) => x.substitutedFor === i.name);
    const status = availability(i.name, kitchen.pantry, kitchen.basics);
    const blocked = plan.blockers.some((b) => b.name === i.name);
    return { i, sub, swapped, status, blocked };
  });
  const have = rows.filter((r) => r.status === 'have' || r.status === 'staple').length;

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
            <div className="flex items-baseline justify-between gap-3">
              <SectionTitle>Ingredients</SectionTitle>
              {known && (
                <span className="text-xs text-charcoal-500">
                  You have {have} of {rows.length}
                </span>
              )}
            </div>
            <ul className="mt-3 space-y-1.5">
              {rows.map(({ i, sub, swapped, status, blocked }) => (
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
                        → Gusteau will use <span className="font-semibold">{swapped.name.toLowerCase()}</span> ({amountOf(swapped)}){swapped.toBuy ? ', to buy' : ''}. {sub.reason.split('. ').slice(1).join('. ')}
                      </span>
                    )}
                    {sub?.kind === 'drop' && <span className="block text-xs text-charcoal-500">Left out: {sub.reason.split(', so ').pop()}</span>}
                    {sub?.kind === 'buy' && <span className="block text-xs text-charcoal-700">🛒 On your shopping list</span>}
                  </span>
                  <span className="shrink-0 pt-0.5">
                    {blocked ? (
                      <Badge tone="tomato">Blocked</Badge>
                    ) : status === 'have' ? (
                      <Badge tone="olive">✓ Have</Badge>
                    ) : status === 'staple' ? (
                      <Badge tone="olive">Pantry basic</Badge>
                    ) : status === 'missing' && !sub ? (
                      <Badge tone="saffron">Missing</Badge>
                    ) : status === 'missing' ? (
                      <Badge>Missing</Badge>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
            {!known && <p className="mt-2 text-xs text-charcoal-400">Add what’s in your kitchen to see what you have and what’s missing.</p>}
            {kitchen.basics && scaled.ingredients.every((i) => !isStaple(i.name)) && <p className="mt-2 text-xs text-charcoal-400">Plus salt, pepper, oil and water.</p>}
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
              <div>
                <p className="mb-1.5 text-xs font-semibold text-charcoal-700">Time you have</p>
                <div className="flex flex-wrap gap-1.5">
                  {TIME_CHOICES.map((t) => (
                    <Chip key={t ?? 'any'} active={timeLimit === t} onClick={() => setTimeLimit(t)}>
                      {t ? `${t} min` : 'No limit'}
                    </Chip>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold text-charcoal-700">Equipment you can use</p>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(EQUIPMENT) as Equipment[]).map((e) => (
                    <Chip key={e} tone="olive" active={equipment.includes(e)} onClick={() => setEquipment((l) => (l.includes(e) ? l.filter((x) => x !== e) : [...l, e]))}>
                      {EQUIPMENT[e].emoji} {EQUIPMENT[e].label}
                    </Chip>
                  ))}
                </div>
              </div>
              <label className="flex items-center justify-between gap-3 text-sm text-charcoal-700">
                <span>
                  Okay to buy missing items
                  <span className="block text-xs text-charcoal-400">{purchases ? 'Missing items go on a shopping list.' : 'Gusteau will only use what you have.'}</span>
                </span>
                <Toggle checked={purchases} onChange={setPurchases} label="Okay to buy missing items" />
              </label>
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
                {options.allowPurchase && (
                  <Button size="sm" variant="secondary" onClick={() => setPurchases(true)}>
                    Allow buying it
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {describeRules(rules).map((r) => (
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
          <p className="mt-2 text-xs text-charcoal-500">Gusteau adapted this recipe to your kitchen, so it’s no longer exactly the original.</p>
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
