import {
  clip,
  contains,
  distanceTo,
  edge,
  finalizeSegment,
  inBounds,
  prepareSegment,
  renderBuilding,
  segmentDistance,
  signedArea,
  to3,
  tree,
} from './segment_base.mjs';
import {
  box,
  circle,
  dot,
  face,
  loft,
  mix,
  norm,
  rod,
  sub,
} from './geometry.mjs';

export const STOP_ID = 'place-brico';

const clapboard = [
  '#a1a894',
  '#ceb992',
  '#af806b',
  '#8d9ea5',
  '#c2b8a8',
  '#b9af97',
];
const shingles = ['#646c73', '#8c8880', '#59585a', '#787b76'];
const canvas = ['#ae5843', '#496c59', '#bc954f', '#475777'];
const masonry = ['#b57b65', '#936552', '#c3a481', '#b4937d'];
const distance = (a, b) => Math.hypot(...sub(a, b));
const offset = (p, dir, amount) => p.map((v, i) => v + dir[i] * amount);
const right = ([x, z]) => [z, -x];
const clearPins = (pins, p, radius) =>
  pins.every((q) => distance(q, p) >= 0.025 + radius);

function flat(surface, points, y, color) {
  const ring = clip(points);
  if (ring.length < 3 || Math.abs(signedArea(ring)) < 1e-12) return;
  if (signedArea(ring) > 0) ring.reverse();
  face(
    surface,
    ring.map((p) => to3(p, y)),
    color,
  );
}

function strip(surface, a, b, width, y, color) {
  const n = right(norm(sub(b, a)));
  flat(
    surface,
    [
      offset(a, n, width / 2),
      offset(b, n, width / 2),
      offset(b, n, -width / 2),
      offset(a, n, -width / 2),
    ],
    y,
    color,
  );
}

function nearestPoint(p, a, b) {
  const d = sub(b, a);
  return mix(a, b, Math.min(1, Math.max(0, dot(sub(p, a), d) / dot(d, d))));
}

function roadEdges(roads) {
  return roads.flatMap((r) =>
    r.points.slice(1).map((b, i) => [r.points[i], b, r.radius]),
  );
}

// Select a wall that actually faces a carriageway. Courtyard and party walls have no shop windows.
function frontage(building, streets, maxSetback) {
  let best,
    score = Infinity;
  for (const [a, b, base] of building.visibleWalls) {
    const length = distance(a, b);
    if (
      base > 0.0026 ||
      length < 0.007 ||
      ![a, b].every((p) => inBounds(p, edge - 0.005))
    )
      continue;
    const mid = mix(a, b, 0.5),
      n = right(norm(sub(b, a)));
    for (const [u, v] of streets) {
      const q = nearestPoint(mid, u, v),
        delta = sub(q, mid),
        d = Math.hypot(...delta);
      if (d > maxSetback || dot(n, delta) < d * 0.7) continue;
      const cost = d - Math.min(length, 0.032) * 0.2;
      if (cost < score) {
        best = { a, b, n, length };
        score = cost;
      }
    }
  }
  return best;
}

function storefront(ctx, building, wall) {
  const { s, pins, buildings } = ctx;
  const { a, b, n, length } = wall;
  if (clearPins(pins, mix(a, b, 0.5), length / 2 + 0.001) && !building.hero) {
    const l = mix(a, b, 0.045),
      r = mix(a, b, 0.955);
    const inner = [offset(l, n, -0.0008), offset(r, n, -0.0008)];
    if (inner.every((p) => contains(building.ring, p))) {
      const top = building.height + 0.00085;
      flat(s.city, [l, r, inner[1], inner[0]], top, '#c29d83');
      face(
        s.city,
        [
          to3(l, building.height),
          to3(l, top),
          to3(r, top),
          to3(r, building.height),
        ],
        '#9b6d56',
      );
    }
  }
  const count = Math.max(1, Math.round(length / 0.013));
  for (let i = 0; i < count; i++) {
    const l = mix(a, b, (i + 0.08) / count),
      r = mix(a, b, (i + 0.92) / count);
    const mid = mix(l, r, 0.5),
      reach = 0.0036;
    if (!clearPins(pins, mid, distance(l, r) / 2 + reach)) continue;
    const lip = (p) => offset(p, n, reach);
    if (
      [l, mid, r].some((p) =>
        buildings.some((o) => o !== building && distanceTo(o, lip(p)) < 0.0004),
      )
    )
      continue;
    const high = Math.min(0.017, building.height * 0.77),
      low = high - 0.0033;
    const panel = (u, v, depth, top, bottom, color) => {
      const x = offset(u, n, depth),
        z = offset(v, n, depth);
      face(
        s.city,
        [to3(x, bottom), to3(x, top), to3(z, top), to3(z, bottom)],
        color,
      );
    };
    panel(l, r, 0.00022, low, 0.0032, '#425657');
    for (const f of [0.08, 0.55, 0.89])
      panel(
        mix(l, r, f),
        mix(l, r, f + 0.025),
        0.00026,
        low,
        0.0032,
        '#c4ac8e',
      );
    const tint = canvas[(building.id + i) % canvas.length];
    face(
      s.city,
      [to3(l, high), to3(r, high), to3(lip(r), low), to3(lip(l), low)],
      tint,
    );
    panel(l, r, reach, low, low - 0.0014, tint);
    panel(l, r, reach + 0.00005, low - 0.001, low - 0.0014, '#d6c5a7');
  }
}

