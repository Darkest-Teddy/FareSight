// Capture storage end to end. Needs the stand-ins from docker-compose.yml (`docker compose up -d`);
// the integration tests skip themselves when those are not running.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import Fastify from 'fastify';
import { createApp } from '../dist/app.js';
import { getConfig } from '../dist/config.js';
import { createPool, migrate } from '../dist/db/pg.js';
import { registerCaptures } from '../dist/routes/captures.js';
import { createPasscodeGuards } from '../dist/services/passcodes.js';
import { frameKey, uploadTarget } from '../dist/services/captureKeys.js';
import { createObjectStorage } from '../dist/services/objectStorage.js';
import { decimatePly, decimateSpz } from '../dist/services/splatDecimate.js';
import { inspectSplat } from '../dist/services/splatProcessor.js';
import { upgradeSpz } from '../dist/services/spzUpgrade.js';

const placeId = 'harvard-cafe-01';
const captures = {
  databaseUrl: process.env.TEST_DATABASE_URL ?? 'postgres://faresight:faresight@localhost:54329/faresight',
  endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9009',
  accessKey: process.env.TEST_S3_ACCESS_KEY ?? 'faresight',
  secretKey: process.env.TEST_S3_SECRET_KEY ?? 'faresight-secret',
  region: 'us-east-1', rawBucket: 'test-raw', splatBucket: 'test-splats',
  appOrigins: ['*'], workerId: 'test-worker', minFrames: 2,
};
captures.databaseUrlDirect = captures.databaseUrl;
captures.cdnBaseUrl = `${captures.endpoint}/${captures.splatBucket}`;

function reachable(url) {
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port), timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    for (const event of ['error', 'timeout']) socket.once(event, () => { socket.destroy(); resolve(false); });
  });
}
const available = await reachable(captures.databaseUrl) && await reachable(captures.endpoint);
const skip = available ? false : 'Postgres and MinIO are not running (docker compose up -d)';

const grayscaleJpegHeader = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAACAAQBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8A',
  'base64',
);

function jpeg(width) {
  const header = Buffer.from(grayscaleJpegHeader);
  const frame = header.indexOf(Buffer.from([0xff, 0xc0]));
  header.writeUInt16BE(width, frame + 7);
  // This solid gray scan uses two zero bits per 8-pixel block, padded with ones.
  const bitCount = Math.ceil(width / 8) * 2;
  const scan = Buffer.alloc(Math.ceil(bitCount / 8));
  if (bitCount % 8) scan[scan.length - 1] = 0xff >> (bitCount % 8);
  return Buffer.concat([header, scan, Buffer.from([0xff, 0xd9])]);
}

