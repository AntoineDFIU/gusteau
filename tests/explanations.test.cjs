const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (mod, file) => mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, file);

const { explainRequest, parseIntent } = require('../src/services/mock/intentParser.ts');
const { lookupTerm } = require('../src/services/lookup.ts');

test('explicit definition and appearance questions identify the requested item', () => {
  for (const phrase of ['What is a whisk?', 'What does a whisk look like?',
    'What should a whisk look like?', 'Please tell me what a whisk is',
    'Could you tell me what a whisk looks like?', 'Can you explain what a whisk is?',
    'Show me photos of a whisk', 'Could you show me images of a whisk?',
    'What is a whisk and what does it look like?']) {
    assert.equal(explainRequest(phrase, true), 'whisk', phrase);
  }
});

test('explicit lookup detection leaves recipe searches, cooking commands and substitutions alone', () => {
  for (const phrase of ['show me pad thai', 'show me pasta recipes', "I don't know what to cook",
    'next', 'what is the next step?', 'what are the ingredients?', 'swap it with Swiss cheese',
    'What can I use instead of cheddar?']) {
    assert.equal(explainRequest(phrase, true), null, phrase);
  }
});

test('a definition question takes priority over answering a pending substitution', () => {
  const pendingChoice = { from: 'Cheddar cheese', current: 'Cheddar cheese', options: ['Swiss cheese'], kind: 'cheese' };
  const session = { pendingChoice };
  const result = parseIntent('What is Swiss cheese?', session);
  assert.equal(result.explain, 'swiss cheese');
  assert.deepEqual(result.changes, []);
  assert.equal(session.pendingChoice, pendingChoice);
});

test('a web lookup returns a short definition and image sources for the same item', async () => {
  const previousFetch = global.fetch;
  const requests = [];
  global.fetch = async (url) => {
    requests.push(String(url));
    const media = String(url).includes('/media-list/');
    return {
      ok: true,
      json: async () => media ? { items: [
        { type: 'image', title: 'File:Kitchen whisk.jpg', caption: { text: 'A kitchen whisk' }, srcset: [{ src: '//upload.wikimedia.org/whisk.jpg' }] },
      ] } : { query: {
        normalized: [{ from: 'whisk (utensil)', to: 'Whisk' }],
        pages: [{ title: 'Whisk', extract: 'A whisk is a kitchen utensil used for blending ingredients. It can incorporate air into food. This extra detail should not appear.', fullurl: 'https://en.wikipedia.org/wiki/Whisk' }],
      } },
    };
  };
  try {
    const lookup = await lookupTerm('whisk');
    assert.match(lookup.definition, /kitchen utensil/);
    assert.doesNotMatch(lookup.definition, /extra detail/);
    assert.equal(lookup.images.length, 1);
    assert.equal(lookup.images[0].src, 'https://upload.wikimedia.org/whisk.jpg');
    assert.match(lookup.images[0].page, /commons.wikimedia.org/);
    assert.ok(requests.some((url) => url.includes('/media-list/Whisk')));
  } finally {
    global.fetch = previousFetch;
  }
});
