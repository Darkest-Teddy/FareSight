import {
  boundsOf,
  contains,
  distanceTo,
  edge,
  exposedShells,
  finalizeSegment,
  prepareSegment,
  projectLatLon,
  renderBuilding,
  segmentDistance,
  signedArea,
  overlaps,
  street,
  simplify,
  to3,
} from './segment_base.mjs';
import {
  circle,
  dot,
  face,
  loft,
  mix,
  norm,
  rod,
  sub,
  TAU,
} from './geometry.mjs';

export const STOP_ID = 'place-harsq';

const limestone = '#e4d7b9',
  ivory = '#efe8d6',
  slate = '#46505a';
const brick = ['#a4513f', '#984c40', '#af6049', '#a45a4a'];
const yardHall =
  /^(Thayer|Grays|Hollis|Greenough|Ridgely|Gore|Holworthy|Stoughton|Massachusetts|Mower|Lionel|Harvard|Wigglesworth|Matthews|Weld|Straus) Hall|^Apley Court$/;

function frame(origin, direction) {
  const u = norm(direction),
    v = [-u[1], u[0]];
  return {
    point: (x, z) => [
      origin[0] + x * u[0] + z * v[0],
      origin[1] + x * u[1] + z * v[1],
    ],
    local: (p) => [dot(sub(p, origin), u), dot(sub(p, origin), v)],
  };
}

function roofFrame(b, axis) {
  const points = b.roof.flat();
  let best,
    area = Infinity;
  const axes = axis ? [axis] : b.walls.map(([a, e]) => sub(e, a));
  for (const direction of axes) {
    const f = frame([0, 0], direction);
    const [[x0, x1], [z0, z1]] = boundsOf(points.map(f.local));
    if ((x1 - x0) * (z1 - z0) >= area) continue;
    area = (x1 - x0) * (z1 - z0);
    const long = x1 - x0 >= z1 - z0 || axis;
    best = {
      ...frame(
        f.point((x1 + x0) / 2, (z1 + z0) / 2),
        long ? direction : [-direction[1], direction[0]],
      ),
      w: long ? x1 - x0 : z1 - z0,
      d: long ? z1 - z0 : x1 - x0,
    };
  }
  return best;
}

function corners(f, x, z, w, d) {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([i, j]) => f.point(x + (i * w) / 2, z + (j * d) / 2));
}

function tier(s, ring, y0, y1, color, taper = 1) {
  const [x, z] = ring.reduce(
    ([x, z], p) => [x + p[0] / ring.length, z + p[1] / ring.length],
    [0, 0],
  );
  const upper = ring.map((p) => mix([x, z], p, taper));
  loft(s, [ring.map((p) => to3(p, y0)), upper.map((p) => to3(p, y1))], color, {
    bottom: false,
  });
}

function block(s, f, x, z, w, d, y0, y1, color) {
  tier(s, corners(f, x, z, w, d), y0, y1, color);
}

function pointRoof(s, ring, y0, peak, color) {
  for (let i = 0; i < ring.length; i++)
    face(
      s,
      [to3(ring[i], y0), peak, to3(ring[(i + 1) % ring.length], y0)],
      color,
    );
}

// Slice the exposed OSM roof triangles along each ridge, hip, or clerestory break.
function halfPlane(points, signed) {
  const result = [];
  let a = points.at(-1),
    da = signed(a);
  for (const b of points) {
    const db = signed(b);
    if (da < 0 !== db < 0) result.push(mix(a, b, da / (da - db)));
    if (db >= 0) result.push(b);
    a = b;
    da = db;
  }
  return result;
}

function panelRoof(s, b, f, panels) {
  for (const { height, cuts, color, gable = slate } of panels) {
    for (const tri of b.visibleRoof) {
      let p = tri.map(f.local);
      for (const cut of cuts) {
        p = halfPlane(p, cut);
        if (!p.length) break;
      }
      p = simplify(p, 1e-8, true);
      if (p.length < 3 || signedArea(p) < 1e-11) continue;
      face(
        s.city,
        p.reverse().map((q) => to3(f.point(...q), b.height + height(q))),
        color,
      );
    }
    for (const [a, e] of b.visibleWalls) {
      let p = f.local(a),
        q = f.local(e),
        gone = false;
      for (const cut of cuts) {
        const d = cut(p),
          h = cut(q);
        if (d < 0 && h < 0) {
          gone = true;
          break;
        }
        if (d < 0 !== h < 0) {
          const k = mix(p, q, d / (d - h));
          if (d < 0) p = k;
          else q = k;
        }
      }
      if (gone || Math.hypot(...sub(p, q)) < 1e-7) continue;
      const h0 = height(p),
        h1 = height(q),
        l = to3(f.point(...p), b.height),
        r = to3(f.point(...q), b.height);
      const l1 = to3(f.point(...p), b.height + h0),
        r1 = to3(f.point(...q), b.height + h1);
      if (h0 > 1e-7) face(s.city, [l, l1, r1], gable);
      if (h1 > 1e-7) face(s.city, [l, r1, r], gable);
    }
  }
}

