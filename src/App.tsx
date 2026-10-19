import { AnalyzingScreen } from './components/AnalyzingScreen';
import { ConstraintsScreen } from './components/ConstraintsScreen';
import { CookingScreen } from './components/cooking/CookingScreen';
import { PlanningScreen } from './components/PlanningScreen';
import { RecipeScreen } from './components/RecipeScreen';
import { ReviewScreen } from './components/ReviewScreen';
import { UploadScreen } from './components/UploadScreen';
import { cx } from './components/ui';
import { modelService } from './services';
import { useSession, type Screen } from './state/useSession';

const STEPS: { label: string; screens: Screen[] }[] = [
  { label: 'Kitchen', screens: ['upload', 'analyzing'] },
  { label: 'Ingredients', screens: ['review'] },
  { label: 'Rules', screens: ['constraints'] },
  { label: 'Recipe', screens: ['planning', 'recipe'] },
  { label: 'Cook', screens: ['cooking'] },
];

export default function App() {
  const session = useSession();
  const { screen, state } = session;
  const activeIdx = STEPS.findIndex((s) => s.screens.includes(screen));

  return (
    <div className="min-h-screen bg-cream-100 bg-[radial-gradient(ellipse_at_top_right,rgba(242,140,56,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(107,122,58,0.08),transparent_50%)]">
      <header className="sticky top-0 z-30 border-b border-cream-200/80 bg-cream-100/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <button onClick={session.restart} className="flex items-center gap-2.5" aria-label="Gusteau home">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-tomato-500 text-lg shadow-lift">👨‍🍳</span>
            <span className="text-left leading-none">
              <span className="block font-display text-xl font-semibold text-charcoal-900">Gusteau</span>
              <span className="hidden text-[11px] text-charcoal-400 sm:block">Your personal chef assistant</span>
            </span>
          </button>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Progress">
            {STEPS.map((s, i) => (
              <div key={s.label} className="flex items-center gap-1">
                <span
                  className={cx(
                    'rounded-full px-3 py-1 text-xs font-semibold transition-colors',
                    i === activeIdx ? 'bg-charcoal-900 text-white' : i < activeIdx ? 'text-olive-700' : 'text-charcoal-400',
                  )}
                >
                  {i < activeIdx ? '✓ ' : ''}
                  {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="h-px w-4 bg-cream-300" />}
              </div>
            ))}
          </nav>

          <span
            className={cx(
              'rounded-full px-3 py-1 text-[11px] font-semibold',
              modelService.mode === 'mock' ? 'bg-cream-200 text-charcoal-500' : 'bg-olive-100 text-olive-700',
            )}
            title={modelService.mode === 'mock' ? 'Using local mock image + agent services. See README to connect NVIDIA Nemotron.' : 'Connected to Nebius Token Factory'}
          >
            {modelService.label}
          </span>
        </div>
      </header>

      <main className="px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        {screen === 'upload' && <UploadScreen onAnalyze={session.analyze} onManual={session.startManual} onDemo={session.loadDemo} />}
        {screen === 'analyzing' && <AnalyzingScreen photos={session.photos} />}
        {screen === 'review' && (
          <ReviewScreen
            key={state.inventory.map((i) => i.id).join()}
            initial={state.inventory}
            fromPhoto={session.photos.length > 0}
            notice={session.notice}
            onConfirm={session.confirmInventory}
            onBack={() => session.go('upload')}
          />
        )}
        {screen === 'constraints' && (
          <ConstraintsScreen initial={state.constraints} onSubmit={session.confirmConstraints} onBack={() => session.go('review')} />
        )}
        {screen === 'planning' && <PlanningScreen state={state} />}
        {screen === 'recipe' && (
          <RecipeScreen
            state={state}
            onCook={session.startCooking}
            onEdit={() => session.go('constraints')}
            onEditIngredients={() => session.go('review')}
          />
        )}
        {screen === 'cooking' && state.recipe && <CookingScreen session={session} />}
      </main>

      <footer className="border-t border-cream-200 px-4 py-6 text-center text-xs text-charcoal-400">
        Gusteau is a cooking assistant, not a food-safety or allergy authority. Always check labels and use your judgment.
      </footer>
    </div>
  );
}
