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

/** Sandbox card tones — assigned deterministically so a dish keeps its color. */
const TONES = ['tomato', 'sage', 'butter', 'blue', 'peach', 'rose'] as const;
const toneFor = (id: string): (typeof TONES)[number] => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
};

export function RecipeCard({
  recipe,
  profile,
  onOpen,
  index = 0,
  favorite = false,
  onToggleFavorite,
}: {
  recipe: Recipe;
  profile: Profile;
  onOpen: () => void;
  /** Position in its grid, for the staggered arrival animation. */
  index?: number;
  favorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  const conflicts = ruleConflicts(recipe, profile);
  const cuisine = cuisineById(recipe.cuisine);
  const tone = toneFor(recipe.id);
  const tag = recipe.tags.find(Boolean) ?? cuisine.name;
  return (
    <article className="dish-card" style={{ ['--card-delay' as string]: `${Math.min(index, 11) * 38}ms` }}>
      <button
        type="button"
        onClick={onOpen}
        className={`dish-art tone-${tone}`}
        aria-label={`Open ${recipe.title}`}
      >
        <span className="dish-blob" aria-hidden />
        <span className="dish-splash" aria-hidden>
          <span />
          <span />
          <span />
          <span />
        </span>
        {recipe.image ? (
          <img className="dish-photo" src={recipe.image} alt="" loading="lazy" decoding="async" width={480} height={360} />
        ) : (
          <span className="dish-emoji" aria-hidden>
            {recipe.emoji}
          </span>
        )}
        <span className="dish-tag">{tag}</span>
      </button>
      {onToggleFavorite && (
        <button
          type="button"
          className={cx('dish-save', favorite && 'is-saved')}
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? `Remove ${recipe.title} from favorites` : `Save ${recipe.title} to favorites`}
        >
          {favorite ? '♥' : '♡'}
        </button>
      )}
      <div className="dish-card-copy">
        <div className="dish-title-row">
          <h3>
            <button type="button" className="dish-title-btn" onClick={onOpen}>
              {recipe.title}
            </button>
          </h3>
          <span className="dish-time">
            ⏱ {recipe.totalMinutes} min · {recipe.difficulty}
          </span>
        </div>
        {recipe.description && <p>{recipe.description}</p>}
        {conflicts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-tomato-50 px-2.5 py-0.5 text-[11px] font-semibold text-tomato-700">Needs a swap for {conflicts[0].rule}</span>
          </div>
        )}
      </div>
    </article>
  );
}
