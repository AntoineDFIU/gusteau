import { CATALOG, matchIngredient } from '../../data/ingredients';
import { shortName } from '../../agent/planner';
import type { DietRuleId, Equipment, SessionChange, SessionState } from '../../types';
import type { InterpretResult } from '../modelService';

// ─────────────────────────────────────────────────────────────
// MOCK conversational agent: a rule-based intent parser.
// In Nebius mode a Nemotron model produces the same
// { reply, changes } structure (see nebiusModelService.ts).
// ─────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const num = (s: string) => (NUMBER_WORDS[s] ?? parseInt(s, 10));

const DIET_PATTERNS: [RegExp, DietRuleId][] = [
  [/\bvegan\b/, 'vegan'],
  [/\bvegetarian|veggie only|no meat|meat-?free\b/, 'vegetarian'],
  [/\b(dairy[- ]?free|no dairy|lactose)\b/, 'dairy-free'],
  [/\b(gluten[- ]?free|no gluten|celiac|coeliac)\b/, 'gluten-free'],
  [/\b(egg[- ]?free|no eggs?)\b/, 'egg-free'],
  [/\b(nut[- ]?free|no nuts)\b/, 'nut-free'],
];

export function parseIntent(raw: string, state: SessionState): InterpretResult {
  const m = raw.toLowerCase().trim();
  const changes: SessionChange[] = [];
  const triggers: string[] = [];
  const c = state.constraints;

  // ── Purchases & budget (check before generic "no X") ──
  if (/\b(no (extra )?(purchases|shopping|buying)|can'?t (buy|shop|go to the store)|don'?t want to (buy|shop)|nothing new to buy|no store)\b/.test(m)) {
    changes.push({ type: 'set_purchases', allowed: false });
    triggers.push('No extra purchases');
  } else if (/\b(can (buy|shop|grab|pick up)|happy to (buy|shop)|purchases? (are )?(ok|fine|allowed))\b/.test(m)) {
    changes.push({ type: 'set_purchases', allowed: true });
    triggers.push('Purchases allowed');
  }
  const budget = m.match(/\$\s?(\d+(?:\.\d+)?)/);
  if (budget) {
    changes.push({ type: 'set_budget', amount: parseFloat(budget[1]) });
    triggers.push(`Budget $${budget[1]}`);
  }

  // ── Equipment ──
  if (/\bonly (have )?(a |the )?microwave|microwave only|just (a |the )?microwave\b/.test(m)) {
    changes.push({ type: 'set_equipment', equipment: ['microwave'] });
    triggers.push('Microwave only');
  } else {
    let eq: Equipment[] = [...c.equipment];
    if (/\bno (stove|stovetop|hob|burner)|stove (is )?(broken|busy)/.test(m)) eq = eq.filter((e) => e !== 'stovetop');
    if (/\bno oven|oven (is )?(broken|busy)/.test(m)) eq = eq.filter((e) => e !== 'oven');
    if (/\bno microwave/.test(m)) eq = eq.filter((e) => e !== 'microwave');
    if (/\b(have|got|use) (an |the )?oven\b/.test(m) && !eq.includes('oven')) eq.push('oven');
    if (/\b(have|got|use) (a |the )?(stove|stovetop)\b/.test(m) && !eq.includes('stovetop')) eq.push('stovetop');
    if (eq.join() !== c.equipment.join() && eq.length) {
      changes.push({ type: 'set_equipment', equipment: eq });
      triggers.push('Equipment changed');
    }
  }

  // ── Diet rules & allergies ──
  for (const [re, rule] of DIET_PATTERNS) {
    if (re.test(m) && !c.hardExclusions.includes(rule)) {
      changes.push({ type: 'add_exclusion', rule });
      triggers.push(`Make it ${rule.replace('-', ' ')}`);
      break;
    }
  }
  const allergy = m.match(/allergic to ([a-z ]+?)(?:[.,!]|$| and )/);
  if (allergy) {
    changes.push({ type: 'add_exclusion', custom: allergy[1].trim() });
    triggers.push(`Allergy: ${allergy[1].trim()}`);
  }

  // ── Time ──
  const mins = m.match(/(\d+)\s*(?:min|mins|minutes)\b/);
  if (mins) {
    changes.push({ type: 'set_time', minutes: parseInt(mins[1], 10) });
    triggers.push(`Only ${mins[1]} minutes`);
  } else if (/half an hour/.test(m)) {
    changes.push({ type: 'set_time', minutes: 30 });
    triggers.push('Only 30 minutes');
  }

  // ── Servings ──
  const people = m.match(/\b(?:for|feed|feeding|serves?|serving)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b/) ?? m.match(/\b(\d+|two|three|four|five|six|seven|eight)\s+(?:people|of us|servings|guests|friends)\b/);
  if (people && !mins) {
    const n = num(people[1]);
    if (n && n !== c.servings) {
      changes.push({ type: 'set_servings', servings: n });
      triggers.push(`Cooking for ${n}`);
    }
  } else if (/\bmore people|friends (are )?coming|extra (people|guests)|roommates?\b/.test(m)) {
    changes.push({ type: 'set_servings', servings: c.servings + 2 });
    triggers.push(`Cooking for ${c.servings + 2}`);
  }

  // ── Removed ingredients ──
  const removalRe =
    /(?:don'?t|do not|didn'?t) (?:actually )?have (?:any )?([a-z ]+)|(?:out of|ran out of|run out of|used up|no more|i'?m out of|we'?re out of|without) (?:any |the |my )?([a-z ]+)|(?:the |my )?([a-z ]+?) (?:is|are|went|has gone|have gone) (?:gone|bad|off|spoiled|moldy|mouldy|expired|finished)|\bno ([a-z]+(?: [a-z]+)?)\b/g;
  let rm: RegExpExecArray | null;
  const alreadyHandled = changes.length > 0;
  while ((rm = removalRe.exec(m))) {
    const phrase = (rm[1] ?? rm[2] ?? rm[3] ?? rm[4] ?? '').replace(/\b(actually|anymore|left|either|after all)\b/g, '').trim();
    if (!phrase) continue;
    const key = matchIngredient(phrase);
    // "no X" is only an ingredient removal if X is a real ingredient.
    if (!key && rm[4]) continue;
    if (!key && alreadyHandled) continue;
    const name = key ? CATALOG[key].name : phrase;
    if (changes.some((ch) => ch.type === 'remove_ingredient' && ch.name === name)) continue;
    changes.push({ type: 'remove_ingredient', name });
    triggers.push(`You're out of ${key ? shortName(key) : phrase}`);
  }

  // ── Added ingredients ──
  const add = m.match(/\b(?:i (?:also |actually )?(?:have|found|got)|add|there'?s (?:some |also )?)\s+(?:some |a |an |the )?([a-z ]+?)(?:[.,!]|$| too| as well| in )/);
  if (add && !/don'?t have|do not have/.test(m)) {
    const phrase = add[1].trim();
    const key = matchIngredient(phrase);
    if ((key || phrase.split(' ').length <= 3) && !['time', 'minutes', 'a microwave', 'microwave', 'an oven', 'oven', 'stove'].includes(phrase)) {
      changes.push({ type: 'add_ingredient', name: key ? CATALOG[key].name : phrase });
      triggers.push(`You found ${key ? shortName(key) : phrase}`);
    }
  }

  // ── Preferences ──
  if (/\bspic(y|ier)|more heat|kick\b/.test(m)) changes.push({ type: 'add_preference', preference: 'spicy' });
  if (/\b(more )?protein\b/.test(m)) changes.push({ type: 'add_preference', preference: 'high-protein' });
  if (/\bcheesier|more cheese\b/.test(m)) changes.push({ type: 'add_preference', preference: 'cheesy' });

  if (changes.length) return { reply: null, changes, trigger: triggers[0] ?? 'Plan adjusted' };
  return { reply: answerQuestion(m, state), changes: [] };
}

function answerQuestion(m: string, state: SessionState): string {
  const step = state.recipe?.steps[state.currentStepIndex];
  if (!state.recipe || !step) {
    return "I'm here. Tell me what changed, like an ingredient you're out of, your time, equipment, or who you're feeding, and I'll replan.";
  }
  if (/\b(how (do i|can i) )?(know|tell).*(done|ready|cooked)|is it done|how long\b/.test(m)) {
    return step.tip
      ? `For “${step.title}”: ${step.tip}${step.timerSeconds ? ` The timer is set for ${Math.round(step.timerSeconds / 60) || 1} min.` : ''}`
      : `For “${step.title}”, trust your eyes and nose more than the clock. ${step.timerSeconds ? `Roughly ${Math.round(step.timerSeconds / 60) || 1} min.` : ''}`.trim();
  }
  if (/\b(safe|allerg|expire|spoil|fresh|raw)\b/.test(m)) {
    return "I can share general cooking guidance, but I can't verify allergens, freshness or contamination from a photo. Check packaging and use-by dates, and when in doubt, leave it out. The food-safety lookup below links to trusted general guidance.";
  }
  if (/\b(substitut|swap|instead|replace)\b/.test(m)) {
    return 'Tell me which ingredient you want to swap or are missing. Something like "I don\'t have cheese" works. I\'ll rework the whole remaining plan around it without breaking your rules.';
  }
  if (/\b(why|reason)\b/.test(m)) {
    return state.recipe.whyItFits.slice(0, 3).join(' ');
  }
  if (/\b(thanks|thank you|merci|great|awesome|perfect)\b/.test(m)) {
    return 'Avec plaisir! You\'re doing great. Hit "Next" when this step is done.';
  }
  return `You're on “${step.title}”. ${step.tip ?? 'Take it one step at a time.'} If anything changes, like an ingredient, time, equipment, or servings, just tell me and I'll replan the rest.`;
}
