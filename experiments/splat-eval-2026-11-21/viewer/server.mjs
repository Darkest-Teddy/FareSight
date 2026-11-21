// Local viewer for the splat experiment: `node viewer/server.mjs`, then open http://localhost:5180
import { createServer } from 'node:http';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
// In the repo, use the app's PlayCanvas; in an exported bundle, use viewer/vendor.
const PLAYCANVAS = [join(HERE, 'vendor'), resolve(ROOT, '../../web/node_modules/playcanvas/build')]
  .find((dir) => existsSync(join(dir, 'playcanvas.mjs')));
const PORT = Number(process.env.PORT ?? 5180);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary',
  '.ply': 'application/octet-stream', '.sog': 'application/octet-stream',
};

// The dish run may rewrite results.json mid-read; keep the last good parse.
const lastGood = new Map();
function readJson(path, fallback) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    lastGood.set(path, value);
    return value;
  } catch {
    return lastGood.get(path) ?? fallback;
  }
}

const exists = (rel) => existsSync(join(ROOT, rel));
const file = (rel) => (rel && exists(rel) ? `/files/${rel}` : null);

function roomCatalog() {
  const results = readJson(join(ROOT, 'rooms/results.json'), []);
  const manifest = readJson(join(ROOT, 'rooms/sources/manifest.json'), []);
  const photosFor = (roomId) => manifest.find((m) => m.id === roomId)?.photos ?? [];
  const byDir = new Map();
  for (const r of results) if (r.status === 'succeeded' && r.directory) byDir.set(r.directory, r);

  const configs = [...byDir.values()].map((r) => {
    const dir = `rooms/${r.directory}`;
    return {
      id: basename(r.directory),
      kind: 'splat',
      roomId: r.room_id,
      restaurant: r.restaurant,
      photos: r.n_photos,
      resolution: r.resolution,
      costUsd: r.cost_usd,
      predictTimeS: r.predict_time_s,
      gaussians: r.stats?.count ?? r.stats?.gaussians ?? null,
      scores: r.scores ?? {},
      publishable: r.publishable,
      evidence: r.score_evidence ?? null,
      tiers: [
        { id: '100k', label: '100k SOG (Quest)', url: file(`${dir}/room-100000.sog`) },
        { id: '250k', label: '250k SOG', url: file(`${dir}/room-250000.sog`) },
        { id: 'raw', label: 'Raw PLY', url: file(`${dir}/gaussians.ply`) },
      ].filter((t) => t.url),
      poses: readJson(join(ROOT, dir, 'render-poses.json'), null),
      sources: photosFor(r.room_id).slice(0, r.n_photos).map((p) => ({
        url: file(`rooms/${p.path}`), author: p.author, license: p.license, page: p.source_url,
      })),
    };
  });

  const baselines = [...new Set(configs.map((c) => c.roomId))].flatMap((roomId) => {
    const glb = `rooms/outputs/baseline/${roomId}/room.glb`;
    const reference = `rooms/outputs/${roomId}-2p-518`;
    if (!exists(glb) || !exists(`${reference}/camera_params.json`)) return [];
    const cams = readJson(join(ROOT, reference, 'camera_params.json'), { extrinsics: [] }).extrinsics;
    const cam1 = [...cams].sort((a, b) => String(a.camera_id).localeCompare(String(b.camera_id)))[0];
    const ref = configs.find((c) => c.id === `${roomId}-2p-518`);
    return [{
      id: `${roomId}-depth`,
      kind: 'depth',
      roomId,
      restaurant: ref?.restaurant ?? roomId,
      photos: 1,
      resolution: null,
      costUsd: 0,
      scores: {},
      publishable: null,
      evidence: 'Free single-photo fallback: Depth Anything V2 Small → textured depth mesh (2.5D).',
      tiers: [{ id: 'glb', label: 'Depth mesh (GLB)', url: file(glb) }],
      poses: ref?.poses ?? null,
      camera1: cam1?.matrix ?? null,
      sources: ref?.sources?.slice(0, 1) ?? [],
    }];
  });

  return [...configs, ...baselines].sort((a, b) =>
    a.roomId.localeCompare(b.roomId) || a.photos - b.photos || (a.resolution ?? 0) - (b.resolution ?? 0));
}

