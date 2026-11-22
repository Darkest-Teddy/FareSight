import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { crc32, gunzipSync, gzipSync } from 'node:zlib';
import { WebSocket } from 'ws';
import { computeTotalCost, computeTripEstimate, demoAssets, demoDishPriceSources, demoPlaces, formatDishPrice, latLonToSculpture, STOPS } from '@faresight/shared';
import { createApp } from '../dist/app.js';
import { getConfig } from '../dist/config.js';
import { Store, WorkerLeaseLost } from '../dist/db/database.js';
import { demoSchedules } from '../dist/routes/mbtaDemo.js';
import { downloadFile } from '../dist/services/providerHttp.js';
import { pollAtlasSplats, submitAtlasSplats } from '../dist/services/atlasClient.js';
import { findDemoAsset } from '../dist/services/demoAssets.js';
import { inspectSplat } from '../dist/services/splatProcessor.js';
import { fetchLiveReviews } from '../dist/services/liveReviews.js';

const room = 'room-study-cafe.ply';
const dish = 'dish-matcha-tiramisu.ply';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64');
const secondImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const placeId = 'harvard-cafe-01';

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
    atlasKey: undefined, replicateKey: undefined, captures: undefined, autoPublish: false, ...overrides,
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
    try { await stop(); } finally { await rm(dir, { recursive: true, force: true }); }
  });

  async function request(path, { body, method = body === undefined ? 'GET' : 'POST', status = 200, passcode = true, headers: extraHeaders = {} } = {}) {
    const headers = passcode ? { 'x-admin-passcode': config.adminPasscode, ...extraHeaders } : { ...extraHeaders };
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
  const originalFetch = globalThis.fetch;
  if (process.env.FARESIGHT_TEST_LIVE_MBTA !== '1') {
    t.mock.method(globalThis, 'fetch', (input, init) => {
      const url = new URL(input);
      if (url.hostname !== 'api-v3.mbta.com') return originalFetch(input, init);
      return Promise.resolve(Response.json({ data: url.pathname === '/vehicles' ? [{
        id: 'vehicle-1', type: 'vehicle',
        attributes: { latitude: 42.35, longitude: -71.1, direction_id: 1, updated_at: '2026-11-21T14:00:00Z' },
        relationships: { route: { data: { id: 'Green-B' } } },
      }] : [] }));
    });
  }
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
    assert([5, 6, 7].includes(pins.length));
    assert.equal(new Set(pins).size, pins.length);
    assert(pins.every((pin) => pin >= 0 && pin <= 7));
  }
  assert.equal(manifest.room_asset.url, '/assets-demo/room-study-cafe.ply');
  assert.equal(manifest.room_asset.provenance, 'demo_splat');
  assert.deepEqual(manifest.spawn_point, [0, 1.55, 2.1]);
  assert.deepEqual(manifest.menu_items.map(({ dish, dish_asset }) => [dish.price, dish_asset.plate_diameter_m]), [[9.25, 0.18]]);
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
    server.request('/api/mbta/trip?from=place-kencl&to=place-bucen&walkToVenueM=290&venueLat=42.34908&venueLon=-71.10358'),
  ]);
  assert(vehicles.vehicles.length > 0);
  if (process.env.FARESIGHT_TEST_LIVE_MBTA !== '1') assert.equal(vehicles.source, 'live');
  assert(Array.isArray(predictions.predictions));
  assert(Array.isArray(alerts.alerts));
  assert(schedules.schedules.every((item) => item.last_trip));
  assert.equal(trip.walk_to_venue_min, 290 * 1.3 / 80);
  assert.equal(trip.fare, 2.4);
  const plannerParams = new URL(trip.planner_url).searchParams;
  assert.equal(plannerParams.get('plan[from_stop_id]'), 'place-kencl');
  assert.equal(plannerParams.get('plan[to_latitude]'), '42.34908');
  t.diagnostic(`MBTA vehicles=${vehicles.source} (${vehicles.vehicles.length}), predictions=${predictions.source} (${predictions.predictions.length}), alerts=${alerts.source}, schedules=${schedules.source}`);

  const { code } = await server.request('/api/pairing/create', { method: 'POST', status: 201 });
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
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

    for (const payload of [{ type: 'open_place', place_id: placeId }, { type: 'open_dish', place_id: placeId, dish_id: 'harvard-matcha-tiramisu' }, { type: 'send_trip', trip }, { type: 'sync_filters', filters: { family_friendly: true } }]) {
      const source = payload.type === 'open_place' ? headset : phone;
      const destination = source === phone ? headset : phone;
      const incoming = destination.message();
      source.socket.send(JSON.stringify(payload));
      assert.deepEqual(JSON.parse(JSON.stringify(payload)), await incoming);
    }
    const destination = headset.message();
    phone.socket.send(JSON.stringify({ type: 'sync_filters', filters: { max_price: 'invalid' } }));
    phone.socket.send(JSON.stringify({ type: 'send_trip', trip: { ...trip, planner_url: 'https://mbta.com.example/planner' } }));
    const { planner_url, ...safeTrip } = trip;
    assert.deepEqual(await destination, { type: 'send_trip', trip: safeTrip });
  } finally {
    await Promise.all([phone, headset].filter(Boolean).map(({ socket }) => {
      if (socket.readyState === WebSocket.CLOSED) return;
      return new Promise((resolve) => {
        socket.on('error', () => {});
        socket.once('close', resolve);
        socket.terminate();
      });
    }));
  }
});

