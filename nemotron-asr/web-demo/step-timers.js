const wordNumbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40,
  fortyfive: 45, sixty: 60 };
const amount = '(?:\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|sixty)';
const durationPattern = new RegExp(`\\b(${amount})(?:\\s*[-–]\\s*(${amount}))?\\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\\b`, 'gi');

function numberOf(value) {
  return wordNumbers[value.toLowerCase()] ?? Number(value);
}

function timerAction(instruction, offset) {
  const before = instruction.slice(0, offset);
  const clause = before.split(/[.;!?]|,\s*|\bthen\b/i).at(-1)
    .replace(/^\s*(?:and|or|next)\s+/i, '').trim();
  const words = clause.split(/\s+/).filter(Boolean);
  const concise = words.slice(-7).join(' ').replace(/\b(?:for|about|approximately|at least)\s*$/i, '').trim();
  return concise ? concise[0].toUpperCase() + concise.slice(1) : 'Wait';
}

export function stepTimers(instruction) {
  const timers = [];
  for (const match of instruction.matchAll(durationPattern)) {
    const after = instruction.slice(match.index + match[0].length, match.index + match[0].length + 22);
    if (/^\s+less\s+than\b/i.test(after)) continue;
    const unit = /^h/i.test(match[3]) ? 'hour' : /^m/i.test(match[3]) ? 'minute' : 'second';
    const multiplier = unit === 'hour' ? 3600 : unit === 'minute' ? 60 : 1;
    const value = Math.max(numberOf(match[1]), match[2] ? numberOf(match[2]) : 0);
    const seconds = Math.round(value * multiplier);
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 24 * 3600) continue;
    const perSide = /^\s+per\s+side\b/i.test(after);
    timers.push({ seconds, label: `${timerAction(instruction, match.index)} · ${match[0]}${perSide ? ' per side' : ''}` });
  }
  return timers;
}

export function timerClock(seconds) {
  const remaining = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor(remaining % 3600 / 60);
  const secs = remaining % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function timerSignal(timer, now) {
  if (now >= timer.deadline) return 'finished';
  if (!timer.reminded && timer.durationSeconds > 30 && now >= timer.deadline - 30000) return 'reminder';
  return null;
}