function bandRoof(s, b, f, rows) {
  const panels = rows.slice(1).map(([end, h, color], i) => {
    const [start, h0] = rows[i];
    return {
      cuts: [(p) => p[1] - start, (p) => end - p[1]],
      height: (p) => h0 + ((h - h0) * (p[1] - start)) / (end - start),
      color,
    };
  });
  panelRoof(s, b, f, panels);
}

function clearPins(ctx, p, radius) {
  return ctx.pins.every((q) => Math.hypot(...sub(p, q)) >= 0.025 + radius);
}

function walls(ctx, b, color, cornice = limestone) {
  renderBuilding(ctx.s, { ...b, visibleRoof: [] }, true, ctx.pins, {
    finish: color,
    cornice,
    tower: false,
    pitched: false,
  });
}

function georgian(ctx, b) {
  const { s } = ctx,
    f = roofFrame(b),
    color = brick[b.id % brick.length];
  walls(ctx, b, color);
  const rise = Math.min(0.014, f.d * 0.4);
  const heightFns = [
    ([, z]) => rise * (1 + (2 * z) / f.d),
    ([, z]) => rise * (1 - (2 * z) / f.d),
    ([x]) => (f.w / 2 + x) * 0.86,
    ([x]) => (f.w / 2 - x) * 0.86,
  ];
  panelRoof(
    s,
    b,
    f,
    heightFns.map((h, i) => ({
      height: h,
      cuts: heightFns
        .filter((other) => other !== h)
        .map((other) => (p) => other(p) - h(p)),
      color: ['#555762', '#454d56', '#57585c', '#57565a'][i],
      gable: color,
    })),
  );
  for (const [a, e, base] of b.visibleWalls) {
    if (base > 0.004 || Math.hypot(...sub(e, a)) < 0.005) continue;
    const n = norm(sub(e, a)),
      offset = [n[1] * 0.000055, -n[0] * 0.000055];
    const moved = (p) =>
      p.map((c, i) => Math.max(-edge, Math.min(edge, c + offset[i])));
    const start = moved(a),
      end = moved(e);
    face(
      s.city,
      [
        to3(start, 0.007),
        to3(start, 0.0083),
        to3(end, 0.0083),
        to3(end, 0.007),
      ],
      '#cdbfa6',
    );
  }
  for (const sign of [-1, 1]) {
    const x = sign * f.w * 0.32,
      z = -f.d * 0.13,
      p = f.point(x, z);
    const size = Math.min(0.0034, f.d * 0.2);
    if (
      !clearPins(ctx, p, size) ||
      !contains(b.ring, p) ||
      b.walls.some(([a, e]) => segmentDistance(p, a, e) < size) ||
      !b.visibleRoof.some((tri) => contains(tri, p))
    )
      continue;
    const y = b.height + Math.min(...heightFns.map((h) => h([x, z])));
    block(s.city, f, x, z, size, size * 0.77, y - size, y + 0.0038, '#984b3a');
    block(
      s.city,
      f,
      x,
      z,
      size * 1.15,
      size * 0.9,
      y + 0.0038,
      y + 0.005,
      '#b77959',
    );
  }
}