test('catalog startup refreshes bundled SOG previews and preserves uploaded assets', async (t) => {
  const server = await setup(t);
  await server.start({ worker: false });
  await server.stop();
  const db = new DatabaseSync(server.config.database);
  try {
    const getPlace = (id) => JSON.parse(db.prepare('SELECT data FROM places WHERE id = ?').get(id).data);
    const putPlace = (place) => db.prepare('UPDATE places SET data = ? WHERE id = ?').run(JSON.stringify(place), place.id);
    const jefes = getPlace('kenmore-jefes-01');
    const [tacos, burrito] = jefes.dishes;
    putPlace({ ...jefes, room_asset_id: null, dishes: [{ ...tacos, name: "El Jefe's Tacos (Three)", price: 15.5 }, burrito],
      seed_status: 'planning_estimate', price_checked_on: '1990-01-01' });
    const shu = getPlace('kenmore-shudaxia-01');
    const [shrimp, beef] = shu.dishes;
    putPlace({ ...shu, dishes: [{ ...shrimp, name: 'Dual-Broth (Yin-Yang) Hot Pot', price: null },
      { ...beef, name: 'Marbled Beef Mountain', price: null }] });
    const starbucks = getPlace('bu-starbucks-01');
    putPlace({ ...starbucks, dishes: starbucks.dishes.slice(0, 2) });
    const cafe = getPlace(placeId);
    const [tiramisu] = cafe.dishes;
    putPlace({ ...cafe, room_asset_id: 'uploaded-room', dishes: [
      { ...tiramisu, price: 13 },
      { ...tiramisu, id: 'obsolete-demo-dish', asset_id: 'obsolete-demo-preview' },
      { ...tiramisu, id: 'uploaded-dish', name: 'Uploaded appetizer', asset_id: 'uploaded-discrete-preview' },
    ] });
    const retired = { ...cafe, id: 'bu-ramen-01' };
    const insertRetired = db.prepare('INSERT INTO places VALUES (?, ?)');
    insertRetired.run(retired.id, JSON.stringify(retired));
    const retiredKaraoke = { ...retired, id: 'allston-karaoke-01' };
    insertRetired.run(retiredKaraoke.id, JSON.stringify(retiredKaraoke));
    db.prepare('INSERT INTO uploads (id, data) VALUES (?, ?)').run('retired-image', JSON.stringify({ id: 'retired-image', sha256: 'retired-hash' }));
    db.prepare('INSERT INTO upload_places VALUES (?, ?)').run('retired-image', retired.id);
    db.prepare('INSERT INTO reviews VALUES (?, ?)').run('retired-review', JSON.stringify({ id: 'retired-review', place_id: retired.id }));
    putPlace({ ...getPlace(placeId), stop_id: 'old-stop', pin_index: 99, rooms: [], seat_views: [], typical_price: 999,
      cravings: ['stale'], family_friendly: !cafe.family_friendly, evening_venue: !cafe.evening_venue,
      reviews: [{ id: 'runtime-review', author: 'Diner', rating: 3, text: 'Good', created_at: '' }] });
    const putAsset = (asset) => db.prepare('INSERT OR REPLACE INTO assets VALUES (?, ?)').run(asset.id, JSON.stringify(asset));
    const asset = (id) => demoAssets.find((asset) => asset.id === id);
    putAsset({ ...asset('kenmore-jefes-01-room'), format: 'ply', url: '/assets-demo/room-study-cafe.ply', gaussian_count: 0 });
    putAsset({ ...asset('kenmore-shudaxia-01-room'), gaussian_count: 349_369 });
    putAsset({ ...asset('bu-starbucks-macchiato-splat'), gaussian_count: 0 });
    putAsset({ ...asset(tiramisu.asset_id), id: 'obsolete-demo-preview' });
    putAsset({ ...asset(tiramisu.asset_id), id: 'uploaded-discrete-preview', backend: 'trellis', format: 'sog', url: '/storage/outputs/appetizer.sog' });
    putAsset({ ...asset(cafe.room_asset_id), id: 'uploaded-room', backend: 'atlas', format: 'sog', url: '/storage/outputs/uploaded-room.sog' });
  } finally {
    db.close();
  }
  await server.start({ worker: false });
  const results = await Promise.all([placeId, 'kenmore-jefes-01', 'kenmore-shudaxia-01', 'bu-starbucks-01']
    .map((id) => server.request(`/api/restaurants/${id}/manifest`)));
  const [cafe, jefes, shu, starbucks] = results;
  await server.request('/api/restaurants/bu-ramen-01', { status: 404 });
  await server.request('/api/restaurants/allston-karaoke-01', { status: 404 });
  const restartedDb = new DatabaseSync(server.config.database);
  try {
    assert.equal(restartedDb.prepare('SELECT * FROM upload_places WHERE place_id = ?').get('bu-ramen-01'), undefined);
    assert.equal(restartedDb.prepare('SELECT * FROM reviews WHERE id = ?').get('retired-review'), undefined);
    assert.ok(restartedDb.prepare('SELECT * FROM uploads WHERE id = ?').get('retired-image'));
  } finally {
    restartedDb.close();
  }
  const refreshed = await server.request(`/api/restaurants/${placeId}`);
  const seed = demoPlaces.find(({ id }) => id === placeId);
  for (const field of ['stop_id', 'pin_index', 'typical_price', 'cravings', 'family_friendly', 'evening_venue', 'seat_views']) {
    assert.deepEqual(refreshed[field], seed[field]);
  }
  assert.equal(refreshed.reviews.find(({ id }) => id === 'runtime-review').rating, 3);
  assert.deepEqual(refreshed.rooms.map(({ id }) => id), seed.rooms.map(({ id }) => id));
  assert.equal(cafe.room_asset.id, 'uploaded-room');
  assert.equal(cafe.menu_items.length, 2);
  assert.equal(cafe.menu_items[0].dish_asset.url, '/assets-demo/dish-matcha-tiramisu.ply');
  assert.equal(cafe.menu_items[0].dish.price, 9.25);
  assert.equal(cafe.menu_items[1].dish.name, 'Uploaded appetizer');
  assert.equal(cafe.menu_items[1].dish_asset.url, '/storage/outputs/appetizer.sog');
  assert.equal(jefes.restaurant.price_checked_on, demoPlaces.find(({ id }) => id === 'kenmore-jefes-01').price_checked_on);
  for (const [manifest, name, count] of [[jefes, 'eljefes', 344_961], [shu, 'shudaxia', 349_370], [starbucks, 'starbucks', 349_990]]) {
    assert.equal(manifest.room_asset.url, `/assets-demo/room-${name}-atlas.sog`);
    assert.equal(manifest.room_asset.format, 'sog');
    assert.equal(manifest.room_asset.gaussian_count, count);
    assert.deepEqual(manifest.spawn_point, [0, 1.55, 2]);
  }
  const bundled = [jefes, shu, starbucks].flatMap(({ menu_items }) => menu_items);
  assert.deepEqual([jefes, shu, starbucks].map(({ menu_items }) => menu_items.length), [6, 29, 27]);
  assert.equal(new Set(bundled.map(({ dish }) => dish.id)).size, 62);
  assert.equal(new Set(bundled.map(({ dish_asset }) => dish_asset.url)).size, 62);
  assert.ok(bundled.every(({ dish_asset }) =>
    dish_asset.format === 'sog' && dish_asset.scale_status === 'approximate' &&
    dish_asset.gaussian_count >= 59_000 && dish_asset.gaussian_count <= 60_000));
  // These two publish no price of their own; the price agent filled what it could cite and left the rest null.
  assert.deepEqual([jefes, starbucks].map(({ menu_items }) => menu_items.filter(({ dish }) => dish.price === null).length), [1, 22]);
  assert.ok(demoDishPriceSources.length > 0);
  assert.ok(demoDishPriceSources.every(({ items }) => items.length > 0
    && items.every(({ price, source, url }) => price > 0 && source && url.startsWith('https://'))));
  assert.deepEqual(shu.menu_items.map(({ dish }) => dish.price), [
    15, 12.5, 15, 18, 13, 16, 17, 13, 24, 21, 12, 9, 15, 13, 10, 14, 9.5, 8, 7, 5, 14.5, 4.5, 15.5, 4, 6.5, 12, 7, 6, 6.5,
  ]);
  const preview = (id) => {
    const { dish, dish_asset } = bundled.find(({ dish }) => dish.id === id);
    return [dish.name, dish.price, dish_asset.gaussian_count, dish_asset.plate_diameter_m];
  };
  assert.deepEqual(preview('kenmore-jefes-tacos'), ['Tacos (Three)', 12.45, 60_000, 0.22]);
  assert.deepEqual(preview('kenmore-jefes-burrito'), ['Carnitas Burrito', 12.45, 60_000, 0.22]);
  assert.deepEqual(preview('kenmore-shudaxia-hotpot'), ['Taiji Shrimp Paste 2.0', 15, 59_998, 0.32]);
  assert.deepEqual(preview('kenmore-shudaxia-beef'), ['Premium Fatty Beef Slice', 12.5, 59_938, 0.26]);
  assert.deepEqual(preview('bu-starbucks-macchiato'), ['Iced Caramel Macchiato', null, 60_000, 0.095]);
  assert.deepEqual(preview('bu-starbucks-croissant'), ['Butter Croissant', null, 60_000, 0.16]);
  const catalog = await server.request('/api/restaurants');
  for (const manifest of [jefes, shu, starbucks]) {
    const listing = catalog.find(({ id }) => id === manifest.restaurant.id);
    assert.deepEqual(listing.dishes.map(({ id, name, price }) => [id, name, price]),
      manifest.menu_items.map(({ dish }) => [dish.id, dish.name, dish.price]));
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
  assert.equal((await fetch(server.origin() + roomUpload.url)).status, 401);
  const storedImage = await fetch(server.origin() + roomUpload.url, { headers: { 'X-Admin-Passcode': server.config.adminPasscode } });
  assert.equal(storedImage.status, 200);
  assert.deepEqual(Buffer.from(await storedImage.arrayBuffer()), image);
  const dishUpload = await server.request('/api/uploads', { body: { ...postImage, filename: 'cafe-dish.png', dataBase64: secondImage.toString('base64') }, status: 201 });
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

  for (const name of [room, dish]) {
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
  assert.equal((await fetch(server.origin() + asset.url)).status, 401);
  assert.equal((await fetch(server.origin() + asset.url, { headers: { 'X-Admin-Passcode': server.config.adminPasscode } })).status, 200);
  await server.request(`/api/jobs/${asset.id}/publish`, { body: {}, passcode: false, status: 401 });
  await server.request(`/api/assets/${asset.id}/publish`, { body: {}, passcode: false, status: 401 });
  const published = await server.request(`/api/assets/${asset.id}/publish`, {
    body: { approve: true, spawn_point: [0.1, 1.55, 2], rotation_y: 30 },
  });
  assert.equal(published.status, 'ready');
  assert.equal((await fetch(server.origin() + asset.url)).status, 200);
  assert.equal(published.transform.rotation[1], 30);
  await server.stage(queued.id, 'ready');

  const dishJob = await server.request('/api/jobs', { body: {
    kind: 'dish', place_id: placeId, upload_ids: [dishUpload.id], dish_id: 'harvard-matcha-tiramisu', dish_price: 9.25,
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
        output: { gaussian_ply: 'https://replicate.delivery/trellis.ply', no_background_images: ['https://replicate.delivery/preview.png'] },
      });
    }
    if (url.hostname === 'replicate.delivery') {
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
    kind: 'dish', place_id: placeId, upload_ids: [imageId], dish_name: 'Other dish', dish_price: 11,
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
  const moderation = (action) => server.request('/api/admin/moderation', {
    body: { type: 'upload', action, id: dishReview.asset_id },
  });
  const approved = await moderation('approve');
  const manifestUrl = `/api/restaurants/${placeId}/manifest`;
  const published = await server.request(manifestUrl);
  assert.equal(published.menu_items.find(({ dish }) => dish.name === 'Other dish').dish_asset.id, approved.id);
  assert.equal((await moderation('reject')).status, 'rejected');
  const rejected = await server.request(`/api/jobs/${dishJob.id}`);
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.status_message, 'Asset rejected');
  assert.equal((await server.request(manifestUrl)).menu_items.find(({ dish }) => dish.name === 'Other dish').dish_asset, null);
  assert.equal((await fetch(server.origin() + approved.url)).status, 404);
  await server.request(`/api/jobs/${dishJob.id}/retry`, { body: {}, status: 409 });
});

test('Atlas Draft request contract resumes from saved pose, splat and download checkpoints', { timeout: 50_000 }, async (t) => {
  const server = await setup(t, { atlasKey: 'test-atlas', atlasBaseUrl: 'https://atlas.example/api/v2' });
  await server.start();
  const originalFetch = globalThis.fetch;
  const count = 5;
  const raw = Buffer.alloc(16 + count * 19);
  raw.write('NGSP');
  raw.writeUInt32LE(2, 4);
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
    if (url.hostname === 'storage.googleapis.com') {
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
          ...frame, imageAsset: { ...frame.imageAsset, url: 'https://storage.googleapis.com/posed.png' },
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
          draftSplat: { assetId: 'draft-01', url: 'https://storage.googleapis.com/draft.spz' }, refinedSplats: {},
        } });
      case '/assets/draft-01:createReadUrl':
        assert.equal(init.method, 'POST');
        return Response.json({ readUrl: 'https://storage.googleapis.com/fresh.spz' });
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
  const served = await fetch(server.origin() + asset.original_spz_url, { headers: { 'X-Admin-Passcode': server.config.adminPasscode } });
  assert.equal(served.status, 200);
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), spz);
  if (asset.format === 'spz') {
    const viewer = await fetch(server.origin() + asset.url, { headers: { 'X-Admin-Passcode': server.config.adminPasscode } });
    assert.equal(viewer.status, 200);
    assert.equal(gunzipSync(Buffer.from(await viewer.arrayBuffer())).readUInt32LE(4), 3);
  }
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

