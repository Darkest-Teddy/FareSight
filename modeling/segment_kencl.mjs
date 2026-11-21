import { box, circle, face, loft, mix, rod, sub } from './geometry.mjs';
import {
  boundsOf,
  clip,
  contains,
  distanceTo,
  edge,
  exposedShells,
  finalizeSegment,
  overlaps,
  prepareSegment,
  projectLatLon,
  renderBuilding,
  roofFaces,
  segmentDistance,
  signedArea,
  subtractTriangle,
  to3,
  tree,
  triangulate,
} from './segment_base.mjs';

export const STOP_ID = 'place-kencl';
const green = '#24593c',
  ivory = '#f5efda',
  iron = '#324840';
const distance = (a, b) => Math.hypot(...sub(a, b));
const clearance = (pins, p, radius = 0) =>
  pins.every((q) => distance(p, q) >= 0.025 + radius);

function top(surf, pts, color) {
  if (signedArea(pts.map(([x, , z]) => [x, z])) > 0) pts = pts.toReversed();
  face(surf, pts, color);
}

function pavement(s, path, y, color) {
  const ring = signedArea(path) < 0 ? path.toReversed() : path;
  roofFaces(s.city, triangulate(ring), y, color);
}

function stripe(surf, a, b, y, width, color) {
  const [dx, dz] = sub(b, a),
    k = width / (2 * Math.hypot(dx, dz));
  const pair = ([x, z]) => [
    [x + dz * k, y, z - dx * k],
    [x - dz * k, y, z + dx * k],
  ];
  top(surf, [...pair(a), ...pair(b).reverse()], color);
}

// Coordinates along the low, field-facing parapet of OSM stadium way 813683135.
// The recesses at the dugouts sit between this edge and the two grandstand roofs.
const fieldEdge = [
  [-0.053, 0.2205],
  [-0.053, 0.2619],
  [-0.065, 0.2767],
  [-0.0667, 0.2994],
  [-0.0686, 0.3238],
  [-0.0661, 0.3309],
  [-0.0597, 0.3367],
  [-0.0527, 0.3387],
  [-0.0287, 0.3368],
  [-0.028, 0.342],
  [-0.0103, 0.3401],
  [-0.0112, 0.3346],
  [0.0086, 0.3288],
  [0.0262, 0.322],
  [0.049, 0.3213],
  [0.0657, 0.3151],
  [0.0706, 0.3124],
  [0.0732, 0.3091],
  [0.0743, 0.3055],
  [0.0737, 0.2995],
];

