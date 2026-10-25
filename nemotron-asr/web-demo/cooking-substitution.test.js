import test from 'node:test';
import assert from 'node:assert/strict';
import { applyIngredientSubstitution } from './cooking.js';

const recipe = {
  ingredients: ['1 cup whole milk', '2 tbsp butter'],
  steps: ['Warm the whole milk gently.', 'Whisk in the butter and simmer.'],
};

test('substitution revises an exact ingredient and affected step without mutating the library recipe', () => {
  const applied = applyIngredientSubstitution(recipe, {
    originalIngredient: '1 cup whole milk', revisedIngredient: '1 cup oat milk',
    revisedSteps: [{ stepNumber: 1, instruction: 'Warm the oat milk gently.' }],
    note: 'Keep the heat low to avoid separation.',
  });
  assert.deepEqual(applied.recipe.ingredients, ['1 cup oat milk', '2 tbsp butter']);
  assert.deepEqual(applied.recipe.steps, ['Warm the oat milk gently.', 'Whisk in the butter and simmer.']);
  assert.match(applied.note, /Substituted 1 cup whole milk with 1 cup oat milk/);
  assert.equal(recipe.ingredients[0], '1 cup whole milk');
  assert.equal(recipe.steps[0], 'Warm the whole milk gently.');
});

test('substitution rejects an ingredient or step that is not in the selected recipe', () => {
  assert.equal(applyIngredientSubstitution(recipe, {
    originalIngredient: '1 cup cream', revisedIngredient: '1 cup oat milk', revisedSteps: [], note: '',
  }), null);
  assert.equal(applyIngredientSubstitution(recipe, {
    originalIngredient: '1 cup whole milk', revisedIngredient: '1 cup oat milk',
    revisedSteps: [{ stepNumber: 3, instruction: 'Heat it.' }], note: '',
  }), null);
});
