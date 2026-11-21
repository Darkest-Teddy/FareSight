import {
  boundsOf,
  clip,
  contains,
  distanceTo,
  edge,
  finalizeSegment,
  penthouse,
  prepareSegment,
  projectLatLon,
  renderBuilding,
  roofFaces,
  segmentDistance,
  signedArea,
  simplify,
  subtractTriangle,
  to3,
  tree,
  triangulate,
} from './segment_base.mjs';
import {
  circle,
  face,
  loft,
  mix,
  norm,
  rod,
  sub,
  sweep,
  TAU,
} from './geometry.mjs';

export const STOP_ID = 'place-bucen';

const dist = (a, b) => Math.hypot(...sub(a, b));
const center = (ring) =>
  [0, 1].map((k) => ring.reduce((n, p) => n + p[k], 0) / ring.length);
const offset = (p, u, d) => [p[0] + u[0] * d, p[1] + u[1] * d];
const right = ([x, z]) => [-z, x];
const clearPins = (pins, p, r) => pins.every((q) => dist(p, q) >= 0.025 + r);

function outline(points) {
  const ring = simplify(clip(points, edge), 1e-9, true);
  if (signedArea(ring) < 0) ring.reverse();
  return ring.length >= 3 && signedArea(ring) > 1e-10 ? ring : [];
}

function rectangle(p, u, length, width) {
  const v = right(u);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([x, z]) => offset(offset(p, u, (x * length) / 2), v, (z * width) / 2));
}

function prism(s, points, low, high, tint) {
  const ring = outline(points);
  if (ring.length)
    loft(
      s,
      [low, high].map((y) => ring.map((p) => to3(p, y))),
      tint,
      { bottom: false },
    );
}

function plank(s, p, u, l, w, low, high, tint) {
  prism(s, rectangle(p, u, l, w), low, high, tint);
}

function paving(s, ring, y, color) {
  const shape = outline(ring);
  if (shape.length) roofFaces(s, triangulate(shape), y, color);
}

function line(s, points, width, y, tint) {
  // Shared cross-sections keep the pavement continuous around bends.
  const sections = points.map((p, i) => {
    const u = norm(
      sub(
        points[Math.min(i + 1, points.length - 1)],
        points[Math.max(0, i - 1)],
      ),
    );
    return [-1, 1].map((sign) => offset(p, right(u), (sign * width) / 2));
  });
  for (let i = 1; i < sections.length; i++)
    paving(s, [...sections[i - 1], ...sections[i].slice().reverse()], y, tint);
}

function shellBand(surface, a, b, low, high, color, repeats) {
  const quad = [to3(a, low), to3(a, high), to3(b, high), to3(b, low)];
  face(
    surface,
    quad,
    color,
    repeats && [[0, repeats[1]], [0, 0], [repeats[0], 0], repeats],
  );
}

