import type { Constraints, DetectedIngredient, InventoryItem } from '../../types';

// ─────────────────────────────────────────────────────────────
// MOCK DATA ONLY. Nothing in this file talks to a model.
// Replace with real detections by enabling the Nebius service.
// ─────────────────────────────────────────────────────────────

/** What the mock "vision model" sees in a fridge photo. */
export const MOCK_FRIDGE_DETECTIONS: DetectedIngredient[] = [
  { name: 'Chicken breast', key: 'chicken', confidence: 0.94, quantityNote: '~1 lb pack' },
  { name: 'Eggs', key: 'eggs', confidence: 0.97, quantityNote: '6 eggs' },
  { name: 'Baby spinach', key: 'spinach', confidence: 0.86, quantityNote: 'half a bag' },
  { name: 'Tomatoes', key: 'tomatoes', confidence: 0.91, quantityNote: '3 tomatoes' },
  { name: 'Shredded cheese', key: 'cheese', confidence: 0.82, quantityNote: '' },
  { name: 'Salsa', key: 'salsa', confidence: 0.68, quantityNote: 'jar, half full' },
  { name: 'Lemon', key: 'lemon', confidence: 0.63, quantityNote: '1 lemon' },
];

/** What the mock "vision model" sees in a pantry photo. */
export const MOCK_PANTRY_DETECTIONS: DetectedIngredient[] = [
  { name: 'Rice', key: 'rice', confidence: 0.9, quantityNote: '' },
  { name: 'Canned black beans', key: 'beans', confidence: 0.88, quantityNote: '2 cans' },
  { name: 'Flour tortillas', key: 'tortillas', confidence: 0.84, quantityNote: '8 tortillas' },
  { name: 'Onion', key: 'onion', confidence: 0.79, quantityNote: '' },
  { name: 'Garlic', key: 'garlic', confidence: 0.72, quantityNote: '' },
];

/** The scripted "no rice" demo kitchen. */
export const DEMO_INVENTORY: Omit<InventoryItem, 'id'>[] = [
  { name: 'Rice', key: 'rice', quantityNote: '', source: 'manual' },
  { name: 'Canned black beans', key: 'beans', quantityNote: '1 can', source: 'manual' },
  { name: 'Flour tortillas', key: 'tortillas', quantityNote: '4 tortillas', source: 'manual' },
  { name: 'Shredded cheese', key: 'cheese', quantityNote: '', source: 'manual' },
  { name: 'Salsa', key: 'salsa', quantityNote: '', source: 'manual' },
];

export const DEMO_CONSTRAINTS: Constraints = {
  hardExclusions: ['vegetarian'],
  customExclusions: [],
  preferences: [],
  dislikes: [],
  equipment: ['microwave'],
  timeMinutes: 15,
  servings: 2,
  budget: 10,
  purchasesAllowed: false,
  pantryBasics: true,
};

export const DEFAULT_CONSTRAINTS: Constraints = {
  hardExclusions: [],
  customExclusions: [],
  preferences: [],
  dislikes: [],
  equipment: ['stovetop', 'microwave'],
  timeMinutes: 30,
  servings: 2,
  budget: 10,
  purchasesAllowed: false,
  pantryBasics: true,
};

/** An illustrated "fridge photo" so the demo works with zero files. */
export const SAMPLE_FRIDGE_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="800" height="600">
  <defs>
    <linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#f7f3ea"/><stop offset="1" stop-color="#e9e1d1"/></linearGradient>
  </defs>
  <rect width="400" height="300" rx="18" fill="url(#g)"/>
  <rect x="14" y="14" width="372" height="272" rx="12" fill="#fdfbf6" stroke="#d9cfbd" stroke-width="3"/>
  <rect x="14" y="104" width="372" height="5" fill="#d9cfbd"/>
  <rect x="14" y="194" width="372" height="5" fill="#d9cfbd"/>
  <g font-size="44" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif">
    <text x="34" y="80">🍗</text><text x="104" y="80">🥚</text><text x="174" y="80">🥬</text><text x="244" y="80">🍅</text><text x="314" y="80">🧀</text>
    <text x="34" y="170">🫙</text><text x="104" y="170">🍋</text><text x="174" y="170">🧅</text><text x="244" y="170">🧄</text><text x="314" y="170">🍚</text>
    <text x="64" y="262">🥫</text><text x="154" y="262">🫓</text><text x="244" y="262">🥫</text>
  </g>
</svg>`)}`;
