import assert from 'node:assert/strict';
import { places } from '../server/src/db/seed.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const genModels = [
  'boston-map-sculpture',
  'mbta-train-capsule',
  'table-pedestal',
  ...Object.keys(stationRef).map((k) => 'segment-' + k),
];
const jsonNames = ['station-anchors', 'segment-anchors', 'mbta-3d-paths'];
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
    ? [1, 36000, 12]
    : name.startsWith('boston')
      ? [25000, 55000, 19]
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
assert.ok(
  map.bounds.min[0] >= -0.7501 &&
    map.bounds.max[0] <= 0.7501 &&
    map.bounds.min[1] >= 0.05 &&
    map.bounds.max[1] <= 0.35 &&
    map.bounds.min[2] >= -0.5251 &&
    map.bounds.max[2] <= 0.5251,
  'floating sculpture bounds ' + reportBounds(map.bounds),
);
exactBounds(
  models['table-pedestal'].bounds,
  [-0.45, -0.042, -0.45],
  [0.45, 0, 0.45],
);
const table = models['table-pedestal'].meshes.get(
  'Cyan photoluminescent inlay',
).positions;
for (const r of [0.1, 0.15]) {
  let hits = 0;
  for (let i = 0; i < table.length; i += 3)
    if (Math.abs(Math.hypot(table[i], table[i + 2]) - r) < 0.0007) {
      approx(table[i + 1], 0);
      hits++;
    }
  assert.ok(hits >= 240);
}
const train = models['mbta-train-capsule'];
approx(train.bounds.min[2], -0.016);
approx(train.bounds.max[2], 0.016);
assert.ok(
  train.meshes
    .get('LED markers')
    .positions.filter((v, i) => i % 3 === 2)
    .every((z) => z < -0.015),
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
  // Every outer ring has fourteen vertices followed by two fourteen-vertex cap polygons per path.
  const offset = offsets.get(line.color) ?? 0;
  line.points.forEach((point, i) => {
    assert.ok(point.length === 3 && point.every(Number.isFinite));
    const centroid = [0, 0, 0];
    for (let j = 0; j < 14; j++) {
      const at = (offset + i * 14 + j) * 3,
        p = Array.from(positions.subarray(at, at + 3));
      approx(distance(p, point), 0.0058, 2e-7, 'tube shell radius');
      p.forEach((v, k) => (centroid[k] += v / 14));
    }
    const err = distance(point, centroid);
    maxCenterError = Math.max(maxCenterError, err);
    assert.ok(err < 1e-7);
    if (i) assert.ok(distance(point, line.points[i - 1]) > 1e-6);
    ringsChecked++;
  });
  // Every outer ring has 14 vertices followed by two rounded hemisphere caps (2 * (2 * 14 + 1) = 58 vertices) per path.
  offsets.set(line.color, offset + 14 * line.points.length + 58);
}
for (const [color, count] of offsets)
  assert.equal(count, map.meshes.get('Lacquer ' + color).positions.length / 3);
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
let venueCount = 0,
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
  approx(a.topPos[1], a.tubePos[1] + 0.045, 1e-6);
  const route = paths.find((l) => l.routeId === line);
  assert.ok(route.points.some((p) => distance(p, a.tubePos) < 1e-7));
  const model = models[a.segmentFile.slice(0, -4)],
    { bounds, meshes } = model;
  exactBounds(bounds, [-0.45, -0.18, -0.45], [0.45, bounds.max[1], 0.45]);
  assert.ok(bounds.max[1] >= 0.3 && bounds.max[1] <= 0.62);
  assert.equal(s.lcdNode, 'LCD_Screen');
  assert.equal(s.dialNode, 'Rotary_Dial');
  assert.equal(s.deckY, 0);
  const lcd = meshes.get(s.lcdNode),
    dial = meshes.get(s.dialNode);
  assert.ok(lcd && dial);
  const p = lcd.positions,
    uv = lcd.uv;
  assert.equal(p.length, 12);
  assert.equal(uv.length, 8);
  assert.deepEqual([...uv], [0, 1, 1, 1, 1, 0, 0, 0]);
  for (let i = 0; i < 4; i++) {
    approx(p[3 * i + 2], p[2]);
    approx(lcd.normals[i * 3 + 2], 1);
    assert.ok(p[i * 3] < 0 && p[i * 3 + 1] < 0 && p[i * 3 + 2] > 0.4);
  }
  assert.ok(p[3] > p[0] && p[7] > p[1]);
  assert.ok(lcd.mat.pbrMetallicRoughness.baseColorTexture);
  assert.ok(
    Math.abs(dial.offset[0]) < 0.06 &&
      dial.offset[1] < 0 &&
      dial.offset[2] > 0.4,
  );
  for (let k = 0; k < 2; k++) {
    const coords = dial.positions.filter((_, i) => i % 3 === k);
    approx(Math.max(...coords) + Math.min(...coords), 0, 1e-6);
  }
  const { centerLat, centerLon, spanMeters, buildings } = areas[id];
  assert.deepEqual(s.projection, {
    centerLat,
    centerLon,
    spanMeters,
    deckSize: 0.856,
  });
  const stopPlaces = places.filter((place) => place.stop_id === id);
  assert.deepEqual(
    Object.keys(s.placeAnchors).sort(),
    stopPlaces.map((p) => p.id).sort(),
  );
  const scale = 0.856 / spanMeters;
  const glass = meshes.get('Spectral architectural glass');
  assert.equal(glass.mat.alphaMode, 'BLEND');
  for (const { positions: p, offset } of meshes.values()) {
    for (let i = 0; i < p.length; i += 3)
      if (p[i + 1] + offset[1] > 1e-7)
        assert.ok(
          Math.abs(p[i] + offset[0]) <= 0.4240001 &&
            Math.abs(p[i + 2] + offset[2]) <= 0.4240001,
          id + ' city crosses the bezel',
        );
  }
  for (const place of stopPlaces) {
    const [x, y, z] = s.placeAnchors[place.id];
    const east =
      (place.lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180);
    const south = (centerLat - place.lat) * 110540;
    approx(x, east * scale, 1e-9, place.id + ' X');
    approx(z, south * scale, 1e-9, place.id + ' Z');
    const top = topAt(meshes, x, z);
    approx(y, top + 0.018, 2e-7, place.id + ' surface clearance');
    if (buildings.some((b) => inFootprint(east, south, b.ring))) {
      assert.ok(top > 0.005, place.id + ' missing roof');
      approx(
        topAt(new Map([['glass', glass]]), x, z),
        top,
        2e-7,
        place.id + ' highlighted rooftop',
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
assert.equal(venueCount, 28);
console.log(
  venueCount +
    ' exact venue coordinates, ' +
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
console.log('PASS: all 17 exports');