// Each OSM building part records the top of a different cantilever. Extruding
// its surveyed perimeter only between those elevations preserves the undercuts.
function dataSciences(ctx, building, parts) {
  const { s } = ctx;
  const tiers = parts.toSorted((a, b) => a.height - b.height);
  const courses = [],
    terraces = new Set();
  function course(points, low, high, material, color) {
    const ring = outline(points);
    if (ring.length)
      courses.push({
        ring,
        roof: triangulate(ring),
        low,
        high,
        material,
        color,
      });
  }
  let low = 0.00255;
  for (const [i, tier] of tiers.entries()) {
    const count = Math.max(
      1,
      Math.round((tier.heightM - (tiers[i - 1]?.heightM ?? 0)) / 4.1),
    );
    // The named outline provides the ground-floor perimeter. The upper parts
    // supply the real alternating shifts even where the bezel cuts the tower.
    const plan = i === 0 ? building.ring : tier.ring;
    const mid = center(plan),
      glass = plan.map((p) => mix(p, mid, 0.035));
    const height = (tier.height - low) / count;
    for (let floor = 0; floor < count; floor++) {
      const base = low + floor * height,
        top = base + height;
      course(glass, base, top - 0.0025, s.tower, '#789294');
      course(
        plan,
        top - 0.0025,
        top,
        s.paint,
        ['#a25e3c', '#b2714b', '#965437'][i % 3],
      );
    }
    terraces.add(courses.at(-1));
    low = tier.height;
  }
  function exposed(a, b, height, tint, underside = false) {
    for (const tri of a.roof) {
      let pieces = [tri];
      for (const cutter of b?.roof ?? [])
        pieces = pieces.flatMap((p) => subtractTriangle(p, cutter));
      for (const poly of pieces) {
        const p = simplify(poly, 1e-8, true);
        if (signedArea(p) > 1e-10)
          face(
            s.city,
            (underside ? p : p.reverse()).map((v) => to3(v, height)),
            tint,
          );
      }
    }
  }
  for (const [i, course] of courses.entries()) {
    const { ring, low, high, material, color } = course;
    ring.forEach((a, j) => {
      const b = ring[(j + 1) % ring.length];
      shellBand(
        material,
        a,
        b,
        low,
        high,
        color,
        material === s.tower
          ? [Math.max(1, Math.round(dist(a, b) / 0.005)), 1]
          : undefined,
      );
      if (
        material !== s.tower ||
        high - low < 0.003 ||
        dist(a, b) < 0.015 ||
        [a, b].some((p) => Math.abs(p[0]) >= edge - 0.001)
      )
        return;
      const outward = right(norm(sub(a, b))),
        bays = Math.ceil(dist(a, b) / 0.012);
      for (let k = 0; k < bays; k++) {
        const start = offset(mix(a, b, (k + 0.12) / bays), outward, 0.00028);
        const end = offset(mix(a, b, (k + 0.88) / bays), outward, 0.00028);
        const levels = k % 2 === 0 ? [low, high] : [high, low];
        const axis = norm(sub(b, a));
        const brace = [
          to3(offset(start, axis, -0.00035), levels[0]),
          to3(offset(end, axis, -0.00035), levels[1]),
          to3(offset(end, axis, 0.00035), levels[1]),
          to3(offset(start, axis, 0.00035), levels[0]),
        ];
        if (levels[0] > levels[1]) brace.reverse();
        face(s.paint, brace, '#ad714f');
      }
    });
    const topColor =
      i === courses.length - 1
        ? '#a8a89b'
        : terraces.has(course)
          ? '#839764'
          : '#ac795b';
    exposed(course, courses[i + 1], high, topColor);
    if (i) exposed(course, courses[i - 1], low, '#815638', true);
  }
}

function warren(ctx, b) {
  const { s, pins } = ctx;
  const roof = renderBuilding(s, b, true, pins, {
    pitched: false,
    tower: true,
    finish: '#8d8a7c',
    cornice: '#d2bc95',
    roofColor: '#a99e86',
    penthouse: false,
  });
  const podium = 0.0672;
  for (const [a, end, base] of b.visibleWalls) {
    const u = norm(sub(end, a)),
      n = right(u),
      length = dist(a, end);
    if (
      length < 0.008 ||
      a.some(
        (v, i) =>
          Math.abs(Math.abs(v) - edge) < 1e-7 && Math.abs(v - end[i]) < 1e-7,
      )
    )
      continue;
    const lo = Math.max(base, podium),
      shaft = b.height - lo;
    for (let j = 1; j < 15; j++) {
      const y = lo + (shaft * j) / 15;
      const band = outline([
        a,
        end,
        offset(end, n, -0.0007),
        offset(a, n, -0.0007),
      ]);
      if (!band.length) continue;
      for (let k = 0; k < band.length; k++) {
        const start = band[k],
          stop = band[(k + 1) % band.length];
        if (segmentDistance(mix(start, stop, 0.5), a, end) > 0.00062)
          shellBand(s.city, start, stop, y - 0.0008, y + 0.0008, '#c0a889');
      }
      face(
        s.city,
        band.reverse().map((p) => to3(p, y + 0.0008)),
        '#cab499',
      );
    }
    const bays = Math.max(3, Math.round(length / 0.0073));
    for (let j = 0; j < bays; j++)
      plank(
        s.city,
        offset(mix(a, end, (j + 0.5) / bays), n, -0.0009),
        u,
        0.00175,
        0.00165,
        lo,
        b.height,
        '#d6c39f',
      );
    plank(
      s.city,
      offset(mix(a, end, 0.5), n, 0.00065),
      u,
      length,
      0.0013,
      b.height,
      b.height + 0.0026,
      '#dfcba4',
    );
  }
  penthouse(s, b, roof, pins, '#948879', '#cec5ab');
}

