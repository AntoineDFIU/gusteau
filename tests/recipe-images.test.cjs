const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);
const { recipeImageUrl } = require('../src/recipes/imageUrl.ts');

test('bundled photos resolve under the deployment base with or without a trailing page slash', () => {
  for (const image of ['recipes/images/burger.jpg', './recipes/images/burger.jpg', '/recipes/images/burger.jpg']) {
    const resolved = recipeImageUrl(image, '/Gusteau/');
    assert.equal(resolved, '/Gusteau/recipes/images/burger.jpg');
    for (const page of ['https://example.com/Gusteau', 'https://example.com/Gusteau/']) {
      assert.equal(new URL(resolved, page).pathname, '/Gusteau/recipes/images/burger.jpg');
    }
    assert.equal(recipeImageUrl(image, '/'), '/recipes/images/burger.jpg');
  }
});

test('absolute photo URLs and already-prefixed local URLs are preserved', () => {
  for (const image of ['https://example.com/photo.jpg', '//example.com/photo.jpg', 'data:image/png;base64,abcd', '/Gusteau/recipes/images/burger.jpg']) {
    assert.equal(recipeImageUrl(image, '/Gusteau/'), image);
  }
});

test('every bundled recipe photo has a matching file', () => {
  const root = path.join(__dirname, '../public');
  const recipes = JSON.parse(fs.readFileSync(path.join(root, 'recipes/recipes.json'), 'utf8')).recipes;
  for (const recipe of recipes) {
    if (recipe.image && !/^(?:https?:|data:|\/\/)/.test(recipe.image)) {
      assert.ok(fs.existsSync(path.join(root, recipe.image)), `Missing photo for ${recipe.title}: ${recipe.image}`);
    }
  }
});
