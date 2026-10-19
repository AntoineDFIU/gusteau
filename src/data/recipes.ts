import type { Equipment, PreferenceId, RecipeStep } from '../types';

// ─────────────────────────────────────────────────────────────
// Recipe templates used by the deterministic MOCK planner.
//
// Each template has ingredient "slots" (base, protein, cheese…)
// with ordered alternatives. The planner fills slots from the
// user's confirmed inventory, so swapping an ingredient becomes
// a slot substitution rather than a brand-new recipe. Steps use
// stable keys so completed work survives a replan.
//
// When Nemotron is connected, the model writes recipes itself and
// these templates become the safety-net fallback (see
// services/nebius/nebiusModelService.ts).
// ─────────────────────────────────────────────────────────────

export interface SlotOption {
  key: string;
  perServing: number;
  /** Extra active minutes this option adds (e.g. raw chicken). */
  minutes?: number;
}

export interface Slot {
  role: string;
  label: string;
  required: boolean;
  options: SlotOption[];
}

export interface BuildCtx {
  has: (role: string) => boolean;
  is: (role: string, key: string) => boolean;
  /** Sentence-form amount, e.g. "1 cup of rice", "6 tortillas". */
  q: (role: string) => string;
  /** Short ingredient name, e.g. "black beans". */
  n: (role: string) => string;
  servings: number;
}

export interface RecipeTemplate {
  id: string;
  emoji: string;
  equipment: Equipment;
  difficulty: 'Easy' | 'Medium';
  baseMinutes: number;
  perExtraServing: number;
  tags: PreferenceId[];
  priority: number;
  slots: Slot[];
  title: (c: BuildCtx) => string;
  subtitle: (c: BuildCtx) => string;
  steps: (c: BuildCtx) => (RecipeStep | false)[];
}

export const TEMPLATE_NAMES: Record<string, string> = {
  'microwave-bowl': 'Microwave burrito bowl',
  quesadillas: 'Quesadillas',
  'egg-tacos': 'Scrambled egg tacos',
  'mug-scramble': 'Microwave mug scramble',
  shakshuka: 'Shakshuka-style eggs',
  'fried-rice': 'Garlic fried rice',
  'lemon-chicken': 'Lemon-garlic chicken',
  'enchilada-bake': 'Enchilada bake',
  pasta: 'Lemony spinach pasta',
};