// Lancets use inset color fields and a projecting sandstone archivolt at this scale.
function gothicWalls(s, b, tower = false) {
  for (const [a, e, base] of b.visibleWalls) {
    const length = Math.hypot(...sub(e, a)),
      f = frame(a, sub(e, a));
    const p = (x, y, offset = 0) => to3(f.point(x, -offset), y);
    const band = (lo, hi, color) =>
      face(s.city, [p(0, lo), p(0, hi), p(length, hi), p(length, lo)], color);
    const divisions = tower
      ? [base, 0.107, 0.111, 0.139, 0.142, 0.194, b.height]
      : [base, 0.019, 0.022, 0.03, 0.032, b.height - 0.003, b.height];
    const tints = [
      '#ac6048',
      '#cda781',
      '#a65440',
      '#ceb08a',
      '#a6513c',
      '#d4ab81',
    ];
    for (let i = 1; i < divisions.length; i++)
      if (divisions[i] > Math.max(base, divisions[i - 1]))
        band(Math.max(base, divisions[i - 1]), divisions[i], tints[i - 1]);
    if (length < 0.005) continue;
    const bays = tower ? 2 : Math.max(1, Math.round(length / 0.009));
    const width = Math.min((length / bays) * 0.73, 0.007);
    for (let i = 0; i < bays; i++) {
      const cx = (length * (i + 0.5)) / bays;
      const lancet = (w, lo, hi, color, offset) => {
        const shoulder = hi - Math.min(0.008, w * 1.35);
        const outline = [
          [-w / 2, lo],
          [-w / 2, shoulder],
          [-w * 0.37, shoulder + (hi - shoulder) * 0.49],
          [0, hi],
          [w * 0.37, shoulder + (hi - shoulder) * 0.49],
          [w / 2, shoulder],
          [w / 2, lo],
        ];
        face(
          s.city,
          outline.map(([x, y]) => p(cx + x, y, offset)),
          color,
        );
      };
      for (const [lo, hi] of tower
        ? [
            [0.114, 0.135],
            [0.146, 0.191],
          ]
        : [[0.034, 0.07]]) {
        if (base > lo) continue;
        lancet(width, lo, hi, '#d3ae86', 0.00007);
        lancet(width * 0.75, lo + 0.0012, hi - 0.0019, '#495553', 0.00012);
        const mullion = width * 0.064;
        face(
          s.city,
          [
            p(cx - mullion, lo + 0.0012, 0.00017),
            p(cx - mullion, hi - 0.004, 0.00017),
            p(cx + mullion, hi - 0.004, 0.00017),
            p(cx + mullion, lo + 0.0012, 0.00017),
          ],
          '#b48f76',
        );
      }
    }
  }
}

function memorialHall(ctx, b) {
  const { s } = ctx,
    f = roofFrame(b, [1, 0.16]);
  gothicWalls(s, b);
  // The dining hall ridge runs through the transept. The north service wing has a lower lean-to.
  const row = [
    [-0.51, 0],
    [-0.25, 0.003],
    [-0.18, 0.003],
    [-0.08, 0.016],
    [0, 0.026],
    [0.04, 0.03],
    [0.09, 0.024],
    [0.11, 0.0216],
    [0.135, 0.0186],
    [0.16, 0.0156],
    [0.18, 0.0132],
    [0.29, 0.001],
    [0.51, 0],
  ];
  const tints = [
    '',
    '#555564',
    '#77766e',
    '#4e545d',
    '#555c62',
    '#8b6858',
    '#49505a',
    '#bc8d62',
    '#55525a',
    '#b46f50',
    '#66616a',
    '#4e535c',
    '#62646a',
  ];
  bandRoof(
    s,
    b,
    f,
    row.map(([z, h], i) => [z * f.d, h, tints[i]]),
  );
  // Lozenge tiles on the continuous nave slope, always within its exposed roof.
  for (let x = -f.w / 2 + 0.004; x < f.w / 2; x += 0.0055) {
    const z = 0.227 * f.d;
    const tile = [
      [x - 0.0017, z],
      [x, z - 0.0012],
      [x + 0.0017, z],
      [x, z + 0.0012],
    ];
    if (
      !tile.every((q) =>
        b.visibleRoof.some((tri) => contains(tri, f.point(...q))),
      )
    )
      continue;
    face(
      s.city,
      tile
        .reverse()
        .map(([u, v]) =>
          to3(
            f.point(u, v),
            b.height +
              0.00012 +
              0.0132 +
              ((v / f.d - 0.18) * (0.001 - 0.0132)) / 0.11,
          ),
        ),
      '#bc956c',
    );
  }
}

function clockTower(ctx, b) {
  const { s } = ctx,
    f = roofFrame(b, sub(b.ring[1], b.ring[0])),
    ring = b.ring;
  const at = (scale) => corners(f, 0, 0, f.w * scale, f.d * scale);
  gothicWalls(s, b, true);
  tier(s.city, ring, b.height, 0.208, '#b97658', 0.97);
  tier(s.city, at(0.95), 0.208, 0.224, '#74443c');
  tier(s.city, at(0.98), 0.224, 0.227, '#e1c39a', 0.92);
  tier(s.city, at(0.91), 0.227, 0.242, '#9c5040');
  for (const [i, a] of at(0.95).entries()) {
    const e = at(0.95)[(i + 1) % 4],
      mid = mix(a, e, 0.5),
      tangent = norm(sub(e, a));
    const dial = Array.from({ length: 16 }, (_, j) => {
      const angle = (j * TAU) / 16,
        radius = 0.0046;
      return [
        mid[0] + radius * tangent[0] * Math.cos(angle),
        0.216 + radius * Math.sin(angle),
        mid[1] + radius * tangent[1] * Math.cos(angle),
      ];
    });
    // This disk faces outward along the clockwise masonry elevation.
    const outward = [tangent[1], -tangent[0]];
    const pos = (u, y, offset) => [
      mid[0] + u * tangent[0] + outward[0] * offset,
      y,
      mid[1] + u * tangent[1] + outward[1] * offset,
    ];
    face(
      s.city,
      dial
        .reverse()
        .map(([x, y, z]) => [
          x + outward[0] * 0.00008,
          y,
          z + outward[1] * 0.00008,
        ]),
      ivory,
    );
    for (const [u, dy] of [
      [-0.0024, 0.0014],
      [0.0005, 0.0034],
    ])
      face(
        s.city,
        [
          pos(-0.0004, 0.2158, 0.00015),
          pos(u, 0.216 + dy, 0.00015),
          pos(0.0004, 0.216, 0.00015),
        ],
        '#493f3a',
      );
    const p = mix(f.point(0, 0), a, 0.83),
      pin = frame(p, tangent);
    const small = corners(pin, 0, 0, 0.0022, 0.0022);
    tier(s.city, small, 0.237, 0.257, limestone);
    pointRoof(s.city, small, 0.257, to3(p, 0.272), '#4e565c');
  }
  tier(s.city, at(0.91), 0.242, 0.259, '#59616a', 0.78);
  tier(s.city, at(0.71), 0.259, 0.261, '#b58963', 0.98);
  pointRoof(s.city, at(0.7), 0.261, to3(f.point(0, 0), 0.306), '#414b53');
}