function ballfield({ s, parks }) {
  const lawn = parks.find((p) => p.id === 813683133);
  const infield = parks.find((p) => p.id === 813683131);
  const warningTrack = [
    ...fieldEdge,
    [0.08, 0.2974],
    [0.061, 0.2465],
    [0.0246, 0.2206],
  ];
  pavement(s, warningTrack, 0.002405, '#ad7955');
  roofFaces(s.city, lawn.roof, 0.00242, '#628b4e');
  // Clip parallel mowing passes against each triangle of the surveyed grass polygon.
  const cut = (poly, offset, side) => {
    const out = [];
    let last = poly.at(-1);
    for (const point of poly) {
      const d = (p) => side * (p[0] + 0.28 * p[1] - offset);
      if (d(last) < 0 !== d(point) < 0)
        out.push(mix(last, point, d(last) / (d(last) - d(point))));
      if (d(point) >= 0) out.push(point);
      last = point;
    }
    return out;
  };
  for (const tri of lawn.roof)
    for (let i = 0; i <= 9; i++) {
      const start = i * 0.018;
      const strip = cut(cut(tri, start, 1), start + 0.009, -1);
      if (strip.length >= 3 && signedArea(strip) > 1e-10)
        top(
          s.city,
          strip.map((p) => to3(p, 0.00243)),
          '#79a05a',
        );
    }
  // OSM way 813683130 describes the skinned arc, including the circle behind home.
  const dirt = [
    [-0.046, 0.3235],
    [-0.025, 0.3233],
    [-0.022, 0.3256],
    [-0.0187, 0.3257],
    [-0.0115, 0.3233],
    [-0.008, 0.3198],
    [-0.006, 0.3119],
    [-0.0056, 0.3057],
    [-0.0071, 0.2984],
    [-0.011, 0.2902],
    [-0.0176, 0.2832],
    [-0.0268, 0.278],
    [-0.0362, 0.2766],
    [-0.045, 0.2775],
    [-0.0515, 0.2799],
    [-0.0548, 0.2865],
    [-0.0555, 0.2922],
    [-0.0531, 0.2962],
    [-0.0527, 0.3168],
    [-0.0561, 0.3191],
    [-0.057, 0.3227],
    [-0.0559, 0.3256],
    [-0.0534, 0.3276],
    [-0.0502, 0.3279],
    [-0.0477, 0.3268],
  ];
  pavement(s, dirt, 0.002445, '#b77851');
  roofFaces(s.city, infield.roof, 0.00246, '#648949');
  const home = [-0.0513, 0.3224],
    first = [-0.0213, 0.3214],
    third = [-0.0523, 0.2924];
  const second = [-0.0223, 0.2914],
    mound = mix(home, second, 0.475);
  top(s.city, circle(mound[0], 0.00247, mound[1], 0.0034, 18), '#c2895f');
  top(s.city, circle(home[0], 0.00247, home[1], 0.0051, 18), '#c2895f');
  for (const target of [
    [-0.0547, 0.222],
    [0.071, 0.3184],
  ])
    stripe(s.city, home, target, 0.00248, 0.00057, ivory);
  for (const [x, z] of [first, second, third])
    box(s.city, x, 0.00247, z, 0.00175, 0.000055, 0.00175, ivory);
  loft(
    s.city,
    [
      circle(mound[0], 0.002475, mound[1], 0.00325, 18),
      circle(mound[0], 0.0033, mound[1], 0.00155, 18),
    ],
    '#bf855b',
    { bottom: false },
  );
  box(s.city, mound[0], 0.00339, mound[1], 0.0018, 0.00018, 0.00066, ivory);
  pavement(
    s,
    [
      [-0.0523, 0.3217],
      [-0.0504, 0.3217],
      [-0.0504, 0.323],
      [-0.0514, 0.3239],
      [-0.0523, 0.323],
    ],
    0.00249,
    ivory,
  );
}

