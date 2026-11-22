/**
 * Bakes the city this map stands on into a single GeoJSON.
 *
 * Why not vector tiles: OpenMapTiles only carries its `building` layer at z13-14, so a
 * zoomed-out view has no building data at all and the city pops into existence as you
 * zoom past 13. A baked GeoJSON source has no zoom floor, so the same massing renders
 * at every scale and the model is solid the moment it loads.
 *
 * Why the whole canvas and not a corridor: a band hugging the tracks leaves bare
 * basemap between the lines, and the reference never shows an edge — its city runs to
 * every border of the screen. So this tiles the full canvas (the deck plus a margin)
 * and leaves the thinning to cull-buildings.mjs, which keeps the result sparse enough
 * to read at model scale.
 *
 * Output is the raw cache. Run cull-buildings.mjs after it to produce what ships.
 *
 * Run: node scripts/build-buildings.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS } from './core.mjs';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');
const RAW = `${DATA}/corridor-buildings.raw.json`;

/** Buildings shorter than this are noise even before the cull. */
const MIN_HEIGHT_M = 8;
/** Ring vertices kept per footprint; enough to read as a shape, cheap to draw. */
const MAX_RING_POINTS = 10;
/**
 * Tile edge in degrees of latitude — roughly 3.3km.
 *
 * Deliberately large. The public Overpass mirrors throttle hard: forty-two small
 * requests gets 429s and 504s across every endpoint, while a dozen bigger ones go
 * through. Fewer, fatter queries beat many thin ones here.
 */
const TILE_DEG = 0.03;

/** Breathing room between requests. The mirrors are shared infrastructure. */
const PACE_MS = 4000;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

/** OSM records height in several dialects; fall back to storey count, then a default. */
function parseHeight(tags = {}) {
  if (tags.height) {
    const raw = String(tags.height).trim().toLowerCase();
    const num = parseFloat(raw);
    if (Number.isFinite(num) && num > 0) {
      return raw.includes('ft') || raw.includes("'") ? num * 0.3048 : num;
    }
  }
  for (const key of ['building:levels', 'levels']) {
    const levels = parseFloat(String(tags[key] ?? ''));
    if (Number.isFinite(levels) && levels > 0) return levels * 3.2;
  }
  return 10.5;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Rotate endpoints per attempt — when one mirror is sulking the next usually answers. */
async function overpass(ql, rotation) {
  let lastError;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const endpoint = ENDPOINTS[(rotation + attempt) % ENDPOINTS.length];
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(ql),
      });
      if (res.ok) return res.json();
      lastError = new Error(`${endpoint} answered ${res.status}`);
      // 429 means slow down, not try harder — wait longer than the usual backoff.
      if (res.status === 429) await sleep(5000);
    } catch (err) {
      lastError = err;
    }
    await sleep(2500 * (attempt + 1));
  }
  throw lastError ?? new Error('every Overpass endpoint refused');
}

/** Cover the canvas in tiles. */
function tiles() {
  const out = [];
  const lonStep = TILE_DEG / Math.cos((42.36 * Math.PI) / 180);
  for (let south = CANVAS.south; south < CANVAS.north; south += TILE_DEG) {
    for (let west = CANVAS.west; west < CANVAS.east; west += lonStep) {
      out.push([
        south,
        west,
        Math.min(south + TILE_DEG, CANVAS.north),
        Math.min(west + lonStep, CANVAS.east),
      ]);
    }
  }
  return out;
}

/** Keep the corners that carry the shape: evenly sample the ring. */
function simplifyRing(ring) {
  if (ring.length <= MAX_RING_POINTS) return ring;
  const step = (ring.length - 1) / (MAX_RING_POINTS - 1);
  const out = [];
  for (let i = 0; i < MAX_RING_POINTS - 1; i++) out.push(ring[Math.round(i * step)]);
  out.push(ring[0]);
  return out;
}

async function main() {
  const boxes = tiles();
  console.log(`${boxes.length} tiles over the canvas`);

  const nodes = new Map();
  const ways = new Map();
  const failed = [];

  const run = async (box, index) => {
    const ql = `[out:json][timeout:120];way["building"](${box.map((v) => v.toFixed(5)).join(',')});(._;>;);out body;`;
    const { elements } = await overpass(ql, index);
    for (const el of elements) {
      if (el.type === 'node') nodes.set(el.id, [el.lon, el.lat]);
      else if (el.type === 'way' && el.tags?.building) ways.set(el.id, el);
    }
  };

  for (const [index, box] of boxes.entries()) {
    if (index) await sleep(PACE_MS);
    try {
      await run(box, index);
      if ((index + 1) % 2 === 0 || index === boxes.length - 1) {
        console.log(`  ${index + 1}/${boxes.length} tiles, ${ways.size} buildings`);
      }
    } catch (err) {
      failed.push([box, index]);
      console.warn(`  ! tile ${index}: ${err.message}`);
    }
  }

  // Flaky mirrors are the norm here, so give every miss a second pass before giving up.
  if (failed.length) {
    console.log(`retrying ${failed.length} tiles`);
    for (const [box, index] of failed) {
      await sleep(PACE_MS * 2);
      try {
        await run(box, index + 1);
      } catch (err) {
        console.warn(`  ! tile ${index} failed twice: ${err.message}`);
      }
    }
  }

  const features = [];
  for (const way of ways.values()) {
    const ring = (way.nodes ?? []).map((id) => nodes.get(id)).filter(Boolean);
    if (ring.length < 4) continue;

    const height = parseHeight(way.tags);
    if (height < MIN_HEIGHT_M) continue;

    const simplified = simplifyRing(ring).map(([lon, lat]) => [
      Number(lon.toFixed(5)),
      Number(lat.toFixed(5)),
    ]);
    // A simplified ring has to close, or MapLibre drops the polygon.
    const first = simplified[0];
    const last = simplified[simplified.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) simplified.push(first);

    features.push({
      type: 'Feature',
      properties: { h: Math.round(height * 10) / 10 },
      geometry: { type: 'Polygon', coordinates: [simplified] },
    });
  }

  // Merge with whatever a previous run managed, so a flaky session still accumulates.
  if (existsSync(RAW)) {
    const previous = JSON.parse(readFileSync(RAW, 'utf8'));
    const seen = new Set(features.map((f) => JSON.stringify(f.geometry.coordinates[0][0])));
    let merged = 0;
    for (const old of previous.features) {
      const key = JSON.stringify(old.geometry.coordinates[0][0]);
      if (!seen.has(key)) { features.push(old); seen.add(key); merged++; }
    }
    if (merged) console.log(`merged ${merged} buildings from the previous cache`);
  }

  const collection = { type: 'FeatureCollection', features };
  writeFileSync(RAW, JSON.stringify(collection));

  const kb = Math.round(JSON.stringify(collection).length / 1024);
  console.log(`\n${features.length} buildings -> corridor-buildings.raw.json (${kb} KB)`);
  console.log('Now run: node scripts/cull-buildings.mjs');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