function widener(ctx, b) {
  const { s } = ctx;
  // The long, north-facing wall between the two entrance piers opens onto the Yard.
  const [a, e] = b.walls
    .filter(([a, e]) => e[0] - a[0] > 0.035 && (a[1] + e[1]) / 2 < 0)
    .at(0);
  const f = frame(mix(a, e, 0.5), sub(e, a)),
    w = Math.hypot(...sub(e, a)),
    d = 0.011;
  const backA = f.point(-w / 2, d),
    backB = f.point(w / 2, d);
  const visibleWalls = b.visibleWalls.flatMap(([p, q, y]) =>
    segmentDistance(p, a, e) < 1e-8 && segmentDistance(q, a, e) < 1e-8
      ? [
          [p, backA, y],
          [backA, backB, y],
          [backB, q, y],
        ]
      : [[p, q, y]],
  );
  renderBuilding(s, { ...b, visibleWalls }, true, ctx.pins, {
    finish: '#ad765e',
    cornice: limestone,
    roofColor: '#88827a',
    pitched: false,
    tower: false,
  });
  for (let i = 0; i < 6; i++)
    block(
      s.city,
      f,
      0,
      (i + 1) * 0.00075 + (d - (i + 1) * 0.00075) / 2,
      w * 0.99,
      d - (i + 1) * 0.00075,
      0.00255 + i * 0.0012,
      0.00375 + i * 0.0012,
      '#d5c8b3',
    );
  for (let i = 0; i < 10; i++) {
    const x = w * (i / 9 - 0.5) * 0.9,
      z = 0.0068,
      p = f.point(x, z);
    block(s.city, f, x, z, 0.0035, 0.0035, 0.00975, 0.012, limestone);
    tier(
      s.city,
      circle(p[0], 0, p[1], 0.00142, 10).map(([x, , z]) => [x, z]),
      0.012,
      b.height - 0.006,
      ivory,
      0.84,
    );
    block(
      s.city,
      f,
      x,
      z,
      0.0037,
      0.0037,
      b.height - 0.006,
      b.height - 0.0042,
      limestone,
    );
  }
  block(
    s.city,
    f,
    0,
    d / 2,
    w,
    d,
    b.height - 0.0042,
    b.height - 0.00012,
    limestone,
  );
  for (const x of [-0.018, 0.018]) {
    const z = 0.051,
      span = 0.012,
      run = 0.042;
    const curb = corners(f, x, z, span, run);
    tier(s.city, curb, b.height, b.height + 0.0015, '#a7a091');
    const pane = (u, v) =>
      to3(
        f.point(x + u, z + v),
        b.height + 0.0015 + 0.003 * (1 - Math.abs(u) / (span / 2)),
      );
    for (let i = 0; i < 8; i++)
      for (const side of [-1, 1]) {
        const lo = run * (i / 8 - 0.5),
          hi = lo + run / 8;
        const facet = (v0, v1, color) => {
          const quad = [
            pane(0, v0),
            pane(0, v1),
            pane((side * span) / 2, v1),
            pane((side * span) / 2, v0),
          ];
          face(s.city, side > 0 ? quad : quad.reverse(), color);
        };
        facet(lo, hi - 0.0006, side < 0 ? '#849494' : '#69868c');
        facet(hi - 0.0006, hi, '#b0b3a9');
      }
  }
}

