import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The Contribute app is served from its own subdomain (contribute.<domain>).
// In development it answers on http://contribute.localhost:5180 and proxies the API to the Fastify server.
const backend = process.env.FARESIGHT_API_ORIGIN ?? 'http://localhost:3001';
const proxy = {
  '/api': { target: backend },
  '/storage': { target: backend },
};
// `pnpm dev:https` (scripts/dev-https.mjs) sets this to a folder holding a self-signed certificate. The app then
// answers on https://<LAN-IP>:5181, which a phone needs before it will open the camera for the 360° scan.
const certDir = process.env.CONTRIBUTE_CERT_DIR;
const https = certDir ? { key: readFileSync(certDir + 'key.pem'), cert: readFileSync(certDir + 'cert.pem') } : undefined;
const allowedHosts = ['.localhost', ...(process.env.CONTRIBUTE_HOST ? [process.env.CONTRIBUTE_HOST] : [])];

export default defineConfig({
  resolve: { alias: { '@faresight/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: { port: https ? 5181 : 5180, strictPort: true, https, allowedHosts, proxy },
  preview: { port: 4180, strictPort: true, allowedHosts, proxy },
});
