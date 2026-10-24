export interface Cuisine {
  id: string;
  name: string;
  emoji: string;
  /** Two colors for the cuisine's thumbnail gradient. */
  colors: [string, string];
}

// The 25 cuisines Gusteau ships with. Recipe records reference these ids;
// a recipe whose cuisine isn't listed still shows up under "All".
export const CUISINES: Cuisine[] = [
  { id: 'italian', name: 'Italian', emoji: '🍝', colors: ['#E2512F', '#F5A54A'] },
  { id: 'mexican', name: 'Mexican', emoji: '🌮', colors: ['#6B7A3A', '#F28C38'] },
  { id: 'chinese', name: 'Chinese', emoji: '🥟', colors: ['#C63F20', '#F5A54A'] },
  { id: 'japanese', name: 'Japanese', emoji: '🍣', colors: ['#2F2D2A', '#E2512F'] },
  { id: 'indian', name: 'Indian', emoji: '🍛', colors: ['#F28C38', '#A1321A'] },
  { id: 'french', name: 'French', emoji: '🥐', colors: ['#4C5729', '#EADBC4'] },
  { id: 'thai', name: 'Thai', emoji: '🍜', colors: ['#6B7A3A', '#E2512F'] },
  { id: 'spanish', name: 'Spanish', emoji: '🥘', colors: ['#C63F20', '#F28C38'] },
  { id: 'greek', name: 'Greek', emoji: '🫒', colors: ['#4C5729', '#8A9A55'] },
  { id: 'korean', name: 'Korean', emoji: '🥢', colors: ['#A1321A', '#2F2D2A'] },
  { id: 'vietnamese', name: 'Vietnamese', emoji: '🍲', colors: ['#8A9A55', '#F5A54A'] },
  { id: 'american', name: 'American', emoji: '🍔', colors: ['#A1321A', '#F5A54A'] },
  { id: 'lebanese', name: 'Lebanese', emoji: '🧆', colors: ['#6B7A3A', '#EADBC4'] },
  { id: 'turkish', name: 'Turkish', emoji: '🥙', colors: ['#C63F20', '#EADBC4'] },
  { id: 'moroccan', name: 'Moroccan', emoji: '🍢', colors: ['#F28C38', '#4C5729'] },
  { id: 'brazilian', name: 'Brazilian', emoji: '🥩', colors: ['#4C5729', '#F5A54A'] },
  { id: 'peruvian', name: 'Peruvian', emoji: '🐟', colors: ['#E2512F', '#8A9A55'] },
  { id: 'caribbean', name: 'Caribbean', emoji: '🍍', colors: ['#F28C38', '#6B7A3A'] },
  { id: 'ethiopian', name: 'Ethiopian', emoji: '🫓', colors: ['#A1321A', '#F28C38'] },
  { id: 'west-african', name: 'West African', emoji: '🍚', colors: ['#C63F20', '#6B7A3A'] },
  { id: 'filipino', name: 'Filipino', emoji: '🍗', colors: ['#2F2D2A', '#F5A54A'] },
  { id: 'indonesian', name: 'Indonesian', emoji: '🍤', colors: ['#A1321A', '#8A9A55'] },
  { id: 'persian', name: 'Persian', emoji: '🍋', colors: ['#6B7A3A', '#F5A54A'] },
  { id: 'german', name: 'German', emoji: '🥨', colors: ['#2F2D2A', '#F28C38'] },
  { id: 'british', name: 'British', emoji: '🥧', colors: ['#4C5729', '#C63F20'] },
];

const BY_ID = new Map(CUISINES.map((c) => [c.id, c]));

export function cuisineById(id: string): Cuisine {
  return BY_ID.get(id) ?? { id, name: id.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase()), emoji: '🍽️', colors: ['#6B6862', '#EADBC4'] };
}

/** Map free text like "West African" or "korean" to a cuisine id. */
export function matchCuisine(text: string): string | null {
  const t = text.toLowerCase();
  const hit = CUISINES.find((c) => t.includes(c.name.toLowerCase()) || t.includes(c.id));
  return hit?.id ?? null;
}