function grandstand(s, sections, low, high, rows, covered) {
  const section = ([front, back], t, y) => to3(mix(front, back, t), y);
  for (let i = 1; i < sections.length; i++) {
    const left = sections[i - 1],
      right = sections[i];
    const across = (t, y) => [section(left, t, y), section(right, t, y)];
    const deck = (t0, t1, y0, y1, color) =>
      top(s.city, [...across(t0, y0), ...across(t1, y1).reverse()], color);
    // A section may run clockwise or counterclockwise around the bowl.
    const frontSide = signedArea([left[0], right[0], right[1], left[1]]) > 0;
    const wall = (t, y0, y1, color, back = false) => {
      const pts = [...across(t, y0), ...across(t, y1).reverse()];
      face(s.city, frontSide !== back ? pts.reverse() : pts, color);
    };
    const rise = (high - low) / rows;
    wall(0, 0.00245, low, green);
    for (let j = 0; j < rows; j++) {
      const y = low + j * rise;
      if (j) wall(j / rows, y - rise, y, j % 4 === 0 ? '#a09580' : '#485349');
      deck(j / rows, (j + 1) / rows, y, y, j % 2 ? '#587258' : '#6d8064');
      // Seat banks stop short of each concrete aisle. Rows are wide enough to read at tile scale.
      const row = (t, y) => {
        const ends = across(t, y);
        return [mix(...ends, 0.055), mix(...ends, 0.945)];
      };
      const seats = j % 2 ? '#96574c' : '#a56655';
      top(
        s.city,
        [
          ...row((j + 0.3) / rows, y + 0.00042),
          ...row((j + 0.72) / rows, y + 0.00042).reverse(),
        ],
        seats,
      );
    }
    wall(1, 0.00245, high - rise, '#935744', true);
    if (covered) {
      const [a, b] = [left[1], right[1]];
      const span = distance(a, b),
        polarity = frontSide ? 1 : -1;
      const front = (t, y, relief = 0.00018) => {
        const [x, z] = mix(a, b, t);
        return [
          x - ((b[1] - a[1]) * relief * polarity) / span,
          y,
          z + ((b[0] - a[0]) * relief * polarity) / span,
        ];
      };
      const bays = Math.max(1, Math.floor(span / 0.008));
      for (let k = 0; k < bays; k++) {
        const l = (k + 0.14) / bays,
          r = (k + 0.86) / bays,
          mid = (l + r) / 2;
        const arch = [
          [l, 0.004],
          [r, 0.004],
          [r, 0.013],
          [(mid + r) / 2, 0.0155],
          [mid, 0.0163],
          [(l + mid) / 2, 0.0155],
          [l, 0.013],
        ];
        const gate = arch.map(([t, y]) => front(t, y));
        face(s.city, frontSide ? gate : gate.reverse(), '#414b40');
        for (const f of [0.28, 0.55, 0.8]) {
          const t = l + (r - l) * f,
            half = 0.00017 / span;
          const bars = [
            front(t - half, 0.0041, 0.00027),
            front(t + half, 0.0041, 0.00027),
            front(t + half, 0.0142, 0.00027),
            front(t - half, 0.0142, 0.00027),
          ];
          face(s.paint, frontSide ? bars : bars.reverse(), '#849084');
        }
        const clerestory = [
          front(l, high - 0.01),
          front(r, high - 0.01),
          front(r, high - 0.006),
          front(l, high - 0.006),
        ];
        face(
          s.window,
          frontSide ? clerestory : clerestory.reverse(),
          '#4c5855',
        );
      }
      rod(s.city, front(0, 0.019), front(1, 0.019), 0.00055, '#beb59a', 4);
    }
    for (const pair of [left, right].filter((_, k) =>
      k === 0 ? i === 1 : i === sections.length - 1,
    )) {
      const side = [
        section(pair, 0, 0.00245),
        section(pair, 1, 0.00245),
        section(pair, 1, high - rise),
        section(pair, 0, low),
      ];
      face(s.city, side, '#9b604b');
      face(s.city, side.reverse(), '#9b604b');
    }
    if (!covered) continue;
    const soffit = high + 0.005,
      eave = soffit + 0.003;
    deck(0.38, 1, eave, soffit, '#526d65');
    const under = [
      ...across(0.38, eave - 0.0011),
      ...across(1, soffit - 0.0011).reverse(),
    ];
    if (signedArea(under.map(([x, , z]) => [x, z])) < 0) under.reverse();
    face(s.city, under, iron);
    wall(0.38, eave - 0.0011, eave, '#c3b99c');
    const length = distance(left[0], right[0]);
    const bays = Math.max(1, Math.ceil(length / 0.012));
    for (let k = 0; k < bays; k++) {
      const t = (k + 0.5) / bays;
      const p = (u, y) => mix(...across(u, y), t);
      rod(
        s.paint,
        p(0.63, low + 0.57 * (high - low)),
        p(0.63, eave - 0.0015),
        0.00054,
        iron,
        5,
      );
      rod(
        s.trim,
        p(0.63, soffit - 0.0034),
        p(0.4, eave - 0.0011),
        0.00034,
        '#acb1a0',
        4,
      );
      rod(
        s.paint,
        p(0.38, eave + 0.00014),
        p(1, soffit + 0.00014),
        0.00032,
        '#88998b',
        4,
      );
    }
  }
}

// Narrow steel lattice masts carry two banks of individually enamelled reflectors.
function floodlight(s, base, y, towards, size = 1) {
  const p = (u, h, v) => [base[0] + u * size, y + h * size, base[1] + v * size];
  const h = 0.034;
  for (const side of [-1, 1]) {
    rod(
      s.trim,
      p(side * 0.003, 0, 0),
      p(side * 0.0017, h, 0),
      0.00055,
      iron,
      5,
    );
    rod(s.trim, p(0, 0, 0.0038), p(side * 0.0017, h, 0), 0.00052, iron, 5);
    for (let j = 0; j < 3; j++)
      rod(
        s.trim,
        p(side * (0.003 - j * 0.00043), (j * h) / 3, 0),
        p(-side * (0.003 - (j + 1) * 0.00043), ((j + 1) * h) / 3, 0),
        0.00028,
        '#63756c',
        4,
      );
  }
  box(
    s.paint,
    ...p(0, h + 0.0026, 0),
    0.018 * size,
    0.0068 * size,
    0.0018 * size,
    iron,
  );
  for (let row = 0; row < 2; row++)
    for (let col = -2; col <= 2; col++) {
      const a = p(col * 0.00345, h + 0.0009 + row * 0.00315, towards * 0.00098);
      rod(
        s.window,
        a,
        [a[0], a[1], a[2] + towards * 0.00065 * size],
        0.00128 * size,
        '#ddd9c5',
        8,
      );
    }
}

