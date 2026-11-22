import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const defaultOrigin = 'http://localhost:3001';
const defaultPlace = 'harvard-cafe-01';
const geminiModel = 'gemini-4-hydrogen';
const draftTier = 'atlas-draft';
const spzPrefixes = [Buffer.from('NG'), Buffer.from('1f8b', 'hex')];
const stages = ['queued', 'generating', 'downloading', 'converting', 'needs_review'];
const mimeTypes = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'],
]);
const usage = `Usage: node scripts/first_milestone_test.mjs [--base-url ${defaultOrigin}]
  [--place ${defaultPlace}] [--dish-name "First Milestone Ramen"] [--dish-price 14.50] [--plate-cm 24]
  [--passcode <ADMIN_PASSCODE>] [--room-tier atlas-draft|atlas-refined]
  --room <path1> <path2> [path3 ... path32] --dish <path>
  or use --demo in place of the photo flags.`;

function parseOptions(args) {
  const options = { origin: defaultOrigin, place: defaultPlace, dishName: 'First Milestone Ramen', dishPrice: '14.50', roomPaths: [] };
  const keys = new Map([
    ['--base-url', 'origin'], ['--place', 'place'], ['--dish-name', 'dishName'], ['--dish-price', 'dishPrice'],
    ['--plate-cm', 'plateCm'], ['--dish', 'dishPath'], ['--passcode', 'passcode'],
    ['--room-tier', 'roomTier'],
  ]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--demo') {
      options.demo = true;
    } else if (flag === '--room') {
      const start = options.roomPaths.length;
      while (args[index + 1] && !args[index + 1].startsWith('--')) options.roomPaths.push(args[++index]);
      assert(options.roomPaths.length > start, '--room requires at least one path');
    } else {
      const key = keys.get(flag);
      assert(key, `Unknown option ${flag}`);
      const value = args[++index];
      assert(value && !value.startsWith('--'), `${flag} requires a value`);
      options[key] = value;
    }
  }

  const url = new URL(options.origin);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    && url.pathname === '/' && !url.search && !url.hash, '--base-url must be an HTTP(S) origin');
  options.origin = url.origin;
  if (options.roomTier !== undefined) assert([draftTier, 'atlas-refined'].includes(options.roomTier), 'Use atlas-draft or atlas-refined with --room-tier');
  options.dishName = options.dishName.trim();
  assert(options.dishName.length > 0 && options.dishName.length <= 120, '--dish-name must contain 1–120 characters');
  // A dish job carries the menu price the contributor read off the menu, so the server accepts it.
  const dishPriceValue = Number(options.dishPrice);
  assert(Number.isFinite(dishPriceValue) && dishPriceValue > 0 && dishPriceValue <= 500, '--dish-price must be greater than 0 and at most 500');
  options.dishPrice = Math.round(dishPriceValue * 100) / 100;
  if (options.plateCm !== undefined) {
    const cm = Number(options.plateCm);
    assert(Number.isFinite(cm) && cm > 0 && cm <= 200, '--plate-cm must be greater than 0 and at most 200');
    options.plateDiameter = cm / 100;
  }
  if (!options.demo) {
    assert(options.roomPaths.length >= 2 && options.roomPaths.length <= 32, 'Provide 2–32 overlapping room photos with --room');
    assert(options.dishPath, 'Provide one dish photo with --dish');
  } else {
    assert(!options.roomPaths.length && !options.dishPath, '--demo supplies its own room and dish photos');
  }
  return options;
}

function png(rgb) {
  function chunk(type, bytes) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    const body = Buffer.concat([Buffer.from(type), bytes]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, ...rgb]))), chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function demoPhotos() {
  return {
    roomPhotos: ['front', 'side'].map((angle, index) => ({
      filename: `dining-room-a-${angle}.png`, mimeType: 'image/png', bytes: png([100, 80, 100 + index]),
    })),
    dishPhoto: { filename: 'dish-preview.png', mimeType: 'image/png', bytes: png([210, 110, 40]) },
  };
}

