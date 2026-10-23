import { defineConfig } from 'vite';

export default defineConfig({
  root: new URL('.', import.meta.url).pathname,
  server: {
    host: '127.0.0.1', port: 8765,
    proxy: { '/asr': {
      target: 'http://127.0.0.1:18080', ws: true,
      rewrite: path => path.replace(/^\/asr/, ''),
    } },
  },
});