/** "a", "a and b", "a, b and c" */
const list = (parts: (string | false)[]) => {
  const p = parts.filter(Boolean) as string[];
  if (p.length <= 1) return p.join('');
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const TEMPLATES: RecipeTemplate[] = [
  // ── 1. Microwave bowl (the hero of the "no rice" demo) ──────────
  {
    id: 'microwave-bowl',
    emoji: '🥣',
    equipment: 'microwave',
    difficulty: 'Easy',
    baseMinutes: 9,
    perExtraServing: 0.5,
    tags: ['comfort', 'minimal-cleanup', 'cheesy'],
    priority: 1,
    slots: [
      { role: 'base', label: 'bowl base', required: true, options: [{ key: 'rice', perServing: 1 / 3, minutes: 5 }, { key: 'tortillas', perServing: 1 }] },
      { role: 'protein', label: 'protein', required: true, options: [{ key: 'beans', perServing: 0.5 }] },
      { role: 'cheese', label: 'cheese', required: false, options: [{ key: 'cheese', perServing: 0.25 }] },
      { role: 'sauce', label: 'sauce', required: false, options: [{ key: 'salsa', perServing: 2 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'fresh', label: 'fresh topping', required: false, options: [{ key: 'tomatoes', perServing: 0.5 }] },
      { role: 'avocado', label: 'creamy topping', required: false, options: [{ key: 'avocado', perServing: 0.5 }] },
      { role: 'zing', label: 'acid', required: false, options: [{ key: 'lemon', perServing: 0.25 }] },
    ],
    title: (c) =>
      c.is('base', 'rice') ? 'Microwave Rice & Bean Burrito Bowl' : c.has('cheese') ? 'Bean & Cheese Tortilla Bowl' : 'Crispy Tortilla Bean Bowl',
    subtitle: (c) =>
      c.is('base', 'rice')
        ? 'Fluffy rice, warm seasoned beans and melty toppings, all from one microwave.'
        : 'A crisp tortilla cup filled with creamy beans and melted cheese. No rice needed.',
    steps: (c) => [
      {
        key: 'prep-beans',
        title: 'Prep the beans',
        instruction: `Drain and rinse ${c.q('protein')}. Tip them into a microwave-safe bowl with a pinch of salt${c.has('sauce') ? ' and a spoonful of the salsa' : ''}.`,
        uses: ['protein', 'sauce'],
        tip: 'Rinsing removes the starchy canning liquid, so the beans taste cleaner.',
      },
      c.is('base', 'rice') && {
        key: 'cook-rice',
        title: 'Get the rice going',
        instruction: `Rinse ${c.q('base')} and add it to a large microwave-safe bowl with twice as much water. Cover loosely and microwave for 8 minutes, then let it rest covered for 2 minutes.`,
        uses: ['base'],
        timerSeconds: 480,
        tip: 'Use a big bowl. Rice foams up as it cooks.',
      },
      c.is('base', 'tortillas') && {
        key: 'shape-tortillas',
        title: 'Make tortilla bowls',
        instruction: `Press each of the ${c.q('base')} into a microwave-safe cereal bowl so it forms a cup. Microwave one at a time for 1 to 1½ minutes until it holds its shape. It crisps more as it cools.`,
        uses: ['base'],
        timerSeconds: 90,
        tip: 'If the edges puff, just press them down with a spoon once out.',
      },
      (c.has('fresh') || c.has('avocado') || c.has('zing')) && {
        key: 'prep-fresh',
        title: 'Prep the fresh toppings',
        instruction: `${c.is('base', 'rice') ? 'While the rice cooks, ' : ''}${list([c.has('fresh') && `dice ${c.q('fresh')}`, c.has('avocado') && `slice ${c.q('avocado')}`, c.has('zing') && `cut ${c.q('zing')} into wedges`])}.`.replace(/^./, (m) => m.toUpperCase()),
        uses: ['fresh', 'avocado', 'zing'],
      },
      {
        key: 'heat-beans',
        title: 'Heat the beans',
        instruction: `Microwave the beans for 2 minutes. Stir, then mash about a third with a fork for creaminess.${c.has('greens') ? ` Stir in ${c.q('greens')} so it wilts.` : ''}`,
        uses: ['protein', 'greens'],
        timerSeconds: 120,
      },
      {
        key: 'assemble',
        title: c.is('base', 'rice') ? 'Build the bowls' : 'Fill the tortilla bowls',
        instruction: c.is('base', 'rice')
          ? `Fluff the rice with a fork and divide it between ${c.servings} bowl${c.servings > 1 ? 's' : ''}. Spoon the beans on top${c.has('cheese') ? ` and sprinkle with ${c.q('cheese')}` : ''}.`
          : `Spoon the hot beans into the tortilla cups${c.has('cheese') ? ` and top with ${c.q('cheese')}` : ''}.`,
        uses: ['base', 'protein', 'cheese'],
      },
      c.has('cheese') && {
        key: 'melt',
        title: 'Melt it',
        instruction: `Microwave each bowl for 30 to 45 seconds until the cheese is melted${c.is('base', 'tortillas') ? ' and the tortilla edges are crisp' : ''}.`,
        uses: ['cheese'],
        timerSeconds: 45,
      },
      {
        key: 'finish',
        title: 'Finish and serve',
        instruction: `Top with ${list([c.has('sauce') && 'the rest of the salsa', c.has('fresh') && 'diced tomato', c.has('avocado') && 'avocado', c.has('zing') && 'a squeeze of lemon']) || 'a pinch of salt and pepper'}. Taste, season, and dig in.`,
        uses: ['sauce', 'fresh', 'avocado', 'zing'],
      },
    ],
  },

  // ── 2. Quesadillas ────────────────────────────────────────────
  {
    id: 'quesadillas',
    emoji: '🫓',
    equipment: 'stovetop',
    difficulty: 'Easy',
    baseMinutes: 14,
    perExtraServing: 1,
    tags: ['cheesy', 'comfort'],
    priority: 1,
    slots: [
      { role: 'wrap', label: 'tortillas', required: true, options: [{ key: 'tortillas', perServing: 2 }] },
      { role: 'cheese', label: 'cheese', required: true, options: [{ key: 'cheese', perServing: 1 / 3 }] },
      { role: 'protein', label: 'protein', required: false, options: [{ key: 'chicken', perServing: 5, minutes: 10 }, { key: 'beans', perServing: 0.5 }] },
      { role: 'onion', label: 'onion', required: false, options: [{ key: 'onion', perServing: 0.25 }] },
      { role: 'pepper', label: 'pepper', required: false, options: [{ key: 'pepper', perServing: 0.5 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'sauce', label: 'salsa', required: false, options: [{ key: 'salsa', perServing: 3 }] },
      { role: 'fresh', label: 'fresh topping', required: false, options: [{ key: 'tomatoes', perServing: 0.5 }] },
    ],
    title: (c) =>
      `Crispy ${c.is('protein', 'chicken') ? 'Chicken' : c.is('protein', 'beans') ? 'Black Bean' : 'Cheese'}${c.has('greens') ? ' & Spinach' : ''} Quesadillas`,
    subtitle: () => 'Golden, melty and crisp-edged. Weeknight comfort in one skillet.',
    steps: (c) => {
      const sliced = [c.has('onion') && c.q('onion'), c.has('pepper') && c.q('pepper')];
      const hasSliced = sliced.some(Boolean);
      const hasVeg = hasSliced || c.has('greens');
      return [
        c.is('protein', 'chicken') && {
          key: 'cook-chicken',
          title: 'Cook the chicken',
          instruction: `Slice ${c.q('protein')} into thin strips and season with salt and pepper. Cook in a hot, lightly oiled skillet for 6 to 8 minutes until no pink remains, then set aside.`,
          uses: ['protein'],
          timerSeconds: 420,
          tip: 'Safe when the thickest piece reaches 165°F / 74°C.',
        },
        c.is('protein', 'beans') && {
          key: 'prep-beans',
          title: 'Prep the beans',
          instruction: `Drain and rinse ${c.q('protein')}, then lightly mash with a fork and a pinch of salt so they stay put in the quesadillas.`,
          uses: ['protein'],
        },
        hasVeg && {
          key: 'cook-veg',
          title: 'Soften the veg',
          instruction: hasSliced
            ? `Thinly slice ${list(sliced)}, then sauté in a little oil for 3 to 4 minutes until soft.${c.has('greens') ? ` Toss in ${c.q('greens')} to wilt.` : ''}`
            : `Wilt ${c.q('greens')} in a lightly oiled skillet for about 1 minute.`,
          uses: ['onion', 'pepper', 'greens'],
          timerSeconds: hasSliced ? 210 : 60,
        },
        {
          key: 'fill',
          title: 'Fill and fold',
          instruction: `Lay out ${c.q('wrap')}. Scatter cheese over half of each${c.has('protein') || hasVeg ? `, add the ${list([c.has('protein') && c.n('protein'), hasVeg && 'veg'])}, then a little more cheese` : ''}, and fold. You’ll use ${c.q('cheese')} in total.`,
          uses: ['wrap', 'cheese', 'protein'],
        },
        {
          key: 'crisp',
          title: 'Crisp them up',
          instruction: 'Wipe the skillet and cook the quesadillas over medium heat for 2 to 3 minutes per side until golden and the cheese is fully melted.',
          uses: ['wrap', 'cheese'],
          timerSeconds: 300,
          tip: 'Medium heat, not high. You want the cheese melted before the tortilla browns.',
        },
        {
          key: 'finish',
          title: 'Slice and serve',
          instruction: `Rest 1 minute, then slice into wedges. Serve with ${list([c.has('sauce') && 'salsa', c.has('fresh') && 'diced tomato']) || 'whatever dip you love'}.`,
          uses: ['sauce', 'fresh'],
        },
      ];
    },
  },

  // ── 3. Scrambled egg tacos ───────────────────────────────────
  {
    id: 'egg-tacos',
    emoji: '🌮',
    equipment: 'stovetop',
    difficulty: 'Easy',
    baseMinutes: 12,
    perExtraServing: 0.5,
    tags: ['high-protein', 'fresh'],
    priority: 0.5,
    slots: [
      { role: 'eggs', label: 'eggs', required: true, options: [{ key: 'eggs', perServing: 2 }] },
      { role: 'wrap', label: 'tortillas', required: true, options: [{ key: 'tortillas', perServing: 2 }] },
      { role: 'onion', label: 'onion', required: false, options: [{ key: 'onion', perServing: 0.25 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'fresh', label: 'fresh topping', required: false, options: [{ key: 'tomatoes', perServing: 0.5 }] },
      { role: 'cheese', label: 'cheese', required: false, options: [{ key: 'cheese', perServing: 0.25 }] },
      { role: 'sauce', label: 'salsa', required: false, options: [{ key: 'salsa', perServing: 2 }] },
      { role: 'avocado', label: 'creamy topping', required: false, options: [{ key: 'avocado', perServing: 0.5 }] },
    ],
    title: (c) => `Soft Scrambled Egg${c.has('greens') ? ' & Spinach' : ''} Tacos`,
    subtitle: () => 'Silky eggs, warm tortillas, bright toppings. Ready before the kettle boils twice.',
    steps: (c) => [
      (c.has('onion') || c.has('fresh')) && {
        key: 'prep-veg',
        title: 'Chop the veg',
        instruction: `Finely dice ${list([c.has('onion') && c.q('onion'), c.has('fresh') && c.q('fresh')])}.`,
        uses: ['onion', 'fresh'],
      },
      (c.has('onion') || c.has('greens')) && {
        key: 'cook-veg',
        title: 'Soften the veg',
        instruction: `Heat a little oil in a nonstick pan over medium.${c.has('onion') ? ' Cook the onion for 3 minutes.' : ''}${c.has('greens') ? ` Add ${c.q('greens')} and stir until just wilted.` : ''}`,
        uses: ['onion', 'greens'],
        timerSeconds: c.has('onion') ? 180 : 60,
      },
      {
        key: 'scramble',
        title: 'Soft-scramble the eggs',
        instruction: `Whisk ${c.q('eggs')} with a pinch of salt. Turn the heat to low, pour into the pan${c.has('onion') || c.has('greens') ? ' with the veg' : ' with a little oil'} and stir gently for 2 to 3 minutes. Pull them off while still glossy.`,
        uses: ['eggs'],
        timerSeconds: 150,
        tip: 'Eggs keep cooking off the heat. Glossy now means perfect on the plate.',
      },
      {
        key: 'warm-tortillas',
        title: 'Warm the tortillas',
        instruction: `Warm ${c.q('wrap')} in a dry pan for about 30 seconds per side, or wrap in a damp paper towel and microwave for 20 seconds.`,
        uses: ['wrap'],
      },
      {
        key: 'finish',
        title: 'Build the tacos',
        instruction: `Fill the tortillas with egg and top with ${list([c.has('cheese') && 'cheese', c.has('fresh') && 'tomato', c.has('avocado') && 'avocado', c.has('sauce') && 'salsa']) || 'a crack of black pepper'}.`,
        uses: ['cheese', 'fresh', 'avocado', 'sauce'],
      },
    ],
  },

  // ── 4. Microwave mug scramble / wraps ────────────────────────
  {
    id: 'mug-scramble',
    emoji: '☕',
    equipment: 'microwave',
    difficulty: 'Easy',
    baseMinutes: 6,
    perExtraServing: 1,
    tags: ['high-protein', 'minimal-cleanup'],
    priority: 0,
    slots: [
      { role: 'eggs', label: 'eggs', required: true, options: [{ key: 'eggs', perServing: 2 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'cheese', label: 'cheese', required: false, options: [{ key: 'cheese', perServing: 0.25 }] },
      { role: 'fresh', label: 'fresh topping', required: false, options: [{ key: 'tomatoes', perServing: 0.5 }] },
      { role: 'wrap', label: 'tortillas', required: false, options: [{ key: 'tortillas', perServing: 1 }] },
      { role: 'sauce', label: 'salsa', required: false, options: [{ key: 'salsa', perServing: 2 }] },
    ],
    title: (c) => (c.has('wrap') ? `Microwave Egg${c.has('greens') ? ' & Spinach' : ''} Breakfast Wraps` : 'Fluffy Microwave Mug Scramble'),
    subtitle: () => 'Real scrambled eggs in a mug. Two minutes of cooking and one thing to wash.',
    steps: (c) => [
      {
        key: 'whisk',
        title: 'Whisk in the mug',
        instruction: `Grease ${c.servings > 1 ? `${c.servings} large mugs` : 'a large mug'} with a little oil. Crack in ${c.q('eggs')} (2 per mug) with a pinch of salt and whisk with a fork.${c.has('greens') ? ` Tear in ${c.q('greens')}.` : ''}${c.has('cheese') ? ' Stir in half the cheese.' : ''}`,
        uses: ['eggs', 'greens', 'cheese'],
      },
      {
        key: 'microwave-eggs',
        title: 'Microwave in bursts',
        instruction: `Microwave ${c.servings > 1 ? 'one mug' : 'the mug'} for 45 seconds, stir, then 30 to 45 seconds more until just set.${c.servings > 1 ? ' Repeat for each mug.' : ''}`,
        uses: ['eggs'],
        timerSeconds: 90,
        tip: 'Stirring halfway is the secret to fluffy, not rubbery.',
      },
      c.has('wrap') && {
        key: 'warm-tortillas',
        title: 'Warm the tortillas',
        instruction: `Wrap ${c.q('wrap')} in a damp paper towel and microwave for 20 seconds.`,
        uses: ['wrap'],
        timerSeconds: 20,
      },
      {
        key: 'finish',
        title: c.has('wrap') ? 'Wrap and serve' : 'Top and serve',
        instruction: `${c.has('wrap') ? 'Spoon the eggs into the tortillas and top' : 'Top the eggs'} with ${list([c.has('cheese') && 'the remaining cheese', c.has('fresh') && `diced ${c.n('fresh')}`, c.has('sauce') && 'salsa']) || 'a crack of black pepper'}.`,
        uses: ['wrap', 'cheese', 'fresh', 'sauce'],
      },
    ],
  },

  // ── 5. Shakshuka-style eggs ──────────────────────────────────
  {
    id: 'shakshuka',
    emoji: '🍳',
    equipment: 'stovetop',
    difficulty: 'Medium',
    baseMinutes: 22,
    perExtraServing: 1,
    tags: ['comfort', 'fresh', 'high-protein'],
    priority: 0.5,
    slots: [
      { role: 'eggs', label: 'eggs', required: true, options: [{ key: 'eggs', perServing: 2 }] },
      { role: 'tomato', label: 'tomatoes', required: true, options: [{ key: 'tomatoes', perServing: 2 }] },
      { role: 'onion', label: 'onion', required: false, options: [{ key: 'onion', perServing: 0.25 }] },
      { role: 'garlic', label: 'garlic', required: false, options: [{ key: 'garlic', perServing: 1 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'sauce', label: 'salsa', required: false, options: [{ key: 'salsa', perServing: 2 }] },
      { role: 'cheese', label: 'cheese', required: false, options: [{ key: 'cheese', perServing: 0.25 }] },
      { role: 'wrap', label: 'something to dip', required: false, options: [{ key: 'tortillas', perServing: 1 }] },
    ],
    title: (c) => `Skillet Shakshuka-Style Eggs${c.has('greens') ? ' with Spinach' : ''}`,
    subtitle: () => 'Eggs gently poached in a garlicky, jammy tomato sauce. Mop it all up.',
    steps: (c) => {
      const aromatics = c.has('onion') || c.has('garlic');
      return [
        aromatics && {
          key: 'cook-aromatics',
          title: 'Start the base',
          instruction: `${cap(list([c.has('onion') && `dice ${c.q('onion')}`, c.has('garlic') && `slice ${c.q('garlic')}`]))}. Cook in a little oil in a skillet over medium for about 4 minutes until soft and fragrant.`,
          uses: ['onion', 'garlic'],
          timerSeconds: 240,
        },
        {
          key: 'make-sauce',
          title: 'Simmer the tomato sauce',
          instruction: `${aromatics ? '' : 'Heat a little oil in a skillet over medium. '}Chop ${c.q('tomato')} and add them to the pan with a big pinch of salt${c.has('sauce') ? ' and the salsa for a smoky kick' : ''}. Simmer for 7 minutes, mashing as they break down.${c.has('greens') ? ` Stir in ${c.q('greens')} at the end.` : ''}`,
          uses: ['tomato', 'sauce', 'greens'],
          timerSeconds: 420,
        },
        {
          key: 'cook-eggs',
          title: 'Poach the eggs',
          instruction: `Make ${c.servings * 2} little wells in the sauce and crack an egg into each. Cover and cook on low for 5 to 7 minutes until the whites are set.`,
          uses: ['eggs'],
          timerSeconds: 360,
          tip: 'Whites fully set and yolks thickened is the safe, delicious spot.',
        },
        c.has('wrap') && {
          key: 'warm-tortillas',
          title: 'Warm something to dip',
          instruction: `Warm ${c.q('wrap')} in a dry pan or the microwave and cut into wedges for dipping.`,
          uses: ['wrap'],
        },
        {
          key: 'finish',
          title: 'Finish and serve',
          instruction: `${c.has('cheese') ? 'Scatter the cheese over the top, add' : 'Add'} a crack of pepper and serve straight from the pan.`,
          uses: ['cheese'],
        },
      ];
    },
  },

  // ── 6. Garlic fried rice ─────────────────────────────────────
  {
    id: 'fried-rice',
    emoji: '🍚',
    equipment: 'stovetop',
    difficulty: 'Medium',
    baseMinutes: 24,
    perExtraServing: 1,
    tags: ['comfort', 'high-protein'],
    priority: 0.5,
    slots: [
      { role: 'base', label: 'rice', required: true, options: [{ key: 'rice', perServing: 1 / 3 }] },
      { role: 'protein', label: 'protein', required: false, options: [{ key: 'chicken', perServing: 4, minutes: 4 }] },
      { role: 'eggs', label: 'eggs', required: false, options: [{ key: 'eggs', perServing: 1 }] },
      { role: 'garlic', label: 'garlic', required: false, options: [{ key: 'garlic', perServing: 1 }] },
      { role: 'onion', label: 'onion', required: false, options: [{ key: 'onion', perServing: 0.25 }] },
      { role: 'pepper', label: 'pepper', required: false, options: [{ key: 'pepper', perServing: 0.5 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'zing', label: 'acid', required: false, options: [{ key: 'lemon', perServing: 0.25 }] },
    ],
    title: (c) => `${c.has('garlic') ? 'Garlicky' : 'Crispy'} ${c.is('protein', 'chicken') ? 'Chicken' : c.has('eggs') ? 'Egg' : 'Veggie'} Fried Rice`,
    subtitle: () => 'Crispy-edged rice, garlic and a bright squeeze of lemon. Better than takeout.',
    steps: (c) => {
      const diced = [c.has('onion') && c.q('onion'), c.has('pepper') && c.q('pepper')];
      const hasAromatics = diced.some(Boolean) || c.has('garlic');
      return [
        {
          key: 'cook-rice',
          title: 'Cook the rice',
          instruction: `Rinse ${c.q('base')}, then simmer covered with 1½ times its volume of water for 15 minutes. Spread it on a plate to steam dry.`,
          uses: ['base'],
          timerSeconds: 900,
          tip: 'Drier rice fries better. Spreading it out is the shortcut to day-old rice.',
        },
        c.is('protein', 'chicken') && {
          key: 'cook-chicken',
          title: 'Cook the chicken',
          instruction: `While the rice cooks, dice ${c.q('protein')} small, season, and cook in an oiled skillet for 6 to 7 minutes until cooked through. Set aside.`,
          uses: ['protein'],
          timerSeconds: 390,
          tip: 'Safe when the thickest piece reaches 165°F / 74°C.',
        },
        hasAromatics && {
          key: 'cook-veg',
          title: 'Fry the aromatics',
          instruction: `${cap(list([diced.some(Boolean) && `dice ${list(diced)}`, c.has('garlic') && `mince ${c.q('garlic')}`]))}. Fry in oil over medium-high for 2 to 3 minutes.`,
          uses: ['garlic', 'onion', 'pepper'],
          timerSeconds: 150,
        },
        {
          key: 'fry-rice',
          title: 'Fry the rice',
          instruction: `${hasAromatics ? 'Add the rice' : 'Heat a little oil over medium-high and add the rice'}, press it flat and leave it for 1 minute to crisp. Toss, then repeat twice.`,
          uses: ['base'],
          timerSeconds: 180,
        },
        c.has('eggs') && {
          key: 'egg',
          title: 'Scramble in the egg',
          instruction: `Push the rice aside, crack in ${c.q('eggs')}, scramble until just set, then fold through.`,
          uses: ['eggs'],
        },
        {
          key: 'finish',
          title: 'Finish and serve',
          instruction: `${c.is('protein', 'chicken') || c.has('greens') ? `${cap(list([c.is('protein', 'chicken') && 'return the chicken to the pan', c.has('greens') && `toss in ${c.q('greens')} until wilted`]))}. ` : ''}Season with salt${c.has('zing') ? ' and a squeeze of lemon' : ''}.`,
          uses: ['protein', 'greens', 'zing'],
        },
      ];
    },
  },

  // ── 7. Lemon-garlic chicken ──────────────────────────────────
  {
    id: 'lemon-chicken',
    emoji: '🍋',
    equipment: 'stovetop',
    difficulty: 'Medium',
    baseMinutes: 20,
    perExtraServing: 1,
    tags: ['high-protein', 'fresh'],
    priority: 0,
    slots: [
      { role: 'protein', label: 'chicken', required: true, options: [{ key: 'chicken', perServing: 6 }] },
      { role: 'zing', label: 'lemon', required: false, options: [{ key: 'lemon', perServing: 0.5 }] },
      { role: 'garlic', label: 'garlic', required: false, options: [{ key: 'garlic', perServing: 1 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'side', label: 'side', required: false, options: [{ key: 'rice', perServing: 1 / 3, minutes: 12 }] },
    ],
    title: (c) =>
      `${c.has('zing') && c.has('garlic') ? 'Lemon-Garlic' : c.has('zing') ? 'Lemony' : c.has('garlic') ? 'Garlic' : 'Pan-Seared'} Chicken${c.has('greens') ? ' & Spinach' : ''}${c.has('side') ? ' with Rice' : ''}`,
    subtitle: () => 'Golden seared chicken with a glossy pan sauce made in the same skillet.',
    steps: (c) => [
      c.has('side') && {
        key: 'cook-rice',
        title: 'Start the rice',
        instruction: `Rinse ${c.q('side')} and simmer covered with 1½ times its volume of water for 15 minutes.`,
        uses: ['side'],
        timerSeconds: 900,
      },
      {
        key: 'sear-chicken',
        title: 'Sear the chicken',
        instruction: `Pat ${c.q('protein')} dry, season well, and sear in an oiled skillet over medium-high for 5 to 6 minutes per side. Rest it on a plate.`,
        uses: ['protein'],
        timerSeconds: 600,
        tip: 'Safe when the thickest part reaches 165°F / 74°C. Resting keeps it juicy.',
      },
      {
        key: 'pan-sauce',
        title: 'Make the pan sauce',
        instruction: `Lower the heat.${c.has('garlic') ? ` Add ${c.q('garlic')}, thinly sliced, and cook for 30 seconds.` : ''} Pour in ${c.has('zing') ? `the juice of ${c.q('zing')} and ` : ''}a splash of water, then scrape up the browned bits for 1 to 2 minutes.`,
        uses: ['garlic', 'zing'],
      },
      c.has('greens') && {
        key: 'wilt-spinach',
        title: 'Wilt the spinach',
        instruction: `Toss ${c.q('greens')} in the sauce until just wilted.`,
        uses: ['greens'],
      },
      {
        key: 'finish',
        title: 'Slice and serve',
        instruction: `Slice the chicken and spoon the sauce over${c.has('side') ? ', with the rice on the side' : ''}.`,
        uses: ['protein', 'side'],
      },
    ],
  },

  // ── 8. Enchilada bake ────────────────────────────────────────
  {
    id: 'enchilada-bake',
    emoji: '🥘',
    equipment: 'oven',
    difficulty: 'Medium',
    baseMinutes: 35,
    perExtraServing: 1,
    tags: ['comfort', 'cheesy'],
    priority: 0,
    slots: [
      { role: 'wrap', label: 'tortillas', required: true, options: [{ key: 'tortillas', perServing: 2 }] },
      { role: 'protein', label: 'filling', required: true, options: [{ key: 'chicken', perServing: 4, minutes: 10 }, { key: 'beans', perServing: 0.5 }] },
      { role: 'cheese', label: 'cheese', required: true, options: [{ key: 'cheese', perServing: 0.5 }] },
      { role: 'sauce', label: 'sauce', required: true, options: [{ key: 'salsa', perServing: 4 }] },
      { role: 'onion', label: 'onion', required: false, options: [{ key: 'onion', perServing: 0.25 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
    ],
    title: (c) => `Cheesy ${c.is('protein', 'chicken') ? 'Chicken' : 'Bean'} Enchilada Bake`,
    subtitle: () => 'Rolled, sauced, blanketed in cheese and baked until bubbling.',
    steps: (c) => [
      { key: 'preheat', title: 'Preheat the oven', instruction: 'Heat the oven to 400°F / 200°C and lightly oil a baking dish.', uses: [] },
      c.is('protein', 'chicken') && {
        key: 'cook-chicken',
        title: 'Cook the chicken',
        instruction: `Dice ${c.q('protein')} and cook in an oiled pan for 7 to 8 minutes until cooked through.`,
        uses: ['protein'],
        timerSeconds: 450,
        tip: 'Safe when the thickest piece reaches 165°F / 74°C.',
      },
      {
        key: 'filling',
        title: 'Mix the filling',
        instruction: `Combine the ${c.is('protein', 'beans') ? 'drained black beans' : c.n('protein')} with ${list([c.has('onion') && 'diced onion', c.has('greens') && 'chopped spinach', 'half the cheese', 'a few spoons of salsa'])}.`,
        uses: ['protein', 'onion', 'greens', 'cheese'],
      },
      {
        key: 'roll',
        title: 'Roll and sauce',
        instruction: `Fill and roll ${c.q('wrap')} and place them seam-down in the dish. Pour the remaining salsa over the top and cover with the rest of the cheese. You’ll use ${c.q('sauce')} in total.`,
        uses: ['wrap', 'sauce', 'cheese'],
      },
      { key: 'bake', title: 'Bake', instruction: 'Bake for 15 minutes until bubbling and golden at the edges.', uses: [], timerSeconds: 900 },
      { key: 'finish', title: 'Rest and serve', instruction: 'Rest for 3 minutes so it slices cleanly, then serve.', uses: [] },
    ],
  },

  // ── 9. Pasta (only reachable if purchases are allowed or pasta is on hand)
  {
    id: 'pasta',
    emoji: '🍝',
    equipment: 'stovetop',
    difficulty: 'Easy',
    baseMinutes: 20,
    perExtraServing: 0.5,
    tags: ['comfort', 'cheesy'],
    priority: 0,
    slots: [
      { role: 'base', label: 'pasta', required: true, options: [{ key: 'pasta', perServing: 3 }] },
      { role: 'protein', label: 'protein', required: false, options: [{ key: 'chicken', perServing: 4, minutes: 5 }, { key: 'beans', perServing: 0.5 }] },
      { role: 'garlic', label: 'garlic', required: false, options: [{ key: 'garlic', perServing: 1 }] },
      { role: 'greens', label: 'greens', required: false, options: [{ key: 'spinach', perServing: 1 }] },
      { role: 'fresh', label: 'tomatoes', required: false, options: [{ key: 'tomatoes', perServing: 0.5 }] },
      { role: 'zing', label: 'lemon', required: false, options: [{ key: 'lemon', perServing: 0.25 }] },
      { role: 'cheese', label: 'cheese', required: false, options: [{ key: 'cheese', perServing: 0.25 }] },
    ],
    title: (c) => {
      const flavor = c.has('zing') ? 'Lemony' : c.has('garlic') ? 'Garlicky' : c.has('cheese') ? 'Cheesy' : 'Weeknight';
      const stars = [c.is('protein', 'chicken') ? 'Chicken' : c.is('protein', 'beans') ? 'Bean' : '', c.has('greens') ? 'Spinach' : ''].filter(Boolean).join(' & ');
      return `${flavor} ${stars ? `${stars} ` : ''}Pasta`;
    },
    subtitle: () => 'Pasta water turns whatever’s in the pan into a silky sauce in about 20 minutes.',
    steps: (c) => {
      const prep = [c.has('garlic') && `slice ${c.q('garlic')}`, c.has('fresh') && `chop ${c.q('fresh')}`].filter(Boolean) as string[];
      const sizzle = [prep.length > 0 && 'them', c.is('protein', 'beans') && 'the drained beans'];
      return [
        { key: 'boil', title: 'Boil the pasta', instruction: `Cook ${c.q('base')} in well-salted water until al dente. Save a mug of pasta water before draining.`, uses: ['base'], timerSeconds: 600 },
        c.is('protein', 'chicken') && {
          key: 'cook-chicken',
          title: 'Cook the chicken',
          instruction: `Meanwhile, dice ${c.q('protein')} and cook in a little oil for 6 to 7 minutes until cooked through.`,
          uses: ['protein'],
          timerSeconds: 390,
          tip: 'Safe when the thickest piece reaches 165°F / 74°C.',
        },
        {
          key: 'sauce',
          title: 'Build the sauce',
          instruction: `${prep.length ? `${cap(list(prep))}. ` : ''}${sizzle.some(Boolean) ? `In a large pan, sizzle ${list(sizzle)} in a little oil for 2 minutes.` : 'Warm a little oil in a large pan.'} Add the pasta${c.is('protein', 'chicken') ? ', the chicken' : ''} and a splash of pasta water${c.has('greens') ? `, then fold in ${c.q('greens')}` : ''}.`,
          uses: ['garlic', 'fresh', 'greens', 'protein'],
        },
        {
          key: 'finish',
          title: 'Finish and serve',
          instruction: `Toss until glossy, adding more pasta water if it looks dry. Finish with ${list([c.has('zing') && 'a squeeze of lemon', c.has('cheese') && 'the cheese', 'black pepper'])}.`,
          uses: ['zing', 'cheese'],
        },
      ];
    },
  },
];
