import test from 'node:test';
import assert from 'node:assert/strict';
import { stepTimers, timerClock, timerSignal } from './step-timers.js';

test('offers timers for minute ranges, hours, seconds, and repeated waits', () => {
  assert.deepEqual(stepTimers('Simmer 6-8 minutes, then rest 30 minutes.'), [
    { seconds: 480, label: 'Simmer · 6-8 minutes' },
    { seconds: 1800, label: 'Rest · 30 minutes' },
  ]);
  assert.deepEqual(stepTimers('Marinate 2 hours. Sear 90 seconds per side.'), [
    { seconds: 7200, label: 'Marinate · 2 hours' },
    { seconds: 90, label: 'Sear · 90 seconds per side' },
  ]);
});

test('ignores relative timing and formats the countdown', () => {
  assert.deepEqual(stepTimers('Cook 1 minute less than the package says.'), []);
  assert.equal(timerClock(65), '1:05');
  assert.equal(timerClock(3661), '1:01:01');
});

test('reminds once at 30 seconds and never after expiry', () => {
  const timer = { deadline: 60000, durationSeconds: 60, reminded: false };
  assert.equal(timerSignal(timer, 29999), null);
  assert.equal(timerSignal(timer, 30000), 'reminder');
  timer.reminded = true;
  assert.equal(timerSignal(timer, 31000), null);
  assert.equal(timerSignal(timer, 60000), 'finished');
  assert.equal(timerSignal({ deadline: 30000, durationSeconds: 30, reminded: false }, 1), null);
  assert.equal(timerSignal({ deadline: 60000, durationSeconds: 60, reminded: false }, 61000), 'finished');
});
