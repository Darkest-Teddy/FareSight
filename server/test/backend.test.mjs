import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { gzipSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { computeTotalCost, computeTripEstimate, latLonToSculpture, STOPS } from '@faresight/shared';
import { createApp } from '../dist/app.js';
import { getConfig } from '../dist/config.js';
import { pollAtlasSplats, submitAtlasSplats } from '../dist/services/atlasClient.js';
import { findDemoAsset } from '../dist/services/demoAssets.js';
import { inspectSplat } from '../dist/services/splatProcessor.js';

const room = 'room-ramen-house.ply';
const dish = 'dish-tonkotsu-ramen.ply';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNrcAAAAASUVORK5CYII=', 'base64');
const secondImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const placeId = 'bu-ramen-01';

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
  const dir = await mkdtemp(join(tmpdir(), 'faresight-test-'));
  const config = {
    ...getConfig(), database: join(dir, 'faresight.db'), uploads: join(dir, 'uploads'), outputs: join(dir, 'outputs'),
    host: '127.0.0.1', port: 0, mode: 'auto', adminPasscode: 'test-passcode', geminiKey: undefined,
    atlasKey: undefined, replicateKey: undefined, ...overrides,
  };
  let app;
  let origin;
  const start = async (options) => {
    app = await createApp(config, options);
    origin = await app.listen({ host: config.host, port: config.port });
  };
  const stop = async () => {
    if (app) await app.close();
    app = undefined;
  };
  t.after(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
  });

  async function request(path, { body, method = body === undefined ? 'GET' : 'POST', status = 200, passcode = true } = {}) {
    const headers = passcode ? { 'x-admin-passcode': config.adminPasscode } : {};
    const isForm = body instanceof FormData;
    if (body !== undefined && !isForm) headers['content-type'] = 'application/json';
    const response = await fetch(origin + path, {
      method, headers, body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    const value = await response.text();
    assert.equal(response.status, status, `${method} ${path} returned ${value.slice(0, 400)}`);
    return JSON.parse(value);
  }

  async function stage(id, expected, timeout = 20_000) {
    const deadline = Date.now() + timeout;
    let job;
    do {
      job = await request(`/api/jobs/${id}`);
      if (job.status === expected) return job;
      assert.notEqual(job.status, 'failed', job.error);
      await delay(150);
    } while (Date.now() < deadline);
    assert.fail(`Job did not reach ${expected}. Last state was ${JSON.stringify(job)}`);
  }

  return { config, dir, start, stop, request, stage, origin: () => origin };
}

test('shared projection, all 25 rides, and fares', () => {
  assert.deepEqual(latLonToSculpture(42.354, -71.095), [0, 0]);
  const [east, north] = latLonToSculpture(42.364, -71.085);
  assert(east > 0 && north < 0);
  for (const from of STOPS) {
    for (const to of STOPS) {
      const trip = computeTripEstimate({ from_stop_id: from.stop_id, to_stop_id: to.stop_id, walk_from_stop_m: 80, wait_min: 3 });
      assert.equal(trip.walk_to_venue_min, 1.3);
      assert.equal(trip.fare, from === to ? 0 : 2.4);
      assert.equal(trip.total_min, trip.walk_to_station_min + trip.wait_min + trip.ride_min + trip.transfer_min + trip.walk_to_venue_min);
    }
  }
  assert.equal(computeTotalCost(14.50, true, 2), 38.60);
  assert.throws(() => inspectSplat(fixturePly().subarray(0, -1)), /truncated/);
});

test('HTTP catalog and live MBTA proxy plus two-way WebSocket pairing', { timeout: 20_000 }, async (t) => {
  const server = await setup(t);
  await server.start();
  const health = await server.request('/api/health');
  assert.deepEqual(health, { status: 'ok', database: 'sqlite', pipeline_mode: 'auto' });
  const [places, stops, manifest] = await Promise.all([
    server.request('/api/restaurants'), server.request('/api/stops'), server.request(`/api/restaurants/${placeId}/manifest`),
  ]);
  assert.equal(places.length, 28);
  assert.equal(stops.length, 5);
  for (const stop of stops) {
    const pins = places.filter((place) => place.stop_id === stop.stop_id).map((place) => place.pin_index);
    assert([5, 6].includes(pins.length));
    assert.equal(new Set(pins).size, pins.length);
    assert(pins.every((pin) => pin >= 0 && pin <= 7));
  }
  assert.equal(manifest.room_asset.url, '/assets-demo/room-ramen-house.ply');
  assert.equal(manifest.room_asset.provenance, 'demo_splat');
  assert.deepEqual(manifest.spawn_point, [0, 1.55, 2]);
  assert.deepEqual(manifest.menu_items.map(({ dish, dish_asset }) => [dish.price, dish_asset.plate_diameter_m]), [[14.5, 0.24], [15.75, 0.26]]);
  for (const asset of [manifest.room_asset, ...manifest.menu_items.map(({ dish_asset }) => dish_asset)]) {
    if (!findDemoAsset(server.config, asset.url.split('/').at(-1))) continue;
    const file = await fetch(server.origin() + asset.url);
    assert.equal(file.status, 200);
    const bytes = Buffer.from(await file.arrayBuffer());
    assert.equal(inspectSplat(bytes).count, asset.gaussian_count);
  }
  const [vehicles, predictions, alerts, schedules, trip] = await Promise.all([
    server.request('/api/mbta/vehicles'), server.request('/api/mbta/predictions?stop=place-bucen'),
    server.request('/api/mbta/alerts'), server.request('/api/mbta/schedules?stop=place-bucen'),
    server.request('/api/mbta/trip?from=place-kencl&to=place-bucen&walkToVenueM=80&venueLat=42.35015&venueLon=-71.10665'),
  ]);
  assert(vehicles.vehicles.length > 0);
  assert(Array.isArray(predictions.predictions));
  assert(Array.isArray(alerts.alerts));
  assert(schedules.schedules.every((item) => item.last_trip));
  assert.equal(trip.walk_to_venue_min, 1.3);
  assert.equal(trip.fare, 2.4);
  const plannerParams = new URL(trip.planner_url).searchParams;
  assert.equal(plannerParams.get('plan[from_stop_id]'), 'place-kencl');
  assert.equal(plannerParams.get('plan[to_latitude]'), '42.35015');
  t.diagnostic(`MBTA vehicles=${vehicles.source} (${vehicles.vehicles.length}), predictions=${predictions.source} (${predictions.predictions.length}), alerts=${alerts.source}, schedules=${schedules.source}`);

  const { code } = await server.request('/api/pairing/create', { method: 'POST', status: 201 });
  assert.match(code, /^\d{4}$/);
  const connect = () => {
    const socket = new WebSocket(server.origin().replace('http', 'ws') + '/ws/pair/' + code);
    return { socket, message: () => once(socket, 'message', { signal: AbortSignal.timeout(2500) }).then(([data]) => JSON.parse(data.toString())) };
  };
  const phone = connect();
  let headset;
  try {
    assert.deepEqual(await phone.message(), { type: 'peer_joined', peers: 1 });
    const paired = phone.message();
    headset = connect();
    assert.deepEqual(await headset.message(), { type: 'peer_joined', peers: 2 });
    assert.deepEqual(await paired, { type: 'peer_joined', peers: 2 });

    for (const payload of [{ type: 'open_place', place_id: placeId }, { type: 'open_dish', place_id: placeId, dish_id: 'bu-ramen-tonkotsu' }, { type: 'send_trip', trip }, { type: 'sync_filters', filters: { family_friendly: true } }]) {
      const source = payload.type === 'open_place' ? headset : phone;
      const destination = source === phone ? headset : phone;
      const incoming = destination.message();
      source.socket.send(JSON.stringify(payload));
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), await incoming);
    }
  } finally {
    await Promise.all([phone, headset].filter(Boolean).map(({ socket }) => {
      const closed = once(socket, 'close');
      socket.close();
      return closed;
    }));
  }
});

