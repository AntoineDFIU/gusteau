const platforms = [
  { id: 'youtube', query: phrase => `site:youtube.com/shorts/ ${phrase}`, host: 'youtube.com', path: /^\/shorts\/([\w-]+)/ },
  { id: 'instagram', query: phrase => `${phrase} instagram reel`, host: 'instagram.com', path: /^\/reel\/([\w-]+)/ },
  { id: 'tiktok', query: phrase => `${phrase} tiktok`, host: 'tiktok.com', path: /^\/@[^/]+\/video\/(\d+)/ },
];

export function cookingSearchPhrase(phrase) {
  const normalized = phrase.trim().replace(/\s+/g, ' ');
  return `${normalized}${/\bcook(?:ing)?\b/i.test(normalized) ? '' : ' cooking'}${/\brecipes?\b/i.test(normalized) ? '' : ' recipe'}`;
}

function decodeEntities(value) {
  return value.replace(/&(?:amp|quot|#39|lt|gt);/g, entity =>
    ({ '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' })[entity]);
}

export function parseVideoResults(html, platform, limit = 2) {
  const config = platforms.find(item => item.id === platform);
  if (!config) return [];
  const results = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a\b[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const href = decodeEntities(match[1]);
    try {
      const wrapper = new URL(href, 'https://duckduckgo.com');
      const url = new URL(wrapper.searchParams.get('uddg') || wrapper.href);
      const host = url.hostname.replace(/^www\./, '');
      if (host !== config.host || !config.path.test(url.pathname) || seen.has(url.pathname)) continue;
      seen.add(url.pathname);
      const title = decodeEntities(match[2].replace(/<[^>]*>/g, '')).trim();
      if (!title) continue;
      const videoId = platform === 'youtube' ? url.pathname.match(config.path)?.[1] : null;
      results.push({ platform, title, url: `${url.origin}${url.pathname}`,
        thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null });
      if (results.length === limit) break;
    } catch { /* Ignore malformed search results. */ }
  }
  return results;
}

export function parseYouTubeResults(html) {
  const marker = /\bytInitialData\s*=\s*/.exec(html);
  if (!marker) return [];
  const start = marker.index + marker[0].length;
  const end = html.indexOf(';</script>', start);
  if (end < 0) return [];
  let data;
  try { data = JSON.parse(html.slice(start, end)); }
  catch { return []; }
  const results = [];
  const seen = new Set();
  function visit(node) {
    if (!node || results.length >= 6) return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    if (typeof node !== 'object') return;
    const short = node.shortsLockupViewModel;
    if (short) {
      const id = short.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId;
      if (/^[\w-]{11}$/.test(id) && !seen.has(id)) {
        seen.add(id);
        results.push({ platform: 'youtube',
          title: (short.accessibilityText || 'YouTube Short').replace(/, [\d.,]+ (?:thousand |million )?views? - play Short$/i, ''),
          url: `https://www.youtube.com/shorts/${id}`,
          thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` });
      }
    }
    for (const value of Object.values(node)) visit(value);
  }
  visit(data);
  return results;
}

const cache = new Map();

async function isEmbeddable(video) {
  let url;
  if (video.platform === 'youtube') url = `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`;
  else if (video.platform === 'instagram') {
    const id = new URL(video.url).pathname.match(/^\/reel\/([\w-]+)/)?.[1];
    if (!id) return false;
    url = `https://www.instagram.com/p/${id}/embed/captioned/`;
  }
  else url = `https://www.tiktok.com/oembed?url=${encodeURIComponent(video.url)}`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) return null;
    if (video.platform === 'instagram') {
      const html = await response.text();
      return /The link to this photo or video may be broken|post may have been removed|This post is unavailable/i.test(html)
        ? null : {};
    }
    if (video.platform === 'tiktok') {
      const data = await response.json();
      return { thumbnail: allowedTikTokThumbnailUrl(data.thumbnail_url) };
    }
    return {};
  } catch { return null; }
}

function safeThumbnail(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch { return null; }
}

export function allowedTikTokThumbnailUrl(value) {
  const safe = safeThumbnail(value);
  if (!safe) return null;
  const host = new URL(safe).hostname.toLowerCase();
  return ['tiktokcdn.com', 'tiktokcdn-us.com', 'byteimg.com', 'muscdn.com']
    .some(domain => host === domain || host.endsWith(`.${domain}`)) ? safe : null;
}

export function tiktokPageThumbnail(html) {
  const tag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map(match => match[0])
    .find(value => /\b(?:property|name)=["'](?:og:image|twitter:image)["']/i.test(value));
  const raw = tag?.match(/\bcontent=["']([^"']+)["']/i)?.[1];
  return allowedTikTokThumbnailUrl(raw?.replaceAll('&amp;', '&'));
}

async function withTikTokThumbnail(video) {
  if (video.thumbnail) return video;
  try {
    const response = await fetch(video.url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
    if (response.ok) return { ...video, thumbnail: tiktokPageThumbnail(await response.text()) };
  } catch { /* Keep the placeholder when TikTok does not expose a cover. */ }
  return video;
}

async function searchPlatform(platform, phrase) {
  const shorter = phrase.split(' ').slice(0, 3).join(' ');
  for (const attempt of [...new Set([phrase, shorter].map(cookingSearchPhrase))]) {
    if (platform.id === 'youtube') {
      try {
        const own = new URL('https://www.youtube.com/results');
        own.searchParams.set('search_query', `${attempt} shorts`);
        const response = await fetch(own, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
        if (response.ok) {
          const candidates = parseYouTubeResults(await response.text());
          const checks = await Promise.all(candidates.map(isEmbeddable));
          const results = candidates.flatMap((candidate, index) => checks[index] ? [{ ...candidate, ...checks[index] }] : []).slice(0, 2);
          if (results.length) return results;
        }
      } catch { /* Try the general search index. */ }
    }
    const url = new URL('https://html.duckduckgo.com/html/');
    url.searchParams.set('q', platform.query(attempt));
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) continue;
      const candidates = parseVideoResults(await response.text(), platform.id, 6);
      const checks = await Promise.all(candidates.map(isEmbeddable));
      const results = candidates.flatMap((candidate, index) => checks[index] ? [{ ...candidate, ...checks[index] }] : []).slice(0, 2);
      if (results.length) return platform.id === 'tiktok'
        ? await Promise.all(results.map(withTikTokThumbnail)) : results;
    } catch { /* Try a shorter technique query. */ }
  }
  return [];
}

export async function searchTechniqueVideos(query) {
  const phrase = query.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!phrase) return [];
  const key = phrase.toLowerCase();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < (cached.results.length ? 10 * 60_000 : 30_000)) return cached.results;
  const searches = await Promise.allSettled(platforms.map(platform => searchPlatform(platform, phrase)));
  const results = searches.flatMap(result => result.status === 'fulfilled' ? result.value : []);
  cache.set(key, { time: Date.now(), results });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return results;
}