function monster(s, b) {
  const [nw, ne, se, sw] = b.ring;
  const height = 0.028;
  // The painted scoreboard faces home plate on the south face of the mapped wall.
  grandstand(
    s,
    [
      [sw, nw],
      [se, ne],
    ],
    height,
    height + 0.0036,
    3,
    false,
  );
  const panel = (t, y) => {
    const [x, z] = mix(sw, se, t);
    return [x, y, z + 0.00018];
  };
  const panelFace = (l, r, lo, hi, c, offset = 0) => {
    face(
      s.city,
      [panel(l, lo), panel(r, lo), panel(r, hi), panel(l, hi)].map(
        ([x, y, z]) => [x, y, z + offset],
      ),
      c,
    );
  };
  panelFace(0.045, 0.64, 0.005, 0.0175, '#ced4b5');
  panelFace(0.052, 0.633, 0.0056, 0.0169, '#284d3c', 0.00012);
  for (let j = 0; j < 3; j++)
    panelFace(
      0.072,
      0.614,
      0.0072 + j * 0.00315,
      0.0075 + j * 0.00315,
      '#afbd9e',
      0.0002,
    );
  for (let i = 0; i < 11; i++)
    for (let j = 0; j < 2; j++)
      panelFace(
        0.13 + i * 0.043,
        0.143 + i * 0.043,
        0.0082 + j * 0.0033,
        0.0095 + j * 0.0033,
        ivory,
        0.00024,
      );
  for (let i = 0; i <= 13; i++) {
    const p = mix(nw, ne, i / 13);
    rod(
      s.trim,
      to3(p, height + 0.002),
      to3(p, height + 0.0064),
      0.0003,
      iron,
      4,
    );
  }
  rod(
    s.trim,
    to3(nw, height + 0.0064),
    to3(ne, height + 0.0064),
    0.00038,
    '#d0d4bc',
    6,
  );
  for (const p of [mix(nw, ne, 0.13), mix(nw, ne, 0.86)])
    floodlight(s, p, height + 0.003, 1, 0.86);
}

function fenway(ctx, ways) {
  const { s } = ctx;
  ballfield(ctx);
  const ring = (id) => ways.get(id).ring;
  const west = ring(813683142),
    home = ring(813683143),
    south = ring(813683144),
    east = ring(813683134);
  const upperWest = [
    [west[2], west[1]],
    [west[3], mix(west[1], west[0], 0.58)],
    [west[4], west[8]],
    [west[5], mix(west[8], west[7], 0.79)],
    [west[6], west[7]],
  ];
  const upperHome = [
    [home[0], home[6]],
    [home[1], mix(home[6], home[5], 0.68)],
    [home[2], home[5]],
    [home[3], home[4]],
  ];
  const upperSouth = [
    [south[8], south[7]],
    [south[0], mix(south[7], south[6], 0.26)],
    [south[1], south[6]],
    [south[2], mix(south[5], south[4], 0.43)],
    [south[3], south[4]],
  ];
  grandstand(s, upperWest, 0.031, 0.047, 6, true);
  grandstand(s, upperHome, 0.033, 0.051, 6, true);
  grandstand(s, upperSouth, 0.03, 0.043, 5, true);
  grandstand(
    s,
    [
      [east[6], east[0]],
      [east[5], east[1]],
      [mix(east[5], east[4], 0.48), east[2]],
      [east[4], east[3]],
    ],
    0.008,
    0.038,
    13,
    false,
  );
  // The lower seating bowl follows the stadium relation, which the way-only cache omits.
  const outer = [
    [-0.06, 0.2205],
    west[2],
    west[4],
    mix(west[4], west[5], 0.62),
    home[0],
    home[1],
    home[2],
    home[3],
    mix(south[8], south[1], 0.5),
    mix(south[8], south[1], 0.52),
    mix(south[8], south[1], 0.84),
    mix(south[8], south[1], 0.87),
    south[2],
    south[3],
    [0.047, 0.354],
    [0.074, 0.341],
    [0.084, 0.334],
    [0.09, 0.325],
    [0.094, 0.312],
    [0.091, 0.295],
  ];
  grandstand(
    s,
    fieldEdge.map((p, i) => [p, outer[i]]),
    0.005,
    0.029,
    12,
    false,
  );
  for (const [p, y, dir] of [
    [upperWest[2], 0.052, 1],
    [upperHome[1], 0.056, -1],
    [upperSouth[2], 0.048, -1],
    [[east[5], east[1]], 0.035, 1],
    [[east[4], east[3]], 0.035, 1],
  ])
    floodlight(s, mix(...p, 0.88), y, dir);
  monster(s, ways.get(813683146));
}

