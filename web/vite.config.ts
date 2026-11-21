import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const backend = 'http://localhost:3001';
const publicUrl = new URL('./public/', import.meta.url);
const publicDir = fileURLToPath(publicUrl);
const modelingOutput = new URL('../modeling/output/', import.meta.url);
const proxy = {
  '/api': { target: backend },
  '/storage': { target: backend },
  '/ws': { target: 'ws://localhost:3001', ws: true },
};
const demoPrefix = '/assets-demo/';

export default defineConfig({
  publicDir,
  resolve: { alias: { '@faresight/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  plugins: [{
    name: 'faresight-demo-assets',
    apply: 'build',
    writeBundle(options) {
      if (!options.dir) return;
      const destination = resolve(options.dir, 'assets-demo');
      if (existsSync(modelingOutput)) {
        mkdirSync(destination, { recursive: true });
        cpSync(modelingOutput, destination, { recursive: true, force: false });
      }
      if (!existsSync(destination)) return;
      const cacheList = readdirSync(destination, { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.(?:glb|ply|sog|webp|png|jpe?g|json)$/i.test(name))
        .filter((name) => name !== 'cache-list.json' && statSync(resolve(destination, name)).isFile())
        .map((name) => demoPrefix + name.split('/').map(encodeURIComponent).join('/'));
      writeFileSync(resolve(destination, 'cache-list.json'), JSON.stringify(cacheList));
    },
  }],
  build: {
    rollupOptions: {
      // The app and the scroll-driven landing page are separate entry points.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        intro: fileURLToPath(new URL('./intro.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    proxy: {
      ...proxy,
      [demoPrefix]: {
        target: backend,
        bypass(request) {
          if (!request.url) return;
          const path = new URL(request.url, backend).pathname;
          if (existsSync(new URL('.' + path, publicUrl))) return request.url;
          const name = path.slice(demoPrefix.length);
          if (/^[a-z0-9][a-z0-9_.-]*$/i.test(name) && existsSync(new URL(name, modelingOutput))) return '/@fs' + new URL(name, modelingOutput).pathname;
        },
      },
    },
  },
  preview: {
    port: 4173,
    allowedHosts: true,
    proxy: {
      ...proxy,
      [demoPrefix]: {
        target: backend,
        bypass(request) {
          if (!request.url) return;
          const path = new URL(request.url, backend).pathname;
          if (existsSync(new URL('.' + path, new URL('./dist/', import.meta.url)))) return request.url;
        },
      },
    },
  },
});
