import { describeChanges } from '../../agent/adapt';
import { sameIngredient } from '../../data/ingredients';
import { EQUIPMENT_IDS } from '../../data/rules';
import { TECHNIQUES, techniqueById, techniqueFor, techniqueFromQuestion, techniqueQuery } from '../../data/techniques';
import type { CookSession, DietRuleId, SessionChange } from '../../types';
import type { InterpretResult } from '../modelService';
import { answerOffer, kitchenHelp } from './kitchenHelp';

// ─────────────────────────────────────────────────────────────
// MOCK conversational agent: a rule-based intent parser.
// With a live model, the model produces the same structure and
// this parser is the fallback when the model can't be reached.
// Also used directly for hands-free voice commands, which need
// to be instant.
// ─────────────────────────────────────────────────────────────

const NUMBER_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
const num = (s: string) => NUMBER_WORDS[s] ?? parseFloat(s);
const NUM = '(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty)';

/** Lowercase, with curly quotes from phones and suggestion chips made straight. */
const clean = (s: string) => s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').trim();

const DIET_PATTERNS: [RegExp, DietRuleId][] = [
  [/\bvegan\b/, 'vegan'],
  [/\b(vegetarian|veggie only|no meat|meat-?free)\b/, 'vegetarian'],
  [/\bpescatarian\b/, 'pescatarian'],
  [/\b(dairy[- ]?free|no dairy|lactose)\b/, 'dairy-free'],
  [/\b(gluten[- ]?free|no gluten|celiac|coeliac)\b/, 'gluten-free'],
  [/\b(egg[- ]?free|no eggs?)\b/, 'egg-free'],
  [/\b(nut[- ]?free|no nuts)\b/, 'nut-free'],
  [/\b(shellfish[- ]?free|no shellfish)\b/, 'shellfish-free'],
];

