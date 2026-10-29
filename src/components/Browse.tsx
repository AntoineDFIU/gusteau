import { useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_FILTERS, activeFilterCount, matchesFilters, recommendScore, tasteOf, type Filters } from '../agent/kitchen';
import { CUISINES, cuisineById } from '../data/cuisines';
import { GRAINS, PROTEINS, type GrainId, type ProteinId } from '../data/ingredients';
import { DIET_RULES, DIET_RULE_IDS, DIFFICULTIES, EQUIPMENT } from '../data/rules';
import type { PantryItem, Profile, Recipe } from '../types';
import { RecipeCard } from './RecipeCard';
import { Button, Card, Chip, SectionTitle, Toggle, cx } from './ui';

const TIMES = [15, 30, 45, 60];

export function Browse({
  recipes,
  profile,
  filters,
  setFilters,
  onOpen,
  onToast,
}: {
  recipes: Recipe[];
  profile: Profile;
  filters: Filters;
  setFilters: (f: Filters) => void;
  onOpen: (r: Recipe) => void;
  // Retained for the temporarily commented-out kitchen and demo panels.
  onPantry: (pantry: PantryItem[], basics: boolean) => void;
  onDemo: () => void;
  onToast?: (message: string) => void;
}) {
  const [showAllCuisines, setShowAllCuisines] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [favIds, setFavIds] = useState<ReadonlySet<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const toggleFavorite = (r: Recipe) => {
    const wasSaved = favIds.has(r.id);
    setFavIds((prev) => {
      const next = new Set(prev);
      if (next.has(r.id)) next.delete(r.id);
      else next.add(r.id);
      return next;
    });
    onToast?.(wasSaved ? `Removed ${r.title} from your favorites.` : `Saved ${r.title} for a cozy night in.`);
  };

  // "/" focuses the search box, like the sandbox (skipped while typing or with a dialog open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const taste = useMemo(() => tasteOf(profile, recipes), [profile, recipes]);
  const scored = useMemo(() => {
    const s = new Map(recipes.map((r) => [r.id, recommendScore(r, profile, taste)]));
    return [...recipes].sort((a, b) => s.get(b.id)! - s.get(a.id)!);
  }, [recipes, profile, taste]);
  const shown = useMemo(() => {
    const list = scored.filter((r) => matchesFilters(r, filters, profile));
    // Inside one cuisine, show its most popular dishes first.
    return filters.cuisine ? list.sort((a, b) => b.popularity - a.popularity) : list;
  }, [scored, filters, profile]);

  const favorites = CUISINES.filter((c) => profile.favoriteCuisines.includes(c.id));
  const others = CUISINES.filter((c) => !profile.favoriteCuisines.includes(c.id) && recipes.some((r) => r.cuisine === c.id));
  const cuisineChips = showAllCuisines || !favorites.length ? [...favorites, ...others] : favorites;
  // The profile's own diet rules are the starting point, not a filter the user added.
  const base: Filters = { ...EMPTY_FILTERS, diet: profile.hardExclusions };
  const dietIsDefault = filters.diet.length === profile.hardExclusions.length && filters.diet.every((d) => profile.hardExclusions.includes(d));
  const nFilters = activeFilterCount(filters) - (dietIsDefault ? filters.diet.length : 0);
  const browsingAll = !filters.cuisine && !filters.search && !nFilters;
  const returning = profile.history.some((h) => h.finished);
  const picks = browsingAll ? scored.filter((r) => matchesFilters(r, base, profile)).slice(0, 4) : [];
  const cuisine = filters.cuisine ? cuisineById(filters.cuisine) : null;

  return (
    <div className="mx-auto max-w-7xl animate-rise">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="mx-auto w-full max-w-[720px]">
        <label className="dish-search" style={{ height: 52 }}>
          <span className="dish-search-icon" aria-hidden />
          <span className="sr-only">Find a dish</span>
          <input
            ref={searchRef}
            type="search"
            value={filters.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Find a dish…"
            aria-label="Find a dish"
          />
          <kbd aria-hidden>/</kbd>
        </label>
      </form>

      {/* Cuisines */}
      <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Cuisines">
        <button type="button" className={cx('dish-pill', !filters.cuisine && 'is-active')} aria-pressed={!filters.cuisine} onClick={() => set({ cuisine: null })}>
          🌍 All <span className="dish-pill-count">{recipes.length}</span>
        </button>
        {cuisineChips.map((c) => (
          <button
            key={c.id}
            type="button"
            className={cx('dish-pill', filters.cuisine === c.id && 'is-active')}
            aria-pressed={filters.cuisine === c.id}
            onClick={() => set({ cuisine: filters.cuisine === c.id ? null : c.id })}
          >
            {c.emoji} {c.name}
            {profile.favoriteCuisines.includes(c.id) && <span className="text-saffron-500" aria-label="favorite">★</span>}
          </button>
        ))}
        {favorites.length > 0 && others.length > 0 && (
          <button onClick={() => setShowAllCuisines((v) => !v)} className="px-2 text-sm font-semibold text-olive-500 hover:text-olive-700">
            {showAllCuisines ? 'Fewer' : `+ ${others.length} more cuisines`}
          </button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant={showFilters || nFilters ? 'primary' : 'secondary'} size="sm" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          ⚙︎ Filters{nFilters ? ` · ${nFilters}` : ''}
        </Button>
        {/* Kitchen access is paused with the sidebar. Restore its showPantry state with the panel.
        <Button variant="secondary" size="sm" className="lg:hidden" onClick={() => setShowPantry((v) => !v)} aria-expanded={showPantry}>
          🧺 My kitchen{profile.pantry.length ? ` · ${profile.pantry.length}` : ''}
        </Button>
        */}
        {(nFilters > 0 || filters.search || filters.cuisine) && (
          <button onClick={() => setFilters(base)} className="px-2 text-sm font-medium text-charcoal-400 hover:text-tomato-600">
            Clear all
          </button>
        )}
        <p className="dish-count ml-auto" aria-live="polite">
          {shown.length} {shown.length === 1 ? 'dish' : 'dishes'}
        </p>
      </div>

      {showFilters && (
        <Card className="mt-3 grid gap-5 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <FilterGroup title="Diet">
            {DIET_RULE_IDS.map((d) => (
              <Chip key={d} active={filters.diet.includes(d)} onClick={() => set({ diet: toggle(filters.diet, d) })}>
                {DIET_RULES[d].label}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup title="Protein">
            {(Object.keys(PROTEINS) as ProteinId[]).map((p) => (
              <Chip key={p} active={filters.proteins.includes(p)} onClick={() => set({ proteins: toggle(filters.proteins, p) })}>
                {PROTEINS[p].emoji} {PROTEINS[p].label}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup title="Rice, grains & carbs">
            {(Object.keys(GRAINS) as GrainId[]).map((g) => (
              <Chip key={g} active={filters.grains.includes(g)} onClick={() => set({ grains: toggle(filters.grains, g) })}>
                {GRAINS[g].emoji} {GRAINS[g].label}
              </Chip>
            ))}
            <Chip tone="olive" active={filters.vegForward} onClick={() => set({ vegForward: !filters.vegForward })}>
              🥦 Veg-forward
            </Chip>
          </FilterGroup>
          <FilterGroup title="Cooking time">
            {TIMES.map((t) => (
              <Chip key={t} active={filters.maxMinutes === t} onClick={() => set({ maxMinutes: filters.maxMinutes === t ? null : t })}>
                ≤ {t} min
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup title="Difficulty">
            {DIFFICULTIES.map((d) => (
              <Chip key={d} active={filters.difficulty.includes(d)} onClick={() => set({ difficulty: toggle(filters.difficulty, d) })}>
                {d}
              </Chip>
            ))}
          </FilterGroup>
          <FilterGroup title="Equipment">
            <label className="flex w-full items-center justify-between gap-3 text-sm text-charcoal-700">
              <span>
                Only my equipment
                <span className="block text-xs text-charcoal-400">{profile.equipment.map((e) => EQUIPMENT[e].label).join(', ')}</span>
              </span>
              <Toggle checked={!!filters.equipment} onChange={(v) => set({ equipment: v ? profile.equipment : null })} label="Only my equipment" />
            </label>
          </FilterGroup>
        </Card>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr]">
        <div className="min-w-0">
          {picks.length > 0 && (
            <section className="mb-10">
              <SectionTitle>{returning ? 'Familiar Dishes' : profile.favoriteCuisines.length ? 'Picked for you' : 'Popular Dishes'}</SectionTitle>
              <div className="mt-3 grid grid-cols-1 gap-[17px] sm:grid-cols-2 xl:grid-cols-3">
                {picks.map((r, i) => (
                  <RecipeCard key={r.id} recipe={r} profile={profile} onOpen={() => onOpen(r)} index={i} favorite={favIds.has(r.id)} onToggleFavorite={() => toggleFavorite(r)} />
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionTitle>
              {cuisine ? `Popular ${cuisine.name} dishes` : browsingAll ? 'Every cuisine' : 'Matching dishes'} · {shown.length}
              {dietIsDefault && filters.diet.length > 0 && ` ${filters.diet.map((d) => DIET_RULES[d].label.toLowerCase()).join(', ')}`}
            </SectionTitle>
            {shown.length ? (
              <div key={filters.cuisine ?? 'all'} className="mt-3 grid grid-cols-1 gap-[17px] sm:grid-cols-2 xl:grid-cols-3">
                {shown.map((r, i) => (
                  <RecipeCard key={r.id} recipe={r} profile={profile} onOpen={() => onOpen(r)} index={i} favorite={favIds.has(r.id)} onToggleFavorite={() => toggleFavorite(r)} />
                ))}
              </div>
            ) : (
              <div className="dish-empty mt-3">
                <p className="text-4xl">🤔</p>
                <p className="mt-3 font-display text-xl font-semibold text-charcoal-900">No dishes match all of that</p>
                <p className="mt-1 text-sm text-charcoal-500">Try removing a filter or two.</p>
                <Button className="mt-4" variant="secondary" onClick={() => setFilters({ ...base, cuisine: filters.cuisine })}>
                  Clear filters
                </Button>
              </div>
            )}
          </section>
        </div>

        {/* Kitchen and demo panels are retained for later. To restore: import PantryPanel,
            destructure onPantry/onDemo, and restore showPantry state and the mobile toggle.
        <aside className={cx('space-y-4 lg:sticky lg:top-24 lg:self-start', !showPantry && 'hidden lg:block', 'order-first lg:order-none')}>
          <PantryPanel pantry={profile.pantry} basics={profile.pantryBasics} onChange={onPantry} />
          <Card className="overflow-hidden border-saffron-100 bg-gradient-to-br from-saffron-100/70 via-white to-tomato-50 p-5">
            <p className="font-display text-lg font-semibold text-charcoal-900">🎬 Try the live replanning demo</p>
            <p className="mt-1 text-sm text-charcoal-500">
              A microwave burrito bowl with rice, beans, tortillas, cheese and salsa. Vegetarian, 15 minutes, microwave only. Then say “Actually, I don’t have rice.”
            </p>
            <Button variant="olive" size="sm" className="mt-3" onClick={onDemo}>
              Load the demo
            </Button>
          </Card>
        </aside> */}
      </div>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <SectionTitle className="mb-2">{title}</SectionTitle>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}