function fixturePly() {
  const fields = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex 5\n${fields.map((name) => 'property float ' + name).join('\n')}\nend_header\n`);
  const body = Buffer.alloc(5 * fields.length * 4);
  for (let index = 0; index < 5; index++) {
    const row = index * fields.length * 4;
    body.writeFloatLE((index - 2) / 8, row);
    body.writeFloatLE(index / 12, row + 8);
    body.writeFloatLE(1, row + 40);
  }
  return Buffer.concat([header, body]);
}

async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'faresight-capture-'));
  const demo = join(dir, 'demo');
  await mkdir(demo);
  await writeFile(join(demo, 'room-study-cafe.ply'), fixturePly());
  const config = {
    ...getConfig(), database: join(dir, 'faresight.db'), uploads: join(dir, 'uploads'), outputs: join(dir, 'outputs'),
    demoAssets: [demo], host: '127.0.0.1', port: 0, mode: 'demo', adminPasscode: 'test-passcode',
    atlasKey: undefined, replicateKey: undefined, geminiKey: undefined, autoPublish: false, openUploads: false, captures, ...overrides,
  };
  const storage = createObjectStorage(captures);
  await storage.setupBucket(captures.rawBucket, { public: false, origins: ['*'] });
  await storage.setupBucket(captures.splatBucket, { public: true, origins: ['*'] });
  const pool = createPool(captures.databaseUrl);
  let app;
  let origin;
  const start = async () => {
    app = await createApp(config);
    origin = await app.listen({ host: config.host, port: 0 });
  };
  const stop = async () => {
    await app?.close();
    app = undefined;
  };
  t.after(async () => {
    await stop();
    await pool.end();
    storage.close();
    await rm(dir, { recursive: true, force: true });
  });

  async function request(path, { body, method = body === undefined ? 'GET' : 'POST', status = 200, passcode = true } = {}) {
    const headers = passcode ? { 'x-admin-passcode': config.adminPasscode } : {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(origin + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    assert.equal(response.status, status, `${method} ${path} returned ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : undefined;
  }

  /** Uploads photos the way the phone does: presigned PUTs to the bucket, then registration with the API. */
  async function uploadFrames(id, widths, { manifest = true } = {}) {
    const files = widths.map((width, seq) => ({ name: `frames/${String(seq).padStart(6, '0')}.jpg`, content_type: 'image/jpeg', body: jpeg(width) }));
    if (manifest) files.push({ name: 'frames.json', content_type: 'application/json', body: Buffer.from(JSON.stringify({ version: 1, capture_id: id, frames: [] })) });
    const { urls } = await request(`/api/captures/${id}/upload-urls`, {
      body: { files: files.map(({ name, content_type, body }) => ({ name, content_type, size: body.length })) },
    });
    for (const [index, { url }] of urls.entries()) {
      const put = await fetch(url, { method: 'PUT', headers: { 'content-type': files[index].content_type }, body: files[index].body });
      assert.equal(put.status, 200, await put.text());
    }
    await request(`/api/captures/${id}/frames`, {
      status: 204, body: { frames: widths.map((_, seq) => ({ seq, key: frameKey(id, seq), t_ms: seq * 500 })) },
    });
  }

  async function until(id, done, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    let view;
    do {
      view = await request(`/api/captures/${id}`);
      if (done(view)) return view;
      await delay(200);
    } while (Date.now() < deadline);
    assert.fail(`Capture did not get there. Last state was ${JSON.stringify(view)}`);
  }

  return { config, pool, storage, start, stop, request, uploadFrames, until, origin: () => origin };
}

test('upload names map to keys inside the capture and nothing else', () => {
  const id = '9b1c0000-0000-4000-8000-000000000000';
  const jpg = { content_type: 'image/jpeg', size: 1000 };
  assert.deepEqual(uploadTarget(id, { name: 'frames/000007.jpg', ...jpg }), { key: `captures/${id}/frames/000007.jpg` });
  assert.deepEqual(uploadTarget(id, { name: 'frames.json', content_type: 'application/json', size: 10 }), { key: `captures/${id}/frames.json` });
  for (const name of ['frames/7.jpg', 'frames/000007.png', '../frames/000007.jpg', 'frames/000007.jpg/../../x', 'video.mp4', 'logs/a.txt', '/frames.json']) {
    assert.ok('error' in uploadTarget(id, { name, ...jpg }), name);
  }
  assert.ok('error' in uploadTarget(id, { name: 'frames/000001.jpg', content_type: 'image/png', size: 1000 }));
  assert.ok('error' in uploadTarget(id, { name: 'frames/000001.jpg', content_type: 'image/jpeg', size: 9 * 1024 * 1024 }));
  assert.ok('error' in uploadTarget(id, { name: 'frames.json', content_type: 'text/html', size: 10 }));
});

test('capture uploads accept the contributor header while listing and deletion require admin', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const config = { ...getConfig(), adminPasscode: 'test-admin', contributorPasscode: 'test-upload', openUploads: false };
  registerCaptures(app, { get: () => ({ id: placeId }) }, config, createPasscodeGuards(config), {
    pool: { query: async () => ({ rows: [{ id: '9b1c0000-0000-4000-8000-000000000000' }] }) },
  }, {});
  const headers = { 'x-upload-passcode': 'test-upload' };
  const create = { method: 'POST', url: '/api/captures', payload: { place_id: placeId } };
  const created = await app.inject({ ...create, headers });
  assert.equal(created.statusCode, 201);
  assert.equal((await app.inject(create)).statusCode, 401);
  assert.equal((await app.inject({ url: '/api/captures', headers })).statusCode, 401);
  assert.equal((await app.inject({ method: 'DELETE', url: '/api/captures/' + created.json().capture_id, headers })).statusCode, 401);
});

