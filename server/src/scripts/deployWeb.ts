// pnpm --filter @faresight/server run deploy-web [--dry-run]
// Uploads the built web app (web/dist) to the WEB_BUCKET bucket on Vultr Object Storage, then purges the
// Vultr CDN pull zone that serves it. Run `pnpm --filter @faresight/web build` first.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { projectRoot } from '../config.ts';
import { createObjectStorage } from '../services/objectStorage.ts';

const env = process.env;
const dryRun = process.argv.includes('--dry-run');
const endpoint = env.VULTR_S3_ENDPOINT?.replace(/\/+$/, '');
const accessKey = env.VULTR_S3_ACCESS_KEY;
const secretKey = env.VULTR_S3_SECRET_KEY;
const bucket = env.WEB_BUCKET;
if (!endpoint || !accessKey || !secretKey || !bucket) {
  throw new Error('Set VULTR_S3_ENDPOINT, VULTR_S3_ACCESS_KEY, VULTR_S3_SECRET_KEY and WEB_BUCKET first.');
}
// Files missing from the build are deleted from the bucket, so it must not be one the captures live in.
if ([env.RAW_BUCKET || 'faresight-raw', env.SPLAT_BUCKET || 'faresight-splats'].includes(bucket)) {
  throw new Error(`WEB_BUCKET (${bucket}) must be a bucket of its own, not the raw or splat bucket.`);
}
const dist = resolve(projectRoot, env.WEB_DIST || 'web/dist');
if (!existsSync(resolve(dist, 'index.html'))) throw new Error(`${dist} has no index.html. Build the web app first.`);

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
};
// Vite names everything in assets/ after its content, so those files never change. The pages, the service
// worker and the list of demo files must be checked again on every visit; the models may be replaced under the same name.
const HASHED = /^assets\//;
const ALWAYS_FRESH = /(?:\.html|\.webmanifest|^sw\.js|\/cache-list\.json)$/;
const cacheControl = (key: string) => HASHED.test(key) ? 'public, max-age=31536000, immutable'
  : ALWAYS_FRESH.test(key) ? 'no-cache' : 'public, max-age=600';

const files = readdirSync(dist, { recursive: true, encoding: 'utf8' })
  .map((name) => name.split('\\').join('/'))
  .filter((name) => statSync(resolve(dist, name)).isFile())
  .map((key) => ({ key, size: statSync(resolve(dist, key)).size }));
// The pages go last: a page must never point at a bundle that has not been uploaded yet.
const pagesLast = (key: string) => (key === 'index.html' ? 3 : key.endsWith('.html') ? 2 : key === 'sw.js' ? 1 : 0);
files.sort((a, b) => pagesLast(a.key) - pagesLast(b.key));

const storage = createObjectStorage({ endpoint, accessKey, secretKey, region: env.VULTR_S3_REGION || 'us-east-1' });
try {
  console.log(`${dryRun ? 'Dry run: ' : ''}${dist} -> ${endpoint}/${bucket}`);
  const existing = await storage.list(bucket, '').catch(() => undefined);
  if (existing?.length && !existing.some(({ key }) => key === 'index.html')) {
    throw new Error(`Bucket ${bucket} holds files but no index.html, so it is not a web bucket. Nothing was changed.`);
  }
  if (!dryRun) {
    const notes = await storage.setupBucket(bucket, { public: true, origins: ['*'] });
    console.log(`Bucket ${bucket}: ${notes.join(', ')}`);
  } else if (!existing) {
    console.log(`Bucket ${bucket} would be created.`);
  }

  const sizes = new Map((existing ?? []).map(({ key, size }) => [key, size]));
  const uploads = files.filter(({ key, size }) => !(HASHED.test(key) && sizes.get(key) === size));
  const keep = new Set(files.map(({ key }) => key));
  // Earlier bundles stay, so a page that is still cached somewhere keeps working.
  const stale = [...sizes.keys()].filter((key) => !keep.has(key) && !HASHED.test(key));

  const upload = async ({ key }: { key: string }) => {
    const type = CONTENT_TYPES[extname(key).toLowerCase()] ?? 'application/octet-stream';
    if (!dryRun) await storage.put(bucket, key, readFileSync(resolve(dist, key)), type, { public: true, cacheControl: cacheControl(key) });
    console.log(`  ${dryRun ? 'would upload' : 'uploaded'} ${key}`);
  };
  const assets = uploads.filter(({ key }) => !pagesLast(key));
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < assets.length) await upload(assets[next++]);
  }));
  for (const file of uploads.filter(({ key }) => pagesLast(key))) await upload(file);
  for (const key of stale) {
    if (!dryRun) await storage.remove(bucket, key);
    console.log(`  ${dryRun ? 'would delete' : 'deleted'} ${key}`);
  }
  const megabytes = (uploads.reduce((sum, { size }) => sum + size, 0) / 1e6).toFixed(1);
  console.log(`${uploads.length} of ${files.length} files ${dryRun ? 'to upload' : 'uploaded'} (${megabytes} MB), ${stale.length} ${dryRun ? 'to delete' : 'deleted'}.`);
} finally {
  storage.close();
}

// GitHub Actions shows these as annotations on the run. Elsewhere they are plain lines.
const warn = (message: string) => console.log(`${env.GITHUB_ACTIONS ? '::warning::' : 'Warning: '}${message}`);
const apiKey = env.VULTR_API_KEY;
const zoneId = env.VULTR_CDN_PULL_ZONE_ID;
if (dryRun) {
  console.log(apiKey && zoneId ? `CDN pull zone ${zoneId} would be purged.` : 'No CDN purge is set up.');
} else if (!apiKey || !zoneId) {
  warn('VULTR_API_KEY or VULTR_CDN_PULL_ZONE_ID is not set, so the CDN was not purged and may serve the old pages for a while.');
} else {
  const zoneUrl = `https://api.vultr.com/v2/cdns/pull-zones/${encodeURIComponent(zoneId)}`;
  const headers = { Authorization: `Bearer ${apiKey}` };
  try {
    const purge = await fetch(`${zoneUrl}/purge`, { headers });
    // Vultr allows one purge every six hours, so a refused purge is reported and the deploy still counts.
    if (purge.ok) console.log(`Purged CDN pull zone ${zoneId}.`);
    else warn(`The CDN purge was refused (HTTP ${purge.status}: ${(await purge.text()).slice(0, 300)}). The new files are in the bucket; the CDN may serve the old pages until its cache expires.`);
    const zone = await fetch(zoneUrl, { headers });
    const address = zone.ok ? (await zone.json() as { pull_zone?: { cdn_url?: string } }).pull_zone?.cdn_url : undefined;
    if (address) console.log(`Live at ${/^https?:/.test(address) ? address : 'https://' + address}/index.html`);
  } catch (error) {
    warn(`The Vultr API could not be reached (${error instanceof Error ? error.message : error}), so the CDN was not purged.`);
  }
}