test('live web reviews deduplicate lookups, retain only sourced reviews, and fall back to catalog facts', async (t) => {
  const off = await setup(t, { openaiKey: undefined });
  await off.start({ worker: false });
  const venuePath = '/api/restaurants/bu-pavement-01';
  const place = await off.request(venuePath);
  const fallback = await off.request(venuePath + '/live-reviews');
  assert.equal(fallback.live, false);
  assert.deepEqual(fallback.ratings, place.details.ratings);
  assert.deepEqual(fallback.highlights, place.details.review_highlights);
  assert.deepEqual(fallback.reviews, []);
  await off.request('/api/restaurants/missing/live-reviews', { status: 404 });

  const server = await setup(t, { openaiKey: 'test-review-key', openaiBaseUrl: 'https://reviews.example/v1' });
  const originalFetch = globalThis.fetch;
  const source = 'https://www.yelp.com/biz/example-review-page';
  let requests = 0;
  let payload;
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (new URL(input).hostname !== 'reviews.example') return originalFetch(input, init);
    requests++;
    assert.equal(new URL(input).pathname, '/v1/responses');
    assert.equal(init.redirect, 'error');
    payload = JSON.parse(init.body);
    if (!payload.input.includes(place.name)) return Response.json({ error: { message: 'test-review-key upstream detail' } }, { status: 502 });
    started.resolve();
    await release.promise;
    const excerpt = { author: 'Example Reviewer', text: 'The patio was quiet.', source: 'Yelp', rating: 4, date_label: 'November 2026', url: source };
    return Response.json({ status: 'completed', output: [
      null, { type: 'web_search_call', action: { sources: [null, { url: source }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        ratings: [null, { source: 'Yelp', rating: 4.2, count: 52, url: source }],
        highlights: [{ text: 'Customers mention a quiet patio.', url: source }],
        reviews: [null, excerpt, excerpt, { ...excerpt, url: 'https://unverified.example/review' }],
      }) }] },
    ] });
  });

  await server.start({ worker: false });
  const firstRequest = server.request(venuePath + '/live-reviews');
  let overlap;
  try {
    await Promise.race([started.promise, firstRequest.then(() => assert.fail('Lookup finished before the upstream request'))]);
    overlap = fetchLiveReviews(place, server.config, '127.0.0.1');
    assert.equal(requests, 1);
  } finally {
    release.resolve();
  }
  const [first, parallel] = await Promise.all([firstRequest, overlap]);
  assert.equal(first.place_id, place.id);
  assert.equal(first.live, true);
  assert.ok(Number.isFinite(Date.parse(first.fetched_at)));
  assert.deepEqual(parallel, first);
  assert.deepEqual(await server.request(venuePath + '/live-reviews'), first);
  assert.equal(requests, 1);
  assert.deepEqual(payload.tools, [{ type: 'web_search' }]);
  assert.equal(payload.model, server.config.openaiLiveBackendModel);
  assert.equal(payload.text.format.type, 'json_schema');
  assert.equal(payload.text.format.strict, true);
  assert.ok(payload.input.includes(place.details.address));
  assert.deepEqual(first.ratings, [{ source: 'Yelp', rating: 4.2, count: 52, url: source }]);
  assert.deepEqual(first.highlights, ['Customers mention a quiet patio.']);
  assert.equal(first.reviews.length, 1);
  assert.match(first.reviews[0].id, /^live-/);
  assert.equal(first.reviews[0].url, source);
  assert.equal(first.reviews[0].text, 'The patio was quiet.');
  const failed = await server.request('/api/restaurants/kenmore-jefes-01/live-reviews');
  assert.equal(failed.live, false);
  assert.deepEqual(failed.reviews, []);
  assert.ok(!JSON.stringify(failed).includes('test-review-key'));
});

