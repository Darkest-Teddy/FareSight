// Pins city-footprints.json: the real Boston and Cambridge buildings the map's city is chosen from.
//
//   node modeling/pin_city_footprints.mjs <path to the Map Redesign export>/faresight-map
//
// The export carries every building footprint in the two cities with its recorded height
// (map/buildings.json: City of Boston BPDA "Boston_Buildings", height BLDG_HGT_2010 in feet, and
// City of Cambridge BASEMAP_Buildings, height TOP_GL), in sculpture coordinates x 1e5. That is
// 51,400 footprints and 5 MB, far more than the map can show, and the export's own page
// (map.js, buildCity) shows how to choose among them: compact, tower-like footprints only, the
// most slender and tallest first. This script applies that page's filters and ranking and keeps
// the head of the list, each building with the neighbours that share its walls, so the generator
// (city.mjs) can make the same choice against the network it actually has without carrying the
// whole survey around.
//
// Nothing here is random and the survey is not re-fetched: the same export gives the same file.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , exportDir] = process.argv;
if (!exportDir) {
  console.error('Usage: node modeling/pin_city_footprints.mjs <faresight-map export folder>');
  process.exit(1);
}

const BOUNDS = { x0: -0.75, x1: 0.75, z0: -0.525, z1: 0.525 };
const METRES = 6500;
const FEET = 0.3048;

/** How many of the ranked candidates are kept: every tower-like one, and this many of the rest. */
const SQUAT_KEPT = 140;

// ---------------------------------------------------------------------------------------------
// The city zone: where the export page lets buildings stand. It reads this off the ground plane
// of the sculpture it was built on (the blue of each ground vertex, drawn as a 12.6 px square into
// a 1500 x 1050 mask and blurred by 5 px), and so does this.
// ---------------------------------------------------------------------------------------------

function groundVertices(path) {
  const file = readFileSync(path);
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  const bin = file.subarray(20 + jsonLength + 8);
  const read = (index) => {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const width = { VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const bytes = { 5121: 1, 5123: 2, 5126: 4 }[accessor.componentType];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride || width * bytes;
    const out = [];
    for (let i = 0; i < accessor.count; i++) {
      const row = [];
      for (let k = 0; k < width; k++) {
        const at = start + i * stride + k * bytes;
        row.push(bytes === 4 ? bin.readFloatLE(at) : bytes === 2 ? bin.readUInt16LE(at) / 65535 : bin.readUInt8(at) / 255);
      }
      out.push(row);
    }
    return out;
  };
  for (const node of gltf.nodes) {
    if (node.mesh === undefined) continue;
    const part = gltf.meshes[node.mesh].primitives[0];
    if (gltf.materials[part.material].name !== 'Ground plane') continue;
    const shift = node.translation ?? [0, 0, 0];
    const colours = read(part.attributes.COLOR_0);
    return read(part.attributes.POSITION).map((p, i) => [p[0] + shift[0], p[2] + shift[2], colours[i][2]]);
  }
  throw new Error('The export sculpture has no ground plane');
}

function cityZone(path) {
  const W = 1500;
  const H = 1050;
  const sx = W / (BOUNDS.x1 - BOUNDS.x0);
  const sz = H / (BOUNDS.z1 - BOUNDS.z0);
  const drawn = new Float32Array(W * H);
  const cell = 0.012 * sx * 1.05;
  for (const [x, z, blue] of groundVertices(path)) {
    const t = Math.max(0, Math.min(1, (blue - 0.0159) / (0.1022 - 0.0159)));
    if (t <= 0.02) continue;
    const left = (x - BOUNDS.x0) * sx - cell / 2;
    const top = (z - BOUNDS.z0) * sz - cell / 2;
    for (let j = Math.max(0, Math.round(top)); j < Math.min(H, Math.round(top + cell)); j++)
      for (let i = Math.max(0, Math.round(left)); i < Math.min(W, Math.round(left + cell)); i++)
        drawn[j * W + i] += t * (1 - drawn[j * W + i]);
  }
  const kernel = [];
  for (let i = -15; i <= 15; i++) kernel.push(Math.exp((-i * i) / 50));
  const total = kernel.reduce((sum, v) => sum + v, 0);
  const pass = (from, step, limit, along) => {
    const to = new Float32Array(W * H);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        let sum = 0;
        for (let k = -15; k <= 15; k++) {
          const at = (along ? i : j) + k;
          if (at >= 0 && at < limit) sum += from[j * W + i + k * step] * kernel[k + 15];
        }
        to[j * W + i] = sum / total;
      }
    return to;
  };
  const zone = pass(pass(drawn, 1, W, true), W, H, false);
  return (x, z) => {
    const i = ((x - BOUNDS.x0) * sx) | 0;
    const j = ((z - BOUNDS.z0) * sz) | 0;
    return i < 0 || j < 0 || i >= W || j >= H ? 0 : Math.round(zone[j * W + i] * 255) / 255;
  };
}

// ---------------------------------------------------------------------------------------------
// The buildings.
// ---------------------------------------------------------------------------------------------

const zoneAt = cityZone(join(exportDir, 'map/boston-map-sculpture.glb'));
const survey = JSON.parse(readFileSync(join(exportDir, 'map/buildings.json')));

