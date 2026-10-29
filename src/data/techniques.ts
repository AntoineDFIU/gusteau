// ─────────────────────────────────────────────────────────────
// Cooking techniques Gusteau can explain. Steps are matched to a
// technique by their `technique` field or, failing that, by the words
// below. The written how-to is shown and read aloud; short videos are
// searched online for it (see src/services/videos.ts).
// ─────────────────────────────────────────────────────────────

export interface Technique {
  id: string;
  title: string;
  /** Plain-language how-to, two or three sentences. */
  howTo: string;
  match: RegExp;
}

export const TECHNIQUES: Technique[] = [
  {
    id: 'dice',
    title: 'Dicing an onion',
    howTo: 'Halve the onion through the root and peel it. Make close vertical cuts toward the root without cutting through it, then slice across. The root holds everything together while you cut.',
    match: /\b(dice|diced|finely chop)\b.*\bonion|\bonion\b.*\b(dice|diced)\b/,
  },
  {
    id: 'mince',
    title: 'Mincing garlic and ginger',
    howTo: 'Crush the clove under the flat of your knife to loosen the skin. Slice thinly, then rock the knife back and forth over the pile until it is very fine. A pinch of salt helps it break down.',
    match: /\b(mince|minced|grate)\b.*\b(garlic|ginger)\b/,
  },
  {
    id: 'slice-thin',
    title: 'Slicing thinly',
    howTo: 'Curl the fingers of your guiding hand so your knuckles touch the blade. Let the knife do the work in long, smooth strokes and keep the slices even so they cook at the same rate.',
    match: /\b(thinly slice|slice thinly|julienne|matchsticks?)\b/,
  },
  {
    id: 'chop-herbs',
    title: 'Chopping herbs',
    howTo: 'Bunch the leaves tightly and slice through them, then run the knife over the pile once or twice. Chop herbs just before using them so they stay bright.',
    match: /\b(chop|chopped)\b.*\b(cilantro|parsley|basil|mint|dill|herbs)\b/,
  },
  {
    id: 'saute',
    title: 'Sautéing',
    howTo: 'Heat the pan first, then the oil, until it shimmers. Add the food in a single layer and keep it moving. If it steams instead of sizzling, the pan is too crowded.',
    match: /\b(saut[eé]|soften|cook until soft|fry the onions?)\b/,
  },
  {
    id: 'sear',
    title: 'Searing meat',
    howTo: 'Pat the meat dry and season it. Lay it in a very hot, oiled pan and leave it alone until it releases easily and has a deep brown crust, then turn it once.',
    match: /\b(sear|brown the (meat|beef|chicken|lamb|pork))\b/,
  },
  {
    id: 'stir-fry',
    title: 'Stir-frying',
    howTo: 'Have everything cut and ready before you start, because it moves fast. Use high heat, add the slowest-cooking ingredients first, and toss constantly.',
    match: /\b(stir-?fry|wok)\b/,
  },
  {
    id: 'simmer',
    title: 'Simmering',
    howTo: 'Bring the liquid to a boil, then turn the heat down until only small bubbles break the surface now and then. A simmer cooks gently without toughening meat or breaking up vegetables.',
    match: /\bsimmer/,
  },
  {
    id: 'rice',
    title: 'Cooking rice',
    howTo: 'Rinse the rice until the water runs clearer. Cook it covered with the measured water and resist lifting the lid. Let it rest off the heat, then fluff with a fork.',
    match: /\b(rinse|cook|steam)\b.*\brice\b/,
  },
  {
    id: 'pasta',
    title: 'Cooking pasta',
    howTo: 'Use plenty of well-salted, rolling boiling water. Stir in the first minute so it doesn’t stick. Taste a minute before the packet time, and save a mug of the cooking water before draining.',
    match: /\b(pasta|spaghetti|penne|linguine|noodles)\b.*\b(boil|cook)|\b(boil|cook)\b.*\b(pasta|spaghetti|penne|linguine)\b/,
  },
  {
    id: 'whisk',
    title: 'Whisking',
    howTo: 'Tilt the bowl slightly and move the whisk in quick loops, lifting it through the mixture to work in air. Rest a damp towel under the bowl to keep it steady.',
    match: /\bwhisk/,
  },
  {
    id: 'fold',
    title: 'Folding',
    howTo: 'Cut down through the middle with a spatula, sweep along the bottom, and lift up the side while turning the bowl. Stop as soon as no streaks remain, so you keep the air in.',
    match: /\bfold\b(?! (and|in half|over))/,
  },
  {
    id: 'knead',
    title: 'Kneading dough',
    howTo: 'Push the dough away with the heel of your hand, fold it back over itself, and give it a quarter turn. Keep going until it is smooth and springs back when poked.',
    match: /\bknead/,
  },
  {
    id: 'deglaze',
    title: 'Deglazing a pan',
    howTo: 'After browning, pour a splash of liquid into the hot pan and scrape up the browned bits with a wooden spoon. Those bits are where the flavor is.',
    match: /\b(deglaze|scrape up the (brown|browned) bits)\b/,
  },
  {
    id: 'toast-spices',
    title: 'Blooming spices',
    howTo: 'Warm whole or ground spices in hot oil or a dry pan for 30 to 60 seconds, until fragrant. Keep them moving and take them off the heat the moment they darken.',
    match: /\b(toast|bloom|temper)\b.*\b(spices?|cumin|seeds|mustard seeds)\b|\btadka\b/,
  },
  {
    id: 'poach-egg',
    title: 'Cooking eggs in sauce',
    howTo: 'Make small wells in the simmering sauce and crack an egg into each. Cover and cook on low until the whites are fully set and the yolks have thickened.',
    match: /\b(crack|poach)\b.*\beggs?\b.*\b(well|sauce)\b/,
  },
  {
    id: 'tortilla-cups',
    title: 'Making tortilla cups',
    howTo: 'Press a tortilla into a microwave-safe bowl to form a cup. Microwave for 1 to 1½ minutes until it holds its shape; it crisps as it cools.',
    match: /\btortilla cups?\b/,
  },
  {
    id: 'mash',
    title: 'Mashing',
    howTo: 'Work while the food is hot, pressing down with a fork or masher rather than stirring. Stop while there’s still a little texture.',
    match: /\bmash/,
  },
  {
    id: 'marinate',
    title: 'Marinating',
    howTo: 'Coat the food evenly, cover, and chill it. Acidic marinades work fast: 15 to 30 minutes is plenty for fish, a few hours for chicken.',
    match: /\bmarinat/,
  },
  {
    id: 'roll',
    title: 'Rolling and filling',
    howTo: 'Spoon the filling in a line a third of the way from the edge, fold that edge over it, tuck the sides in, and roll firmly toward the far edge.',
    match: /\b(roll up|roll tightly|roll them|fill and roll)\b/,
  },
  {
    id: 'roast',
    title: 'Roasting vegetables',
    howTo: 'Cut pieces the same size, toss them in oil and salt, and spread them out on the tray with space between them. Crowded vegetables steam instead of browning.',
    match: /\broast\b/,
  },
  {
    id: 'shallow-fry',
    title: 'Shallow frying',
    howTo: 'Heat about a centimeter of oil until a crumb sizzles straight away. Fry in batches without crowding, and drain on paper towels.',
    match: /\b(shallow[- ]fry|fry in batches|deep[- ]fry)\b/,
  },
];

const BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));

/** What to search for to see a technique done ("Dicing an onion" → "dice an onion"). */
const SEARCH: Record<string, string> = {
  dice: 'dice an onion',
  mince: 'mince garlic',
  'slice-thin': 'slice vegetables thinly',
  'chop-herbs': 'chop fresh herbs',
  saute: 'saute vegetables',
  sear: 'sear meat in a pan',
  'stir-fry': 'stir fry',
  simmer: 'simmer a sauce',
  rice: 'cook rice',
  pasta: 'cook pasta',
  whisk: 'whisk eggs',
  fold: 'fold ingredients',
  knead: 'knead dough',
  deglaze: 'deglaze a pan',
  'toast-spices': 'bloom spices in oil',
  'poach-egg': 'cook eggs in sauce shakshuka',
  'tortilla-cups': 'make tortilla bowls in the microwave',
  mash: 'mash beans with a fork',
  marinate: 'marinate chicken',
  roll: 'roll a burrito',
  roast: 'roast vegetables',
  'shallow-fry': 'shallow fry',
};
export const techniqueQuery = (t: Technique) => SEARCH[t.id] ?? t.title.toLowerCase();

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
