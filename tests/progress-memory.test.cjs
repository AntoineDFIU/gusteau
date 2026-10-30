const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const transpile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
require.extensions['.ts'] = (mod, file) => mod._compile(transpile(fs.readFileSync(file, 'utf8')), file);

const { rememberStep, progressMemoryContext, isRecallQuestion, recallAnswer } = require('../src/agent/progressMemory.ts');
const { parseIntent } = require('../src/services/mock/intentParser.ts');
function session() {
  const ingredients = [{ id: 'cheese', name: 'Swiss cheese', amount: 4, unit: 'slices' }];
  const steps = [
    { key: 'sear', title: 'Sear the patties', text: 'Sear the patties for 3 minutes.', uses: [], timerSeconds: 180 },
    { key: 'melt', title: 'Melt the cheese', text: 'Top the patties with Swiss cheese and cook for 2 minutes.', uses: ['cheese'], timerSeconds: 120 },
    { key: 'serve', title: 'Serve the burgers', text: 'Serve with buns.', uses: [] },
  ];
  const recipe = { title: 'Classic Cheeseburger', ingredients, steps, equipment: ['stovetop'] };
  return {
    original: recipe, recipe, stepIndex: 0, stepMemory: [], completedStepKeys: [],
    rules: { hardExclusions: [], allergies: [], equipment: ['stovetop'], timeLimit: null, servings: 4 },
    pantry: [], pantryBasics: true, unavailable: [], leaveOut: [], preferredSwaps: [], additions: [],
    substitutions: [], history: [], chat: [], timers: [], paused: false,
  };
}

test('confirmed steps retain original instructions and ingredient quantities across later plan edits', () => {
  const s = session();
  s.stepIndex = 1;
  s.stepMemory = rememberStep(s, 'completed');
  s.recipe.steps[1].text = 'Now use provolone instead.';
  s.recipe.ingredients[0].name = 'Provolone';
  s.recipe.ingredients[0].amount = 8;
  s.recipe.steps[1].uses.push('extra');
  const remembered = s.stepMemory[0];
  assert.match(remembered.step.text, /Swiss cheese/);
  assert.equal(remembered.ingredients[0].name, 'Swiss cheese');
  assert.equal(remembered.ingredients[0].amount, 4);
  assert.deepEqual(remembered.step.uses, ['cheese']);
});

test('earlier confirmations and old user messages stay available beyond six chat messages', () => {
  const s = session();
  s.stepMemory = rememberStep(s, 'completed');
  s.chat = [{ from: 'user', text: 'I used Swiss cheese and seared for four minutes.' },
    ...Array.from({ length: 12 }, (_, i) => ({ from: 'gusteau', text: `Later message ${i}` }))];
  s.stepIndex = 2;
  const context = progressMemoryContext(s);
  assert.equal(context.confirmedSteps[0].step.timerSeconds, 180);
  assert.equal(context.conversation.length, 13);
  assert.match(context.conversation[0].text, /four minutes/);
});

test('reviewing an earlier step does not erase the remembered confirmation', () => {
  const s = session();
  s.stepIndex = 1;
  s.stepMemory = rememberStep(s, 'completed');
  s.stepIndex = 0;
  s.completedStepKeys = [];
  assert.match(recallAnswer('What did I use in step two?', s), /4 slices Swiss cheese/);
});

test('skipped and navigation-only steps are never reported as confirmed accomplishments', () => {
  const s = session();
  s.completedStepKeys = ['sear'];
  assert.match(recallAnswer('What did I do in step one?', s), /haven’t confirmed/);
  s.stepMemory = rememberStep(s, 'skipped');
  assert.match(recallAnswer('What did I do in step one?', s), /skip step 1/);
  assert.match(recallAnswer('What did I do in step two?', s), /don’t have a confirmed/);
});

test('recall questions return history rather than the current step and propose no actions', () => {
  const s = session();
  s.stepMemory = rememberStep(s, 'completed');
  s.stepIndex = 2;
  for (const question of ['What did I do in step 1?', 'How long did I sear the patties earlier?', 'What have we done so far?']) {
    assert.equal(isRecallQuestion(question), true);
    const answer = parseIntent(question, s);
    assert.match(answer.reply, /sear/i);
    assert.deepEqual(answer.changes, []);
    assert.equal(answer.command, undefined);
    assert.equal(s.stepIndex, 2);
  }
  for (const message of ['next', 'go to step 1', 'I finished searing the patties', 'What is a whisk?']) {
    assert.equal(isRecallQuestion(message), false, message);
  }
});

test('LLM recall receives full confirmed history and cannot navigate or start timers', async () => {
  const file = path.join(__dirname, '../src/services/llm/openAICompatModelService.ts');
  const localRequire = createRequire(file);
  let request;
  const mod = { exports: {} };
  const source = fs.readFileSync(file, 'utf8').replaceAll('import.meta.env.BASE_URL', "'/'");
  vm.runInNewContext(transpile(source), {
    exports: mod.exports, module: mod, AbortSignal, console,
    require: (name) => name === './chatStream' ? { streamChat: async (input) => {
      request = input;
      return JSON.stringify({ reply: 'You confirmed searing the patties.', changes: [], step: 1, timer_seconds: 180 });
    } } : localRequire(name),
  });
  const service = new mod.exports.OpenAICompatModelService({ provider: 'test', label: 'Test', textModel: 'test' });
  const s = session();
  s.stepMemory = rememberStep(s, 'completed');
  s.stepIndex = 2;
  s.chat = [{ from: 'user', text: 'I actually seared for four minutes.' },
    ...Array.from({ length: 10 }, () => ({ from: 'gusteau', text: 'Later message.' }))];
  const result = await service.interpretMessage('How long did I sear the patties earlier?', s);
  assert.ok(request, 'Recall should reach the LLM with the session history');
  const context = request.messages[1].content;
  assert.match(context, /Sear the patties for 3 minutes/);
  assert.match(context, /I actually seared for four minutes/);
  assert.equal(result.goToStep, undefined);
  assert.equal(result.timerSeconds, undefined);
  assert.equal(result.changes.length, 0);
});