function roofDirection(b) {
  const [a, end] = b.walls.reduce((prev, seg) =>
    distance(...prev) > distance(...seg) ? prev : seg,
  );
  return right(norm(sub(end, a)));
}

// Three stacked gallery openings share the same street elevation as the building shell.
function galleries(s, wall, height) {
  const { a, b, n } = wall;
  const left = mix(a, b, 0.14),
    end = mix(a, b, 0.72);
  const rail = (u, v, y, h, d, color) => {
    const p = offset(mix(left, end, u), n, d),
      q = offset(mix(left, end, v), n, d);
    face(s.city, [to3(p, y), to3(p, y + h), to3(q, y + h), to3(q, y)], color);
  };
  const floor = (height - 0.003) / 3;
  for (let i = 0; i < 3; i++) {
    const y = 0.004 + i * floor,
      h = floor * 0.72;
    rail(0, 1, y, h, 0.00018, '#534f49');
    for (const f of [0, 0.48, 0.95])
      rail(f, f + 0.05, y, h, 0.00028, '#d4c7b2');
    rail(0, 1, y, 0.0015, 0.00031, '#c0b39c');
    rail(0, 1, y + h * 0.36, 0.00065, 0.00032, '#e0d5bc');
  }
}

function church(s, b, pins) {
  const orthodox = b.name.startsWith('Holy Resurrection');
  const roof = renderBuilding(s, b, true, pins, {
    pitched: true,
    tower: false,
    finish: orthodox ? '#c3b49f' : '#9b6554',
    roofColor: orthodox ? '#786e63' : '#656872',
    cornice: '#d7c8b0',
    pitchOpts: {
      direction: roofDirection(b),
      rise: orthodox ? 0.01 : 0.015,
      ridgeRatio: 0.5,
    },
  });
  // The Orthodox lantern sits toward the entrance. St. Luke's tower rises where the two wings meet.
  const p = orthodox ? [-0.3462, -0.0776] : [0.0381, 0.1298];
  const r = orthodox ? 0.0043 : 0.0038,
    sill = roof(p);
  const ring = (y, radius) => circle(p[0], y, p[1], radius, orthodox ? 8 : 4);
  loft(
    s.city,
    [ring(b.height, r), ring(sill + 0.009, r)],
    orthodox ? '#c5bca6' : '#a77660',
  );
  loft(
    s.city,
    [ring(sill + 0.009, r * 1.09), ring(sill + 0.0105, r * 1.09)],
    '#d7c7a6',
  );
  const profile = orthodox
    ? [
        [0.0105, 0.85],
        [0.013, 1.25],
        [0.016, 1.03],
        [0.018, 0.58],
        [0.02, 0.18],
      ]
    : [
        [0.0105, 1.05],
        [0.014, 0.86],
        [0.026, 0.1],
      ];
  loft(
    s.city,
    profile.map(([dy, scale]) => ring(sill + dy, r * scale)),
    '#688778',
  );
  const tip = sill + profile.at(-1)[0];
  rod(s.trim, to3(p, tip), to3(p, tip + 0.0045), 0.00035, '#ad9470', 5);
  box(s.trim, p[0], tip + 0.003, p[1], 0.0028, 0.00045, 0.00045, '#ad9470');
}

