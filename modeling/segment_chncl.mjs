import {
  ellipsoid,
  face,
  loft,
  mix,
  norm,
  rect,
  rod,
  sub,
} from './geometry.mjs';
import {
  contains,
  distanceTo,
  edge,
  finalizeSegment,
  polygon,
  prepareSegment,
  renderBuilding,
  segmentDistance,
  signedArea,
  simplify,
  to3,
  tree,
  turn,
} from './segment_base.mjs';

export const STOP_ID = 'place-chncl';

const crimson = '#9e2b2b',
  brass = '#cfa04b',
  jade = '#2f7a58',
  celadon = '#3e946c';
const limestone = '#d5c7ac',
  slate = '#646b70';
const bricks = [
  '#aa654f',
  '#b7805b',
  '#995a47',
  '#bc836c',
  '#ac7359',
  '#bd9877',
];
const towerStyles = {
  'State Street Financial Center': ['#aebcbb', '#c4c8bf', 0.047, 0.041, 0.04],
  'The Ritz-Carlton Residences': ['#c6bfaa', '#d8cfb6', 0.056, 0.029, 0.022],
  '100 Summer Street': ['#b98a6f', '#c4a28d', 0.041, 0.022, 0.021],
  '125 Summer Street': ['#cbac98', '#d0b9a1', 0.041, 0.022, 0.018],
  'AVA Theater District': ['#aab9b9', '#d6c8af', 0.043, 0.021, 0.016],
  'One Greenway': ['#b3c3bc', '#c5b5a0', 0.041, 0.017, 0.011],
};

// Road names are omitted from the local extract. These are its OSM way IDs.
const diningStreets = new Set([
  8643846,
  8649056,
  172093621,
  585959643,
  815957500,
  828329344,
  834835049, // Beach
  533473492,
  1185620974, // Tyler
  8645303,
  8647380,
  295875086,
  448441075,
  1089092081, // Harrison
  8651676,
  242632754,
  295875087,
  426492390,
  1323824615,
  1323824616,
  1323824617,
  1573509038, // Kneeland
]);

function frame([x, z], [dx, dz]) {
  return (u, y, v) => [x + dx * u - dz * v, y, z + dz * u + dx * v];
}

function block(s, at, u, y, v, width, height, depth, color, chamfer = 0) {
  const rings = [-1, 1].map((sign) =>
    rect(u, y + (sign * height) / 2, v, width, depth, chamfer).map((p) =>
      at(...p),
    ),
  );
  loft(s, rings, color, { bottom: false });
}

function clearOfPins(ctx, p, radius) {
  return ctx.pins.every((q) => Math.hypot(...sub(p, q)) >= 0.025 + radius);
}

