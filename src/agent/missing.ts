import { grainOf, isStaple, normalize, proteinOf, sameIngredient, substitutesFor } from '../data/ingredients';
import type { CookRules, PendingChoice, Recipe, RecipeIngredient } from '../types';
import { kitchenSpelling } from '../services/topic';
import { breaksRule, isEssential } from './kitchen';

// ─────────────────────────────────────────────────────────────
// "I don't have cheddar." Gusteau doesn't know what's in the kitchen,
// so he never assumes there's nothing else: he suggests what could
// stand in and asks whether the cook has it, and offers to go without
// only when the dish still works without it. Nothing changes until the
// cook answers. Used while choosing a dish and while cooking.
// ─────────────────────────────────────────────────────────────

type Rules = Pick<CookRules, 'hardExclusions' | 'allergies' | 'equipment'>;

const CHEESE = /\b(cheese|cheddar|mozzarella|parmesan|pecorino|feta|monterey jack|pepper jack|queso|halloumi|paneer|ricotta|gouda|gruy[eè]re|swiss|provolone|brie|havarti|emmental|manchego|colby|fontina|comt[eé])\b/i;

/** A swap does the same job in the dish: a known substitute, or the same kind of ingredient. */
export function sameRole(from: string, to: string): boolean {
  if (substitutesFor(from).some((o) => sameIngredient(o.name, to))) return true;
  const kind = (f: (n: string) => string | null) => !!f(from) && f(from) === f(to);
  return kind(proteinOf) || kind(grainOf) || (CHEESE.test(from) && CHEESE.test(to)) || sameIngredient(from, to);
}

/** Ingredients that come in many kinds, so "another kind of cheese" is the natural question. */
const KINDS: [RegExp, string][] = [
  [CHEESE, 'cheese'],
  [/\bvinegar\b/i, 'vinegar'],
  [/\bmustard\b/i, 'mustard'],
  [/\b(buns?|rolls?|bread|baguette|brioche)\b/i, 'bread or rolls'],
  [/\b(lettuce|greens|salad leaves)\b/i, 'salad leaves'],
  [/\b(pasta|spaghetti|penne|linguine|fettuccine|macaroni|rigatoni|fusilli)\b/i, 'pasta'],
  [/\bnoodles?\b/i, 'noodles'],
  [/\bbeans?\b/i, 'beans'],
  [/\bpickles?\b/i, 'pickles'],
  [/\b(hot sauce|chili sauce|sriracha)\b/i, 'hot sauce'],
];
const kindOf = (name: string) => KINDS.find(([re]) => re.test(name))?.[1] ?? null;

const DISH = /(burger|taco|burrito|curry|soup|salad|stew|bowl|sandwich|pizza|omelett?e|pasta|risotto|chili|wrap|quesadilla|noodles|stir-fry|pie|cake|toast|frittata|casserole|gratin|tart|skewer|kebab|dumpling|pancake|fritter)s?$/;
/** "the burger" for a Classic Cheeseburger, or "it". */
export function dishName(r: Recipe): string {
  const last = r.title.toLowerCase().split(/\s+/).pop() ?? '';
  const m = last.match(DISH);
  return m ? `the ${m[0]}` : 'it';
}

/**
 * The dish is built on it: its protein, its bread, rice or pasta, flour or
 * yeast, or what it's named after. Leaving one of these out isn't offered.
 */
export function isCore(ing: RecipeIngredient, r: Recipe): boolean {
  if (!isEssential(ing) || isStaple(ing.name)) return false;
  const n = ing.name.toLowerCase();
  if (proteinOf(n) || grainOf(n) || /\b(flour|yeast)\b/.test(n)) return true;
  const one = (w: string) => w.replace(/(?<=[^s])e?s$/, '');
  const title = new Set(r.title.toLowerCase().split(/[^a-z]+/).map(one));
  return n.split(/[^a-z]+/).some((w) => w.length > 3 && title.has(one(w)));
}

/** "it" or "them": burger buns, brioche rolls. */
const itOrThem = (name: string) => (/[^s]s$/i.test(name.trim()) ? 'them' : 'it');
const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** What Gusteau asks when the cook is missing `ing`, and what he'll accept as an answer. */
export function missingQuestion(ing: RecipeIngredient, r: Recipe, rules: Rules, where: 'preview' | 'cooking', out = true): PendingChoice & { say: string } {
  const from = ing.substitutedFor ?? ing.name;
  const label = ing.name.toLowerCase();
  const core = isCore(ing, r);
  const kind = kindOf(ing.name) && !breaksRule(kindOf(ing.name)!, rules) ? kindOf(ing.name) : null;
  // Known stand-ins that pass the cook's rules and need only equipment they have; a generic
  // "shredded cheese" is already covered by asking for another kind of cheese.
  const options = substitutesFor(from)
    .filter(
      (o) =>
        !breaksRule(o.name, rules) &&
        (!o.method || o.method.equipment.some((e) => rules.equipment.includes(e))) &&
        !r.ingredients.some((i) => i.id !== ing.id && sameIngredient(i.name, o.name)) &&
        !(kind && kindOf(o.name) === kind),
    )
    .map((o) => o.name);
  const named = options.slice(0, 2).map((o) => o.toLowerCase());
  const ask =
    kind && named.length
      ? `Do you have another kind of ${kind}, or ${list(named)}?`
      : kind
        ? `Do you have another kind of ${kind} you’d like to use?`
        : named.length
          ? `Do you have ${list(named)} instead?`
          : 'Do you have something you could use in its place?';
  const dish = dishName(r);
  const say = core
    ? `${dish === 'it' ? 'This dish' : cap(dish)} really needs the ${label}, so I wouldn’t leave ${itOrThem(label)} out. ${ask} ${where === 'preview' ? 'If not, we could pick another dish.' : 'If not, tell me what you do have and we’ll work it out.'}`
    : `${ask} Otherwise, we can make ${dish} without ${itOrThem(label)}.`;
  return { from, current: ing.name, options, out, core, kind: kind ?? undefined, say };
}