function citgo({ s, area }, b) {
  // OSM sign node 7599402961 on the cached 660 Beacon Street office footprint.
  const [x, z] = projectLatLon(area, 42.3492818, -71.0962619);
  const p = (u, h, d) => [
    x + 0.423 * u - 0.906 * d,
    b.height + h,
    z + 0.906 * u + 0.423 * d,
  ];
  const w = 0.03,
    bottom = 0.026,
    steel = '#414b47';
  for (const u of [-0.011, 0.011]) {
    for (const side of [-1, 1])
      rod(
        s.trim,
        p(u, 0, side * 0.0057),
        p(u, bottom, side * 0.0009),
        0.00076,
        steel,
        6,
      );
  }
  for (let i = 0; i < 2; i++)
    for (const k of [-1, 1])
      rod(
        s.trim,
        p(k * 0.011, 0.002 + i * 0.012, 0),
        p(-k * 0.011, 0.014 + i * 0.012, 0),
        0.00045,
        steel,
        5,
      );
  for (const dir of [-1, 1]) {
    const front = (u, h, d = 0) => p(dir * u, bottom + h, dir * (0.0012 + d));
    const artwork = (points, c, d = 0) => {
      const verts = points.map(([u, v]) => front(u * w, v * w, d));
      // Local horizontal points southeast. Its cross product with up faces southwest.
      face(s.window, verts, c);
    };
    artwork(
      [
        [-0.5, 0],
        [0.5, 0],
        [0.5, 1],
        [-0.5, 1],
      ],
      '#f5f1df',
    );
    artwork(
      [
        [-0.4, 0.3],
        [0.4, 0.3],
        [0.02, 0.907],
      ],
      '#ca2e36',
      0.00012,
    );
    artwork(
      [
        [0.02, 0.907],
        [0.4, 0.3],
        [0.09, 0.427],
      ],
      '#921e32',
      0.00019,
    );
    artwork(
      [
        [-0.4, 0.3],
        [0.09, 0.427],
        [0.4, 0.3],
      ],
      '#b12329',
      0.00022,
    );
    const glyphs = [
      '111/100/100/100/111',
      '111/010/010/010/111',
      '111/010/010/010/010',
      '111/100/101/101/111',
      '111/101/101/101/111',
    ];
    glyphs.forEach((glyph, i) =>
      glyph.split('/').forEach((row, j) => {
        for (const match of row.matchAll(/1+/g)) {
          const l = -0.38 + i * 0.156 + match.index * 0.042,
            r = l + match[0].length * 0.042,
            hi = 0.236 - j * 0.027;
          artwork(
            [
              [l, hi - 0.027],
              [r, hi - 0.027],
              [r, hi],
              [l, hi],
            ],
            '#164673',
            0.00016,
          );
        }
      }),
    );
    for (const [a, c] of [
      [
        [-0.5, 0],
        [0.5, 0],
      ],
      [
        [0.5, 0],
        [0.5, 1],
      ],
      [
        [0.5, 1],
        [-0.5, 1],
      ],
      [
        [-0.5, 1],
        [-0.5, 0],
      ],
    ])
      rod(
        s.trim,
        front(a[0] * w, a[1] * w),
        front(c[0] * w, c[1] * w),
        0.00052,
        '#dedbca',
        5,
      );
  }
}

function busway({ s, pins }, b) {
  const [ne, se, sw, nw] = b.ring;
  pavement(s, b.ring, 0.00242, '#c8bdab');
  // Only the eastern bays of the shelter clear the nearby El Jefe's anchor.
  const point = (t, v, h) => to3(mix(mix(nw, ne, t), mix(sw, se, t), v), h);
  const roof = (t, v) =>
    0.016 +
    0.005 * Math.sin(Math.PI * t) +
    0.0025 * Math.cos((v - 0.45) * Math.PI * 1.7) +
    0.002 * (v - 0.5);
  for (let k = 0; k < 10; k++) {
    const a = k / 10,
      c = (k + 1) / 10;
    if (
      ![point(a, 0, 0), point(a, 1, 0)].every(([x, , z]) =>
        clearance(pins, [x, z], 0.00065),
      )
    )
      continue;
    for (let j = 0; j < 6; j++) {
      const v = j / 6,
        w = (j + 1) / 6;
      const sheet = [
        [a, v],
        [c, v],
        [c, w],
        [a, w],
      ].map(([t, f]) => point(t, f, roof(t, f)));
      top(s.paint, sheet, j % 2 ? '#8a9897' : '#a4ada8');
      face(
        s.paint,
        sheet.map(([x, y, z]) => [x, y - 0.0007, z]),
        '#687978',
      );
      rod(s.trim, sheet[0], sheet[3], 0.00032, '#d5d5c5', 4);
      if (j === 0 || j === 5) {
        const f = j === 0 ? v : w;
        rod(
          s.paint,
          point(a, f, roof(a, f) - 0.0003),
          point(c, f, roof(c, f) - 0.0003),
          0.00056,
          '#366452',
          5,
        );
      }
    }
    if (k % 2 === 1)
      for (const v of [0.11, 0.89])
        rod(
          s.trim,
          point(c - 0.035, 0.5, 0.00245),
          point(c - 0.035, v, roof(c - 0.035, v) - 0.0005),
          0.00062,
          '#727e78',
          6,
        );
  }
}