test('upload, intake, failed download with restart and retry, room and dish publication', { timeout: 40_000 }, async (t) => {
  const server = await setup(t);
  const actual = [...server.config.demoAssets];
  const tempDemo = join(server.dir, 'demo');
  await mkdir(tempDemo);
  server.config.demoAssets = [tempDemo];
  await server.start();
  const postImage = { filename: 'dining-room-a.png', mimeType: 'image/png', dataBase64: image.toString('base64'), place_id: placeId };
  await server.request('/api/uploads', { body: postImage, passcode: false, status: 401 });
  const roomUpload = await server.request('/api/uploads', { body: postImage, status: 201 });
  const form = new FormData();
  form.set('file', new Blob([image], { type: 'image/png' }), 'original-room.png');
  form.set('place_id', placeId);
  const duplicate = await server.request('/api/uploads', { body: form });
  assert.equal(duplicate.id, roomUpload.id);
  assert.equal(duplicate.deduplicated, true);
  const storedImage = await fetch(server.origin() + roomUpload.url);
  assert.equal(storedImage.status, 200);
  assert.deepEqual(Buffer.from(await storedImage.arrayBuffer()), image);
  const dishUpload = await server.request('/api/uploads', { body: { ...postImage, filename: 'ramen-dish.png', dataBase64: secondImage.toString('base64') }, status: 201 });
  const selection = await server.request('/api/intake', { body: { place_id: placeId, upload_ids: [roomUpload.id, dishUpload.id] } });
  assert.equal(selection.used_model, 'manual-heuristic-fallback');
  assert.equal(selection.manual_override_allowed, true);
  assert.deepEqual(selection.recommended_room_upload_ids, [roomUpload.id]);
  assert.equal(selection.recommended_dish_upload_id, dishUpload.id);
  const queued = await server.request('/api/jobs', { body: { kind: 'room', place_id: placeId, upload_ids: [roomUpload.id] }, status: 202 });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.provider, 'demo-sim');
  const failed = await server.stage(queued.id, 'failed');
  assert.match(failed.error, /has not been generated/);
  assert(failed.provider_task_id);
  await server.stop();

  for (const name of [room, dish, 'dish-katsu-curry.ply']) {
    const source = findDemoAsset({ ...server.config, demoAssets: actual }, name);
    t.diagnostic(`${name} input: ${source ? 'modeling asset' : 'binary PLY test fixture'}`);
    if (source) await copyFile(source, join(tempDemo, name));
    else await writeFile(join(tempDemo, name), fixturePly());
  }

  await server.start();
  const seededManifest = await server.request(`/api/restaurants/${placeId}/manifest`);
  for (const asset of [seededManifest.room_asset, ...seededManifest.menu_items.map(({ dish_asset }) => dish_asset)]) {
    const served = await fetch(server.origin() + asset.url);
    assert.equal(served.status, 200);
    const bytes = Buffer.from(await served.arrayBuffer());
    assert.equal(inspectSplat(bytes).count, asset.gaussian_count);
  }
  const retried = await server.request(`/api/jobs/${queued.id}/retry`, { body: {}, status: 202 });
  assert.equal(retried.status, 'downloading');
  assert.equal(retried.provider_task_id, failed.provider_task_id);
  const reviewed = await server.stage(queued.id, 'needs_review');
  assert.deepEqual(await readFile(reviewed.original_ply_path), await readFile(join(tempDemo, room)));
  const asset = await server.request(`/api/assets/${reviewed.asset_id}`);
  assert.equal(asset.provenance, 'demo_splat');
  assert(asset.gaussian_count > 0);
  assert.equal(asset.metadata.target_gaussians, 100000);
  assert(asset.metadata.splat_transform_command.includes('.sog'));
  assert.equal((await fetch(server.origin() + asset.url)).status, 200);
  const published = await server.request(`/api/assets/${asset.id}/publish`, {
    body: { approve: true, spawn_point: [0.1, 1.55, 2], rotation_y: 30 },
  });
  assert.equal(published.status, 'ready');
  assert.equal(published.transform.rotation[1], 30);
  await server.stage(queued.id, 'ready');

  const dishJob = await server.request('/api/jobs', { body: {
    kind: 'dish', place_id: placeId, upload_ids: [dishUpload.id], dish_id: 'bu-ramen-tonkotsu',
  }, status: 202 });
  const dishReview = await server.stage(dishJob.id, 'needs_review');
  const dishAsset = await server.request(`/api/assets/${dishReview.asset_id}/publish`, { body: { plate_diameter_m: 0.25 } });
  assert.equal(dishAsset.scale_status, 'measured');
  assert.equal(dishAsset.scale_factor, 0.25 / dishAsset.metadata.measured_width);
  assert.equal(dishAsset.metadata.target_gaussians, 60000);
  assert.equal((await fetch(server.origin() + dishAsset.preview_url)).status, 200);
  const updated = await server.request(`/api/restaurants/${placeId}/manifest`);
  assert.deepEqual(updated.spawn_point, [0.1, 1.55, 2]);
  assert.equal(updated.room_asset.id, asset.id);
  assert.equal(updated.menu_items[0].dish_asset.id, dishAsset.id);
  assert.equal(updated.menu_items[1].dish_asset.url, '/assets-demo/dish-katsu-curry.ply');
  assert.equal((await server.request('/api/jobs')).length, 2);
});

