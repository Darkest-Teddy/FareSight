import { readFileSync, writeFileSync } from 'node:fs';
import {
  Model,
  box,
  face,
  loft,
  cross,
  circle,
  sweep,
  spline,
  norm,
  sub,
  mix,
  mul,
  add,
  TAU,
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

function stationRing(surface, center, axis, radius, thickness, color, sides) {
  const u = norm(cross(Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], axis));
  const v = cross(axis, u);
  const first = surface.positions.length / 3;
  const profile = 6;
  for (let j = 0; j < sides; j++) {
    const angle = (TAU * j) / sides;
    const radial = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
    const spine = add(center, mul(radial, radius));
    for (let k = 0; k < profile; k++) {
      const phi = (TAU * k) / profile;
      const n = add(mul(radial, Math.cos(phi)), mul(axis, Math.sin(phi)));
      surface.vertex(add(spine, mul(n, thickness)), n, color);
      const row = first + j * profile,
        next = first + ((j + 1) % sides) * profile;
      const l = (k + 1) % profile;
      surface.indices.push(
        row + k,
        next + k,
        next + l,
        row + k,
        next + l,
        row + l,
      );
    }
  }
}

export function mapSculpture(dir) {
  const m = new Model();
  const batch = (name, options) => m.surface(m.material(name, options));
  const collar = batch('Station collars', {
    metal: 0.68,
    rough: 0.22,
    emission: '#536c74',
  });
  const halo = batch('Station halo highlights', {
    color: '#d7ffff',
    emission: '#c2fffa',
    rough: 0.2,
  });
  const water = batch('Charles River and Boston Harbor', {
    alpha: 0.3,
    rough: 0.35,
    double: true,
    emission: '#1c414d',
  });
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
  let prev;
  for (let i = 0; i < stream.length; i++) {
    const [x, w, z] = stream[i],
      tangent = norm(
        sub(
          stream[Math.min(i + 1, stream.length - 1)],
          stream[Math.max(0, i - 1)],
        ),
      );
    const row = Array.from({ length: 9 }, (_, j) => {
      const v = j / 4 - 1;
      return [
        Math.max(-0.746, Math.min(0.746, x - tangent[2] * v * w)),
        0.245 +
          0.0013 * Math.sin(i * 0.127 + v * 3) +
          0.0008 * Math.cos(v * 6 - i * 0.041),
        z + tangent[0] * v * w,
      ];
    });
    if (prev)
      for (let j = 0; j < 8; j++)
        face(
          water,
          [prev[j], prev[j + 1], row[j + 1], row[j]],
          j === 0 || j === 7 ? '#b8f2fa' : '#86cfdf',
        );
    prev = row;
  }

  const anchors = {},
    lines = [],
    shells = new Map(),
    marked = new Set();
  for (const [id, routeId, name, color, core, knots] of routes) {
    if (!shells.has(color)) {
      shells.set(color, [
        batch('Lacquer ' + color, {
          alpha: 0.63,
          rough: 0.13,
          metal: 0.08,
          color,
        }),
        batch('Luminous filament ' + color, {
          emission: core,
          color: core,
          rough: 0.23,
        }),
      ]);
    }
    const [shell, filament] = shells.get(color);
    const controls = knots.map(([key, y]) =>
      project(...(Array.isArray(key) ? key : stops[key]), y),
    );
    const points = clipToFootprint(spline(controls, 0.015));
    lines.push({ id, routeId, name, color, points });
    roundedTube(shell, points, 0.0058, 14);
    roundedTube(filament, points, 0.0029, 10);

    // Shared Green junctions have one collar, while stacked transfer platforms have one per level.
    const sampleIndex = new Map(points.map((p, i) => [p.join(','), i]));
    for (const [k, [key]] of knots.entries()) {
      if (typeof key !== 'string') continue;
      const sample = controls[k].map(Math.fround).join(',');
      const index = sampleIndex.get(sample);
      if (index === undefined || marked.has(sample)) continue;
      marked.add(sample);
      const p = points[index];
      const tangent = norm(
        sub(
          points[Math.min(index + 1, points.length - 1)],
          points[Math.max(index - 1, 0)],
        ),
      );
      stationRing(collar, p, tangent, 0.0062, 0.00155, '#d6e5eb', 16);

      const focus = focal.find((f) => f[1] === key && f[4] === routeId);
      if (!focus) continue;
      const [stationId, , label, areaCode] = focus;
      const [lat, lon] = stops[key];
      const up = [0, 1, 0];
      stationRing(
        filament,
        add(p, mul(up, 0.004)),
        up,
        0.018,
        0.00165,
        '#ffffff',
        32,
      );
      stationRing(
        halo,
        add(p, mul(up, 0.009)),
        up,
        0.023,
        0.0011,
        '#ffffff',
        32,
      );
      anchors[stationId] = {
        name: label,
        areaCode: 'AREA - ' + areaCode,
        line: routeId,
        color,
        lat,
        lon,
        tubePos: p,
        topPos: add(p, mul(up, 0.045)),
        segmentFile: 'segment-' + stationId + '.glb',
      };
    }
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
  const m = new Model(),
    slate = m.surface(m.material('Honed graphite', { rough: 0.75 })),
    steel = m.surface(
      m.material('Spun aluminium', { metal: 0.82, rough: 0.31 }),
    ),
    glow = m.surface(
      m.material('Cyan photoluminescent inlay', { emission: '#378f96' }),
    );
  loft(
    steel,
    [
      circle(0, -0.042, 0, 0.435, 96),
      circle(0, -0.034, 0, 0.45, 96),
      circle(0, -0.007, 0, 0.45, 96),
      circle(0, -0.004, 0, 0.447, 96),
    ],
    '#667787',
  );
  loft(
    slate,
    [circle(0, -0.004, 0, 0.447, 96), circle(0, 0, 0, 0.445, 96)],
    '#303e48',
    { top: false },
  );
  // Cut the scale rings into the coplanar top to avoid z-fighting or raised plates.
  const radii = [0, 0.0994, 0.1006, 0.1494, 0.1506, 0.445];
  for (let k = 1; k < radii.length; k++) {
    const inner = circle(0, 0, 0, radii[k - 1], 120),
      outer = circle(0, 0, 0, radii[k], 120);
    const surf = k === 2 || k === 4 ? glow : slate;
    for (let j = 0; j < 120; j++) {
      const l = (j + 1) % 120,
        clr = surf === glow ? '#83d4d5' : '#303e48';
      if (k === 1) face(surf, [[0, 0, 0], outer[l], outer[j]], clr);
      else if ((k === 3 || k === 5) && j % 5 === 0) {
        const tickR = radii[k - 1] + (j % 15 === 0 ? 0.008 : 0.004),
          a = circle(0, 0, 0, tickR, 120);
        const f = k === 3 ? 0.12 : 0.09;
        const edgeI = mix(inner[j], inner[l], f),
          edgeA = mix(a[j], a[l], f);
        face(glow, [inner[j], edgeI, edgeA, a[j]], '#80bbbb');
        face(slate, [edgeI, inner[l], a[l], edgeA], clr);
        face(slate, [a[j], a[l], outer[l], outer[j]], clr);
      } else face(surf, [inner[j], inner[l], outer[l], outer[j]], clr);
    }
  }
  m.save(dir + 'table-pedestal.glb');
}