test('an SPZ version 2 file is rewritten as version 3 with the same rotations', () => {
  const quaternions = [[0, 0, 0, 1], [0.5, -0.5, 0.5, 0.5], [0.9, 0.1, -0.3, 0.3], [-0.2, 0.95, 0.1, 0.2], [0.1, -0.2, 0.97, 0.05]]
    .map((q) => { const length = Math.hypot(...q); return q.map((value) => value / length); });
  const count = quaternions.length;
  const header = Buffer.alloc(16);
  header.write('NGSP');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(count, 8);
  header[12] = 1; // SH degree 1: 9 bytes per splat after the rotations
  header[13] = 12;
  const before = Buffer.from(Array.from({ length: count * 16 }, (_, index) => index % 251));
  const rotations = Buffer.from(quaternions.flatMap(([x, y, z]) => [x, y, z].map((value) => Math.round(value * 127.5 + 127.5))));
  const harmonics = Buffer.from(Array.from({ length: count * 9 }, (_, index) => 255 - index));
  const upgraded = gunzipSync(upgradeSpz(gzipSync(Buffer.concat([header, before, rotations, harmonics]))));

  assert.equal(upgraded.readUInt32LE(4), 3);
  assert.equal(upgraded.length, 16 + count * 16 + count * 4 + count * 9);
  assert.deepEqual(upgraded.subarray(16, 16 + count * 16), before);
  assert.deepEqual(upgraded.subarray(16 + count * 20), harmonics);
  // Decode the way the PlayCanvas SPZ parser does (smallest-three, 10 bits per stored component).
  for (let index = 0; index < count; index++) {
    // What version 2 actually holds: x, y and z at 8 bits each, with w derived from them.
    const expected = [...rotations.subarray(index * 3, index * 3 + 3)].map((byte) => byte / 127.5 - 1);
    expected.push(Math.sqrt(Math.max(0, 1 - expected.reduce((sum, value) => sum + value * value, 0))));
    const norm = Math.hypot(...expected);
    let packed = upgraded.readUInt32LE(16 + count * 16 + index * 4);
    const largest = packed >>> 30;
    const q = [0, 0, 0, 0];
    let squares = 0;
    for (let axis = 3; axis >= 0; axis--) {
      if (axis === largest) continue;
      q[axis] = (packed & 0x1ff) * (Math.SQRT1_2 / 511) * (packed & 0x200 ? -1 : 1);
      squares += q[axis] ** 2;
      packed >>>= 10;
    }
    q[largest] = Math.sqrt(Math.max(0, 1 - squares));
    // q and -q are the same rotation, so compare by the absolute dot product.
    const dot = Math.abs(q.reduce((sum, value, axis) => sum + value * expected[axis] / norm, 0));
    assert.ok(dot > 0.99995, `rotation ${index}: ${q} vs ${expected}`);
  }
  // Files that are already newer, or are not SPZ at all, are left alone.
  header.writeUInt32LE(3, 4);
  assert.equal(upgradeSpz(gzipSync(Buffer.concat([header, before, rotations, harmonics]))), undefined);
  assert.equal(upgradeSpz(Buffer.from('NGSP not gzipped')), undefined);
});

test('migration runs down and up', { skip }, async () => {
  const pool = createPool(captures.databaseUrl);
  try {
    await migrate(pool);
    assert.deepEqual(await migrate(pool, 'down'), ['001_captures']);
    assert.equal((await pool.query("select to_regclass('captures') as name")).rows[0].name, null);
    assert.deepEqual(await migrate(pool), ['001_captures']);
    assert.deepEqual(await migrate(pool), []);
    assert.equal((await pool.query("select to_regclass('splat_assets') as name")).rows[0].name, 'splat_assets');
  } finally {
    await pool.end();
  }
});

test('a presigned PUT stores one file, and only with the signed content type', { skip }, async (t) => {
  const { storage } = await setup(t);
  const key = `captures/test-${Date.now()}/frames/000000.jpg`;
  const url = await storage.presignPut(captures.rawBucket, key, 'image/jpeg');
  const wrong = await fetch(url, { method: 'PUT', headers: { 'content-type': 'text/html' }, body: 'x' });
  assert.equal(wrong.status, 403);
  const put = await fetch(url, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpeg(4) });
  assert.equal(put.status, 200);
  assert.deepEqual(await storage.list(captures.rawBucket, key), [{ key, size: jpeg(4).length }]);
  // The raw bucket is private: the same object is not readable without a signature.
  assert.equal((await fetch(`${captures.endpoint}/${captures.rawBucket}/${key}`)).status, 403);
  assert.equal(await storage.deletePrefix(captures.rawBucket, key), 1);
});

