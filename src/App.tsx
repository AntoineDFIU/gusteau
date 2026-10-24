import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uid } from './agent/adapt';
import { parseBrowseIntent } from './agent/browseIntent';
import { EMPTY_FILTERS, type Filters } from './agent/kitchen';
import { Browse } from './components/Browse';
import { CookingWorkspace } from './components/cooking/CookingWorkspace';
import { Onboarding } from './components/Onboarding';
import { mergePantry } from './components/Pantry';
import { RecipePreview, type Kitchen } from './components/RecipePreview';
import { Modal, Spinner, cx } from './components/ui';
import { recipeSource, type RecipeLibrary } from './recipes/source';
import { modelService } from './services';
import { DEMO_PANTRY, DEMO_RECIPE_ID, DEMO_RULES } from './services/mock/mockData';
import { useCook } from './state/useCook';
import { useProfile } from './state/profile';
import type { CookSession, Recipe } from './types';
import { speak, stopSpeaking, useSpeech } from './voice/useSpeech';

type Screen = 'onboarding' | 'browse' | 'cooking';

export default function App() {
  const { profile, update } = useProfile();
  const [library, setLibrary] = useState<RecipeLibrary | null>(null);
  const [screen, setScreen] = useState<Screen>(profile.onboarded ? 'browse' : 'onboarding');
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, diet: profile.hardExclusions });
  const [preview, setPreview] = useState<{ recipe: Recipe; kitchen: Kitchen } | null>(null);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    void recipeSource.load().then(setLibrary);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onFinish = useCallback(
    (s: CookSession) => update((p) => ({ history: [...p.history, { recipeId: s.original.id, cuisine: s.original.cuisine, at: Date.now(), finished: true }].slice(-50) })),
    [update],
  );
  const cook = useCook(onFinish);

  // ── Voice: one mic for the whole app ──
  const onPhrase = (text: string) => {
    if (screen === 'cooking' && cook.session) return void cook.sendChat(text);
    if (screen !== 'browse') return;
    const intent = parseBrowseIntent(text);
    if (intent.addPantry.length) update((p) => ({ pantry: mergePantry(p.pantry, intent.addPantry, 'chat') }));
    setFilters((f) => ({ ...f, ...intent.filters }));
    setPreview(null);
    setToast(intent.summary.length ? `🎤 “${text}” → ${intent.summary.join(' · ')}` : `🎤 “${text}”`);
  };
  const speech = useSpeech(onPhrase);

  // Read the current step aloud on request, or automatically in hands-free mode.
  const s = cook.session;
  const lastRead = useRef(0);
  useEffect(() => {
    const req = cook.readRequest;
    if (!s || req.n === lastRead.current) return;
    lastRead.current = req.n;
    if (!req.force && !speech.handsFree) return;
    const step = s.recipe.steps[s.stepIndex];
    void speak(step ? `${step.title}. ${step.text}` : 'All done. Bon appétit!', !req.force);
  }, [cook.readRequest]);
  // In hands-free mode, Gusteau also says its replies.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    const last = s?.chat[s.chat.length - 1];
    if (!last || last.from !== 'gusteau' || last.id === lastSpoken.current) return;
    lastSpoken.current = last.id;
    if (speech.handsFree) void speak(last.text);
  }, [s?.chat, speech.handsFree]);

  const leaveCooking = () => {
    speech.setHandsFree(false);
    stopSpeaking();
    cook.stop();
    setScreen('browse');
    window.scrollTo({ top: 0 });
  };

  const startCooking = async (recipe: Recipe, kitchen: Kitchen, rules: Parameters<typeof cook.start>[1], leaveOut: string[]) => {
    await cook.start(recipe, rules, kitchen.pantry, kitchen.basics, leaveOut);
    setPreview(null);
    setScreen('cooking');
    window.scrollTo({ top: 0 });
  };

  const loadDemo = () => {
    const recipe = library?.recipes.find((r) => r.id === DEMO_RECIPE_ID);
    if (!recipe) return setToast('The demo recipe isn’t in this recipe file.');
    setFilters({ ...EMPTY_FILTERS, cuisine: 'mexican' });
    setPreview({ recipe, kitchen: { pantry: DEMO_PANTRY.map((p) => ({ ...p, id: uid() })), basics: true, rules: DEMO_RULES, label: 'Demo kitchen' } });
  };

  const myKitchen: Kitchen = useMemo(() => ({ pantry: profile.pantry, basics: profile.pantryBasics }), [profile.pantry, profile.pantryBasics]);
  const micVisible = screen !== 'onboarding' && speech.supported && !speech.handsFree;
  const listening = speech.state === 'listening' && !speech.handsFree;

  return (
    <div className="min-h-screen bg-cream-100 bg-[radial-gradient(ellipse_at_top_right,rgba(242,140,56,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(107,122,58,0.08),transparent_50%)]">
      <header className="sticky top-0 z-30 h-[61px] border-b border-cream-200/80 bg-cream-100/90 backdrop-blur">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <button onClick={() => (screen === 'cooking' ? leaveCooking() : profile.onboarded && setScreen('browse'))} className="flex items-center gap-2.5" aria-label="Gusteau home">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-tomato-500 text-lg shadow-lift">👨‍🍳</span>
            <span className="text-left leading-none">
              <span className="block font-display text-xl font-semibold text-charcoal-900">Gusteau</span>
              <span className="hidden text-[11px] text-charcoal-400 sm:block">Your personal chef assistant</span>
            </span>
          </button>

          <div className="flex items-center gap-2">
            <span
              className={cx('hidden rounded-full px-3 py-1 text-[11px] font-semibold md:inline', modelService.mode === 'mock' ? 'bg-cream-200 text-charcoal-500' : 'bg-olive-100 text-olive-700')}
              title={modelService.mode === 'mock' ? 'Using local mock services. See README to connect a model.' : 'Connected to a live model'}
            >
              {modelService.label}
            </span>
            {profile.onboarded && screen !== 'cooking' && (
              <button onClick={() => setEditingPrefs(true)} className="rounded-full px-3 py-2 text-sm font-medium text-charcoal-500 hover:bg-cream-200 hover:text-charcoal-900">
                ⚙︎ <span className="hidden sm:inline">Preferences</span>
              </button>
            )}
            {micVisible && (
              <button
                onClick={speech.listenOnce}
                aria-label={listening ? 'Stop listening' : 'Talk to Gusteau'}
                aria-pressed={listening}
                className={cx(
                  'flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-semibold transition-colors',
                  listening ? 'bg-tomato-500 text-white' : 'bg-charcoal-900 text-white hover:bg-charcoal-700',
                )}
              >
                {listening ? <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> : <span aria-hidden>🎤</span>}
                <span className="hidden sm:inline">{listening ? 'Listening… tap to stop' : 'Ask Gusteau'}</span>
              </button>
            )}
            {screen !== 'onboarding' && speech.state === 'blocked' && <span className="text-xs text-tomato-600">Mic blocked in browser settings</span>}
          </div>
        </div>
        {listening && speech.interim && (
          <p className="absolute inset-x-0 top-full truncate bg-charcoal-900 px-4 py-1.5 text-center text-xs italic text-white">“{speech.interim}”</p>
        )}
      </header>

      <main className="px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {screen === 'onboarding' && (
          <Onboarding
            profile={profile}
            onDone={(patch) => {
              update(patch);
              setFilters({ ...EMPTY_FILTERS, diet: patch.hardExclusions ?? [] });
              setScreen('browse');
            }}
          />
        )}

        {screen === 'browse' &&
          (library ? (
            library.recipes.length ? (
              <Browse
                recipes={library.recipes}
                profile={profile}
                filters={filters}
                setFilters={setFilters}
                onOpen={(recipe) => setPreview({ recipe, kitchen: myKitchen })}
                onPantry={(pantry, pantryBasics) => update({ pantry, pantryBasics })}
                onDemo={loadDemo}
                micHint={speech.supported}
              />
            ) : (
              <p className="mx-auto max-w-md text-center text-charcoal-500">No recipes found. Put a recipes.json or recipes.csv export in public/recipes/ (see docs/RECIPE_FORMAT.md).</p>
            )
          ) : (
            <p className="flex items-center justify-center gap-2 text-charcoal-500">
              <Spinner className="text-tomato-500" /> Loading recipes…
            </p>
          ))}

        {screen === 'cooking' && cook.session && <CookingWorkspace cook={cook} speech={speech} onExit={leaveCooking} />}
      </main>

      <Modal open={!!preview} onClose={() => setPreview(null)} label={preview?.recipe.title ?? 'Recipe'} wide>
        {preview && (
          <RecipePreview
            key={preview.recipe.id}
            recipe={preview.recipe}
            profile={profile}
            kitchen={preview.kitchen}
            busy={cook.busy === 'starting'}
            onClose={() => setPreview(null)}
            onCook={(rules, leaveOut) => void startCooking(preview.recipe, preview.kitchen, rules, leaveOut)}
          />
        )}
      </Modal>

      <Modal open={editingPrefs} onClose={() => setEditingPrefs(false)} label="Preferences" wide>
        <div className="p-5 sm:p-8">
          <Onboarding
            editing
            profile={profile}
            onDone={(patch) => {
              update(patch);
              setFilters((f) => ({ ...f, diet: patch.hardExclusions ?? f.diet }));
              setEditingPrefs(false);
            }}
          />
        </div>
      </Modal>

      {toast && (
        <div role="status" className="fixed inset-x-4 bottom-6 z-50 mx-auto max-w-md animate-pop rounded-2xl bg-charcoal-900 px-4 py-3 text-center text-sm text-white shadow-card">
          {toast}
        </div>
      )}

      <footer className="border-t border-cream-200 px-4 py-6 text-center text-xs text-charcoal-400">
        Gusteau is a cooking assistant, not a food-safety or allergy authority. It can’t verify freshness or allergens. Always check labels and use your judgment.
      </footer>
    </div>
  );
}
