import test from 'node:test';
import assert from 'node:assert/strict';
import { toSpokenText } from './spoken-text.js';

test('speaks recipe quantities and units together', () => {
  assert.equal(
    toSpokenText('Step 1: Add 1 tbsp oil, 2 tsp salt, and 1/2 tsp sugar.'),
    'Step one: Add one tablespoon oil, two teaspoons salt, and half teaspoon sugar.',
  );
  assert.equal(
    toSpokenText('Use 1 1/2 tbsp butter, 8 oz cheese, and 1 lb pasta.'),
    'Use one and a half tablespoons butter, eight ounces cheese, and one pound pasta.',
  );
});

test('speaks temperatures, metric measures, and time ranges', () => {
  assert.equal(
    toSpokenText('Bake at 350°F for 20-25 min; cool 1 hr. Add 250 g flour and 500 ml water.'),
    'Bake at three hundred fifty degrees Fahrenheit for twenty to twenty five minutes; cool one hour. Add two hundred fifty grams flour and five hundred milliliters water.',
  );
});