test('gpt-live-1.1 broker preserves SDP and retries rejected optional standby and web search features', async (t) => {
  const unconfigured = await setup(t, { openaiKey: undefined });
  await unconfigured.start();
  const statusOff = await unconfigured.request('/api/live/status');
  assert.equal(statusOff.configured, false);
  assert.equal(statusOff.model, 'gpt-live-1.1');
  assert.equal(statusOff.backend_model, 'gpt-6-luna');
  await unconfigured.request('/api/live/sessions', { body: { sdp: 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n' }, status: 503 });

  const server = await setup(t, {
    openaiKey: 'test-openai-live',
    openaiBaseUrl: 'https://openai.example/v1',
    openaiLiveModel: 'gpt-live-1.1',
    openaiLiveBackendModel: 'gpt-6-luna',
    openaiLiveVoice: 'ballad',
  });
  const originalFetch = globalThis.fetch;
  const requests = [];
  const offer = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=offer\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=candidate:example\r\n';
  const answer = 'v=0\r\no=- 2 2 IN IP4 127.0.0.1\r\ns=answer\r\n';
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.hostname !== 'openai.example') return originalFetch(input, init);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer test-openai-live');
    const body = JSON.parse(init.body);
    if (url.pathname === '/v1/realtime/client_secrets') {
      assert.equal(body.session.model, 'gpt-realtime');
      assert.equal(body.session.audio.output.voice, 'ballad');
      return Response.json({ value: 'realtime_test_secret', expires_at: 1_900_000_000 });
    }
    assert.equal(url.pathname, '/v1/live/sessions');
    requests.push(body);
    assert.equal(body.transport.sdp, offer);
    assert.equal(body.transport.type, 'webrtc');
    assert.equal(body.session.model, 'gpt-live-1.1');
    assert.equal(body.session.audio.output.voice, 'ballad');
    if (requests.length === 1) {
      assert.equal(body.session.idle_timeout_s, 30);
      assert.deepEqual(body.session.wake_policy, { type: 'speech' });
      assert.match(body.session.instructions, /Received Pronunciation/);
      assert.equal(body.session.delegation.type, 'responses');
      assert.equal(body.session.delegation.responses.model, 'gpt-6-luna');
      const { tools, instructions } = body.session.delegation.responses;
      assert.deepEqual(tools.filter(({ type }) => type === 'function').map(({ name }) => name), [
        'list_places', 'set_filters', 'focus_stop', 'open_venue', 'open_dish', 'navigate_scene',
        'get_next_trains', 'set_will_we_fit', 'get_place_details', 'get_live_reviews', 'compare_places', 'show_review_card', 'dismiss_review_card',
        'get_current_view',
      ]);
      assert.ok(tools.some(({ type }) => type === 'web_search'));
      assert.deepEqual(tools.find(({ name }) => name === 'get_live_reviews').parameters.required, ['placeId']);
      assert.deepEqual(tools.find(({ name }) => name === 'get_current_view').parameters, {
        type: 'object', properties: {}, required: [], additionalProperties: false,
      });
      assert.equal(tools.find(({ name }) => name === 'show_review_card').parameters.properties.sections.items.anyOf.length, 4);
      for (const expected of ['Scene: map | Open clipboards: []', 'PLACES & MENU ITEMS:', 'comparePlaceId', 'up to four clipboards', 'A null dish price', 'call get_current_view first']) {
        assert.ok(instructions.includes(expected), `Missing instruction: ${expected}`);
      }
      const catalogDishes = demoPlaces.flatMap(({ dishes }) => dishes);
      assert.equal(catalogDishes.length, 63);
      for (const dish of catalogDishes) {
        assert.ok(instructions.includes(`${dish.id} "${dish.name}" ${formatDishPrice(dish.price)} [3D]`), `Missing dish and price: ${dish.id}`);
      }
      return Response.json({ error: { message: 'Unknown parameter: idle_timeout_s' } }, { status: 400 });
    }
    if (requests.length === 2) {
      assert.equal(body.session.idle_timeout_s, undefined);
      assert.ok(body.session.delegation.responses.tools.some(({ type }) => type === 'web_search'));
      return Response.json({ error: { message: 'Tool web_search is not supported' } }, { status: 400 });
    }
    if (requests.length === 3) {
      assert.equal(body.session.idle_timeout_s, undefined);
      assert.ok(body.session.delegation.responses.tools.every(({ type }) => type === 'function'));
      assert.ok(body.session.delegation.responses.tools.some(({ name }) => name === 'get_live_reviews'));
    }
    return Response.json({
      session: { id: 'live_test_123' },
      transport: { type: 'webrtc', sdp: answer },
    }, { status: 201 });
  });

  await server.start();
  const statusOn = await server.request('/api/live/status');
  assert.equal(statusOn.configured, true);
  assert.equal(statusOn.voice, 'ballad');
  assert.ok(['ballad', 'cedar', 'ash', 'marin'].every((voice) => statusOn.voices.includes(voice)));
  await server.request('/api/live/sessions', { body: { sdp: 'not-sdp' }, status: 400 });
  await server.request('/api/live/sessions', { body: { sdp: offer, voice: 42 }, status: 400 });
  assert.deepEqual(await server.request('/api/realtime/session', { method: 'POST' }), {
    client_secret: 'realtime_test_secret', expires_at: 1_900_000_000, model: 'gpt-realtime',
  });

  const created = await server.request('/api/live/sessions', {
    body: {
      sdp: offer.replaceAll('\r\n', '\n').trimEnd(),
      context: 'Scene: map | Open clipboards: []',
    },
    status: 201,
  });
  assert.equal(requests.length, 3);
  assert.equal(created.session_id, 'live_test_123');
  assert.equal(created.model, 'gpt-live-1.1');
  assert.equal(created.backend_model, 'gpt-6-luna');
  assert.equal(created.voice, 'ballad');
  assert.equal(created.sdp, answer);
  await server.request('/api/live/sessions', { body: { sdp: offer }, status: 201 });
  assert.equal(requests.length, 4);
});

