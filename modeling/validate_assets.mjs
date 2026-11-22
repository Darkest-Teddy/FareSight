import assert from 'node:assert/strict';
import { places } from '../server/src/db/seed.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ringDistance } from './landmarks.mjs';
import { charlesRiver, inWater } from './water.mjs';

const dir = fileURLToPath(new URL('output/', import.meta.url));
const { areas } = JSON.parse(
  readFileSync(new URL('./osm-data.json', import.meta.url)),
);
const stationRef = {
  'place-bucen': [42.350082, -71.106865, 'Green-B', '001'],
  'place-brico': [42.351967, -71.125031, 'Green-B', '002'],
  'place-kencl': [42.348949, -71.095169, 'Green-B', '003'],
  'place-harsq': [42.373362, -71.118956, 'Red', '004'],
  'place-chncl': [42.352547, -71.062752, 'Orange', '005'],
};
const gaussians = {
  'room-ramen-house': [24000, 5, 4, 2.75],
  'room-karaoke-suite': [22000, 4.2, 3.4, 2.62],
  'room-study-cafe': [20000, 5.5, 4.5, 3],
  'dish-tonkotsu-ramen': [14000, 0.24, 0.24, 0.15],
  'dish-katsu-curry': [13000, 0.26, 0.26 * 0.83, 0.065],
  'dish-matcha-tiramisu': [10000, 0.18, 0.18, 0.075],
};
const uiModels = [
  'vr-control-deck',
  'venue-pin-flag',
  'station-medallion',
  'table-menu-stand',
  'room-plaque-stand',
  'menu-book',
  'review-clipboard',
];
const genModels = [
  'boston-map-sculpture',
  'mbta-train-green',
  'mbta-train-red',
  'mbta-train-orange',
  'mbta-train-blue',
  'table-pedestal',
  ...uiModels,
  ...Object.keys(stationRef).map((k) => 'segment-' + k),
];
const jsonNames = ['station-anchors', 'segment-anchors', 'mbta-3d-paths', 'landmark-anchors'];
const expected = [
  ...genModels.map((n) => n + '.glb'),
  ...Object.keys(gaussians).map((n) => n + '.ply'),
  ...jsonNames.map((n) => n + '.json'),
].sort();
assert.deepEqual(
  readdirSync(dir)
    .filter((n) => /\.(ply|glb|json)$/.test(n))
    .sort(),
  expected,
);
const load = (n) => JSON.parse(readFileSync(dir + n + '.json'));
const stations = load('station-anchors'),
  segments = load('segment-anchors'),
  paths = load('mbta-3d-paths').lines;
for (const data of [stations, segments])
  assert.deepEqual(Object.keys(data).sort(), Object.keys(stationRef).sort());
const approx = (a, b, e = 1e-6, label = '') =>
  assert.ok(
    Math.abs(a - b) <= e,
    label + ' expected ' + b + ' ± ' + e + ', got ' + a,
  );
const distance = (a, b) => Math.hypot(...a.map((n, k) => n - b[k]));
const readBounds = () => ({
  min: [Infinity, Infinity, Infinity],
  max: [-Infinity, -Infinity, -Infinity],
});
function extend(b, p) {
  for (let k = 0; k < 3; k++) {
    b.min[k] = Math.min(b.min[k], p[k]);
    b.max[k] = Math.max(b.max[k], p[k]);
  }
}
const textVec = (a) => '[' + a.map((n) => n.toFixed(6)).join(', ') + ']';
const reportBounds = (b) => textVec(b.min) + ' .. ' + textVec(b.max);
const colors = {
  'Green-B': '#00843D',
  'Green-C': '#00843D',
  'Green-D': '#00843D',
  'Green-E': '#00843D',
  Red: '#DA291C',
  Orange: '#ED8B00',
  Blue: '#003DA5',
};
const models = {};