/** Instant, local commands for cooking mode (typed or spoken). */
export function parseCommand(m: string): InterpretResult | null {
  const t = clean(m).replace(/[?!.,]/g, '').trim();
  const timer = t.match(new RegExp(`\\b(?:set |start )?(?:a |an )?${NUM}[- ](second|sec|minute|min|hour)s?(?: timer)?\\b|\\btimer for ${NUM} (second|sec|minute|min|hour)s?\\b`));
  if (timer && /timer|set|start/.test(t)) {
    const n = num(timer[1] ?? timer[3]);
    const unit = timer[2] ?? timer[4];
    const seconds = Math.round(unit.startsWith('s') ? n : unit.startsWith('h') ? n * 3600 : n * 60);
    return { reply: null, changes: [], command: { type: 'timer', seconds } };
  }
  if (/^(ok |okay )?(gusteau )?(what'?s next|next( step)?|done|i'?m done|finished|go on|continue|ready)( step)?( please)?$/.test(t)) return { reply: null, changes: [], command: { type: 'next' } };
  if (/^(repeat( that)?|say (that|it) again|what was that|come again|read (it|that) again|again)( please)?$/.test(t)) return { reply: null, changes: [], command: { type: 'repeat' } };
  if (/^(go )?(back|previous( step)?|last step)( please)?$/.test(t)) return { reply: null, changes: [], command: { type: 'back' } };
  if (/^(show me how|show me|how do i do (it|that)|show me a video)$|\b(video|demonstrat\w*|clip)\b/.test(t)) return { reply: null, changes: [], command: { type: 'show_technique' } };
  if (/^(ok |okay |thanks |thank you )?(got it|close (it|that|this|the pictures)?|close|dismiss|hide (it|that|them|the pictures)|back to (cooking|the recipe)|that's enough|i see)( thanks| thank you)?$/.test(t)) {
    return { reply: null, changes: [], command: { type: 'dismiss' } };
  }
  return null;
}

// Words that follow "what's" without being an ingredient or a tool.
const NOT_A_THING = /^(how|next|next step|step|steps|time|ingredients|options|rules|plan|recipe|this recipe|for lunch|for breakfast|left|that|this|it|happening|wrong|going on|the time|the plan|up|for dinner|the difference|the point|better|best|in it|in this|the next step|this step|my next step|done|ready|the matter|the problem|on|in)$/;

/**
 * "What is mirin?", "what's a zester?", "what does a colander look like?",
 * "I don't know what a skillet is": the thing to define, or null.
 */
/**
 * "How do I dice an onion?", "how to brown chicken", "show me how to fold",
 * "I don't know how to julienne": the technique to show videos of. "How do I
 * do that?" means the current step. Not "how long", "how much" or "how do I
 * know when it's done", which are answered in words.
 */
export function howToRequest(raw: string, s: CookSession): string | null {
  const t = clean(raw).replace(/[?!.,]/g, '').trim();
  const g =
    t.match(/^(?:so |ok |okay |and |um |sorry )?how (?:do|should|can|would|could) (?:i|you|we|one) (.+)$/) ??
    t.match(/^(?:so |and )?how to (.+)$/) ??
    t.match(/^(?:can you |could you |please )?(?:show|teach) me how to (.+)$/) ??
    t.match(/^what(?:'s| is) the (?:best |right |proper )?way to (.+)$/) ??
    t.match(/^(?:i don't know|i'm not sure|not sure|i've never learned) how to (.+)$/);
  let task = g?.[1]?.replace(/\b(properly|correctly|exactly|again|please|right|here|for this)\b/g, '').replace(/\s+/g, ' ').trim();
  if (!task || /^(know|tell|check|see|make sure|keep|stop|get started|start|begin|go on|continue)\b/.test(task) || /\b(done|ready|cooked|long|much|many)\b/.test(task)) return null;
  // "do that", "do this step", "do it": whatever the current step asks for.
  if (/^(do )?(it|that|this|this step|the step|that part)$/.test(task)) {
    const step = s.recipe.steps[s.stepIndex];
    if (!step) return null;
    const tech = techniqueFor(step);
    task = tech ? techniqueQuery(tech) : step.title.toLowerCase();
  }
  return task.split(' ').length <= 8 ? task : null;
}

export function explainRequest(raw: string): string | null {
  const t = clean(raw).replace(/[?!.,]/g, '').trim();
  const forms = [
    /^(?:so |and |um |sorry |wait )?what(?:'s| is| are)(?: an?| the| some)? (.+?)(?: exactly| again| used for| for| anyway)?$/,
    /^what does (?:an?|the) (.+?) look like$/,
    /^what do(?:es)? (.+?) look like$/,
    /^(?:i don't know|i'm not sure|not sure|i've never heard of|never heard of) what (?:an? |the |some )?\s*(.+?) (?:is|are)$/,
    /^(?:i don't know|i've never heard of|never heard of|i've never used) (?:an? |the |some )?(.+)$/,
    /^(?:what do you mean by|what's meant by|define|explain what) (?:an? |the |some )?(.+?)(?: is| are)?$/,
    /^(?:show me|can you show me) (?:an? |the |some )?(?:picture of |photo of |pictures of )?(?:an?|the )?(.+)$/,
  ];
  for (const re of forms) {
    const g = t.match(re);
    const term = g?.[1]?.trim().replace(/^((an?|the|some) )?(pictures?|photos?|images?) of /, '').replace(/^(an?|the|some) /, '').trim();
    if (term && term.split(' ').length <= 4 && !NOT_A_THING.test(term) && !/^how\b/.test(term) &&!/\b(i|you|we|my|your|it|that|this|they)\b/.test(term)) return term;
  }
  return null;
}

export function parseIntent(raw: string, s: CookSession): InterpretResult {
  const m = clean(raw);
  const cmd = parseCommand(m);
  if (cmd) return cmd;
  const help = answerOffer(raw, s) ?? kitchenHelp(raw, s);
  if (help) return help;
  const explain = explainRequest(raw);
  if (explain) return { reply: null, changes: [], explain };
  const howTo = howToRequest(raw, s);
  if (howTo) {
    const tech = techniqueFromQuestion(howTo) ?? TECHNIQUES.find((x) => x.match.test(howTo));
    return { reply: tech ? `${tech.title}: ${tech.howTo}` : `Here are some short videos on how to ${howTo}.`, changes: [], howTo, techniqueId: tech?.id };
  }

  const changes: SessionChange[] = [];
  const r = s.rules;
  const ingredientNames = [...s.original.ingredients.map((i) => i.name), ...s.recipe.ingredients.map((i) => i.name), ...s.pantry.map((p) => p.name)];
  const known = (phrase: string) => ingredientNames.find((n) => sameIngredient(n, phrase) || n.toLowerCase().includes(phrase));


  // ── Equipment ──
  for (const e of EQUIPMENT_IDS) {
    const word = e === 'stovetop' ? '(stove|stovetop|hob|burner)' : e;
    if (new RegExp(`\\b(no|don'?t have (a|an)?|without (a|an|the)?) ?${word}\\b|\\b${word} (is )?(broken|busy|not working|died)`).test(m) && r.equipment.includes(e)) {
      changes.push({ type: 'remove_equipment', equipment: e });
    }
  }

  // ── Diet rules & allergies ──
  for (const [re, rule] of DIET_PATTERNS) {
    if (re.test(m) && !r.hardExclusions.includes(rule)) {
      changes.push({ type: 'add_exclusion', rule });
      break;
    }
  }
  const allergy = m.match(/allergic to ([a-z ]+?)(?:[.,!]|$| and )/);
  if (allergy) changes.push({ type: 'add_exclusion', custom: allergy[1].trim() });

  // ── Time ──
  const mins = m.match(/\b(?:only (?:have )?|got |have )?(\d+)\s*(?:min|mins|minutes)\b(?! timer)/);
  if (mins && /\b(only|have|got|left|need to be done|hurry)\b/.test(m)) changes.push({ type: 'set_time', minutes: parseInt(mins[1], 10) });
  else if (/\bhalf an hour\b/.test(m)) changes.push({ type: 'set_time', minutes: 30 });

  // ── Servings ──
  const people = m.match(/\b(?:for|feed|feeding|serves?|serving)\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b(?! min)/) ?? m.match(/\b(\d+|two|three|four|five|six|seven|eight)\s+(?:people|of us|servings|guests)\b/);
  if (people) {
    const n = num(people[1]);
    if (n && n !== r.servings) changes.push({ type: 'set_servings', servings: n });
  } else if (/\b(more people|friends (are )?coming|extra guests)\b/.test(m)) changes.push({ type: 'set_servings', servings: r.servings + 2 });

  // ── Leave out ──
  const skip = m.match(/\b(?:cook |make it |go )?without (?:the |any )?([a-z ]+?)(?:[.,!?]|$)|\b(?:leave out|skip|drop) (?:the |any )?([a-z ]+?)(?:[.,!?]|$)/);
  if (skip && !changes.some((c) => c.type === 'remove_equipment')) {
    const phrase = (skip[1] ?? skip[2]).trim();
    const name = known(phrase);
    if (name) changes.push({ type: 'leave_out', name });
  }

  // ── Removed ingredients ──
  const removalRe =
    /(?:don'?t|do not|didn'?t) (?:actually )?have (?:any )?([a-z ]+)|(?:out of|ran out of|run out of|used up|no more|i'?m out of|we'?re out of) (?:any |the |my )?([a-z ]+)|(?:the |my )?([a-z ]+?) (?:is|are|went|has gone|have gone) (?:gone|bad|off|spoiled|moldy|mouldy|expired|finished)|\bno ([a-z]+(?: [a-z]+)?)\b/g;
  let rm: RegExpExecArray | null;
  while ((rm = removalRe.exec(m))) {
    const phrase = (rm[1] ?? rm[2] ?? rm[3] ?? rm[4] ?? '').replace(/\b(actually|anymore|left|either|after all|any|the)\b/g, '').trim();
    if (!phrase || /^(time|minutes?|stove|stovetop|oven|microwave|blender|grill|meat|dairy|gluten|eggs?|nuts)$/.test(phrase)) continue;
    // "no X" only counts if X is an ingredient Gusteau knows about.
    const name = known(phrase) ?? (rm[4] ? null : phrase);
    if (!name || changes.some((c) => (c.type === 'remove_ingredient' || c.type === 'leave_out') && sameIngredient(c.name, name))) continue;
    changes.push({ type: 'remove_ingredient', name });
  }

  // ── Found ingredients ──
  const add = m.match(/\b(?:i (?:also |actually )?(?:have|found|got)|there'?s (?:some |also )?|found (?:some )?)\s*(?:some |a |an |the )?([a-z ]+?)(?:[.,!]|$| after all| too| as well)/);
  if (add && !/don'?t have|do not have|only have|have \d/.test(m)) {
    const phrase = add[1].trim();
    if (phrase && phrase.split(' ').length <= 3 && !/^(time|minutes?|a minute|it|that|this)$/.test(phrase)) changes.push({ type: 'add_ingredient', name: known(phrase) ?? phrase });
  }

  if (changes.length) return { reply: null, changes, trigger: describeChanges(changes) };
  return answerQuestion(m, s);
}

function answerQuestion(m: string, s: CookSession): InterpretResult {
  const step = s.recipe.steps[s.stepIndex];
  const asked = techniqueFromQuestion(m);
  if (asked && /\b(how|what|explain|mean|show)\b/.test(m)) {
    return { reply: `${asked.title}: ${asked.howTo}`, changes: [], techniqueId: asked.id };
  }
  if (!step) return { reply: 'You’re all done! Enjoy it. If you want to cook something else, head back to the recipes.', changes: [] };
  const tech = techniqueFor(step);
  if (/\b(how|explain|what does .* mean|i don'?t (get|understand)|confus|hard|difficult|stuck)\b/.test(m) && tech) {
    return { reply: `For “${step.title}”: ${tech.howTo}`, changes: [], techniqueId: tech.id };
  }
  if (/\b(how (do i|can i|will i) )?(know|tell).*(done|ready|cooked)|is it done|how long\b/.test(m)) {
    const mins = step.timerSeconds ? `The timer for this step is ${Math.round(step.timerSeconds / 60) || 1} min. ` : '';
    return { reply: `${mins}${step.tip ?? 'Trust your eyes and nose more than the clock: look for the color and texture the step describes.'}`, changes: [] };
  }
  if (/\b(safe|allerg|expire|spoil|fresh|raw|contaminat)\b/.test(m)) {
    return {
      reply: 'I can share general cooking guidance, but I can’t check allergens, freshness or contamination. Read the packaging and use-by dates, and when in doubt, leave it out. For meat, a food thermometer is the reliable test.',
      changes: [],
    };
  }
  if (/\b(substitut|swap|instead|replace)\b/.test(m)) {
    return { reply: 'Tell me what you’re missing, like “I don’t have cheese”, and I’ll rework the rest of the plan around it without breaking your rules.', changes: [] };
  }
  if (/\b(thanks|thank you|merci|great|awesome|perfect)\b/.test(m)) return { reply: 'Avec plaisir! You’re doing great. Say “next” when this step is done.', changes: [] };
  const t = step.technique ? techniqueById(step.technique) : tech;
  return {
    reply: `You’re on “${step.title}”. ${step.tip ?? (t ? `Need a hand? Ask me how to ${t.title.toLowerCase().replace(/^(\w+)ing\b/, '$1')}.` : 'Take it one step at a time.')} If anything changes, like an ingredient, time, equipment or servings, tell me and I’ll replan the rest.`,
    changes: [],
  };
}
