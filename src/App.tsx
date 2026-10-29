import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_FILTERS, activeFilterCount, matchesFilters, scaleRecipe, type Filters } from './agent/kitchen';
import { Browse } from './components/Browse';
import { CookingWorkspace } from './components/cooking/CookingWorkspace';
import { Onboarding } from './components/Onboarding';
import { RecipePreview, type Kitchen } from './components/RecipePreview';
import { Modal, Spinner, cx } from './components/ui';
import { recipeSource, type RecipeLibrary } from './recipes/source';
import { modelService } from './services';
import { DEMO_RECIPE_ID, DEMO_RULES } from './services/mock/mockData';
import { confirmation, useCook } from './state/useCook';
import { useProfile } from './state/profile';
import type { CookSession, PendingChoice, Recipe } from './types';
import { answerMissing, missingQuestion } from './agent/missing';
import { PREVIEW_INGREDIENT_QUESTION, previewRequestsRecipes, previewSubstitution, substitutionClarification, type PendingPreviewIngredient } from './agent/previewIntent';
import { useVoice } from './voice/useVoice';
import { afterWakeWord } from './voice/wakeWord';
import { unlockAudio } from './voice/audioUnlock';
import { browseByVoice, modelSearch, picksFor, positionIn, previewCommand, recipeNamed, runSearch, shownRecipes, type BrowseAction } from './agent/voiceBrowse';
import { OPENING, discoveryCommand, ingredientsReading, missingIn, missingNames, optionsReading, readNext, selectionIntro, type Reading } from './agent/discovery';
import { CUISINES } from './data/cuisines';
import { VoicePanel, type Turn } from './components/VoicePanel';
import { TextChat } from './components/TextChat';
import { DebugPanel } from './components/DebugPanel';
import { ModelPicker } from './components/ModelPicker';
import { logHeard } from './debug/debugLog';
import { speakable } from './agent/stepSpeech';
import { changesMeaning, checkFirst, riskyReading } from './agent/heardAs';

type Screen = 'onboarding' | 'browse' | 'cooking';

/** The search on screen in words, for the model: "Thai, cheese, 30 minutes or less". */
const describeFilters = (f: Filters) =>
  [CUISINES.find((c) => c.id === f.cuisine)?.name, f.search, f.maxMinutes ? `${f.maxMinutes} minutes or less` : '', ...f.diet, f.equipment ? `only ${f.equipment.join(', ')}` : ''].filter(Boolean).join(', ');

// Spoken controls, as whole phrases (after his name, or while he's listening).
const asCommand = (t: string) => t.toLowerCase().replace(/[‘’]/g, "'").replace(/[?!.,]/g, '').replace(/\s+(please|gusteau|chef)$/, '').trim();
/** "Go to sleep", "that's all": back to waiting for "Hey Gusteau". Hands-free stays on. */
// Any short phrase ending in "sleep" counts: the recognizer writes "go to sleep" as "Kaučas sleep", "gotta sleep"…
const GO_TO_SLEEP = /^(?:(?:ok|okay|thanks|thank you|great)\s+)*((?:\S+\s+){0,2}sleep|stop listening|you can stop listening|that'?s all( for now)?|that'?s it( for now)?|deactivate|goodbye|bye( for now)?|see you|i'?m good( for now)?|we'?re done( for now)?)$/;
/** "Turn off hands-free", "stop listening": the same as the Stop button. */
const TURN_OFF = /^(turn (off|yourself off) hands[- ]?free( mode)?|turn off hands[- ]?free( mode)?|hands[- ]?free off|stop hands[- ]?free( mode)?|turn (yourself )?off|switch off)$/;
/** "Mute": the mic stops listening until the mute button is tapped again. */
const MUTE = /^(mute|mute( the)? (mic|microphone)|mute yourself)$/;


/** After Gusteau answers (or when tapped), he waits this long for the cook to say more. */
const LISTEN_WINDOW_MS = 5000;
/** After Gusteau asks something or waits on an answer, he gives the cook longer to reply. */
const REPLY_WINDOW_MS = 10000;
/** He asked something, or asked the cook to say or choose something ("Say “more” for the next one, or pick one by name or number"). */
const expectsReply = (said: string) => /\?\s*$/.test(said.trim()) || /\b(say “|tell me\b|let me know|pick (one|another)|choose|which one)/i.test(said);

