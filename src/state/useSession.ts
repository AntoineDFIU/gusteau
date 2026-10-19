import { useCallback, useRef, useState } from 'react';
import { applyChanges, finalizeReplan, uid } from '../agent/replan';
import { modelService } from '../services';
import type { InterpretResult, PhotoInput } from '../services/modelService';
import { DEFAULT_CONSTRAINTS, DEMO_CONSTRAINTS, DEMO_INVENTORY } from '../services/mock/mockData';
import type { Constraints, InventoryItem, SessionChange, SessionState } from '../types';

export type Screen = 'upload' | 'analyzing' | 'review' | 'constraints' | 'planning' | 'recipe' | 'cooking';

const emptyState = (): SessionState => ({
  inventory: [],
  removed: [],
  constraints: { ...DEFAULT_CONSTRAINTS },
  recipe: null,
  blocked: [],
  currentStepIndex: 0,
  completedStepKeys: [],
  substitutions: [],
  history: [],
  chat: [],
});

/**
 * The cooking session store. Everything the agent knows lives in
 * `state`; the UI is a view over it. Every change goes through
 * `update()` → applyChanges → planRecipe → finalizeReplan.
 */
export function useSession() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [state, setStateRaw] = useState<SessionState>(emptyState);
  const [photos, setPhotos] = useState<PhotoInput[]>([]);
  const [undoStack, setUndoStack] = useState<SessionState[]>([]);
  const [busy, setBusy] = useState<null | 'thinking' | 'replanning'>(null);
  const [bannerId, setBannerId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const ref = useRef(state);
  const setState = useCallback((s: SessionState) => {
    ref.current = s;
    setStateRaw(s);
  }, []);

  const go = (s: Screen) => {
    setScreen(s);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const analyze = async (input: PhotoInput[]) => {
    setPhotos(input);
    setNotice(null);
    go('analyzing');
    try {
      const detections = await modelService.analyzePhotos(input);
      setState({
        ...ref.current,
        inventory: detections.map((d) => ({ id: uid(), name: d.name, key: d.key, quantityNote: d.quantityNote, source: 'photo', confidence: d.confidence })),
        removed: [],
      });
      if (!detections.length) setNotice('I couldn’t spot any food in that photo. Add what you have below, or try a brighter shot.');
    } catch (err) {
      console.warn('[Gusteau] Photo analysis failed', err);
      setState({ ...ref.current, inventory: [], removed: [] });
      setNotice('I couldn’t read that photo just now. Add your ingredients below and we’ll keep going.');
    }
    go('review');
  };

  const startManual = () => {
    setPhotos([]);
    setNotice(null);
    setState({ ...ref.current, inventory: [], removed: [] });
    go('review');
  };

  const plan = async (s: SessionState) => {
    go('planning');
    let result: Awaited<ReturnType<typeof modelService.planRecipe>>;
    try {
      result = await modelService.planRecipe(s, null);
    } catch (err) {
      console.warn('[Gusteau] Planning failed', err);
      result = { recipe: null, blocked: [] };
    }
    const next: SessionState = {
      ...s,
      recipe: result.recipe,
      blocked: result.blocked,
      currentStepIndex: 0,
      completedStepKeys: [],
      substitutions: [],
      history: [],
      chat: [],
    };
    setState(next);
    setUndoStack([]);
    setBannerId(null);
    go('recipe');
  };

  const loadDemo = () => {
    const s: SessionState = {
      ...emptyState(),
      inventory: DEMO_INVENTORY.map((i) => ({ ...i, id: uid() })),
      constraints: { ...DEMO_CONSTRAINTS },
    };
    setPhotos([]);
    setState(s);
    void plan(s);
  };

  const confirmInventory = (inventory: InventoryItem[], removed: SessionState['removed']) => {
    setState({ ...ref.current, inventory, removed });
    go('constraints');
  };

  const confirmConstraints = (constraints: Constraints) => {
    const s = { ...ref.current, constraints };
    setState(s);
    void plan(s);
  };

  const startCooking = () => {
    const s = ref.current;
    if (!s.recipe) return;
    setState({
      ...s,
      chat: [
        {
          id: uid(),
          from: 'gusteau',
          text: `Bonjour! Let's make the ${s.recipe.title}. I'm keeping track of your kitchen as we go, so if anything changes, like an ingredient you're out of, the time, the equipment, or who's eating, tell me and I'll rework the rest of the plan.`,
        },
      ],
    });
    go('cooking');
  };

  const update = async (changes: SessionChange[], trigger: string, userText?: string) => {
    if (!changes.length) return;
    const before = ref.current;
    const withUser: SessionState = userText ? { ...before, chat: [...before.chat, { id: uid(), from: 'user', text: userText }] } : before;
    setBusy('replanning');
    try {
      const { state: after, labels } = applyChanges(withUser, changes);
      setState(after);
      const result = await modelService.planRecipe(after, before.recipe);
      const final = finalizeReplan(withUser, after, result, trigger, labels, changes);
      setUndoStack((u) => [before, ...u].slice(0, 20));
      setState(final);
      setBannerId(final.history[0]?.id ?? null);
    } catch (err) {
      console.warn('[Gusteau] Replanning failed', err);
      setState({
        ...withUser,
        chat: [...withUser.chat, { id: uid(), from: 'gusteau', text: 'I hit a snag replanning, so I kept your current plan exactly as it was. Try that again in a moment.' }],
      });
    } finally {
      setBusy(null);
    }
  };

  const sendChat = async (text: string) => {
    const before = ref.current;
    setBusy('thinking');
    let interpreted: InterpretResult;
    try {
      interpreted = await modelService.interpretMessage(text, before);
    } catch (err) {
      console.warn('[Gusteau] Chat failed', err);
      interpreted = { reply: 'Sorry, I lost that one. Could you say it again?', changes: [] };
    }
    if (interpreted.changes.length) {
      setBusy(null);
      await update(interpreted.changes, interpreted.trigger ?? text, text);
    } else {
      setState({
        ...before,
        chat: [
          ...before.chat,
          { id: uid(), from: 'user', text },
          { id: uid(), from: 'gusteau', text: interpreted.reply ?? "I'm here. Tell me what changed and I'll replan." },
        ],
      });
      setBusy(null);
    }
  };

  const undo = () => {
    const [prev, ...rest] = undoStack;
    if (!prev) return;
    setState({ ...prev, chat: [...ref.current.chat, { id: uid(), from: 'gusteau', text: 'Undone. Back to the previous plan, with all your earlier progress intact.' }] });
    setUndoStack(rest);
    setBannerId(null);
  };

  const next = () => {
    const s = ref.current;
    if (!s.recipe) return;
    const step = s.recipe.steps[s.currentStepIndex];
    const completed = s.completedStepKeys.includes(step.key) ? s.completedStepKeys : [...s.completedStepKeys, step.key];
    setState({ ...s, completedStepKeys: completed, currentStepIndex: Math.min(s.currentStepIndex + 1, s.recipe.steps.length) });
  };

  const back = () => {
    const s = ref.current;
    if (!s.recipe || s.currentStepIndex === 0) return;
    const idx = s.currentStepIndex - 1;
    const key = s.recipe.steps[idx].key;
    setState({ ...s, currentStepIndex: idx, completedStepKeys: s.completedStepKeys.filter((k) => k !== key) });
  };

  const restart = () => {
    setState(emptyState());
    setNotice(null);
    setPhotos([]);
    setUndoStack([]);
    setBannerId(null);
    go('upload');
  };

  return {
    screen,
    go,
    state,
    photos,
    busy,
    bannerId,
    notice,
    dismissBanner: () => setBannerId(null),
    canUndo: undoStack.length > 0,
    analyze,
    startManual,
    loadDemo,
    confirmInventory,
    confirmConstraints,
    startCooking,
    update,
    sendChat,
    undo,
    next,
    back,
    restart,
  };
}

export type Session = ReturnType<typeof useSession>;