test('provider request contracts and TRELLIS retry preserve the paid prediction', { timeout: 40_000 }, async (t) => {
  const server = await setup(t, { geminiKey: 'test-gemini', replicateKey: 'test-trellis' });
  await server.start();
  const originalFetch = globalThis.fetch;
  const ply = fixturePly();
  let imageId;
  let trellisSubmissions = 0;
  let previewDownloads = 0;
  let plyDownloads = 0;
  const json = (body) => Response.json(body);
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    const payload = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    if (url.hostname === 'generativelanguage.googleapis.com') {
      assert.equal(url.pathname, '/v1beta/models/gemini-4-hydrogen:generateContent');
      assert.equal(init.headers['x-goog-api-key'], 'test-gemini');
      assert.equal(payload.generationConfig.responseMimeType, 'application/json');
      assert.deepEqual(payload.contents[0].parts[2].inlineData, { mimeType: 'image/png', data: image.toString('base64') });
      return json({ candidates: [{ content: { parts: [{ text: JSON.stringify({
        restaurant_id: placeId,
        room_groups: [{ group_id: 'room', label: 'Room', upload_ids: [imageId], confidence: 0.95, reason: 'Matching dining tables' }],
        recommended_room_upload_ids: [imageId], recommended_dish_upload_id: null, flagged: [],
        used_model: 'gemini-4-hydrogen', manual_override_allowed: true,
      }) }] } }] });
    }
    if (url.hostname === 'api.replicate.com') {
      assert.equal(init.headers.Authorization, 'Bearer test-trellis');
      if (init.method === 'POST') {
        trellisSubmissions++;
        assert.equal(url.pathname, '/v1/predictions');
        assert.equal(payload.version, 'e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c');
        assert.deepEqual(payload.input, {
          images: [`data:image/png;base64,${image.toString('base64')}`],
          save_gaussian_ply: true, generate_model: false, generate_color: false, generate_normal: false, return_no_background: true,
        });
        return json({ id: 'prediction-01', status: 'starting' });
      }
      assert.equal(url.pathname, '/v1/predictions/prediction-01');
      return json({
        id: 'prediction-01', status: 'succeeded',
        output: { gaussian_ply: 'https://files.example/trellis.ply', no_background_images: ['https://files.example/preview.png'] },
      });
    }
    if (url.hostname === 'files.example') {
      switch (url.pathname) {
        case '/trellis.ply':
          plyDownloads++;
          return new Response(ply);
        case '/preview.png':
          previewDownloads++;
          if (previewDownloads === 1) return new Response(null, { status: 503 });
          return new Response(image, { headers: { 'Content-Type': 'image/png' } });
        default:
          assert.fail(`Unexpected download ${url.pathname}`);
      }
    }
    return originalFetch(input, init);
  });

  const upload = await server.request('/api/uploads', { body: {
    filename: 'room.png', mimeType: 'image/png', dataBase64: image.toString('base64'), place_id: placeId,
  }, status: 201 });
  imageId = upload.id;
  const intake = await server.request('/api/intake', { body: { place_id: placeId, upload_ids: [imageId] } });
  assert.equal(intake.used_model, 'gemini-4-hydrogen');
  const dishJob = await server.request('/api/jobs', { body: {
    kind: 'dish', place_id: placeId, upload_ids: [imageId], dish_name: 'Other dish',
  }, status: 202 });
  const dishFailed = await server.stage(dishJob.id, 'failed');
  assert.equal(dishFailed.provider_task_id, 'prediction-01');
  assert.deepEqual(await readFile(dishFailed.original_ply_path), ply);

  await server.stop();
  await server.start();
  const retried = await server.request(`/api/jobs/${dishJob.id}/retry`, { body: {}, status: 202 });
  assert.equal(retried.status, 'downloading');
  const dishReview = await server.stage(dishJob.id, 'needs_review');
  assert.equal(dishReview.provider_task_id, 'prediction-01');
  assert.deepEqual(await readFile(dishReview.preview_image_path), image);
  assert.equal(trellisSubmissions, 1);
  assert.equal(plyDownloads, 1);
  assert.equal(previewDownloads, 2);
});