test('pipeline credentials cannot administer jobs and idempotent job requests survive restart', async (t) => {
  const server = await setup(t, { contributorPasscode: 'test-contributor' });
  await server.start({ worker: false });
  const contributor = { passcode: false, headers: { 'X-Upload-Passcode': 'test-contributor', 'Idempotency-Key': 'capture-01' } };
  const body = { filename: 'test.png', mimeType: 'image/png', dataBase64: image.toString('base64'), place_id: placeId };
  const upload = await server.request('/api/uploads', { ...contributor, body, status: 201 });
  const jobBody = { kind: 'dish', place_id: placeId, upload_ids: [upload.id], dish_name: 'Noodles', dish_price: 14.5 };
  const [job, duplicate] = await Promise.all([1, 2].map(() => server.request('/api/jobs', { ...contributor, body: jobBody, status: 202 })));
  assert.equal(job.id, duplicate.id);
  assert.equal(job.idempotency_key, undefined);
  assert.equal((await server.request('/api/jobs', contributor)).length, 1);
  const legacyContributor = { passcode: false, headers: { 'X-Admin-Passcode': 'test-contributor' } };
  assert.equal((await server.request('/api/jobs', legacyContributor)).length, 1);
  assert.equal((await server.request('/api/jobs', { passcode: false, headers: { 'X-Upload-Passcode': 'test-passcode' } })).length, 1);
  await server.request('/api/jobs', { passcode: false, status: 401 });
  await server.request('/api/admin/moderation', { ...legacyContributor, status: 401 });
  await server.request('/api/debug/logs', { ...contributor, body: { logs: [] }, status: 401 });
  await server.request(`/api/jobs/${job.id}/publish`, { ...contributor, body: {}, status: 401 });
  await server.request('/api/admin/moderation', { passcode: false, headers: { Authorization: 'Bearer test-passcode' }, status: 401 });
  await server.request('/api/admin/moderation', { passcode: false, headers: { 'X-Upload-Passcode': 'test-passcode' }, status: 401 });
  await server.request('/api/admin/moderation');
  await server.stop();
  await server.start({ worker: false });
  assert.equal((await server.request('/api/jobs', { ...contributor, body: jobBody, status: 202 })).id, job.id);
  await server.request('/api/jobs', { ...contributor, body: { ...jobBody, dish_name: 'Dessert' }, status: 409 });
});

