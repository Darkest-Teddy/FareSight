import { readFileSync, writeFileSync } from 'node:fs';
import {
  Model,
  box,
  face,
  loft,
  circle,
  sweep,
  spline,
  norm,
  sub,
  mix,
  mul,
  add,
} from './geometry.mjs';

// Station coordinate snapshot from api-v3.mbta.com/stops, parent stations only.
const stops = JSON.parse(readFileSync(new URL('stops.json', import.meta.url)));
export const focal = [
  [
    'place-bucen',
    'Boston University Central',
    'BU Central',
    '001',
    'Green-B',
    '#00843D',
    0.261,
  ],
  [
    'place-brico',
    "Packard's Corner",
    "Packard's Corner",
    '002',
    'Green-B',
    '#00843D',
    0.268,
  ],
  ['place-kencl', 'Kenmore', 'Kenmore', '003', 'Green-B', '#00843D', 0.208],
  ['place-harsq', 'Harvard', 'Harvard', '004', 'Red', '#DA291C', 0.167],
  ['place-chncl', 'Chinatown', 'Chinatown', '005', 'Orange', '#ED8B00', 0.137],
];
export const project = (lat, lon, y) => [
  ((lon + 71.095) * 111320 * Math.cos((42.354 * Math.PI) / 180)) / 6500,
  y,
  (-(lat - 42.354) * 110540) / 6500,
];
const join = (text) =>
  text.split('|').map((s) => {
    const [name, y] = s.split('@');
    return [name, Number(y)];
  });
const routes = [
  [
    'green-b',
    'Green-B',
    'Green Line B',
    '#00843D',
    '#38E08A',
    join(
      "Boston College@.265|South Street@.265|Chestnut Hill Avenue@.26|Chiswick Road@.263|Sutherland Road@.267|Washington Street@.267|Warren Street@.265|Allston Street@.267|Griggs Street@.27|Harvard Avenue@.267|Packard's Corner@.268|Babcock Street@.268|Amory Street@.265|Boston University Central@.261|Boston University East@.256|Blandford Street@.249|Kenmore@.208|Hynes Convention Center@.193|Copley@.189|Arlington@.183|Boylston@.176|Park Street@.174|Government Center@.182|Haymarket@.193|North Station@.204|Science Park/West End@.274|Lechmere@.282",
    ),
  ],
  [
    'green-c',
    'Green-C',
    'Green Line C',
    '#00843D',
    '#38E08A',
    join(
      "Cleveland Circle@.256|Englewood Avenue@.256|Dean Road@.255|Tappan Street@.258|Washington Square@.261|Fairbanks Street@.262|Brandon Hall@.263|Summit Avenue@.263|Coolidge Corner@.26|Saint Paul Street@.258|Kent Street@.257|Hawes Street@.254|Saint Mary's Street@.249|Kenmore@.208",
    ),
  ],
  [
    'green-d',
    'Green-D',
    'Green Line D',
    '#00843D',
    '#38E08A',
    join(
      'Chestnut Hill@.25|Reservoir@.25|Beaconsfield@.253|Brookline Hills@.253|Brookline Village@.245|Longwood@.254|Fenway@.247|Kenmore@.208',
    ),
  ],
  [
    'green-e',
    'Green-E',
    'Green Line E',
    '#00843D',
    '#38E08A',
    join(
      'Heath Street@.258|Back of the Hill@.257|Riverway@.256|Mission Park@.256|Fenwood Road@.255|Brigham Circle@.255|Longwood Medical Area@.253|Museum of Fine Arts@.251|Northeastern University@.248|Symphony@.207|Prudential@.194|Copley@.189',
    ),
  ],
  [
    'red',
    'Red',
    'Red Line',
    '#DA291C',
    '#FF5A4E',
    [
      ...join(
        'Alewife@.169|Davis@.164|Porter@.143|Harvard@.167|Central@.151|Kendall/MIT@.174',
      ),
      [[42.36155, -71.08055], 0.25],
      [[42.36148, -71.07562], 0.285],
      ...join(
        'Charles/MGH@.269|Park Street@.101|Downtown Crossing@.103|South Station@.119|Broadway@.137|Andrew@.16|JFK/UMass@.188',
      ),
    ],
  ],
  [
    'orange',
    'Orange',
    'Orange Line',
    '#ED8B00',
    '#FFB03B',
    [
      ...join('Assembly@.204|Sullivan Square@.204|Community College@.196'),
      [[42.36934, -71.06405], 0.13],
      ...join(
        'North Station@.15|Haymarket@.144|State@.138|Downtown Crossing@.139|Chinatown@.137|Tufts Medical Center@.145|Back Bay@.162|Massachusetts Avenue@.178|Ruggles@.193|Roxbury Crossing@.203|Jackson Square@.205|Stony Brook@.208',
      ),
    ],
  ],
  [
    'blue',
    'Blue',
    'Blue Line',
    '#003DA5',
    '#4A90FF',
    [
      ...join('Bowdoin@.161|Government Center@.144|State@.112|Aquarium@.121'),
      [[42.36337, -71.0456], 0.082],
      ...join('Maverick@.123|Airport@.177'),
    ],
  ],
];
export const json = (file, data) =>
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
function clipToFootprint(points) {
  // Leave room for the radius of each rounded terminus.
  const out = [],
    limits = [0.738, Infinity, 0.513];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    let lo = 0,
      hi = 1;
    for (const k of [0, 2]) {
      const delta = b[k] - a[k],
        v = limits[k];
      if (Math.abs(delta) < 1e-12) {
        if (Math.abs(a[k]) > v) hi = -1;
        continue;
      }
      const t = (-v - a[k]) / delta,
        u = (v - a[k]) / delta;
      lo = Math.max(lo, Math.min(t, u));
      hi = Math.min(hi, Math.max(t, u));
    }
    if (hi <= lo) continue;
    if (!out.length || lo > 0) out.push(lo === 0 ? a : mix(a, b, lo));
    out.push(hi === 1 ? b : mix(a, b, hi));
  }
  return out.map((p) => p.map(Math.fround));
}