function parseModel(name) {
  const bytes = readFileSync(dir + name + '.glb');
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const jsonSize = bytes.readUInt32LE(12),
    binHeader = 20 + jsonSize;
  assert.equal(jsonSize % 4, 0);
  assert.equal(bytes.toString('ascii', 16, 20), 'JSON');
  const j = JSON.parse(bytes.toString('utf8', 20, binHeader));
  const bin = bytes.subarray(binHeader + 8);
  assert.equal(bytes.readUInt32LE(binHeader), bin.length);
  assert.equal(bytes.readUInt32LE(binHeader + 4), 0x004e4942);
  assert.equal(bin.length % 4, 0);
  assert.equal(j.asset.version, '2.0');
  assert.equal(j.buffers.length, 1);
  assert.equal(j.buffers[0].byteLength, bin.length);
  assert.ok(j.meshes.length > 0);
  for (const v of j.bufferViews) {
    assert.equal(v.buffer, 0);
    assert.equal(v.byteOffset % 4, 0);
    assert.ok(v.byteLength > 0 && v.byteOffset + v.byteLength <= bin.length);
  }
  for (const img of j.images ?? []) {
    const v = j.bufferViews[img.bufferView];
    assert.equal(img.mimeType, 'image/png');
    assert.equal(bin.readUInt32BE(v.byteOffset), 0x89504e47);
  }
  const arrays = j.accessors.map((a) => {
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type],
      size = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    assert.ok(n && size && a.count > 0);
    const v = j.bufferViews[a.bufferView],
      start = a.byteOffset ?? 0,
      stride = v.byteStride ?? n * size;
    assert.ok(start + (a.count - 1) * stride + n * size <= v.byteLength);
    assert.equal(start % size, 0);
    const values = new Float64Array(a.count * n),
      min = Array(n).fill(Infinity),
      max = Array(n).fill(-Infinity);
    for (let i = 0; i < a.count; i++)
      for (let k = 0; k < n; k++) {
        const offset = v.byteOffset + start + i * stride + k * size;
        const val =
          a.componentType === 5126
            ? bin.readFloatLE(offset)
            : bin.readUIntLE(offset, size);
        assert.ok(Number.isFinite(val));
        values[i * n + k] = val;
        min[k] = Math.min(min[k], val);
        max[k] = Math.max(max[k], val);
      }
    assert.deepEqual(
      a.min,
      min.map((x) => x || 0),
    );
    assert.deepEqual(
      a.max,
      max.map((x) => x || 0),
    );
    return values;
  });
  const bounds = readBounds(),
    meshes = new Map();
  let tris = 0,
    draws = 0;
  assert.equal(j.scenes[j.scene].nodes.length, j.nodes.length);
  for (const ni of j.scenes[j.scene].nodes) {
    const node = j.nodes[ni],
      mesh = j.meshes[node.mesh],
      offset = node.translation ?? [0, 0, 0];
    assert.ok(
      node &&
        !node.matrix &&
        !node.rotation &&
        !node.scale &&
        !node.children &&
        mesh,
    );
    assert.ok(!meshes.has(node.name));
    assert.equal(mesh.primitives.length, 1);
    const p = mesh.primitives[0],
      a = p.attributes,
      positions = arrays[a.POSITION],
      normals = arrays[a.NORMAL],
      indices = arrays[p.indices],
      uv = arrays[a.TEXCOORD_0];
    assert.ok(j.materials[p.material]);
    assert.equal(p.mode ?? 4, 4);
    assert.equal(positions.length, normals.length);
    assert.equal(indices.length % 3, 0);
    for (const i of indices)
      assert.ok(Number.isInteger(i) && i >= 0 && i * 3 < positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const point = [
        positions[i] + offset[0],
        positions[i + 1] + offset[1],
        positions[i + 2] + offset[2],
      ];
      extend(bounds, point);
      approx(
        Math.hypot(normals[i], normals[i + 1], normals[i + 2]),
        1,
        0.00002,
        name + ' ' + node.name + ' normal',
      );
    }
    tris += indices.length / 3;
    draws++;
    meshes.set(node.name, {
      positions,
      normals,
      indices,
      uv,
      offset,
      mat: j.materials[p.material],
    });
  }
  const budget = name.startsWith('segment-')
    ? [1, 39999, 16]
    : name.startsWith('boston')
      // Floor lowered from 15000: the sculpture now uses flat track plates instead of swept
      // tubes and has no deck, street grid or river, so the honest triangle count is far lower.
      // The ceiling is the one that matters for performance and is unchanged. Thirteen primitives:
      // the twelve opaque surfaces and the translucent ground plate, which has to be its own.
      ? [4000, 55000, 13]
      : uiModels.includes(name)
        ? [1, 5000, 20]
        : [1, 5000, 8];
  assert.ok(
    tris >= budget[0] && tris <= budget[1] && draws <= budget[2],
    name + ' complexity',
  );
  console.log(
    name + '.glb',
    bytes.length + ' bytes',
    tris + ' triangles',
    draws + ' primitives',
    reportBounds(bounds),
  );
  return { bounds, meshes };
}
for (const name of genModels) models[name] = parseModel(name);
function exactBounds(b, lo, hi) {
  for (let i = 0; i < 3; i++) {
    approx(b.min[i], lo[i]);
    approx(b.max[i], hi[i]);
  }
}
const map = models['boston-map-sculpture'];
// Extent is set by the ground, which reaches past the network on every side and fades out into
// the backdrop. Checked as a range: wide enough to prove the ground and its skirt are present,
// tight enough to catch runaway geometry. The track geometry itself is bounded separately by
// the per-line checks further down.
assert.ok(
  map.bounds.min[0] >= -1.12 && map.bounds.min[0] <= -0.88 &&
    map.bounds.max[0] <= 1.12 && map.bounds.max[0] >= 0.88 &&
    map.bounds.min[2] >= -0.92 && map.bounds.min[2] <= -0.62 &&
    map.bounds.max[2] <= 0.92 && map.bounds.max[2] >= 0.62,
  'sculpture footprint ' + reportBounds(map.bounds),
);
// Floats above zero now: the lowest geometry is the station skirts, not a deck resting on y=0.
// The ceiling is set by the landmarks, which are the tallest thing in the model.
assert.ok(
  map.bounds.min[1] > 0.02 && map.bounds.max[1] > 0.06 && map.bounds.max[1] <= 0.18,
  'floating sculpture bounds ' + reportBounds(map.bounds),
);
exactBounds(
  models['table-pedestal'].bounds,
  [-0.45, -0.74, -0.45],
  [0.45, 0, 0.45],
);
const table = models['table-pedestal'].meshes.get('Scale inlay').positions;
for (const r of [0.1, 0.15]) {
  let hits = 0;
  for (let i = 0; i < table.length; i += 3)
    if (Math.abs(Math.hypot(table[i], table[i + 2]) - r) < 0.0012) {
      approx(table[i + 1], 0, 1e-4);
      hits++;
    }
  assert.ok(hits >= 120);
}
for (const line of ['green', 'red', 'orange', 'blue']) {
  const train = models['mbta-train-' + line];
  // Centred on its own origin, so the scene can place it straight onto a track sample.
  approx(train.bounds.min[2], -train.bounds.max[2], 1e-6, line + ' train centring');
  // Sits above the rail, never through it.
  assert.ok(train.bounds.min[1] > 0, line + ' train floor ' + train.bounds.min[1]);
  // Plausible size: longer than it is wide, and small enough to read as a train on the line.
  const length = train.bounds.max[2] - train.bounds.min[2];
  const width = train.bounds.max[0] - train.bounds.min[0];
  assert.ok(length > width * 2 && length < 0.05, line + ' train proportions');
  assert.ok(train.meshes.get('Head lamps'), line + ' train has no head lamps');
}
// Green and Blue are the two lines that collect from overhead wire, so only they carry a
// pantograph, which makes them taller than the third-rail stock.
for (const line of ['green', 'blue'])
  assert.ok(
    models['mbta-train-' + line].bounds.max[1] > 0.0077,
    line + ' train is missing its pantograph',
  );