function tennisCenter(s, b, pins) {
  renderBuilding(s, b, true, pins, {
    pitched: false,
    finish: '#b79e83',
    roofColor: '#a6a298',
    cornice: '#d0c4af',
  });
  const [a, b1, c, d] = b.ring;
  const point = (u, v) => mix(mix(b1, a, u), mix(c, d, u), v);
  const arch = (v) => b.height + 0.0003 + 0.017 * Math.sin(Math.PI * v);
  const sections = 12;
  // Leave flat service bays at each end of the barrel, including the eastern pin clearance.
  for (let j = 0; j < sections; j++) {
    const v = j / sections,
      w = (j + 1) / sections;
    const panel = (l, r, lift, color) => {
      face(
        s.city,
        [
          to3(point(l, v), arch(v) + lift),
          to3(point(r, v), arch(v) + lift),
          to3(point(r, w), arch(w) + lift),
          to3(point(l, w), arch(w) + lift),
        ],
        color,
      );
    };
    panel(0.035, 0.82, 0, j < 6 ? '#c9c6b9' : '#b8b6ae');
    for (let k = 0; k < 9; k++) {
      const u = 0.04 + k * 0.096;
      panel(u, u + 0.01, 0.00055, '#8c938d');
    }
    for (const u of [0.035, 0.82]) {
      const x = point(u, v),
        z = point(u, w);
      const side = [
        to3(x, b.height),
        to3(z, b.height),
        to3(z, arch(w)),
        to3(x, arch(v)),
      ];
      face(s.city, u === 0.035 ? side.reverse() : side, '#9c9a8d');
    }
  }
}

function sports(ctx) {
  const { s, parks, buildings } = ctx;
  const diamond = parks.find((p) => p.name === 'BU Softball Field');
  const [corner, firstLine] = diamond.ring,
    thirdLine = diamond.ring.at(-2);
  const u = norm(sub(firstLine, corner)),
    v = norm(sub(thirdLine, corner));
  const home = offset(offset(corner, u, 0.008), v, 0.008);
  const field = (x, z) => offset(offset(home, u, x), v, z);
  const clay = [field(-0.003, -0.003), field(0.026, -0.003)];
  for (let i = 0; i <= 16; i++) {
    const a = (i * Math.PI) / 32;
    clay.push(field(0.026 * Math.cos(a), 0.026 * Math.sin(a)));
  }
  clay.push(field(-0.003, 0.026));
  flat(s.city, clay, 0.00192, '#b77f5c');
  for (const [a, b] of [
    [field(0, 0), field(0.047, 0)],
    [field(0, 0), field(0, 0.05)],
  ])
    strip(s.city, a, b, 0.00055, 0.00198, '#e8dfcd');
  const base = 0.0174,
    chalk = '#f2e5ca';
  for (const [x, z] of [
    [0, 0],
    [base, 0],
    [base, base],
    [0, base],
  ]) {
    flat(
      s.city,
      [
        [x - 0.00065, z - 0.00065],
        [x + 0.00065, z - 0.00065],
        [x + 0.00065, z + 0.00065],
        [x - 0.00065, z + 0.00065],
      ].map(([a, b]) => field(a, b)),
      0.00202,
      chalk,
    );
  }
  flat(
    s.city,
    Array.from({ length: 14 }, (_, i) =>
      field(
        0.009 + 0.0024 * Math.cos((i * Math.PI) / 7),
        0.009 + 0.0024 * Math.sin((i * Math.PI) / 7),
      ),
    ),
    0.00197,
    '#c9946a',
  );

  const turf = parks.find((p) => p.name === 'New Balance Field'),
    garage = buildings.find((b) => b.name === 'Langsam Garage');
  const [a, b, c, d] = turf.ring,
    lawn = (u, v) => mix(mix(d, a, u), mix(c, b, u), v);
  const y = garage.height + 0.00012;
  flat(s.city, turf.ring, y, '#668c74');
  for (const u of [0.008, 0.04, 0.22, 0.5, 0.78, 0.96, 0.992])
    strip(s.city, lawn(u, 0.012), lawn(u, 0.988), 0.00048, y + 0.0001, chalk);
  for (const v of [0.014, 0.986])
    strip(s.city, lawn(0.008, v), lawn(0.992, v), 0.00048, y + 0.00011, chalk);
  // The spectator benches occupy the exposed garage apron south of the turf.
  for (let i = 0; i < 3; i++) {
    const v = 1.028 + i * 0.029;
    strip(
      s.city,
      lawn(0.012, v),
      lawn(0.085, v),
      0.0011,
      y + 0.0006 + i * 0.00045,
      '#ac9e8a',
    );
  }
}