const historic = new Map([
  ['Hotel Commonwealth', ['#a46350', '#6f7676']],
  ['Boston Hotel Buckminster', ['#a26148', '#6c635d']],
  ['Myles Standish Hall', ['#955841', '#555f63']],
  ['Kilachand Hall', ['#a46f55', '#6b6b65']],
  ['Kenmore Abbey Apartments', ['#a16146', '#666c66']],
]);

function hotel(ctx, b) {
  const { s, pins } = ctx,
    [brick, slate] = historic.get(b.name);
  const roofHeight = renderBuilding(s, b, true, pins, {
    tower: false,
    finish: brick,
    roofColor: slate,
    cornice: '#dfc9aa',
    pitched: true,
    penthouse: false,
    pitchOpts: { rise: 0.007, ridgeRatio: 0.48 },
  });
  for (const [a, c, base] of b.visibleWalls) {
    const [dx, dz] = sub(c, a),
      len = distance(c, a);
    if (len < 0.009) continue;
    const p = (t, y) => {
      const [x, z] = mix(a, c, t);
      return [x + (dz / len) * 0.00015, y, z - (dx / len) * 0.00015];
    };
    const panel = (l, r, low, hi, clr) => {
      if (
        low >= base &&
        [p(l, hi), p(r, hi)].every(
          ([x, , z]) => Math.max(Math.abs(x), Math.abs(z)) < edge,
        )
      )
        face(s.city, [p(l, low), p(l, hi), p(r, hi), p(r, low)], clr);
    };
    panel(0, 1, b.height - 0.006, b.height - 0.005, '#e1d0b4');
    panel(0, 1, b.height * 0.225, b.height * 0.225 + 0.0019, '#ccb99d');
    const bays = Math.max(1, Math.floor(len / 0.01));
    // Dormer cheeks project down the pitch and a pitched cap returns into the slate.
    for (let i = 0; i < bays && len > 0.018; i++) {
      const [x, z] = mix(a, c, (i + 0.5) / bays),
        nx = -dz / len,
        nz = dx / len;
      const d = (u, v) => [
        x + (dx / len) * u + nx * v,
        z + (dz / len) * u + nz * v,
      ];
      const contour = [
        d(-0.002, 0.0012),
        d(0.002, 0.0012),
        d(0.002, 0.005),
        d(-0.002, 0.005),
      ];
      if (
        !contour.every((q) => contains(b.ring, q) && clearance(pins, q, 0.001))
      )
        continue;
      const base = roofHeight(contour[0]),
        crown = base + 0.0045;
      const sill = contour.map((q) => to3(q, roofHeight(q) - 0.00015));
      const header = contour.map((q) => to3(q, crown - 0.0016));
      for (const j of [0, 1, 3]) {
        const k = (j + 1) % 4,
          pts = [sill[j], sill[k], header[k], header[j]];
        face(s.city, pts.reverse(), j === 0 ? '#576261' : '#b5a797');
      }
      const ridge = [to3(d(0, 0.0012), crown), to3(d(0, 0.005), crown)];
      top(s.city, [header[0], ridge[0], ridge[1], header[3]], '#727575');
      top(s.city, [ridge[0], header[1], header[2], ridge[1]], '#646967');
      const gable = [header[0], ridge[0], header[1]];
      face(s.city, gable, '#d4c0a2');
    }
    for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) / bays;
      panel(
        t - 0.07 / bays,
        t + 0.07 / bays,
        b.height * 0.24,
        b.height - 0.006,
        '#b89070',
      );
      for (let j = 0; j < 3; j++)
        panel(
          (i + 0.15 + j * 0.24) / bays,
          (i + 0.24 + j * 0.24) / bays,
          b.height - 0.0048,
          b.height - 0.0031,
          '#e3d3b9',
        );
      panel(
        (i + 0.15) / bays,
        (i + 0.85) / bays,
        base + 0.0008,
        b.height * 0.18,
        '#696a61',
      );
    }
  }
}