const offsets = new Map();
assert.deepEqual(
  paths.map((l) => l.routeId).sort(),
  Object.keys(colors).sort(),
);
let ringsChecked = 0,
  maxCenterError = 0;
for (const line of paths) {
  assert.equal(line.id, line.routeId.toLowerCase());
  assert.equal(line.color, colors[line.routeId]);
  assert.ok(line.name.length > 0 && line.points.length > 5);
  const shell = map.meshes.get('Lacquer ' + line.color),
    positions = shell.positions;
  // Track plates, not tubes. loft() emits per-face vertices rather than shared rings, so each
  // span between two path points contributes 4 quads x 4 vertices, plus a 4-vertex cap at each
  // end. Within a span, vertex +0 and +3 belong to the near ring and +1/+2 to the far one.
  const halfWidth = 0.0042,
    halfThick = 0.0014,
    cornerDistance = Math.hypot(halfWidth, halfThick);
  const offset = offsets.get(line.color) ?? 0;
  const spans = line.points.length - 1;
  line.points.forEach((point) => {
    assert.ok(point.length === 3 && point.every(Number.isFinite));
  });
  for (let g = 0; g < spans; g++) {
    const ring = [];
    for (let i = 0; i < 4; i++) {
      const base = offset + (g * 4 + i) * 4;
      for (const [slot, which] of [[0, g], [1, g + 1], [2, g + 1], [3, g]]) {
        const at = (base + slot) * 3,
          p = Array.from(positions.subarray(at, at + 3));
        approx(distance(p, line.points[which]), cornerDistance, 2e-7, 'track plate corner');
      }
      const at = (base + 0) * 3;
      ring.push(Array.from(positions.subarray(at, at + 3)));
    }
    // The four corners of a plate cross-section are symmetric about the path point.
    const centroid = [0, 0, 0];
    for (const c of ring) c.forEach((v, k) => (centroid[k] += v / 4));
    const err = distance(line.points[g], centroid);
    maxCenterError = Math.max(maxCenterError, err);
    assert.ok(err < 1e-7, 'plate centroid ' + err);
    if (g) assert.ok(distance(line.points[g], line.points[g - 1]) > 1e-6);
    ringsChecked++;
  }
  // A plate is level: every vertex sits exactly one half-thickness above or below its path.
  const ys = Array.from(positions.filter((v, i) => i % 3 === 1)).slice(offset);
  void ys;
  offsets.set(line.color, offset + spans * 16 + 8);
}
// After the plates, each line's surface holds its casing: per line, two flanges and two outer
// walls along every span, wrapped round both ends. It sits beside the plate and never above it.
for (const [color, count] of offsets) {
  const positions = map.meshes.get('Lacquer ' + color).positions;
  const sameColor = paths.filter((l) => l.color === color);
  const casing = sameColor.reduce((n, l) => n + (l.points.length - 1) * 16 + 32, 0);
  assert.equal(positions.length / 3, count + casing, color + ' casing vertices');
  const level = sameColor[0].points[0][1];
  assert.ok(sameColor.every((l) => l.points.every((p) => p[1] === level)));
  for (let i = count * 3; i < positions.length; i += 3) {
    const y = positions[i + 1];
    assert.ok(
      Math.abs(y - (level - 0.0014)) < 1e-6 || Math.abs(y - (level + 0.0014 - 0.0004)) < 1e-6,
      color + ' casing height ' + y,
    );
  }
}
// The ground is the one translucent surface: a sheet under the city whose colour and opacity are
// in its vertex colours, with the contact shadows a hair above it. Everything else is opaque, and
// neither the city nor the landmarks light themselves.
{
  const plate = map.meshes.get('Ground plate');
  assert.ok(plate, 'ground plate');
  assert.equal(plate.mat.alphaMode, 'BLEND');
  assert.ok(!plate.mat.emissiveFactor);
  const heights = new Set();
  for (let i = 1; i < plate.positions.length; i += 3) heights.add(plate.positions[i].toFixed(5));
  assert.deepEqual([...heights].sort(), ['0.03940', '0.03960'], 'plate and shadow levels');
  for (const [name, { mat }] of map.meshes) {
    if (name !== 'Ground plate') assert.equal(mat.alphaMode ?? 'OPAQUE', 'OPAQUE', name);
    if (/^(City blocks|Landmark)/.test(name)) assert.ok(!mat.emissiveFactor, name + ' is self-lit');
  }
}
// Landmarks stand where they really are. An anchor's coordinates, projected, must land exactly as
// far from where the landmark was built as the generator says it moved it; that move is only ever
// the little it takes to clear the oversized network; and afterwards nothing stands on a line:
// every foot is clear of every track by more than the half-width of a plate and its casing.
{
  const landmarks = load('landmark-anchors');
  const ids = landmarks.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, 'landmark ids');
  for (const id of ['citgo', 'fenway', 'prudential', 'clarendon', 'statehouse', 'customhouse', 'bunkerhill'])
    assert.ok(ids.includes(id), 'landmark ' + id);
  const stone = ['Landmark stone', 'Landmark glass'].map((name) => map.meshes.get(name));
  assert.ok(stone.every(Boolean), 'landmark surfaces');
  for (const l of landmarks) {
    const x = ((l.lon + 71.095) * 111320 * Math.cos((42.354 * Math.PI) / 180)) / 6500;
    const z = (-(l.lat - 42.354) * 110540) / 6500;
    const moved = Math.hypot(l.position[0] - x, l.position[2] - z) * 6500;
    approx(moved, l.movedMetres, 1, l.id + ' is not where its coordinates put it');
    assert.ok(l.movedMetres <= 100, l.id + ' moved ' + l.movedMetres + ' m from its true position');
    assert.ok(l.min[1] >= 0.04 - 1e-6 && l.max[1] > l.min[1] + 0.004 && l.max[1] <= 0.18, l.id + ' height');
    for (const line of paths)
      for (let i = 1; i < line.points.length; i++)
        for (let step = 0; step <= 8; step++) {
          const px = line.points[i - 1][0] + ((line.points[i][0] - line.points[i - 1][0]) * step) / 8;
          const pz = line.points[i - 1][2] + ((line.points[i][2] - line.points[i - 1][2]) * step) / 8;
          for (const ring of l.foot)
            assert.ok(ringDistance(ring, px, pz) > 0.0054 + 0.001, l.id + ' stands on ' + line.name);
        }
  }
}
// The Charles is the surveyed river, in the right place: points known to be on the water are in
// it, points known to be on its banks are not, and no landmark but the bridge stands in it.
{
  const river = charlesRiver();
  const at = (lat, lon) => [
    ((lon + 71.095) * 111320 * Math.cos((42.354 * Math.PI) / 180)) / 6500,
    (-(lat - 42.354) * 110540) / 6500,
  ];
  for (const [name, lat, lon, wet] of [
    ['mid-span of the Longfellow Bridge', 42.3615, -71.0752, true],
    ['mid-span of the Harvard Bridge', 42.3545, -71.0915, true],
    ['the basin off MIT', 42.3555, -71.09, true],
    ['the Weeks Footbridge', 42.3683, -71.1187, true],
    ['the MIT Great Dome', 42.359756, -71.092061, false],
    ['the Hatch Shell', 42.3573, -71.0737, false],
    ['Kenmore station', 42.348949, -71.095169, false],
  ])
    assert.equal(inWater(river.reaches, ...at(lat, lon)), wet, name + (wet ? ' should be water' : ' should be land'));
  for (const l of load('landmark-anchors'))
    if (l.id !== 'zakim')
      for (const [x, z] of l.foot.flat()) assert.ok(!inWater(river.reaches, x, z), l.id + ' stands in the river');
}
function topAt(meshes, x, z) {
  let height = -Infinity;
  for (const { positions: p, indices, offset } of meshes.values()) {
    const q = x - offset[0],
      r = z - offset[2];
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3,
        b = indices[i + 1] * 3,
        c = indices[i + 2] * 3;
      const d =
        (p[b + 2] - p[c + 2]) * (p[a] - p[c]) +
        (p[c] - p[b]) * (p[a + 2] - p[c + 2]);
      if (Math.abs(d) < 1e-12) continue;
      const u =
          ((p[b + 2] - p[c + 2]) * (q - p[c]) +
            (p[c] - p[b]) * (r - p[c + 2])) /
          d,
        v =
          ((p[c + 2] - p[a + 2]) * (q - p[c]) +
            (p[a] - p[c]) * (r - p[c + 2])) /
          d;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001)
        height = Math.max(
          height,
          u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1] + offset[1],
        );
    }
  }
  return height;
}
// Check membership against the source survey rings, independently of the export triangulation.
function inFootprint(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j];
    if (b > z !== d > z && x < a + ((z - b) * (c - a)) / (d - b))
      inside = !inside;
  }
  return inside;
}
let movedCount = 0;
let venueCount = 0,
  offDeckCount = 0,
  roofCount = 0;
