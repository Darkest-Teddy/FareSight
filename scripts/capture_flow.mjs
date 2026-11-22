// Runs one room capture through a running server, the way the Contribute app does:
// presigned PUTs to the raw bucket, frame registration, complete, then live status until the splat exists.
//
//   node scripts/capture_flow.mjs <place_id> <photo.jpg> <photo.jpg> [...]
//
// FARESIGHT_API (default http://localhost:3001) and ADMIN_PASSCODE (default bostonhacks2026) are read from the environment.
import { readFile } from 'node:fs/promises';

const [placeId, ...photos] = process.argv.slice(2);
if (!placeId || photos.length < 2) {
  console.error('Usage: node scripts/capture_flow.mjs <place_id> <photo.jpg> <photo.jpg> [...]');
  process.exit(1);
}
const origin = (process.env.FARESIGHT_API ?? 'http://localhost:3001').replace(/\/$/, '');
const passcode = process.env.ADMIN_PASSCODE ?? 'bostonhacks2026';

async function call(path, body) {
  const response = await fetch(origin + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-admin-passcode': passcode, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : undefined;
}

if (!(await call('/health')).captures) throw new Error('This server has no capture storage configured (see .env.example).');
const { capture_id: id } = await call('/captures', { place_id: placeId, device_info: { client: 'capture_flow.mjs' } });
console.log(`Capture ${id}`);

const name = (seq) => `frames/${String(seq).padStart(6, '0')}.jpg`;
const files = await Promise.all(photos.map(async (path, seq) => ({ name: name(seq), content_type: 'image/jpeg', body: await readFile(path) })));
const frames = files.map((_, seq) => ({ seq, key: `captures/${id}/${name(seq)}`, t_ms: seq * 1000 }));
files.push({
  name: 'frames.json', content_type: 'application/json',
  body: Buffer.from(JSON.stringify({ version: 1, capture_id: id, mode: 'room', tracking: 'none', frames })),
});
const { urls } = await call(`/captures/${id}/upload-urls`, {
  files: files.map(({ name, content_type, body }) => ({ name, content_type, size: body.length })),
});
for (const [index, { url, key }] of urls.entries()) {
  const put = await fetch(url, { method: 'PUT', headers: { 'content-type': files[index].content_type }, body: files[index].body });
  if (!put.ok) throw new Error(`PUT ${key} returned HTTP ${put.status}: ${await put.text()}`);
  console.log(`Uploaded ${key}`);
}
await call(`/captures/${id}/frames`, { frames });
const { job_id } = await call(`/captures/${id}/complete`, {});
console.log(`Job ${job_id}`);

let last = '';
for (;;) {
  const { job, assets } = await call(`/captures/${id}`);
  const line = `${job.status} ${job.progress}% · ${job.status_message}`;
  if (line !== last) console.log(last = line);
  if (job.status === 'failed') throw new Error(`${job.failure_code}: ${job.failure_detail}`);
  if (job.status === 'needs_review' || job.status === 'ready') {
    for (const { format, url, bytes } of assets) console.log(`${format}: ${url} (${bytes} bytes)`);
    console.log(`Review and publish it with POST /api/assets/${job_id}/publish`);
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
}
