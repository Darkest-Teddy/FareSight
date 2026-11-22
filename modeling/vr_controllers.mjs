import { join } from 'node:path';
import {
  Model,
  TAU,
  add,
  cross,
  face,
  mix,
  mul,
  norm,
  sub,
} from './geometry.mjs';

// Left grip space, in mm. Each station runs around the handle, from heel to deck.
// y, x, z, lateral radius, longitudinal radius, deck tilt in X and Z.
const shell = [
  [-84, -4, 46, 6.6, 8, 0, 0.055],
  [-83.2, -4, 45.8, 8.9, 10.4, 0, 0.06],
  [-80.8, -4, 45, 10.9, 12.3, 0, 0.07],
  [-74, -3.8, 41.8, 12.4, 14.4, 0, 0.13],
  [-59, -3, 34, 13.1, 15.7, 0.01, 0.1],
  [-42, -1.7, 23.6, 13.8, 16.9, 0.03, 0.1],
  [-12, 0, 4.5, 14.7, 18.7, 0.06, 0.13],
  [2, 1.1, -5, 16.1, 20.4, 0.09, 0.15],
  [7, 1.8, -10.2, 18.1, 21.8, 0.1, 0.17],
  [11, 2.8, -15.4, 20.9, 24, 0.11, 0.19],
  [15, 3.6, -20.1, 23, 26.3, 0.12, 0.22],
  [18.5, 4, -21.7, 23.8, 27.2, 0.13, 0.25],
  [21.7, 4, -22, 24.3, 27.3, 0.13, 0.25],
  [23.8, 4, -22, 23.9, 26.9, 0.13, 0.25],
  [24.4, 4, -22, 23.3, 26.4, 0.13, 0.25],
  [24.4, 4, -22, 22.7, 25.7, 0.13, 0.25],
  [23.7, 4, -22, 22.5, 25.5, 0.13, 0.25],
];
const shellSides = 28;
const white = '#ffffff';
const around = (n, fn) =>
  Array.from({ length: n }, (_, i) => fn((i * TAU) / n));

// The front of the deck is broader, with the rear rim drawn in at the heel of the thumb.
function contour([y, x, z, rx, rz, tiltX, tiltZ], angle) {
  const v = rz * Math.sin(angle);
  const u = rx * Math.cos(angle) * (1 - 0.095 * Math.sin(angle));
  return [x + u, y - tiltX * u - tiltZ * v, z + v];
}

function station(y) {
  const i = shell.findIndex((row) => row[0] >= y);
  return mix(
    shell[i - 1],
    shell[i],
    (y - shell[i - 1][0]) / (shell[i][0] - shell[i - 1][0]),
  );
}

// Shared rim vertices keep specular highlights continuous around moulded parts.
function skin(surface, rows, { bottom = false, top = true } = {}) {
  const n = rows[0].length;
  const ids = rows.map((row, j) =>
    row.map((point, i) => {
      const tangent = sub(row[(i + 1) % n], row[(i + n - 1) % n]);
      const prev = rows[j - 1],
        next = rows[j + 1];
      const up = add(
        prev ? norm(sub(point, prev[i])) : [0, 0, 0],
        next ? norm(sub(next[i], point)) : [0, 0, 0],
      );
      return surface.vertex(point, norm(cross(up, tangent)), white);
    }),
  );
  for (let j = 1; j < rows.length; j++) {
    for (let i = 0; i < n; i++) {
      const k = (i + 1) % n,
        a = ids[j - 1],
        b = ids[j];
      surface.indices.push(a[i], b[i], b[k], a[i], b[k], a[k]);
    }
  }
  if (bottom) face(surface, rows[0], white);
  if (top) face(surface, [...rows.at(-1)].reverse(), white);
}

const deckNormal = norm([0.13, 1, 0.25]);
function deck(x, z, height) {
  return add(
    [x, 24.2 - 0.13 * (x - 4) - 0.25 * (z + 22), z],
    mul(deckNormal, height),
  );
}

function dial(surface, x, z, profile, n, top = true) {
  skin(
    surface,
    profile.map(([rx, rz, h]) =>
      around(n, (a) => deck(x + rx * Math.cos(a), z + rz * Math.sin(a), h)),
    ),
    { top },
  );
}