function chapel(ctx, b) {
  const { s, pins } = ctx,
    across = norm([1, 0.16]);
  const roofHeight = renderBuilding(s, b, true, pins, {
    tower: false,
    pitched: true,
    finish: '#c4b8a3',
    roofColor: '#585e65',
    cornice: '#d9ceb6',
    pitchOpts: { direction: across, ridgeRatio: 0.5, rise: 0.019 },
  });
  for (const [a, end, base] of b.visibleWalls) {
    const u = norm(sub(end, a)),
      n = right(u),
      length = dist(a, end);
    if (length < 0.009) continue;
    const bays = Math.max(1, Math.round(length / 0.009));
    for (let i = 0; i < bays; i++) {
      const p = mix(a, end, (i + 0.5) / bays),
        w = Math.min(0.003, (length / bays) * 0.28);
      const at = (x, y) => to3(offset(offset(p, u, x), n, -0.00035), y);
      const y = b.height;
      face(
        s.window,
        [
          at(-w, y - 0.029),
          at(-w, y - 0.012),
          at(0, y - 0.006),
          at(w, y - 0.012),
          at(w, y - 0.029),
        ],
        '#565f62',
      );
      plank(
        s.city,
        offset(p, n, -0.00055),
        u,
        0.00052,
        0.0006,
        y - 0.029,
        y - 0.011,
        '#d0c2a6',
      );
      const buttress = mix(a, end, (i + 0.12) / bays);
      for (const [d, lo, hi] of [
        [0.0033, base, y * 0.48],
        [0.0025, y * 0.48, y * 0.75],
        [0.0017, y * 0.75, y - 0.003],
      ])
        if (hi > lo)
          plank(
            s.city,
            offset(buttress, n, -d / 2),
            u,
            0.0022,
            d,
            lo,
            hi,
            '#bdaa91',
          );
    }
  }
  const p = [0.022, -0.052],
    sill = roofHeight(p) - 0.0066;
  loft(
    s.city,
    [
      circle(p[0], sill, p[1], 0.005, 8),
      circle(p[0], sill + 0.013, p[1], 0.0042, 8),
    ],
    '#a69c87',
  );
  loft(
    s.city,
    [
      circle(p[0], sill + 0.013, p[1], 0.0049, 8),
      circle(p[0], sill + 0.039, p[1], 0.00045, 8),
    ],
    '#586c65',
  );
  rod(
    s.trim,
    to3(p, sill + 0.039),
    to3(p, sill + 0.043),
    0.00034,
    '#9a8053',
    6,
  );
}