test('an uploaded food photo must carry the dish name and its menu price', async (t) => {
  const server = await setup(t);
  await server.start({ worker: false });
  const upload = await server.request('/api/uploads', {
    body: { filename: 'plate.png', mimeType: 'image/png', dataBase64: image.toString('base64'), place_id: placeId },
    status: 201,
  });
  const base = { kind: 'dish', place_id: placeId, upload_ids: [upload.id] };
  const noPrice = await server.request('/api/jobs', { body: { ...base, dish_name: 'Street corn' }, status: 400 });
  assert.match(noPrice.error, /menu price/);
  const noName = await server.request('/api/jobs', { body: { ...base, dish_price: 8.5 }, status: 400 });
  assert.match(noName.error, /name of the dish/);
  await server.request('/api/jobs', { body: { ...base, dish_name: 'Street corn', dish_price: 0 }, status: 400 });
  await server.request('/api/jobs', { body: { ...base, dish_name: 'Street corn', dish_price: 900 }, status: 400 });
  const job = await server.request('/api/jobs', {
    body: { ...base, dish_name: 'Street corn', dish_price: 8.5 }, status: 202,
  });
  assert.equal(job.dish_price, 8.5);
  assert.equal(job.dish_name, 'Street corn');
  // A room job carries no dish fields at all.
  const room = await server.request('/api/jobs', { body: { kind: 'room', place_id: placeId, upload_ids: [upload.id] }, status: 202 });
  assert.equal(room.dish_price, null);
});