/** A thing the cook named in reply: "I have gouda", "use swiss", "how about pepper jack?", "gouda". */
export function namedThing(text: string): string | null {
  const t = text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:yes|yeah|yep|sure|ok|okay|well|um|uh|oh|so|actually)\s+)+/, '');
  const m = t.match(
    /^(?:i (?:do )?have|i've got|i got|we have|i can use|(?:can|could) i use|let's use|let's try|let's go with|i'll use|use|try|go with|how about|what about|there's|maybe)?\s*(?:some |a little |a bit of |the |a |an )?([a-z][a-z' -]{1,40}?)(?: (?:instead|then|please|at home|in the fridge|here))*$/,
  );
  const thing = m?.[1]?.trim();
  if (!thing || thing.split(' ').length > 4) return null;
  if (/^(yes|no|nope|nah|ok|okay|sure|hmm|what|why|how|wait|sorry|thanks|thank you|maybe|not sure|i don't know|none|nothing|that|it|this|another kind|something else|another one|neither|both)$/.test(thing)) return null;
  if (/\b(don't|do not|haven't|no|without|leave|skip|drop|cook|next|back|repeat|stop|sleep)\b/.test(thing)) return null;
  return thing;
}

export type MissingAnswer =
  | { kind: 'drop' }
  | { kind: 'swap'; to: string }
  /** A substitute Gusteau hasn't suggested: he checks it and asks before using it. */
  | { kind: 'confirm'; to: string; say: string }
  | { kind: 'say'; say: string };

const LEAVE_OUT = /\b(leave (it|them) out|without (it|them)|skip (it|them)|cook without|drop (it|them)|go without|do without|make it without|we can do without)\b/;
const NO = /^(no|nope|nah|no i don't|i don't|no i do not|i don't have (any|one|that|it)|no i don't have (any|one|that|it)|not really|none|nothing|no thanks|no thank you)( thanks| thank you)?$/;
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|i do|yes i do|yeah i do|please|do it|go ahead|sounds good|let's do (it|that)|perfect)( please| thanks| thank you)?$/;

/**
 * The cook's answer to "Do you have another kind of cheese?". Null when the
 * message isn't an answer (a new question, "next"…), so it's handled as usual.
 */
export function answerMissing(text: string, q: PendingChoice, r: Recipe, rules: Rules, where: 'preview' | 'cooking'): MissingAnswer | null {
  const m = text
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[?!.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const label = q.current.toLowerCase();
  const dish = dishName(r);
  const refuseDrop = () =>
    `Without the ${label}, ${dish === 'it' ? 'this dish' : dish} wouldn’t really work. ${where === 'preview' ? 'Tell me what you have instead, or say “back to recipes” and we’ll pick another dish.' : `Tell me what you have that could stand in for ${itOrThem(label)}, and I’ll adjust the rest.`}`;
  if (q.confirming) {
    if (YES.test(m)) return { kind: 'swap', to: q.confirming };
    if (NO.test(m) || /^(no|nope|nah)\b/.test(m)) return { kind: 'say', say: q.core ? refuseDrop() : `Okay. Tell me what you’d like to use instead, or I can leave the ${label} out.` };
  }
  if (LEAVE_OUT.test(m) || NO.test(m)) return q.core ? { kind: 'say', say: refuseDrop() } : { kind: 'drop' };
  if (YES.test(m)) {
    if (q.options.length === 1 && !q.kind) return { kind: 'swap', to: q.options[0] };
    return { kind: 'say', say: q.kind ? `Great. Which ${q.kind} do you have?` : `Great. Which one: ${list(q.options.map((o) => o.toLowerCase()))}?` };
  }
  // "I have Guda": named back in its kitchen spelling, so the question that confirms it shows how it was understood.
  const heard = namedThing(text);
  if (!heard) return null;
  const thing = kitchenSpelling(heard);
  if (sameIngredient(thing, q.current) || sameIngredient(thing, q.from)) return { kind: 'say', say: `That’s the one you’re out of. What could you use instead?` };
  const suggested = q.options.find((o) => sameIngredient(o, thing) || normalize(thing).includes(normalize(o)));
  if (suggested) return { kind: 'swap', to: suggested };
  const name = thing.replace(/^./, (c) => c.toUpperCase());
  const rule = breaksRule(name, rules);
  if (rule) return { kind: 'say', say: `I can’t use ${thing}: it breaks your “${rule}” rule. Anything else you could use instead of the ${label}?` };
  if (r.ingredients.some((i) => !sameIngredient(i.name, q.current) && sameIngredient(i.name, thing))) {
    return { kind: 'say', say: `${cap(thing)} is already in the recipe. Anything else you could use instead of the ${label}?` };
  }
  return {
    kind: 'confirm',
    to: name,
    say: sameRole(q.from, thing)
      ? `${cap(thing)} will work instead of the ${label}. Shall I use ${itOrThem(thing)}?`
      : `I’m not sure ${thing} would do the same job as the ${label} here. Do you want to try ${itOrThem(thing)} anyway?`,
  };
}