function memorialChurch(ctx, b) {
  const { s } = ctx,
    f = roofFrame(b, [1, 0.23]);
  walls(ctx, b, '#a65c49', ivory);
  bandRoof(s, b, f, [
    [-f.d * 0.51, 0],
    [0, 0.013, slate],
    [f.d * 0.51, 0, '#565b60'],
  ]);
  const x = -f.w * 0.28,
    z = 0,
    p = f.point(x, z);
  const square = (w, d = w) => corners(f, x, z, w, d);
  tier(s.city, square(0.0165), b.height, 0.075, '#ba7358');
  tier(s.city, square(0.0168), 0.075, 0.078, ivory, 0.94);
  tier(s.city, square(0.015), 0.078, 0.102, ivory);
  const elevations = square(0.015);
  elevations.forEach((a, i) => {
    const e = elevations[(i + 1) % 4],
      tangent = norm(sub(e, a)),
      normal = [tangent[1], -tangent[0]],
      center = mix(a, e, 0.5);
    const v = (u, y, depth = 0.00008) => [
      center[0] + tangent[0] * u + normal[0] * depth,
      y,
      center[1] + tangent[1] * u + normal[1] * depth,
    ];
    const arch = [v(-0.004, 0.082), v(-0.004, 0.092)];
    for (let j = 1; j <= 8; j++)
      arch.push(
        v(
          -0.004 * Math.cos((Math.PI * j) / 8),
          0.092 + 0.004 * Math.sin((Math.PI * j) / 8),
        ),
      );
    arch.push(v(0.004, 0.082));
    face(s.city, arch, '#515953');
    for (let j = 0; j < 5; j++) {
      const y = 0.083 + j * 0.002;
      face(
        s.city,
        [
          v(-0.0036, y, 0.00015),
          v(-0.0036, y + 0.0007, 0.00015),
          v(0.0036, y + 0.0007, 0.00015),
          v(0.0036, y, 0.00015),
        ],
        '#c6c3ad',
      );
    }
  });
  tier(s.city, square(0.0165), 0.102, 0.105, ivory, 0.9);
  const drum = (r) => circle(p[0], 0, p[1], r, 8).map(([x, , z]) => [x, z]);
  tier(s.city, drum(0.0071), 0.105, 0.113, '#e6ddcb', 0.85);
  tier(s.city, drum(0.0064), 0.113, 0.115, '#cbc8b7');
  tier(s.city, drum(0.0058), 0.115, 0.124, ivory, 0.8);
  pointRoof(s.city, drum(0.0049), 0.124, to3(p, 0.163), ivory);
  rod(s.city, to3(p, 0.161), to3(p, 0.17), 0.00042, '#b8893d', 6);
  const vane = (x, y) => to3(f.point(-f.w * 0.28 + x, 0), y);
  rod(s.city, vane(-0.0034, 0.167), vane(0.0033, 0.167), 0.00034, '#c49541', 5);
  const tail = [
    vane(-0.0034, 0.1658),
    vane(-0.004, 0.1685),
    vane(-0.0008, 0.167),
  ];
  face(s.city, tail, '#bd9242');
  face(s.city, tail.reverse(), '#bd9242');
}

function gundHall(ctx, b) {
  const { s } = ctx,
    f = roofFrame(b, [0.155, -1]);
  walls(ctx, b, '#aa9988', '#d8c6aa');
  const start = -f.d * 0.501,
    end = f.d * 0.501,
    step = (end - start) / 5;
  const rows = [[start, 0.023]];
  for (let i = 0; i < 5; i++) {
    const z = start + i * step,
      y = (5 - i) * 0.0046;
    rows.push(
      [z + step * 0.77, y + 0.0018, '#9a9b91'],
      [z + step * 0.84, y + 0.0021, '#cfccc0'],
      [z + step, Math.max(0, y - 0.0046), '#43595d'],
    );
  }
  bandRoof(s, b, f, rows);
}

function kiosk(ctx, b) {
  const { s } = ctx,
    ring = b.ring;
  // OSM separates the outer roof outline from the inset, many-sided pavilion beneath.
  const p = (u, v) =>
    mix(mix(ring[0], ring[1], u), mix(ring[3], ring[2], u), v);
  const y0 = 0.014,
    ribs = 8;
  const section = (t) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
  const point = (u, v) =>
    to3(p(u, v), y0 + 0.0033 * Math.max(section(u), section(v)));
  for (let i = 0; i < ribs; i++)
    for (let j = 0; j < ribs; j++) {
      const u = i / ribs,
        v = j / ribs,
        a = point(u, v),
        c = point((i + 1) / ribs, (j + 1) / ribs);
      const corners = [
        a,
        point(u, (j + 1) / ribs),
        c,
        point((i + 1) / ribs, v),
      ];
      const tint = ['#628376', '#628477', '#638678', '#638477'][i % 4];
      const [a0, a1, a2, a3] = corners;
      if (i < ribs / 2 === j < ribs / 2) {
        face(s.city, [a1, a2, a3], tint);
        face(s.city, [a1, a3, a0], tint);
      } else {
        face(s.city, [a0, a1, a2], tint);
        face(s.city, [a0, a2, a3], tint);
      }
      if (j === 0 || j === ribs - 1 || i === 0 || i === ribs - 1) {
        for (const [at, k] of [
          [i === 0, 0],
          [j === ribs - 1, 1],
          [i === ribs - 1, 2],
          [j === 0, 3],
        ])
          if (at) {
            const q = corners[k],
              r = corners[(k + 1) % 4];
            face(
              s.city,
              [r, q, [q[0], y0 - 0.0005, q[2]], [r[0], y0 - 0.0005, r[2]]],
              '#516d61',
            );
          }
      }
    }
  for (const [a, e, base] of b.visibleWalls)
    face(
      s.city,
      [to3(a, base), to3(a, b.height), to3(e, b.height), to3(e, base)],
      '#ae7862',
    );
}

