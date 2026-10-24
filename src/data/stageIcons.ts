import type { StageIconId } from '../types';

// The supported list of stage icons. A model (or the database) picks an id
// for each cooking stage; the app owns how every icon looks, and any id not
// in this list is replaced during validation.
export const STAGE_ICONS: Record<StageIconId, { label: string; glyph: string }> = {
  prep: { label: 'Prep', glyph: '🧺' },
  chop: { label: 'Chop', glyph: '🔪' },
  mix: { label: 'Mix', glyph: '🥣' },
  marinate: { label: 'Marinate', glyph: '🫙' },
  boil: { label: 'Boil', glyph: '♨️' },
  simmer: { label: 'Simmer', glyph: '🍲' },
  saute: { label: 'Sauté', glyph: '🍳' },
  fry: { label: 'Fry', glyph: '🍤' },
  sear: { label: 'Sear', glyph: '🥩' },
  roast: { label: 'Roast', glyph: '🔥' },
  bake: { label: 'Bake', glyph: '🥧' },
  grill: { label: 'Grill', glyph: '🍢' },
  steam: { label: 'Steam', glyph: '💨' },
  microwave: { label: 'Microwave', glyph: '📟' },
  blend: { label: 'Blend', glyph: '🌀' },
  knead: { label: 'Knead', glyph: '🫓' },
  rest: { label: 'Rest', glyph: '⏳' },
  assemble: { label: 'Assemble', glyph: '🧩' },
  plate: { label: 'Serve', glyph: '🍽️' },
};

export const STAGE_ICON_IDS = Object.keys(STAGE_ICONS) as StageIconId[];

export const isStageIcon = (v: unknown): v is StageIconId => typeof v === 'string' && v in STAGE_ICONS;
