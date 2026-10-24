const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function integerWords(value) {
  if (value < 20) return ones[value];
  if (value < 100) return tens[Math.floor(value / 10)] + (value % 10 ? ` ${ones[value % 10]}` : '');
  if (value < 1000) return `${ones[Math.floor(value / 100)]} hundred` + (value % 100 ? ` ${integerWords(value % 100)}` : '');
  if (value < 1000000) return `${integerWords(Math.floor(value / 1000))} thousand` + (value % 1000 ? ` ${integerWords(value % 1000)}` : '');
  return String(value).split('').map(digit => ones[Number(digit)]).join(' ');
}

function numberWords(value) {
  const clean = value.replaceAll(',', '');
  const [whole, decimal] = clean.split('.');
  if (!decimal) return integerWords(Number(whole));
  if (decimal === '5') return `${integerWords(Number(whole))} and a half`;
  return `${integerWords(Number(whole))} point ${[...decimal].map(digit => ones[Number(digit)]).join(' ')}`;
}

function fractionWords(numerator, denominator, mixed = false) {
  const count = Number(numerator);
  const unit = { 2: 'half', 3: 'third', 4: 'quarter', 8: 'eighth', 16: 'sixteenth' }[Number(denominator)];
  if (!unit) return `${numberWords(numerator)} over ${numberWords(denominator)}`;
  const fraction = count === 1 ? `${mixed ? 'a ' : ''}${unit}` : `${numberWords(numerator)} ${unit === 'half' ? 'halves' : `${unit}s`}`;
  return fraction;
}

const units = {
  tbsp: ['tablespoon', 'tablespoons'], tbsps: ['tablespoon', 'tablespoons'],
  tsp: ['teaspoon', 'teaspoons'], tsps: ['teaspoon', 'teaspoons'],
  'fl oz': ['fluid ounce', 'fluid ounces'], oz: ['ounce', 'ounces'],
  lb: ['pound', 'pounds'], lbs: ['pound', 'pounds'],
  kg: ['kilogram', 'kilograms'], kgs: ['kilogram', 'kilograms'],
  g: ['gram', 'grams'], gram: ['gram', 'grams'], grams: ['gram', 'grams'], mg: ['milligram', 'milligrams'],
  ml: ['milliliter', 'milliliters'], l: ['liter', 'liters'],
  qt: ['quart', 'quarts'], qts: ['quart', 'quarts'],
  pt: ['pint', 'pints'], pts: ['pint', 'pints'],
  gal: ['gallon', 'gallons'], gals: ['gallon', 'gallons'],
  hr: ['hour', 'hours'], hrs: ['hour', 'hours'],
  min: ['minute', 'minutes'], mins: ['minute', 'minutes'],
  sec: ['second', 'seconds'], secs: ['second', 'seconds'],
};

function expandUnits(text) {
  return text.replace(/\b(fl\.?\s*oz|tbsps?|tsps?|lbs?|oz|kgs?|mg|ml|grams?|g|l|qts?|pts?|gals?|hrs?|mins?|secs?)\b/gi,
    (match, _unit, offset, source) => {
      const key = match.toLowerCase().replaceAll('.', '').replace(/\s+/g, ' ').trim();
      const names = units[key];
      if (!names) return match;
      // A bare "g" or "l" may be an initial; expand it only after a quantity.
      const before = source.slice(0, offset);
      const quantity = before.match(/(?:^|[^\w])((?:\d+\s+)?\d+(?:\/\d+|\.\d+)?(?:\s*[-–]\s*\d+(?:\.\d+)?)?)\s*$/);
      if (!quantity && (key === 'g' || key === 'l' || key === 'mg')) return match;
      const value = quantity?.[1];
      const singular = value && !/[-–]/.test(value) && (Number(value) === 1 || /^0?\.5$/.test(value) || /^\d+\/\d+$/.test(value));
      return names[singular || !value ? 0 : 1];
    });
}

// Keep the recipe and transcript unchanged; only normalize the text sent to Magpie.
export function toSpokenText(text) {
  return expandUnits(text)
    .replace(/\b(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\s*°?\s*([FC])\b/gi,
      (_, low, high, unit) => `${numberWords(low)} to ${numberWords(high)} degrees ${unit.toUpperCase() === 'F' ? 'Fahrenheit' : 'Celsius'}`)
    .replace(/\b(\d+(?:\.\d+)?)\s*°\s*([FC])\b|\b(\d+(?:\.\d+)?)\s*([FC])\b/gi,
      (_, first, firstUnit, second, secondUnit) => `${numberWords(first || second)} degrees ${(firstUnit || secondUnit).toUpperCase() === 'F' ? 'Fahrenheit' : 'Celsius'}`)
    .replace(/\b(\d+)\s+(\d+)\/(\d+)\b/g,
      (_, whole, numerator, denominator) => `${numberWords(whole)} and ${fractionWords(numerator, denominator, true)}`)
    .replace(/\b(\d+)\/(\d+)\b/g, (_, numerator, denominator) => fractionWords(numerator, denominator))
    .replace(/\b(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)\b/g,
      (_, low, high) => `${numberWords(low)} to ${numberWords(high)}`)
    .replace(/\b(\d+(?:\.\d+)?)%/g, (_, value) => `${numberWords(value)} percent`)
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+(?:\.\d+)?\b/g,
      match => numberWords(match));
}