test('a capture goes from phone upload to a published room', { skip, timeout: 60_000 }, async (t) => {
  const server = await setup(t);
  await server.start();
  assert.equal((await server.request('/api/health')).captures, true);

  await server.request('/api/captures', { body: { place_id: placeId }, passcode: false, status: 401 });
  await server.request('/api/captures', { body: { place_id: 'nowhere' }, status: 404 });
  await server.request('/api/captures', { body: { place_id: placeId, mode: 'object' }, status: 400 });
  const { capture_id: id } = await server.request('/api/captures', { body: { place_id: placeId, device_info: { camera: 'Back Camera' } }, status: 201 });
  assert.equal((await server.request(`/api/captures/${id}`)).capture.status, 'created');
  await server.request('/api/captures/not-a-uuid', { status: 400 });
  await server.request('/api/captures/00000000-0000-4000-8000-000000000000', { status: 404 });

  const jpg = { content_type: 'image/jpeg', size: 100 };
  for (const name of ['../../other/frames/000000.jpg', 'frames/1.jpg', 'video.mp4']) {
    await server.request(`/api/captures/${id}/upload-urls`, { body: { files: [{ name, ...jpg }] }, status: 400 });
  }
  await server.request(`/api/captures/${id}/upload-urls`, { body: { files: [{ name: 'frames/000000.jpg', ...jpg }] }, passcode: false, status: 401 });
  await server.request(`/api/captures/${id}/frames`, { body: { frames: [{ seq: 0, key: frameKey('00000000-0000-4000-8000-000000000000', 0) }] }, status: 400 });

  // Not enough photos, then photos without frames.json: neither may start a build.
  await server.request(`/api/captures/${id}/complete`, { body: {}, status: 400 });
  await server.uploadFrames(id, [10, 11, 12], { manifest: false });
  assert.equal((await server.request(`/api/captures/${id}`)).capture.status, 'uploading');
  assert.match((await server.request(`/api/captures/${id}/complete`, { body: {}, status: 409 })).error, /frames\.json/);
  await server.uploadFrames(id, [10, 11, 12]);
  assert.equal((await server.request(`/api/captures/${id}`)).capture.frame_count, 3);

  // Watch over server-sent events from before the build starts.
  const stream = await fetch(`${server.origin()}/api/captures/${id}/events`);
  assert.equal(stream.headers.get('content-type'), 'text/event-stream');
  const seen = [];
  const watching = (async () => {
    let text = '';
    for await (const chunk of stream.body.pipeThrough(new TextDecoderStream())) {
      text += chunk;
      for (let end = text.indexOf('\n\n'); end >= 0; end = text.indexOf('\n\n')) {
        const [event, data] = text.slice(0, end).split('\n');
        text = text.slice(end + 2);
        if (event.startsWith('event: ')) seen.push([event.slice(7), JSON.parse(data.slice(6))]);
      }
      if (seen.some(([type, data]) => type === 'status' && data.job_status === 'needs_review')) break;
    }
  })();

  const [first, second] = await Promise.all([
    server.request(`/api/captures/${id}/complete`, { body: { model_tier: 'atlas-draft' }, status: 202 }),
    delay(50).then(() => server.request(`/api/captures/${id}/complete`, { body: {} })),
  ]);
  const jobId = second.job_id;
  assert.equal(first.job_id, jobId);
  assert.equal((await server.request(`/api/captures/${id}/complete`, { body: {} })).job_id, jobId);
  assert.equal(Number((await server.pool.query('select count(*) from jobs where capture_id = $1', [id])).rows[0].count), 1);
  // A completed capture takes no more files.
  await server.request(`/api/captures/${id}/upload-urls`, { body: { files: [{ name: 'frames/000009.jpg', ...jpg }] }, status: 409 });

  const built = await server.until(id, (view) => view.job?.status === 'needs_review');
  assert.equal(built.capture.status, 'ready');
  assert.equal(built.generation_job.id, jobId);
  assert.equal(built.generation_job.capture_id, id);
  assert.equal(built.generation_job.status, 'needs_review');
  assert.equal(built.assets.length, 1);
  const [splat] = built.assets;
  assert.equal(splat.quality, 'full');
  assert.equal(splat.url, `${captures.cdnBaseUrl}/splats/${id}/${jobId}/full.${splat.format}`);

  // The finished splat is readable from the bucket without credentials, and cacheable forever.
  const download = await fetch(splat.url);
  assert.equal(download.status, 200);
  assert.equal((await download.arrayBuffer()).byteLength, splat.bytes);
  assert.match(download.headers.get('cache-control'), /immutable/);

  await Promise.race([watching, delay(5000).then(() => assert.fail(`No needs_review event. Saw ${JSON.stringify(seen)}`))]);
  assert.ok(seen.some(([type, data]) => type === 'asset' && data.url === splat.url), JSON.stringify(seen));
  assert.ok(seen.some(([type, data]) => type === 'status' && data.capture_status === 'processing'));

  // The photos reached the pipeline with their sizes, and Postgres holds keys, never bytes.
  const frames = (await server.pool.query('select seq, object_key, width, height from frames where capture_id = $1 order by seq', [id])).rows;
  assert.deepEqual(frames.map(({ width }) => width), [10, 11, 12]);
  assert.equal(frames[2].object_key, frameKey(id, 2));

  // The existing review flow makes it the restaurant's room.
  const asset = await server.request(`/api/assets/${jobId}`);
  assert.equal(asset.url, splat.url);
  assert.equal(asset.status, 'needs_review');
  await server.request(`/api/assets/${jobId}/publish`, { body: {} });
  const manifest = await server.request(`/api/restaurants/${placeId}/manifest`);
  assert.ok(JSON.stringify(manifest).includes(splat.url));
  const live = await server.until(id, (view) => view.job?.status === 'ready');
  assert.equal(live.capture.status, 'ready');

  const list = await server.request(`/api/captures?place_id=${placeId}`);
  assert.equal(list.captures[0].capture.id, id);
  await server.request('/api/captures', { passcode: false, status: 401 });
  assert.match((await server.request(`/api/captures/${id}`, { method: 'DELETE', status: 409 })).error, /published room/);
});