async function readPhoto(path) {
  const mimeType = mimeTypes.get(extname(path).toLowerCase());
  assert(mimeType, `Use a JPEG, PNG or WebP photo: ${path}`);
  const file = await stat(path);
  assert(file.isFile() && file.size > 0 && file.size <= 8 * 1024 * 1024, `Expected an image file up to 8 MiB: ${path}`);
  return { filename: basename(path), mimeType, bytes: await readFile(path) };
}

export async function withDemoServer(passcode, run) {
  const appModule = new URL('../server/dist/app.js', import.meta.url);
  await stat(appModule).catch((error) => {
    if (error.code === 'ENOENT') throw new Error('Build the FareSight server before running this script (pnpm build)');
    throw error;
  });
  const [{ createApp }, { getConfig }] = await Promise.all([
    import(appModule), import('../server/dist/config.js'),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'faresight-verify-'));
  let app;
  try {
    await mkdir(join(directory, 'data'));
    app = await createApp({
      ...getConfig(),
      host: '127.0.0.1', port: 0, mode: 'demo', adminPasscode: passcode,
      database: join(directory, 'data', 'faresight.db'),
      uploads: join(directory, 'storage', 'uploads'), outputs: join(directory, 'storage', 'outputs'),
      geminiKey: undefined, atlasKey: undefined, replicateKey: undefined, mbtaKey: undefined,
    });
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    return await run(origin);
  } finally {
    try {
      await app?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function apiClient(origin, passcode) {
  return async function request(path, { body, method = body === undefined ? 'GET' : 'POST', status = 200, admin = true } = {}) {
    const headers = new Headers();
    const multipart = body instanceof FormData;
    if (admin && passcode) headers.set('x-admin-passcode', passcode);
    if (body !== undefined && !multipart) headers.set('content-type', 'application/json');
    const response = await fetch(origin + path, {
      method, headers, body: multipart || body === undefined ? body : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(35_000),
    }).catch((error) => {
      throw new Error(`${method} ${origin}${path}: ${error.cause?.message ?? error.message}`, { cause: error });
    });
    const text = await response.text();
    const expected = [status].flat();
    assert(expected.includes(response.status), `${method} ${path} expected HTTP ${expected.join(' or ')}, got ${response.status}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(`${method} ${path} did not return JSON`, { cause: error });
    }
  };
}

export function assertSpawnPoint(point) {
  assert(Array.isArray(point) && point.length === 3 && point.every(Number.isFinite), 'Room spawn point must contain three finite coordinates');
}

export async function servedFileSize(origin, path, magic) {
  assert(typeof path === 'string' && path.startsWith('/') && !path.startsWith('//'), `Invalid asset URL: ${path}`);
  const prefixes = [magic].flat();
  const response = await fetch(origin + path, {
    headers: { range: `bytes=0-${prefixes[0].length - 1}` }, redirect: 'error', signal: AbortSignal.timeout(10_000),
  });
  if (response.status !== 206) {
    await response.body?.cancel();
    assert.fail(`GET ${path} expected HTTP 206 for the asset header, got ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(prefixes.some((prefix) => prefix.equals(bytes)), `GET ${path} returned an invalid asset header`);
  const range = response.headers.get('content-range');
  const count = Number(range?.match(/^bytes 0-\d+\/(\d+)$/)?.[1]);
  assert(Number.isSafeInteger(count) && count > bytes.length, `GET ${path} returned an invalid asset size: ${range}`);
  return count;
}

async function waitForReview(request, jobs, demo) {
  const deadline = Date.now() + (demo ? 90_000 : 30 * 60_000);
  const observations = jobs.map((job) => ({ job }));
  for (const { job } of observations) {
    console.log(`  ${job.kind} ${job.id}: ${job.status} (${job.provider})`);
  }
  while (observations.some(({ job }) => job.status !== 'needs_review')) {
    if (Date.now() >= deadline) {
      assert.fail(`Timed out waiting for review: ${observations.map(({ job }) => `${job.kind} ${job.id}=${job.status} (${job.status_message})`).join(', ')}`);
    }
    await delay(demo ? 150 : 400);
    await Promise.all(observations.map(async (observation) => {
      const previous = observation.job;
      if (previous.status === 'needs_review') return;
      const job = await request(`/api/jobs/${previous.id}`);
      assert.equal(job.id, previous.id, `Job ID changed while polling ${previous.id}`);
      if (job.status !== previous.status) {
        console.log(`  ${job.kind} ${previous.status} -> ${job.status} (${job.progress}%) · ${job.status_message}`);
      }
      if (job.provider_task_id && job.provider_task_id !== previous.provider_task_id) {
        console.log(`  ${job.kind} provider task ${job.provider_task_id}`);
      }
      if (job.pose_operation_id && job.pose_operation_id !== previous.pose_operation_id) {
        console.log(`  ${job.kind} Atlas pose operation ${job.pose_operation_id}`);
      }
      assert.notEqual(job.status, 'failed', `${job.kind} job ${job.id} failed: ${job.error ?? job.status_message}`);
      const stageDistance = stages.indexOf(job.status) - stages.indexOf(previous.status);
      assert(stageDistance >= 0, `${job.kind} moved backwards or reached an unexpected status: ${job.status}`);
      if (demo) assert(stageDistance <= 1, `${job.kind} missed a demo transition before ${job.status}`);
      observation.job = job;
    }));
  }
  return observations.map(({ job }) => job);
}

export async function runMilestone({ origin, passcode, place = defaultPlace, dishName = 'First Milestone Ramen', dishPrice = 14.5,
  plateDiameter, demo, roomTier = draftTier, roomPhotos, dishPhoto }) {
  const request = apiClient(origin, passcode);
  const apiPlace = `/api/restaurants/${encodeURIComponent(place)}`;
  async function upload(photo) {
    const form = new FormData();
    form.set('place_id', place);
    form.set('file', new Blob([photo.bytes], { type: photo.mimeType }), photo.filename);
    const uploaded = await request('/api/uploads', { body: form, status: [200, 201] });
    assert(uploaded.id && uploaded.url, `${photo.filename}: upload did not return an ID and URL`);
    assert.equal(uploaded.place_id, place, `${photo.filename}: incorrect upload place`);
    assert.equal(uploaded.byte_length, photo.bytes.length, `${photo.filename}: incorrect upload size`);
    console.log(`  ${photo.filename} -> ${uploaded.id}`);
    return { ...uploaded, inputName: photo.filename };
  }

  console.log('1. Upload room and dish photos');
  const rooms = [];
  for (const photo of roomPhotos) rooms.push(await upload(photo));
  const dish = await upload(dishPhoto);
  const uploads = new Map([...rooms, dish].map((photo) => [photo.id, photo]));
  const roomIds = new Set(rooms.map(({ id }) => id));
  assert(!roomIds.has(dish.id), 'Room and dish photos must be distinct');

  console.log('2. Select references');
  const intake = await request('/api/intake', {
    body: { place_id: place, upload_ids: [...uploads.keys()] },
  });
  assert.equal(intake.restaurant_id, place, 'Intake returned the wrong restaurant');
  assert.equal(intake.manual_override_allowed, true, 'Intake did not allow manual selection');
  console.log(`  Model ${intake.used_model}`);
  for (const group of intake.room_groups) {
    console.log(`  ${group.label} (${(group.confidence * 100).toFixed(0)}%): ${group.upload_ids.map((id) => uploads.get(id)?.inputName ?? id).join(', ')} · ${group.reason}`);
  }
  for (const flag of intake.flagged) {
    console.log(`  ${uploads.get(flag.upload_id)?.inputName ?? flag.upload_id}: ${flag.category} · ${flag.reason}`);
  }
  assert.equal(intake.used_model, demo ? 'manual-heuristic-fallback' : geminiModel,
    `Expected ${demo ? 'demo selection' : geminiModel}, got ${intake.used_model}`);
  const recommendedRooms = intake.recommended_room_upload_ids.filter((id) => roomIds.has(id));
  if (recommendedRooms.length < 2) console.log('  Using explicitly supplied room photos because intake suggested fewer than two.');
  const selectedRooms = recommendedRooms.length >= 2 ? recommendedRooms : [...roomIds];
  assert(selectedRooms.length >= 2 && selectedRooms.length <= 32, 'Atlas requires 2–32 distinct overlapping room photos');
  if (intake.recommended_dish_upload_id !== dish.id) console.log(`  Using explicitly supplied dish photo ${dish.inputName}`);
  console.log(`  Selected room photos: ${selectedRooms.map((id) => uploads.get(id).inputName).join(', ')}`);

  console.log('3. Submit room and dish jobs');
  async function submit(kind, uploadIds, fields, liveProvider) {
    const job = await request('/api/jobs', {
      body: { kind, place_id: place, upload_ids: uploadIds, ...fields }, status: 202,
    });
    assert(job.id, `${kind} did not receive a job ID`);
    assert.equal(job.kind, kind);
    assert.equal(job.status, 'queued', `${kind} job ${job.id} was not queued`);
    assert.equal(job.provider, demo ? 'demo-sim' : liveProvider, `${kind} job ${job.id} selected provider ${job.provider}`);
    assert.deepEqual(job.input_upload_ids, uploadIds, `${kind} job ${job.id} selected different uploads`);
    return job;
  }
  const roomJob = await submit('room', selectedRooms, { model_tier: roomTier }, 'atlas-v2');
  assert.equal(roomJob.model_tier, roomTier);
  const dishJob = await submit('dish', [dish.id], { dish_name: dishName, dish_price: dishPrice, plate_diameter_m: plateDiameter }, 'trellis-replicate');
  assert.notEqual(roomJob.id, dishJob.id, 'Room and dish must have independent jobs');

  console.log('4. Wait for review and verify generated files');
  const jobs = await waitForReview(request, [roomJob, dishJob], demo);
  const assets = await Promise.all(jobs.map(async (job) => {
    assert(job.provider_task_id && job.asset_id, `${job.kind} review job is missing its provider task or asset ID`);
    const atlas = job.provider === 'atlas-v2';
    if (atlas) assert(job.pose_operation_id, 'Atlas room is missing its pose operation ID');
    const asset = await request(`/api/assets/${job.asset_id}`);
    assert.equal(asset.id, job.asset_id);
    assert.equal(asset.kind, job.kind);
    assert.equal(asset.status, 'needs_review');
    assert(Number.isSafeInteger(asset.gaussian_count) && asset.gaussian_count > 0, `${job.kind} is missing its Gaussian count`);
    assert(asset.scale_label && Number.isFinite(asset.scale_factor) && asset.scale_factor > 0, `${job.kind} is missing valid scale metadata`);
    assert.equal(asset.transform?.scale, asset.scale_factor, `${job.kind} transform scale is inconsistent`);
    assert.deepEqual(asset.source_photos, job.input_upload_ids.map((id) => uploads.get(id).url));
    assert(['sog', atlas ? 'spz' : 'ply'].includes(asset.format), `PlayCanvas cannot load reported format ${asset.format}`);
    assert.equal(asset.metadata?.conversion_status, asset.format === 'sog' ? 'compressed' : `${asset.format}_fallback`);
    if (job.kind === 'dish' && plateDiameter !== undefined) {
      assert.equal(asset.plate_diameter_m, plateDiameter);
      assert.equal(asset.scale_status, 'measured');
      assert.equal(asset.scale_factor, plateDiameter / asset.metadata.measured_width);
    }
    const original = atlas ? job.original_spz_path : job.original_ply_path;
    const originalUrl = atlas ? asset.original_spz_url : asset.original_ply_url;
    const originalMagic = atlas ? spzPrefixes : Buffer.from('ply');
    const converted = job.converted_asset_path;
    assert(original && converted, `${job.kind} is missing a splat file`);
    if (asset.format !== 'spz') assert.notEqual(original, converted, `${job.kind} must retain a separate original`);
    assert.equal(originalUrl, `/storage/outputs/${basename(original)}`);
    assert.equal(asset.url, `/storage/outputs/${basename(converted)}`);
    assert.equal(extname(original), atlas ? '.spz' : '.ply');
    assert.equal(extname(converted), `.${asset.format}`);
    const [originalBytes, convertedBytes] = await Promise.all([
      servedFileSize(origin, originalUrl, originalMagic),
      servedFileSize(origin, asset.url, asset.format === 'sog' ? Buffer.from('504b0304', 'hex') : originalMagic),
    ]);
    console.log(`  ${job.kind}: ${asset.gaussian_count.toLocaleString('en-US')} Gaussians · ${asset.scale_label}`);
    console.log(`    Original ${extname(original).slice(1).toUpperCase()} ${original} (${originalBytes} bytes)`);
    console.log(`    Converted ${asset.format.toUpperCase()} ${converted} (${convertedBytes} bytes, ${asset.metadata.conversion_status})`);
    return asset;
  }));

  console.log('5. Publish both assets and verify the PlayCanvas manifest');
  assert.notEqual(assets[0].id, assets[1].id, 'Room and dish must have independent assets');
  const [roomAsset, dishAsset] = await Promise.all(assets.map(async (asset) => {
    const published = await request(`/api/assets/${asset.id}/publish`, { body: { approve: true } });
    assert.equal(published.status, 'ready', `${asset.kind} publication did not mark the asset ready`);
    assert.equal(published.id, asset.id);
    assert.equal(published.url, asset.url);
    return published;
  }));
  for (const job of jobs) {
    const ready = await request(`/api/jobs/${job.id}`);
    assert.equal(ready.status, 'ready', `${job.kind} job did not reach ready after publication`);
  }
  const manifest = await request(`${apiPlace}/manifest`);
  assert.equal(manifest.restaurant.id, place);
  assert.deepEqual(manifest.room_asset, roomAsset, 'Manifest does not reference the published room');
  assertSpawnPoint(manifest.spawn_point);
  assert.deepEqual(manifest.spawn_point, roomAsset.spawn_point);
  const menuItem = manifest.menu_items.find(({ dish_asset }) => dish_asset?.id === dishAsset.id);
  assert(menuItem, 'Manifest does not reference the separately published dish');
  assert.equal(menuItem.dish.asset_id, dishAsset.id);
  assert.equal(menuItem.dish.name.toLowerCase(), dishName.toLowerCase());
  assert.deepEqual(menuItem.dish_asset, dishAsset);
  console.log(`  Room ${roomAsset.id} at spawn [${manifest.spawn_point.join(', ')}], dish ${menuItem.dish.name} (${dishAsset.id})`);
  return { jobs, manifest, uploads: [...uploads.values()] };
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(usage);
    return;
  }
  const options = parseOptions(args);
  const passcode = options.passcode ?? process.env.ADMIN_PASSCODE;
  if (options.demo) {
    const health = await apiClient(options.origin)('/api/health').catch(() => null);
    const run = (origin) => runMilestone({ ...options, ...demoPhotos(), origin, passcode });
    if (health?.status === 'ok' && health.pipeline_mode === 'demo') {
      console.log(`Using demo server at ${options.origin}`);
      await run(options.origin);
    } else {
      await withDemoServer(passcode, async (origin) => {
        console.log(`Using isolated demo server at ${origin}`);
        await run(origin);
      });
    }
  } else {
    const [roomPhotos, dishPhoto] = await Promise.all([
      Promise.all(options.roomPaths.map(readPhoto)), readPhoto(options.dishPath),
    ]);
    await runMilestone({ ...options, passcode, roomPhotos, dishPhoto });
  }
  console.log('First milestone passed.');
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`First milestone failed: ${error.message}`);
    process.exitCode = 1;
  }
}