function pavilion(s, b, low, top) {
  for (const [a, e] of b.walls) {
    const faceBand = (y0, y1, c) =>
      face(s.city, [to3(a, y0), to3(a, y1), to3(e, y1), to3(e, y0)], c);
    faceBand(low, low + 0.002, '#a75b44');
    faceBand(low + 0.002, top - 0.0008, '#577071');
    faceBand(top - 0.0008, top, '#c3ac8a');
    const span = Math.hypot(...sub(a, e)),
      bays = Math.max(1, Math.round(span / 0.0025));
    for (let k = 0; k < bays; k++) {
      const t = k / bays,
        p = mix(a, e, t),
        q = mix(a, e, Math.min(1, t + 0.00038 / span));
      const n = norm(sub(e, a)),
        shift = (v) => [v[0] + n[1] * 0.000035, v[1] - n[0] * 0.000035];
      const l = shift(p),
        r = shift(q);
      face(
        s.city,
        [to3(l, low + 0.002), to3(l, top), to3(r, top), to3(r, low + 0.002)],
        '#c6baa0',
      );
    }
  }
}

function stationEntrance(ctx, b) {
  const { s } = ctx,
    f = roofFrame(b);
  pavilion(s, b, 0.00255, b.height);
  tier(s.city, b.ring, b.height, b.height + 0.0013, '#a54b41');
  bandRoof(s, { ...b, height: b.height + 0.0013 }, f, [
    [-f.d * 0.51, 0],
    [0, 0.0032, '#53676b'],
    [f.d * 0.51, 0, '#60767a'],
  ]);
  const a = b.ring[0],
    e = b.ring[1],
    p = mix(a, e, 0.49),
    n = norm(sub(e, a));
  const sign = frame([p[0] + n[1] * 0.00012, p[1] - n[0] * 0.00012], n);
  const v = (x, y, offset = 0) => to3(sign.point(x, -offset), y);
  const y = b.height - 0.0035;
  const emblem = Array.from({ length: 14 }, (_, j) =>
    v(0.0029 * Math.cos((j * TAU) / 14), y + 0.0029 * Math.sin((j * TAU) / 14)),
  ).reverse();
  face(s.city, emblem, ivory);
  for (const [w, y0, y1] of [
    [0.0035, y + 0.0006, y + 0.0013],
    [0.00085, y - 0.00165, y + 0.0006],
  ])
    face(
      s.city,
      [
        v(-w / 2, y0, 0.00006),
        v(-w / 2, y1, 0.00006),
        v(w / 2, y1, 0.00006),
        v(w / 2, y0, 0.00006),
      ],
      '#333c40',
    );
}

// At crossings two OSM ways can occupy the same plane. Lay each complete
// ribbon at the first clear elevation, spaced by a scale coat of pavement.
function layerStreets(ctx, roadColors) {
  const { city } = ctx.s;
  const start = city.indices.findIndex(
    (i) => city.positions[i * 3 + 1] > 0.0015,
  );
  if (start < 0) return;
  const firstVertex = city.indices[start];
  city.indices.length = start;
  city.positions.length = city.normals.length = firstVertex * 3;
  city.colors.length = firstVertex * 4;
  const levels = [];
  for (const road of ctx.area.roads) {
    const first = city.positions.length;
    street(ctx.s, road, ctx.scale, { colors: roadColors });
    if (first === city.positions.length) continue;
    const footprint = [];
    for (let i = first; i < city.positions.length; i += 3)
      footprint.push([city.positions[i], city.positions[i + 2]]);
    const bounds = boundsOf(footprint);
    const y = city.positions[first + 1];
    let level = levels.findIndex((peers) =>
      peers.every((p) => p.y !== y || !overlaps(p.bounds, bounds)),
    );
    if (level < 0) level = levels.push([]) - 1;
    levels[level].push({ y, bounds });
    for (let i = first + 1; i < city.positions.length; i += 3)
      city.positions[i] -= 0.000003 * level;
  }
}

