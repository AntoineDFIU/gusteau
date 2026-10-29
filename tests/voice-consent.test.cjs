const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the output controller with a fake speaker so tests never play audio.
function setup() {
  const spoken = [];
  let speakers = 0;
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/voice/voiceOut.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    exports: mod.exports, module: mod,
    require: (name) => {
      if (name.includes('stepSpeech')) return { speakable: (text) => text };
      if (name === './speaker') return {
        takeSentences: (text) => ({ sentences: [text.trim()], rest: '' }),
        createSpeaker: () => {
          speakers++;
          return { say: (text) => { if (text.trim()) spoken.push(text); }, finish: () => Promise.resolve(), cancel: () => {} };
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const voice = new mod.exports.VoiceOut(() => {}, () => {});
  voice.setEngine({ kind: 'browser' });
  return { voice, spoken, speakerCount: () => speakers };
}

test('replies and streamed responses stay silent until speech is explicitly enabled', async () => {
  const { voice, spoken, speakerCount } = setup();
  voice.say('Recipe preview.');
  voice.say('Ingredient adjustment.', true);
  const stream = voice.stream();
  stream.push('Here is your answer.');
  stream.say('Cooking step.');
  await stream.finish();
  await Promise.resolve();
  assert.deepEqual(spoken, []);
  assert.equal(speakerCount(), 0);
  voice.setEnabled(true);
  stream.push('Old silent content must not replay.');
  await stream.finish();
  assert.deepEqual(spoken, []);
});

test('Talk enables new replies without replaying silent messages', async () => {
  const { voice, spoken } = setup();
  voice.say('Silent preview introduction.');
  voice.setEnabled(true);
  voice.say('Hello, how can I help?');
  await Promise.resolve();
  assert.deepEqual(spoken, ['Hello, how can I help?']);
});

test('Stop cancels queued replies and blocks late stream updates even after restarting', async () => {
  const { voice, spoken } = setup();
  voice.setEnabled(true);
  voice.say('Queued reply.');
  voice.setEnabled(false);
  await Promise.resolve();
  assert.deepEqual(spoken, []);
  voice.setEnabled(true);
  const oldStream = voice.stream();
  oldStream.push('First sentence.');
  voice.setEnabled(false);
  voice.setEnabled(true);
  oldStream.push('First sentence. Late sentence.');
  oldStream.say('Another late sentence.');
  await oldStream.finish();
  assert.deepEqual(spoken, ['First sentence.']);
  voice.say('New conversation.');
  await Promise.resolve();
  assert.deepEqual(spoken, ['First sentence.', 'New conversation.']);
});