// Sections of the glazed hip roofs have a concave sweep and rise at all four corners.
function tiledEaves(s, at, center, width, depth, y, rise) {
  const sections = 12;
  const profile = (i, side) => {
    const u = (i * 2) / sections - 1,
      tip = Math.abs(u) ** 3;
    const x = center + (u * width) / 2,
      d = depth / 2;
    const rim = y + rise * 0.44 * tip,
      crest = y + rise * (1 - 0.34 * tip);
    return [
      at(x, rim - 0.00037, side * d),
      at(x, rim, side * d),
      at(x, rim + rise * 0.15, side * d * 0.56),
      at(x, crest, 0),
    ];
  };
  for (const side of [-1, 1]) {
    for (let i = 0; i < sections; i++) {
      const a = profile(i, side),
        b = profile(i + 1, side);
      for (let j = 0; j < 3; j++) {
        const panel = [a[j], b[j], b[j + 1], a[j + 1]];
        face(
          s.paint,
          side > 0 ? panel : panel.reverse(),
          j === 0 ? brass : i % 3 ? jade : '#368461',
        );
      }
      if (i % 2 === 0) {
        const raised = (p) => [p[0], p[1] + 0.00006, p[2]];
        for (let j = 1; j < 3; j++) {
          const rib = [
            a[j],
            mix(a[j], b[j], 0.19),
            mix(a[j + 1], b[j + 1], 0.19),
            a[j + 1],
          ].map(raised);
          face(s.paint, side > 0 ? rib : rib.reverse(), '#56946c');
        }
      }
    }
  }
  for (const i of [0, sections]) {
    const sign = i ? 1 : -1,
      x = center + (sign * width) / 2;
    const peak = profile(i, 1)[3];
    const lip = at(x + sign * 0.00025, peak[1] + 0.00032, 0);
    rod(s.paint, peak, lip, 0.00022, celadon, 6);
    rod(
      s.paint,
      lip,
      at(x + sign * 0.0003, peak[1] + 0.00069, 0),
      0.00015,
      brass,
      5,
    );
    const a = profile(i, 1),
      b = profile(i, -1);
    const end = [a[0], a[1], a[2], a[3], b[2], b[1], b[0]];
    const sill = at(center + ((i ? 1 : -1) * width) / 2, a[0][1], 0);
    for (let j = 0; j < end.length - 1; j++) {
      const tri = [sill, end[j], end[j + 1]];
      face(s.city, i ? tri.reverse() : tri, jade);
    }
  }
  for (let i = 0; i < sections; i++) {
    const ridge = (j, v) =>
      at(
        center + (j / sections - 0.5) * width,
        profile(j, 1)[3][1] + 0.00009,
        v,
      );
    face(
      s.paint,
      [
        ridge(i, 0.00013),
        ridge(i + 1, 0.00013),
        ridge(i + 1, -0.00013),
        ridge(i, -0.00013),
      ],
      '#cab46f',
    );
  }
}

// Two 80 × 20 gilt inscriptions. Glyphs read right to left, 天下為公 and 禮義廉恥.
const inscriptions = [
  'AAAATAAAAAAAAAD8AMwAP//g//wADAD4AD//8P/8BgYAGAAw8ODnGAYGA//4AGAAAwAMBwP/+ABgAAMADAMAEBAAYAADABgDgDuwAGwABwAY4cA//ABuAf/+MODgMAwAZwH//nHAYDAIAGOAB4AhgAB//wBhwAeAAYQAYAcAYMAGgAMMAMgWAGAADMADDgDe/gBgABzgBgcBm94AYAAYcA5/A7NGAGAAeDgf/4MwDgBgAPAeH4GCADwAYAPADgABAAA8AGABgAA=',
  'AAAAAAAAAAAAAAAIAAIAAwYBgWB/jAADAAMMAYFgN44B//4//8DP/DIGAYxgAGAACWwyFgGMQABgB+/8MhgB//wf/4Pv/D4ZgYzMDGOASSw+2YG/+D//wM/8MtjBv/g//8GG2D7YwQSIH8kBz/4+2MH//j8Jh//+Mphhf/4/P8egADeYYQzYf//jr/w/mGN/+AYMgYwMfhgDHKA/z4GP/H4Zgzywfw8BgjACGYZsnAY/YYMwAh8GzI4Oc+G//gYAAgSADADBgAA=',
].map((data) => Buffer.from(data, 'base64'));

function inscription(s, at, side) {
  const mask = inscriptions[side > 0 ? 0 : 1];
  for (let row = 0; row < 20; row++) {
    let start = -1;
    for (let col = 0; col <= 80; col++) {
      const ink = col < 80 && mask[10 * row + (col >> 3)] & (128 >> (col % 8));
      if (ink && start === -1) start = col;
      if (ink || start === -1) continue;
      const point = (x, y) =>
        at(
          (x - 40) * 0.000069 * side,
          0.0179 + (10 - y) * 0.000088,
          side * 0.00122,
        );
      face(
        s,
        [
          point(start, row + 1),
          point(col, row + 1),
          point(col, row),
          point(start, row),
        ],
        brass,
      );
      start = -1;
    }
  }
}