function campusBlock(ctx, b) {
  const { s, pins, detailed } = ctx;
  const residential = ['apartments', 'detached'].includes(b.kind);
  const hall = /Mugar|George Sherman|Photonics|Theology/.test(b.name ?? '');
  const podium = [29680807, 1501604066, 1501604070, 1501604073].includes(b.id);
  const brick = ['#a25d45', '#865442', '#ae7258', '#b68868'];
  const options = { pitched: false, penthouse: !hall && !residential };
  if (residential)
    Object.assign(options, {
      tower: false,
      finish: brick[b.id % 4],
      cornice: '#dcbd99',
      roofColor: '#655e60',
      pitched: b.id % 3 !== 0,
      pitchOpts: { rise: 0.0065, ridgeRatio: 0.5 },
    });
  if (hall || podium)
    Object.assign(options, {
      finish: /Photonics/.test(b.name)
        ? '#a7bab5'
        : podium
          ? '#a18c77'
          : '#bda484',
      cornice: '#e0cbaa',
      roofColor: '#a8a397',
      pitched: /Theology/.test(b.name),
    });
  // Preserve the roof profile sampled by the shared interior pin manifest.
  if (pins.some((p) => contains(b.ring, p))) {
    delete options.pitched;
    delete options.pitchOpts;
  }
  const roof = renderBuilding(
    s,
    b,
    detailed.has(b) || hall || residential,
    pins,
    options,
  );
  if (residential || hall)
    penthouse(
      s,
      b,
      roof,
      pins,
      residential ? '#934d3b' : '#788680',
      residential ? '#b58769' : '#b7c2b9',
    );
  if (!residential && !hall && !podium) return;
  // A projecting bay belongs to the street elevation of each brownstone.
  const streetWalls = residential
    ? b.visibleWalls.filter(([a, end]) => {
        const length = dist(a, end);
        return (
          length > 0.015 &&
          length < 0.05 &&
          [a, end].every((p) => p.every((v) => Math.abs(v) < edge - 0.0025))
        );
      })
    : [];
  const streetDistance = ([a, end]) => {
    const p = mix(a, end, 0.5);
    return Math.min(
      ...ctx.roads
        .filter((r) => r.kind !== 'footway')
        .flatMap((r) =>
          r.points.slice(1).map((q, i) => segmentDistance(p, r.points[i], q)),
        ),
    );
  };
  const front = streetWalls.sort(
    (a, b) => streetDistance(a) - streetDistance(b),
  )[0];
  for (const [a, end, base] of b.visibleWalls) {
    const length = dist(a, end),
      u = norm(sub(end, a)),
      n = right(u);
    if (
      length < 0.012 ||
      a.some(
        (v, i) =>
          Math.abs(Math.abs(v) - edge) < 1e-7 && Math.abs(v - end[i]) < 1e-7,
      )
    )
      continue;
    const mid = mix(a, end, 0.5);
    const cornice = b.height - 0.0038;
    if (cornice > base)
      plank(
        s.city,
        offset(mid, n, -0.00045),
        u,
        length,
        0.0013,
        cornice,
        cornice + 0.0014,
        '#d6bf9c',
      );
    if (hall || podium) {
      const bays = Math.max(1, Math.round(length / 0.012));
      for (let j = 0; j < bays; j++)
        plank(
          s.city,
          offset(mix(a, end, (j + 0.5) / bays), n, -0.00065),
          u,
          0.0017,
          0.0014,
          base,
          b.height - 0.004,
          '#c8b79a',
        );
    } else if (a === front?.[0] && b.height - base > 0.023) {
      const w = Math.min(0.009, length * 0.4),
        d = 0.0021;
      const ring = [
        [-0.5, 0],
        [0.5, 0],
        [0.33, -1],
        [-0.33, -1],
      ].map(([x, z]) => offset(offset(mid, u, x * w), n, z * d));
      prism(s.city, ring, base + 0.007, b.height - 0.008, brick[b.id % 4]);
      const faceMid = offset(mid, n, -d - 0.00015);
      for (let y = base + 0.009; y + 0.007 < b.height - 0.008; y += 0.013)
        shellBand(
          s.window,
          offset(faceMid, u, -w * 0.235),
          offset(faceMid, u, w * 0.235),
          y,
          y + 0.006,
          '#5d686a',
        );
      prism(s.city, ring, b.height - 0.008, b.height - 0.0065, '#cbb18e');
    }
  }
}

