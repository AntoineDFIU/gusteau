const cache = new Map();

export function imageSearchQueries(phrase) {
  const title = `intitle:"${phrase.replace(/"/g, '')}"`;
  return [`${title} cooking`, `${title} recipe`, title];
}

export function parseCommonsImages(data, query, limit = 4) {
  const terms = query.toLowerCase().match(/[a-z0-9]+/g) || [];
  const ranked = Object.values(data?.query?.pages || {})
    .map(page => {
      const info = page.imageinfo?.[0];
      const title = page.title?.replace(/^File:/, '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ').trim();
      if (!title || !info?.thumburl || !info?.descriptionurl ||
          !/^image\/(?:jpeg|png|webp)$/.test(info.mime || '') || info.width < 200 || info.height < 200) return null;
      const words = title.toLowerCase().match(/[a-z0-9]+/g) || [];
      const matches = terms.filter(term => words.includes(term)).length;
      if (matches < Math.max(1, terms.length - 1)) return null;
      return { title, thumbnail: info.thumburl, source: info.descriptionurl,
        score: matches * 10 - Math.max(0, words.length - terms.length) };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  return ranked.filter(image => image.score >= ranked[0].score - 4)
    .slice(0, limit)
    .map(({ score, ...image }) => image);
}

export async function searchVisualImages(query) {
  const phrase = query.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!phrase) return [];
  const key = phrase.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < 10 * 60_000) return cached.results;
  let results = [];
  for (const search of imageSearchQueries(phrase)) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    for (const [name, value] of Object.entries({
      action: 'query', format: 'json', generator: 'search',
      gsrsearch: search, gsrnamespace: '6', gsrlimit: '20',
      prop: 'imageinfo', iiprop: 'url|mime|size', iiurlwidth: '640',
    })) url.searchParams.set(name, value);
    const response = await fetch(url, { headers: { 'User-Agent': 'Gusteau/0.1 (culinary visual search)' },
      signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Image search returned ${response.status}`);
    results = parseCommonsImages(await response.json(), phrase);
    if (results.length) break;
  }
  cache.set(key, { time: Date.now(), results });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return results;
}
