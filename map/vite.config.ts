import { defineConfig } from 'vite';

// The 3D network map runs beside the other FareSight apps: web on 5173, contribute on
// 5180, this on 5190. `.localhost` keeps the subdomain story consistent in development.
const allowedHosts = ['.localhost', ...(process.env.MAP_HOST ? [process.env.MAP_HOST] : [])];

export default defineConfig({
  server: { port: 5190, strictPort: true, allowedHosts },
  preview: { port: 4190, strictPort: true, allowedHosts },
  // MapLibre spawns its tile workers with `new Worker(new URL(...))`. Vite's dependency
  // pre-bundling rewrites that URL into the .vite/deps cache, where the worker entry no
  // longer resolves, and every tile request dies with "Worker failed to load". Serving
  // the package unbundled keeps the worker URL intact.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
});
