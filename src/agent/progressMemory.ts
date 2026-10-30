import type { CookSession, StepMemory } from '../types';

/** Capture the plan as it stood when the user confirmed the step. */
export function rememberStep(s: CookSession, outcome: StepMemory['outcome']): StepMemory[] {
  const step = s.recipe.steps[s.stepIndex];
  if (!step) return s.stepMemory ?? [];
  return [...(s.stepMemory ?? []), {
    number: s.stepIndex + 1,
    step: { ...step, uses: [...step.uses] },
    ingredients: s.recipe.ingredients.filter((i) => step.uses.includes(i.id)).map((i) => ({ ...i })),
    outcome,
  }];
}

/** Remembering previous work is a question, not an instruction to move or replan. */
export function isRecallQuestion(text: string): boolean {
  const t = text.toLowerCase().replace(/[‘’]/g, "'").trim();
  const question = /^(?:what|which|when|where|how|did|have|had|was|were|remind me|(?:can|could) you remind|do you remember)\b/.test(t);
  return question && /\b(?:earlier|previous|previously|already|so far|before|last step|did (?:i|we)|have (?:i|we)|had (?:i|we)|was|were|step (?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)|(?:first|second|third|fourth|fifth) step)\b/.test(t);
}

/** Full details remain available even when the live plan or recent conversation changes. */
export function progressMemoryContext(s: CookSession) {
  return {
    confirmedSteps: s.stepMemory ?? [],
    // These keys may include steps bypassed by navigation; they aren't proof of completion.
    navigationCompletedKeys: s.completedStepKeys,
    conversation: s.chat.map((m) => ({ from: m.from, text: m.text })),
  };
}

/** Grounded fallback when no LLM is available. Never invent observed times or actions. */
export function recallAnswer(text: string, s: CookSession): string {
  const memory = s.stepMemory ?? [];
  if (!memory.length) return 'You haven’t confirmed completing any steps yet. I can remind you of the instructions, but I can’t say you’ve done them.';
  const t = text.toLowerCase();
  if (/\b(?:so far|everything|all (?:the )?(?:steps|work))\b|^what (?:have|did) (?:i|we) (?:done|do|complete|accomplish)[?!.]*$/.test(t)) {
    return `Here’s your confirmed progress: ${memory.map((m) => `step ${m.number}, ${m.step.title.toLowerCase()} (${m.outcome})`).join('; ')}.`;
  }
  const numbers: Record<string, number> = { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const match = t.match(/\bstep (\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b(first|second|third|fourth|fifth) step\b/);
  const number = match ? numbers[match[1] ?? match[2]] ?? Number(match[1]) : null;
  const words = t.split(/[^a-z]+/).filter((w) => w.length > 3 && !/^(what|which|when|where|have|already|earlier|previous|before|step|steps|remember|remind|long|much|used|done)$/.test(w));
  const found = [...memory].reverse().find((m) => number ? m.number === number : /\b(?:last|previous) step\b/.test(t) || words.some((w) => `${m.step.title} ${m.step.text} ${m.ingredients.map((i) => i.name).join(' ')}`.toLowerCase().includes(w)));
  if (!found) return 'I don’t have a confirmed completed step about that. I can tell you what the recipe calls for, but I won’t assume you’ve done it.';
  if (found.outcome === 'skipped') return `You chose to skip step ${found.number}, “${found.step.title}”, so I haven’t recorded it as completed.`;
  const ingredients = found.ingredients.map((i) => `${i.amount === null ? '' : `${i.amount} ${i.unit} `}${i.name}`.trim()).join(', ');
  return `You confirmed completing step ${found.number}, “${found.step.title}”. The instructions were: ${found.step.text}${ingredients ? ` Ingredients listed for that step: ${ingredients}.` : ''}`;
}
