// Flattens the 3D modeling sources into the 2D map data used by the Contribute app.
//   node contribute/scripts/build-map-data.mjs
// Inputs:  modeling/output/mbta-3d-paths.json, modeling/output/station-anchors.json,
//          modeling/osm-data.json and the route and river tables in modeling/transit.mjs.
// Outputs: contribute/src/data/network.json and contribute/src/data/areas/<stop_id>.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { norm, spline, sub } from '../../modeling/geometry.mjs';
import { focal, project, riverBanks, routes } from '../../modeling/transit.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const write = (path, data) => {
  const url = new URL(path, import.meta.url);
  writeFileSync(url, JSON.stringify(data) + '\n');
  return readFileSync(url).length;
};
const modeling = '../../modeling/';
const paths = read(modeling + 'output/mbta-3d-paths.json');
const anchors = read(modeling + 'output/station-anchors.json');
const stops = read(modeling + 'stops.json');
const osm = read(modeling + 'osm-data.json');

// ---- Network: the sculpture seen from above (x east, z south), in thousandths of a model unit.
const UNIT = 1000;
// Half extents of the slab's deck and of the footprint its tubes and river are clipped to.
const HALF_WIDTH = 0.742;
const HALF_DEPTH = 0.517;
const CLIP_WIDTH = 0.738;
const CLIP_DEPTH = 0.513;
const fixed = (value) => Number((value * UNIT).toFixed(1));
const polyline = (points) => 'M' + points.map(([x, y]) => `${fixed(x)} ${fixed(y)}`).join('L');

// The sculpture paints each tube with its line colour lifted 45% toward the brighter core colour.
const mixHex = (a, b, t) => '#' + [1, 3, 5].map((i) => {
  const from = parseInt(a.slice(i, i + 2), 16);
  const to = parseInt(b.slice(i, i + 2), 16);
  return Math.round(from + (to - from) * t).toString(16).padStart(2, '0');
}).join('');
const core = Object.fromEntries(routes.map(([id, , , , coreColor]) => [id, coreColor]));
const lines = paths.lines.map(({ id, routeId, name, color, points }) => ({
  id, routeId, name, color, tube: mixHex(color, core[id], 0.45), core: core[id],
  points: points.flatMap(([x, , z]) => [fixed(x), fixed(z)]),
}));

const stations = new Map();
for (const [, routeId, , color, , knots] of routes) {
  for (const [key] of knots) {
    if (typeof key !== 'string') continue;
    const [x, , z] = project(...stops[key], 0);
    if (Math.abs(x) > CLIP_WIDTH || Math.abs(z) > CLIP_DEPTH) continue;
    const station = stations.get(key) ?? { name: key, x: fixed(x), y: fixed(z), routes: [], colors: [] };
    if (!station.routes.includes(routeId)) station.routes.push(routeId);
    if (!station.colors.includes(color)) station.colors.push(color);
    stations.set(key, station);
  }
}
for (const [stopId, fullName, label, code, , primaryColor] of focal) {
  const station = stations.get(fullName);
  if (!station) throw new Error('Focal station is missing from the route tables: ' + fullName);
  Object.assign(station, { name: label, stopId, code, colors: [primaryColor, ...station.colors.filter((color) => color !== primaryColor)] });
  // Use the collar position from the sculpture so the 2D node sits exactly on the drawn tube.
  const [x, , z] = anchors[stopId].tubePos;
  Object.assign(station, { x: fixed(x), y: fixed(z) });
}

const stream = spline(riverBanks.map(([x, z, w]) => [x, w, z]), 0.011);
const banks = [[], []];
stream.forEach(([x, w, z], i) => {
  const tangent = norm(sub(stream[Math.min(i + 1, stream.length - 1)], stream[Math.max(0, i - 1)]));
  [-1, 1].forEach((side, k) => banks[k].push([
    Math.max(-CLIP_WIDTH, Math.min(CLIP_WIDTH, x - tangent[2] * side * w)),
    Math.max(-CLIP_DEPTH, Math.min(CLIP_DEPTH, z + tangent[0] * side * w)),
  ]));
});

const networkBytes = write('../src/data/network.json', {
  bounds: [-HALF_WIDTH * UNIT, -HALF_DEPTH * UNIT, HALF_WIDTH * 2 * UNIT, HALF_DEPTH * 2 * UNIT],
  river: polyline([...banks[0], ...banks[1].reverse()]) + 'Z',
  lines,
  stations: [...stations.values()],
});
console.log(`network.json  ${lines.length} lines, ${stations.size} stations, ${(networkBytes / 1024).toFixed(1)} KiB`);

