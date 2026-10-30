const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

test('production speech discovery uses the deployed base path', async () => {
  const requests = [];
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/voice/nemotronAsr.ts'), 'utf8')
    .replaceAll('import.meta.env.BASE_URL', "'/Gusteau/'");
  vm.runInNewContext(compile(source), {
    module: mod, exports: mod.exports, AbortSignal,
    require: () => ({}),
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.endsWith('/health') ? { status: 'ok' } : {
        data: [{ id: 'nemotron', capability: 'transcription' }, { id: 'magpie', capability: 'speech', voices: ['Jason'], languages: ['en-US'] }],
      } };
    },
  });
  const info = await mod.exports.checkAsrServer();
  assert.deepEqual(requests, ['/Gusteau/api/asr/health', '/Gusteau/api/asr/v1/models']);
  assert.equal(info.model, 'nemotron');
  assert.equal(info.tts.model, 'magpie');
});

test('Firefox without browser speech recognition discovers and starts Nemotron', async () => {
  const slots = [];
  let cursor = 0;
  let effects = [];
  let probes = 0;
  let starts = 0;
  let browserStarts = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const hooks = {
    useRef: (value) => { const at = cursor++; return slots[at] ??= { current: value }; },
    useState: (initial) => {
      const at = cursor++;
      slots[at] ??= { value: initial };
      return [slots[at].value, (value) => { slots[at].value = value; }];
    },
    useCallback: (fn, deps) => {
      const at = cursor++;
      if (!same(slots[at]?.deps, deps)) slots[at] = { fn, deps };
      return slots[at].fn;
    },
    useEffect: (fn, deps) => {
      const at = cursor++;
      if (!same(slots[at], deps)) { slots[at] = deps; effects.push(fn); }
    },
  };
  const browser = { supported: false, state: 'unsupported', handsFree: false, setHandsFree: () => { browserStarts++; } };
  const mod = { exports: {} };
  const source = fs.readFileSync(path.join(__dirname, '../src/voice/useVoice.ts'), 'utf8');
  vm.runInNewContext(compile(source), {
    module: mod, exports: mod.exports, navigator: { mediaDevices: { getUserMedia: () => {} } }, window: { setTimeout },
    require: (name) => {
      if (name === 'react') return hooks;
      if (name === './useSpeech') return { speechSupported: false, ttsSupported: false, useSpeech: () => browser };
      if (name === './nemotronAsr') return {
        checkAsrServer: async () => { probes++; return { model: 'nemotron' }; },
        startAsr: async () => { starts++; return { setMuted: () => {}, cancel: () => {} }; },
      };
      if (name === './voiceOut') return { VoiceOut: class { kind = 'off'; setEngine() {} stop() {} } };
      if (name.includes('debugLog')) return {};
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = () => {
    cursor = 0;
    const voice = mod.exports.useVoice(() => {});
    const pending = effects;
    effects = [];
    pending.forEach((fn) => fn());
    return voice;
  };
  assert.equal(render().supported, true);
  await Promise.resolve();
  const voice = render();
  assert.equal(probes, 1);
  assert.equal(voice.engine, 'nemotron');
  await voice.setHandsFree(true);
  assert.equal(starts, 1);
  assert.equal(browserStarts, 0);
});
