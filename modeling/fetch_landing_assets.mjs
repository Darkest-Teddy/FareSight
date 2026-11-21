/**
 * Downloads the photographic source material for the landing page.
 *
 *   node modeling/fetch_landing_assets.mjs
 *
 * The landing page shows two real rooms that come apart and rebuild themselves
 * as you scroll, so every surface in them has to be real. Three kinds of asset
 * make that possible, all CC0 from Poly Haven:
 *
 *   models    Photogrammetry scans. The sofa, the dining chairs, the plate
 *             and the bowl are scans of real objects rather than someone's
 *             idea of what those objects look like.
 *   textures  Measured PBR sets, used on the architecture we build ourselves.
 *             The floor and walls have to be our own geometry because they
 *             need to break into pieces, and these are what stop that
 *             geometry reading as flat-shaded boxes.
 *   hdris     360-degree photographs of real rooms, kept as lighting only.
 *             They are what make the scans above sit in the room instead of
 *             floating in it, and they are never shown directly.
 *
 * HDRIs land in modeling/hdri-src rather than web/public, because at 5-6 MB
 * each they must not ship to a browser. bake_landing_env.mjs turns them into
 * the small light probes the page actually loads.
 *
 * Re-running skips files already on disk, so it is safe to interrupt.
 */
import { mkdir, writeFile, access, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'web', 'public', 'landing');
const hdriDir = join(root, 'modeling', 'hdri-src');
const api = 'https://api.polyhaven.com';

/** Lighting only. `role` is which act of the scroll each belongs to. */
const hdris = [
  { slug: 'hotel_room', res: '2k', role: 'home' },
  { slug: 'warm_restaurant', res: '2k', role: 'restaurant' },
];

/** Photogrammetry scans, placed as-is into the two rooms. */
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

/**
 * Surfaces for the architecture we build. `arm` packs ambient occlusion,
 * roughness and metalness into one image, which is the layout PlayCanvas
 * reads channel by channel.
 */
const textures = [
  { slug: 'laminate_floor', res: '1k', role: 'home', use: 'floor' },
  { slug: 'painted_plaster_wall', res: '1k', role: 'home', use: 'wall' },
  { slug: 'floor_tiles_06', res: '1k', role: 'restaurant', use: 'floor' },
  { slug: 'brick_wall_003', res: '1k', role: 'restaurant', use: 'wall' },
];
const textureMaps = ['Diffuse', 'nor_gl', 'arm'];

const agent = { 'User-Agent': 'FareSight/1.0 (landing page assets)' };

async function getJson(url) {
  const response = await fetch(url, { headers: agent });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  return response.json();
}

async function exists(path) {
  try { return (await stat(path)).size > 0; } catch { return false; }
}

async function download(url, destination, label) {
  if (await exists(destination)) { process.stdout.write(`  skip  ${label}\n`); return 0; }
  const response = await fetch(url, { headers: agent });
  if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, body);
  process.stdout.write(`  got   ${label} (${(body.length / 1048576).toFixed(2)} MB)\n`);
  return body.length;
}

/** Poly Haven assets are CC0, but master plan 9.16 promises credit anyway. */
async function credit(slug, extra) {
  const info = await getJson(`${api}/info/${slug}`);
  return { slug, name: info.name ?? slug, authors: Object.keys(info.authors ?? {}), license: 'CC0', ...extra };
}

async function main() {
  const credits = [];
  let total = 0;

  console.log('HDRIs -> modeling/hdri-src (lighting source, never served)');
  for (const { slug, res, role } of hdris) {
    const files = await getJson(`${api}/files/${slug}`);
    const entry = files.hdri?.[res]?.hdr;
    if (!entry) throw new Error(`${slug}: no ${res} .hdr`);
    total += await download(entry.url, join(hdriDir, `${slug}_${res}.hdr`), `${slug}_${res}.hdr`);
    credits.push(await credit(slug, { kind: 'hdri', role, file: `env/${role}-light.jpg` }));
  }

  console.log('Models (photogrammetry scans)');
  for (const { slug, res, role } of models) {
    const files = await getJson(`${api}/files/${slug}`);
    const entry = files.gltf?.[res]?.gltf;
    if (!entry) throw new Error(`${slug}: no ${res} glTF`);
    const base = join(outDir, 'models', slug);
    total += await download(entry.url, join(base, `${slug}_${res}.gltf`), `models/${slug}`);
    // glTF resolves its .bin and textures by relative path, so the tree matters.
    for (const [relative, file] of Object.entries(entry.include ?? {})) {
      total += await download(file.url, join(base, relative), `models/${slug}/${relative}`);
    }
    credits.push(await credit(slug, { kind: 'model', role, file: `models/${slug}/${slug}_${res}.gltf` }));
  }

  console.log('Textures (measured PBR for the architecture)');
  for (const { slug, res, role, use } of textures) {
    const files = await getJson(`${api}/files/${slug}`);
    const base = join(outDir, 'textures', slug);
    for (const map of textureMaps) {
      const entry = files[map]?.[res]?.jpg;
      if (!entry) { console.log(`  note  ${slug} has no ${map}, skipping`); continue; }
      const name = entry.url.split('/').pop();
      total += await download(entry.url, join(base, name), `textures/${slug}/${name}`);
    }
    credits.push(await credit(slug, { kind: 'texture', role, use, dir: `textures/${slug}` }));
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'credits.json'), JSON.stringify({
    source: 'Poly Haven (polyhaven.com)',
    license: 'CC0 1.0 Universal. No attribution required; credited anyway.',
    assets: credits,
  }, null, 2) + '\n');

  console.log(`\n${credits.length} assets, ${(total / 1048576).toFixed(1)} MB downloaded this run.`);
  console.log('Next: node modeling/bake_landing_env.mjs');
}

main().catch((error) => { console.error('\nFailed:', error.message); process.exit(1); });
