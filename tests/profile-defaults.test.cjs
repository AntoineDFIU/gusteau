const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadProfile(saved) {
  let stored = saved === undefined ? null : JSON.stringify(saved);
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/state/profile.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value; } },
    require: () => ({ useState: (initial) => [initial(), () => {}], useCallback: (fn) => fn }),
  });
  return { profile: mod.exports.useProfile().profile, saved: () => JSON.parse(stored) };
}

const defaults = ['american', 'italian', 'mexican', 'chinese', 'french'];
const cuisines = (result) => Array.from(result.profile.favoriteCuisines);

test('a fresh browser starts with all five default cuisines', () => {
  assert.deepEqual(cuisines(loadProfile()), defaults);
});

test('legacy empty favorites migrate and persist without losing other preferences', () => {
  const result = loadProfile({ onboarded: true, favoriteCuisines: [], allergies: ['peanuts'] });
  assert.deepEqual(cuisines(result), defaults);
  assert.deepEqual(Array.from(result.profile.allergies), ['peanuts']);
  assert.deepEqual(result.saved().favoriteCuisines, defaults);
  assert.equal(result.saved().cuisineDefaultsVersion, 1);
});

test('legacy customized favorites remain unchanged', () => {
  assert.deepEqual(cuisines(loadProfile({ favoriteCuisines: ['thai'] })), ['thai']);
});

test('users can save an empty favorites list after migration', () => {
  const result = loadProfile({ favoriteCuisines: [], cuisineDefaultsVersion: 1 });
  assert.deepEqual(cuisines(result), []);
});
