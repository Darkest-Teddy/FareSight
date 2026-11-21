import {
  Model,
  box,
  face,
  rect,
  loft,
  rod,
  circle,
  sweep,
  ellipsoid,
  cross,
  sub,
  norm,
  TAU,
  mix,
  rng,
} from './geometry.mjs';
import { focal, json } from './transit.mjs';
import { displayTexture } from './lcd.mjs';

const c = {
  alloy: '#afaec8',
  lip: '#716c93',
  ink: '#293043',
  cream: '#e6d9ae',
  copper: '#882d3b',
  chalk: '#d4d2bf',
  pink: '#ff73ca',
  cyan: '#62e9fa',
  lawn: '#718e78',
  walk: '#e6d8bd',
};
function palette(m) {
  const b = (name, opts) => m.surface(m.material(name, opts));
  return {
    paint: b('Powder-coated alloy', { metal: 0.43, rough: 0.33 }),
    trim: b('Brushed chamfers', { metal: 0.68, rough: 0.26 }),
    city: b('Masonry, foliage and streets', { rough: 0.79 }),
    window: b('Enamel and window panes', { metal: 0.39, rough: 0.25 }),
    glass: b('Spectral architectural glass', {
      alpha: 0.71,
      rough: 0.17,
      metal: 0.23,
      double: true,
    }),
    light: b('Luminous architectural tracery', {
      emission: '#405153',
      rough: 0.35,
    }),
    neonPink: b('Rose discharge tubes', { emission: '#f536a8', rough: 0.26 }),
    neonBlue: b('Ice discharge tubes', { emission: '#18c4ed', rough: 0.26 }),
    bay: b('Fluted instrument glass', { alpha: 0.28, rough: 0.14 }),
  };
}
// Front panel coordinates use X right and Y up. The keypad reclines into its bay as it rises.
function controlPanel(s, x, y, z, w, h, depth, color, tilt = 0.25) {
  const p = (u, v, d) => [x + u, y + v, z - v * tilt + d];
  const front = [
    p(-w / 2, -h / 2, 0),
    p(w / 2, -h / 2, 0),
    p(w / 2, h / 2, 0),
    p(-w / 2, h / 2, 0),
  ];
  face(s, front, color);
  for (let i = 0; i < 4; i++) {
    const k = (i + 1) % 4;
    face(
      s,
      [
        front[i],
        front[i].map((n, j) => n - (j === 2 ? depth : 0)),
        front[k].map((n, j) => n - (j === 2 ? depth : 0)),
        front[k],
      ],
      color,
    );
  }
}
function hardware(m, s, area, station) {
  loft(
    s.paint,
    [
      rect(0, -0.18, 0, 0.842, 0.837, 0.03),
      rect(0, -0.169, 0, 0.889, 0.88, 0.038),
      rect(0, -0.151, 0, 0.895, 0.884, 0.034),
    ],
    c.alloy,
  );
  box(s.paint, 0, -0.085, -0.004, 0.772, 0.135, 0.842, c.ink, 0.03);
  box(s.paint, -0.177, -0.083, 0.402, 0.509, 0.128, 0.049, c.alloy, 0.012);
  box(s.paint, 0.422, -0.083, 0.402, 0.019, 0.128, 0.049, c.alloy, 0.006);
  box(s.paint, 0, -0.085, -0.415, 0.858, 0.135, 0.05, c.alloy, 0.01);
  loft(
    s.trim,
    [
      rect(0, -0.028, 0, 0.879, 0.882, 0.028),
      rect(0, -0.02, 0, 0.9, 0.9, 0.025),
      rect(0, -0.006, 0, 0.9, 0.9, 0.025),
      rect(0, 0, 0, 0.875, 0.875, 0.021),
    ],
    c.lip,
    { top: false },
  );
  const outer = rect(0, 0, 0, 0.875, 0.875, 0.021),
    inner = rect(0, 0, 0, 0.856, 0.856, 0.017);
  for (let i = 0; i < 8; i++) {
    const k = (i + 1) % 8;
    face(s.trim, [inner[i], inner[k], outer[k], outer[i]], c.lip);
  }
  for (const sign of [-1, 1]) {
    // Continuous flank windows reveal cathodes held between two separate chassis rails.
    box(s.bay, sign * 0.433, -0.092, 0, 0.006, 0.103, 0.731, '#9ce2f3', 0.0008);
    for (let j = 0; j < 23; j++) {
      const z = -0.35 + j * 0.032;
      rod(
        j % 5 === 0 ? s.neonPink : s.neonBlue,
        [sign * 0.416, -0.143, z],
        [sign * 0.416, -0.037, z],
        0.008,
        j % 5 === 0 ? c.pink : c.cyan,
        8,
      );
      box(s.trim, sign * 0.439, -0.09, z, 0.007, 0.112, 0.0033, '#9eacc1');
    }
    for (const z of [-0.389, 0.389])
      box(s.trim, sign * 0.419, -0.088, z, 0.049, 0.131, 0.033, c.alloy, 0.007);
    for (let j = 0; j < 12; j++) {
      const v = -0.38 + j * 0.069;
      box(
        s.paint,
        v,
        -0.0107,
        sign * 0.438,
        0.014,
        0.02,
        0.022,
        c.copper,
        0.0025,
      );
      box(
        s.paint,
        sign * 0.438,
        -0.0107,
        v,
        0.022,
        0.02,
        0.014,
        c.copper,
        0.0025,
      );
    }
  }
  const x = -0.245,
    y = -0.083;
  box(s.paint, x, y, 0.428, 0.317, 0.105, 0.014, c.ink, 0.008);
  box(s.trim, x, y, 0.434, 0.304, 0.099, 0.011, '#d3ba82', 0.005);
  const mat = m.material('Backlit cyan LCD', {
      rough: 0.42,
      emission: '#a4ced0',
    }),
    lcd = m.surface(mat, 'LCD_Screen');
  const w = 0.286,
    h = 0.084,
    z = 0.4402;
  face(
    lcd,
    [
      [x - w / 2, y - h / 2, z],
      [x + w / 2, y - h / 2, z],
      [x + w / 2, y + h / 2, z],
      [x - w / 2, y + h / 2, z],
    ],
    '#ffffff',
    [
      [0, 1],
      [1, 1],
      [1, 0],
      [0, 0],
    ],
  );
  m.textures.push({
    bytes: displayTexture(area, station),
    material: mat,
    name: station + ' LCD',
  });
  box(s.trim, -0.017, y, 0.428, 0.124, 0.117, 0.01, '#c3bbbf', 0.007);
  box(s.paint, -0.017, y, 0.433, 0.116, 0.109, 0.002, '#222332', 0.005);
  const center = [-0.017, y, 0.435],
    dial = m.surface(s.trim.material, 'Rotary_Dial', center);
  const knob = (radius, z) =>
    Array.from({ length: 80 }, (_, i) => {
      const a = (i * TAU) / 80,
        r = radius * (i % 2 ? 0.94 : 1);
      return [r * Math.cos(a), r * Math.sin(a), z];
    });
  const rings = [
    knob(0.031, -0.003),
    knob(0.036, 0.002),
    knob(0.036, 0.011),
    knob(0.032, 0.014),
  ];
  for (let j = 1; j < rings.length; j++)
    for (let i = 0; i < 80; i++) {
      const k = (i + 1) % 80;
      face(
        dial,
        [rings[j - 1][i], rings[j - 1][k], rings[j][k], rings[j][i]],
        i % 2 ? c.cream : '#d4b87b',
      );
    }
  // Triangle fan follows each small flute without crossing the concave silhouette.
  for (let i = 0; i < 80; i++)
    face(
      dial,
      [[0, 0, 0.014], rings.at(-1)[i], rings.at(-1)[(i + 1) % 80]],
      c.cream,
    );
  box(dial, 0, 0.02, 0.0144, 0.002, 0.017, 0.0007, '#4d4238');
  for (let i = 0; i < 13; i++) {
    const a = (-0.15 + (i * 1.3) / 12) * Math.PI;
    rod(
      s.trim,
      [center[0] + 0.041 * Math.cos(a), y + 0.041 * Math.sin(a), 0.435],
      [center[0] + 0.047 * Math.cos(a), y + 0.047 * Math.sin(a), 0.435],
      i % 3 === 0 ? 0.0014 : 0.0008,
      c.cream,
      6,
    );
  }
  const panelX = 0.244,
    panelZ = 0.434;
  controlPanel(s.trim, panelX, y, panelZ, 0.35, 0.113, 0.015, '#b7b2b7');
  controlPanel(
    s.paint,
    panelX,
    y,
    panelZ + 0.0015,
    0.343,
    0.107,
    0.003,
    c.cream,
  );
  const keyPart = (surface, dx, dy, w, h, col, lift) =>
    controlPanel(
      surface,
      panelX + dx,
      y + dy,
      panelZ - dy * 0.25 + lift,
      w,
      h,
      0.003,
      col,
    );
  const button = (dx, dy, w, h, col) => {
    keyPart(s.paint, dx, dy, w + 0.0028, h + 0.0028, '#555263', 0.003);
    keyPart(s.window, dx, dy, w, h, col, 0.0058);
  };
  for (let row = 0; row < 4; row++)
    for (let j = 0; j < 7; j++)
      button(
        -0.147 + j * 0.019,
        0.032 - row * 0.02,
        0.014,
        0.015,
        ['#ada3bf', '#b3c1ca', '#c7a8be'][(j + row) % 3],
      );
  for (let j = 0; j < 3; j++) {
    const dx = 0.012 + j * 0.027;
    keyPart(s.trim, dx, 0, 0.013, 0.08, '#a39b95', 0.0024);
    keyPart(s.paint, dx, 0, 0.006, 0.074, '#353845', 0.0031);
    const dy = 0.022 - j * 0.018;
    keyPart(
      s.light,
      dx,
      dy,
      0.016,
      0.021,
      ['#41e978', '#3edcf9', '#ffbd4f'][j],
      0.008,
    );
    keyPart(s.window, dx, dy, 0.011, 0.002, '#f5efd4', 0.0088);
  }
  for (let row = 0; row < 4; row++)
    button(
      0.126,
      0.03 - row * 0.02,
      0.046,
      0.013,
      row === 0 ? '#d3ae76' : '#a1a9ba',
    );
  for (const x of [-0.414, 0.415])
    for (const y of [-0.132, -0.039]) {
      rod(s.trim, [x, y, 0.427], [x, y, 0.43], 0.004, '#bbc4c7', 10);
      box(s.paint, x, y, 0.4302, 0.005, 0.0008, 0.0004, c.ink);
    }
}
function path(s, points, width, color, height = 0.003) {
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i - 1],
      [u, v] = points[i],
      len = Math.hypot(u - x, v - z),
      a = ((-(v - z) / len) * width) / 2,
      b = (((u - x) / len) * width) / 2;
    face(
      s,
      [
        [x + a, height, z + b],
        [u + a, height, v + b],
        [u - a, height, v - b],
        [x - a, height, z - b],
      ],
      color,
    );
  }
}
function building(s, x, z, w, d, h, palette, style = 'brick') {
  const [body, roof, glass] = palette;
  box(s.city, x, 0.005 + h / 2, z, w, h, d, body, 0.003);
  box(s.city, x, h + 0.008, z, w + 0.004, 0.006, d + 0.004, roof, 0.002);
  box(
    s.city,
    x - w * 0.16,
    h + 0.014,
    z - d * 0.16,
    w * 0.28,
    0.009,
    d * 0.32,
    '#9b9e9e',
    0.001,
  );
  const rows = Math.max(2, Math.floor(h / 0.024));
  for (let row = 0; row < rows; row++) {
    const y = 0.018 + (row * (h - 0.02)) / rows,
      columns = Math.max(2, Math.round(w / 0.018)),
      side = Math.max(2, Math.round(d / 0.019));
    for (const sideSign of [-1, 1]) {
      const zFace = z + sideSign * (d / 2 + 0.00012);
      for (let i = 0; i < columns; i++) {
        const cx = x + w * ((i + 0.5) / columns - 0.5),
          ww = (w / columns) * 0.5,
          wh = Math.min(0.012, (h / rows) * 0.58);
        const v = [
          [cx - ww / 2, y - wh / 2, zFace],
          [cx + ww / 2, y - wh / 2, zFace],
          [cx + ww / 2, y + wh / 2, zFace],
          [cx - ww / 2, y + wh / 2, zFace],
        ];
        face(
          s.window,
          sideSign > 0 ? v : v.reverse(),
          (i + row) % 5 === 0 ? '#e4c79b' : glass,
        );
      }
      const xx = x + sideSign * (w / 2 + 0.00012);
      for (let i = 0; i < side; i++) {
        const cz = z + d * ((i + 0.5) / side - 0.5),
          ww = (d / side) * 0.53,
          wh = Math.min(0.012, (h / rows) * 0.58);
        const v = [
          [xx, y - wh / 2, cz + ww / 2],
          [xx, y - wh / 2, cz - ww / 2],
          [xx, y + wh / 2, cz - ww / 2],
          [xx, y + wh / 2, cz + ww / 2],
        ];
        face(s.window, sideSign > 0 ? v : v.reverse(), glass);
      }
    }
    if (style === 'stone' && row % 2 === 0)
      box(s.city, x, y + 0.009, z, w + 0.002, 0.002, d + 0.002, roof);
  }
  if (style === 'shop') {
    box(
      s.paint,
      x,
      0.033,
      z + d / 2 + 0.007,
      w * 0.93,
      0.006,
      0.019,
      roof,
      0.002,
    );
    box(s.light, x, 0.048, z + d / 2 + 0.001, w * 0.71, 0.008, 0.002, glass);
  }
}
// Cut glass changes hue across a facet. Independent triangle normals keep each fold sharp.
const dichroic = {
  rose: [
    '#633792',
    '#d923a1',
    '#ff70c8',
    '#b78bf8',
    '#54ceef',
    '#ad3ada',
    '#ff84d2',
    '#bc42ac',
  ],
  ice: [
    '#3a56b3',
    '#18cdeb',
    '#83f8ff',
    '#817eea',
    '#b85ee3',
    '#4c70d3',
    '#43bedc',
    '#7561cc',
  ],
};
function cutFace(surface, a, b, c, ca, cb, cc) {
  const n = norm(cross(sub(b, a), sub(c, a)));
  surface.indices.push(
    surface.vertex(a, n, ca),
    surface.vertex(b, n, cb),
    surface.vertex(c, n, cc),
  );
}
function crystal(s, x, z, w, d, levels, tint) {
  const rose = tint === c.pink;
  const hue = rose ? dichroic.rose : dichroic.ice;
  const neon = rose ? s.neonPink : s.neonBlue;
  const rings = levels.map(([y, scale, dx = 0, dz = 0, rake = 0], j) => {
    const cx = x + dx,
      cz = z + dz;
    return rect(
      cx,
      y,
      cz,
      w * scale,
      d * scale,
      Math.min(w, d) * scale * (0.18 + 0.07 * (j % 2)),
    ).map(([px, py, pz]) => [
      px,
      py + rake * ((px - cx) / w - (0.44 * (pz - cz)) / d),
      pz,
    ]);
  });
  for (let j = 1; j < rings.length; j++) {
    const lo = rings[j - 1],
      hi = rings[j];
    const rise = levels[j][0] - levels[j - 1][0];
    for (let i = 0; i < 8; i++) {
      const k = (i + 1) % 8;
      cutFace(
        s.glass,
        lo[i],
        hi[i],
        hi[k],
        hue[(i + 5) % 8],
        hue[(i + 1) % 8],
        hue[i],
      );
      cutFace(
        s.glass,
        lo[i],
        hi[k],
        lo[k],
        hue[(i + 5) % 8],
        hue[i],
        hue[(i + 6) % 8],
      );
      if (i % 2 === 0) {
        sweep(neon, [lo[i], hi[i]], 0.0012, tint, 4, false);
        if (rise > 0.058 && w > 0.032 && (i === 0 || i === 2 || i === 6))
          sweep(
            s.light,
            [lo[i], hi[k]],
            0.001,
            rose ? '#d3a0ec' : '#94bed8',
            4,
            false,
          );
      }
      // A small bank of etched lamellae leaves the broad faces of the prism open.
      if (w > 0.035 && rise > 0.085 && (i === 0 || i === 4)) {
        for (let band = 1; band <= 5; band++) {
          const f = 0.14 + band * 0.054;
          sweep(
            s.window,
            [mix(lo[i], hi[i], f), mix(lo[k], hi[k], f)],
            0.00065,
            '#aea1c7',
            3,
            false,
          );
        }
      }
    }
    sweep(neon, [...hi, hi[0]], 0.0011, tint, 4, false);
  }
  face(s.glass, rings[0], hue[0]);
  face(s.glass, [...rings.at(-1)].reverse(), hue[3]);
  // A luminous internal fin stays visible through the tinted envelope from either side.
  if (w >= 0.05) {
    const foot = rings[0],
      cap = rings.at(-1);
    const spine = [
      mix(foot[2], foot[6], 0.43),
      mix(foot[2], foot[6], 0.58),
      mix(cap[0], cap[4], 0.47),
      mix(cap[0], cap[4], 0.35),
    ];
    face(neon, spine, tint);
    face(neon, [...spine].reverse(), tint);
  }
}
function needle(s, x, z, base, tip, width, color) {
  const shaft = rect(x, base, z, width, width * 0.76, width * 0.16);
  const shoulder = rect(
    x,
    tip - width * 1.4,
    z,
    width * 0.57,
    width * 0.5,
    width * 0.1,
  );
  loft(s.glass, [shaft, shoulder], color, { top: false });
  const apex = [x + width * 0.09, tip, z];
  for (let i = 0; i < 8; i++)
    face(
      s.trim,
      [shoulder[i], apex, shoulder[(i + 1) % 8]],
      i % 2 ? c.cream : color,
    );
  for (const i of [0, 3, 6])
    sweep(
      color === c.pink ? s.neonPink : s.neonBlue,
      [shaft[i], shoulder[i]],
      0.0009,
      color,
      4,
      false,
    );
}
const brick = ['#a67670', '#766d78', '#45566a'],
  stone = ['#cfcac0', '#94939e', '#566876'];