test('deleting a capture removes its rows and every object under its prefix', { skip, timeout: 30_000 }, async (t) => {
  const server = await setup(t);
  await server.start();
  const { capture_id: id } = await server.request('/api/captures', { body: { place_id: placeId }, status: 201 });
  await server.uploadFrames(id, [20, 21]);
  assert.equal((await server.storage.list(captures.rawBucket, `captures/${id}/`)).length, 3);
  await server.request(`/api/captures/${id}`, { method: 'DELETE', passcode: false, status: 401 });
  await server.request(`/api/captures/${id}`, { method: 'DELETE', status: 204 });
  assert.deepEqual(await server.storage.list(captures.rawBucket, `captures/${id}/`), []);
  await server.request(`/api/captures/${id}`, { status: 404 });
  assert.equal(Number((await server.pool.query('select count(*) from frames where capture_id = $1', [id])).rows[0].count), 0);
});

test('a job whose worker died is requeued and goes live unreviewed, and unreadable photos fail without a retry', { skip, timeout: 60_000 }, async (t) => {
  const server = await setup(t, { autoPublish: true });
  await server.start();
  const { capture_id: stuck } = await server.request('/api/captures', { body: { place_id: placeId }, status: 201 });
  await server.uploadFrames(stuck, [30, 31]);
  const { capture_id: broken } = await server.request('/api/captures', { body: { place_id: placeId }, status: 201 });
  await server.uploadFrames(broken, [40, 41]);
  // Overwrite one photo with something that is not an image.
  await server.storage.put(captures.rawBucket, frameKey(broken, 1), Buffer.from('not a photo'), 'image/jpeg');
  await server.stop();

  // A job left behind by a worker that stopped heartbeating three minutes ago.
  const { rows: [job] } = await server.pool.query(`
    insert into jobs (capture_id, status, attempts, worker_id, claimed_at, heartbeat_at)
    values ($1, 'claimed', 1, 'dead-worker', now() - interval '3 minutes', now() - interval '3 minutes') returning id
  `, [stuck]);
  await server.start();
  const recovered = await server.until(stuck, (view) => view.job?.status === 'ready');
  assert.equal(recovered.job.id, job.id);
  assert.equal(recovered.job.attempts, 2);
  // With auto-publish on, the build is the place's room without anyone reviewing it.
  assert.equal(recovered.generation_job.status, 'ready');
  assert.equal((await server.request(`/api/assets/${job.id}`)).status, 'ready');
  assert.ok(JSON.stringify(await server.request(`/api/restaurants/${placeId}/manifest`)).includes(recovered.assets[0].url));

  await server.request(`/api/captures/${broken}/complete`, { body: {}, status: 202 });
  const failed = await server.until(broken, (view) => view.job?.status === 'failed');
  assert.equal(failed.capture.status, 'failed');
  assert.equal(failed.job.failure_code, 'invalid_frames');
  assert.equal(failed.job.attempts, 1);
  assert.equal(failed.generation_job.status, 'failed');
  assert.match(failed.generation_job.error, /Photo 2/);
});