function paifang(ctx, gate) {
  const { s } = ctx;
  const midpoint = gate.bounds.map(([lo, hi]) => (lo + hi) / 2);
  const at = frame(midpoint, norm([0.28, -0.96]));
  const stone = '#c6c1ac';
  for (const u of [-0.0091, -0.005, 0.005, 0.0091]) {
    const inner = Math.abs(u) < 0.006;
    const h = inner ? 0.021 : 0.0146;
    block(s.city, at, u, 0.0032, 0, 0.0021, 0.0017, 0.0023, stone, 0.00022);
    block(s.city, at, u, 0.0043, 0, 0.00165, 0.0007, 0.00185, limestone);
    rod(
      s.paint,
      at(u, 0.0045, 0),
      at(u, h, 0),
      inner ? 0.00066 : 0.00054,
      crimson,
      10,
    );
    for (const band of [0.005, h - 0.0027, h - 0.0014])
      rod(s.trim, at(u, band, 0), at(u, band + 0.00033, 0), 0.00074, brass, 8);
    for (const sign of [-1, 1]) {
      rod(
        s.paint,
        at(u, h - 0.0037, 0),
        at(u + sign * 0.0015, h - 0.0019, 0),
        0.00039,
        '#7b4740',
        6,
      );
      block(
        s.paint,
        at,
        u + sign * 0.0009,
        h - 0.0016,
        0,
        0.0015,
        0.0005,
        0.0017,
        celadon,
      );
    }
  }
  for (const [u, width, h] of [
    [-0.0075, 0.0063, 0.0146],
    [0.0075, 0.0063, 0.0146],
    [0, 0.012, 0.0208],
  ]) {
    block(s.paint, at, u, h - 0.0016, 0, width, 0.0026, 0.00165, crimson);
    for (const offset of [-0.0028, -0.00055])
      block(s.trim, at, u, h + offset, 0, width * 1.05, 0.00045, 0.002, brass);
    const central = u === 0;
    tiledEaves(
      s,
      at,
      u,
      width * 1.03,
      central ? 0.004 : 0.0044,
      h,
      central ? 0.0028 : 0.0019,
    );
  }
  block(s.paint, at, 0, 0.0233, 0, 0.0068, 0.0016, 0.00165, crimson);
  tiledEaves(s, at, 0, 0.009, 0.0034, 0.024, 0.0021);
  for (const side of [-1, 1]) {
    block(s.trim, at, 0, 0.0178, side * 0.00091, 0.0065, 0.0026, 0.0003, brass);
    block(
      s.paint,
      at,
      0,
      0.0178,
      side * 0.0011,
      0.006,
      0.00225,
      0.00015,
      '#233d37',
    );
    inscription(s.trim, at, side);
    const u = side * 0.0081,
      v = 0.0036;
    block(s.city, at, u, 0.00308, v, 0.0024, 0.00294, 0.003, limestone, 0.0002);
    block(s.city, at, u, 0.0047, v, 0.0027, 0.00055, 0.0032, stone);
    for (const [du, h, dv, a, b, c] of [
      [0, 0.0059, -0.00025, 0.00089, 0.0012, 0.00115],
      [0, 0.0074, 0.00036, 0.00102, 0.00104, 0.00095],
      [0, 0.0072, 0.00104, 0.00066, 0.00048, 0.00057],
      [-0.0005, 0.0054, 0.00084, 0.00037, 0.00057, 0.0005],
      [0.0005, 0.0054, 0.00084, 0.00037, 0.00057, 0.0005],
    ])
      ellipsoid(s.city, at(u + du, h, v + dv), [a, b, c], stone, 8, 4);
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 9;
      ellipsoid(
        s.city,
        at(
          u + 0.001 * Math.cos(a),
          0.0072 + 0.00105 * Math.sin(a),
          v + 0.00035,
        ),
        [0.00045, 0.00048, 0.00048],
        '#b1aa96',
        5,
        2,
      );
    }
    for (const sign of [-1, 1]) {
      ellipsoid(
        s.city,
        at(u + sign * 0.00069, 0.00805, v + 0.0003),
        [0.00036, 0.00042, 0.0003],
        limestone,
        6,
        3,
      );
      ellipsoid(
        s.city,
        at(u + sign * 0.00037, 0.00758, v + 0.00114),
        [0.00013, 0.00011, 0.00015],
        '#726c5e',
        6,
        3,
      );
    }
    ellipsoid(
      s.city,
      at(u, 0.00736, v + 0.00154),
      [0.0003, 0.00017, 0.00019],
      '#847e70',
      6,
      3,
    );
  }
}

