import { ruleConflicts } from '../agent/kitchen';
import { cuisineById } from '../data/cuisines';
import { STAGE_ICONS } from '../data/stageIcons';
import type { Profile, Recipe, StageIconId } from '../types';
import { cx } from './ui';

/** The recipe's picture, or a cuisine-colored tile with its emoji. */
export function RecipeArt({ recipe, className, big = false }: { recipe: Recipe; className?: string; big?: boolean }) {
  const [a, b] = cuisineById(recipe.cuisine).colors;
  return (
    <div className={cx('relative overflow-hidden', className)} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }}>
      {recipe.image ? (
        <img src={recipe.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <span className={cx('absolute inset-0 flex select-none items-center justify-center drop-shadow-lg', big ? 'text-[7rem]' : 'text-6xl')} aria-hidden>
          {recipe.emoji}
        </span>
      )}
    </div>
  );
}

export function StageIcon({ icon, state = 'todo', size = 'md' }: { icon: StageIconId; state?: 'todo' | 'current' | 'done'; size?: 'sm' | 'md' }) {
  return (
    <span
      title={STAGE_ICONS[icon].label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-all',
        size === 'sm' ? 'h-7 w-7 text-sm' : 'h-10 w-10 text-lg',
        state === 'done' && 'bg-olive-500 ring-2 ring-olive-100',
        state === 'current' && 'bg-tomato-500 ring-4 ring-tomato-100',
        state === 'todo' && 'bg-cream-200',
      )}
      aria-hidden
    >
      {state === 'done' ? <span className="text-white">✓</span> : STAGE_ICONS[icon].glyph}
    </span>
  );
}

export function RecipeCard({ recipe, profile, onOpen }: { recipe: Recipe; profile: Profile; onOpen: () => void }) {
  const conflicts = ruleConflicts(recipe, profile);
  const cuisine = cuisineById(recipe.cuisine);
  return (
    <button
      onClick={onOpen}
      className="group flex w-full flex-col overflow-hidden rounded-3xl border border-cream-200 bg-white text-left shadow-card transition-all hover:-translate-y-0.5 hover:shadow-lift focus:outline-none focus-visible:ring-4 focus-visible:ring-tomato-100"
    >
      <RecipeArt recipe={recipe} className="aspect-[4/3] w-full transition-transform group-hover:scale-[1.02]" />
      <div className="flex flex-1 flex-col p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-olive-500">
          {cuisine.emoji} {cuisine.name}
        </p>
        <h3 className="mt-1 font-display text-lg font-semibold leading-snug text-charcoal-900">{recipe.title}</h3>
        {recipe.chef && <p className="mt-0.5 text-xs text-charcoal-400">{recipe.chef.relation ?? 'By'} {recipe.chef.name}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs text-charcoal-500">
          <span>⏱ {recipe.totalMinutes} min</span>
          <span>{recipe.difficulty}</span>
          <span className="flex gap-0.5" aria-label={`${recipe.stages.length} stages`}>
            {recipe.stages.map((s) => (
              <span key={s.key} title={s.title}>
                {STAGE_ICONS[s.icon].glyph}
              </span>
            ))}
          </span>
        </div>
        {conflicts.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-tomato-50 px-2.5 py-0.5 text-[11px] font-semibold text-tomato-700">Needs a swap for {conflicts[0].rule}</span>
          </div>
        )}
      </div>
    </button>
  );
}
