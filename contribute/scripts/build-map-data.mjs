// Flattens the 3D modeling sources into the 2D map data used by the Contribute app.
//   node contribute/scripts/build-map-data.mjs
// Inputs:  modeling/output/mbta-3d-paths.json, station-anchors.json and segment-anchors.json,
//          modeling/osm-data.json, the route and river tables in modeling/transit.mjs and the ground in modeling/ground.mjs.
// Outputs: contribute/src/data/network.json and contribute/src/data/areas/<stop_id>.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spline } from '../../modeling/geometry.mjs';
import { groundOutline } from '../../modeling/ground.mjs';
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
const islands = read(modeling + 'output/segment-anchors.json');
const stops = read(modeling + 'stops.json');
const osm = read(modeling + 'osm-data.json');

// ---- Network: the sculpture seen from above (x east, z south), in thousandths of a model unit.
const UNIT = 1000;
// Half extents of the footprint the tracks are clipped to.
const CLIP_WIDTH = 0.738;
const CLIP_DEPTH = 0.513;
const fixed = (value) => Number((value * UNIT).toFixed(1));
const polyline = (points) => 'M' + points.map(([x, y]) => `${fixed(x)} ${fixed(y)}`).join('L');

// Each line carries its official colour for the track and the brighter one the sculpture gives its trains.
const core = Object.fromEntries(routes.map(([id, , , , coreColor]) => [id, coreColor]));
const lines = paths.lines.map(({ id, routeId, name, color, points }) => ({
  id, routeId, name, color, core: core[id],
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

// The network floats on one organic piece of ground whose edge follows the lines, not on a rectangular slab.
const ground = groundOutline(paths.lines);
const xs = ground.rim.map(([x]) => x);
const zs = ground.rim.map(([, z]) => z);

// Just enough water to place the network in Boston: the river's curve and the channels that part the
// peninsulas. Each stretch is a centreline of [x, z, half width] in model units, drawn as one smooth ribbon.
// The map clips them to the ground, so a stretch can simply run off its edge.
const water = [
  // The Charles, on the curve the sculpture's deck used to carry, from upstream of Allston to the harbour.
  [[-1, -0.04, 0.02], [-0.87, -0.03, 0.024], ...riverBanks.slice(0, 19)],
  // The Inner Harbor, between downtown and East Boston, widening out to sea past the Seaport.
  [[0.368, -0.258, 0.03], [0.428, -0.29, 0.034], [0.52, -0.295, 0.045], [0.6, -0.255, 0.055], [0.655, -0.19, 0.07], [0.69, -0.11, 0.095],
    [0.72, -0.03, 0.13], [0.8, 0.08, 0.17], [0.95, 0.2, 0.2], [1.1, 0.3, 0.22]],
  // The Mystic, which makes Charlestown a peninsula.
  [[0.2, -0.69, 0.016], [0.33, -0.635, 0.02], [0.47, -0.57, 0.026], [0.585, -0.505, 0.03], [0.625, -0.41, 0.036], [0.62, -0.27, 0.05]],
  // Fort Point Channel, between downtown and the Seaport.
  [[0.6, -0.04, 0.018], [0.555, 0.03, 0.014], [0.505, 0.11, 0.012], [0.47, 0.17, 0.009]],
];
function ribbon(centreline) {
  // The half width rides along as the spline's middle coordinate, so it eases between control points too.
  const stream = spline(centreline.map(([x, z, w]) => [x, w, z]), 0.011);
  const frames = stream.map(([x, w, z], i) => {
    const ahead = stream[Math.min(i + 1, stream.length - 1)];
    const behind = stream[Math.max(0, i - 1)];
    const length = Math.hypot(ahead[0] - behind[0], ahead[2] - behind[2]) || 1;
    const along = [(ahead[0] - behind[0]) / length, (ahead[2] - behind[2]) / length];
    return { x, z, w, along, across: [-along[1], along[0]] };
  });
  const bank = (side) => frames.map(({ x, z, w, across }) => [x + side * across[0] * w, z + side * across[1] * w]);
  // Round ends, so two stretches that meet at an angle join without a notch between them.
  const cap = ({ x, z, w, along, across }, out) => Array.from({ length: 7 }, (_, k) => {
    const angle = (k + 1) / 8 * Math.PI;
    return [
      x + w * out * (across[0] * Math.cos(angle) + along[0] * Math.sin(angle)),
      z + w * out * (across[1] * Math.cos(angle) + along[1] * Math.sin(angle)),
    ];
  });
  return polyline([...bank(1), ...cap(frames.at(-1), 1), ...bank(-1).reverse(), ...cap(frames[0], -1)]) + 'Z';
}

const networkBytes = write('../src/data/network.json', {
  bounds: [Math.min(...xs), Math.min(...zs), Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)].map(fixed),
  ground: polyline(ground.solid) + 'Z',
  groundRim: polyline(ground.rim) + 'Z',
  water: water.map(ribbon).join(''),
  lines,
  stations: [...stations.values()],
});
console.log(`network.json  ${lines.length} lines, ${stations.size} stations, ${(networkBytes / 1024).toFixed(1)} KiB`);

// ---- Station areas: the OSM footprints behind each diorama, in quarter metres from the deck centre.
const Q = 4;
// Metres of turf drawn around each island's city, the middle of the margin the diorama's island has.
const TURF_M = 22;
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
  // The city is no longer a square board: it is cropped to the shoreline of the diorama's island.
  const { outline: deckOutline, projection } = islands[area.stopId];
  const metresPerDeckUnit = area.spanMeters / projection.deckSize;
  const shore = deckOutline.map(([x, z]) => [x * metresPerDeckUnit, z * metresPerDeckUnit]);
  const shoreX = shore.map(([x]) => x);
  const shoreY = shore.map(([, y]) => y);
  const box = [Math.min(...shoreX), Math.min(...shoreY), Math.max(...shoreX), Math.max(...shoreY)];
  // The shoreline is convex, so a point is on the island when it is on the inner side of every edge.
  const winding = Math.sign(shore.reduce((sum, [x, y], i) => {
    const [nx, ny] = shore[(i + 1) % shore.length];
    return sum + x * ny - nx * y;
  }, 0));
  const onIsland = ([x, y], slack = 0.25) => shore.every(([ax, ay], i) => {
    const [bx, by] = shore[(i + 1) % shore.length];
    return winding * ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / Math.hypot(bx - ax, by - ay) >= -slack;
  });
  // Ground features are clipped to the shoreline when drawn, so anything reaching its box is kept.
  const inside = (points) => points.some(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]);
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
  // Like the diorama, a building the shoreline would cut is left out whole.
  const buildings = area.buildings.filter((building) => building.ring.every((point) => onIsland(point)) && shoelace(building.ring) >= MIN_BUILDING_M2);
  for (const building of buildings) layers.building.add(building.ring, true);

  // A few named landmarks keep the flat map as readable as the model.
  const named = new Map();
  for (const feature of [...buildings, ...area.parks]) {
    if (!feature.name) continue;
    const [x, y] = centroid(feature.ring);
    if (!onIsland([x, y], -30)) continue;
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
    // The island: the city's shoreline, and the box that holds it with its turf margin.
    outline: shore.flatMap(([x, y]) => [Math.round(x * Q), Math.round(y * Q)]),
    turf: TURF_M * Q,
    bounds: [box[0] - TURF_M, box[1] - TURF_M, box[2] - box[0] + TURF_M * 2, box[3] - box[1] + TURF_M * 2].map((value) => Math.round(value * Q)),
    layers: Object.fromEntries(Object.entries(layers).map(([name, builder]) => [name, builder.d])),
    labels, attribution: osm.attribution,
  });
  console.log(`${area.stopId}.json  ${buildings.length} buildings, ${area.roads.length} roads, ${(bytes / 1024).toFixed(1)} KiB`);
}