// Clip convex tile or screen panels against the already exposed roof triangles.
function intersection(poly, boundary) {
  for (let i = 0; i < boundary.length && poly.length; i++) {
    const a = boundary[i],
      b = boundary[(i + 1) % boundary.length],
      piece = [];
    let prev = poly.at(-1),
      d0 = turn(a, b, prev);
    for (const p of poly) {
      const d1 = turn(a, b, p);
      if (d0 < 0 !== d1 < 0) piece.push(mix(prev, p, d0 / (d0 - d1)));
      if (d1 >= 0) piece.push(p);
      prev = p;
      d0 = d1;
    }
    poly = piece;
  }
  return poly;
}

function screenLocation(ctx, b, width, depth) {
  const longest = b.walls
    .filter(
      ([a, c]) =>
        !a.some(
          (n, i) =>
            Math.abs(Math.abs(n) - edge) < 1e-8 && Math.abs(n - c[i]) < 1e-8,
        ),
    )
    .sort(
      ([a, c], [d, e]) => Math.hypot(...sub(d, e)) - Math.hypot(...sub(a, c)),
    )[0];
  if (!longest) return;
  const axis = norm(sub(longest[1], longest[0]));
  const candidates = b.visibleRoof.map((tri) =>
    [0, 1].map((k) => tri.reduce((n, p) => n + p[k], 0) / 3),
  );
  for (let i = 1; i < 8; i++)
    for (let j = 1; j < 8; j++)
      candidates.push(
        b.bounds.map(([lo, hi], k) => lo + ((hi - lo) * (k ? j : i)) / 8),
      );
  for (const scale of [1, 0.83, 0.65, 0.48, 0.32]) {
    const w = width * scale,
      d = depth * scale;
    for (const center of candidates) {
      if (
        ctx.pins.some((p) => {
          const [dx, dz] = sub(p, center);
          const u = Math.abs(dx * axis[0] + dz * axis[1]);
          const v = Math.abs(dz * axis[0] - dx * axis[1]);
          return (
            Math.hypot(Math.max(0, u - w / 2), Math.max(0, v - d / 2)) < 0.0252
          );
        })
      )
        continue;
      const at = frame(center, axis);
      const footprint = rect(0, 0, 0, w, d).map((p) => {
        const [x, , z] = at(...p);
        return [x, z];
      });
      const coverage = b.visibleRoof.reduce(
        (n, tri) => n + signedArea(intersection(footprint, tri)),
        0,
      );
      if (coverage >= w * d - 1e-11) return { at, w, d };
    }
  }
}