function promenade(ctx) {
  const { s, parks, buildings, pins, roads, random } = ctx;
  const mall = parks.find((p) => p.name === 'Commonwealth Ave Mall');
  const grass = parks.filter((p) => p.kind === 'grass');
  const center = (x) => -0.0104 - 0.027 * (x - 0.205);
  for (const [start, end] of [
    [0.218, 0.267],
    [0.274, 0.305],
    [0.311, 0.37],
    [0.383, 0.422],
  ]) {
    stripe(
      s.city,
      [start, center(start)],
      [end, center(end)],
      0.00245,
      0.0044,
      '#d6c7ab',
    );
    for (const side of [-1, 1]) {
      const railRoads = roads.filter(
        (r) => r.major || r.kind === 'residential',
      );
      for (let x = start + 0.004; x < end - 0.003; x += 0.0125) {
        const z = center(x) + side * 0.0095;
        const h = 0.015 + random() * 0.004;
        if (
          Math.abs(x) + h * 0.31 >= edge ||
          !contains(mall.ring, [x, z]) ||
          !grass.some((g) => contains(g.ring, [x, z])) ||
          !clearance(pins, [x, z], h * 0.31) ||
          railRoads.some((r) =>
            r.points.some(
              (p, i) =>
                i &&
                segmentDistance([x, z], r.points[i - 1], p) < r.radius + 0.001,
            ),
          )
        )
          continue;
        tree(s, [x, z], h, false, {
          canopy: '#546f4d',
          crown: '#849663',
          trunk: '#79654f',
        });
      }
      const a = [start + 0.002, center(start + 0.002) + side * 0.0036],
        b = [end - 0.002, center(end - 0.002) + side * 0.0036];
      rod(s.city, to3(a, 0.0042), to3(b, 0.0042), 0.0005, '#ccbeaa', 4);
      const n = Math.ceil(distance(a, b) / 0.007);
      for (let i = 0; i <= n; i++) {
        const [x, z] = mix(a, b, i / n);
        box(s.city, x, 0.00335, z, 0.00092, 0.0022, 0.00092, '#c2b297');
      }
    }
  }
  // Other park trees use the same protection radius as the promenade.
  const planted = [];
  for (const park of parks
    .filter((p) => p !== mall && p.kind === 'grass')
    .toSorted((a, b) => b.area - a.area)) {
    let count = 0;
    for (let i = 0; i < 100 && planted.length < 41 && count < 15; i++) {
      const p = park.bounds.map(([lo, hi]) => lo + (hi - lo) * random()),
        h = 0.016 + random() * 0.012,
        r = h * 0.32;
      if (
        !contains(park.ring, p) ||
        contains(mall.ring, p) ||
        p.some((v) => Math.abs(v) + r >= edge) ||
        !clearance(pins, p, r) ||
        buildings.some((b) => distanceTo(b, p) < r) ||
        roads.some((road) =>
          road.points.some(
            (q, j) =>
              j && segmentDistance(p, q, road.points[j - 1]) < road.radius + r,
          ),
        ) ||
        planted.some((q) => distance(q, p) < r + 0.009)
      )
        continue;
      tree(s, p, h, false, {
        canopy: '#526f52',
        crown: '#819669',
        trunk: '#73614e',
      });
      planted.push(p);
      count++;
    }
  }
}

