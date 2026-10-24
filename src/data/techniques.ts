// ─────────────────────────────────────────────────────────────
// Curated technique clips. Steps are matched to a technique by
// their `technique` field or, failing that, by the words below.
// Gusteau only surfaces a clip when the current step needs it.
//
// CLIPS ARE PRESELECTED, NEVER SEARCHED LIVE. To add one, set
// `clip` to a short public clip you have checked and are allowed
// to embed, e.g.
//   clip: { kind: 'youtube', id: '<video id>', start: 12, end: 42, credit: 'Channel name' }
//   clip: { kind: 'file', src: 'clips/dice-onion.mp4', credit: 'Gusteau team' }
// ('file' paths are relative to /public). Until then the written
// how-to below is shown on its own.
// ─────────────────────────────────────────────────────────────

export type Clip = { kind: 'youtube'; id: string; start?: number; end?: number; credit: string } | { kind: 'file'; src: string; credit: string };

export interface Technique {
  id: string;
  title: string;
  /** Plain-language how-to, two or three sentences. */
  howTo: string;
  match: RegExp;
  clip: Clip | null;
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'dice',
    title: 'Dicing an onion',
    howTo: 'Halve the onion through the root and peel it. Make close vertical cuts toward the root without cutting through it, then slice across. The root holds everything together while you cut.',
    match: /\b(dice|diced|finely chop)\b.*\bonion|\bonion\b.*\b(dice|diced)\b/,
    clip: null,
  },
  {
    id: 'mince',
    title: 'Mincing garlic and ginger',
    howTo: 'Crush the clove under the flat of your knife to loosen the skin. Slice thinly, then rock the knife back and forth over the pile until it is very fine. A pinch of salt helps it break down.',
    match: /\b(mince|minced|grate)\b.*\b(garlic|ginger)\b/,
    clip: null,
  },
  {
    id: 'slice-thin',
    title: 'Slicing thinly',
    howTo: 'Curl the fingers of your guiding hand so your knuckles touch the blade. Let the knife do the work in long, smooth strokes and keep the slices even so they cook at the same rate.',
    match: /\b(thinly slice|slice thinly|julienne|matchsticks?)\b/,
    clip: null,
  },
  {
    id: 'chop-herbs',
    title: 'Chopping herbs',
    howTo: 'Bunch the leaves tightly and slice through them, then run the knife over the pile once or twice. Chop herbs just before using them so they stay bright.',
    match: /\b(chop|chopped)\b.*\b(cilantro|parsley|basil|mint|dill|herbs)\b/,
    clip: null,
  },
  {
    id: 'saute',
    title: 'Sautéing',
    howTo: 'Heat the pan first, then the oil, until it shimmers. Add the food in a single layer and keep it moving. If it steams instead of sizzling, the pan is too crowded.',
    match: /\b(saut[eé]|soften|cook until soft|fry the onions?)\b/,
    clip: null,
  },
  {
    id: 'sear',
    title: 'Searing meat',
    howTo: 'Pat the meat dry and season it. Lay it in a very hot, oiled pan and leave it alone until it releases easily and has a deep brown crust, then turn it once.',
    match: /\b(sear|brown the (meat|beef|chicken|lamb|pork))\b/,
    clip: null,
  },
  {
    id: 'stir-fry',
    title: 'Stir-frying',
    howTo: 'Have everything cut and ready before you start, because it moves fast. Use high heat, add the slowest-cooking ingredients first, and toss constantly.',
    match: /\b(stir-?fry|wok)\b/,
    clip: null,
  },
  {
    id: 'simmer',
    title: 'Simmering',
    howTo: 'Bring the liquid to a boil, then turn the heat down until only small bubbles break the surface now and then. A simmer cooks gently without toughening meat or breaking up vegetables.',
    match: /\bsimmer/,
    clip: null,
  },
  {
    id: 'rice',
    title: 'Cooking rice',
    howTo: 'Rinse the rice until the water runs clearer. Cook it covered with the measured water and resist lifting the lid. Let it rest off the heat, then fluff with a fork.',
    match: /\b(rinse|cook|steam)\b.*\brice\b/,
    clip: null,
  },
  {
    id: 'pasta',
    title: 'Cooking pasta',
    howTo: 'Use plenty of well-salted, rolling boiling water. Stir in the first minute so it doesn’t stick. Taste a minute before the packet time, and save a mug of the cooking water before draining.',
    match: /\b(pasta|spaghetti|penne|linguine|noodles)\b.*\b(boil|cook)|\b(boil|cook)\b.*\b(pasta|spaghetti|penne|linguine)\b/,
    clip: null,
  },
  {
    id: 'whisk',
    title: 'Whisking',
    howTo: 'Tilt the bowl slightly and move the whisk in quick loops, lifting it through the mixture to work in air. Rest a damp towel under the bowl to keep it steady.',
    match: /\bwhisk/,
    clip: null,
  },
  {
    id: 'fold',
    title: 'Folding',
    howTo: 'Cut down through the middle with a spatula, sweep along the bottom, and lift up the side while turning the bowl. Stop as soon as no streaks remain, so you keep the air in.',
    match: /\bfold\b(?! (and|in half|over))/,
    clip: null,
  },
  {
    id: 'knead',
    title: 'Kneading dough',
    howTo: 'Push the dough away with the heel of your hand, fold it back over itself, and give it a quarter turn. Keep going until it is smooth and springs back when poked.',
    match: /\bknead/,
    clip: null,
  },
  {
    id: 'deglaze',
    title: 'Deglazing a pan',
    howTo: 'After browning, pour a splash of liquid into the hot pan and scrape up the browned bits with a wooden spoon. Those bits are where the flavor is.',
    match: /\b(deglaze|scrape up the (brown|browned) bits)\b/,
    clip: null,
  },
  {
    id: 'toast-spices',
    title: 'Blooming spices',
    howTo: 'Warm whole or ground spices in hot oil or a dry pan for 30 to 60 seconds, until fragrant. Keep them moving and take them off the heat the moment they darken.',
    match: /\b(toast|bloom|temper)\b.*\b(spices?|cumin|seeds|mustard seeds)\b|\btadka\b/,
    clip: null,
  },
  {
    id: 'poach-egg',
    title: 'Cooking eggs in sauce',
    howTo: 'Make small wells in the simmering sauce and crack an egg into each. Cover and cook on low until the whites are fully set and the yolks have thickened.',
    match: /\b(crack|poach)\b.*\beggs?\b.*\b(well|sauce)\b/,
    clip: null,
  },
  {
    id: 'tortilla-cups',
    title: 'Making tortilla cups',
    howTo: 'Press a tortilla into a microwave-safe bowl to form a cup. Microwave for 1 to 1½ minutes until it holds its shape; it crisps as it cools.',
    match: /\btortilla cups?\b/,
    clip: null,
  },
  {
    id: 'mash',
    title: 'Mashing',
    howTo: 'Work while the food is hot, pressing down with a fork or masher rather than stirring. Stop while there’s still a little texture.',
    match: /\bmash/,
    clip: null,
  },
  {
    id: 'marinate',
    title: 'Marinating',
    howTo: 'Coat the food evenly, cover, and chill it. Acidic marinades work fast: 15 to 30 minutes is plenty for fish, a few hours for chicken.',
    match: /\bmarinat/,
    clip: null,
  },
  {
    id: 'roll',
    title: 'Rolling and filling',
    howTo: 'Spoon the filling in a line a third of the way from the edge, fold that edge over it, tuck the sides in, and roll firmly toward the far edge.',
    match: /\b(roll up|roll tightly|roll them|fill and roll)\b/,
    clip: null,
  },
  {
    id: 'roast',
    title: 'Roasting vegetables',
    howTo: 'Cut pieces the same size, toss them in oil and salt, and spread them out on the tray with space between them. Crowded vegetables steam instead of browning.',
    match: /\broast\b/,
    clip: null,
  },
  {
    id: 'shallow-fry',
    title: 'Shallow frying',
    howTo: 'Heat about a centimeter of oil until a crumb sizzles straight away. Fry in batches without crowding, and drain on paper towels.',
    match: /\b(shallow[- ]fry|fry in batches|deep[- ]fry)\b/,
    clip: null,
  },
];

const BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));

export const techniqueById = (id?: string) => (id ? BY_ID.get(id) : undefined);

/** Pick the technique a step needs, if any. */
export function techniqueFor(step: { technique?: string; title: string; text: string }): Technique | undefined {
  if (step.technique) return BY_ID.get(step.technique);
  const t = `${step.title}. ${step.text}`.toLowerCase();
  return TECHNIQUES.find((x) => x.match.test(t));
}

/** "how do I fold?" → the folding technique. */
export function techniqueFromQuestion(q: string): Technique | undefined {
  const t = q.toLowerCase().replace(/é/g, 'e');
  // Stem the id so "dicing" finds "dice" and "stir frying" finds "stir-fry".
  return TECHNIQUES.find((x) => new RegExp(`\\b${x.id.replace('-', '[- ]?').replace(/e$/, '')}`).test(t));
}
