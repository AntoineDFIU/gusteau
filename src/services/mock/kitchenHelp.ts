import { describeChanges, substitutionHints, type SwapHint } from '../../agent/adapt';
import { availability, breaksRule, isEssential } from '../../agent/kitchen';
import { normalize, sameIngredient, substitutesFor } from '../../data/ingredients';
import type { CookSession, RecipeIngredient, SessionChange } from '../../types';
import type { InterpretResult } from '../modelService';

// ─────────────────────────────────────────────────────────────
// Rule-based kitchen help: swap questions and requests, additions,
// and fixes for things going wrong. It answers offline (mock mode),
// stands in when the model can't be reached, and handles yes/no to
// Gusteau's offers instantly in every mode.
//
// Anything that changes the plan is returned as a SessionChange, so
// the replanner and its validator still decide what's safe.
// ─────────────────────────────────────────────────────────────

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const strip = (s: string) => s.replace(/^(the|some|a|an|my|a little|a bit of|more)\s+/, '').replace(/\s+(too|as well|instead|please|in it|to it|in there)$/, '').trim();
const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`);

/**
 * The cook's answer to what Gusteau just offered: "yes", one of the listed
 * swap options by name, "leave it out", or "no". Changes returned here were
 * agreed to, so they apply without asking again.
 */
export function answerOffer(raw: string, s: CookSession): InterpretResult | null {
  const choice = s.pendingChoice;
  if (!s.pendingOffer?.length && !choice) return null;
  const m = clean(raw);
  const agreed = (changes: SessionChange[]): InterpretResult => ({ reply: null, changes, trigger: describeChanges(changes), confirmed: true });
  const outOf: SessionChange[] = choice?.out ? [{ type: 'remove_ingredient', name: choice.current }] : [];
  if (/^(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|sounds good|let's do (it|that)|switch|swap it|add it|perfect)( please| thanks| thank you)?$/.test(m) && s.pendingOffer?.length) {
    return agreed(s.pendingOffer);
  }
  if (choice) {
    if (/\b(leave (it|them) out|without (it|them)|skip (it|them)|cook without|drop (it|them)|go without|do without)\b/.test(m)) return agreed([...outOf, { type: 'leave_out', name: choice.from }]);
    const picked = choice.options.find((o) => m.includes(normalize(o)) || m.includes(o.toLowerCase()) || new RegExp(`\\b${normalize(o).split(' ').pop()}`).test(m));
    if (picked) return agreed([...outOf, { type: 'swap_ingredient', from: choice.from, to: picked }]);
    // Something else by name ("couscous", "how about pita?"): that's their pick. The usual checks still apply.
    const named = m.match(/^(?:(?:can i |could i |let's |i'll )?(?:use|try|go with|have)|how about|what about)?\s*(?:the |some )?([a-z][a-z ]{2,30}?)(?: instead| please)?$/);
    const other = named?.[1]?.trim();
    if (other && other.split(' ').length <= 3 && !/^(yes|no|ok|okay|hmm|what|why|how|wait|sorry|thanks|thank you|maybe|not sure|i don't know)$/.test(other)) {
      return agreed([...outOf, { type: 'swap_ingredient', from: choice.from, to: cap(other) }]);
    }
  }
  if (/^(no|nope|nah|no thanks|no thank you|not now|keep it|never mind)( thanks| thank you)?$/.test(m)) {
    // Still out of it: the plan can't simply stay as it is.
    if (choice?.out) return { reply: `Okay. Since you’re out of ${choice.current.toLowerCase()}, tell me what you’d like to use instead, or I can leave it out.`, changes: [], choice, offer: [...outOf, { type: 'leave_out', name: choice.from }] };
    return { reply: 'No problem, we’ll keep the plan as it is.', changes: [] };
  }
  return null;
}

/** Still to be used: by an unfinished step, or not tied to any step. */
const needed = (s: CookSession, i: RecipeIngredient) => {
  const used = s.recipe.steps.filter((st) => st.uses.includes(i.id));
  return !used.length || used.some((st) => !s.completedStepKeys.includes(st.key));
};

/**
 * Running out of an ingredient, or asking for a swap, never changes the plan
 * straight away: Gusteau lists the options that fit the cook's rules and
 * kitchen and asks first. Returns the question, plus any other changes in the
 * same message (they apply as usual). Null when nothing needs asking, e.g.
 * the ingredient isn't used in what's left of the recipe.
 */
export function proposeIngredientChange(changes: SessionChange[], s: CookSession): { proposal: InterpretResult; rest: SessionChange[] } | null {
  // "Out of X" comes first: it lists every option, not just the one a model picked.
  const target = changes.find((c) => c.type === 'remove_ingredient') ?? changes.find((c) => c.type === 'swap_ingredient');
  if (!target) return null;
  // Every ingredient replacement in the message waits for the cook's answer (a model may send
  // "out of rice" and "swap to tortillas" together); only unrelated changes apply straight away.
  const rest = changes.filter((c) => c.type !== 'remove_ingredient' && c.type !== 'swap_ingredient' && c.type !== 'leave_out');
  const named = target.type === 'remove_ingredient' ? target.name : target.from;
  const ing = findIngredient(named, s);
  if (!ing || !needed(s, ing)) return null;
  const from = ing.substitutedFor ?? ing.name;
  const label = ing.name.toLowerCase();
  const out = target.type === 'remove_ingredient';
  const outOf: SessionChange[] = out ? [{ type: 'remove_ingredient', name: target.name }] : [];

  if (target.type === 'swap_ingredient') {
    const note = substitutesFor(from).find((o) => sameIngredient(o.name, target.to))?.note ?? 'Use about the same amount.';
    return {
      rest,
      proposal: {
        reply: `${cap(target.to.toLowerCase())} can stand in for the ${label}. ${note} Shall I switch it in the plan?`,
        changes: [],
        offer: [{ type: 'swap_ingredient', from, to: target.to }],
        choice: { from, current: ing.name, options: [target.to], out: false },
      },
    };
  }

  const hint = substitutionHints(s).find((h) => h.ingredient === ing.name);
  const options = hint?.options ?? [];
  const owned = options.filter((o) => o.status === 'have').map((o) => o.name);
  const maybe = options.filter((o) => o.status === 'unknown').map((o) => o.name);
  const choices = [...owned, ...maybe];
  const droppable = !isEssential(ing);
  if (!choices.length) {
    return {
      rest,
      proposal: {
        reply: `No ${label}? I don’t have a swap for it that fits your rules and kitchen. Shall I carry on without it?`,
        changes: [],
        offer: [...outOf, { type: 'leave_out', name: from }],
        choice: { from, current: ing.name, options: [], out },
      },
    };
  }
  const best = choices[0];
  const lower = (xs: string[]) => xs.map((x) => x.toLowerCase());
  const parts = [
    owned.length && `You could use ${list(lower(owned))}, which you have.`,
    maybe.length && `${cap(list(lower(maybe)))} would work too, if you have ${maybe.length > 1 ? 'any' : 'it'}.`,
    options.find((o) => o.name === best)?.note,
    `Shall I switch to ${best.toLowerCase()}${droppable ? `, or leave the ${label} out` : ''}?`,
  ].filter(Boolean);
  return {
    rest,
    proposal: {
      reply: `${out ? `No ${label}? No problem. ` : ''}${parts.join(' ')}`,
      changes: [],
      offer: [...outOf, { type: 'swap_ingredient', from, to: best }],
      choice: { from, current: ing.name, options: choices, out },
    },
  };
}

/** The recipe ingredient a phrase refers to, preferring ones still to be used. */
function findIngredient(phrase: string, s: CookSession): RecipeIngredient | undefined {
  const p = strip(phrase);
  if (!p) return undefined;
  const all = s.recipe.ingredients;
  return all.find((i) => sameIngredient(i.name, p)) ?? all.find((i) => normalize(i.name).split(' ').includes(normalize(p).split(' ').pop() ?? '')) ?? all.find((i) => p.includes(normalize(i.name)));
}

/** An ingredient named anywhere in the message. */
const mentioned = (m: string, s: CookSession) =>
  [...s.recipe.ingredients].sort((a, b) => b.name.length - a.name.length).find((i) => {
    const n = normalize(i.name);
    const head = n.split(' ').pop() ?? n;
    return m.includes(n) || (head.length > 2 && new RegExp(`\\b${head}(e?s)?\\b`).test(m));
  });

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const hintLine = (h: SwapHint) => {
  if (!h.options.length) return '';
  const owned = h.options.filter((o) => o.status === 'have').map((o) => o.name.toLowerCase());
  const others = h.options.filter((o) => o.status !== 'have').map((o) => o.name.toLowerCase());
  if (owned.length) return `For the ${h.ingredient.toLowerCase()}, you could use ${list(owned)}, which you have.${others.length ? ` ${cap(list(others))} would work too.` : ''}`;
  return `For the ${h.ingredient.toLowerCase()}, ${list(others)} would work${h.options.some((o) => o.status === 'missing') ? ', but you don’t have them' : ''}.`;
};

/** Can this be used in this kitchen? A reason it can't, or null. */
function cannotUse(name: string, s: CookSession): string | null {
  const rule = breaksRule(name, s.rules);
  if (rule) return `${name.toLowerCase()} breaks your “${rule}” rule`;
  if (availability(name, s.pantry, s.pantryBasics) === 'missing') return `${name.toLowerCase()} isn’t in your kitchen`;
  return null;
}

function swapTalk(m: string, s: CookSession): InterpretResult | null {
  const asks = /^(can|could|may|should|is it ok to|would it work to|what if i) /.test(m);
  const forms: [RegExp, (g: RegExpMatchArray) => [string, string]][] = [
    [/\b(?:use|using|try|go with) (.+?) instead of (.+)$/, (g) => [g[2], g[1]]],
    [/\b(?:swap|switch|replace|sub) (?:out )?(.+?) (?:for|with) (.+)$/, (g) => [g[1], g[2]]],
    [/\bsubstitute (.+?) for (.+)$/, (g) => [g[2], g[1]]],
  ];
  for (const [re, pick] of forms) {
    const g = m.match(re);
    if (!g) continue;
    const [fromPhrase, toPhrase] = pick(g).map(strip);
    const from = findIngredient(fromPhrase, s);
    if (!from) return { reply: `This recipe doesn’t use ${fromPhrase}, so there’s nothing to swap.`, changes: [] };
    const to = toPhrase.replace(/^./, (c) => c.toUpperCase());
    const why = cannotUse(to, s);
    if (why) return { reply: `I wouldn’t: ${why}. ${hintLine(substitutionHints(s).find((h) => h.ingredient === from.name) ?? { ingredient: from.name, options: [] }) || ''}`.trim(), changes: [] };
    const change: SessionChange = { type: 'swap_ingredient', from: from.substitutedFor ?? from.name, to };
    const known = substitutesFor(from.substitutedFor ?? from.name).find((o) => sameIngredient(o.name, to));
    if (asks) return { reply: `Yes, ${to.toLowerCase()} works instead of ${from.name.toLowerCase()}. ${known?.note ?? 'Use about the same amount.'} Want me to switch it in the plan?`, changes: [], offer: [change] };
    return { reply: null, changes: [change], trigger: describeChanges([change]) };
  }
  if (/\b(instead of|substitut\w*|replace\w*|alternative|swap|what else can i use|don't have to use|other than)\b/.test(m)) {
    const hints = substitutionHints(s);
    const ing = mentioned(m, s);
    const hint = ing && hints.find((h) => h.ingredient === ing.name);
    if (ing && !hint) return { reply: `I don’t have a safe swap for the ${ing.name.toLowerCase()} that fits your rules and kitchen. If you’re out, tell me and I’ll rework the plan around it.`, changes: [] };
    if (hint) {
      const best = hint.options.find((o) => o.status === 'have') ?? hint.options.find((o) => o.status === 'unknown');
      const offer: SessionChange[] | undefined = best ? [{ type: 'swap_ingredient', from: ing!.substitutedFor ?? ing!.name, to: best.name }] : undefined;
      return { reply: `${hintLine(hint)}${best ? ` ${best.note} Want me to switch to ${best.name.toLowerCase()}?` : ''}`, changes: [], offer };
    }
    if (hints.length) return { reply: `Here’s what you can swap: ${hints.slice(0, 3).map(hintLine).join(' ')}`, changes: [] };
  }
  return null;
}

const SPICY = /\b(hot sauce|chili flakes|red pepper flakes|chili|chile|jalape\w*|salsa|sriracha|harissa|gochujang|cayenne|chipotle)\b/;

function additionTalk(m: string, s: CookSession): InterpretResult | null {
  if (/\b(spic(y|ier)|more heat|more kick|hotter|some heat)\b/.test(m) && !/\btoo spicy\b/.test(m)) {
    const hot = [...s.pantry.map((p) => p.name), ...s.recipe.ingredients.map((i) => i.name)].find((n) => SPICY.test(n.toLowerCase()) && !breaksRule(n, s.rules));
    if (!hot) return { reply: 'A pinch of chili flakes or a few dashes of hot sauce would do it, but I don’t see either in your kitchen. Tell me if you have something spicy.', changes: [] };
    const change: SessionChange = { type: 'add_to_recipe', name: hot.toLowerCase(), how: `Stir in a little ${hot.toLowerCase()}, taste, and add more if you want it hotter.`, when: 'end' };
    return { reply: `You could add a little ${hot.toLowerCase()} at the end, to taste. Want me to add it to the plan?`, changes: [], offer: [change] };
  }
  const question = m.match(/^(?:can|could|should|may) i (?:add|put in|throw in|stir in|use) (.+)$/);
  const command = m.match(/^(?:please )?(?:let's )?(?:add|put in|throw in|stir in|i want to add|i'd like to add) (.+)$/);
  const g = question ?? command;
  if (!g) return null;
  const name = strip(g[1]).replace(/^(some|a|an)\s+/, '');
  if (!name || /\b(time|minutes?|people|person|servings?|guests?)\b/.test(name)) return null;
  const why = cannotUse(name, s);
  if (why) return { reply: `I’d skip that: ${why}.`, changes: [] };
  const inRecipe = s.recipe.ingredients.some((i) => sameIngredient(i.name, name));
  const change: SessionChange = { type: 'add_to_recipe', name, how: inRecipe ? `Add a little more ${name}.` : `Stir in the ${name} and let it warm through.`, when: 'now' };
  if (question) return { reply: `Yes, ${name} would work here. I’d stir it in now so it warms through. Want me to add it to the plan?`, changes: [], offer: [change] };
  return { reply: null, changes: [change], trigger: describeChanges([change]) };
}

interface Fix {
  match: RegExp;
  say: (s: CookSession) => string;
  timerSeconds?: (s: CookSession) => number;
  /** The ingredient may be ruined: offer to replan without it. */
  ruins?: boolean;
}

const dairyOk = (s: CookSession) => !breaksRule('yogurt', s.rules);
const stovetop = (s: CookSession) => s.rules.equipment.includes('stovetop');

const FIXES: Fix[] = [
  {
    match: /\b(burn\w*|burnt|scorch\w*|smok(ing|y))\b/,
    say: () => 'Take it off the heat right away. Don’t scrape the bottom: move the good part to a clean bowl or pan and leave the burnt layer behind. Taste it, and if the burnt flavor went all the way through, I can work around it.',
    ruins: true,
  },
  { match: /\b(ruin\w*|dropped|spilled|inedible|threw (it )?out|went bad)\b/, say: () => 'That happens. I can rework the rest of the plan without it.', ruins: true },
  { match: /\btoo salty\b/, say: () => 'Balance it with more of the unsalted parts of the dish, a squeeze of lemon or lime, or a splash of water. Hold off on any more salty sauces.' },
  { match: /\btoo (spicy|hot)\b/, say: (s) => `Cool it down with ${dairyOk(s) ? 'a spoonful of yogurt or sour cream, or some cheese' : 'a little sugar and a squeeze of lime'}, or stretch it with more of the base.` },
  { match: /\b(too thick|too dry|dried out|gluey)\b/, say: () => 'Loosen it with a splash of water or broth, a tablespoon at a time, stirring until it’s how you like it.' },
  {
    match: /\b(too (thin|runny|watery)|runny|watery|soupy)\b/,
    say: (s) => (stovetop(s) ? 'Let it simmer uncovered for a few more minutes so the extra liquid cooks off. I’ve started a three-minute timer.' : 'Microwave it uncovered in thirty-second bursts, stirring in between, until it thickens. I’ve started a thirty-second timer for the first one.'),
    timerSeconds: (s) => (stovetop(s) ? 180 : 30),
  },
  { match: /\b(stick\w*|stuck)\b/, say: () => 'Turn the heat down a little and add a small splash of oil. Let it sit a moment, and it will release on its own once it browns.' },
  {
    match: /\b(not (done|cooked|ready|soft|tender)|still (hard|raw|crunchy|cold|pink|frozen)|undercooked)\b/,
    say: () => 'Give it a little longer: one more minute, then check again. I’ve started a one-minute timer. For meat, a thermometer is the reliable test.',
    timerSeconds: () => 60,
  },
  { match: /\b(soggy|mushy|limp)\b/, say: () => 'Spread it out so steam can escape, then crisp it in a hot dry pan or in the microwave uncovered for thirty seconds. Add wet toppings at the very end.' },
  { match: /\b(boil\w* over|bubbling over|foaming)\b/, say: () => 'Lower the heat and leave the lid slightly open. A wooden spoon laid across the pot helps stop it boiling over.' },
  { match: /\b(bland|no flavou?r|tasteless|needs something)\b/, say: () => 'Add a pinch of salt first, then something bright like lemon or lime juice. Taste between each addition.' },
  { match: /\b(overcooked|too done|tough|rubbery)\b/, say: () => 'It’s still good to eat. Slice it thinly and add a little sauce or a splash of broth to bring back some moisture.' },
];

function troubleshoot(m: string, s: CookSession): InterpretResult | null {
  const fix = FIXES.find((f) => f.match.test(m));
  if (!fix) return null;
  const ing = fix.ruins ? mentioned(m, s) : undefined;
  const offer: SessionChange[] | undefined = ing ? [{ type: 'remove_ingredient', name: ing.substitutedFor ?? ing.name }] : undefined;
  return {
    reply: `${fix.say(s)}${offer ? ` If the ${ing!.name.toLowerCase()} can’t be saved, say yes and I’ll replan without it.` : ''}`,
    changes: [],
    offer,
    timerSeconds: fix.timerSeconds?.(s),
  };
}

/**
 * Swaps and additions the cook (or the model) asked for that can't be used
 * here are turned into a short "I'd skip that" instead of a failed replan.
 */
export function vetChanges(changes: SessionChange[], s: CookSession): { changes: SessionChange[]; refusals: string[] } {
  const refusals: string[] = [];
  const ok = changes.filter((c) => {
    const name = c.type === 'swap_ingredient' ? c.to : c.type === 'add_to_recipe' ? c.name : null;
    if (!name) return true;
    const why = cannotUse(name, s);
    if (why) refusals.push(`I’d skip that: ${why}.`);
    return !why;
  });
  return { changes: ok, refusals };
}

/**
 * Answers that must come from the kitchen itself, even with a live model:
 * a swap or addition that can't be used here, and "make it spicier" (which
 * should only suggest what the cook has). Null when the model should answer.
 */
export function groundedAnswer(raw: string, s: CookSession): InterpretResult | null {
  const m = clean(raw);
  const r = swapTalk(m, s) ?? additionTalk(m, s);
  if (!r || r.changes.length) return null;
  const refusal = /^(I’d skip that|I wouldn’t|This recipe doesn’t use)/.test(r.reply ?? '');
  const spicy = /\b(spic(y|ier)|more heat|more kick|hotter|some heat)\b/.test(m);
  return refusal || spicy ? r : null;
}

/** Swap questions and requests, additions and fixes, in that order. */
export function kitchenHelp(raw: string, s: CookSession): InterpretResult | null {
  const m = clean(raw);
  return swapTalk(m, s) ?? additionTalk(m, s) ?? troubleshoot(m, s);
}
