const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

// Load the app's TypeScript directly without adding a test-runner dependency.
require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

const { normalizeRecipe } = require('../src/recipes/normalize.ts');
const { EMPTY_FILTERS, matchesFilters } = require('../src/agent/kitchen.ts');
const { browseByVoice, modelSearch, runSearch } = require('../src/agent/voiceBrowse.ts');
const { NEW_PROFILE } = require('../src/state/profile.ts');
const recipes = JSON.parse(fs.readFileSync(path.join(__dirname, '../public/recipes/recipes.json'), 'utf8'))
  .recipes.map(normalizeRecipe).filter(Boolean);
const search = (query, filters = {}) => recipes.filter((r) => matchesFilters(r, { ...EMPTY_FILTERS, search: query, ...filters }, NEW_PROFILE));
const expected = ['it-aglio-olio', 'us-mac-and-cheese'];
const includesPasta = (results) => expected.forEach((id) => assert.ok(results.some((r) => r.id === id), `Missing ${id}`));

test('search bar finds spaghetti and macaroni by the pasta category', () => {
  includesPasta(search('pasta'));
  assert.ok(!search('pasta').some((r) => /pad thai|ramen|pancit/i.test(r.title)));
});

test('conversational pasta requests list both dishes', () => {
  for (const phrase of ['pasta', 'I want pasta', 'show me pasta recipes']) {
    const result = browseByVoice(phrase, recipes, NEW_PROFILE, EMPTY_FILTERS, []);
    assert.equal(result.kind, 'list', phrase);
    assert.equal(result.generic, undefined);
    includesPasta(result.results);
  }
});

test('model-proposed pasta searches use the same category', () => {
  const spec = modelSearch('I want pasta', { keywords: ['pasta'], cuisine: null, maxMinutes: null, diet: [], equipment: null, refine: false }, NEW_PROFILE);
  const result = runSearch(spec, recipes, NEW_PROFILE, EMPTY_FILTERS);
  assert.equal(result.kind, 'list');
  includesPasta(result.results);
});

test('pasta searches still respect cuisine, time, and diet filters', () => {
  assert.deepEqual(search('pasta', { cuisine: 'italian' }).map((r) => r.id), ['it-aglio-olio']);
  assert.deepEqual(search('pasta', { maxMinutes: 15 }).map((r) => r.id), ['it-aglio-olio']);
  assert.equal(search('pasta', { diet: ['gluten-free'] }).length, 0);
});

test('specific shapes and combined keywords stay specific', () => {
  assert.deepEqual(search('spaghetti').map((r) => r.id), ['it-aglio-olio']);
  assert.deepEqual(search('pasta cheese').map((r) => r.id), ['us-mac-and-cheese']);
});
