// ─────────────────────────────────────────────────────────────
// Text written for the screen, rewritten for the ear: "1½ tbsp" is
// read as "1 and a half tablespoons", "½ tsp" as "half a teaspoon",
// "400°F / 200°C" as "400 degrees Fahrenheit, or 200 degrees Celsius".
// Units are only expanded right after a number, so words like "in"
// and "g" elsewhere are left alone.
// ─────────────────────────────────────────────────────────────

const UNITS: [RegExp, string, string][] = [
  [/tsps?|teaspoons?/, 'teaspoon', 'teaspoons'],
  [/tbsps?|tbs|tbl|tablespoons?/, 'tablespoon', 'tablespoons'],
  [/cups?/, 'cup', 'cups'],
  [/oz|ounces?/, 'ounce', 'ounces'],
  [/fl\.? ?oz/, 'fluid ounce', 'fluid ounces'],
  [/lbs?|pounds?/, 'pound', 'pounds'],
  [/g|grams?|gr/, 'gram', 'grams'],
  [/kg|kilos?|kilograms?/, 'kilogram', 'kilograms'],
  [/mg/, 'milligram', 'milligrams'],
  [/ml|mls|millilit(?:er|re)s?/, 'milliliter', 'milliliters'],
  [/l|lit(?:er|re)s?/, 'liter', 'liters'],
  [/qts?|quarts?/, 'quart', 'quarts'],
  [/pts?|pints?/, 'pint', 'pints'],
  [/mins?|minutes?/, 'minute', 'minutes'],
  [/secs?|seconds?/, 'second', 'seconds'],
  [/hrs?|hours?/, 'hour', 'hours'],
  [/cm/, 'centimeter', 'centimeters'],
  [/mm/, 'millimeter', 'millimeters'],
  [/inch(?:es)?/, 'inch', 'inches'],
];

const FRACTIONS: Record<string, { alone: string; after: string; value: number }> = {
  '½': { alone: 'half a', after: 'and a half', value: 0.5 },
  '¼': { alone: 'a quarter of a', after: 'and a quarter', value: 0.25 },
  '¾': { alone: 'three quarters of a', after: 'and three quarters', value: 0.75 },
  '⅓': { alone: 'a third of a', after: 'and a third', value: 1 / 3 },
  '⅔': { alone: 'two thirds of a', after: 'and two thirds', value: 2 / 3 },
  '⅛': { alone: 'an eighth of a', after: 'and an eighth', value: 0.125 },
};
const SLASH: Record<string, string> = { '1/2': '½', '1/4': '¼', '3/4': '¾', '1/3': '⅓', '2/3': '⅔', '1/8': '⅛' };

const FRAC = Object.keys(FRACTIONS).join('');
const UNIT_ALT = UNITS.map(([re]) => re.source).join('|');
// A number (whole, decimal, with or without a fraction), an optional range ("2-3", "2 to 3"),
// then a unit. A dot after an abbreviation is only taken mid-sentence ("2 tbsp. butter").
const AMOUNT = new RegExp(
  `(?:(\\d+(?:\\.\\d+)?)\\s?)?([${FRAC}])?(?:(?:\\s?[-–]\\s?|\\s+to\\s+)(\\d+(?:\\.\\d+)?)([${FRAC}])?)?\\s?\\b(${UNIT_ALT})\\b(?:\\.(?=\\s+[a-z0-9]))?`,
  'gi',
);

function unitWords(unit: string): [string, string] | null {
  const u = unit.toLowerCase().replace(/\.$/, '');
  const hit = UNITS.find(([re]) => new RegExp(`^(?:${re.source})$`).test(u));
  return hit ? [hit[1], hit[2]] : null;
}

/** "1", "1 and a half", "half a" for an amount; and whether the unit should be plural. */
function spokenAmount(whole: string | undefined, frac: string | undefined): { words: string; plural: boolean } {
  if (!whole && frac) return { words: FRACTIONS[frac].alone, plural: false };
  const n = parseFloat(whole ?? '0');
  if (frac) return { words: `${whole} ${FRACTIONS[frac].after}`, plural: true };
  return { words: whole ?? '', plural: n !== 1 };
}

export function forSpeech(text: string): string {
  let t = text
    // "1 1/2 cups" → "1½ cups", "1/2 tsp" → "½ tsp"
    .replace(/(\d)\s+(1\/2|1\/4|3\/4|1\/3|2\/3|1\/8)\b/g, (_, d: string, f: string) => `${d}${SLASH[f]}`)
    .replace(/(^|[^\d/])(1\/2|1\/4|3\/4|1\/3|2\/3|1\/8)\b/g, (_, pre: string, f: string) => `${pre}${SLASH[f]}`)
    // Temperatures: "400°F / 200°C"
    .replace(/(\d+)\s?°\s?F\s?\/\s?(\d+)\s?°\s?C/gi, '$1 degrees Fahrenheit, or $2 degrees Celsius')
    .replace(/(\d+)\s?°\s?F\b/gi, '$1 degrees Fahrenheit')
    .replace(/(\d+)\s?°\s?C\b/gi, '$1 degrees Celsius')
    .replace(/(\d+)\s?°/g, '$1 degrees');

  t = t.replace(AMOUNT, (match, whole: string | undefined, frac: string | undefined, toWhole: string | undefined, toFrac: string | undefined, unit: string) => {
    if (!whole && !frac) return match; // a bare word like "in" or "c": not an amount
    const names = unitWords(unit);
    if (!names) return match;
    const from = spokenAmount(whole, frac);
    if (toWhole || toFrac) {
      const to = spokenAmount(toWhole, toFrac);
      return `${from.words.replace(/ a$/, '')} to ${to.words} ${to.plural ? names[1] : names[0]}`;
    }
    return `${from.words} ${from.plural ? names[1] : names[0]}`;
  });

  return (
    t
      // Fractions left without a unit: "add ½ of the beans", "1½ times its volume"
      .replace(new RegExp(`(\\d)([${FRAC}])`, 'g'), (_, d: string, f: string) => `${d} ${FRACTIONS[f].after}`)
      .replace(new RegExp(`([${FRAC}])`, 'g'), (f: string) => FRACTIONS[f].alone.replace(/ (of )?a$/, ''))
      // Number ranges: "2–3 minutes" → "2 to 3 minutes"
      .replace(/(\d)\s?[–—-]\s?(\d)/g, '$1 to $2')
      // "a quarter of a inch" → "of an inch"
      .replace(/\b(of|half) a (?=[aeiou])/gi, '$1 an ')
      .replace(/\s{2,}/g, ' ')
  );
}