test('Atlas Draft request contract resumes from saved pose, splat and download checkpoints', { timeout: 50_000 }, async (t) => {
  const server = await setup(t, { atlasKey: 'test-atlas', atlasBaseUrl: 'https://atlas.example/api/v2' });
  await server.start();
  const originalFetch = globalThis.fetch;
  const count = 5;
  const raw = Buffer.alloc(16 + count * 20);
  raw.write('NGSP');
  raw.writeUInt32LE(3, 4);
  raw.writeUInt32LE(count, 8);
  raw[13] = 12;
  const spz = gzipSync(raw);
  const photos = [image, secondImage];
  const camera = {
    extrinsics: { coordinateSystem: 'rub', quaternion: [0, 0, 0, 1], position: [0, 0, 0] },
    intrinsics: { width: 1280, height: 720, fx: 600, fy: 600, cx: 640, cy: 360 },
  };
  const posedFrames = photos.map((_, index) => ({
    imageAsset: { assetId: `image-${index}` }, depth: { depthAsset: { assetId: `depth-${index}` } }, camera,
  }));
  const calls = [];
  let jobId;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.hostname === 'files.example') {
      assert.equal(init.headers, undefined);
      calls.push(url.pathname);
      if (url.pathname === '/draft.spz') {
        return new Response(null, { status: calls.filter((path) => path === '/draft.spz').length === 1 ? 503 : 403 });
      }
      assert.equal(url.pathname, '/fresh.spz');
      return new Response(spz);
    }
    if (url.hostname !== 'atlas.example') return originalFetch(input, init);
    assert.equal(init.headers['WLT-Api-Key'], 'test-atlas');
    assert(url.pathname.startsWith('/api/v2/'));
    const path = url.pathname.slice('/api/v2'.length);
    calls.push(path);
    const hits = calls.filter((call) => call === path).length;
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    switch (path) {
      case '/assets':
        assert.equal(init.method, 'POST');
        assert.deepEqual(body, { asset: { displayName: `room-${hits - 1}.png`, base64: `data:image/png;base64,${photos[hits - 1].toString('base64')}` } });
        return Response.json({ id: `input-${hits - 1}` }, { status: 201 });
      case '/tasks:images2PosedRGBD':
        assert.equal(init.method, 'POST');
        assert.equal(init.headers['Idempotency-Key'], `${jobId}-pose`);
        assert.deepEqual(body, {
          base64Outputs: false, frames: [{ imageAsset: { assetId: 'input-0' } }, { imageAsset: { assetId: 'input-1' } }],
          canonicalizeToFirstFrame: true, refinePoses: true, targetResolution: [1280, 720],
        });
        return Response.json({ id: 'pose-01', done: false });
      case '/operations/pose-01':
        assert.equal(init.method, 'GET');
        if (hits === 1) return new Response(null, { status: 503 });
        return Response.json({ id: 'pose-01', done: true, response: { frames: posedFrames.map((frame) => ({
          ...frame, imageAsset: { ...frame.imageAsset, url: 'https://files.example/posed.png' },
          depth: { ...frame.depth, confidenceAsset: { assetId: 'unused' } }, centroidWorld: [0, 0, 0],
        })) } });
      case '/tasks:posedImages2Splats':
        assert.equal(init.method, 'POST');
        assert.equal(init.headers['Idempotency-Key'], `${jobId}-splats`);
        assert.deepEqual(body, { refine: false, posedFrames });
        if (hits === 1) throw new TypeError('Connection closed after Atlas accepted the request');
        return Response.json({ id: 'splat-01', done: false });
      case '/operations/splat-01':
        assert.equal(init.method, 'GET');
        if (hits === 1) return Response.json({ id: 'splat-01', done: false });
        return Response.json({ id: 'splat-01', done: true, response: {
          draftSplat: { assetId: 'draft-01', url: 'https://files.example/draft.spz' }, refinedSplats: {},
        } });
      case '/assets/draft-01:createReadUrl':
        assert.equal(init.method, 'POST');
        return Response.json({ readUrl: 'https://files.example/fresh.spz' });
      default:
        assert.fail(`Unexpected Atlas request ${path}`);
    }
  });

  const ids = [];
  for (const [index, bytes] of photos.entries()) {
    const upload = await server.request('/api/uploads', { body: {
      filename: `room-${index}.png`, mimeType: 'image/png', dataBase64: bytes.toString('base64'), place_id: placeId,
    }, status: 201 });
    ids.push(upload.id);
  }
  const jobInput = { kind: 'room', place_id: placeId, upload_ids: ids };
  const single = await server.request('/api/jobs', { body: { ...jobInput, upload_ids: ids.slice(0, 1) }, status: 400 });
  assert.equal(single.error, 'Atlas room reconstruction requires 2 to 32 overlapping photos.');
  const job = await server.request('/api/jobs', { body: jobInput, status: 202 });
  jobId = job.id;
  assert.equal(job.provider, 'atlas-v2');
  assert.equal(job.model_tier, 'atlas-draft');

  async function restartAndRetry(expectedStage) {
    await server.stop();
    await server.start();
    const retry = await server.request(`/api/jobs/${jobId}/retry`, { body: {}, status: 202 });
    assert.equal(retry.status, expectedStage);
  }
  const posingFailed = await server.stage(jobId, 'failed');
  assert.equal(posingFailed.pose_operation_id, 'pose-01');
  assert.equal(posingFailed.provider_task_id, null);
  await restartAndRetry('generating');

  const submissionFailed = await server.stage(jobId, 'failed');
  assert.match(submissionFailed.error, /Connection closed/);
  const db = new DatabaseSync(server.config.database, { readOnly: true });
  try {
    const record = JSON.parse(db.prepare('SELECT data FROM jobs WHERE id = ?').get(jobId).data);
    assert.deepEqual(record.posed_frames, posedFrames);
  } finally {
    db.close();
  }
  await restartAndRetry('generating');

  const downloadFailed = await server.stage(jobId, 'failed');
  assert.equal(downloadFailed.provider_task_id, 'splat-01');
  assert.match(downloadFailed.error, /Asset download returned HTTP 503/);
  await restartAndRetry('downloading');

  const reviewed = await server.stage(jobId, 'needs_review');
  assert.equal(reviewed.pose_operation_id, 'pose-01');
  assert.equal(reviewed.provider_task_id, 'splat-01');
  assert.equal(reviewed.original_spz_path, join(server.config.outputs, `${jobId}-original.spz`));
  assert.deepEqual(await readFile(reviewed.original_spz_path), spz);
  const asset = await server.request(`/api/assets/${reviewed.asset_id}`);
  assert.equal(asset.backend, 'atlas-draft');
  assert.equal(asset.gaussian_count, count);
  assert.equal(asset.original_spz_url, `/storage/outputs/${jobId}-original.spz`);
  assert.equal(asset.metadata.conversion_status, asset.format === 'sog' ? 'compressed' : 'spz_fallback');
  const served = await fetch(server.origin() + asset.original_spz_url);
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), spz);
  assert.deepEqual(calls, [
    '/assets', '/assets', '/tasks:images2PosedRGBD', '/operations/pose-01', '/operations/pose-01',
    '/tasks:posedImages2Splats', '/tasks:posedImages2Splats', '/operations/splat-01', '/operations/splat-01',
    '/draft.spz', '/draft.spz', '/assets/draft-01:createReadUrl', '/fresh.spz',
  ]);
});