function mechanicalCrown(ctx, b, style) {
  const mount = screenLocation(ctx, b, style[2], style[3]);
  if (!mount) return;
  const { s } = ctx,
    { at, w, d } = mount;
  const h = style[4] * Math.min(1, w / style[2] + 0.4);
  let bottom = b.height;
  const stepped = b.name === 'State Street Financial Center';
  const levels = stepped ? [1, 0.79, 0.54] : [1, 0.73];
  for (const [i, size] of levels.entries()) {
    const height = h / levels.length,
      width = w * size,
      depth = d * (1 - i * 0.21);
    const ring = (y, width, depth) =>
      rect(0, y, 0, width, depth, depth * 0.13).map((p) => at(...p));
    const lower = ring(bottom, width, depth);
    const shoulder = ring(bottom + height * 0.8, width, depth);
    const rim = ring(bottom + height * 0.96, width - depth * 0.1, depth * 0.9);
    loft(s.city, [lower, shoulder], i ? '#788582' : style[1], {
      bottom: false,
      top: false,
    });
    loft(s.city, [shoulder, rim], style[1], { bottom: false, top: false });
    loft(
      s.city,
      [rim, ring(bottom + height, width - depth * 0.1, depth * 0.9)],
      '#dbd7c8',
      { bottom: false },
    );
    for (const side of [-1, 1]) {
      const z = side * (depth / 2 + 0.00004);
      const panel = (x0, y0, x1, y1, color) => {
        const quad = [
          at(x0, y0, z),
          at(x1, y0, z),
          at(x1, y1, z),
          at(x0, y1, z),
        ];
        face(s.city, side > 0 ? quad : quad.reverse(), color);
      };
      for (let j = 0; j < 3; j++)
        panel(
          -width * 0.4,
          bottom + height * (0.22 + j * 0.2),
          width * 0.4,
          bottom + height * (0.29 + j * 0.2),
          '#545e5f',
        );
    }
    bottom += height;
  }
  if (stepped) {
    for (const sign of [-1, 1])
      rod(
        s.trim,
        at(sign * w * 0.18, bottom, 0),
        at(sign * w * 0.18, bottom + h * 0.27, 0),
        0.00045,
        '#aaa99b',
        7,
      );
  }
}

function storefronts(ctx, b, streets) {
  for (const [a, c, base] of b.visibleWalls) {
    const length = Math.hypot(...sub(c, a));
    if (base > 0.003 || length < 0.009) continue;
    const mid = mix(a, c, 0.5),
      axis = norm(sub(c, a)),
      at = frame(mid, axis);
    const outward = at(0, 0, -0.004),
      outside = [outward[0], outward[2]];
    const street = streets.some(({ points, radius }) =>
      points.some((q, j) => {
        if (!j || segmentDistance(outside, points[j - 1], q) > radius + 0.006)
          return false;
        const dir = norm(sub(q, points[j - 1]));
        return (
          Math.abs(dir[0] * axis[0] + dir[1] * axis[1]) > 0.83 &&
          turn(a, c, mix(q, points[j - 1], 0.5)) < 0
        );
      }),
    );
    if (!street) continue;
    const n = Math.max(1, Math.floor(length / 0.012)),
      bay = length / n;
    for (let i = 0; i < n; i++) {
      const u = -length / 2 + (i + 0.5) * bay,
        w = Math.min(bay * 0.86, 0.016);
      const [x, , z] = at(u, 0, -0.0013),
        p = [x, z],
        radius = Math.hypot(w / 2, 0.0017);
      if (
        !clearOfPins(ctx, p, radius) ||
        p.some((v) => Math.abs(v) + radius > edge) ||
        ctx.buildings.some(
          (other) => other !== b && distanceTo(other, p) < 0.0013,
        )
      )
        continue;
      const h = Math.min(0.011, b.height * 0.49),
        y = 0.0026;
      const fabric = [crimson, '#396e57', '#be9751', '#913d34'][(i + b.id) % 4];
      const front = (surface, left, right, lo, hi, v, color) =>
        face(
          surface,
          [
            at(left, lo, v),
            at(left, hi, v),
            at(right, hi, v),
            at(right, lo, v),
          ],
          color,
        );
      front(ctx.s.window, u - w / 2, u + w / 2, y, h, -0.00022, '#4d625d');
      front(
        ctx.s.city,
        u - w * 0.52,
        u + w * 0.52,
        h,
        h + 0.0014,
        -0.00028,
        limestone,
      );
      front(
        ctx.s.paint,
        u + w * 0.19,
        u + w * 0.19 + 0.00045,
        y,
        h,
        -0.00031,
        limestone,
      );
      const canopy = (t) => at(u + t * w, h - 0.0011, -0.0025);
      face(
        ctx.s.paint,
        [
          at(u - w / 2, h, -0.0002),
          at(u + w / 2, h, -0.0002),
          canopy(0.5),
          canopy(-0.5),
        ],
        fabric,
      );
      front(
        ctx.s.paint,
        u - w / 2,
        u + w / 2,
        h - 0.00195,
        h - 0.0011,
        -0.0025,
        fabric,
      );
    }
  }
}