export default function App() {
  const [hideDevTools, setHideDevTools] = useState(() => {
    try {
      return localStorage.getItem('gusteau.hideDevTools') === 'on';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('gusteau.hideDevTools', hideDevTools ? 'on' : 'off');
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }, [hideDevTools]);
  const { profile, update, reset } = useProfile();
  const [library, setLibrary] = useState<RecipeLibrary | null>(null);
  const [screen, setScreen] = useState<Screen>(profile.onboarded ? 'browse' : 'onboarding');
  const [inviteToTalk, setInviteToTalk] = useState(true);
  useEffect(() => {
    if (screen !== 'browse' || !inviteToTalk) return;
    const timeout = window.setTimeout(() => setInviteToTalk(false), 9000);
    return () => window.clearTimeout(timeout);
  }, [screen, inviteToTalk]);
  const [filters, setFilters] = useState<Filters>({ ...EMPTY_FILTERS, diet: profile.hardExclusions });
  const [preview, setPreview] = useState<{ recipe: Recipe; kitchen: Kitchen } | null>(null);
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [chatHost, setChatHost] = useState<HTMLDivElement | null>(null);
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
  // Saved dishes live in the profile, so they come first next time the cook browses.
  const favorites = profile.favoriteRecipes;
  const setFavorite = useCallback(
    (recipeId: string, on: boolean) => update((p) => ({ favoriteRecipes: on ? [...new Set([...p.favoriteRecipes, recipeId])] : p.favoriteRecipes.filter((id) => id !== recipeId) })),
    [update],
  );
  // What Gusteau says when a timer rings (and which timer is next) goes in the chat, which he reads aloud.
  const cook = useCook({ onFinish, isFavorite: (id) => favorites.includes(id), onFavorite: (id) => setFavorite(id, true) });

  // ── Voice: one mic and one voice for the whole app ──
  // Hands-free stays on from the craving page through the preview and the
  // kitchen. Gusteau answers when he's called ("Hey Gusteau", "Hey Chef"),
  // and for a few seconds after he's spoken, so a conversation flows.
  //
  // While cooking, a spoken phrase goes to Gusteau like a chat message. A plain
  // answer is read aloud while the model is still writing it; plan changes are
  // answered with the validated replan message. A phrase that arrives while
  // Gusteau is still busy waits for him (only the latest one is kept).
  const waiting = useRef<string | null>(null);
  const askByVoice = (text: string) => {
    if (cook.busy) {
      waiting.current = text;
      return;
    }
    let reading: ReturnType<typeof voice.stream> | null = null;
    void cook
      .sendChat(text, {
        via: 'voice',
        onReply: (sofar) => {
          reading ??= voice.stream();
          reading.push(sofar);
        },
      })
      .finally(() => reading?.finish());
  };
  // ── Is Gusteau being talked to? ──
  // He always listens for his name, "Hey Gusteau" or "Hey Chef". Called, he greets the cook
  // and listens ten seconds for an answer; tapped, he chimes and listens five. Once they start,
  // he hears them out however long they talk (a request ends after two seconds without new words, so a pause to think doesn’t cut you off). After
  // each answer he listens five seconds for more, or ten when he asked something or waits on an
  // answer ("Do you have another kind of cheese?"). If nobody talks, he waits for his name again.
  const [turn, setTurnState] = useState<Turn>('waiting');
  /** The debug panel: transcriptions, model requests and responses. Remembered in this browser. */
  const [debug, setDebugState] = useState(() => {
    try {
      return localStorage.getItem('gusteau.debug') === 'on';
    } catch {
      return false;
    }
  });
  const setDebug = (f: (on: boolean) => boolean) =>
    setDebugState((d) => {
      const on = f(d);
      try {
        if (on) localStorage.setItem('gusteau.debug', 'on');
        else localStorage.removeItem('gusteau.debug');
      } catch {
        // Private mode: not remembered.
      }
      return on;
    });
  const turnRef = useRef<Turn>('waiting');
  const setTurn = (t: Turn) => {
    turnRef.current = t;
    setTurnState(t);
  };
  /** How long the current window waits for the cook to start talking. */
  const windowMs = useRef(LISTEN_WINDOW_MS);
  /** Listen for the cook to start talking, for `ms` once he's quiet. */
  const openWindow = (ms: number) => {
    windowMs.current = ms;
    setTurn('open');
  };
  /** He has started saying his answer, so once he's quiet the turn is over. */
  const answered = useRef(false);
  /** His answer invites a reply without asking a question ("When you're ready, say “let's cook”"). */
  const invited = useRef(false);

  // ── Choosing what to cook, by talking with Gusteau ──
  // He asks what you're in the mood for, searches with what you tell him, and
  // the thumbnails show the results while he names one or two (agent/discovery.ts).
  // With a model, it reads what you mean (modelService.discover); the app runs
  // the search and says what it found, so he can't name a dish that isn't there.
  // What was heard and said is shown from the conversation log (debug/debugLog.ts) in the voice panel.
  const [, setHeard] = useState('');
  const [, setSaid] = useState('');
  /** How Gusteau understood what was heard, when that differs in meaning ("Interpreted as…"). */
  const [interpreted, setInterpreted] = useState('');
  /** The last few turns, so the model can follow the conversation. */
  const talk = useRef<string[]>([]);
  const lastSaid = useRef('');
  /** `queue`: after whatever he's saying (an adjustment after his introduction), instead of cutting it off. */
  const reply = (text: string, queue = false) => {
    setSaid(text);
    lastSaid.current = text;
    talk.current = [...talk.current, `Gusteau: ${text}`].slice(-6);
    voice.say(speakable(text), queue);
  };
  /** The dishes on screen, in order, so "the second one" or "number five" can be opened. */
  const listed = useRef<Recipe[]>([]);
  /** Options or ingredients being read out, so "more" goes on. */
  const reading = useRef<Reading | null>(null);
  /** Gusteau just offered to read the options, so a plain "yes" means read them. */
  const offeredReading = useRef(false);
  const [cookSignal, setCookSignal] = useState(0);
  /** What the cook said they don't have for the dish being previewed, and what they agreed to use instead (no `to`: leave it out). */
  const [decided, setDecided] = useState<{ name: string; to?: string }[]>([]);
  /** Gusteau asked "Do you have another kind of cheese?" and waits for the answer. */
  const [asking, setAsking] = useState<(PendingChoice & { say: string }) | null>(null);
  /** The substitution request is open, but its source ingredient wasn't understood yet. */
  const [pendingIngredient, setPendingIngredient] = useState<PendingPreviewIngredient | null>(null);
  useEffect(() => {
    setPendingIngredient(null);
  }, [preview?.recipe.id]);
  /** More missing ingredients named at once, asked about one at a time. */
  const toAsk = useRef<string[]>([]);

  /** Things the cook said they don't have before choosing a dish ("I don't have butter"); the dish they pick works around them. */
  const lacking = useRef<string[]>([]);
  /** How the previewed recipe's steps will be grouped when cooking (the model's grouping, cached), so the preview shows those steps. */
  const [staged, setStaged] = useState<{ id: string; stages: Recipe['stages'] } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const id = preview.recipe.id;
    let live = true;
    modelService.stageRecipe(preview.recipe).then(
      (st) => live && setStaged({ id, stages: st.stages }),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [preview?.recipe.id]);
  const openPreview = (recipe: Recipe, say?: string) => {
    setPreview({ recipe, kitchen: preview?.kitchen ?? {} });
    setDecided([]);
    setAsking(null);
    setPendingIngredient(null);
    reading.current = null;
    offeredReading.current = false;
    if (say) {
      reply(say);
      // He just introduced the dish and asked to hear "let's cook" or what's missing: listen for it.
      invited.current = true;
    }
    // "I don't have butter", said before choosing: asked about now, after his introduction.
    const lacks = [...new Set(lacking.current.map((n) => missingIn(`I don't have ${n}`, recipe)?.found[0]?.name).filter((n): n is string => !!n))];
    toAsk.current = lacks.slice(1);
    if (lacks.length) askMissing(recipe, lacks[0], !!say);
  };
  const previewRules = (recipe: Recipe) => ({ hardExclusions: profile.hardExclusions, allergies: profile.allergies, equipment: [...new Set([...profile.equipment, ...recipe.equipment])] });
  /** "I don't have cheddar": Gusteau asks what could stand in, and offers to go without only if the dish still works. Nothing changes until the cook answers. */
  const askMissing = (recipe: Recipe, name: string, queue = false) => {
    const ing = recipe.ingredients.find((i) => i.name === name);
    if (!ing) return;
    const q = missingQuestion(ing, recipe, previewRules(recipe), 'preview');
    setPendingIngredient(null);
    setAsking(q);
    reply(q.say, queue);
  };
  /** The cook's answer, spoken, typed or tapped. False when it isn't one ("let's cook"). */
  const answerAsking = (text: string, recipe: Recipe, question = asking): boolean => {
    if (!question) return false;
    const a = answerMissing(text, question, recipe, previewRules(recipe), 'preview');
    if (!a) return false;
    // Settled: the preview adapts the recipe and says how (onAdjusted), then asks about the next one.
    if (a.kind === 'drop' || a.kind === 'swap') {
      const to = a.kind === 'swap' ? a.to : undefined;
      setAsking(null);
      setPendingIngredient(null);
      setDecided((d) => [...d.filter((x) => x.name !== question.current), { name: question.current, to }]);
    } else {
      setAsking({ ...question, confirming: a.kind === 'confirm' ? a.to : undefined, say: a.say });
      reply(a.say);
    }
    return true;
  };
  const showByVoice = (a: Exclude<BrowseAction, { kind: 'none' }>) => {
    if (a.kind === 'open') return openPreview(a.recipe, a.say);
    setPreview(null);
    setFilters(a.filters);
    listed.current = a.results;
    reading.current = null;
    offeredReading.current = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    reply(a.say);
  };
  /** Read the next group of options or ingredients ("Here are the first four: one, …"). */
  const readOn = (r: Reading) => {
    const next = readNext(r);
    reading.current = next.reading;
    offeredReading.current = false;
    reply(next.say);
  };
  const ruleBased = (text: string) => {
    const a = browseByVoice(text, library!.recipes, profile, filters, listed.current);
    if (a.kind === 'none') return reply(a.say);
    showByVoice(a);
  };
  const browseVoice = (text: string) => {
    if (!library) return reply('One moment, I’m still loading the recipes.');
    talk.current = [...talk.current, `Cook: ${text}`].slice(-6);
    const cmd = discoveryCommand(text);
    if (cmd === 'read_all' || (offeredReading.current && confirmation(text) === 'yes')) {
      return listed.current.length ? readOn(optionsReading(listed.current)) : reply(`There’s nothing on the list yet. ${OPENING}`);
    }
    if (cmd === 'more') return reading.current?.kind === 'options' ? readOn(reading.current) : reply(`That’s everything I’ve read out. ${OPENING}`);
    if (cmd === 'repeat') return reply(lastSaid.current || OPENING);
    if (cmd === 'ingredients') return reply('Pick a dish first, and I’ll read you its ingredients.');
    // "I don't have butter" before choosing: remembered for whichever dish they pick.
    // Only "I don't have…" / "I'm out of…" here: "no oven, something with chicken" is a search.
    const without = /^\s*(no|missing)\b/i.test(text) ? null : missingNames(text)?.filter((n) => !/\b(oven|stove|stovetop|hob|microwave|grill|blender|time|meat|dairy|gluten)\b/.test(n));
    if (without?.length) {
      lacking.current = [...new Set([...lacking.current, ...without])];
      return reply(`Got it, no ${without.join(' or ')}. Pick a dish, and if it needs ${without.length > 1 ? 'any of that' : 'it'}, I’ll work around it.`);
    }
    // Sure things don't need the model: a position ("the second one") or a dish by name.
    const at = listed.current.length ? positionIn(text) : null;
    const named = recipeNamed(text, library.recipes.filter((r) => matchesFilters(r, { ...EMPTY_FILTERS, diet: profile.hardExclusions }, profile)));
    if (at !== null || named) return ruleBased(text);
    // "Let's cook" before choosing a dish: ask which.
    if (previewCommand(text) === 'cook') return reply(listed.current.length ? 'Which one? Say its name, or “the first one”.' : `Sure! ${OPENING}`);
    if (modelService.mode === 'llm') return discoverWithModel(text);
    else ruleBased(text);
  };

  /** The model reads what the cook means; the app runs it, checks it and says what it found. */
  const discoverWithModel = async (text: string) => {
    const recipes = library!.recipes;
    const timeout = new Promise<null>((r) => window.setTimeout(() => r(null), 15000));
    const intent = await Promise.race([
      modelService.discover(text, {
        listed: listed.current.slice(0, 12).map((r) => r.title),
        current: describeFilters(filters),
        rules: [...profile.hardExclusions, ...profile.allergies.map((a) => `no ${a}`)],
        recent: talk.current.slice(0, -1),
      }),
      timeout,
    ]);
    if (!intent) return ruleBased(text);
    // "Interpreted as…" when the model read the sentence differently; a reading that changes a
    // negation, number, allergy, diet or time isn't acted on: Gusteau asks.
    const reading = intent.heardAs && changesMeaning(text, intent.heardAs) ? intent.heardAs : null;
    if (reading && riskyReading(text, reading)) return reply(checkFirst(reading));
    setInterpreted(reading ?? '');
    const understood = reading ?? text;
    const short = (s?: string) => (s && s.length <= 280 ? s : null);
    if (!intent.onTopic) return reply(short(intent.reply) ?? `I’m only here for cooking. ${OPENING}`);
    if (intent.action === 'ask' || intent.action === 'answer') {
      const said = short(intent.reply);
      return said ? reply(said) : ruleBased(text);
    }
    if (intent.action === 'choose' && intent.choose) {
      const { position, title } = intent.choose;
      const recipe = (position && listed.current[position - 1]) || (title && (recipeNamed(title, listed.current) ?? recipeNamed(title, recipes))) || null;
      return recipe ? openPreview(recipe, selectionIntro(recipe)) : ruleBased(text);
    }
    if (intent.action === 'search' && intent.search) {
      const a = runSearch(modelSearch(understood, intent.search, profile), recipes, profile, filters);
      // If the model's reading finds nothing specific, Gusteau's own reading gets a try.
      if (a.kind === 'none' || (a.kind === 'list' && a.generic)) {
        const own = browseByVoice(understood, recipes, profile, filters, listed.current);
        if (own.kind !== 'none' && !(own.kind === 'list' && own.generic)) return showByVoice(own);
      }
      return a.kind === 'none' ? reply(a.say) : showByVoice(a);
    }
    ruleBased(text);
  };

  const previewVoice = (text: string, recipe: Recipe) => {
    if (previewRequestsRecipes(text)) return browseVoice(text);
    const go = previewCommand(text);
    // Leaving or cancelling is explicit; a failed transcription never clears the request.
    if (go === 'close' && /\b(?:close|go back|back to|cancel|never ?mind)\b/i.test(text)) {
      setPendingIngredient(null);
      setAsking(null);
      toAsk.current = [];
      if ((asking || pendingIngredient) && /\b(?:cancel|never ?mind)\b/i.test(text)) return reply('Okay, I’ve cancelled the substitution. We’re still on this recipe.');
      setPreview(null);
      return reply(`Sure. ${OPENING}`);
    }
    const swap = previewSubstitution(text, recipe, pendingIngredient);
    if (swap && (swap.ingredient || !asking)) {
      if (!swap.ingredient) {
        setPendingIngredient({ recipeId: recipe.id, to: swap.to });
        return reply(PREVIEW_INGREDIENT_QUESTION);
      }
      setPendingIngredient(null);
      toAsk.current = [];
      if (swap.to) {
        const q = missingQuestion(swap.ingredient, recipe, previewRules(recipe), 'preview', false);
        if (answerAsking(`use ${swap.to}`, recipe, q)) return;
      }
      return askMissing(recipe, swap.ingredient.name);
    }
    if (asking && substitutionClarification(text)) return reply(asking.say);
    // "Yes, I have gouda" to "Do you have another kind of cheese?".
    if (answerAsking(text, recipe)) return;
    // "I don't have cilantro": Gusteau asks what could stand in before the recipe changes.
    const miss = missingIn(text, recipe);
    if (miss) {
      // Matched by sound to the recipe ("flower" → flour): shown as "Interpreted as…", never swapped in silently.
      if (miss.respelled.length) setInterpreted(miss.respelled.reduce((t, [heard, as]) => t.replace(new RegExp(`\\b${heard}\\b`, 'i'), as), text));
      // Not in the recipe, and doesn't sound like anything in it: ask, rather than assume it isn't needed.
      if (!miss.found.length) {
        setPendingIngredient({ recipeId: recipe.id });
        setAsking(null);
        return reply(miss.elsewhere.length ? `I couldn’t find “${miss.elsewhere.join('” or “')}” in this recipe. Which ingredient do you mean?` : 'Which ingredient are you missing?');
      }
      const names = miss.found.map((i) => i.name);
      toAsk.current = names.slice(1);
      return askMissing(recipe, names[0]);
    }
    const cmd = discoveryCommand(text);
    if (cmd === 'ingredients' || cmd === 'read_all') {
      const servings = preview?.kitchen.rules?.servings ?? recipe.servings;
      return readOn(ingredientsReading(scaleRecipe(recipe, servings).ingredients));
    }
    if (cmd === 'more') return reading.current?.kind === 'ingredients' ? readOn(reading.current) : reply('Say “what do I need?” and I’ll read you the ingredients.');
    if (cmd === 'repeat') return reply(lastSaid.current || selectionIntro(recipe));
    if (asking) return reply(asking.say);
    if (go === 'cook') return setCookSignal((n) => n + 1);
    if (go === 'close') {
      setPreview(null);
      return reply(`Sure. ${OPENING}`);
    }
    reply(`Say “let’s cook” to start ${recipe.title}, or tell me if you’re missing anything.`);
  };
  // The dishes on screen follow the filters, however they were set (by voice or by tapping).
  useEffect(() => {
    if (!library) return;
    const generic = !filters.cuisine && !filters.search && activeFilterCount(filters) === filters.diet.length;
    listed.current = generic ? picksFor(library.recipes, profile) : shownRecipes(library.recipes, profile, filters);
  }, [filters, library, profile]);

  // What the cook says during a conversation. There's no wake word: the mic is only open in a
  // conversation started with Talk to Gusteau, and only what's said while he's listening counts.
  const onPhrase = (text: string) => {
    if (screen === 'onboarding') return;
    const cooking = screen === 'cooking' && !!cook.session;
    const listening = turnRef.current === 'open' || turnRef.current === 'hearing';
    logHeard({ who: 'cook', text, note: listening ? 'heard in the conversation' : 'ignored: said while he was answering' });
    if (!listening) return;
    // "Hey Chef, what's next?": addressing him by name is fine, the name is just dropped.
    const asked = (afterWakeWord(text) ?? text).trim();
    if (!asked) return;
    const command = asCommand(asked);
    if (GO_TO_SLEEP.test(command) || TURN_OFF.test(command)) {
      stopConversation();
      return voice.say('Okay. Tap “Talk to Gusteau” when you need me.');
    }
    if (MUTE.test(command)) {
      voice.setMicMuted(true);
      return voice.say('Muted. Tap Unmute when you want me to listen again.');
    }
    answered.current = false;
    invited.current = false;
    setTurn('answering');
    if (cooking) return askByVoice(asked);
    setHeard(asked);
    setInterpreted('');
    if (preview) previewVoice(asked, preview.recipe);
    else browseVoice(asked);
  };
  const voice = useVoice(onPhrase);
  // Typing uses the same recipe actions without opening the mic or waiting for a voice turn.
  const sendTyped = async (text: string) => {
    voice.stopTalking();
    setInterpreted('');
    if (screen === 'cooking' && cook.session) {
      await cook.sendChat(text);
      return;
    }
    logHeard({ who: 'cook', text, note: 'typed message' });
    if (preview) previewVoice(text, preview.recipe);
    else await browseVoice(text);
  };
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // The mic closed (voice failed, or a conversation ended): the conversation is over.
  useEffect(() => {
    if (!voice.handsFree && !opening.current) setTurn('waiting');
  }, [voice.handsFree]);
  // A conversation that's over closes the mic: nothing is heard or transcribed until Talk to Gusteau.
  useEffect(() => {
    if (turn === 'waiting' && voice.handsFree && !opening.current) void voice.setHandsFree(false);
  }, [turn, voice.handsFree]);
  // Time to start talking, counted once the mic is listening and he's quiet (his mic is closed while he
  // speaks), and not while muted. Nobody answers: the conversation ends.
  useEffect(() => {
    if (turn !== 'open' || voice.talking || voice.micMuted || voice.state !== 'listening') return;
    const t = window.setTimeout(() => turnRef.current === 'open' && setTurn('waiting'), windowMs.current);
    return () => window.clearTimeout(t);
  }, [turn, voice.talking, voice.micMuted, voice.state]);
  // The cook started talking: no time limit now, the request ends when they pause.
  useEffect(() => {
    if (turnRef.current === 'open' && voice.interim.trim()) setTurn('hearing');
  }, [voice.interim]);
  // Words that stop coming without a finished request (a cough, a dropped connection): back to waiting.
  useEffect(() => {
    if (turn !== 'hearing') return;
    const t = window.setTimeout(() => turnRef.current === 'hearing' && setTurn('waiting'), 8000);
    return () => window.clearTimeout(t);
  }, [turn, voice.interim]);
  // His answer: once he's said it and gone quiet, he listens five seconds for more, or ten if he
  // asked something or waits on an answer; then back to waiting for his name. An answer that
  // never comes doesn't keep him listening.
  useEffect(() => {
    if (voice.talking) answered.current = true;
    if (turn !== 'answering' || voice.talking || cook.busy) return;
    const t = window.setTimeout(
      () => {
        if (turnRef.current !== 'answering') return;
        const last = screen === 'cooking' ? [...(cook.session?.chat ?? [])].reverse().find((m) => m.from === 'gusteau')?.text : lastSaid.current;
        // A question at the end, or anything still waiting on the cook's answer ("Do you have another
        // kind of cheese? Otherwise, …", a swap to confirm, "skip this step?"), waits for the reply.
        const s = cook.session;
        const open = invited.current || (screen === 'cooking' ? !!(s?.pendingChoice || s?.pendingOffer?.length || s?.pendingConfirm) : !!(asking || pendingIngredient));
        if (!answered.current || !voiceRef.current?.handsFree) setTurn('waiting');
        else openWindow(open || expectsReply(last ?? '') ? REPLY_WINDOW_MS : LISTEN_WINDOW_MS);
      },
      answered.current ? 700 : 20000,
    );
    return () => window.clearTimeout(t);
  }, [turn, voice.talking, cook.busy]);
  useEffect(() => {
    if (cook.busy || !waiting.current) return;
    const text = waiting.current;
    waiting.current = null;
    askByVoice(text);
  });

  const s = cook.session;
  // Gusteau says his replies in hands-free mode, or when he was asked out loud.
  // This runs before the step reader below, so a replan message comes first and
  // the step it lands on is read after it.
  const lastSpoken = useRef<string | null>(null);
  useEffect(() => {
    const chat = s?.chat ?? [];
    const last = chat[chat.length - 1];
    if (!last || last.from !== 'gusteau' || last.id === lastSpoken.current) return;
    lastSpoken.current = last.id;
    if (!last.spoken) voice.say(speakable(last.text));
  }, [s?.chat]);
  // Read the current step aloud on request, or automatically in hands-free mode.
  const lastRead = useRef(0);
  useEffect(() => {
    const req = cook.readRequest;
    if (!s || req.n === lastRead.current) return;
    lastRead.current = req.n;
    // Said like a chef, not read off the screen: see agent/stepSpeech.ts.
    voice.say(cook.stepLine(req.how), !req.force);
  }, [cook.readRequest]);

  // Esc silences Gusteau.
  useEffect(() => {
    if (!voice.talking) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && voice.stopTalking();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice.talking]);

  /**
   * He greets the cook for where they are, then listens: "Hey! What are you in
   * the mood for?" is a question, so ten seconds to answer, counted once he's said it.
   */
  const greet = () => {
    // Only what's said to him from now on counts, not the end of a sentence someone in the kitchen was saying.
    voice.discardPending();
    // His greeting is his turn: "Listening" only once he's said it, then ten seconds to answer.
    answered.current = false;
    invited.current = true;
    setTurn('answering');
    if (screen === 'cooking' && cook.session) return voice.say(`Yes? I’m listening. How can I help with your ${cook.session.recipe.title}?`);
    if (preview && pendingIngredient?.recipeId === preview.recipe.id) return reply(PREVIEW_INGREDIENT_QUESTION);
    if (preview && asking) return reply(asking.say);
    if (preview) return reply(`Yes? Say “let’s cook” when you’re ready, or tell me if you’re missing anything.`);
    return reply(`Hey! ${OPENING}`);
  };

  /**
   * The Talk to Gusteau button: voice on if it isn't, then he greets the cook
   * and listens. (The tap is also what lets the browser start the mic and his voice.)
   */
  const startTalking = () => {
    setInviteToTalk(false);
    unlockAudio();
    voice.enableSpeech();
    if (!voice.handsFree) return void startListening();
    // Still not listening a few seconds after a tap (stuck starting): start voice over, from this tap.
    if (voice.state === 'connecting') {
      window.setTimeout(() => {
        if (voiceRef.current?.state !== 'connecting') return;
        void voiceRef.current.setHandsFree(false).then(() => setHandsFree(true));
      }, 3000);
    }
    if (voice.talking) voice.stopTalking();
    if (voice.micMuted) voice.setMicMuted(false);
    greet();
  };
  /** The Stop button: he stops talking, the conversation ends and the mic closes. */
  const stopConversation = () => {
    voice.disableSpeech();
    setTurn('waiting');
  };

  /** The mic on for a conversation (he greets the cook and listens), or off. */
  const setHandsFree = async (on: boolean) => {
    await voice.setHandsFree(on);
    if (!on) return;
    // Load the model now so the first question doesn't wait for it.
    void modelService.warmUp().catch(() => {});
    greet();
  };

  /** Starting a conversation: the mic is opening, so the conversation isn't over yet. */
  const opening = useRef(false);
  /** Talk to Gusteau: the mic opens, and Gusteau starts the conversation himself. */
  const startListening = async () => {
    unlockAudio();
    opening.current = true;
    try {
      await setHandsFree(true);
    } finally {
      opening.current = false;
    }
  };

  // Prototype only: forget everything about this user and show the welcome screen again.
  const startOverAsNewUser = () => {
    if (!window.confirm('Reset Gusteau as a new user? This clears your preferences, kitchen and cooking history on this device.')) return;
    // Any conversation ends (and the mic closes).
    setTurn('waiting');
    voice.disableSpeech();
    cook.stop();
    reset();
    setPreview(null);
    setEditingPrefs(false);
    setFilters({ ...EMPTY_FILTERS });
    setScreen('onboarding');
    window.scrollTo({ top: 0 });
  };

  // Hands-free stays on when leaving the kitchen: Gusteau goes back to helping choose.
  const leaveCooking = () => {
    // After a finished dish, browsing starts fresh, with the favorites first.
    const done = cook.session && cook.session.stepIndex >= cook.session.recipe.steps.length;
    if (done) setFilters({ ...EMPTY_FILTERS, diet: profile.hardExclusions });
    voice.stopTalking();
    cook.stop();
    setScreen('browse');
    setSaid('');
    setHeard('');
    window.scrollTo({ top: 0 });
  };

  const startCooking = async (recipe: Recipe, rules: Parameters<typeof cook.start>[1], leaveOut: string[]) => {
    // No inventory: Gusteau only knows what the cook said they don't have.
    const swaps = decided.filter((d) => d.to).map((d) => ({ from: d.name, to: d.to! }));
    await cook.start(recipe, rules, [], true, leaveOut, decided.map((d) => d.name), swaps);
    setPreview(null);
    setScreen('cooking');
    window.scrollTo({ top: 0 });
    // After his welcome, straight into the first step, without touching the screen.
    cook.readStep();
  };

  const loadDemo = () => {
    const recipe = library?.recipes.find((r) => r.id === DEMO_RECIPE_ID);
    if (!recipe) return setToast('The demo recipe isn’t in this recipe file.');
    setFilters({ ...EMPTY_FILTERS, cuisine: 'mexican' });
    setPreview({ recipe, kitchen: { rules: DEMO_RULES, label: 'Demo' } });
    setDecided([]);
    setAsking(null);
  };


  return (
    <div className="min-h-screen bg-cream-100 bg-[radial-gradient(ellipse_at_top_right,rgba(242,140,56,0.12),transparent_55%),radial-gradient(ellipse_at_bottom_left,rgba(107,122,58,0.08),transparent_50%)]">
      <header className="sticky top-0 z-30 h-[61px] border-b border-cream-200/80 bg-cream-100/90 backdrop-blur">
        <div className="mx-auto flex h-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          {/* <button onClick={() => (screen === 'cooking' ? leaveCooking() : profile.onboarded && setScreen('browse'))} className="flex items-center gap-2.5" aria-label="Gusteau home">
            <GusteauIcon />
            <span className="text-left leading-none">
              <span className="hidden font-display text-xl font-semibold text-charcoal-900 sm:block">Gusteau</span>
              <span className="hidden text-[11px] text-charcoal-400 sm:block">Your personal chef assistant</span>
            </span>
          </button> */}


          {

            screen == 'cooking' ? <button onClick={() => (screen === 'cooking' ? leaveCooking() : profile.onboarded && setScreen('browse'))} className="flex items-center gap-2.5" aria-label="Gusteau home">
              <span className="text-left leading-none">
                <span className="block text-md font-normal text-charcoal-900">← All Dishes</span>
              </span>
            </button> : ''
          }


          <div className="ml-auto flex items-center gap-2">
            {!hideDevTools && <ModelPicker />}
            {!hideDevTools && (
              <button
                onClick={() => setDebug((d) => !d)}
                aria-pressed={debug}
                aria-label="Debug"
                title="Show what Gusteau heard, what was sent to the model, and what it answered"
                className={cx('rounded-full px-3 py-1.5 text-xs font-semibold', debug ? 'bg-charcoal-900 text-white' : 'text-charcoal-500 hover:bg-cream-200 hover:text-charcoal-900')}
              >
                🐞 <span className="hidden sm:inline">Debug</span>
              </button>
            )}
            {profile.onboarded && screen !== 'cooking' && (
              <button onClick={() => setEditingPrefs(true)} className="rounded-full px-3 py-2 text-sm font-medium text-charcoal-500 hover:bg-cream-200 hover:text-charcoal-900">
                ⚙︎ <span className="hidden sm:inline">Preferences</span>
              </button>
            )}
            {screen !== 'browse' && (
              <button
                onClick={startOverAsNewUser}
                title="Prototype only: clears preferences, kitchen and history, then shows the new-user screen"
                className="rounded-full border border-dashed border-charcoal-400/50 px-3 py-1.5 text-xs font-medium text-charcoal-500 hover:border-tomato-400 hover:text-tomato-600"
              >
                ↺ <span className="hidden sm:inline">Reset as new user</span>
                <span className="ml-1 hidden rounded-full bg-cream-200 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-charcoal-400 lg:inline">Prototype</span>
              </button>
            )}
            {screen !== 'onboarding' && screen !== 'browse' && voice.state === 'blocked' && <span className="text-xs text-tomato-600">Mic blocked in browser settings</span>}
            <button
              type="button"
              role="switch"
              aria-checked={hideDevTools}
              aria-label="End-user preview"
              title={hideDevTools ? 'Show Debug and model controls' : 'Hide Debug and model controls'}
              onClick={() => setHideDevTools((hidden) => !hidden)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-charcoal-400 transition-colors hover:bg-cream-200 hover:text-charcoal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-tomato-400"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
                {hideDevTools && <path d="m3 3 18 18" />}
              </svg>
            </button>
          </div>
        </div>
      </header>
      {!hideDevTools && debug && <DebugPanel />}

      <main className="px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
        {/* Talking with Gusteau: one place, top left, on every screen (in the recipe preview, at the top of it). */}
        {screen !== 'onboarding' && !preview && (
          <div className="mx-auto mb-6 max-w-7xl">
            <VoicePanel voice={voice} turn={turn} interpreted={interpreted} onTalk={startTalking} onStop={stopConversation} inviteToTalk={screen === 'browse' && inviteToTalk} className="w-full" />
          </div>
        )}
        {screen === 'onboarding' && (
          <Onboarding
            profile={profile}
            onDone={(patch) => {
              update(patch);
              setFilters({ ...EMPTY_FILTERS, diet: patch.hardExclusions ?? [] });
              setScreen('browse');
              // To the top, where Gusteau is, not wherever the welcome screen was scrolled to.
              window.scrollTo({ top: 0 });
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
                // A tap chooses too; in hands-free Gusteau introduces the dish.
                onOpen={(recipe) => {
                  // Chosen by tap: his introduction is a turn too, so he listens for the reply after it.
                  if (voice.handsFree && !voice.micMuted) {
                    answered.current = false;
                    setTurn('answering');
                  }
                  openPreview(recipe, selectionIntro(recipe));
                }}
                onDemo={loadDemo}
                onToast={setToast}
                onFavorite={setFavorite}
              />
            ) : (
              <p className="mx-auto max-w-md text-center text-charcoal-500">No recipes found. Put a recipes.json or recipes.csv export in public/recipes/ (see docs/RECIPE_FORMAT.md).</p>
            )
          ) : (
            <p className="flex items-center justify-center gap-2 text-charcoal-500">
              <Spinner className="text-tomato-500" /> Loading recipes…
            </p>
          ))}

        {screen === 'cooking' && cook.session && (
          <CookingWorkspace cook={cook} onExit={leaveCooking} favorite={favorites.includes(cook.session.original.id)} onFavorite={(on) => setFavorite(cook.session!.original.id, on)} />
        )}
      </main>

      <Modal open={!!preview} onClose={() => setPreview(null)} label={preview?.recipe.title ?? 'Recipe'} wide chatHostRef={setChatHost}>
        {preview && (
          <>
            {/* Extra top padding leaves a clear strip where the Back and Close buttons sit above the voice panel. */}
            <div className="px-4 pt-14 sm:px-6 sm:pt-16">
              <VoicePanel voice={voice} turn={turn} interpreted={interpreted} onTalk={startTalking} onStop={stopConversation} compact />
            </div>
          <RecipePreview
            key={preview.recipe.id}
            recipe={preview.recipe}
            stages={staged?.id === preview.recipe.id ? staged.stages : undefined}
            profile={profile}
            kitchen={preview.kitchen}
            busy={cook.busy === 'starting'}
            onClose={() => setPreview(null)}
            onCook={(rules, leaveOut) => void startCooking(preview.recipe, rules, leaveOut)}
            cookSignal={cookSignal}
            onCantCook={(why) => reply(`Not yet: ${why} Tell me what to change, or pick something else.`)}
            unavailable={decided.map((d) => d.name)}
            swaps={decided.filter((d) => d.to).map((d) => ({ from: d.name, to: d.to! }))}
            asking={asking}
            onAnswer={(text) => answerAsking(text, preview.recipe) || reply(`Tell me what you’d like to use instead of the ${asking?.current.toLowerCase() ?? 'ingredient'}.`)}
            // Said out loud in hands-free; on screen the ingredient list shows the change either way. Then the next missing one.
            onAdjusted={(say) => {
              reply(say, true);
              const next = toAsk.current.shift();
              if (next) askMissing(preview.recipe, next, true);
            }}
            onMissing={(name) => {
              // Tapped again: undo.
              if (decided.some((d) => d.name === name)) return setDecided((d) => d.filter((x) => x.name !== name));
              if (asking?.current === name) return setAsking(null);
              toAsk.current = [];
              askMissing(preview.recipe, name);
            }}
          />
          </>
        )}
      </Modal>

      <Modal open={editingPrefs} onClose={() => setEditingPrefs(false)} label="Preferences" wide chatHostRef={setChatHost}>
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
        <div role="status" className="fixed inset-x-4 bottom-28 z-50 mx-auto max-w-md animate-pop rounded-2xl bg-charcoal-900 px-4 py-3 text-center text-sm text-white shadow-card">
          {toast}
        </div>
      )}

      <TextChat host={chatHost} onSend={sendTyped} cook={screen === 'cooking' ? cook : null} busy={!!cook.busy} context={preview?.recipe.title ?? (screen === 'cooking' ? cook.session?.recipe.title : undefined)} />

      <footer className="border-t border-cream-200 px-4 pb-28 pt-6 text-center text-xs text-charcoal-400">
        Gusteau is a cooking assistant, not a food-safety or allergy authority. It can’t verify freshness or allergens. Always check labels and use your judgment.
      </footer>
    </div>
  );
}