function roundedTube(surface, points, radius, sides) {
  const first = surface.positions.length / 3;
  sweep(surface, points, radius, '#ffffff', sides, false);
  // Reuse the open sweep's end rings so the hemisphere shares its shading and silhouette.
  for (const end of [0, points.length - 1]) {
    const center = points[end];
    const axis = norm(sub(center, points[end === 0 ? 1 : end - 1]));
    let rim = Array.from({ length: sides }, (_, j) => first + end * sides + j);
    if (end === 0) rim.reverse();
    const radial = rim.map((id) => surface.normals.slice(id * 3, id * 3 + 3));
    for (const angle of [Math.PI / 6, Math.PI / 3]) {
      const row = radial.map((n) => {
        const normal = add(mul(n, Math.cos(angle)), mul(axis, Math.sin(angle)));
        return surface.vertex(
          add(center, mul(normal, radius)),
          normal,
          '#ffffff',
        );
      });
      for (let j = 0; j < sides; j++) {
        const k = (j + 1) % sides;
        surface.indices.push(rim[j], rim[k], row[k], rim[j], row[k], row[j]);
      }
      rim = row;
    }
    const tip = surface.vertex(add(center, mul(axis, radius)), axis, '#ffffff');
    for (let j = 0; j < sides; j++)
      surface.indices.push(rim[j], rim[(j + 1) % sides], tip);
  }
}

// Sculpture layout: a grounded slab with the network stacked in three shallow layers.
const slabTop = 0.04;
const tubeRadius = 0.0058;
const layerBase = slabTop + 0.011;
const layerStep = 0.012;
const layerOf = { Orange: 0, Green: 1, Red: 2, Blue: 2 };
const puckRise = 0.0075;
const tubeHeight = (routeId) =>
  layerBase + layerStep * layerOf[routeId.split('-')[0]];

