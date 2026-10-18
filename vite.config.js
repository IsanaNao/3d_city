import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'public');

// IDM treats any URL ending in .bin as a download and steals the browser fetch.
// Disk files stay *.bin; the dev server answers the same bytes at *.tile.
function cityTileMiddleware(req, res, next) {
  const pathname = decodeURIComponent((req.url || '').split('?')[0]);
  if (!pathname.startsWith('/tiles/') || !pathname.endsWith('.tile')) return next();
  const file = path.resolve(publicDir, pathname.slice(1).replace(/\.tile$/, '.bin'));
  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return next();
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) return next();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/vnd.shanghai.tile');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'no-cache');
    fs.createReadStream(file).pipe(res);
  });
}

export default defineConfig({
  // Relative base so the same build works at a domain root or under GitHub Pages.
  base: './',
  plugins: [{
    name: 'city-tiles',
    configureServer(server) {
      server.middlewares.use(cityTileMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(cityTileMiddleware);
    },
  }],
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
  preview: { host: '127.0.0.1', port: 4317, strictPort: true },
  build: { target: 'es2022' },
});