// Parameterize a control on the curved shell itself so its perimeter follows the plastic.
function gripPoint(angle, y, offset) {
  const row = station(y);
  return contour(
    [row[0], row[1], row[2], row[3] + offset, row[4] + offset, row[5], row[6]],
    angle,
  );
}
// The battery door follows the rear half of the shell. One fine mould line wraps
// across the shoulder and returns to the heel along both sides of the door.
function batteryDoor(surface) {
  const path = [
    [-80, 0.87],
    [-77, 0.86],
    [-74, 0.85],
    [-59, 0.83],
    [-42, 0.86],
    [-26, 0.91],
    [-17, 0.96],
    [-13, 1.02],
    [-10, 1.15],
    [-8, 1.32],
    [-7.1, 1.57],
    [-7, 1.83],
    [-7.5, 2.15],
    [-8.4, 2.47],
    [-10, 2.76],
    [-13, 3.04],
    [-17, 3.22],
    [-26, 3.32],
    [-42, 3.39],
    [-59, 3.43],
    [-74, 3.45],
    [-80, 3.47],
  ];
  // Match the facets of the mould exactly, including their quad diagonals.
  function onShell(y, angle) {
    const j = shell.findIndex((row) => row[0] >= y);
    const lo = shell[j - 1],
      hi = shell[j];
    const t = (y - lo[0]) / (hi[0] - lo[0]),
      step = TAU / shellSides,
      i = Math.floor(angle / step);
    const f = angle / step - i,
      a = contour(lo, i * step),
      b = contour(hi, (i + 1) * step);
    const mid = f < t ? contour(hi, i * step) : contour(lo, (i + 1) * step);
    return add(
      add(mul(a, 1 - Math.max(f, t)), mul(b, Math.min(f, t))),
      mul(mid, Math.abs(t - f)),
    );
  }
  const rows = path.flatMap(([y, a], i) => {
    if (!i) return [[y, a]];
    const prev = path[i - 1],
      steps = Math.ceil(
        Math.max(Math.abs(y - prev[0]) / 4, Math.abs(a - prev[1]) * 10),
      );
    return Array.from({ length: steps }, (_, k) =>
      mix(prev, [y, a], (k + 1) / steps),
    );
  });
  const edges = rows.map(([y, a], i) => {
    const [dy, da] = sub(
      rows[Math.min(i + 1, rows.length - 1)],
      rows[Math.max(i - 1, 0)],
    );
    const [ny, na] = norm([-da * 15, dy]);
    return [-1, 1].map((sign) =>
      add(onShell(y + sign * ny * 0.16, a + (sign * na * 0.16) / 15), [
        0.045 * Math.cos(a),
        0,
        0.045 * Math.sin(a),
      ]),
    );
  });
  for (let i = 1; i < edges.length; i++)
    face(
      surface,
      [edges[i - 1][0], edges[i][0], edges[i][1], edges[i - 1][1]],
      white,
    );
}
function gripButton(surface, radius, layers) {
  skin(
    surface,
    layers.map(([scale, offset]) =>
      around(20, (a) => {
        const y = -20 + 12 * scale * Math.sin(a);
        return gripPoint(
          -0.28 -
            (0.13 * (y + 20)) / 12 +
            radius * scale * Math.cos(a) * (1 + 0.19 * Math.sin(a)),
          y,
          offset,
        );
      }),
    ),
  );
}

// Face legends are flat ink ribbons. Counter-mirror the type in the right-hand mould.
function legend(surface, paths, x, z, height, width, hand) {
  for (const path of paths) {
    const points = path.map(([u, v]) => [x + hand * u, z + v]);
    const edges = points.slice(1).map(([u, v], i) => {
      const [dx, dz] = norm([u - points[i][0], v - points[i][1]]);
      return [-dz, dx];
    });
    const sides = points.map(([u, v], i) => {
      const a = edges[Math.max(0, i - 1)],
        b = edges[Math.min(edges.length - 1, i)];
      const m = norm(add(a, b)),
        w = width / (2 * (m[0] * b[0] + m[1] * b[1]));
      return [-1, 1].map((sign) =>
        deck(u + sign * w * m[0], v + sign * w * m[1], height),
      );
    });
    for (let i = 1; i < sides.length; i++)
      face(
        surface,
        [sides[i - 1][0], sides[i - 1][1], sides[i][1], sides[i][0]],
        white,
      );
  }
}
const letters = {
  X: [
    [
      [-1.4, -1.8],
      [1.4, 1.8],
    ],
    [
      [1.4, -1.8],
      [-1.4, 1.8],
    ],
  ],
  Y: [
    [
      [-1.5, -1.8],
      [0, 0],
      [1.5, -1.8],
    ],
    [
      [0, 0],
      [0, 1.8],
    ],
  ],
  A: [
    [
      [-1.6, 1.8],
      [0, -1.8],
      [1.6, 1.8],
    ],
    [
      [-1, 0.6],
      [1, 0.6],
    ],
  ],
  B: [
    [
      [-1.3, 1.8],
      [-1.3, -1.8],
      [0.55, -1.8],
      [1.15, -1.45],
      [1.35, -0.85],
      [1.1, -0.35],
      [0.55, -0.1],
      [-1.3, -0.1],
    ],
    [
      [0.55, -0.1],
      [1.25, 0.24],
      [1.48, 0.85],
      [1.33, 1.45],
      [0.65, 1.8],
      [-1.3, 1.8],
    ],
  ],
};

