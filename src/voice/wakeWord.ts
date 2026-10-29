// ─────────────────────────────────────────────────────────────
// "Hey Gusteau" / "Hey Chef" at the start of something said to him.
// There's no wake word: conversations start with Talk to Gusteau, and the
// mic is only open during one (App.tsx). A cook may still address him by
// name ("Hey Chef, what's next?"), so the name is found here and dropped.
//
// Speech recognition rarely spells "Gusteau" right, so the ways
// Nemotron and the browser actually write it count too: "Hei Gusta",
// "Hei Güsto", "Heigus sto", "Eigus tow", "Heichef", "Hechef", "hey gusto", "hey jeff", "hey chief".
// ─────────────────────────────────────────────────────────────

// Every way it's been written: gusteau(x), gusto, gustoe, gustow, gustau, gusta, gustav(o), and split
// ("gus toe", "gus sto", "gus stoe", "gus tow", "gu sto", "Guste").
const NAME = String.raw`(?:gu\s?s\s?s?t(?:eaux|eau|oe|ow|au|aw|avo|av|o|a|e)|goose\s?toe|guest\s?oh|coustou|gousto)`;
// Also "Heshep", "Heissef": how the recognizer writes "Hey Chef" run together.
const CHEF = String.raw`(?:chef|chief|shef|jeff|sheff|shep|s?sef)`;
// The "h" sometimes goes missing: "Eigus tow, let's cook".
const HEY = String.raw`(?:hey|hei|hej|hai|hay|heh|he|hi|hello|okay|ok|yo|ei|eh|ay)`;
// "Hey Gusteau", "Hey Chef" (also run together: "Heichef"), or "Gusteau, …" on its own; anywhere in the phrase ("um, hey chef, what's next").
// "Agusto, …" and "Achef, …" (run together) count too, at the very start.
// "A chef's knife" is not a call: "a" only counts at the very start, before his name or "chef" on its own
// ("A chef, read them all" is a misheard "Hey Chef").
const CALL = new RegExp(String.raw`(?:(?:^|\b)${HEY}[\s,!.]*(?:${NAME}|${CHEF})\b|^\s*(?:a\s*)?${NAME}\b|^\s*a\s*${CHEF}(?=[\s,!.?:]|$))[\s,!.?:-]*`, 'i');

/** "Güsto" → "Gusto": accents speech recognition adds. Same length, so positions still line up. */
const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '');

/** The words after the wake word ("" when he was only called), or null when he wasn't called. */
export function afterWakeWord(text: string): string | null {
  const flat = plain(text);
  const m = CALL.exec(flat);
  if (!m) return null;
  return flat.slice(m.index + m[0].length).trim();
}