function spandrels(ctx, b) {
  const { s } = ctx;
  for (const [a, c, base] of b.visibleWalls) {
    const length = Math.hypot(...sub(a, c));
    if (
      length < 0.009 ||
      a.some(
        (v, k) =>
          Math.abs(Math.abs(v) - edge) < 1e-8 && Math.abs(v - c[k]) < 1e-8,
      )
    )
      continue;
    const axis = norm(sub(c, a)),
      at = frame(mix(a, c, 0.5), axis);
    if (ctx.pins.some((p) => segmentDistance(p, a, c) < 0.0252)) continue;
    const panel = (u0, lo, u1, hi, col) => {
      const points = [
        [u0, lo],
        [u0, hi],
        [u1, hi],
        [u1, lo],
      ].map(([u, y]) => at(u, y, -0.00009));
      if (
        points.every(([x, , z]) => Math.max(Math.abs(x), Math.abs(z)) <= edge)
      )
        face(s.city, points, col);
    };
    const pitch = b.name === 'State Street Financial Center' ? 0.014 : 0.021;
    for (let y = b.height - 0.006, i = 0; y > base; y -= pitch, i++)
      panel(
        -length * 0.498,
        y,
        length * 0.498,
        y + (i % 4 ? 0.0007 : 0.0017),
        i % 4 ? '#a9a9a0' : limestone,
      );
    const bays = Math.ceil(length / 0.012);
    for (let i = 0; i < bays; i++) {
      const u = length * ((i + 0.5) / bays - 0.5);
      panel(u - 0.00038, base, u + 0.00038, b.height - 0.002, '#c9c5b6');
    }
  }
}

function winthropCorner(ctx) {
  // Only 0.16 square metre of the western podium corner falls inside the crop.
  const raw = ctx.area.buildings.find((b) => b.name === 'Winthrop Center');
  const podium = polygon(raw, ctx.scale, 0.00036);
  if (!podium) return;
  const [[tip, a, b]] = podium.roof.map((tri) =>
    [...tri].sort((u, v) => u[0] - v[0]),
  );
  const top = (p) => 0.046 + (p[0] - tip[0]) * 9;
  for (const [u, v] of podium.walls) {
    const quad = (lo, h0, h1) => [
      to3(u, lo),
      to3(u, h0),
      to3(v, h1),
      to3(v, lo),
    ];
    let y = 0.00255;
    for (let i = 0; i < 5; i++) {
      const h = 0.008 + i * 0.008;
      face(ctx.s.window, quad(y, h, h), '#556f70');
      face(ctx.s.trim, quad(h, h + 0.0009, h + 0.0009), '#bab5a3');
      y = h + 0.0009;
    }
    face(ctx.s.window, quad(y, top(u), top(v)), '#678280');
  }
  const roof = [tip, a, b];
  if (signedArea(roof) > 0) roof.reverse();
  face(
    ctx.s.city,
    roof.map((p) => to3(p, top(p))),
    '#b4b8ac',
  );
}

function paving(ctx, park) {
  const at = frame([0, 0], norm([0.958, 0.286]));
  const local = ([x, z]) =>
    [x * 0.958 + z * 0.286, -x * 0.286 + z * 0.958].map(
      (v) => v / Math.hypot(0.958, 0.286),
    );
  const colors = ['#cbb69b', '#d8c9b0', '#c5b59e', '#cebaa2', '#d6c4ac'];
  for (const tri of park.visibleRoof) {
    const poly = tri.map(local);
    const range = (k) => [
      Math.min(...poly.map((p) => p[k])),
      Math.max(...poly.map((p) => p[k])),
    ];
    const [z0, z1] = range(1),
      [x0, x1] = range(0);
    const w = 0.018,
      d = 0.01,
      joint = 0.00032;
    for (let row = Math.floor(z0 / d); row <= Math.floor(z1 / d); row++) {
      const offset = ((row % 2) * w) / 2;
      for (
        let col = Math.floor((x0 - offset) / w);
        col <= Math.floor((x1 - offset) / w);
        col++
      ) {
        const x = col * w + offset,
          z = row * d;
        const tile = [
          [x + joint, z + joint],
          [x + w, z + joint],
          [x + w, z + d],
          [x + joint, z + d],
        ];
        const patch = simplify(intersection(poly, tile), 1e-8, true);
        if (signedArea(patch) < 1e-10) continue;
        const color = colors[Math.abs(row * 3 + col * 7) % colors.length];
        face(
          ctx.s.city,
          patch.reverse().map(([u, v]) => at(u, 0.00166, v)),
          color,
        );
      }
    }
  }
}