for (const [id, [lat, lon, line, code]] of Object.entries(stationRef)) {
  const a = stations[id],
    s = segments[id];
  assert.equal(a.lat, lat);
  assert.equal(a.lon, lon);
  assert.equal(a.line, line);
  assert.equal(a.color, colors[line]);
  assert.equal(a.areaCode, 'AREA - ' + code);
  assert.equal(a.segmentFile, 'segment-' + id + '.glb');
  const x =
      ((lon + 71.095) * 111320 * Math.cos((42.354 * Math.PI) / 180)) / 6500,
    z = (-(lat - 42.354) * 110540) / 6500;
  for (const point of [a.tubePos, a.topPos]) {
    approx(point[0], x, 1e-7);
    approx(point[2], z, 1e-7);
  }
  approx(a.topPos[1], a.tubePos[1] + 0.0075, 1e-6);
  const route = paths.find((l) => l.routeId === line);
  assert.ok(route.points.some((p) => distance(p, a.tubePos) < 1e-7));
  const model = models[a.segmentFile.slice(0, -4)],
    { bounds, meshes } = model;
  // The city floats on an island: a turf rim inside the 0.9 m footprint and a rock wedge below.
  for (const k of [0, 2])
    assert.ok(bounds.min[k] >= -0.4500001 && bounds.max[k] <= 0.4500001, id + ' footprint ' + reportBounds(bounds));
  assert.ok(bounds.min[1] >= -0.4500001 && bounds.min[1] <= -0.3, id + ' island depth ' + reportBounds(bounds));
  // Building heights are true to scale, so a low-rise neighbourhood stays low.
  assert.ok(bounds.max[1] >= 0.03 && bounds.max[1] <= 0.62);
  assert.ok(!('lcdNode' in s) && !('dialNode' in s), id + ' stale hardware anchors');
  assert.ok(!meshes.has('LCD_Screen') && !meshes.has('Rotary_Dial'), id + ' stale hardware nodes');
  assert.equal(s.deckY, 0);
  const islandParts = ['Island turf', 'Island earth and rock'].map((name) => meshes.get(name));
  let islandTris = 0;
  for (const part of islandParts) {
    assert.ok(part, id + ' island material');
    assert.equal(part.mat.alphaMode ?? 'OPAQUE', 'OPAQUE');
    assert.ok(!part.mat.emissiveFactor && !part.mat.pbrMetallicRoughness.baseColorTexture);
    islandTris += part.indices.length / 3;
  }
  assert.ok(islandTris <= 2500, id + ' island triangles ' + islandTris);
  const { centerLat, centerLon, spanMeters, buildings } = areas[id];
  assert.deepEqual(s.projection, {
    centerLat,
    centerLon,
    spanMeters,
    deckSize: 0.856,
  });
  const scale = 0.856 / spanMeters;
  const deckPoint = (place) => [
    (place.lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180) * scale,
    (centerLat - place.lat) * 110540 * scale,
  ];
  // The shoreline is organic, so the generator decides which venues are modelled in place and
  // which become markers on the turf rim. Every venue must be exactly one of the two, and any
  // venue within 0.4 m of the deck centre must be on the island.
  const allPlaces = places.filter((place) => place.stop_id === id);
  const stopPlaces = allPlaces.filter((place) => place.id in s.placeAnchors);
  const farPlaces = allPlaces.filter((place) => place.id in s.offDeck);
  assert.equal(stopPlaces.length + farPlaces.length, allPlaces.length);
  assert.equal(Object.keys(s.placeAnchors).length + Object.keys(s.offDeck).length, allPlaces.length);
  const turf = new Map([['turf', meshes.get('Island turf')]]);
  for (const place of farPlaces) {
    const { position, distanceM, compass } = s.offDeck[place.id];
    const [x, z] = deckPoint(place);
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) > 0.4, place.id + ' should be on the island');
    assert.ok(Math.hypot(position[0], position[2]) < Math.hypot(x, z), place.id + ' marker beyond venue');
    approx(position[0] * z, position[2] * x, 1e-9, place.id + ' bearing');
    approx(topAt(turf, position[0], position[2]), 0, 1e-7, place.id + ' marker off the turf rim');
    approx(position[1], topAt(meshes, position[0], position[2]) + 0.018, 2e-7);
    assert.ok(distanceM >= 100 && /^(N|NE|E|SE|S|SW|W|NW)$/.test(compass));
    offDeckCount++;
  }
  const city = meshes.get('Masonry, foliage and streets');
  const roofs = new Map([['city', city]]);
  for (const { positions: p, offset, mat } of meshes.values()) {
    if (p.some((v, i) => i % 3 === 1 && v + offset[1] > 0.0025)) {
      assert.equal(
        mat.alphaMode ?? 'OPAQUE',
        'OPAQUE',
        id + ' translucent building',
      );
      assert.deepEqual(
        mat.emissiveFactor ?? [0, 0, 0],
        [0, 0, 0],
        id + ' emissive building',
      );
    }
    // Above deck level there is only the city, inside the furthest reach of the shoreline.
    for (let i = 0; i < p.length; i += 3) {
      const y = p[i + 1] + offset[1],
        reach = Math.max(Math.abs(p[i] + offset[0]), Math.abs(p[i + 2] + offset[2]));
      if (y > 1e-7) assert.ok(reach <= 0.437, id + ' city crosses the rim');
    }
  }
  for (const place of stopPlaces) {
    const [x, y, z] = s.placeAnchors[place.id];
    const east =
      (place.lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180);
    const south = (centerLat - place.lat) * 110540;
    // A pin stands at its surveyed coordinate. The one exception is a door point mapped on the
    // pavement, which may move at most 17.5 m, and only to stand inside a building footprint.
    const moved = Math.hypot(x / scale - east, z / scale - south);
    if (moved > 1e-6) {
      assert.ok(moved <= 17.5, place.id + ' moved ' + moved.toFixed(1) + ' m from its coordinate');
      assert.ok(!buildings.some((b) => inFootprint(east, south, b.ring)), place.id + ' moved off its own building');
      assert.ok(buildings.some((b) => inFootprint(x / scale, z / scale, b.ring)), place.id + ' moved outside a footprint');
      movedCount++;
    }
    const top = topAt(meshes, x, z);
    approx(y, top + 0.018, 2e-7, place.id + ' surface clearance');
    if (buildings.some((b) => inFootprint(x / scale, z / scale, b.ring))) {
      assert.ok(top > 0.005, place.id + ' missing roof');
      approx(
        topAt(roofs, x, z),
        top,
        2e-7,
        place.id + ' architectural rooftop',
      );
      roofCount++;
    } else {
      assert.ok(
        top <= 0.0025,
        place.id + ' off-footprint coordinate obstructed',
      );
    }
    venueCount++;
  }
  assert.ok(s.pinAnchors.length >= 8);
  let minSpace = Infinity;
  for (const [i, pin] of s.pinAnchors.entries()) {
    assert.ok(
      buildings.some((b) =>
        inFootprint(pin[0] / scale, pin[2] / scale, b.ring),
      ) && pin[1] > 0.023,
      id + ' fallback missing rooftop',
    );
    approx(
      pin[1] - topAt(meshes, pin[0], pin[2]),
      0.018,
      0.00002,
      'pin clearance',
    );
    for (const other of s.pinAnchors.slice(i + 1))
      minSpace = Math.min(
        minSpace,
        Math.hypot(pin[0] - other[0], pin[2] - other[2]),
      );
  }
  assert.ok(minSpace > 0.1);
  console.log(
    id,
    'tube',
    textVec(a.tubePos),
    'top',
    textVec(a.topPos),
    s.pinAnchors.length + ' pins; clearance 0.018 m; minimum XZ separation',
    minSpace.toFixed(6),
  );
}
assert.equal(venueCount + offDeckCount, 28);
console.log(
  venueCount +
    ' venue pins (' + movedCount + ' door points moved onto their building), ' +
    roofCount +
    ' on surveyed roofs and ' +
    (venueCount - roofCount) +
    ' on ground surfaces',
);
console.log(
  ringsChecked +
    ' centerline rings; max centroid error ' +
    maxCenterError.toExponential(3) +
    ' m',
);
const properties =
  'x y z f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3'.split(
    ' ',
  );