const PROVIDER_ORDER = ['sam', 'idol', 'trellis', 'idol-space'];

// The dish run writes each finished job to outputs/<dish>/<provider>/attempt<N>/job.json
// before folding it into results.json, so read both.
function dishJobRecords() {
  const out = join(ROOT, 'dishes/outputs');
  const records = [];
  let dishes = [];
  try { dishes = readdirSync(out, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return records; }
  for (const dish of dishes) {
    for (const provider of readdirSync(join(out, dish.name), { withFileTypes: true })) {
      if (!provider.isDirectory()) continue;
      for (const attempt of readdirSync(join(out, dish.name, provider.name))) {
        const job = join(out, dish.name, provider.name, attempt, 'job.json');
        if (existsSync(job)) records.push(readJson(job, null));
      }
    }
  }
  return records.filter(Boolean);
}

function dishCatalog() {
  const results = [...readJson(join(ROOT, 'dishes/results.json'), []), ...dishJobRecords()];
  const manifest = readJson(join(ROOT, 'dishes/sources/manifest.json'), []);
  const dishes = new Map();
  for (const m of manifest) {
    dishes.set(m.dish, {
      id: m.dish,
      title: m.title ?? m.dish,
      targetWidthM: m.target_width_m ?? null,
      source: { url: file(`dishes/${m.filename}`), author: m.author, license: m.license, page: m.page },
      providers: {},
    });
  }
  for (const r of results) {
    if (r.status !== 'succeeded' || !dishes.has(r.dish)) continue;
    const key = r.provider === 'idol' && r.host && r.host !== 'fal' ? 'idol-space' : r.provider;
    const paths = r.paths ?? {};
    const folder = paths.raw ? dirname(paths.raw) : null;
    const normalizedPly = paths.normalized ?? (folder && `${folder}/normalized.ply`);
    const dishFile = (rel) => file(rel && `dishes/${rel}`);
    const tiers = [
      { id: '60k', label: '60k SOG (Quest)', url: dishFile(paths['60k']) },
      { id: '30k', label: '30k SOG', url: dishFile(paths['30k']) },
      { id: 'full', label: 'Full (normalized PLY)', url: dishFile(normalizedPly) },
    ].filter((t) => t.url);
    if (!tiers.length) continue;
    const prev = dishes.get(r.dish).providers[key];
    if (prev && (prev.attempt ?? 0) > (r.attempt ?? 0)) continue;
    // results.json and job.json can both describe the same attempt; keep the scored one.
    if (prev && prev.attempt === r.attempt && Object.keys(prev.scores).length && !Object.keys(r.scores ?? {}).length) continue;
    dishes.get(r.dish).providers[key] = {
      attempt: r.attempt,
      costUsd: r.cost_usd,
      runtimeS: r.runtime_s,
      gaussians: r.stats?.count ?? null,
      scores: r.scores ?? {},
      publishable: r.publishable ?? r.accepted ?? null,
      evidence: r.score_evidence ?? null,
      tiers,
    };
  }
  return { providerOrder: PROVIDER_ORDER, dishes: [...dishes.values()] };
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function serveFile(req, res, base, rel) {
  const target = normalize(join(base, rel));
  if (target !== base && !target.startsWith(base + sep)) return send(res, 403, 'Forbidden');
  let stat;
  try { stat = statSync(target); } catch { return send(res, 404, 'Not found'); }
  if (!stat.isFile()) return send(res, 404, 'Not found');
  res.writeHead(200, {
    'content-type': TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(target).pipe(res);
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (path === '/' || path === '/index.html') return serveFile(req, res, HERE, 'index.html');
    if (path === '/app.mjs') return serveFile(req, res, HERE, 'app.mjs');
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (path === '/api/catalog') {
      return send(res, 200, JSON.stringify({ rooms: roomCatalog(), dishes: dishCatalog() }), TYPES['.json']);
    }
    if (path.startsWith('/pc/')) return serveFile(req, res, PLAYCANVAS, path.slice(4));
    if (path.startsWith('/files/')) return serveFile(req, res, ROOT, path.slice(7));
    send(res, 404, 'Not found');
  } catch (error) {
    send(res, 500, String(error?.stack ?? error));
  }
}).listen(PORT, HOST, () => console.log(`Splat viewer: http://localhost:${PORT}`));
