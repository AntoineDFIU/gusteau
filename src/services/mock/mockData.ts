import type { CookRules } from '../../types';

// ─────────────────────────────────────────────────────────────
// MOCK DATA ONLY. Nothing in this file talks to a model.
// ─────────────────────────────────────────────────────────────

export const DEMO_RECIPE_ID = 'mx-microwave-burrito-bowl';

export const DEMO_RULES: CookRules = {
  hardExclusions: ['vegetarian'],
  allergies: [],
  equipment: ['microwave'],
  timeLimit: 15,
  servings: 2,
};

/** An illustrated "fridge photo" so the photo path works with zero files. */
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
    <text x="64" y="262">🥫</text><text x="154" y="262">🫓</text><text x="244" y="262">🍝</text>
  </g>
</svg>`)}`;