function pavedPlaza(ctx, kiosk, entrance) {
  const f = frame(
    mix(roofFrame(kiosk).point(0, 0), roofFrame(entrance).point(0, 0), 0.5),
    [0.939, 0.345],
  );
  const [[x0, x1], [z0, z1]] = boundsOf(
    [...kiosk.ring, ...entrance.ring].map(f.local),
  );
  const ring = (inset) =>
    [
      [x0 - 0.004 + inset, z0 - 0.0015 + inset],
      [x1 + 0.002 - inset, z0 - 0.0015 + inset],
      [x1 + 0.0027 - inset, z0 + 0.003],
      [x1 + 0.003 - inset, z1 - 0.003],
      [x1 + 0.001 - inset, z1 + 0.001 - inset],
      [x0 - 0.001 + inset, z1 + 0.001 - inset],
      [x0 - 0.003 + inset, z1 - 0.002],
      [x0 - 0.005 + inset, z0 + 0.002],
    ].map((q) => f.point(...q));
  face(
    ctx.s.city,
    ring(0)
      .reverse()
      .map((p) => to3(p, 0.00244)),
    '#d1beaa',
  );
  face(
    ctx.s.city,
    ring(0.00075)
      .reverse()
      .map((p) => to3(p, 0.00248)),
    '#b27861',
  );
  const field = ring(0.00075);
  for (let z = z0 + 0.003; z < z1; z += 0.0052) {
    for (let x = x0 - 0.004; x < x1 + 0.003; x += 0.0012) {
      const paver = corners(f, x, z, 0.00113, 0.00042);
      if (
        !paver.every((p) => contains(field, p)) ||
        [kiosk, entrance].some((b) => contains(b.ring, paver[0]))
      )
        continue;
      face(
        ctx.s.city,
        paver.reverse().map((p) => to3(p, 0.00249)),
        '#a56653',
      );
    }
  }
}

function canopy(ctx) {
  const { s, random } = ctx,
    planted = [];
  const tones = [
    ['#30573e', '#47764d', '#67945a'],
    ['#325e49', '#4f815c', '#74a16d'],
    ['#5b7543', '#7e8e4c', '#a8a760'],
    ['#946438', '#b37a3f', '#cea058'],
    ['#586d43', '#768549', '#9a995c'],
  ];
  const priority = (p) => {
    if (
      ['Cambridge Common', 'Brattle Square', 'Winthrop Park'].includes(p.name)
    )
      return 0;
    const [[x0, x1], [z0, z1]] = p.bounds,
      x = (x0 + x1) / 2,
      z = (z0 + z1) / 2;
    return x > -0.1 && x < 0.28 && z > -0.28 && z < 0.05 ? 1 : 2;
  };
  const parks = ctx.parks
    .filter((p) => !['pitch', 'stadium', 'water'].includes(p.kind))
    .sort((a, b) => priority(a) - priority(b) || b.area - a.area);
  const counts = [0, 0, 0],
    limits = [25, 67, 54];
  for (const park of parks) {
    const group = priority(park);
    let count = 0;
    const wanted = Math.min(18, Math.ceil(park.area / 0.00052));
    for (
      let i = 0;
      i < wanted * 48 && count < wanted && counts[group] < limits[group];
      i++
    ) {
      const p = park.bounds.map(([a, b]) => a + (b - a) * random());
      const h = 0.018 + random() * 0.021,
        r = h * (0.25 + random() * 0.09);
      if (
        !contains(park.ring, p) ||
        p.some((c) => Math.abs(c) + r > edge) ||
        !clearPins(ctx, p, r) ||
        planted.some(([q, r0]) => Math.hypot(...sub(q, p)) < 0.72 * (r + r0)) ||
        ctx.buildings.some((b) => distanceTo(b, p) < r) ||
        ctx.roads.some((b) =>
          b.points.some(
            (q, i) =>
              i && segmentDistance(p, q, b.points[i - 1]) < b.radius + r * 0.58,
          ),
        )
      )
        continue;
      const color = tones[Math.floor(random() * tones.length)],
        [x, z] = p;
      const stem = circle(x, 0, z, r * 0.12, 5).map(([u, , v]) => [u, v]);
      tier(s.city, stem, 0.00145, h * 0.48, '#766553', 0.7);
      for (const sign of [-1, 1]) {
        const fork = circle(x, h * 0.28, z, r * 0.075, 3).map(([u, , v]) => [
          u,
          v,
        ]);
        pointRoof(
          s.city,
          fork,
          h * 0.28,
          [x + sign * r * 0.58, h * 0.57, z + r * 0.11],
          '#827059',
        );
      }
      const n = 6,
        phase = random() * TAU,
        radii = Array.from({ length: n }, () => 0.79 + random() * 0.2);
      const layers = [
        [0.39, 0.46],
        [0.65, 1],
        [0.89, 0.73],
      ].map(([y, k], j) =>
        radii.map((rad, i) => {
          const ang = phase + ((i + j * 0.15) * TAU) / n;
          return [
            x + r * rad * k * Math.cos(ang),
            h * (y + 0.055 * random()),
            z + r * rad * k * Math.sin(ang),
          ];
        }),
      );
      for (let j = 1; j < layers.length; j++)
        for (let i = 0; i < n; i++) {
          const e = (i + 1) % n;
          face(
            s.city,
            [layers[j - 1][i], layers[j][i], layers[j][e]],
            color[j === 1 ? 0 : 1],
          );
          face(
            s.city,
            [layers[j - 1][i], layers[j][e], layers[j - 1][e]],
            color[j === 2 ? 1 : 0],
          );
        }
      for (let i = 0; i < n; i++) {
        face(
          s.city,
          [layers[2][i], [x + r * 0.1, h, z], layers[2][(i + 1) % n]],
          color[2],
        );
        face(
          s.city,
          [layers[0][i], layers[0][(i + 1) % n], [x, h * 0.36, z]],
          color[0],
        );
      }
      planted.push([p, r]);
      count++;
      counts[group]++;
    }
  }
}

