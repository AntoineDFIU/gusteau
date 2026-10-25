import { defineConfig } from 'vite';
import { readFile, readdir } from 'node:fs/promises';
import { allowedTikTokThumbnailUrl, searchTechniqueVideos } from './video-search.js';
import { searchVisualImages } from './visual-images.js';

const recipesRoot = new URL('../../recipes/', import.meta.url);
let catalogPromise;

function catalog() {
  if (!catalogPromise) catalogPromise = (async () => {
    const index = JSON.parse(await readFile(new URL('index.json', recipesRoot), 'utf8'));
    const dataRoot = new URL('data/', recipesRoot);
    const names = [
      ...(await readdir(dataRoot)).filter(name => name.endsWith('.json')).map(name => new URL(name, dataRoot)),
      ...(await readdir(new URL('chefs/', dataRoot))).filter(name => name.endsWith('.json'))
        .map(name => new URL(`chefs/${name}`, dataRoot)),
    ];
    const collections = await Promise.all(names.map(async name => JSON.parse(await readFile(name, 'utf8'))));
    return { index, byId: new Map(collections.flat().map(recipe => [recipe.id, recipe])) };
  })().catch(error => { catalogPromise = null; throw error; });
  return catalogPromise;
}

function recipeApi() {
  return { name: 'gusteau-recipe-api', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (path === '/api/video-thumbnail') {
        const raw = new URL(req.url || '/', 'http://localhost').searchParams.get('url');
        const imageUrl = raw?.length < 2048 ? allowedTikTokThumbnailUrl(raw) : null;
        if (!imageUrl) { res.statusCode = 400; res.end('Invalid TikTok thumbnail URL'); return; }
        try {
          const response = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' },
            redirect: 'manual', signal: AbortSignal.timeout(8000) });
          const type = response.headers.get('content-type') || '';
          const size = Number(response.headers.get('content-length') || 0);
          if (!response.ok || !type.startsWith('image/') || size > 5_000_000) throw new Error('Thumbnail unavailable');
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length > 5_000_000) throw new Error('Thumbnail too large');
          res.setHeader('Content-Type', type);
          res.setHeader('Cache-Control', 'public, max-age=600');
          res.end(bytes);
        } catch {
          res.statusCode = 502;
          res.end('Thumbnail unavailable');
        }
        return;
      }
      if (path === '/api/visual-images') {
        const query = new URL(req.url || '/', 'http://localhost').searchParams.get('q')?.trim() || '';
        if (!query || query.length > 120) { res.statusCode = 400; res.end('Expected a short image query'); return; }
        try {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(await searchVisualImages(query)));
        } catch (error) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      if (path === '/api/technique-videos') {
        const query = new URL(req.url || '/', 'http://localhost').searchParams.get('q')?.trim() || '';
        if (!query || query.length > 120) {
          res.statusCode = 400;
          res.end('Expected a short technique query');
          return;
        }
        try {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(await searchTechniqueVideos(query)));
        } catch (error) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }
      if (path.startsWith('/api/recipe-images/')) {
        const file = decodeURIComponent(path.slice('/api/recipe-images/'.length));
        if (!/^[a-z0-9][a-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/i.test(file)) {
          res.statusCode = 400;
          res.end('Invalid image filename');
          return;
        }
        try {
          const image = await readFile(new URL(`images/${file}`, recipesRoot));
          res.setHeader('Content-Type', file.toLowerCase().endsWith('.png') ? 'image/png'
            : file.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg');
          res.end(image);
        } catch {
          res.statusCode = 404;
          res.end('Image not found');
        }
        return;
      }
      if (path !== '/api/recipes' && !path.startsWith('/api/recipes/')) return next();
      try {
        const data = await catalog();
        const id = path.startsWith('/api/recipes/') ? decodeURIComponent(path.slice('/api/recipes/'.length)) : null;
        const result = id ? data.byId.get(id) : data.index.map(({ id, title, genre, chef, description }) =>
          ({ id, title, genre, chef, description }));
        res.statusCode = result ? 200 : 404;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify(result || { error: 'Recipe not found' }));
      } catch (error) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } };
}

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  plugins: [recipeApi()],
  server: {
    host: '127.0.0.1', port: 8765,
    proxy: {
      '/asr': {
        target: 'http://127.0.0.1:18080', ws: true,
        rewrite: path => path.replace(/^\/asr/, ''),
      },
      '/ollama': {
        target: process.env.GUSTEAU_OLLAMA_URL || 'http://macbook-pro-m5-max.local:11434',
        rewrite: path => path.replace(/^\/ollama/, ''),
      },
    },
  },
});