test('non-loopback binds fail closed and admin auth throttles before parsing JSON', async (t) => {
  const server = await setup(t, { host: '0.0.0.0', adminPasscode: undefined, contributorPasscode: 'upload', allowUnauthenticatedDemo: false });
  const app = await createApp(server.config, { worker: false });
  t.after(() => app.close());
  const missing = await app.inject({ method: 'GET', url: '/api/jobs', headers: { 'X-Upload-Passcode': 'upload' } });
  assert.equal(missing.statusCode, 401);
  const demo = await createApp({ ...server.config, contributorPasscode: undefined, allowUnauthenticatedDemo: true }, { worker: false });
  t.after(() => demo.close());
  assert.equal((await demo.inject('/api/jobs')).statusCode, 200);
  const malformed = { method: 'POST', url: '/api/debug/logs', headers: { 'Content-Type': 'application/json' }, payload: '{' };
  for (let attempt = 0; attempt < 12; attempt++) assert.equal((await demo.inject(malformed)).statusCode, 401);
  assert.equal((await demo.inject(malformed)).statusCode, 429);
});

test('missing and symlinked demo assets are omitted independently', async (t) => {
  const { dir, config } = await setup(t);
  const demo = join(dir, 'demo');
  const outside = join(dir, 'outside.ply');
  await mkdir(demo);
  await writeFile(outside, fixturePly());
  await symlink(outside, join(demo, room));
  await writeFile(join(demo, dish), fixturePly());
  const app = await createApp({ ...config, demoAssets: [demo] }, { worker: false });
  t.after(() => app.close());
  const manifest = (await app.inject(`/api/restaurants/${placeId}/manifest`)).json();
  assert.equal(manifest.room_asset, null);
  assert.equal(manifest.menu_items[0].dish_asset.gaussian_count, 5);
  await rm(join(demo, dish));
  const withoutDish = (await app.inject(`/api/restaurants/${placeId}/manifest`)).json();
  assert.equal(withoutDish.menu_items[0].dish_asset, null);
  assert.equal((await app.inject('/assets-demo/' + room)).statusCode, 404);
});

test('worker lease generation fences a paused owner and survives release', () => {
  const store = new Store(':memory:');
  try {
    const initial = store.claimWorker('first');
    const job = { id: 'lease-test', status: 'queued', updated_at: '' };
    store.put('jobs', job);
    assert.deepEqual(store.claimWorker('first'), initial);
    assert.equal(store.claimWorker('second'), undefined);
    store.sqlite.exec('UPDATE worker_lease SET expires = 0');
    const next = store.claimWorker('second');
    assert.equal(next.generation, initial.generation + 1);
    const mirrored = [];
    store.onJobUpdate = ({ status }) => mirrored.push(status);
    store.transaction(() => {
      store.updateJob(job, { status: 'needs_review' }, next);
      assert.deepEqual(mirrored, []);
    });
    assert.deepEqual(mirrored, ['needs_review']);
    assert.throws(() => store.transaction(() => {
      store.updateJob(job, { status: 'ready' }, next);
      store.updateJob(job, { status: 'failed' }, initial);
    }), WorkerLeaseLost);
    assert.deepEqual(mirrored, ['needs_review']);
    assert.equal(store.get('jobs', job.id).status, 'needs_review');
    store.releaseWorker('second');
    assert.equal(store.claimWorker('second').generation, next.generation + 1);
  } finally {
    store.sqlite.close();
  }
});

