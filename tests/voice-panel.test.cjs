const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function renderPanel(supported, secure = true, heard = []) {
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/components/VoicePanel.tsx'), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports,
    navigator: { userActivation: { hasBeenActive: true } }, window: { isSecureContext: secure },
    require: (name) => {
      if (name === 'react') return {
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useId: () => 'conversation', useEffect: () => {}, useLayoutEffect: () => {}, useRef: () => ({ current: null }),
      };
      if (name === 'react/jsx-runtime') return require(name);
      if (name.includes('debugLog')) return { useDebugLog: () => ({ heard }) };
      if (name.includes('sound')) return { chime: () => {} };
      if (name.includes('audioDevices')) return {};
      if (name === './GusteauIcon') return { GusteauIcon: () => null };
      if (name === './ui') return { cx: (...parts) => parts.filter(Boolean).join(' ') };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return mod.exports.VoicePanel({
    voice: { supported, handsFree: false, talking: false, notice: '', interim: '' },
    turn: 'waiting', onTalk: () => {}, onStop: () => {},
  });
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(tree) {
  if (typeof tree === 'string') return tree;
  if (!tree || typeof tree !== 'object') return '';
  return [tree.props?.children].flat(Infinity).map(text).join(' ');
}

test('conversation panel and existing messages remain visible without speech recognition', () => {
  const tree = renderPanel(false, true, [{ who: 'gusteau', text: 'Your recipe is ready.', at: 1 }]);
  assert.equal(tree.type, 'section');
  assert.match(text(tree), /Your recipe is ready/);
  assert.match(text(tree), /Voice unavailable/);
  const talk = nodes(tree).find((n) => n.type === 'button' && text(n).includes('Talk to Gusteau'));
  assert.equal(talk.props.disabled, true);
  assert.match(text(tree), /text chat/);
});

test('an insecure connection explains HTTPS without hiding the panel', () => {
  const tree = renderPanel(false, false);
  assert.equal(tree.type, 'section');
  assert.match(text(tree), /HTTPS version/);
  assert.match(text(tree), /Use the message button/);
});

test('supported browsers keep the Talk button available', () => {
  const tree = renderPanel(true);
  const talk = nodes(tree).find((n) => n.type === 'button' && text(n).includes('Talk to Gusteau'));
  assert.equal(talk.props.disabled, false);
  assert.match(text(tree), /Not listening/);
});
