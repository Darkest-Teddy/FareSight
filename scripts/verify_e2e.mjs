import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import {
  apiClient, assertSpawnPoint, demoPhotos, runMilestone, servedFileSize, withDemoServer,
} from './first_milestone_test.mjs';

const require = createRequire(new URL('../server/package.json', import.meta.url));
const { WebSocket } = require('ws');
const place = 'bu-ramen-01';
const placePath = `/api/restaurants/${place}`;
const stopIds = ['place-brico', 'place-bucen', 'place-chncl', 'place-harsq', 'place-kencl'];
const passcode = randomUUID();

async function verifyCatalog(request, origin) {
  const [health, stops, places] = await Promise.all([
    request('/api/health'), request('/api/stops'), request('/api/restaurants'),
  ]);
  assert.deepEqual(health, { status: 'ok', database: 'sqlite', pipeline_mode: 'demo' });
  assert.deepEqual(stops.map(({ stop_id }) => stop_id).sort(), stopIds, 'Focal stop catalog');
  assert.equal(places.length, 28, 'Curated place count');
  assert.equal(new Set(places.map(({ id }) => id)).size, 28, 'Curated place IDs must be unique');
  assert(places.every(({ stop_id }) => stopIds.includes(stop_id)), 'Each place must use a focal stop');
  const flagshipManifests = [
    ['bu-ramen-01', 'room-ramen-house.ply', ['dish-tonkotsu-ramen.ply', 'dish-katsu-curry.ply']],
    ['allston-karaoke-01', 'room-karaoke-suite.ply', []],
    ['harvard-cafe-01', 'room-study-cafe.ply', ['dish-matcha-tiramisu.ply']],
  ];
  for (const [id, room, dishes] of flagshipManifests) {
    const manifest = await request(`/api/restaurants/${id}/manifest`);
    assert.equal(manifest.restaurant.id, id);
    assert.equal(manifest.room_asset?.url, `/assets-demo/${room}`, `${id} room URL`);
    assertSpawnPoint(manifest.spawn_point);
    assert.deepEqual(manifest.spawn_point, manifest.room_asset.spawn_point);
    const dishAssets = manifest.menu_items.map(({ dish_asset }) => dish_asset).filter(Boolean);
    assert.deepEqual(dishAssets.map(({ url }) => url), dishes.map((file) => `/assets-demo/${file}`), `${id} dish URLs`);
    for (const asset of [manifest.room_asset, ...dishAssets]) {
      assert.equal(asset.status, 'ready', `${asset.url} is not ready`);
      assert.equal(asset.format, 'ply', `${asset.url} has the wrong format`);
      assert(asset.gaussian_count > 0, `${asset.url} has no reported Gaussians`);
      await servedFileSize(origin, asset.url, Buffer.from('ply'));
    }
  }
  console.log('PASS health, 5 focal stops, 28 curated places, and 3 flagship manifests');
}

async function verifyMbta(request) {
  const endpoints = [
    ['vehicles', ''], ['predictions', '?stop=place-bucen'], ['alerts', ''], ['schedules', '?stop=place-bucen'],
  ];
  const [feeds, trip] = await Promise.all([
    Promise.all(endpoints.map(([name, query]) => request(`/api/mbta/${name}${query}`))),
    request('/api/mbta/trip?from=place-kencl&to=place-bucen&walkToVenueM=80&venueLat=42.35015&venueLon=-71.10665'),
  ]);
  const sources = feeds.map((feed, index) => {
    const [name] = endpoints[index];
    assert(['live', 'simulated'].includes(feed.source), `MBTA ${name} did not identify its source`);
    assert(Array.isArray(feed[name]), `MBTA ${name} response has no ${name} array`);
    assert(feed[name].every(({ id }) => typeof id === 'string' && id), `MBTA ${name} contains a missing ID`);
    return `${name}=${feed.source} (${feed[name].length})`;
  });
  assert(feeds[0].vehicles.every(({ lat, lon }) => Number.isFinite(lat) && Number.isFinite(lon)), 'MBTA vehicle coordinates');
  assert.equal(feeds[3].stop_id, 'place-bucen');
  assert(feeds[3].schedules.every(({ last_trip }) => last_trip === true), 'MBTA schedules must report last trains');
  assert.equal(trip.walk_to_venue_min, 1.3);
  assert.equal(trip.fare, 2.4);
  assert(Number.isFinite(trip.total_min) && trip.total_min > 0, 'MBTA trip total');
  const planner = new URL(trip.planner_url);
  assert.equal(planner.searchParams.get('plan[from_stop_id]'), 'place-kencl');
  assert.equal(planner.searchParams.get('plan[to_latitude]'), '42.35015');
  console.log(`PASS MBTA trip and feeds · ${sources.join(', ')}`);
  return trip;
}

