const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

const { normalizeRecipe } = require('../src/recipes/normalize.ts');
const { previewSubstitution, previewRequestsRecipes, substitutionClarification } = require('../src/agent/previewIntent.ts');
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

test('swap follow-ups resolve it against the cheese question and update the current recipe', () => {
  const missing = missingIn("I don't have cheddar cheese", burger);
  const q = missingQuestion(missing.found[0], burger, rules, 'preview');
  for (const phrase of ['swap it with Swiss cheese', 'Can you swap it for Swiss cheese?',
    'replace it with Swiss cheese', 'swap with Swiss cheese', 'switch it to Swiss cheese']) {
    const request = previewSubstitution(phrase, burger, null, q);
    assert.equal(request.ingredient?.id, cheddar.id, phrase);
    assert.equal(request.to, 'swiss cheese', phrase);
    const answer = answerMissing(`use ${request.to}`, q, burger, rules, 'preview');
    assert.equal(answer.kind, 'swap', phrase);
    const plan = adapt(burger, request.ingredient, answer.to);
    assert.deepEqual(plan.violations, []);
    assert.equal(plan.recipe.id, burger.id);
    assert.ok(plan.recipe.ingredients.some((i) => i.name === 'Swiss cheese'));
    assert.ok(!plan.recipe.ingredients.some((i) => i.name === cheddar.name));
    assert.match(plan.recipe.steps.map((s) => s.text).join(' '), /Swiss cheese/i);
  }
});

test('a follow-up uses the ingredient being discussed rather than cheese in the replacement', () => {
  const beef = missingIn("I don't have beef", burger).found[0];
  const q = missingQuestion(beef, burger, rules, 'preview');
  assert.equal(previewSubstitution('swap it with Swiss cheese', burger, null, q).ingredient.id, beef.id);
  for (const phrase of ['swap it with Swiss cheese', 'swap with Swiss cheese']) {
    const unresolved = previewSubstitution(phrase, burger);
    assert.equal(unresolved.ingredient, undefined);
    assert.equal(unresolved.to, 'swiss cheese');
  }
});

test('explicit source names still override the pending question', () => {
  const beef = missingIn("I don't have beef", burger).found[0];
  const q = missingQuestion(beef, burger, rules, 'preview');
  assert.equal(previewSubstitution('replace cheddar with Swiss cheese', burger, null, q).ingredient.id, cheddar.id);
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

test('an unresolved substitution accepts a bare ingredient name on a later turn', () => {
  const request = previewSubstitution('Can you replace the chazzer?', burger);
  assert.equal(request.ingredient, undefined);
  const pending = { recipeId: burger.id, to: request.to };
  for (const phrase of ['cheddar cheese', 'cheddar', 'I meant cheddar cheese', 'the cheddar cheese', "I don't have cheddar cheese"]) {
    assert.equal(previewRequestsRecipes(phrase), false);
    const resolved = previewSubstitution(phrase, burger, pending);
    assert.equal(resolved.ingredient.id, cheddar.id, phrase);
    const q = missingQuestion(resolved.ingredient, burger, rules, 'preview');
    assert.match(q.say, /Do you have another kind of cheese/);
    const selected = answerMissing('Swiss', q, burger, rules, 'preview');
    assert.equal(selected.kind, 'swap');
    const plan = adapt(burger, resolved.ingredient, selected.to);
    assert.equal(plan.recipe.id, burger.id);
    assert.ok(plan.recipe.ingredients.some((i) => i.name === 'Swiss cheese'));
    assert.match(plan.recipe.steps.map((s) => s.text).join(' '), /Swiss cheese/i);
  }
  // A bare name has no special substitution meaning outside the pending conversation.
  assert.equal(previewSubstitution('cheddar cheese', burger), null);
});

test('transcription failures and clarification turns preserve the pending ingredient request', () => {
  let pending = { recipeId: burger.id };
  for (const phrase of ['chazzer', 'Could you repeat?', 'What do you mean?', 'I did not catch that', '']) {
    const unresolved = previewSubstitution(phrase, burger, pending);
    assert.ok(unresolved, phrase);
    assert.equal(unresolved.ingredient, undefined, phrase);
    pending = { recipeId: burger.id, to: unresolved.to };
  }
  assert.equal(previewSubstitution('cheddar cheese', burger, pending).ingredient.id, cheddar.id);
});

test('clarifying an unrecognized source ingredient retains the requested substitute', () => {
  const first = previewSubstitution('Replace chazzer with Swiss', burger);
  assert.equal(first.ingredient, undefined);
  let pending = { recipeId: burger.id, to: first.to };
  const repeat = previewSubstitution('Which ingredient?', burger, pending);
  assert.equal(repeat.ingredient, undefined);
  pending = { recipeId: burger.id, to: repeat.to };
  const resolved = previewSubstitution('cheddar cheese', burger, pending);
  assert.equal(resolved.ingredient.id, cheddar.id);
  assert.equal(resolved.to, 'swiss');
  assert.equal(answerMissing(`use ${resolved.to}`, question(), burger, rules, 'preview').kind, 'swap');
});

test('pending ingredient clarification is scoped to the current recipe', () => {
  const other = recipes.find((r) => r.id !== burger.id);
  assert.equal(previewSubstitution('cheddar cheese', other, { recipeId: burger.id }), null);
});

test('questions about a substitution are distinguished from selecting an alternative', () => {
  for (const phrase of ['What do you mean?', 'Could you repeat?', 'Which cheese?', 'Do you mean cheese?', 'repeat']) {
    assert.equal(substitutionClarification(phrase), true, phrase);
  }
  for (const phrase of ['Swiss cheese', 'what about Swiss?', 'how about provolone?', 'Can I use gouda?']) {
    assert.equal(substitutionClarification(phrase), false, phrase);
  }
});