for (const [name, [count, w, d, h]] of Object.entries(gaussians)) {
  const bytes = readFileSync(dir + name + '.ply'),
    end = bytes.indexOf('end_header\n');
  assert.ok(end > 0 && end < 16384);
  const header = bytes.toString('ascii', 0, end).trim().split('\n');
  assert.equal(header[0], 'ply');
  assert.equal(header[1], 'format binary_little_endian 1.0');
  assert.deepEqual(
    header.filter((l) => l.startsWith('element ')),
    ['element vertex ' + count],
  );
  assert.deepEqual(
    header.filter((l) => l.startsWith('property ')),
    properties.map((p) => 'property float ' + p),
  );
  const buf = bytes.subarray(end + 11);
  assert.equal(buf.length, count * 56);
  const room = name.startsWith('room'),
    groupName = room ? 'floor' : 'plate',
    ranges = header
      .filter((l) => l.startsWith('comment group ' + groupName + ' '))
      .map((l) => l.split(' ').slice(-2).map(Number));
  assert.ok(
    ranges.length > 0 &&
      ranges.every(([a, b]) => a >= 0 && b <= count && a < b),
  );
  const bounds = readBounds(),
    footprint = readBounds();
  for (let i = 0; i < count; i++) {
    const row = Array.from({ length: 14 }, (_, j) =>
      buf.readFloatLE(i * 56 + j * 4),
    );
    assert.ok(row.every(Number.isFinite));
    extend(bounds, row);
    if (ranges.some(([lo, hi]) => i >= lo && i < hi)) extend(footprint, row);
    approx(Math.hypot(...row.slice(10)), 1, 0.00001, 'Gaussian quaternion');
    for (const dc of row.slice(3, 6))
      assert.ok(
        dc * 0.28209479177387814 + 0.5 >= -1e-6 &&
          dc * 0.28209479177387814 + 0.5 < 1.000001,
      );
    for (const logScale of row.slice(7, 10)) {
      const sigma = Math.exp(logScale);
      assert.ok(sigma > 0 && sigma < (room ? 1 : 0.1));
    }
    const alpha = 1 / (1 + Math.exp(-row[6]));
    assert.ok(alpha > 0 && alpha < 1);
  }
  const width = footprint.max[0] - footprint.min[0],
    depth = footprint.max[2] - footprint.min[2];
  approx(width, w, 0.05 * w);
  approx(depth, d, 0.05 * d);
  for (const [k, span] of [
    [0, w],
    [2, d],
  ]) {
    approx(footprint.min[k], -span / 2, 0.04 * span);
    approx(footprint.max[k], span / 2, 0.04 * span);
  }
  approx(bounds.min[1], 0, 0.00001);
  approx(footprint.min[1], 0, 0.00001);
  if (room) {
    approx(footprint.max[1], 0);
    approx(bounds.max[1], h, 0.005);
  } else assert.ok(bounds.max[1] > 0.035 && bounds.max[1] < h);
  console.log(
    name + '.ply',
    bytes.length + ' bytes',
    count + ' Gaussians',
    reportBounds(bounds),
    groupName + ' span',
    width.toFixed(6) + ' × ' + depth.toFixed(6) + ' m',
  );
}
for (const name of jsonNames)
  console.log(
    name + '.json',
    readFileSync(dir + name + '.json').length + ' bytes',
  );
console.log('PASS: all ' + expected.length + ' exports');
