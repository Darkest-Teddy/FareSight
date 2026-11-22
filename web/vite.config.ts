import { cpSync, existsSync, mkdirSync } from 'node:fs';
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
const allowedHosts = ['localhost', '127.0.0.1', '.trycloudflare.com'];

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
    allowedHosts,
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
    allowedHosts,
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