function trolley(ctx) {
  const { s, area, roads, pins } = ctx;
  // Commonwealth's paired OSM carriageways curve together through the junction.
  const carriageway = (id) =>
    roads[area.roads.findIndex((r) => r.id === id)].points;
  const north = carriageway(8651114),
    south = carriageway(521562486);
  const center = south.map((p) => {
    const q = north
      .slice(1)
      .map((b, i) => nearestPoint(p, north[i], b))
      .reduce((a, b) => (distance(p, a) < distance(p, b) ? a : b));
    return mix(p, q, 0.5);
  });
  center.push([0.251, 0.146], [0.272, 0.138], [0.338, 0.145], [0.43, 0.16]);
  for (let i = 1; i < center.length; i++) {
    const a = center[i - 1],
      b = center[i],
      n = right(norm(sub(b, a)));
    // Recess the track bed into paving where the customer pins land.
    const cuts = [0, 1],
      length = distance(a, b),
      dir = norm(sub(b, a)),
      buffer = 0.0283;
    for (const p of pins) {
      const d = dot(sub(p, a), dir),
        perpendicular = Math.abs(dot(sub(p, a), n));
      if (perpendicular >= buffer) continue;
      const half = Math.sqrt(buffer * buffer - perpendicular * perpendicular);
      for (const t of [(d - half) / length, (d + half) / length])
        if (t > 0 && t < 1) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    for (let k = 1; k < cuts.length; k++) {
      if (!clearPins(pins, mix(a, b, (cuts[k] + cuts[k - 1]) / 2), 0.0032))
        continue;
      const start = mix(a, b, cuts[k - 1]),
        end = mix(a, b, cuts[k]);
      strip(s.city, start, end, 0.0064, 0.00243, '#a0a090');
      for (const rail of [-0.00205, -0.00068, 0.00068, 0.00205])
        strip(
          s.city,
          offset(start, n, rail),
          offset(end, n, rail),
          0.00032,
          0.00248,
          '#636662',
        );
    }
  }
  const a = center[center.length - 6],
    b = center[center.length - 5],
    along = norm(sub(b, a)),
    n = right(along);
  const p = mix(a, b, 0.82),
    local = (u, v) => offset(offset(p, along, u), n, v);
  const slab = (halfWidth, depth, shift, y) =>
    [
      local(-halfWidth, shift - depth),
      local(-halfWidth, shift + depth),
      local(halfWidth, shift + depth),
      local(halfWidth, shift - depth),
    ].map((q) => to3(q, y));
  if (clearPins(pins, p, 0.012)) {
    loft(
      s.city,
      [
        slab(0.011, 0.0019, -0.0044, 0.00245),
        slab(0.011, 0.0019, -0.0044, 0.0034),
      ],
      '#bfbaa8',
    );
    for (const u of [-0.0072, 0.0072]) {
      const q = local(u, -0.0048);
      rod(s.trim, to3(q, 0.0034), to3(q, 0.0122), 0.00052, '#726d62', 5);
    }
    loft(
      s.city,
      [
        slab(0.009, 0.0023, -0.0044, 0.0113),
        slab(0.009, 0.0023, -0.0044, 0.0123),
      ],
      '#43845a',
    );
    loft(
      s.city,
      [
        slab(0.0095, 0.0026, -0.0044, 0.0123),
        slab(0.0091, 0.0023, -0.0044, 0.0143),
      ],
      '#4b504c',
    );
  }
}

function streetTrees(ctx) {
  const { s, pins, parks, roads, buildings, random } = ctx;
  const reserved = [],
    traffic = roadEdges(
      roads.filter((r) => !['footway', 'pedestrian'].includes(r.kind)),
    ),
    garden = parks.find((p) => p.name === 'Lawton Park Community Garden');
  function plant(p, h) {
    const r = h * 0.31;
    if (
      !inBounds(p, edge - r) ||
      !clearPins(pins, p, r) ||
      reserved.some((q) => distance(p, q) < r + 0.006) ||
      buildings.some((b) => distanceTo(b, p) < r) ||
      traffic.some(([a, b, width]) => segmentDistance(p, a, b) < width + 0.0006)
    )
      return;
    const shades = [
      ['#77855c', '#a2a573'],
      ['#889262', '#c1ab73'],
      ['#677d60', '#92a57b'],
      ['#9d8b58', '#beaa6a'],
    ];
    const [canopy, crown] = shades[Math.floor(random() * shades.length)];
    tree(s, p, h, false, { canopy, crown, trunk: '#7a6955' });
    reserved.push(p);
  }
  const [g0, g1] = garden.ring,
    u = norm(sub(g1, g0)),
    inward = right(u).map((v) => -v);
  for (let j = 0; j < 5; j++) {
    const a = offset(offset(g0, u, 0.003), inward, 0.002 + j * 0.0027),
      b = offset(a, u, 0.009);
    if ([a, b].every((p) => contains(garden.ring, p)))
      strip(s.city, a, b, 0.0015, 0.002, '#8c7457');
  }
  for (let i = 0; i < 50 && reserved.length < 2; i++) {
    const p = garden.bounds.map(([lo, hi]) => lo + random() * (hi - lo));
    if (contains(garden.ring, p)) plant(p, 0.012 + random() * 0.004);
  }
  const streets = roadEdges(roads.filter((r) => r.kind === 'residential'));
  for (let i = 0; i < 3200 && reserved.length < 30; i++) {
    const [a, b, width] = streets[Math.floor(random() * streets.length)],
      h = 0.014 + random() * 0.01;
    const normal = right(norm(sub(b, a))),
      sign = random() < 0.5 ? -1 : 1;
    plant(
      offset(mix(a, b, random()), normal, sign * (width + h * 0.32 + 0.0006)),
      h,
    );
  }
}

export function buildSegment(dir) {
  const ctx = prepareSegment(STOP_ID, {
    deckColor: '#b8b5a6',
    pitchColor: '#89a482',
    roadColors: { major: '#6c6b69', minor: '#83827c', foot: '#c9c3b3' },
  });
  const { s, rendered, pins, detailed, roads } = ctx;
  const avenues = roadEdges(roads.filter((r) => r.kind === 'primary'));
  const residentialStreets = roadEdges(
    roads.filter((r) => r.kind === 'residential'),
  );
  for (const b of rendered) {
    if (b.kind === 'church') {
      church(s, b, pins);
      continue;
    }
    if (b.name === 'Boston University Track & Tennis Center') {
      tennisCenter(s, b, pins);
      continue;
    }
    const residential = [
      'house',
      'semidetached_house',
      'terrace',
      'apartments',
      'residential',
    ].includes(b.kind);
    const nearPin = pins.some((p) => distanceTo(b, p) < 0.025);
    const gable =
      residential &&
      !nearPin &&
      b.area > 0.00007 &&
      b.area < 0.00052 &&
      b.heightM <= 13 &&
      b.ring.length <= 10 &&
      b.visibleRoof.length === b.roof.length &&
      b.id % 5 < 2;
    const retail =
      ['retail', 'supermarket', 'commercial'].includes(b.kind) ||
      (b.kind === 'yes' && b.heightM <= 6.4);
    const shop = retail && b.heightM <= 13 ? frontage(b, avenues, 0.031) : null;
    const pitch = gable
      ? {
          pitched: true,
          pitchOpts: {
            direction: roofDirection(b),
            ridgeRatio: 0.5,
            rise: Math.min(0.011, Math.sqrt(b.area) * 0.46),
          },
        }
      : {};
    const roofHeight = renderBuilding(
      s,
      b,
      Boolean(shop) || detailed.has(b),
      pins,
      {
        ...pitch,
        ...(residential && { finish: clapboard[b.id % clapboard.length] }),
        ...(gable && {
          roofColor: shingles[b.id % shingles.length],
          cornice: '#d2c5b1',
        }),
        ...(shop && {
          finish: masonry[b.id % masonry.length],
          cornice: '#bd9678',
          roofColor: '#b9afa1',
        }),
        ...(b.name === 'Langsam Garage' && { pitched: false }),
        penthouse: !nearPin,
      },
    );
    if (gable && Math.floor(b.id / 5) % 4 === 0) {
      const tri = b.visibleRoof.reduce((a, c) =>
        Math.abs(signedArea(a)) > Math.abs(signedArea(c)) ? a : c,
      );
      const p = mix(mix(tri[0], tri[1], 0.5), tri[2], 1 / 3),
        radius = 0.00145;
      if (
        tri.every((a, i) => segmentDistance(p, a, tri[(i + 1) % 3]) > radius)
      ) {
        const sill = roofHeight(p),
          h = 0.006;
        box(s.city, p[0], sill + 0.001, p[1], 0.0019, h, 0.0015, '#926b5b');
        box(
          s.city,
          p[0],
          sill + 0.0043,
          p[1],
          0.0023,
          0.0006,
          0.0019,
          '#baa28d',
        );
      }
    }
    if (shop) storefront(ctx, b, shop);
    if (gable && b.heightM >= 8 && Math.floor(b.id / 5) % 3 !== 0) {
      const wall = frontage(b, residentialStreets, 0.026);
      if (wall) galleries(s, wall, b.height);
    }
  }
  sports(ctx);
  trolley(ctx);
  streetTrees(ctx);
  return finalizeSegment(ctx, dir, { maxTriangles: 32000 });
}