// The local extractor keeps closed ways. The basin itself is an OSM multipolygon.
// These are the projected south-bank bends of its outer member, way 826552802.
function river(s) {
  const shore = [
    [-0.472, -0.3192],
    [-0.3872, -0.3337],
    [-0.3425, -0.3387],
    [-0.3146, -0.3384],
    [-0.2841, -0.3348],
    [-0.2159, -0.3187],
    [-0.1921, -0.3112],
    [-0.153, -0.2963],
    [-0.1105, -0.2731],
    [-0.0973, -0.2672],
    [-0.089, -0.2657],
    [0.0033, -0.2571],
    [0.0556, -0.2602],
    [0.1216, -0.2719],
    [0.1656, -0.2741],
    [0.188, -0.2731],
    [0.2, -0.2705],
    [0.2198, -0.263],
    [0.2352, -0.2607],
    [0.2575, -0.2615],
    [0.2805, -0.2756],
    [0.2957, -0.2808],
    [0.3239, -0.297],
    [0.3426, -0.3122],
    [0.3625, -0.3257],
    [0.3677, -0.3278],
    [0.374, -0.3264],
    [0.3787, -0.3217],
    [0.4425, -0.3477],
  ];
  pavement(
    s,
    clip([...shore, [0.45, -0.45], [-0.48, -0.45]]),
    0.00125,
    '#75999a',
  );
}

// Shared street ribbons overlap where OSM ways meet. Keep one pavement face at
// each junction so coplanar surfaces cannot self-shadow in the physical render.
function mergeJunctions(surface, colors) {
  const previous = new Map();
  const original = surface.indices;
  surface.indices = [];
  for (let i = 0; i < original.length; i += 3) {
    const indices = original.slice(i, i + 3);
    const y = surface.positions[3 * indices[0] + 1];
    if (!colors.has(y)) {
      surface.indices.push(...indices);
      continue;
    }
    const tri = indices
      .toReversed()
      .map((j) => [surface.positions[3 * j], surface.positions[3 * j + 2]]);
    const bounds = boundsOf(tri);
    if (!previous.has(y)) previous.set(y, []);
    const seen = previous.get(y);
    let pieces = [tri];
    for (const other of seen) {
      if (overlaps(bounds, other.bounds))
        pieces = pieces.flatMap((p) => subtractTriangle(p, other.tri));
      if (!pieces.length) break;
    }
    seen.push({ bounds, tri });
    if (pieces.length === 1 && pieces[0] === tri)
      surface.indices.push(...indices);
    else
      for (const ring of pieces)
        for (let k = 1; k < ring.length - 1; k++) {
          const fragment = [ring[0], ring[k], ring[k + 1]];
          if (signedArea(fragment) > 1e-11)
            roofFaces(surface, [fragment], y, colors.get(y));
        }
  }
}

export function buildSegment(dir) {
  const roadColors = { major: '#686a69', minor: '#89887f', foot: '#d4c8af' };
  const ctx = prepareSegment(STOP_ID, {
    deckColor: '#bcb5a5',
    parkColors: ['#8c9d73', '#99aa7e', '#a2af88'],
    roadColors,
  });
  const { s, pins, detailed, buildings } = ctx;
  mergeJunctions(
    s.city,
    new Map([
      [0.0024, roadColors.major],
      [0.0021, roadColors.minor],
      [0.00184, roadColors.foot],
    ]),
  );
  river(s);
  const ways = new Map(buildings.map((b) => [b.id, b]));
  const stadium = new Set([
    813683142, 813683143, 813683144, 813683134, 813683146,
  ]);
  const shelter = new Set([308329579, 822618765]);
  const parkBuildings = new Set([
    813683147, 813683148, 813683149, 813710192, 814020183, 813739687, 814360194,
    814442744, 814812936, 814812940,
  ]);
  // Recompute shared party walls after compressing the neighborhood's vertical scale.
  for (const b of buildings) {
    if (shelter.has(b.id)) b.height = 0.022;
    else if (stadium.has(b.id)) b.height = b.id === 813683146 ? 0.028 : 0.044;
    else
      b.height *= parkBuildings.has(b.id)
        ? 0.36
        : b.id === 808235551
          ? 0.873
          : 0.62;
  }
  ctx.rendered = exposedShells(buildings);
  for (const b of ctx.rendered) {
    if (stadium.has(b.id) || shelter.has(b.id)) continue;
    if (historic.has(b.name)) hotel(ctx, b);
    else
      renderBuilding(s, b, detailed.has(b), pins, {
        ...(parkBuildings.has(b.id)
          ? {
              tower: false,
              pitched: false,
              finish: '#9e624b',
              roofColor: b.id === 813683147 ? '#72825a' : '#63766a',
            }
          : {}),
        ...(b.id === 29559484 ? { pitched: false } : {}),
        penthouse: false,
      });
    if (b.id === 29559484) citgo(ctx, b);
  }
  fenway(ctx, ways);
  busway(ctx, ways.get(822618765));
  promenade(ctx);
  return finalizeSegment(ctx, dir, { maxTriangles: 32000 });
}
