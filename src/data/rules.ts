import type { DietRuleId, DietTag, Difficulty, Equipment } from '../types';

export const DIET_RULES: Record<DietRuleId, { label: string; blocks: DietTag[]; short: string }> = {
  vegetarian: { label: 'Vegetarian', blocks: ['meat', 'poultry', 'fish', 'shellfish'], short: 'No meat or fish' },
  vegan: { label: 'Vegan', blocks: ['meat', 'poultry', 'fish', 'shellfish', 'dairy', 'egg'], short: 'No animal products' },
  pescatarian: { label: 'Pescatarian', blocks: ['meat', 'poultry'], short: 'Fish, no meat' },
  'dairy-free': { label: 'Dairy-free', blocks: ['dairy'], short: 'No milk or cheese' },
  'gluten-free': { label: 'Gluten-free', blocks: ['gluten'], short: 'No wheat or gluten' },
  'egg-free': { label: 'Egg-free', blocks: ['egg'], short: 'No eggs' },
  'nut-free': { label: 'Nut-free', blocks: ['nut'], short: 'No nuts' },
  'shellfish-free': { label: 'Shellfish-free', blocks: ['shellfish'], short: 'No shellfish' },
};

export const DIET_RULE_IDS = Object.keys(DIET_RULES) as DietRuleId[];

export const EQUIPMENT: Record<Equipment, { label: string; emoji: string }> = {
  stovetop: { label: 'Stovetop', emoji: '🍳' },
  oven: { label: 'Oven', emoji: '🔥' },
  microwave: { label: 'Microwave', emoji: '📟' },
  blender: { label: 'Blender', emoji: '🌀' },
  grill: { label: 'Grill', emoji: '🍢' },
};

export const EQUIPMENT_IDS = Object.keys(EQUIPMENT) as Equipment[];

export const DIFFICULTIES: Difficulty[] = ['Easy', 'Medium', 'Hard'];

/** Words in a step that reveal which appliance it really needs. */
export const EQUIPMENT_WORDS: [Equipment, RegExp][] = [
  ['stovetop', /\b(stove|stovetop|skillet|frying pan|saucepan|sauté pan|saute pan|pot|wok|hob|burner|simmer|boil)\b/],
  ['oven', /\b(oven|bake|baking|broil|roast(?:ing)? in)\b/],
  ['microwave', /\bmicrowave\b/],
  ['blender', /\b(blender|blend|food processor|purée|puree)\b/],
  ['grill', /\b(grill|barbecue|bbq|charcoal)\b/],
];