async function verifyCommunity(request) {
  const author = 'FareSight E2E';
  const text = 'Roundtrip moderation check.';
  const review = await request(`${placePath}/reviews`, {
    body: { author_label: author, text }, status: 201, admin: false,
  });
  assert.equal(review.status, 'pending_review');
  assert.equal(review.place_id, place);
  const before = await request(placePath);
  assert(!before.reviews.some(({ id }) => id === review.id), 'Pending review appeared publicly');
  await request('/api/admin/moderation', { admin: false, status: 401 });
  const queue = await request('/api/admin/moderation');
  assert(queue.reviews.some(({ id }) => id === review.id), 'New review is absent from moderation');
  const moderation = { type: 'review', id: review.id, action: 'approve' };
  await request('/api/admin/moderation', { body: moderation, admin: false, status: 401 });
  const approved = await request('/api/admin/moderation', { body: moderation });
  assert.equal(approved.status, 'approved');
  const after = await request(placePath);
  const publicReview = after.reviews.find(({ id }) => id === review.id);
  assert.equal(publicReview?.author, author);
  assert.equal(publicReview?.text, text);
  const remaining = await request('/api/admin/moderation');
  assert(!remaining.reviews.some(({ id }) => id === review.id), 'Approved review is still in moderation');

  const logs = ['E2E debug log', 'Checking stored payload'];
  const entry = await request('/api/debug/logs', { body: { logs }, status: 201, admin: false });
  assert.equal(entry.count, logs.length);
  await request('/api/debug/logs', { admin: false, status: 401 });
  const stored = await request('/api/debug/logs');
  assert.deepEqual(stored.find(({ id }) => id === entry.id)?.logs, logs);
  console.log('PASS review submission, authenticated moderation, public approval, and debug logs');
}

async function verifyPairing(request, origin, trip) {
  const { code } = await request('/api/pairing/create', { method: 'POST', status: 201 });
  assert.match(code, /^\d{4}$/, 'Pairing code format');
  const url = new URL(`/ws/pair/${code}`, origin);
  url.protocol = 'ws:';
  const sockets = [];
  const connect = () => {
    const socket = new WebSocket(url, { handshakeTimeout: 3000 });
    socket.on('error', () => socket.terminate());
    sockets.push(socket);
    return socket;
  };
  async function message(socket) {
    const [data] = await once(socket, 'message', { signal: AbortSignal.timeout(3500) });
    return JSON.parse(data.toString());
  }
  try {
    const phone = connect();
    assert.deepEqual(await message(phone), { type: 'peer_joined', peers: 1 });
    const joined = message(phone);
    const headset = connect();
    const joinedMessages = await Promise.all([joined, message(headset)]);
    for (const event of joinedMessages) assert.deepEqual(event, { type: 'peer_joined', peers: 2 });

    const exchanges = [
      [phone, headset, { type: 'open_place', place_id: place }],
      [headset, phone, { type: 'open_dish', place_id: place, dish_id: 'bu-ramen-tonkotsu' }],
      [phone, headset, { type: 'send_trip', trip }],
      [headset, phone, { type: 'sync_filters', filters: { family_friendly: true } }],
    ];
    for (const [sender, receiver, payload] of exchanges) {
      const incoming = message(receiver);
      sender.send(JSON.stringify(payload));
      assert.deepEqual(await incoming, payload, `WebSocket relay changed ${payload.type}`);
    }
  } finally {
    await Promise.all(sockets.map(async (socket) => {
      if (socket.readyState === WebSocket.CLOSED) return;
      const closed = once(socket, 'close', { signal: AbortSignal.timeout(3000) });
      socket.close();
      try {
        await closed;
      } catch {
        socket.terminate();
      }
    }));
  }
  console.log('PASS two real WebSocket peers relayed open_place, open_dish, send_trip, and sync_filters');
}

