const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
require.extensions['.ts'] = (mod, file) => mod._compile(compile(fs.readFileSync(file, 'utf8')), file);

test('picker switches provider-specific services and remembers both provider and model', async () => {
  const configs = [
    { provider: 'ollama', label: 'Ollama', textModel: 'qwen', extraBody: { reasoning_effort: 'none' }, available: true },
    { provider: 'nebius', label: 'Nebius', textModel: 'nvidia/nemotron', extraBody: {}, available: true },
  ];
  const requests = [];
  const storage = new Map();
  const mod = { exports: {} };
  class LlmService {
    mode = 'llm';
    constructor(config) { this.config = { ...config }; }
    get textModel() { return this.config.textModel; }
    get label() { return this.config.label; }
    setTextModel(id) { this.config.textModel = id; }
    interpretMessage() { return this.config; }
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/services/index.ts'), 'utf8').replaceAll('import.meta.env.BASE_URL', "'/Gusteau/'");
  vm.runInNewContext(compile(source), {
    module: mod, exports: mod.exports, AbortSignal,
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    require: (name) => name.includes('mockModelService') ? { MockModelService: class {} } : { OpenAICompatModelService: LlmService },
    fetch: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => url.endsWith('/api/config') ? { ...configs[0], providers: configs }
        : { data: [{ id: url.includes('/nebius/') ? 'nvidia/nemotron' : 'qwen' }, { id: 'embed-model' }] } };
    },
  });
  const api = mod.exports;
  await api.initModelService();
  assert.equal(api.modelService.interpretMessage().provider, 'ollama');
  api.chooseModel('nvidia/nemotron', 'nebius');
  assert.equal(api.modelService.interpretMessage().provider, 'nebius');
  assert.equal(api.modelService.interpretMessage().extraBody.reasoning_effort, undefined);
  assert.deepEqual(JSON.parse(storage.get('gusteau.model')), { provider: 'nebius', model: 'nvidia/nemotron' });
  await api.initModelService();
  assert.equal(api.modelService.interpretMessage().provider, 'nebius');
  api.chooseModel('qwen', 'ollama');
  assert.equal(api.modelService.interpretMessage().extraBody.reasoning_effort, 'none');
  await api.listModels('nebius');
  assert.ok(requests.includes('/Gusteau/api/llm/nebius/models'));
  assert.equal(requests.some((url) => url.includes('tokenfactory') || url.includes('11434')), false);
});

test('development provider configuration keeps cloud credentials isolated', () => {
  const mod = { exports: {} };
  vm.runInNewContext(compile(fs.readFileSync(path.join(__dirname, '../server/modelProviders.ts'), 'utf8')), { module: mod, exports: mod.exports });
  const configs = mod.exports.modelProviders({ NEBIUS_API_KEY: 'cloud-secret' }, {
    baseUrl: 'http://mac:11434/v1', apiKey: '', public: { provider: 'ollama', label: 'Ollama', textModel: 'qwen', extraBody: { reasoning_effort: 'none' } },
  });
  assert.equal(configs.ollama.apiKey, '');
  assert.equal(configs.nebius.apiKey, 'cloud-secret');
  assert.equal(configs.nebius.public.extraBody.reasoning_effort, undefined);
  assert.equal(configs.nebius.public.extraBody.chat_template_kwargs.enable_thinking, false);
  assert.equal(JSON.stringify(Object.values(configs).map((p) => p.public)).includes('cloud-secret'), false);
});

test('ordinary and warm-up model calls route to the selected provider', async () => {
  const file = path.join(__dirname, '../src/services/llm/openAICompatModelService.ts');
  const localRequire = createRequire(file);
  const requests = [];
  const warmups = [];
  const mod = { exports: {} };
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/Gusteau/'");
  vm.runInNewContext(compile(source), {
    module: mod, exports: mod.exports, AbortSignal, console,
    require: (name) => name === './chatStream' ? { streamChat: async (options) => { warmups.push(options); return 'OK'; } }
      : name.includes('debugLog') ? { logRequest: () => 1, logResponse: () => {} } : localRequire(name),
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ on_topic: true, action: 'ask', reply: 'What would you like to cook?' }) } }] }) };
    },
  });
  for (const provider of ['nebius', 'ollama']) {
    const service = new mod.exports.OpenAICompatModelService({ provider, label: provider, textModel: 'test', extraBody: provider === 'ollama' ? { reasoning_effort: 'none' } : {} });
    await service.discover('Help me choose dinner', { listed: [], current: '', rules: [], recent: [] });
    assert.equal(requests.at(-1).url, `/Gusteau/api/llm/${provider}/chat/completions`);
    assert.equal(requests.at(-1).body.reasoning_effort, provider === 'ollama' ? 'none' : undefined);
    await service.warmUp();
    assert.equal(warmups.at(-1).provider, provider);
  }
});