test('Atlas Refined sends refine=true and selects the highest published splat count', async (t) => {
  const config = { atlasKey: 'test-atlas', atlasBaseUrl: 'https://atlas.example/api/v2' };
  t.mock.method(globalThis, 'fetch', (input, init) => {
    if (init.method === 'POST') {
      assert.equal(input, 'https://atlas.example/api/v2/tasks:posedImages2Splats');
      assert.equal(init.headers['Idempotency-Key'], 'job-refined-splats');
      assert.equal(JSON.parse(init.body).refine, true);
      return Response.json({ id: 'refined-op', done: false });
    }
    assert.equal(input, 'https://atlas.example/api/v2/operations/refined-op');
    return Response.json({ done: true, response: { refinedSplats: {
      '900000': { assetId: 'small' }, '2000000': { assetId: 'large' },
    } } });
  });
  const id = await submitAtlasSplats(config, 'job-refined', [], true);
  assert.deepEqual(await pollAtlasSplats(config, id, true), { assetId: 'large' });
});

test('MBTA rate-limit fallback keeps all seven subway routes and labels estimates', { timeout: 10_000 }, async (t) => {
  const server = await setup(t);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    if (new URL(input).hostname === 'api-v3.mbta.com') {
      requests++;
      return Promise.resolve(new Response(null, { status: 429 }));
    }
    return originalFetch(input, init);
  });
  await server.start();
  const vehicles = await server.request('/api/mbta/vehicles');
  assert.equal(vehicles.source, 'simulated');
  assert.deepEqual([...new Set(vehicles.vehicles.map((vehicle) => vehicle.route_id))], ['Green-B', 'Green-C', 'Green-D', 'Green-E', 'Red', 'Orange', 'Blue']);
  assert.deepEqual(await server.request('/api/mbta/vehicles'), vehicles);
  assert.equal(requests, 1);
  const predictions = await server.request('/api/mbta/predictions?stop=place-bucen');
  assert.equal(predictions.source, 'simulated');
  assert(predictions.predictions.length >= 6);
  const trip = await server.request('/api/mbta/trip?from=place-bucen&to=place-brico');
  assert.equal(trip.prediction_source, 'simulated');
  assert.equal(trip.schedule_source, 'simulated');
  assert(Number.isFinite(Date.parse(trip.last_train_time)));
});