test('an oversized SPZ is cut to the target while every part of the scene stays covered', () => {
  // Two clusters far apart: 40 large opaque Gaussians, and 40 small faint ones that a plain "most visible first" cut would drop entirely.
  const count = 80;
  const header = Buffer.alloc(16);
  header.write('NGSP');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(count, 8);
  header[13] = 12;
  const positions = Buffer.alloc(count * 9);
  const alphas = Buffer.alloc(count);
  const colors = Buffer.from(Array.from({ length: count * 3 }, (_, index) => Math.floor(index / 3)));
  const scales = Buffer.alloc(count * 3);
  const rotations = Buffer.alloc(count * 3, 127);
  for (let index = 0; index < count; index++) {
    const faint = index >= 40;
    positions.writeIntLE((faint ? 400_000 : -400_000) + index, index * 9, 3);
    alphas[index] = faint ? 40 : 255;
    scales.fill(faint ? 60 : 120, index * 3, index * 3 + 3);
  }
  const reduced = decimateSpz(gzipSync(Buffer.concat([header, positions, alphas, colors, scales, rotations])), 20);
  assert.equal(reduced.count, 20);
  const data = gunzipSync(reduced.file);
  assert.equal(data.readUInt32LE(8), 20);
  assert.equal(data.length, 16 + 20 * 19);
  // Colours carry each Gaussian's original index, so they show which ones survived and that streams stayed aligned.
  const kept = Array.from({ length: 20 }, (_, index) => data[16 + 20 * 10 + index * 3]);
  assert.ok(kept.some((index) => index < 40) && kept.some((index) => index >= 40), `kept ${kept}`);
  for (const [at, index] of kept.entries()) {
    assert.equal(data.readIntLE(16 + at * 9, 3), (index >= 40 ? 400_000 : -400_000) + index);
    assert.equal(data[16 + 20 * 9 + at], index >= 40 ? 40 : 255);
    // Survivors are enlarged a little to cover for the ones removed.
    assert.ok(data[16 + 20 * 13 + at * 3] > (index >= 40 ? 60 : 120));
  }
  // Already small enough: left alone.
  assert.equal(decimateSpz(gzipSync(Buffer.concat([header, positions, alphas, colors, scales, rotations])), 80), undefined);
});

test('an oversized PLY is cut to the target and stays a valid Gaussian PLY', () => {
  const names = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const count = 60;
  const header = Buffer.from(`ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${names.map((name) => `property float ${name}`).join('\n')}\nend_header\n`);
  const rows = Buffer.alloc(count * names.length * 4);
  for (let row = 0; row < count; row++) {
    const faint = row >= 30;
    const values = [faint ? 5 + row / 100 : -5 + row / 100, 0, 0, row, 0, 0, faint ? -2 : 4, faint ? -6 : -2, faint ? -6 : -2, faint ? -6 : -2, 1, 0, 0, 0];
    for (const [column, value] of values.entries()) rows.writeFloatLE(value, (row * names.length + column) * 4);
  }
  const file = Buffer.concat([header, rows]);
  const reduced = decimatePly(file, inspectSplat(file).layout, 12);
  assert.equal(reduced.count, 12);
  const result = inspectSplat(reduced.file);
  assert.equal(result.count, 12);
  assert.equal(reduced.file.length, result.layout.offset + 12 * names.length * 4);
  // f_dc_0 carries each row's original index.
  const kept = Array.from({ length: 12 }, (_, row) => reduced.file.readFloatLE(result.layout.offset + (row * names.length + 3) * 4));
  assert.ok(kept.some((row) => row < 30) && kept.some((row) => row >= 30), `kept ${kept}`);
  for (const [at, row] of kept.entries()) {
    const scale = reduced.file.readFloatLE(result.layout.offset + (at * names.length + 7) * 4);
    assert.ok(scale > (row >= 30 ? -6 : -2) && scale < (row >= 30 ? -5.7 : -1.7));
  }
  assert.equal(decimatePly(file, inspectSplat(file).layout, 60), undefined);
});