/** Every footprint with a height, bucketed, for finding the neighbours of a chosen one. */
const NEAR = 0.004;
const buckets = new Map();
for (const [height, ring] of survey) {
  const n = ring.length / 2;
  if (n < 3 || !(height > 0)) continue;
  let x = 0;
  let z = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    z += ring[i + 1];
  }
  const entry = { ring, height, x: x / n / 1e5, z: z / n / 1e5 };
  const key = Math.floor(entry.x / NEAR) + ':' + Math.floor(entry.z / NEAR);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(entry);
}
const touching = (a, b) => {
  const t = 0.00045 * 1e5;
  for (let i = 0; i < a.length; i += 2)
    for (let j = 0; j < b.length; j += 2)
      if (Math.abs(a[i] - b[j]) < t && Math.abs(a[i + 1] - b[j + 1]) < t) return true;
  return false;
};
/** The real complex: footprints that share walls with this one and with each other, up to 12 within about 90 m. */
function complexOf(main) {
  const parts = [main];
  const seen = new Set([main.ring]);
  for (let q = 0; q < parts.length && parts.length < 12; q++) {
    const p = parts[q];
    const ci = Math.floor(p.x / NEAR);
    const cj = Math.floor(p.z / NEAR);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const other of buckets.get(ci + i + ':' + (cj + j)) ?? []) {
          if (seen.has(other.ring) || parts.length >= 12) continue;
          if (Math.hypot(other.x - main.x, other.z - main.z) > 0.014) continue;
          if (touching(p.ring, other.ring)) {
            seen.add(other.ring);
            parts.push(other);
          }
        }
  }
  return parts.slice(1);
}

const candidates = [];
for (const [height, ring] of survey) {
  const n = ring.length / 2;
  if (n < 3 || n > 40) continue;
  let x = 0;
  let z = 0;
  for (let i = 0; i < ring.length; i += 2) {
    x += ring[i];
    z += ring[i + 1];
  }
  x /= n * 1e5;
  z /= n * 1e5;
  const zone = zoneAt(x, z);
  if (zone < 0.35) continue;
  let twice = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const j = (i + 2) % ring.length;
    twice += ring[i] * ring[j + 1] - ring[j] * ring[i + 1];
  }
  const area = Math.abs(twice) / 2 / 1e10;
  if (!(area > 0)) continue;
  // Compact, tower-like footprints only: no long slabs, sprawling low blocks or ragged courtyards.
  const span = Math.sqrt(area) * METRES;
  const tall = height * FEET;
  if (span > 45 || span < 8 || !(height > 0)) continue;
  let tier = tall >= span * 1.4 && span <= 40 ? 0 : tall >= span * 0.7 ? 1 : 2;
  if (tier === 2) continue;
  // How long and how full the footprint is, along its own principal axis.
  let sxx = 0;
  let szz = 0;
  let sxz = 0;
  for (let i = 0; i < ring.length; i += 2) {
    const [u, v] = [ring[i] / 1e5 - x, ring[i + 1] / 1e5 - z];
    sxx += u * u;
    szz += v * v;
    sxz += u * v;
  }
  const lean = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const [cos, sin] = [Math.cos(lean), Math.sin(lean)];
  let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < ring.length; i += 2) {
    const [p, q] = [ring[i] / 1e5 - x, ring[i + 1] / 1e5 - z];
    const [u, v] = [p * cos + q * sin, -p * sin + q * cos];
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  const aspect = Math.max(u1 - u0, v1 - v0) / Math.max(Math.min(u1 - u0, v1 - v0), 1e-9);
  const fill = area / ((u1 - u0) * (v1 - v0));
  if (aspect > 2 || fill < 0.65) continue;
  if (aspect > 1.6 || fill < 0.72) tier = 1;
  candidates.push({
    ring, height, x, z, zone, tier,
    score: (tier ? 0 : 1e6) + (tall / span) * Math.sqrt(tall) * (0.7 + zone * 0.3),
  });
}
candidates.sort((a, b) => b.score - a.score);
const towers = candidates.filter((c) => c.tier === 0).length;
const kept = candidates.slice(0, towers + SQUAT_KEPT);

const round = (v) => Math.round(v * 1000) / 1000;
writeFileSync(
  new URL('city-footprints.json', import.meta.url),
  JSON.stringify({
    source:
      'Real building footprints for the map sculpture, pinned by modeling/pin_city_footprints.mjs from map/buildings.json of the FareSight Map Redesign export: City of Boston (BPDA) Boston_Buildings and City of Cambridge BASEMAP_Buildings. These are the compact, tower-like footprints the export page ranks first, in its order (every tower-like one, then the next ' +
      SQUAT_KEPT +
      '). Each is {h, zone, tier, r, parts}: h the recorded height in feet; zone how far inside the export page\'s city zone it stands (0.35 to 1); tier 0 tower-like, 1 squatter; r its outline as [x0, z0, x1, z1, ...] in sculpture units x 100000 (x east, z south; shared/src/projection.ts); parts the adjoining footprints that share its walls, each [h, r].',
    footprints: kept.map((c) => ({
      h: round(c.height),
      zone: c.zone,
      tier: c.tier,
      r: c.ring,
      parts: complexOf({ ring: c.ring, height: c.height, x: c.x, z: c.z }).map((p) => [round(p.height), p.ring]),
    })),
  }),
);
console.log(`${survey.length} surveyed, ${candidates.length} candidates in the city zone, ${towers} tower-like; pinned ${kept.length}`);