function parkSpace(ctx, park, p, radius, reserved) {
  return (
    contains(park.ring, p) &&
    p.every((v) => Math.abs(v) + radius <= edge) &&
    clearOfPins(ctx, p, radius) &&
    park.walls.every(([a, b]) => segmentDistance(p, a, b) > radius) &&
    ctx.buildings.every((b) => distanceTo(b, p) > radius) &&
    reserved.every((q) => Math.hypot(...sub(q.p, p)) > q.radius + radius) &&
    ctx.roads.every((r) =>
      r.points.every(
        (q, i) =>
          !i || segmentDistance(p, q, r.points[i - 1]) > r.radius + radius,
      ),
    )
  );
}

function pergola(ctx, at) {
  const { s } = ctx;
  for (const u of [-0.0054, 0.0054])
    for (const v of [-0.0027, 0.0027]) {
      block(s.city, at, u, 0.0025, v, 0.0018, 0.0016, 0.0018, limestone);
      block(s.paint, at, u, 0.0084, v, 0.00095, 0.0105, 0.00095, crimson);
    }
  for (const v of [-0.0027, 0.0027])
    block(s.paint, at, 0, 0.014, v, 0.014, 0.0011, 0.0008, crimson);
  for (let i = -4; i <= 4; i++)
    block(
      s.city,
      at,
      i * 0.0016,
      0.015,
      0,
      0.00072,
      0.00085,
      0.0083,
      '#b59167',
    );
  block(s.city, at, 0, 0.0041, 0.0017, 0.0087, 0.001, 0.0014, limestone);
}

function bamboo(ctx, p, h) {
  const { s } = ctx;
  for (let i = 0; i < 5; i++) {
    const a = i * 2.4,
      dx = Math.cos(a),
      dz = Math.sin(a);
    const point = (r, y) => [p[0] + dx * r, y, p[1] + dz * r];
    const tall = h * (0.74 + i * 0.065);
    rod(
      s.city,
      point(0.0006, 0.0016),
      point(0.0026, tall),
      0.00024,
      '#aca466',
      5,
    );
    for (let j = 0; j < 3; j++) {
      const stem = point(0.0018 + j * 0.00036, tall * (0.57 + j * 0.15));
      const perp = Math.sin(a + j) * 0.0011;
      const l = [
        stem[0] + dx * 0.0021 - dz * perp,
        stem[1] + 0.001,
        stem[2] + dz * 0.0021 + dx * perp,
      ];
      const tip = [
        stem[0] + dx * 0.0041,
        stem[1] + 0.0036,
        stem[2] + dz * 0.0041,
      ];
      const ridge = [l[0] + 0.0006 * dz, l[1] + 0.0008, l[2] - 0.0006 * dx];
      face(s.city, [stem, l, tip], '#66824c');
      face(s.city, [stem, tip, ridge], '#89a367');
    }
  }
}