export function buildSegment(dir) {
  const roadColors = { major: '#67676a', minor: '#85827e', foot: '#c59879' };
  const ctx = prepareSegment(STOP_ID, {
    deckColor: '#c3b6a1',
    roadColors,
    parkColors: ['#819465', '#90a376', '#9aa97c'],
  });
  layerStreets(ctx, roadColors);
  const kioskBuilding = ctx.buildings.find((b) => b.name === 'Cambridge KiOSK');
  const coord = projectLatLon(ctx.area, 42.37336, -71.11896);
  const entrance = ctx.buildings.find(
    (b) => b.kind === 'train_station' && contains(b.ring, coord),
  );
  // Set eaves before resolving the shared walls of overlapping building parts.
  for (const b of ctx.buildings) {
    b.height = 0.00255 + (b.height - 0.00255) * 0.62;
    if (b.name === 'Memorial Hall Tower') b.height = 0.199;
    if (b.name === 'Memorial Hall') b.height = 0.078;
    if (b.name === "Cambridge Visitor's Information Center") b.height = 0.011;
    if (b === entrance) b.height = 0.018;
    if (b === kioskBuilding) b.height = 0.0038;
    if (b.id === 1411992366) b.height = 0.014;
  }
  ctx.rendered = exposedShells(ctx.buildings);
  pavedPlaza(ctx, kioskBuilding, entrance);
  for (const b of ctx.rendered) {
    if (b.name === 'Memorial Hall') memorialHall(ctx, b);
    else if (b.name === 'Memorial Hall Tower') clockTower(ctx, b);
    else if (b.name === 'Memorial Church') memorialChurch(ctx, b);
    else if (b.name === 'Widener Library') widener(ctx, b);
    else if (b.name === 'Gund Hall') gundHall(ctx, b);
    else if (b === kioskBuilding) kiosk(ctx, b);
    else if (b.id === 1411992366) pavilion(ctx.s, b, 0.0038, 0.014);
    else if (b === entrance) stationEntrance(ctx, b);
    else if (b.name === "Cambridge Visitor's Information Center") {
      pavilion(ctx.s, b, 0.00255, b.height);
      tier(ctx.s.city, b.ring, b.height, b.height + 0.0006, '#a6a293');
      const top = roofFrame(b).point(0, 0);
      pointRoof(
        ctx.s.city,
        b.ring,
        b.height + 0.0006,
        to3(top, b.height + 0.0027),
        '#6e8079',
      );
    } else if (yardHall.test(b.name)) georgian(ctx, b);
    else {
      const pitched =
        b.kind === 'dormitory' ||
        /Chapel|House|Boylston Hall|Sever Hall|Lampoon/.test(b.name);
      const f = pitched && roofFrame(b);
      renderBuilding(ctx.s, b, ctx.detailed.has(b), ctx.pins, {
        pitched,
        penthouse: false,
        ...(pitched && {
          tower: false,
          finish: brick[b.id % brick.length],
          roofColor: slate,
          cornice: limestone,
          pitchOpts: {
            direction: sub(f.point(0, 1), f.point(0, 0)),
            ridgeRatio: 0.5,
            rise: Math.min(f.d * 0.31, 0.014),
          },
        }),
      });
    }
  }
  canopy(ctx);
  return finalizeSegment(ctx, dir, { maxTriangles: 32000 });
}