function controller(dir, hand) {
  const model = new Model();
  const material = (name, color, rough, metal = 0) =>
    model.material(name, { color, rough, metal });
  const stone = material('Satin stone', '#e6e3dc', 0.36);
  const charcoal = material('Capacitive charcoal', '#1e2229', 0.49);
  const graphite = material('Trigger graphite', '#272b33', 0.34);
  const rubber = material('Thumbstick elastomer', '#363a40', 0.76);
  const joint = material('Recess shadow', '#101318', 0.61);
  const brass = material('Brushed champagne', '#c9a462', 0.34, 0.62);
  const ink = material('Warm grey ink', '#d8d7d0', 0.56);
  skin(
    model.surface(stone, 'Palm shell'),
    shell.map((row) => around(shellSides, (a) => contour(row, a))),
    { bottom: true, top: false },
  );
  batteryDoor(
    model.surface(
      material('Battery door reveal', '#a5a39e', 0.6),
      'Battery door seam',
    ),
  );
  const cap = model.surface(charcoal, 'Touch faceplate');
  skin(
    cap,
    [
      [22.6, 25.6, 23.65],
      [22.6, 25.6, 24.02],
      [22.3, 25.3, 24.2],
    ].map(([rx, rz, y]) =>
      around(shellSides, (a) => contour([y, 4, -22, rx, rz, 0.13, 0.25], a)),
    ),
  );

  const sockets = model.surface(joint, 'Control recesses');
  dial(
    sockets,
    7,
    -30,
    [
      [9.8, 9.8, -0.25],
      [9.4, 9.4, 0.46],
    ],
    22,
  );
  dial(
    model.surface(brass, 'Stick ferrule'),
    7,
    -30,
    [
      [9.15, 9.15, 0.22],
      [9, 9, 0.54],
      [8.45, 8.45, 0.54],
    ],
    22,
    false,
  );
  dial(
    model.surface(graphite, 'Stick gimbal'),
    7,
    -30,
    [
      [8.55, 8.55, 0.37],
      [8.5, 8.5, 0.7],
      [7.4, 7.4, 2.1],
      [5.3, 5.3, 3.15],
      [3.5, 3.5, 3.65],
      [3.5, 3.5, 7.3],
    ],
    20,
    false,
  );
  const stick = model.surface(rubber, 'Dished thumbstick');
  dial(
    stick,
    7,
    -30,
    [
      [3.4, 3.4, 6.5],
      [7.5, 7.5, 7.6],
      [8.1, 8.1, 8.95],
      [7.6, 7.6, 9.55],
      [6.8, 6.8, 9.6],
      [5.9, 5.9, 9.05],
      [3.5, 3.5, 8.47],
      [1.1, 1.1, 8.32],
    ],
    24,
  );
  // A shallow moulded rib follows the inside edge of the thumb cup.
  dial(
    stick,
    7,
    -30,
    [
      [6.42, 6.42, 9.24],
      [6.3, 6.3, 9.41],
      [6.15, 6.15, 9.09],
    ],
    22,
    false,
  );

  const print = model.surface(ink, 'Button legends');
  for (const [x, z, key] of [
    [-6, -10, hand === 1 ? 'X' : 'A'],
    [-10, -23, hand === 1 ? 'Y' : 'B'],
  ]) {
    dial(
      sockets,
      x,
      z,
      [
        [5.15, 5.15, -0.25],
        [4.8, 4.8, 0.35],
      ],
      18,
    );
    dial(
      model.surface(graphite, key + ' button'),
      x,
      z,
      [
        [4.57, 4.57, 0.1],
        [4.61, 4.61, 1.5],
        [4.35, 4.35, 2.12],
        [3.74, 3.74, 2.33],
      ],
      18,
    );
    legend(print, letters[key], x, z, 2.35, 0.46, hand);
  }
  dial(
    sockets,
    5,
    -4.7,
    [
      [4, 4, -0.15],
      [3.55, 3.55, 0.26],
    ],
    16,
  );
  dial(
    model.surface(graphite, hand === 1 ? 'Menu button' : 'Meta button'),
    5,
    -4.7,
    [
      [3.52, 3.52, 0.1],
      [3.4, 3.4, 0.42],
    ],
    16,
  );
  const icon =
    hand === 1
      ? [-0.8, 0, 0.8].map((v) => [
          [-1.35, v],
          [1.35, v],
        ])
      : [
          [
            [-1.85, 0.65],
            [-1.67, -0.3],
            [-1.21, -0.95],
            [-0.7, -1],
            [-0.21, -0.56],
            [0.65, 0.65],
            [1.12, 0.95],
            [1.64, 0.85],
            [1.87, 0.37],
            [1.73, -0.4],
            [1.25, -0.99],
            [0.76, -0.95],
            [0.21, -0.4],
            [-0.6, 0.8],
            [-1.04, 1.03],
            [-1.55, 0.99],
            [-1.85, 0.65],
          ],
        ];
  legend(print, icon, 5, -4.7, 0.44, 0.26, hand);
  dial(
    model.surface(graphite, 'Capacitive thumb rest'),
    17,
    -13.8,
    [
      [5.8, 7.5, -0.1],
      [5.55, 7.2, 0.3],
    ],
    22,
  );

  const trigger = model.surface(graphite, 'Index trigger');
  skin(
    trigger,
    [
      [-15.7, 0, -13.4, 4, 2.9],
      [-15, 0, -14.2, 6.6, 3.9],
      [-13.5, 0, -15.3, 8.3, 4.9],
      [-8, 0, -17.8, 9.1, 6.1],
      [-3, 0, -21.6, 9.5, 7.1],
      [2, 0, -26.6, 9.6, 7.5],
      [6, 0, -28.9, 9.2, 8.1],
      [10, 0, -29.4, 8, 7.7],
      [14, 0, -28, 6.6, 6],
    ].map(([y, x, z, rx, rz]) =>
      around(15, (a) => [
        x + rx * Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.78,
        y,
        z + rz * Math.sin(a),
      ]),
    ),
    { bottom: true },
  );
  gripButton(sockets, 0.57, [
    [1, -0.25],
    [0.99, 0.5],
  ]);
  gripButton(model.surface(graphite, 'Medial squeeze paddle'), 0.53, [
    [1, 0.26],
    [0.94, 1.25],
    [0.7, 1.85],
    [0.32, 2.05],
  ]);

  // The heel has a countersunk oblong cord socket on its underside.
  const heel = (rx, rz, h) =>
    around(16, (a) => {
      const v = -rz * Math.sin(a);
      return [-4 + rx * Math.cos(a), -84 - 0.055 * v - h, 46 + v];
    });
  skin(
    model.surface(brass, 'Lanyard eyelet'),
    [
      [4.6, 2.1, -0.2],
      [4.6, 2.1, 0.26],
      [4.25, 1.85, 0.4],
      [3.35, 1.05, 0.39],
      [3.16, 0.9, 0.05],
    ].map((args) => heel(...args)),
    { top: false, bottom: false },
  );
  skin(sockets, [heel(3.2, 0.94, 0.01), heel(3.17, 0.91, 0.08)]);

  for (const s of model.surfaces) {
    for (let i = 0; i < s.positions.length; i += 3) {
      s.positions[i] *= hand;
      s.normals[i] *= hand;
    }
    if (hand === -1)
      for (let i = 0; i < s.indices.length; i += 3)
        [s.indices[i + 1], s.indices[i + 2]] = [
          s.indices[i + 2],
          s.indices[i + 1],
        ];
    s.positions = s.positions.map((v) => v / 1000);
    if (s.translation) s.translation = s.translation.map((v) => v / 1000);
  }
  model.save(
    join(dir, 'vr-controller-' + (hand === 1 ? 'left' : 'right') + '.glb'),
  );
}

export function vrControllers(dir) {
  controller(dir, 1);
  controller(dir, -1);
}
