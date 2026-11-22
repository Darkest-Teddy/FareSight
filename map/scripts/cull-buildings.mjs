/**
 * Thins the baked corridor down to the massing that actually reads at model scale.
 *
 * The deck is 7.10km across and opens at roughly 4.7 metres per pixel, so a 20m-wide
 * building is four pixels — a speck. Ten thousand specks is not detail, it is grain:
 * it fills the plaque with noise and buries the transit ribbons the map exists to show.
 *
 * So this keeps the buildings you could actually pick out from across the deck. A
 * selection grid guarantees the result stays spread across the whole footprint rather
 * than collapsing into one dense knot downtown, and the tallest towers are kept
 * unconditionally because a skyline is what makes a model legible as a city.
 *
 * Re-runnable: it reads the raw cache, never Overpass, so thresholds are cheap to tune.
 *
 * Run: node scripts/cull-buildings.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');
const RAW = `${DATA}/corridor-buildings.raw.json`;
const OUT = `${DATA}/corridor-buildings.geojson`;

/**
 * Selection grid, in metres. The canvas is roughly 100 square kilometres, so the cell
 * has to be coarse or the count runs to five figures: at 300m it is about 1,100 cells,
 * and only the ones with real city in them contribute.
 */
const CELL_M = 300;
/** How many buildings survive per cell — enough to suggest a block, not a texture. */
const PER_CELL = 2;
/** Towers are kept wherever they are; a skyline is what sells the model. */
const LANDMARK_H = 45;
/** Below this footprint a building cannot register at all, whatever else is true. */
const MIN_AREA_M2 = 320;

const M_PER_DEG_LAT = 110_540;
const mPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

/** Shoelace area of a lon/lat ring, converted to square metres. */
function areaOf(ring) {
  const lat = ring.reduce((sum, p) => sum + p[1], 0) / ring.length;
  const sx = mPerDegLon(lat);
  let acc = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[j];
    acc += x1 * sx * (y2 * M_PER_DEG_LAT) - x2 * sx * (y1 * M_PER_DEG_LAT);
  }
  return Math.abs(acc / 2);
}

function centroid(ring) {
  let x = 0, y = 0;
  for (const [lon, lat] of ring) { x += lon; y += lat; }
  return [x / ring.length, y / ring.length];
}

function main() {
  if (!existsSync(RAW)) {
    console.error(`No raw cache at ${RAW}. Run scripts/build-buildings.mjs first.`);
    process.exit(1);
  }

  const raw = JSON.parse(readFileSync(RAW, 'utf8'));
  const cells = new Map();
  const landmarks = [];
  let tooSmall = 0;

  for (const feature of raw.features) {
    const ring = feature.geometry.coordinates[0];
    const area = areaOf(ring);
    const height = feature.properties.h ?? 10;

    if (height >= LANDMARK_H) {
      landmarks.push(feature);
      continue;
    }
    if (area < MIN_AREA_M2) { tooSmall++; continue; }

    const [lon, lat] = centroid(ring);
    const key = `${Math.round((lat * M_PER_DEG_LAT) / CELL_M)}:${Math.round((lon * mPerDegLon(lat)) / CELL_M)}`;
    let bucket = cells.get(key);
    if (!bucket) cells.set(key, (bucket = []));
    // Visual mass: a wide low block and a narrow tall one can both earn their place.
    bucket.push({ feature, score: area * Math.max(height, 4) });
  }

  const kept = [...landmarks];
  for (const bucket of cells.values()) {
    bucket.sort((a, b) => b.score - a.score);
    for (const entry of bucket.slice(0, PER_CELL)) kept.push(entry.feature);
  }

  const out = { type: 'FeatureCollection', features: kept };
  writeFileSync(OUT, JSON.stringify(out));

  const kb = Math.round(JSON.stringify(out).length / 1024);
  console.log(`raw            ${raw.features.length}`);
  console.log(`  dropped tiny ${tooSmall}`);
  console.log(`  landmarks    ${landmarks.length} (over ${LANDMARK_H}m)`);
  console.log(`  grid cells   ${cells.size} x ${PER_CELL}`);
  console.log(`kept           ${kept.length} buildings -> corridor-buildings.geojson (${kb} KB)`);
}

main();