function midrise(s, x, z, w, d, h, kind) {
  const sliver = kind === 'curtain';
  const exterior = sliver ? '#8bafba' : '#c8c6c3';
  const stories = sliver ? 2 : 3;
  for (let j = 0; j < stories; j++) {
    const y = 0.005 + (h * j) / stories;
    const cx = x - w * j * 0.047,
      cz = z - d * j * 0.042;
    const width = w * (1 - j * (sliver ? 0.06 : 0.13)),
      depth = d * (1 - j * 0.08);
    const chamfer = width * (sliver ? 0.2 : 0.08);
    const floor = (height, overhang = 0) =>
      rect(cx, height, cz, width + overhang, depth + overhang, chamfer);
    const ht = h / stories;
    loft(s.window, [floor(y), floor(y + ht)], sliver ? '#68839d' : '#687887');
    for (const f of sliver ? [0.18, 0.96] : [0.13, 0.56, 0.95]) {
      const yBand = y + ht * f;
      loft(
        s.city,
        [floor(yBand - 0.0014, 0.0028), floor(yBand + 0.0014, 0.0028)],
        exterior,
        { bottom: false },
      );
    }
    const corners = floor(y, 0.0006),
      top = floor(y + ht, 0.0006);
    for (const i of [0, 2, 4, 6]) {
      const k = (i + 1) % 8;
      for (const t of [0.22, 0.53, 0.82])
        sweep(
          s.city,
          [mix(corners[i], corners[k], t), mix(top[i], top[k], t)],
          0.0006,
          exterior,
          3,
          false,
        );
    }
  }
  box(
    s.city,
    x - w * 0.14,
    h + 0.013,
    z - d * 0.15,
    w * 0.38,
    0.016,
    d * 0.35,
    '#9a9ca4',
    0.002,
  );
  for (let i = 0; i < 4; i++)
    box(
      s.window,
      x - w * 0.23 + w * 0.06 * i,
      h + 0.021,
      z - d * 0.15,
      w * 0.027,
      0.001,
      d * 0.2,
      '#586676',
    );
}
function brownstone(s, x, z, w, d, h) {
  building(s, x, z, w, d, h, brick);
  const roofY = h + 0.012;
  loft(
    s.city,
    [
      rect(x, roofY, z, w * 1.07, d * 1.07, 0.003),
      rect(x, roofY + 0.024, z, w * 0.81, d * 0.69, 0.002),
    ],
    '#63677a',
  );
  for (const dx of [-0.26, 0.26]) {
    const cx = x + w * dx,
      cz = z + d * 0.39;
    box(s.city, cx, roofY + 0.011, cz, 0.015, 0.018, 0.011, '#d1b7a1');
    box(
      s.window,
      cx,
      roofY + 0.012,
      cz + 0.0057,
      0.008,
      0.009,
      0.001,
      '#3f5869',
    );
    loft(
      s.trim,
      [
        rect(cx, roofY + 0.019, cz, 0.019, 0.015),
        rect(cx, roofY + 0.024, cz, 0.005, 0.013),
      ],
      '#777583',
    );
  }
  box(
    s.city,
    x - w * 0.23,
    roofY + 0.026,
    z - d * 0.23,
    0.011,
    0.025,
    0.015,
    brick[0],
  );
}
function landmark(s, index) {
  if (index === 0) {
    // Each cantilever turns above a narrower bearing, with the tallest blade behind the crown.
    for (const [x, z, w, d, y, h, shift, rake, color] of [
      [-0.035, -0.07, 0.157, 0.129, 0.006, 0.132, -0.009, -0.024, c.cyan],
      [-0.055, -0.08, 0.195, 0.14, 0.129, 0.114, 0.015, 0.029, c.pink],
      [-0.015, -0.084, 0.159, 0.157, 0.235, 0.108, 0.014, 0.033, c.cyan],
      [-0.035, -0.077, 0.18, 0.132, 0.332, 0.149, -0.018, 0.06, c.pink],
    ]) {
      crystal(
        s,
        x,
        z,
        w,
        d,
        [
          [y, 0.85],
          [y + h * 0.2, 1.02, shift],
          [y + h, 0.88, shift * 1.6, -0.01, rake],
        ],
        color,
      );
    }
    crystal(
      s,
      0.077,
      -0.123,
      0.104,
      0.093,
      [
        [0.005, 0.92],
        [0.225, 0.83],
        [0.345, 1.04, 0.017, 0, 0.058],
      ],
      c.pink,
    );
    crystal(
      s,
      -0.142,
      -0.127,
      0.073,
      0.08,
      [
        [0.004, 1],
        [0.202, 0.85, -0.013],
        [0.292, 0.95, -0.005, 0, 0.044],
      ],
      c.cyan,
    );
    crystal(
      s,
      -0.103,
      -0.146,
      0.083,
      0.067,
      [
        [0.008, 1],
        [0.333, 0.75, -0.019],
        [0.45, 0.68, -0.014, 0, 0.042],
      ],
      c.pink,
    );
    for (let tier = 0; tier < 3; tier++) {
      const y = 0.008 + tier * 0.033;
      crystal(
        s,
        0.041,
        0.03 - tier * 0.011,
        0.112 - tier * 0.016,
        0.073 - tier * 0.01,
        [
          [y, 1],
          [y + 0.032, 1],
        ],
        tier === 2 ? c.pink : c.cyan,
      );
    }
    needle(s, -0.078, -0.122, 0.43, 0.605, 0.023, c.pink);
    needle(s, 0.06, -0.159, 0.26, 0.487, 0.014, c.cyan);
    needle(s, -0.148, -0.125, 0.265, 0.411, 0.013, c.cyan);
    // The bridge crosses the Charles perpendicular to its banks.
    const bx = 0.126;
    box(s.city, bx, 0.016, -0.315, 0.047, 0.01, 0.157, '#78828e');
    for (const x of [bx - 0.023, bx + 0.023]) {
      const arch = Array.from({ length: 9 }, (_, i) => [
        x,
        0.027 + 0.034 * Math.sin((Math.PI * i) / 8),
        -0.391 + i * 0.019,
      ]);
      sweep(s.trim, arch, 0.0026, '#c6b2af', 5);
      for (let i = 0; i < arch.length - 1; i++) {
        const foot = [x, 0.02, arch[i][2]];
        sweep(s.paint, [foot, arch[i]], 0.0014, '#83576a', 4, false);
        sweep(s.paint, [foot, arch[i + 1]], 0.0014, '#83576a', 4, false);
      }
    }
    for (const x of [-0.09, 0.075]) {
      box(s.city, x, 0.0045, 0.211, 0.13, 0.004, 0.011, '#c7c3b1', 0.003);
      box(s.city, x, 0.007, 0.211, 0.121, 0.002, 0.007, '#799877', 0.002);
    }
    path(
      s.city,
      [
        [-0.42, -0.34],
        [-0.18, -0.315],
        [0.06, -0.33],
        [0.42, -0.305],
      ],
      0.104,
      '#71b5bd',
      0.005,
    );
    path(
      s.light,
      [
        [-0.418, -0.282],
        [-0.18, -0.258],
        [0.06, -0.273],
        [0.42, -0.248],
      ],
      0.005,
      '#d5f4e1',
      0.006,
    );
  } else if (index === 1) {
    for (const [x, z, h, col] of [
      [-0.11, -0.096, 0.45, c.pink],
      [0.06, -0.075, 0.364, c.cyan],
    ]) {
      crystal(
        s,
        x,
        z,
        0.103,
        0.112,
        [
          [0.006, 1],
          [h * 0.58, 0.81, -0.014],
          [h * 0.78, 1.23, 0.017, 0, 0.035],
          [h, 0.67, 0.037, -0.008, 0.071],
        ],
        col,
      );
      for (let j = 0; j < 4; j++)
        box(
          s.light,
          x,
          h * 0.64 + j * 0.012,
          z + 0.055,
          0.112,
          0.004,
          0.005,
          j % 2 ? c.cream : col,
        );
    }
    needle(s, -0.102, -0.13, 0.4, 0.535, 0.016, c.pink);
    needle(s, 0.061, -0.109, 0.33, 0.41, 0.013, c.cyan);
    // A projecting blade sign points down the avenue.
    const blade = [
      [-0.157, 0.314, -0.044],
      [-0.067, 0.33, -0.044],
      [-0.12, 0.236, 0.026],
    ];
    face(s.glass, blade, '#f9a4cf');
    sweep(s.neonPink, [...blade, blade[0]], 0.0024, c.pink, 5, false);
    for (const [x, z, width, h] of [
      [-0.041, 0.015, 0.112, 0.153],
      [0.036, 0.033, 0.081, 0.111],
    ]) {
      crystal(
        s,
        x,
        z,
        width,
        0.068,
        [
          [0.005, 1],
          [h * 0.66, 1],
          [h, 0.73, -0.009],
        ],
        x < 0 ? c.pink : c.cyan,
      );
    }
    for (const [i, clr] of [c.pink, c.cyan, '#f6c673'].entries()) {
      const x = -0.134 + i * 0.121;
      const h = 0.098 - i * 0.021;
      building(s, x, 0.097, 0.09, 0.063, h, [brick[0], clr, brick[2]], 'shop');
      box(
        s.paint,
        x - 0.008,
        h + 0.023,
        0.088,
        0.059,
        0.026,
        0.042,
        '#b8a6aa',
        0.006,
      );
      for (const y of [0.031, 0.037])
        box(
          i === 1 ? s.neonBlue : s.neonPink,
          x,
          y,
          0.146,
          0.084,
          0.002,
          0.003,
          clr,
        );
      box(s.window, x, 0.019, 0.129, 0.071, 0.016, 0.002, '#455977');
    }
  } else if (index === 2) {
    // Open, faceted ballpark seating and the tall left-field wall.
    const x = -0.084,
      z = 0.054;
    const bowl = (rx, rz, y) =>
      Array.from({ length: 27 }, (_, i) => {
        const a = (-0.15 + (i / 26) * 1.73) * Math.PI;
        return [x + rx * Math.cos(a), y, z + rz * Math.sin(a)];
      });
    // Continuous treads and risers keep the upper deck open around the outfield.
    for (let tier = 0; tier < 6; tier++) {
      const rx = 0.083 + tier * 0.01,
        rz = 0.056 + tier * 0.009,
        y = 0.014 + tier * 0.011;
      const foot = bowl(rx, rz, y),
        lip = bowl(rx, rz, y + 0.009),
        back = bowl(rx + 0.01, rz + 0.009, y + 0.009);
      for (let i = 0; i < lip.length - 1; i++) {
        const aisle = i % 6 === 0;
        face(
          s.glass,
          [foot[i], foot[i + 1], lip[i + 1], lip[i]],
          tier % 3 ? '#66d6e2' : '#db82cb',
        );
        face(
          aisle ? s.city : s.glass,
          [lip[i], lip[i + 1], back[i + 1], back[i]],
          aisle ? '#d7d7c5' : tier % 2 ? '#d87acc' : '#90dce8',
        );
      }
      sweep(
        tier === 5 ? s.neonPink : s.light,
        lip,
        0.0013,
        tier === 5 ? c.pink : c.cyan,
        4,
        false,
      );
    }
    for (const [lx, lz] of [
      [-0.172, -0.027],
      [-0.192, 0.113],
      [0.035, 0.093],
    ]) {
      for (const sign of [-1, 1])
        sweep(
          s.trim,
          [
            [lx + sign * 0.007, 0.035, lz],
            [lx + sign * 0.003, 0.137, lz],
          ],
          0.0016,
          '#a2a6b4',
          4,
        );
      box(s.paint, lx, 0.14, lz, 0.034, 0.012, 0.007, '#4d5d6b');
      for (let j = 0; j < 5; j++)
        box(
          s.light,
          lx - 0.013 + 0.0065 * j,
          0.14,
          lz + 0.004,
          0.0045,
          0.007,
          0.002,
          '#fff2c5',
        );
    }
    box(s.city, x, 0.007, z, 0.164, 0.097 * 0.06, 0.104, '#5f9f78', 0.013);
    face(
      s.city,
      [
        [x - 0.033, 0.011, z],
        [x, 0.011, z + 0.033],
        [x + 0.033, 0.011, z],
        [x, 0.011, z - 0.033],
      ],
      '#c69e77',
    );
    box(s.city, x, 0.028, z - 0.081, 0.178, 0.045, 0.006, '#417e67');
    box(s.window, x - 0.02, 0.029, z - 0.0777, 0.08, 0.023, 0.001, '#315e56');
    for (let j = 0; j < 9; j++)
      box(
        s.city,
        x - 0.05 + j * 0.008,
        0.033,
        z - 0.077,
        0.0035,
        0.005,
        0.001,
        '#d6dab7',
      );
    for (const dx of [-0.034, 0.034])
      path(
        s.city,
        [
          [x, z + 0.033],
          [x + dx, z],
        ],
        0.0018,
        '#f7ecd7',
        0.0117,
      );
    for (const [px, pz] of [
      [x, z - 0.033],
      [x - 0.033, z],
      [x + 0.033, z],
      [x, z + 0.033],
    ])
      box(s.city, px, 0.012, pz, 0.005, 0.001, 0.005, '#f6e7d2');
    crystal(
      s,
      0.041,
      -0.098,
      0.082,
      0.075,
      [
        [0.006, 1],
        [0.162, 0.9, -0.008],
        [0.246, 0.65, -0.02, 0, 0.04],
      ],
      c.pink,
    );
    crystal(
      s,
      0.098,
      -0.127,
      0.096,
      0.08,
      [
        [0.005, 1],
        [0.211, 0.89, -0.011],
        [0.314, 0.77, 0.008, 0, 0.045],
      ],
      c.cyan,
    );
    needle(s, 0.127, -0.157, 0.247, 0.387, 0.012, c.cyan);
    for (const dx of [-0.039, 0.039])
      rod(
        s.trim,
        [0.098 + dx, 0.3, -0.127],
        [0.098 + dx, 0.456, -0.127],
        0.004,
        c.cream,
        8,
      );
    box(s.paint, 0.098, 0.442, -0.127, 0.152, 0.129, 0.012, '#d7d7c7', 0.004);
    for (let j = 0; j < 9; j++)
      box(
        s.light,
        0.098,
        0.384 + j * 0.014,
        -0.12,
        0.142,
        0.0018,
        0.002,
        '#9cbbd1',
      );
    const corners = [
      [0.098, 0.489, -0.114],
      [0.041, 0.405, -0.114],
      [0.155, 0.405, -0.114],
    ];
    sweep(s.neonPink, [...corners, corners[0]], 0.0024, '#ff896e', 5, false);
    for (const [k, clr] of ['#e96358', '#ff9683', '#e6425b'].entries()) {
      const a = [0.098, 0.489, -0.117],
        b = [0.041, 0.405, -0.117],
        d = [0.155, 0.405, -0.117],
        mid = [0.098, 0.432, -0.114];
      face(
        s.light,
        [
          ...[
            [b, d],
            [d, a],
            [a, b],
          ][k],
          mid,
        ],
        clr,
      );
    }
  } else if (index === 3) {
    building(s, -0.065, -0.097, 0.204, 0.09, 0.111, brick, 'stone');
    loft(
      s.city,
      [
        rect(-0.065, 0.116, -0.097, 0.215, 0.101),
        rect(-0.065, 0.169, -0.097, 0.19, 0.012),
      ],
      '#59657a',
    );
    crystal(
      s,
      -0.023,
      -0.103,
      0.08,
      0.08,
      [
        [0.115, 1],
        [0.286, 0.87],
        [0.303, 1.06],
        [0.354, 0.68, 0, 0, 0.021],
        [0.504, 0.1],
      ],
      c.pink,
    );
    rod(
      s.trim,
      [-0.023, 0.498, -0.103],
      [-0.023, 0.525, -0.103],
      0.0018,
      c.cream,
      6,
    );
    for (const x of [-0.069, 0.023])
      crystal(
        s,
        x,
        -0.103,
        0.017,
        0.018,
        [
          [0.153, 1],
          [0.276, 0.8],
          [0.323, 0.15],
        ],
        c.cyan,
      );
    for (const x of [-0.136, -0.098, 0.014]) {
      const z = -0.0505;
      const arch = [
        [x - 0.011, 0.047, z],
        [x + 0.011, 0.047, z],
        [x + 0.011, 0.091, z],
        [x, 0.104, z],
        [x - 0.011, 0.091, z],
      ];
      face(s.window, arch, '#485d72');
      sweep(s.trim, [...arch, arch[0]], 0.0018, '#d1b3a4', 4, false);
      sweep(
        s.light,
        [
          [x, 0.05, z + 0.001],
          [x, 0.097, z + 0.001],
        ],
        0.0008,
        '#b4d7df',
        4,
        false,
      );
    }
    for (const [x, z, h] of [
      [-0.077, -0.062, 0.256],
      [0.024, -0.066, 0.298],
    ]) {
      crystal(
        s,
        x,
        z,
        0.029,
        0.034,
        [
          [0.113, 1],
          [h - 0.047, 0.88],
          [h, 0.14],
        ],
        x < 0 ? c.pink : c.cyan,
      );
    }
    const clockX = -0.023,
      clockY = 0.269,
      clockZ = -0.066;
    const dial = Array.from({ length: 25 }, (_, i) => {
      const a = (i * TAU) / 25;
      return [
        clockX + 0.023 * Math.cos(a),
        clockY + 0.023 * Math.sin(a),
        clockZ,
      ];
    });
    face(s.window, dial, '#34425b');
    sweep(s.light, [...dial, dial[0]], 0.0018, '#f3d9ab', 5, false);
    for (let j = 0; j < 12; j++) {
      const a = (TAU * j) / 12;
      sweep(
        s.light,
        [0.016, 0.02].map((r) => [
          clockX + r * Math.cos(a),
          clockY + r * Math.sin(a),
          clockZ + 0.001,
        ]),
        0.0008,
        c.cream,
        4,
        false,
      );
    }
    sweep(
      s.light,
      [
        [clockX - 0.01, clockY + 0.007, clockZ + 0.002],
        [clockX, clockY, clockZ + 0.002],
        [clockX + 0.004, clockY + 0.016, clockZ + 0.002],
      ],
      0.0013,
      c.cream,
      4,
    );
    // Widener's long temple front looks over a stair and the Yard.
    const libraryX = 0.11;
    building(s, libraryX, 0.032, 0.14, 0.092, 0.075, stone, 'stone');
    for (let j = 0; j < 4; j++)
      box(
        s.city,
        libraryX,
        0.006 + j * 0.003,
        0.088 + j * -0.003,
        0.128 - j * 0.002,
        0.006 + j * 0.005,
        0.072 - j * 0.009,
        '#d5cbb5',
      );
    for (let j = 0; j < 8; j++) {
      const cx = libraryX - 0.053 + j * 0.015;
      rod(s.city, [cx, 0.021, 0.093], [cx, 0.081, 0.093], 0.004, '#e5ddce', 8);
      box(s.city, cx, 0.08, 0.093, 0.011, 0.006, 0.011, stone[0]);
    }
    box(s.city, libraryX, 0.086, 0.087, 0.138, 0.01, 0.034, '#c6b8a6');
    const pediment = [
      [0.04, 0.091, 0.105],
      [0.18, 0.091, 0.105],
      [libraryX, 0.116, 0.105],
    ];
    face(s.city, pediment, '#cfbdac');
    sweep(s.trim, [...pediment, pediment[0]], 0.0023, '#ede1cf', 4, false);
    for (const z of [0.171, 0.148])
      path(
        s.city,
        [
          [-0.16, z],
          [0.16, z - 0.01],
        ],
        0.008,
        c.walk,
        0.006,
      );
    path(
      s.city,
      [
        [-0.2, 0.15],
        [-0.04, 0.084],
        [0.025, 0.03],
        [0.183, -0.012],
      ],
      0.022,
      c.walk,
      0.006,
    );
  } else {
    crystal(
      s,
      -0.089,
      -0.13,
      0.11,
      0.103,
      [
        [0.005, 1],
        [0.347, 1],
        [0.44, 1.03, 0.017, 0, 0.088],
        [0.517, 0.56, 0.033, -0.006, 0.063],
      ],
      c.pink,
    );
    crystal(
      s,
      0.072,
      -0.174,
      0.088,
      0.092,
      [
        [0.005, 1],
        [0.286, 0.84, 0.018],
        [0.427, 1.09, 0.025, 0, 0.067],
        [0.536, 0.59, 0.008, -0.014, 0.062],
      ],
      c.cyan,
    );
    needle(s, 0.06, -0.198, 0.421, 0.601, 0.018, c.cyan);
    needle(s, -0.112, -0.159, 0.405, 0.552, 0.013, c.pink);
    crystal(
      s,
      0.006,
      -0.088,
      0.073,
      0.08,
      [
        [0.006, 1],
        [0.135, 0.82, 0.008],
        [0.285, 0.79, -0.015, -0.01, 0.063],
      ],
      c.pink,
    );
    box(s.city, 0, 0.0045, 0.104, 0.319, 0.006, 0.14, '#c2a8a2', 0.018);
    path(
      s.city,
      [
        [0, 0.033],
        [0, 0.189],
      ],
      0.093,
      '#d7c6b7',
      0.008,
    );
    for (const x of [-0.051, 0.051])
      path(
        s.city,
        [
          [x, 0.049],
          [x, 0.176],
        ],
        0.003,
        '#a58685',
        0.0082,
      );
    // Paifang pillars, corbels, and sweeping, upturned tiled roofs.
    for (const x of [-0.132, -0.066, 0.066, 0.132]) {
      box(s.city, x, 0.015, 0.118, 0.022, 0.03, 0.025, '#dfd1b5', 0.003);
      rod(
        s.paint,
        [x, 0.021, 0.118],
        [x, Math.abs(x) < 0.1 ? 0.143 : 0.105, 0.118],
        0.008,
        '#b43f43',
        12,
      );
      for (let j = 0; j < 3; j++)
        box(
          s.trim,
          x,
          0.089 + j * 0.008,
          0.118,
          0.018 + j * 0.011,
          0.005,
          0.021,
          c.cream,
        );
    }
    for (const [x, w, y] of [
      [0, 0.169, 0.146],
      [0, 0.119, 0.185],
      [-0.111, 0.09, 0.111],
      [0.111, 0.09, 0.111],
    ]) {
      box(s.light, x, y - 0.023, 0.118, w * 0.9, 0.023, 0.021, '#67b9ac');
      if (y === 0.146) {
        box(s.trim, x, y - 0.022, 0.131, 0.059, 0.02, 0.004, '#d5ab73', 0.0015);
        box(s.window, x, y - 0.022, 0.134, 0.051, 0.015, 0.002, '#364c64');
        for (const dx of [-0.043, 0.043]) {
          sweep(
            s.trim,
            [
              [x + dx, y - 0.027, 0.125],
              [x + dx, y - 0.047, 0.125],
            ],
            0.001,
            '#c99968',
            4,
            false,
          );
          ellipsoid(
            s.paint,
            [x + dx, y - 0.05, 0.125],
            [0.006, 0.008, 0.006],
            '#d95354',
            8,
            5,
          );
        }
      }
      for (let j = 0; j < 12; j++) {
        const a = -1 + (2 * j) / 12,
          b = -1 + (2 * (j + 1)) / 12;
        const p = (v, d) => [
          x + (v * w) / 2,
          y + 0.019 * Math.abs(v) ** 3 + (1 - Math.abs(d)) * 0.025,
          0.118 + d * 0.029,
        ];
        for (const d of [-1, 1])
          face(
            s.city,
            d < 0
              ? [p(a, 0), p(b, 0), p(b, d), p(a, d)]
              : [p(a, d), p(b, d), p(b, 0), p(a, 0)],
            j % 3 === 1 ? '#477f85' : '#5a9794',
          );
        for (const d of [-1, 1])
          sweep(
            d === 1 && y > 0.17 ? s.neonPink : s.neonBlue,
            [p(a, d), p(b, d)],
            0.0016,
            c.cyan,
            4,
            false,
          );
        if (j % 2 === 0)
          for (const d of [-1, 1])
            sweep(s.trim, [p(a, 0), p(a, d)], 0.0009, '#a5bfb1', 4, false);
      }
    }
  }
}
function tree(s, x, z, h, pine, random) {
  rod(s.city, [x, 0.004, z], [x, h * 0.61, z], 0.0028, '#7e6e52', 7);
  if (pine) {
    for (let j = 0; j < 3; j++) {
      const y = h * (0.24 + j * 0.17),
        r = h * (0.24 - j * 0.043);
      loft(
        s.city,
        [
          circle(x, y, z, r, 9),
          circle(x, y + h * (0.38 - j * 0.045), z, 0.0015, 9),
        ],
        ['#286958', '#378969', '#63a56c'][j],
      );
    }
  } else {
    for (let j = 0; j < 3; j++) {
      const a = (j * TAU) / 3 + random() * 0.4,
        k = h * 0.13;
      ellipsoid(
        s.city,
        [x + k * Math.cos(a), h * (0.64 + j * 0.055), z + k * Math.sin(a)],
        [h * 0.22, h * 0.235, h * 0.22],
        ['#72ae75', '#8abb73', '#5da17c'][j],
        9,
        5,
      );
    }
  }
}
function roofAt(m, x, z) {
  let y = 0;
  for (const s of m.surfaces) {
    const [dx, dy, dz] = s.translation ?? [0, 0, 0];
    const q = x - dx,
      r = z - dz;
    for (let j = 0; j < s.indices.length; j += 3) {
      const [a, b, c] = s.indices
        .slice(j, j + 3)
        .map((k) => s.positions.slice(k * 3, k * 3 + 3));
      const d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((b[2] - c[2]) * (q - c[0]) + (c[0] - b[0]) * (r - c[2])) / d,
        v = ((c[2] - a[2]) * (q - c[0]) + (a[0] - c[0]) * (r - c[2])) / d;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001)
        y = Math.max(y, dy + u * a[1] + v * b[1] + (1 - u - v) * c[1]);
    }
  }
  return y;
}
export function segments(dir) {
  const anchors = {};
  focal.forEach(([id, , station, area], index) => {
    const m = new Model(),
      s = palette(m),
      random = rng(700 + index);
    hardware(m, s, area, station);
    box(s.city, 0, -0.0035, 0, 0.856, 0.007, 0.856, c.lawn, 0.017);
    // Streets flank the landmark district. Each block has a sidewalk apron and roof trim.
    path(
      s.city,
      [
        [-0.403, -0.043],
        [-0.236, -0.035],
        [-0.145, 0.046],
        [-0.08, 0.126],
        [0.066, 0.158],
        [0.18, 0.12],
        [0.303, 0.11],
      ],
      0.014,
      c.walk,
      0.0015,
    );
    path(
      s.city,
      [
        [-0.08, 0.126],
        [-0.105, 0.216],
        [-0.083, 0.29],
        [-0.088, 0.41],
      ],
      0.013,
      c.walk,
      0.0016,
    );
    for (const x of [-0.218, 0.218])
      path(
        s.city,
        [
          [x, -0.419],
          [x, 0.417],
        ],
        0.05,
        '#73808a',
        0.002,
      );
    for (const z of [-0.228, 0.211])
      path(
        s.city,
        [
          [-0.42, z],
          [0.42, z],
        ],
        0.048,
        '#79848b',
        0.0025,
      );
    for (const z of [-0.228, 0.211])
      for (let i = 0; i < 21; i++) {
        box(
          s.city,
          -0.402 + i * 0.04,
          0.0032,
          z,
          0.017,
          0.0004,
          0.0015,
          '#e6dbbb',
        );
      }
    for (const x of [-0.218, 0.218])
      for (const z of [-0.228, 0.211])
        for (let i = 0; i < 6; i++)
          box(
            s.city,
            x - 0.017 + i * 0.0068,
            0.0037,
            z + 0.028,
            0.003,
            0.0004,
            0.015,
            '#dedcc8',
          );
    const parcels = [
      [-0.32, -0.13],
      [-0.32, 0.034],
      [-0.326, 0.315],
      [-0.14, 0.318],
      [0.017, 0.319],
      [0.151, 0.32],
      [0.322, 0.315],
      [0.327, 0.075],
      [0.322, -0.116],
      [-0.311, -0.322],
      [0.314, -0.32],
    ];
    const blockStyles = [
      [
        'curtain',
        'stone',
        'slab',
        'brownstone',
        'slab',
        'stone',
        'curtain',
        'slab',
        'curtain',
      ],
      [
        'slab',
        'shop',
        'brownstone',
        'shop',
        'curtain',
        'shop',
        'slab',
        'shop',
        'curtain',
        'brownstone',
        'slab',
      ],
      [
        'brownstone',
        'slab',
        'curtain',
        'brownstone',
        'stone',
        'shop',
        'slab',
        'curtain',
        'slab',
        'brownstone',
        'curtain',
      ],
      [
        'brownstone',
        'stone',
        'slab',
        'brownstone',
        'stone',
        'brownstone',
        'curtain',
        'stone',
        'brownstone',
        'brownstone',
        'slab',
      ],
      [
        'curtain',
        'shop',
        'slab',
        'shop',
        'stone',
        'shop',
        'curtain',
        'shop',
        'slab',
        'curtain',
        'curtain',
      ],
    ];
    parcels.forEach(([x, z], i) => {
      if ((index === 0 && i >= 9) || ((index === 2 || index === 4) && i === 4))
        return;
      const style = blockStyles[index][i];
      const w = (0.077 + random() * 0.036) * (style === 'curtain' ? 0.69 : 1),
        d = 0.065 + random() * 0.044;
      const h =
        (0.049 +
          random() * (index === 1 ? 0.062 : 0.109) +
          (z < 0 && index === 4 ? 0.05 : 0)) *
        (z > 0.25 ? 0.85 : 1) *
        (style === 'curtain' ? 1.47 : 1);
      box(s.city, x, 0.0025, z, w + 0.015, 0.005, d + 0.019, '#c3bdab', 0.003);
      if (style === 'slab' || style === 'curtain') {
        midrise(s, x, z, w, d, h, style);
        return;
      }
      if (style === 'brownstone') {
        brownstone(s, x, z, w, d, h);
        return;
      }
      const tone = style === 'stone' ? stone : brick;
      const storeColors = ['#c99d86', '#99bfd0', '#e2b3ac', '#acbda3'];
      building(
        s,
        x,
        z,
        w,
        d,
        h,
        style === 'shop' ? [tone[0], storeColors[i % 4], tone[2]] : tone,
        style,
      );
    });
    landmark(s, index);
    const satellites = [
      [
        [-0.123, 0.019, 0.19, c.cyan],
        [0.117, -0.013, 0.232, c.pink],
      ],
      [
        [-0.166, -0.159, 0.221, c.cyan],
        [0.149, -0.013, 0.177, c.pink],
      ],
      [
        [-0.142, -0.117, 0.192, c.cyan],
        [0.02, -0.166, 0.242, c.pink],
      ],
      [
        [-0.14, -0.182, 0.157, c.pink],
        [0.113, -0.145, 0.189, c.cyan],
      ],
      [
        [-0.164, -0.03, 0.227, c.cyan],
        [0.158, -0.096, 0.299, c.pink],
      ],
    ];
    for (const [x, z, h, col] of satellites[index])
      crystal(
        s,
        x,
        z,
        0.054,
        0.049,
        [
          [0.005, 1],
          [h * 0.57, 0.76, -0.007],
          [h, 1.06, 0.013, -0.006, 0.046],
        ],
        col,
      );
    for (let i = 0; i < 28; i++) {
      const side = i % 4,
        lane = -0.363 + Math.floor(i / 4) * 0.119 + (random() - 0.5) * 0.012;
      const [x, z] = [
        [lane, 0.395],
        [-0.398, lane],
        [lane, -0.397],
        [0.397, lane],
      ][side];
      const pine = (i + index) % 3 !== 0;
      tree(s, x, z, (pine ? 0.069 : 0.052) + random() * 0.049, pine, random);
    }
    for (const [x, z] of [
      [-0.172, 0.151],
      [-0.172, 0.043],
      [0.17, 0.144],
      [0.171, -0.044],
      [-0.135, 0.258],
      [0.095, 0.259],
    ])
      tree(
        s,
        x,
        z,
        0.055 + random() * 0.024,
        index === 2 || random() > 0.6,
        random,
      );
    const pins = [...parcels.slice(0, 9), [0, -0.092]].map(([x, z]) => [
      x,
      Math.ceil((roofAt(m, x, z) + 0.018001) * 1e6) / 1e6,
      z,
    ]);
    anchors[id] = {
      lcdNode: 'LCD_Screen',
      dialNode: 'Rotary_Dial',
      deckY: 0,
      pinAnchors: pins,
    };
    m.save(dir + 'segment-' + id + '.glb');
  });
  json(dir + 'segment-anchors.json', anchors);
}
