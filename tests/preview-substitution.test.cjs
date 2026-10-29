const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

const { normalizeRecipe } = require('../src/recipes/normalize.ts');
const { previewSubstitution, previewRequestsRecipes } = require('../src/agent/previewIntent.ts');
const { missingIn } = require('../src/agent/discovery.ts');
const { missingQuestion, answerMissing } = require('../src/agent/missing.ts');
const { adaptRecipe } = require('../src/agent/adapt.ts');
const { mergeStages } = require('../src/agent/stages.ts');
const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/recipes/recipes.json'), 'utf8'))
  .recipes.map(normalizeRecipe).filter(Boolean);
const burger = recipes.find((r) => r.id === 'us-cheeseburger');
const cheddar = missingIn("I don't have cheddar", burger).found[0];
const rules = { hardExclusions: [], allergies: [], equipment: ['stovetop'], timeLimit: null, servings: 4 };
const question = () => missingQuestion(cheddar, burger, rules, 'preview');
const adapt = (recipe, ingredient, to) => adaptRecipe(mergeStages(recipe), {
  rules: { ...rules, equipment: [...new Set([...rules.equipment, ...recipe.equipment])] }, pantry: [], basics: true, unavailable: [ingredient.name],
  leaveOut: to ? [] : [ingredient.name], preferredSwaps: to ? [{ from: ingredient.name, to }] : [],
  additions: [], completed: [],
});

test('ingredient requests stay in preview and resolve against the current recipe', () => {
  for (const phrase of ['Can I replace cheddar?', 'What can I use instead of cheddar?',
    'Find a substitute for cheddar', 'Suggest an alternative to cheddar']) {
    assert.equal(previewRequestsRecipes(phrase), false, phrase);
    assert.equal(previewSubstitution(phrase, burger).ingredient.id, cheddar.id, phrase);
  }
  assert.deepEqual(previewSubstitution('Replace truffles', burger), { ingredient: undefined, to: undefined });
});

test('only explicit recipe requests trigger discovery from preview', () => {
  for (const phrase of ['show me pad thai', 'find other recipes', 'search for pasta recipes', "let's make pad thai",
    'show me other recipes instead', 'find another recipe without cheddar']) {
    assert.equal(previewRequestsRecipes(phrase), true, phrase);
  }
  for (const phrase of ["I don't have cheddar", 'Swiss', 'cheese', 'what about the cheese?', "let's cook", "let's make this", 'use Swiss instead']) {
    assert.equal(previewRequestsRecipes(phrase), false, phrase);
  }
});

test('missing cheddar offers practical options and omission without changing the source', () => {
  const q = question();
  assert.match(q.say, /Do you have another kind of cheese/);
  for (const option of ['American cheese', 'Swiss cheese', 'Provolone']) assert.ok(q.options.includes(option));
  assert.match(q.say, /without it/);
  assert.equal(q.core, false);
  assert.ok(burger.ingredients.some((i) => i.id === cheddar.id));
});

test('choosing a cheese updates ingredients and instructions while preserving the recipe', () => {
  for (const phrase of ['I have Swiss', 'use provolone', 'American cheese', 'I have gouda']) {
    const answer = answerMissing(phrase, question(), burger, rules, 'preview');
    assert.equal(answer.kind, 'swap', phrase);
    const plan = adapt(burger, cheddar, answer.to);
    assert.deepEqual(plan.violations, []);
    assert.equal(plan.recipe.id, burger.id);
    assert.ok(plan.recipe.ingredients.some((i) => i.name === answer.to));
    assert.ok(!plan.recipe.ingredients.some((i) => i.name === cheddar.name));
    assert.match(plan.recipe.steps.map((s) => s.text).join(' '), new RegExp(answer.to, 'i'));
  }
});

test('direct replacements use the same selection flow', () => {
  for (const phrase of ['Replace cheddar with Swiss', 'Can I use Swiss instead of cheddar?', 'Substitute Swiss for cheddar']) {
    const request = previewSubstitution(phrase, burger);
    assert.equal(request.ingredient.id, cheddar.id, phrase);
    assert.equal(request.to, 'swiss', phrase);
    assert.equal(answerMissing(`use ${request.to}`, question(), burger, rules, 'preview').kind, 'swap');
  }
});

test('omitting cheddar removes it from the ingredients and the melting instruction', () => {
  assert.equal(answerMissing('leave it out', question(), burger, rules, 'preview').kind, 'drop');
  const plan = adapt(burger, cheddar);
  assert.deepEqual(plan.violations, []);
  assert.ok(!plan.recipe.ingredients.some((i) => /cheddar|cheese/i.test(i.name)));
  assert.doesNotMatch(plan.recipe.steps.map((s) => s.text).join(' '), /top with the cheese/i);
});

test('substitutions respect restrictions and core ingredients still require a replacement', () => {
  const dairyFree = { ...rules, allergies: ['dairy'] };
  assert.deepEqual(missingQuestion(cheddar, burger, dairyFree, 'preview').options, []);
  assert.equal(answerMissing('Swiss cheese', question(), burger, dairyFree, 'preview').kind, 'say');
  const safeQuestion = missingQuestion(cheddar, burger, dairyFree, 'preview');
  assert.equal(answerMissing('Swiss cheese', safeQuestion, burger, dairyFree, 'preview').kind, 'say');
  assert.equal(answerMissing('gouda', safeQuestion, burger, dairyFree, 'preview').kind, 'say');
  const beef = missingIn("I don't have beef", burger).found[0];
  assert.equal(answerMissing('leave it out', missingQuestion(beef, burger, rules, 'preview'), burger, rules, 'preview').kind, 'say');
});

test('a substitute with a different cooking method replaces the original instructions', () => {
  const recipe = recipes.find((r) => r.ingredients.some((i) => /rice/i.test(i.name))
    && r.steps.some((s) => /cook.*rice|rice.*cook/i.test(`${s.title} ${s.text}`)));
  const rice = recipe.ingredients.find((i) => /rice/i.test(i.name));
  const plan = adapt(recipe, rice, 'Couscous');
  assert.deepEqual(plan.violations, []);
  assert.ok(plan.recipe.ingredients.some((i) => i.name === 'Couscous'));
  assert.match(plan.recipe.steps.map((s) => s.text).join(' '), /Cover for 5 minutes, then fluff with a fork/);
  assert.ok(!plan.recipe.steps.some((s) => /cook the rice/i.test(s.title)));
});
