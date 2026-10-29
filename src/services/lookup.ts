// ─────────────────────────────────────────────────────────────
// "What is a zester?" A short definition from Wikipedia and a few
// pictures from the same article (Wikimedia Commons), fetched by the
// browser. Both APIs are free, keyless and allow cross-origin requests;
// only the looked-up word leaves the app. Every result links back to
// its source for attribution.
//
// The article must be about exactly the item asked for, in its
// cooking sense: a page or redirect with that name ("Chilli flakes" →
// Crushed red pepper; "Zest (ingredient)" before "Zest"), or a search
// result named after it, and its intro must be about food or cooking.
// Anything else is rejected rather than shown, so "chili flakes" never
// turns into chili oil and "mandolin" never into the instrument.
// ─────────────────────────────────────────────────────────────

import { COOKING_WORDS } from './topic';

const WIKI = 'https://en.wikipedia.org';
const API = `${WIKI}/w/api.php?format=json&formatversion=2&origin=*`;

export interface LookupImage {
  src: string;
  caption: string;
  /** The Commons page with the image's author and license. */
  page: string;
}

export interface Lookup {
  term: string;
  title: string;
  definition: string;
  url: string;
  images: LookupImage[];
}

/** Why a lookup failed: nothing about exactly this item, or Wikipedia couldn't be reached. */
export class LookupError extends Error {
  constructor(readonly reason: 'not-found' | 'unavailable', term: string) {
    super(reason === 'not-found' ? `Nothing found for “${term}”.` : 'Wikipedia isn’t answering right now.');
  }
}

const cache = new Map<string, Promise<Lookup>>();

const json = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new LookupError('unavailable', '');
  return res.json() as Promise<T>;
};

/** The first sentence or two: enough to say out loud. Pronunciations and other asides in brackets are dropped. */
function shortDefinition(extract: string, title: string): string {
  let text = extract
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s+([,;:.])/g, '$1')
    .trim();
  // An intro that began with a bracketed name ("(Microplane), a company…") gets its subject back.
  if (/^[,;:]/.test(text)) text = `${title}${text}`;
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [text];
  let out = sentences[0].trim();
  if (out.length < 90 && sentences[1]) out += ` ${sentences[1].trim()}`;
  return out;
}

/** Words of a name, spelled one way: "Chilli Flakes" and "chili flake" both become "chili flake". */
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/^(chilli|chile)(e?s)?$/, 'chili$2').replace(/ies$/, 'y').replace(/(?<=[^s])s$/, ''));

/** 2 when a name is exactly the item asked about, 1 when it contains all its words ("Korean chilli flakes"), 0 otherwise. */
function matchScore(term: string, name: string): number {
  const t = words(term);
  const n = words(name);
  if (!t.length) return 0;
  if (t.join(' ') === n.join(' ')) return 2;
  return t.every((w) => n.includes(w)) ? 1 : 0;
}

/** The same item spelled the ways people (and speech recognition) write it. */
function spellings(term: string): string[] {
  const t = term.trim();
  const out = [t, t.replace(/\bchil(i|e)\b/gi, 'chilli'), t.replace(/\bchil(li|e)\b/gi, 'chili'), t.replace(/\bchil(li|i)\b/gi, 'chile')];
  out.push(...out.map((v) => (/s$/i.test(v) ? v.replace(/s$/i, '') : `${v}s`)));
  return [...new Set(out)];
}

interface Page {
  title: string;
  missing?: boolean;
  extract?: string;
  fullurl?: string;
  thumbnail?: { source: string };
  pageprops?: { disambiguation?: string };
}

/**
 * Wikipedia's own qualifiers for the cooking sense of a word: "Zest (ingredient)",
 * "Pan (cookware)", "Fold (cooking)". Tried before the bare name.
 */
const COOKING_QUALIFIERS = ['food', 'cooking', 'ingredient', 'cookware', 'culinary', 'spice', 'herb', 'condiment', 'utensil', 'spoon'];

/** Every article Gusteau shows must be about food or cooking: "mandolin" is never the instrument. */
/**
 * Checked against the opening, the part Gusteau reads out: a kitchen word in the
 * first sentence, or two different ones in the first three. A passing mention of
 * food in "Love" doesn't count; "Cumin is a flowering plant…" whose seeds are a spice does.
 */
function aboutCooking(extract: string, strict = false): boolean {
  // Brackets first: "A mousse (French: [mus]; lit. 'foam') is a soft, prepared food…" is one sentence.
  const text = extract.replace(/\s*\([^)]*\)/g, '');
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  if (COOKING_WORDS.test(sentences[0])) return true;
  if (strict) return false;
  const found = sentences.slice(0, 3).join(' ').match(new RegExp(COOKING_WORDS.source, 'gi')) ?? [];
  return new Set(found.map((w) => w.toLowerCase())).size >= 2;
}