function bench(s, p, u, ground) {
  const n = right(u);
  for (const d of [-0.0032, 0.0032])
    plank(
      s.paint,
      offset(p, u, d),
      n,
      0.0032,
      0.00085,
      ground,
      ground + 0.0025,
      '#534f45',
    );
  for (const d of [-0.001, 0, 0.001])
    plank(
      s.city,
      offset(p, n, d),
      u,
      0.009,
      0.00078,
      ground + 0.0025,
      ground + 0.0031,
      '#b08253',
    );
  for (const d of [-0.0032, 0.0032])
    plank(
      s.paint,
      offset(offset(p, u, d), n, 0.00135),
      u,
      0.0006,
      0.00055,
      ground + 0.0025,
      ground + 0.005,
      '#534f45',
    );
  plank(
    s.city,
    offset(p, n, 0.00136),
    u,
    0.009,
    0.00075,
    ground + 0.0039,
    ground + 0.005,
    '#af794c',
  );
}

function marshPlaza(ctx) {
  const { s, pins } = ctx,
    p = [0.013, 0.006],
    [x, z] = p;
  for (const [r, y, col] of [
    [0.021, 0.0022, '#b6997b'],
    [0.0198, 0.0028, '#d6c3a0'],
    [0.0184, 0.0033, '#be936f'],
  ])
    loft(s.city, [circle(x, 0.00185, z, r, 44), circle(x, y, z, r, 44)], col, {
      bottom: false,
    });
  for (let i = 0; i < 24; i++) {
    const u = [Math.cos((i * TAU) / 24), Math.sin((i * TAU) / 24)];
    line(
      s.city,
      [offset(p, u, 0.0062), offset(p, u, 0.0183)],
      0.00035,
      0.00338,
      '#dec7a3',
    );
  }
  paving(
    s.city,
    circle(x, 0, z, 0.0062, 24).map(([x, , z]) => [x, z]),
    0.00346,
    '#ceae85',
  );
  for (let i = 0; i < 16; i++) {
    const angle = (i * TAU) / 16,
      u = [Math.cos(angle), Math.sin(angle)],
      q = offset(p, u, 0.02);
    if (i % 4 === 0 || !clearPins(pins, q, 0.0036)) continue;
    plank(s.city, q, right(u), 0.006, 0.0018, 0.002, 0.005, '#bdad92');
    plank(s.city, q, right(u), 0.0062, 0.0021, 0.005, 0.0057, '#d7c9ac');
  }
}

function avenue(ctx) {
  const { s, pins, roads } = ctx;
  const carriageways = [[], []];
  for (const road of roads.filter((r) => r.kind === 'primary')) {
    for (let i = 1; i < road.points.length; i++) {
      const [a, b] = [road.points[i - 1], road.points[i]].sort(
        (a, b) => a[0] - b[0],
      );
      carriageways[Number(a[1] - 0.16 * a[0] > 0.065)].push([a, b]);
    }
  }
  const zAt = (x) =>
    carriageways.reduce((sum, parts) => {
      const gap = ([a, b]) => Math.max(0, a[0] - x, x - b[0]);
      const [a, b] = parts.reduce((best, p) => (gap(p) < gap(best) ? p : best));
      return sum + a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
    }, 0) / 2;
  const path = simplify(
    Array.from({ length: 49 }, (_, i) => {
      const x = -0.435 + (0.87 * i) / 48;
      return [x, zAt(x)];
    }),
    0.0002,
    false,
  );
  const u = norm([1, 0.16]),
    n = right(u);
  line(s.city, path, 0.015, 0.00195, '#b3ad93');
  line(s.city, path, 0.013, 0.00205, '#8d9b74');
  for (let x = -edge; x < edge; x += 0.0064) {
    const p = [x, zAt(x)];
    for (const d of [-0.0033, 0.0033])
      paving(
        s.city,
        rectangle(offset(p, n, d), n, 0.0037, 0.00095),
        0.00218,
        '#8e8473',
      );
  }
  for (const d of [-0.00445, -0.00215, 0.00215, 0.00445])
    line(
      s.trim,
      path.map((p) => offset(p, n, d)),
      0.00044,
      0.00248,
      '#9a9b94',
    );
  for (const [x, side] of [
    [-0.185, 1],
    [-0.105, -1],
  ]) {
    const p = offset([x, zAt(x)], n, side * 0.0072);
    if (!clearPins(pins, p, 0.021)) continue;
    plank(s.city, p, u, 0.04, 0.006, 0.0016, 0.0032, '#c9c2a8');
    for (const d of [-0.012, 0, 0.012]) {
      const q = offset(offset(p, u, d), n, 0.0013 * side);
      plank(s.paint, q, u, 0.001, 0.001, 0.0032, 0.0128, '#525a52');
    }
    plank(s.paint, p, u, 0.032, 0.007, 0.0128, 0.0142, '#434d4b');
    plank(s.paint, p, u, 0.0321, 0.0071, 0.0142, 0.015, '#39865d');
    plank(s.city, p, u, 0.0323, 0.0074, 0.015, 0.0155, '#757c70');
    bench(s, p, u, 0.0032);
  }
  const lamps = [];
  for (let x = -0.39; x < 0.41; x += 0.058)
    for (const side of [-1, 1]) {
      const q = offset([x, zAt(x)], n, side * 0.0295);
      if (
        !clearPins(pins, q, 0.0045) ||
        ctx.buildings.some((b) => distanceTo(b, q) < 0.005)
      )
        continue;
      const upper = offset(q, n, -side * 0.0032);
      sweep(
        s.trim,
        [to3(q, 0.0015), to3(q, 0.0045)],
        0.0012,
        '#645b4c',
        5,
        false,
      );
      sweep(
        s.paint,
        [to3(q, 0.0044), to3(q, 0.017), to3(upper, 0.0185)],
        0.00058,
        '#5b5648',
        5,
        false,
      );
      plank(s.city, upper, n, 0.0023, 0.0014, 0.0177, 0.0186, '#e6d6ac');
      lamps.push(q);
    }
  return lamps;
}

