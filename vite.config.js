import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works at a domain root or under GitHub Pages.
  base: './',
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
  preview: { host: '127.0.0.1', port: 4317, strictPort: true },
  build: { target: 'es2022' },
});
