// ─────────────────────────────────────────────────────────────
// Food-safety lookup PLACEHOLDER.
//
// Future: call Tavily search restricted to trusted domains
// (foodsafety.gov, usda.gov, fda.gov, cdc.gov) and summarize.
// This is general guidance retrieval only. It must never be
// presented as allergy, freshness or contamination verification.
// ─────────────────────────────────────────────────────────────

export interface SafetyResult {
  title: string;
  summary: string;
  source: string;
  url: string;
}

const GENERAL_GUIDANCE: { match: RegExp; result: SafetyResult }[] = [
  {
    match: /chicken|poultry|turkey/,
    result: {
      title: 'Cooking poultry',
      summary: 'General guidance is to cook poultry until the thickest part reaches 165°F (74°C), checked with a food thermometer.',
      source: 'FoodSafety.gov',
      url: 'https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures',
    },
  },
  {
    match: /egg/,
    result: {
      title: 'Cooking eggs',
      summary: 'General guidance is to cook eggs until both yolk and white are firm, and egg dishes to 160°F (71°C).',
      source: 'FoodSafety.gov',
      url: 'https://www.foodsafety.gov/food-safety-charts/safe-minimum-internal-temperatures',
    },
  },
  {
    match: /left ?over|rice|reheat|store|fridge/,
    result: {
      title: 'Leftovers',
      summary: 'General guidance is to refrigerate leftovers within 2 hours and reheat them to 165°F (74°C).',
      source: 'FoodSafety.gov',
      url: 'https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety',
    },
  },
];

export async function lookupFoodSafety(query: string): Promise<SafetyResult[]> {
  await new Promise((r) => setTimeout(r, 600));
  const q = query.toLowerCase();
  const hits = GENERAL_GUIDANCE.filter((g) => g.match.test(q)).map((g) => g.result);
  return hits.length
    ? hits
    : [
        {
          title: 'The 4 steps to food safety',
          summary: 'Clean, separate, cook, chill. A trusted general overview of home food handling.',
          source: 'FoodSafety.gov',
          url: 'https://www.foodsafety.gov/keep-food-safe/4-steps-to-food-safety',
        },
      ];
}