// The OSM snapshot has no water polygon here. These shoreline vertices come
// from MassGIS HYDRO25K_POLY, Massachusetts_Water_Features/FeatureServer/8,
// OBJECTID 14934, in WGS84 (longitude, latitude).
const charlesBank = [
  [-71.110736, 42.352193],
  [-71.110097, 42.352092],
  [-71.108986, 42.352101],
  [-71.108694, 42.352078],
  [-71.107753, 42.351893],
  [-71.106952, 42.351732],
  [-71.106366, 42.351651],
  [-71.105672, 42.351615],
  [-71.104377, 42.351498],
  [-71.103267, 42.351473],
  [-71.102079, 42.351585],
];

function river(ctx) {
  const { s, area } = ctx,
    bank = charlesBank.map(([lon, lat]) => projectLatLon(area, lat, lon));
  const surface = [...bank, [bank.at(-1)[0], -edge], [bank[0][0], -edge]];
  paving(s.city, surface, 0.00157, '#648c89');
  line(s.city, bank, 0.0028, 0.00175, '#a6a58d');
  const walk = bank.map(([x, z]) => [x, z + 0.007]);
  line(s.city, walk, 0.004, 0.00179, '#c6bda5');
  // Thin, broken strokes read as water at the same scale as the park paths.
  for (let i = 0; i < 75; i++) {
    const p = [(ctx.random() - 0.5) * 0.84, -0.18 - ctx.random() * 0.24],
      size = 0.004 + ctx.random() * 0.015;
    const shape = rectangle(p, norm([1, 0.09]), size, 0.00035);
    if (shape.every((q) => contains(surface, q)))
      paving(s.city, shape, 0.00175, '#87a59f');
  }
  return walk;
}