function landscape(ctx) {
  const reserved = [];
  const named =
    /Mary Soo Hoo|Uncle Frank Chin|Phillips Square|Leather District/;
  const parks = ctx.exposedParks.toSorted(
    (a, b) => Number(named.test(b.name)) - Number(named.test(a.name)),
  );
  for (const park of parks.filter((p) => named.test(p.name))) paving(ctx, park);
  const chin = parks.find((p) => /Uncle Frank Chin/.test(p.name));
  const candidate = (park) =>
    park.bounds.map(([lo, hi]) => lo + ctx.random() * (hi - lo));
  const p = [0.22109, 0.10624],
    radius = 0.0074;
  if (parkSpace(ctx, chin, p, radius, reserved)) {
    const at = frame(p, norm([0.56, -0.83]));
    pergola(ctx, (u, y, v) => at(u * 0.87, y, v * 0.87));
    reserved.push({ p, radius });
  }
  const canopy = ['#718859', '#697e50', '#82935e', '#607b5b'];
  const crowns = ['#9aa974', '#899c66', '#a4ad77', '#8b9b71'];
  for (const park of parks) {
    const greenway = /Mary Soo Hoo|Uncle Frank Chin/.test(park.name);
    const wanted = Math.min(greenway ? 17 : 5, Math.ceil(park.area / 0.00039));
    let count = 0;
    for (let i = 0; i < wanted * 65 && count < wanted; i++) {
      const p = candidate(park),
        h = 0.014 + ctx.random() * 0.012;
      const grass = greenway && count % 3 === 0,
        radius = grass ? 0.0069 : h * 0.33;
      if (!parkSpace(ctx, park, p, radius, reserved)) continue;
      const k = count % canopy.length;
      if (grass) bamboo(ctx, p, h * 0.7);
      else
        tree(ctx.s, p, h, false, {
          canopy: canopy[k],
          crown: crowns[k],
          trunk: '#78624a',
        });
      count++;
      reserved.push({ p, radius });
    }
  }
}

export function buildSegment(dir) {
  const ctx = prepareSegment(STOP_ID, {
    deckColor: '#b7b0a1',
    parkColors: ['#9ea388', '#a2aa87', '#9da589'],
    roadColors: { major: '#666766', minor: '#878681', foot: '#c5bca7' },
  });
  const { s } = ctx;
  const streets = ctx.roads.filter((_, i) =>
    diningStreets.has(ctx.area.roads[i].id),
  );
  const heights = new Map(
    ctx.buildings.map((b) => [b.height, 0.00255 + b.heightM * 0.0027]),
  );
  for (const b of ctx.rendered) {
    b.height = heights.get(b.height);
    for (const wall of b.visibleWalls)
      wall[2] = heights.get(wall[2]) ?? wall[2];
    if (b.name === 'China Trade Gate') {
      paifang(ctx, b);
      continue;
    }
    const style = towerStyles[b.name];
    const brick = b.heightM < 28;
    renderBuilding(s, b, ctx.detailed.has(b), ctx.pins, {
      pitched: false,
      penthouse: false,
      finish: style?.[0] ?? (brick ? bricks[b.id % bricks.length] : undefined),
      cornice: style?.[1] ?? limestone,
      roofColor: brick
        ? ['#aaa49a', '#938e82', '#bab2a0', '#928c85'][b.id % 4]
        : '#a3a398',
    });
    if (style) {
      mechanicalCrown(ctx, b, style);
      spandrels(ctx, b);
    } else if (
      b.area > 0.00095 &&
      b.visibleRoof.length &&
      (b.heightM > 55 || b.id % 4 === 0)
    ) {
      const mount = screenLocation(ctx, b, 0.0095, 0.0052);
      if (mount) {
        const { at, w, d } = mount;
        block(s.city, at, 0, b.height + 0.0016, 0, w, 0.0032, d, slate);
        block(s.city, at, 0, b.height + 0.0035, 0, w, 0.0006, d, '#bbb8ac');
        for (const u of [-w * 0.24, w * 0.24])
          block(
            s.city,
            at,
            u,
            b.height + 0.004,
            0,
            w * 0.28,
            0.00045,
            d * 0.68,
            '#737c77',
          );
      }
    }
    if (brick) storefronts(ctx, b, streets);
  }
  winthropCorner(ctx);
  landscape(ctx);
  return finalizeSegment(ctx, dir, { maxTriangles: 32000 });
}
