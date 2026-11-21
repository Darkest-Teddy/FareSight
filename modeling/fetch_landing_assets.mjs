/**
 * Downloads the photographic source material for the landing page.
 *
 * Everything here is CC0 from Poly Haven: the HDRIs are real 360-degree
 * photographs of real rooms, and the models are photogrammetry scans of real
 * objects. Nothing is illustrated or hand-modelled, which is the whole point:
 * the landing page has to look like the places it is selling.
 *
 *   node modeling/fetch_landing_assets.mjs
 *
 * Re-running skips files that are already on disk, so it is safe in CI and
 * safe to interrupt.
 */
import { mkdir, writeFile, access, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'web', 'public', 'landing');
const api = 'https://api.polyhaven.com';

/** Real photographed rooms. `role` is which act of the scroll they belong to. */
const hdris = [
  { slug: 'lythwood_room', res: '2k', role: 'home' },
  { slug: 'warm_restaurant', res: '2k', role: 'restaurant' },
];

/** Photogrammetry scans. Act 1 furnishes a living room, act 2 a restaurant table. */
const models = [
  { slug: 'Sofa_01', res: '1k', role: 'home' },
  { slug: 'CoffeeTable_01', res: '1k', role: 'home' },
  { slug: 'potted_plant_01', res: '1k', role: 'home' },
  { slug: 'ClassicConsole_01', res: '1k', role: 'home' },
  { slug: 'WoodenTable_01', res: '1k', role: 'restaurant' },
  { slug: 'dining_chair_02', res: '1k', role: 'restaurant' },
  { slug: 'carved_wooden_plate', res: '1k', role: 'restaurant' },
  { slug: 'wooden_bowl_01', res: '1k', role: 'restaurant' },
  { slug: 'wine_bottles_01', res: '1k', role: 'restaurant' },
];

async function getJson(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'FareSight/1.0 (landing page assets)' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function download(url, destination) {
  if (await exists(destination)) {
    const { size } = await stat(destination);
    if (size > 0) { process.stdout.write(`  skip  ${destination.slice(outDir.length + 1)}\n`); return size; }
  }
  const response = await fetch(url, { headers: { 'User-Agent': 'FareSight/1.0 (landing page assets)' } });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, body);
  process.stdout.write(`  got   ${destination.slice(outDir.length + 1)} (${(body.length / 1048576).toFixed(2)} MB)\n`);
  return body.length;
}

/** Poly Haven asks to be credited by asset and author; §9.16 promises we will. */
async function credit(slug) {
  const info = await getJson(`${api}/info/${slug}`);
  return { slug, name: info.name ?? slug, authors: Object.keys(info.authors ?? {}), license: 'CC0' };
}

async function main() {
  const credits = [];
  let total = 0;

  console.log('HDRIs (real photographed rooms)');
  for (const { slug, res, role } of hdris) {
    const files = await getJson(`${api}/files/${slug}`);
    const entry = files.hdri?.[res]?.hdr;
    if (!entry) throw new Error(`${slug}: no ${res} .hdr available`);
    total += await download(entry.url, join(outDir, 'hdri', `${slug}_${res}.hdr`));
    credits.push({ ...(await credit(slug)), kind: 'hdri', role, file: `hdri/${slug}_${res}.hdr` });
  }

  console.log('Models (photogrammetry scans)');
  for (const { slug, res, role } of models) {
    const files = await getJson(`${api}/files/${slug}`);
    const entry = files.gltf?.[res]?.gltf;
    if (!entry) throw new Error(`${slug}: no ${res} glTF available`);
    const base = join(outDir, 'models', slug);
    total += await download(entry.url, join(base, `${slug}_${res}.gltf`));
    // glTF references its .bin and textures by relative path, so the layout matters.
    for (const [relative, file] of Object.entries(entry.include ?? {})) {
      total += await download(file.url, join(base, relative));
    }
    credits.push({ ...(await credit(slug)), kind: 'model', role, file: `models/${slug}/${slug}_${res}.gltf` });
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'credits.json'), JSON.stringify({
    source: 'Poly Haven (polyhaven.com)',
    license: 'CC0 1.0 Universal — no attribution required, credited anyway.',
    assets: credits,
  }, null, 2) + '\n');

  console.log(`\n${credits.length} assets, ${(total / 1048576).toFixed(1)} MB total.`);
  console.log('Credits written to web/public/landing/credits.json');
}

main().catch((error) => { console.error('\nFailed:', error.message); process.exit(1); });