function landscape(ctx, lamps, bankWalk) {
  const { s, pins, buildings, parks, roads, random } = ctx;
  const beach = parks.find((p) => p.name === 'BU Beach');
  // Two low turf contours flank the open lawn where the BU Beach pin lands.
  for (const [scale, y, color] of [
    [0.91, 0.00162, '#95a976'],
    [0.73, 0.00172, '#a5b582'],
  ])
    for (const focus of [
      [0.031, -0.145],
      [0.221, -0.121],
    ]) {
      paving(
        s.city,
        beach.ring.map((p) => mix(focus, p, scale * 0.42)),
        y,
        color,
      );
    }
  const lawnWalk = Array.from({ length: 22 }, (_, i) => {
    const t = i / 21;
    return [
      0.012 + 0.237 * t,
      -0.148 + 0.033 * t + 0.005 * Math.sin(t * Math.PI * 1.55),
    ];
  });
  line(s.city, lawnWalk, 0.0027, 0.00182, '#cbbd9f');
  const benches = [];
  for (const [path, step, y] of [
    [lawnWalk, 4, 0.0018],
    [bankWalk, 1, 0.0015],
  ]) {
    for (let i = 1; i < path.length - 1; i += step) {
      const u = norm(sub(path[i + 1], path[i - 1])),
        p = offset(path[i], right(u), 0.0045);
      if (
        !clearPins(pins, p, 0.0055) ||
        p.some((v) => Math.abs(v) + 0.006 > edge) ||
        buildings.some((b) => distanceTo(b, p) < 0.006)
      )
        continue;
      bench(s, p, u, y);
      benches.push(p);
    }
  }
  const paths = [
    ...roads,
    { points: lawnWalk, radius: 0.00135 },
    { points: bankWalk, radius: 0.002 },
  ];
  const planted = [];
  for (const park of [
    beach,
    ...parks.filter((p) => p !== beach).sort((a, b) => b.area - a.area),
  ]) {
    const bounds = boundsOf(park.roof.flat()),
      count = Math.max(1, Math.min(19, Math.ceil(park.area / 0.00078)));
    let added = 0;
    for (let i = 0; i < count * 80 && added < count; i++) {
      const p = bounds.map(([lo, hi]) => lo + (hi - lo) * random());
      const h = 0.018 + 0.016 * random(),
        r = h * 0.31;
      if (
        !contains(park.ring, p) ||
        p.some((v) => Math.abs(v) + r > edge) ||
        !clearPins(pins, p, r) ||
        buildings.some((b) => distanceTo(b, p) < r) ||
        [...benches, ...lamps].some((q) => dist(q, p) < r + 0.005) ||
        planted.some((q) => dist(q, p) < r + 0.009) ||
        paths.some((path) =>
          path.points.some(
            (q, j) =>
              j && segmentDistance(p, path.points[j - 1], q) < path.radius + r,
          ),
        )
      )
        continue;
      const colors = [
        ['#648253', '#89a264'],
        ['#78925b', '#a5b276'],
        ['#596f50', '#849a6a'],
      ][added % 3];
      tree(s, p, h, random() < 0.25, {
        canopy: colors[0],
        crown: colors[1],
        trunk: '#766247',
        pine: ['#4c6856', '#58775d', '#769069'],
      });
      added++;
      planted.push(p);
    }
  }
}

export function buildSegment(dir) {
  const ctx = prepareSegment(STOP_ID, {
    deckColor: '#bdb6a5',
    parkColors: ['#91a879', '#9faf80', '#8fa67d'],
    roadColors: { major: '#686867', minor: '#85817a', foot: '#c8beaa' },
  });
  const tower = ctx.rendered.find((b) =>
    b.name?.includes('Computing & Data Sciences'),
  );
  const parts = ctx.buildings.filter(
    (b) => b.id >= 1323777973 && b.id <= 1323777981,
  );
  dataSciences(ctx, tower, parts);
  for (const b of ctx.rendered) {
    if (b === tower || parts.includes(b)) continue;
    if (/^(Marshall|Fairfield|Shields) Tower$/.test(b.name)) warren(ctx, b);
    else if (b.name === 'Marsh Chapel') chapel(ctx, b);
    else campusBlock(ctx, b);
  }
  marshPlaza(ctx);
  const lamps = avenue(ctx),
    bankWalk = river(ctx);
  landscape(ctx, lamps, bankWalk);
  return finalizeSegment(ctx, dir, { maxTriangles: 32000 });
}