const mixHex = (a, b, t) =>
  '#' +
  [1, 3, 5]
    .map((i) => {
      const u = parseInt(a.slice(i, i + 2), 16),
        v = parseInt(b.slice(i, i + 2), 16);
      return Math.round(u + (v - u) * t)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');

function drum(surface, [x, , z], bottom, top, radius, color, sides = 14) {
  loft(
    surface,
    [circle(x, bottom, z, radius, sides), circle(x, top, z, radius, sides)],
    color,
    { bottom: false },
  );
}

export function mapSculpture(dir) {
  const m = new Model();
  const batch = (name, options) => m.surface(m.material(name, options));
  const base = batch('Map base', { rough: 0.82 });
  const trim = batch('Base trim', {
    metal: 0.55,
    rough: 0.3,
    color: '#7f8aa3',
  });
  const water = batch('Charles River and Boston Harbor', {
    rough: 0.28,
    emission: '#0c2a36',
  });
  const marker = batch('Station markers', {
    rough: 0.35,
    emission: '#6b7078',
  });

  box(base, 0, 0.006, 0, 1.5, 0.012, 1.05, '#0d111b', 0.03);
  box(trim, 0, 0.0135, 0, 1.492, 0.003, 1.042, '#ffffff', 0.03);
  box(base, 0, 0.0275, 0, 1.484, 0.025, 1.034, '#1a2233', 0.03);
  // Street grid, inlaid a hair above the deck so it never z-fights.
  const gridY = slabTop + 0.0002;
  for (let i = -14; i <= 14; i++) {
    const x = i * 0.05,
      w = i % 5 === 0 ? 0.0016 : 0.0008;
    box(base, x, gridY, 0, w, 0.0002, 1.0, i % 5 === 0 ? '#34405c' : '#283350');
  }
  for (let i = -9; i <= 9; i++) {
    const z = i * 0.05,
      w = i % 5 === 0 ? 0.0016 : 0.0008;
    box(base, 0, gridY, z, 1.45, 0.0002, w, i % 5 === 0 ? '#34405c' : '#283350');
  }

  // Center and half-width of the Charles, from the Allston bend to the harbor mouth.
  const banks = [
    [-0.739, -0.058, 0.028],
    [-0.63, -0.083, 0.036],
    [-0.537, -0.166, 0.032],
    [-0.535, -0.268, 0.033],
    [-0.459, -0.334, 0.028],
    [-0.355, -0.309, 0.029],
    [-0.298, -0.253, 0.027],
    [-0.266, -0.191, 0.029],
    [-0.276, -0.12, 0.03],
    [-0.234, -0.064, 0.03],
    [-0.165, -0.032, 0.026],
    [-0.066, -0.014, 0.036],
    [0.055, -0.033, 0.047],
    [0.188, -0.084, 0.052],
    [0.246, -0.145, 0.048],
    [0.274, -0.196, 0.042],
    [0.309, -0.235, 0.03],
    [0.368, -0.258, 0.031],
    [0.428, -0.29, 0.035],
    [0.506, -0.302, 0.057],
    [0.578, -0.27, 0.092],
    [0.625, -0.179, 0.105],
    [0.65, -0.065, 0.088],
    [0.678, 0.038, 0.065],
    [0.726, 0.112, 0.037],
  ];
  const stream = spline(
    banks.map(([x, z, w]) => [x, w, z]),
    0.011,
  );
  const waterY = slabTop + 0.0007;
  let prev;
  for (let i = 0; i < stream.length; i++) {
    const [x, w, z] = stream[i],
      tangent = norm(
        sub(
          stream[Math.min(i + 1, stream.length - 1)],
          stream[Math.max(0, i - 1)],
        ),
      );
    const row = Array.from({ length: 5 }, (_, j) => {
      const v = j / 2 - 1;
      return [
        Math.max(-0.738, Math.min(0.738, x - tangent[2] * v * w)),
        waterY,
        Math.max(-0.513, Math.min(0.513, z + tangent[0] * v * w)),
      ];
    });
    if (prev)
      for (let j = 0; j < 4; j++)
        face(
          water,
          [prev[j], prev[j + 1], row[j + 1], row[j]],
          j === 0 || j === 3 ? '#27667c' : '#1b4f64',
        );
    prev = row;
  }

  const anchors = {},
    lines = [],
    shells = new Map(),
    marked = new Set(),
    levels = new Map();
  for (const [id, routeId, name, color, core, knots] of routes) {
    if (!shells.has(color)) {
      shells.set(color, [
        batch('Lacquer ' + color, {
          rough: 0.34,
          metal: 0.05,
          color: mixHex(color, core, 0.45),
          emission: mixHex('#000000', core, 0.42),
        }),
        batch('Station enamel ' + color, {
          rough: 0.3,
          color: core,
          emission: mixHex('#000000', core, 0.5),
        }),
      ]);
    }
    const [shell, enamel] = shells.get(color);
    const y = tubeHeight(routeId);
    const controls = knots.map(([key]) =>
      project(...(Array.isArray(key) ? key : stops[key]), y),
    );
    const points = clipToFootprint(spline(controls, 0.015));
    lines.push({ id, routeId, name, color, points });
    roundedTube(shell, points, tubeRadius, 14);

    // A soft contact shadow grounds each line on the deck.
    const shadowY = slabTop + 0.0004;
    let edge;
    for (let i = 0; i < points.length; i++) {
      const t = norm(
        sub(
          points[Math.min(i + 1, points.length - 1)],
          points[Math.max(i - 1, 0)],
        ),
      );
      const side = [-t[2] * 0.0105, 0, t[0] * 0.0105];
      const p = [points[i][0], shadowY, points[i][2]];
      const row = [sub(p, side), add(p, side)];
      if (edge) face(base, [edge[1], edge[0], row[0], row[1]], '#0e131f');
      edge = row;
    }

    const sampleIndex = new Map(points.map((p, i) => [p.join(','), i]));
    for (const [k, [key]] of knots.entries()) {
      if (typeof key !== 'string') continue;
      const sample = controls[k].map(Math.fround).join(',');
      const index = sampleIndex.get(sample);
      if (index === undefined || marked.has(sample)) continue;
      marked.add(sample);
      const p = points[index];
      levels.set(key, [...(levels.get(key) ?? []), p]);

      const focus = focal.find((f) => f[1] === key && f[4] === routeId);
      if (!focus) {
        // Ordinary stop: a white pin through the tube that reads as a dot from above.
        drum(marker, p, p[1], p[1] + tubeRadius + 0.0007, 0.0034, '#f4f6fa', 12);
        continue;
      }
      // Explorable stop: a white-rimmed drum on the deck with the line colour on top.
      const [stationId, , label, areaCode] = focus;
      const [lat, lon] = stops[key];
      const top = p[1] + puckRise;
      loft(
        marker,
        [
          circle(p[0], slabTop, p[2], 0.0185, 40),
          circle(p[0], slabTop + 0.002, p[2], 0.0165, 40),
          circle(p[0], top - 0.0012, p[2], 0.0165, 40),
          circle(p[0], top, p[2], 0.0153, 40),
        ],
        '#f4f6fa',
        { bottom: false, top: false },
      );
      const outer = circle(p[0], top, p[2], 0.0153, 40),
        inner = circle(p[0], top, p[2], 0.0108, 40);
      for (let j = 0; j < 40; j++) {
        const l = (j + 1) % 40;
        face(marker, [outer[j], inner[j], inner[l], outer[l]], '#f4f6fa');
      }
      face(enamel, [...inner].reverse(), '#ffffff');
      anchors[stationId] = {
        name: label,
        areaCode: 'AREA - ' + areaCode,
        line: routeId,
        color,
        lat,
        lon,
        tubePos: p,
        topPos: add(p, [0, puckRise, 0]),
        segmentFile: 'segment-' + stationId + '.glb',
      };
    }
  }
  // Transfer posts tie stacked platforms of different lines together.
  for (const platforms of levels.values()) {
    const heights = platforms.map((p) => p[1]);
    const low = Math.min(...heights),
      high = Math.max(...heights);
    if (high - low < 1e-6) continue;
    drum(marker, platforms[0], low, high + tubeRadius + 0.0012, 0.0046, '#f4f6fa', 16);
  }
  m.save(dir + 'boston-map-sculpture.glb');
  json(dir + 'station-anchors.json', anchors);
  json(dir + 'mbta-3d-paths.json', { lines });
}
export function accessories(dir) {
  const t = new Model(),
    hull = t.surface(t.material('Pearl enamel', { metal: 0.46, rough: 0.24 })),
    windows = t.surface(
      t.material('Tintable car glazing', {
        color: '#c1f9ff',
        alpha: 0.74,
        emission: '#24464c',
      }),
    ),
    lamps = t.surface(t.material('LED markers', { emission: '#c6f6fa' }));
  const shape = (z, w, h) => [
    [w * 0.78, -h, z],
    [w, -h * 0.5, z],
    [w, h * 0.52, z],
    [w * 0.65, h, z],
    [-w * 0.65, h, z],
    [-w, h * 0.52, z],
    [-w, -h * 0.5, z],
    [-w * 0.78, -h, z],
  ];
  const sections = [
    [-0.016, 0.0022, 0.0018],
    [-0.012, 0.0048, 0.0036],
    [-0.0085, 0.005, 0.004],
    [0.011, 0.005, 0.004],
    [0.016, 0.0039, 0.0029],
  ].map((v) => shape(...v));
  for (let j = 1; j < sections.length; j++)
    for (let i = 0; i < 8; i++) {
      const k = (i + 1) % 8;
      face(
        hull,
        [
          sections[j - 1][i],
          sections[j - 1][k],
          sections[j][k],
          sections[j][i],
        ],
        '#a7b7c5',
      );
    }
  face(hull, [...sections[0]].reverse(), '#8c9ba3');
  face(hull, sections.at(-1), '#9aa9ab');
  for (const sign of [-1, 1])
    for (let j = 0; j < 5; j++)
      box(
        windows,
        sign * 0.00501,
        0.00055,
        -0.007 + j * 0.0036,
        0.00008,
        0.0021,
        0.0028,
        '#9cd3e2',
      );
  for (const sign of [-1, 1])
    box(
      lamps,
      sign * 0.00125,
      -0.00015,
      -0.01599,
      0.00075,
      0.00065,
      0.00002,
      '#fff4bb',
    );
  t.save(dir + 'mbta-train-capsule.glb');
  const m = new Model();
  const walnut = m.surface(m.material('Satin quarter-sawn walnut', { rough: 0.36, metal: 0.04 }));
  const brass = m.surface(m.material('Brushed brass', { rough: 0.28, metal: 0.78 }));
  const inlay = m.surface(brass.material, 'Scale inlay');
  const iron = m.surface(m.material('Graphite cast iron', { rough: 0.46, metal: 0.45 }));
  const gold = '#c9a462', patina = '#b48d4c', casting = '#26282e';
  const tau = 2 * Math.PI;

  // Each glued stave samples a different stretch of the same straight-grained stock.
  // Long pores follow the growth rings, with finer, broken fibres between them.
  const { crc32, deflateSync } = process.getBuiltinModule('node:zlib');
  const size = 512, pixels = Buffer.alloc((size * 3 + 1) * size);
  function hash(x, y) {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    let u = x - i, v = y - j;
    u *= u * (3 - 2 * u);
    v *= v * (3 - 2 * v);
    const a = hash(i, j), b = hash(i, j + 1);
    return (a + u * (hash(i + 1, j) - a)) * (1 - v) +
      (b + u * (hash(i + 1, j + 1) - b)) * v;
  }
  for (let y = 0; y < size; y++) {
    const board = Math.floor(y / 91), v = 1.5 * y + 557 * board;
    for (let x = 0; x < size; x++) {
      const u = 1.5 * x;
      const wave = v + 19 * noise(u / 245, v / 82) + 4 * noise(u / 100, v / 36);
      const rings = wave / 12 + 2 * noise(u / 400, v / 51);
      const pore = (0.5 + 0.5 * Math.cos(tau * rings)) ** 7;
      const tone = 16 * (noise(u / 180, wave / 15) - 0.5) +
        11 * (noise(u / 22, wave / 1.9) - 0.5) - 11 * pore +
        9 * (hash(board, 101) - 0.5) + 3 * (hash(x, y) - 0.5);
      const i = y * (size * 3 + 1) + 1 + 3 * x;
      pixels[i] = Math.round(88 + tone);
      pixels[i + 1] = Math.round(60 + tone * 0.78);
      pixels[i + 2] = Math.round(43 + tone * 0.61);
    }
  }
  function pngChunk(tag, data) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length);
    chunk.write(tag, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  m.textures.push({ name: 'Walnut staves', material: walnut.material,
    bytes: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
      pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)),
      pngChunk('IEND', Buffer.alloc(0))]) });

  // The two guides and their ticks replace pieces of the walnut surface at y = 0.
  const sides = 60;
  const radii = [0, 0.09955, 0.10045, 0.14955, 0.15045, 0.444];
  const rings = radii.map((r) => circle(0, 0, 0, r, sides));
  function topFace(surface, points) {
    face(surface, points, surface === inlay ? '#d8b878' : '#ffffff',
      surface === walnut ? points.map(([x, , z]) => [0.5 + x / 0.90, 0.5 + z / 0.90]) : undefined);
  }
  for (let k = 1; k < rings.length; k++) {
    const inner = rings[k - 1], outer = rings[k];
    for (let j = 0; j < sides; j++) {
      const l = (j + 1) % sides;
      if (k === 1) topFace(walnut, [[0, 0, 0], outer[l], outer[j]]);
      else if (k === 2 || k === 4) topFace(inlay, [inner[j], inner[l], outer[l], outer[j]]);
      else if (j % (sides / 12) === 0) {
        const depth = (j % (sides / 4) === 0 ? 0.0055 : 0.0033) / (radii[k] - radii[k - 1]);
        const tip = mix(inner[j], outer[j], depth), next = mix(inner[l], outer[l], depth);
        const width = 0.0009 / (radii[k - 1] * tau / sides);
        const start = mix(inner[j], inner[l], width), end = mix(tip, next, width);
        topFace(inlay, [inner[j], start, end, tip]);
        topFace(walnut, [start, inner[l], next, end]);
        topFace(walnut, [tip, next, outer[l], outer[j]]);
      } else topFace(walnut, [inner[j], inner[l], outer[l], outer[j]]);
    }
  }

  // Revolve a joiner's or foundry profile from the bottom up. The optional third
  // ordinate gives the depth of the eight flutes at that height, fading into collars.
  function turn(surface, color, profile, count = 40) {
    const rows = profile.map(([y, r, relief = 0, rise = 0]) => Array.from({ length: count }, (_, i) => {
      const a = tau * i / count;
      const flute = (0.5 + 0.5 * Math.cos(8 * a)) ** 2;
      const radius = r + relief * flute;
      return [radius * Math.cos(a), y + rise * flute, radius * Math.sin(a)];
    }));
    for (let j = 1; j < rows.length; j++) {
      const lower = rows[j - 1], upper = rows[j];
      const strip = lower.map((p, i) => {
        const prev = (i + count - 1) % count, next = (i + 1) % count;
        const [dx, dy, dz] = sub(upper[i], p);
        const tx = (lower[next][0] - lower[prev][0]) + (upper[next][0] - upper[prev][0]);
        const ty = (lower[next][1] - lower[prev][1]) + (upper[next][1] - upper[prev][1]);
        const tz = (lower[next][2] - lower[prev][2]) + (upper[next][2] - upper[prev][2]);
        const normal = norm([dy * tz - dz * ty, dz * tx - dx * tz, dx * ty - dy * tx]);
        return [p, upper[i]].map((pos) => surface.vertex(pos, normal, color,
          surface === walnut ? [0.5 + pos[0] / 0.90, 0.5 + (pos[2] + pos[1]) / 0.90] : undefined));
      });
      for (let i = 0; i < count; i++) {
        const [a, b] = strip[i], [c, d] = strip[(i + 1) % count];
        surface.indices.push(a, b, d, a, d, c);
      }
    }
  }
  turn(walnut, '#ffffff', [
    [-0.062, 0.105], [-0.062, 0.332], [-0.058, 0.34], [-0.036, 0.34], [-0.036, 0.44],
  ], sides);
  turn(brass, gold, [
    [-0.036, 0.44], [-0.033, 0.447], [-0.029, 0.45], [-0.025, 0.448],
    [-0.007, 0.448], [-0.004, 0.45], [-0.0015, 0.449], [0, 0.444],
  ], sides);

  // Low domed rivets sit on the recessed fascia, inside the rolled edge's envelope.
  for (let i = 0; i < 24; i++) {
    const a = (i + 0.5) * tau / 24, ca = Math.cos(a), sa = Math.sin(a);
    const head = Array.from({ length: 8 }, (_, j) => {
      const angle = tau * j / 8, t = 0.0021 * Math.cos(angle);
      return [0.4475 * ca - t * sa, -0.016 + 0.0021 * Math.sin(angle), 0.4475 * sa + t * ca];
    });
    const crown = [0.4497 * ca, -0.016, 0.4497 * sa];
    for (let j = 0; j < head.length; j++) face(brass, [head[(j + 1) % 8], head[j], crown], '#ddbd7d');
  }

  face(iron, circle(0, -0.740, 0, 0.249, 40), casting);
  turn(iron, casting, [[-0.740, 0.249], [-0.729, 0.260], [-0.724, 0.260]]);
  turn(brass, patina, [[-0.724, 0.260], [-0.720, 0.260], [-0.717, 0.256]]);
  turn(iron, casting, [
    [-0.717, 0.256], [-0.711, 0.249], [-0.708, 0.225], [-0.699, 0.214, 0.002, 0.0015],
    [-0.690, 0.157, 0.007, 0.010], [-0.666, 0.096, 0.009, 0.013], [-0.641, 0.074, 0.004, 0.008], [-0.626, 0.071],
  ]);
  turn(brass, gold, [[-0.626, 0.071], [-0.623, 0.075], [-0.616, 0.075], [-0.611, 0.063]]);
  turn(iron, casting, [
    [-0.611, 0.063], [-0.601, 0.060], [-0.584, 0.048, 0.004], [-0.55, 0.042, 0.005],
    [-0.218, 0.036, 0.004], [-0.197, 0.040], [-0.188, 0.051],
  ]);
  turn(brass, gold, [[-0.188, 0.051], [-0.184, 0.054], [-0.178, 0.054], [-0.175, 0.050]]);
  turn(iron, casting, [
    [-0.175, 0.050], [-0.160, 0.048], [-0.13, 0.054, 0.004],
    [-0.099, 0.085, 0.005], [-0.082, 0.108], [-0.061, 0.108],
  ]);
  m.save(dir + 'table-pedestal.glb');
}
