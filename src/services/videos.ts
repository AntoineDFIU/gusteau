// ─────────────────────────────────────────────────────────────
// Short technique videos ("how to dice an onion"), searched on
// YouTube by the server (/api/videos). Only videos whose titles
// mention what was asked are kept, so a question about dicing never
// shows a soup recipe. If search fails, the card offers a YouTube
// search link instead.
// ─────────────────────────────────────────────────────────────

export interface Video {
  id: string;
  title: string;
  channel: string;
  thumb: string;
}

export class VideoError extends Error {
  constructor(readonly reason: 'none' | 'unavailable') {
    super(reason === 'none' ? 'No short videos found for that.' : 'Video search isn’t answering right now.');
  }
}

const STOP = new Set(['how', 'to', 'a', 'an', 'the', 'do', 'i', 'my', 'some', 'of', 'for', 'and', 'with', 'in', 'on', 'properly', 'correctly', 'perfectly']);
/** "Dicing onions" and "dice an onion" share the stems "dic" and "onion". */
const stems = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map((w) => w.replace(/(ing|ies|es|ed|e|s)$/, ''))
    .filter((w) => w.length > 1);

export const youtubeSearchUrl = (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`how to ${query}`)}`;

const cache = new Map<string, Promise<Video[]>>();

/** Up to four short videos on how to do something, most on-topic first. */
export function searchVideos(query: string): Promise<Video[]> {
  const key = query.toLowerCase().trim();
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      let data: { videos?: Video[]; error?: string };
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}api/videos?q=${encodeURIComponent(`how to ${query}`)}`, { signal: AbortSignal.timeout(10000) });
        data = await res.json();
      } catch {
        throw new VideoError('unavailable');
      }
      if (data.error || !data.videos) throw new VideoError('unavailable');
      const wanted = stems(query);
      const ranked = data.videos
        .map((v, rank) => ({ v, rank, hits: wanted.filter((w) => stems(v.title).some((t) => t.startsWith(w) || w.startsWith(t))).length }))
        .filter((x) => x.hits > 0)
        .sort((a, b) => b.hits - a.hits || a.rank - b.rank)
        .slice(0, 4)
        .map((x) => x.v);
      if (!ranked.length) throw new VideoError('none');
      return ranked;
    })();
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