async function verifyPipeline(request, origin) {
  const photos = demoPhotos();
  const { jobs, uploads } = await runMilestone({
    origin, passcode, place, dishName: 'E2E Ramen', plateDiameter: 0.24, demo: true, ...photos,
  });
  for (const upload of uploads) {
    const saved = await fetch(origin + upload.url, { signal: AbortSignal.timeout(5000) });
    assert.equal(saved.status, 200, `GET ${upload.url}`);
    const original = [...photos.roomPhotos, photos.dishPhoto].find(({ filename }) => filename === upload.filename);
    assert.deepEqual(Buffer.from(await saved.arrayBuffer()), original.bytes, 'Stored upload bytes changed');
  }
  const listed = await request('/api/jobs');
  assert.deepEqual(listed.map(({ id }) => id).sort(), jobs.map(({ id }) => id).sort(), 'Job list diverged from submitted jobs');
  assert(listed.every(({ status }) => status === 'ready'), 'Job list failed to surface publication');
  await request(`/api/jobs/${jobs[0].id}/retry`, { body: {}, status: 409 });
  console.log('PASS stored upload bytes, intake, both jobs, job listing, retry guard, publication, and updated manifest');
}

async function verifyWebBuild() {
  const dist = new URL('../web/dist/', import.meta.url);
  async function nonempty(path) {
    const file = await stat(new URL(path, dist)).catch((error) => {
      if (error.code === 'ENOENT') throw new Error(`Missing web/dist/${path}. Build FareSight with pnpm build`);
      throw error;
    });
    assert(file.isFile() && file.size > 0, `web/dist/${path} is not a nonempty file`);
  }
  await Promise.all(['index.html', 'sw.js', 'assets-demo/cache-list.json'].map(nonempty));
  const html = await readFile(new URL('index.html', dist), 'utf8');
  assert.match(html, /<main\b[^>]*\bid="app"/, 'Built HTML is missing the app mount');
  const bundles = [...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+\.(?:js|css))"/g)].map(([, path]) => path);
  assert(bundles.some((path) => path.endsWith('.js')), 'Built HTML does not reference a JavaScript bundle');
  assert(bundles.some((path) => path.endsWith('.css')), 'Built HTML does not reference a CSS bundle');
  await Promise.all(bundles.map(nonempty));

  const expected = [
    'boston-map-sculpture.glb', 'mbta-train-capsule.glb', 'table-pedestal.glb',
    ...stopIds.map((id) => `segment-${id}.glb`),
    'dish-katsu-curry.ply', 'dish-matcha-tiramisu.ply', 'dish-tonkotsu-ramen.ply',
    'room-karaoke-suite.ply', 'room-ramen-house.ply', 'room-study-cafe.ply',
    'mbta-3d-paths.json', 'segment-anchors.json', 'station-anchors.json',
  ].map((file) => `/assets-demo/${file}`).sort();
  const cache = JSON.parse(await readFile(new URL('assets-demo/cache-list.json', dist), 'utf8'));
  assert(Array.isArray(cache), 'Demo cache-list.json must contain a list of asset URLs');
  assert.deepEqual([...cache].sort(), expected, 'Demo cache does not list each of the 17 expected assets exactly once');
  await Promise.all(cache.map((entry) => nonempty(entry.slice(1))));
  console.log(`PASS web/dist HTML, service worker, ${bundles.length} JS/CSS bundles, and all ${cache.length} demo cache assets`);
}

try {
  await withDemoServer(passcode, async (origin) => {
    console.log(`Verifying isolated Fastify server at ${origin}`);
    const request = apiClient(origin, passcode);
    await verifyCatalog(request, origin);
    const trip = await verifyMbta(request);
    await verifyCommunity(request);
    await verifyPairing(request, origin, trip);
    await verifyPipeline(request, origin);
    await verifyWebBuild();
  });
  console.log('FareSight end-to-end verification passed.');
} catch (error) {
  console.error(`FareSight end-to-end verification failed: ${error.stack ?? error}`);
  process.exitCode = 1;
}