// ---- Station areas: the OSM footprints behind each diorama, in quarter metres from the deck centre.
const Q = 4;
const MIN_BUILDING_M2 = 18;
const shoelace = (ring) => Math.abs(ring.reduce((sum, [x, y], i) => {
  const [nx, ny] = ring[(i + 1) % ring.length];
  return sum + x * ny - nx * y;
}, 0)) / 2;
const centroid = (ring) => {
  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

function pathBuilder() {
  let d = '';
  let pen = [0, 0];
  const pair = (x, y) => `${x}${y < 0 ? '' : ' '}${y}`;
  return {
    add(points, close) {
      const quantized = points.map(([x, y]) => [Math.round(x * Q), Math.round(y * Q)])
        .filter(([x, y], i, all) => !i || x !== all[i - 1][0] || y !== all[i - 1][1]);
      if (close && quantized.length > 1 && quantized[0][0] === quantized.at(-1)[0] && quantized[0][1] === quantized.at(-1)[1]) quantized.pop();
      if (quantized.length < (close ? 3 : 2)) return;
      const [start, ...rest] = quantized;
      d += 'm' + pair(start[0] - pen[0], start[1] - pen[1]);
      let previous = start;
      d += 'l' + rest.map((point) => {
        const step = pair(point[0] - previous[0], point[1] - previous[1]);
        previous = point;
        return step;
      }).join(' ');
      // A closed subpath returns the pen to its first point.
      if (close) d += 'z';
      pen = close ? start : previous;
    },
    get d() { return d; },
  };
}

mkdirSync(new URL('../src/data/areas/', import.meta.url), { recursive: true });
for (const area of Object.values(osm.areas)) {
  const half = area.spanMeters / 2;
  const margin = 24;
  const inside = (points) => points.some(([x, y]) => Math.abs(x) <= half + margin && Math.abs(y) <= half + margin);
  const layers = Object.fromEntries(['water', 'park', 'pitch', 'foot', 'service', 'minor', 'major', 'building']
    .map((name) => [name, pathBuilder()]));

  for (const water of area.waters) if (inside(water.ring)) layers.water.add(water.ring, true);
  for (const park of area.parks) {
    if (inside(park.ring)) layers[park.kind === 'pitch' ? 'pitch' : 'park'].add(park.ring, true);
  }
  for (const road of area.roads) {
    if (!inside(road.points)) continue;
    const layer = road.major ? 'major'
      : road.kind === 'footway' || road.kind === 'pedestrian' ? 'foot'
      : road.kind === 'service' ? 'service' : 'minor';
    layers[layer].add(road.points, false);
  }
  const buildings = area.buildings.filter((building) => inside(building.ring) && shoelace(building.ring) >= MIN_BUILDING_M2);
  for (const building of buildings) layers.building.add(building.ring, true);

  // A few named landmarks keep the flat map as readable as the model.
  const named = new Map();
  for (const feature of [...buildings, ...area.parks]) {
    if (!feature.name) continue;
    const [x, y] = centroid(feature.ring);
    if (Math.abs(x) > half * 0.9 || Math.abs(y) > half * 0.9) continue;
    const size = shoelace(feature.ring);
    if (size > (named.get(feature.name)?.size ?? 0)) named.set(feature.name, { name: feature.name, x: Math.round(x * Q), y: Math.round(y * Q), size });
  }
  // Keep the largest landmarks whose names do not run into each other at the label size in app.css.
  const LABEL_HEIGHT = 27 * 1.5;
  const LABEL_ADVANCE = 27 * 0.72;
  const span = (label) => Math.min(label.name.length, 28) * LABEL_ADVANCE;
  const labels = [];
  for (const candidate of [...named.values()].sort((a, b) => b.size - a.size)) {
    if (labels.length === 6) break;
    const clear = labels.every((kept) => Math.abs(kept.y - candidate.y) > LABEL_HEIGHT
      || Math.abs(kept.x - candidate.x) > (span(kept) + span(candidate)) / 2);
    if (clear) labels.push({ name: candidate.name, x: candidate.x, y: candidate.y });
  }

  const anchor = anchors[area.stopId];
  const station = [
    Math.round((anchor.lon - area.centerLon) * 111320 * Math.cos(area.centerLat * Math.PI / 180) * Q),
    Math.round(-(anchor.lat - area.centerLat) * 110540 * Q),
  ];
  const bytes = write(`../src/data/areas/${area.stopId}.json`, {
    stopId: area.stopId, name: area.name, spanMeters: area.spanMeters, unitsPerMeter: Q,
    centerLat: area.centerLat, centerLon: area.centerLon, station,
    layers: Object.fromEntries(Object.entries(layers).map(([name, builder]) => [name, builder.d])),
    labels, attribution: osm.attribution,
  });
  console.log(`${area.stopId}.json  ${buildings.length} buildings, ${area.roads.length} roads, ${(bytes / 1024).toFixed(1)} KiB`);
}