/**
 * Several candidate titles in one request, following redirects. Returns
 * the first candidate (in order) that is a real article, not a
 * disambiguation page, with an intro to read.
 */
async function firstArticle(candidates: string[], namedAfter?: string, strict = false): Promise<Page | null> {
  if (!candidates.length) return null;
  const data = await json<{ query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: Page[] } }>(
    `${API}&action=query&redirects=1&prop=extracts|pageprops|pageimages|info&exintro=1&explaintext=1&ppprop=disambiguation&piprop=thumbnail&pithumbsize=400&inprop=url&titles=${candidates.map(encodeURIComponent).join('|')}`,
  );
  const q = data.query ?? {};
  const follow = (title: string, map?: { from: string; to: string }[]) => map?.find((m) => m.from === title)?.to ?? title;
  for (const c of candidates) {
    const title = follow(follow(c, q.normalized), q.redirects);
    const page = q.pages?.find((p) => p.title === title);
    // A disambiguation page ("Pan may refer to:") is never the item itself; its flag is an empty string.
    const ambiguous = (page?.pageprops && 'disambiguation' in page.pageprops) || /\bmay (also )?refer to\b/.test(page?.extract ?? '');
    // namedAfter: the article must carry the item's name ("Pan (food)" redirects to betel nut chewing).
    const named = !namedAfter || matchScore(namedAfter, page?.title ?? '') > 0;
    if (page && !page.missing && !ambiguous && named && page.extract?.trim() && aboutCooking(page.extract, strict)) return page;
  }
  return null;
}

async function articleFor(asked: string): Promise<Page | null> {
  // "Fresh thyme" is thyme (Fresh Thyme is also a supermarket chain).
  const term = asked.replace(/^(fresh|chopped|minced|sliced|diced|some|a few)\s+/i, '') || asked;
  // A page or redirect with this name, in any spelling: the cooking sense first ("Zest (ingredient)").
  const names = spellings(term);
  const qualified = names.slice(0, 3).flatMap((n) => COOKING_QUALIFIERS.map((q) => `${n} (${q})`));
  const direct = (await firstArticle(qualified, term)) ?? (await firstArticle(names));
  if (direct) return direct;
  // Otherwise search with cooking context, then without, and only accept results named after the item.
  type Hit = { title: string; redirecttitle?: string };
  for (const query of [`${term} cooking`, term]) {
    const found = await json<{ query?: { search?: Hit[] } }>(`${API}&action=query&list=search&srlimit=10&srprop=redirecttitle&srsearch=${encodeURIComponent(query)}`);
    const named = (found.query?.search ?? [])
      .map((h, rank) => ({ title: h.title, rank, score: Math.max(matchScore(term, h.title), h.redirecttitle && matchScore(term, h.redirecttitle) === 2 ? 2 : 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.rank - b.rank)
      .slice(0, 5)
      .map((x) => x.title);
    // A search hit is only a guess, so its very first sentence must be about food: "leak" never finds "COVID-19 lab leak theory".
    const article = await firstArticle(named, undefined, true);
    if (article) return article;
  }
  return null;
}

async function imagesFor(title: string, thumbnail?: string): Promise<LookupImage[]> {
  type Media = { items?: { type: string; title: string; caption?: { text?: string }; srcset?: { src: string }[] }[] };
  const media = await json<Media>(`${WIKI}/api/rest_v1/page/media-list/${encodeURIComponent(title)}`).catch(() => ({ items: [] }) as Media);
  const images = (media.items ?? [])
    .filter((i) => i.type === 'image' && i.srcset?.length && !/\.svg$/i.test(i.title))
    .slice(0, 4)
    .map((i) => ({
      src: i.srcset![0].src.startsWith('//') ? `https:${i.srcset![0].src}` : i.srcset![0].src,
      caption: i.caption?.text?.trim() || title,
      page: `https://commons.wikimedia.org/wiki/${encodeURIComponent(i.title.replace(/ /g, '_'))}`,
    }));
  if (!images.length && thumbnail) images.push({ src: thumbnail, caption: title, page: `${WIKI}/wiki/${encodeURIComponent(title)}` });
  return images;
}

/** Look up an ingredient or kitchen tool. Rejects with a LookupError if there's nothing about exactly that item. */
export function lookupTerm(term: string): Promise<Lookup> {
  const key = term.toLowerCase().trim();
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      let page: Page | null;
      try {
        page = await articleFor(term);
      } catch {
        throw new LookupError('unavailable', term);
      }
      if (!page?.extract) throw new LookupError('not-found', term);
      return {
        term,
        title: page.title,
        definition: shortDefinition(page.extract, page.title),
        url: page.fullurl ?? `${WIKI}/wiki/${encodeURIComponent(page.title)}`,
        images: await imagesFor(page.title, page.thumbnail?.source),
      };
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