test('provider downloads enforce streamed byte and redirect limits', async (t) => {
  const { dir } = await setup(t);
  const fetch = t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/redirect')) return new Response(null, { status: 302, headers: { location: 'https://storage.invalid/asset' } });
    return new Response(new ReadableStream({
      start(stream) {
        stream.enqueue(Uint8Array.from([1, 2]));
        stream.enqueue(Uint8Array.from([3, 4]));
        stream.close();
      },
    }));
  });
  const path = join(dir, 'asset.ply');
  await assert.rejects(downloadFile('https://replicate.delivery/redirect', () => path, 'trellis'), /trusted HTTPS|download host/);
  assert.equal(fetch.mock.callCount(), 1);
  await assert.rejects(downloadFile('https://replicate.delivery/asset', () => path, 'trellis', undefined, 3), /byte limit/);
  await assert.rejects(readFile(path), { code: 'ENOENT' });
});

test('Boston demo schedules use the offset at 1 a.m. on DST transition days', () => {
  assert.equal(demoSchedules('place-bucen', ['Green-B'], '2026-03-07', 0)[0].departure_time, '2026-03-08T06:12:00.000Z');
  assert.equal(demoSchedules('place-bucen', ['Green-B'], '2026-10-31', 0)[0].departure_time, '2026-11-01T05:12:00.000Z');
});

test('MBTA normalizes schedule route lists and keeps successful branches during a partial 429', async (t) => {
  const { config } = await setup(t);
  const app = await createApp(config, { worker: false });
  t.after(() => app.close());
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (input) => {
    const url = new URL(input);
    const route = url.searchParams.get('filter[route]');
    seen.push(route);
    if (route === 'Green-C') return new Response(null, { status: 429, headers: { 'Retry-After': '120' } });
    return Response.json({ data: [{ id: 'first-schedule', type: 'schedule',
      attributes: { direction_id: 0, departure_time: '2026-11-22T06:00:00Z' },
      relationships: { route: { data: { id: 'Green-B' } } } }] });
  });
  const url = '/api/mbta/schedules?stop=place-kencl&direction=0&date=2026-11-21&route=';
  const first = (await app.inject(url + 'Green-B,Green-C,Green-B')).json();
  assert.equal(first.source, 'live');
  assert.deepEqual(first.schedules.map(({ route_id }) => route_id), ['Green-B']);
  assert.deepEqual((await app.inject(url + 'Green-C,Green-B')).json(), first);
  assert.equal((await app.inject('/api/mbta/alerts')).json().source, 'simulated');
  assert.deepEqual(seen, ['Green-B', 'Green-C']);
});

test('config rejects invalid ports and relative public URLs', () => {
  const { PORT, PUBLIC_BASE_URL } = process.env;
  try {
    for (const port of ['', '0', '65536', '3001.5']) {
      process.env.PORT = port;
      assert.throws(getConfig, /PORT must be an integer/);
    }
    process.env.PORT = '65535';
    for (const base of ['/relative', 'https:relative', 'ftp://example.com', '']) {
      process.env.PUBLIC_BASE_URL = base;
      assert.throws(getConfig, /PUBLIC_BASE_URL/);
    }
    process.env.PUBLIC_BASE_URL = 'https://example.com:8443/site';
    assert.equal(getConfig().port, 65535);
    assert.equal(getConfig().publicBaseUrl, process.env.PUBLIC_BASE_URL);
  } finally {
    if (PORT === undefined) delete process.env.PORT;
    else process.env.PORT = PORT;
    if (PUBLIC_BASE_URL === undefined) delete process.env.PUBLIC_BASE_URL;
    else process.env.PUBLIC_BASE_URL = PUBLIC_BASE_URL;
  }
});

test('upload ingest removes PNG metadata, rejects truncation, and bounds multipart bytes', async (t) => {
  const { config } = await setup(t);
  const app = await createApp(config, { worker: false });
  t.after(() => app.close());
  const post = (path, payload, headers = {}) => app.inject({
    method: 'POST', url: path, payload, headers: { 'X-Admin-Passcode': config.adminPasscode, ...headers },
  });
  const metadata = Buffer.from('tEXtComment\0private camera notes');
  const length = Buffer.alloc(4);
  const checksum = Buffer.alloc(4);
  length.writeUInt32BE(metadata.length - 4);
  checksum.writeUInt32BE(crc32(metadata));
  const tagged = Buffer.concat([image.subarray(0, -12), length, metadata, checksum, image.subarray(-12)]);
  const body = (bytes) => ({ filename: 'photo.png', mimeType: 'image/png', dataBase64: bytes.toString('base64'), place_id: placeId });
  const stripped = await post('/api/uploads', body(tagged));
  assert.equal(stripped.statusCode, 201);
  assert.deepEqual(await readFile(join(config.uploads, stripped.json().file)), image);
  assert.equal((await post('/api/uploads', body(image))).json().id, stripped.json().id);
  assert.equal((await post('/api/uploads', body(image.subarray(0, -4)))).statusCode, 400);
  assert.equal((await post('/api/debug/logs', { logs: ['x'.repeat(1024 * 1024)] })).statusCode, 413);
  assert.equal((await post('/api/uploads', Buffer.alloc(8 * 1024 * 1024 + 65537), {
    'content-type': 'multipart/form-data; boundary=fixture',
  })).statusCode, 413);
});
