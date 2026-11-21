import { writeFileSync } from 'node:fs';
import {
  TAU,
  add,
  sub,
  mul,
  norm,
  dot,
  cross,
  mix,
  rgb,
  rng,
} from './geometry.mjs';

export const properties =
  'x y z f_dc_0 f_dc_1 f_dc_2 opacity scale_0 scale_1 scale_2 rot_0 rot_1 rot_2 rot_3'.split(
    ' ',
  );
const SH = 0.28209479177387814;
const limit = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function quaternion(a, b, c) {
  const t = a[0] + b[1] + c[2];
  let q;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    q = [s / 4, (b[2] - c[1]) / s, (c[0] - a[2]) / s, (a[1] - b[0]) / s];
  } else if (a[0] > b[1] && a[0] > c[2]) {
    const s = Math.sqrt(1 + a[0] - b[1] - c[2]) * 2;
    q = [(b[2] - c[1]) / s, s / 4, (b[0] + a[1]) / s, (c[0] + a[2]) / s];
  } else if (b[1] > c[2]) {
    const s = Math.sqrt(1 + b[1] - a[0] - c[2]) * 2;
    q = [(c[0] - a[2]) / s, (b[0] + a[1]) / s, s / 4, (c[1] + b[2]) / s];
  } else {
    const s = Math.sqrt(1 + c[2] - a[0] - b[1]) * 2;
    q = [(a[1] - b[0]) / s, (c[0] + a[2]) / s, (c[1] + b[2]) / s, s / 4];
  }
  return norm(q);
}
const hexCache = new Map();
function tint(color) {
  if (Array.isArray(color)) return color;
  if (!hexCache.has(color)) hexCache.set(color, rgb(color));
  return hexCache.get(color);
}
const shade = (c, n) => tint(c).map((v) => v * n);
const wood =
  (a, b, planks = 8) =>
  (u, v) => {
    const plank = Math.min(planks - 1, Math.floor(v * planks)),
      gap = (v * planks) % 1;
    const grain =
      0.5 +
      0.5 *
        Math.sin(u * 20 + plank * 2 + Math.sin(u * 11 + v * 76) * 2 + v * 310);
    return shade(
      mix(
        tint(a),
        tint(b),
        grain * 0.55 + (Math.sin(plank * 9) * 0.5 + 0.5) * 0.33,
      ),
      gap < 0.034 ? 0.77 : 1,
    );
  };
const brick = (u, v) => {
  const row = Math.floor(v * 22),
    h = (u * 21 + (row % 2) * 0.5) % 1;
  return (v * 22) % 1 < 0.066 || h < 0.035
    ? '#ac8773'
    : shade(
        '#ae6351',
        0.72 +
          0.25 *
            (0.5 +
              0.5 *
                Math.sin(row * 23 + Math.floor(u * 21 + (row % 2) * 0.5) * 13)),
      );
};
const constantFrame = (u, v) => [u, v];
class Cloud {
  patches = [];
  constructor(seed) {
    this.random = rng(seed);
  }
  patch(
    evalPoint,
    w,
    h,
    color,
    {
      density = 1,
      alpha = 0.93,
      noise = 0.045,
      frame,
      group,
      overlap = 0.73,
    } = {},
  ) {
    this.patches.push({
      evalPoint,
      w,
      h,
      color,
      weight: Math.max(1e-9, w * h * density),
      alpha,
      noise,
      frame,
      group,
      overlap,
    });
  }
  plane(p, u, v, c, opt = {}) {
    this.patch(
      (a, b) => add(p, add(mul(u, a), mul(v, b))),
      Math.hypot(...u),
      Math.hypot(...v),
      c,
      { ...opt, frame: constantFrame(u, v) },
    );
  }
  box(x, y, z, w, h, d, c, opt = {}) {
    const a = x - w / 2,
      b = y - h / 2,
      f = z - d / 2;
    if (!opt.openBottom) this.plane([a, b, f], [w, 0, 0], [0, 0, d], c, opt);
    this.plane([a, b + h, f + d], [w, 0, 0], [0, 0, -d], c, opt);
    this.plane([a, b + h, f], [w, 0, 0], [0, -h, 0], c, opt);
    this.plane([a, b, f + d], [w, 0, 0], [0, h, 0], c, opt);
    this.plane([a, b, f], [0, 0, d], [0, h, 0], c, opt);
    this.plane([a + w, b + h, f], [0, 0, d], [0, -h, 0], c, opt);
  }
  ball(x, y, z, rx, ry, rz, c, opt = {}) {
    this.patch(
      (u, v) => {
        const a = TAU * u,
          lat = (opt.upper ? 0.5 : 1) * Math.PI * v,
          cos = Math.cos(lat),
          sin = Math.sin(lat);
        return [
          x + rx * sin * Math.cos(a),
          y + ry * cos,
          z + rz * sin * Math.sin(a),
        ];
      },
      TAU * Math.sqrt(rx * rz),
      ((opt.upper ? 0.5 : 1) * Math.PI * (ry + Math.max(rx, rz))) / 2,
      c,
      opt,
    );
  }
  lathe(x, z, profile, c, opt = {}, ratio = 1) {
    for (let j = 1; j < profile.length; j++) {
      const [r, y] = profile[j - 1],
        [s, h] = profile[j];
      this.patch(
        (u, v) => {
          const a = u * TAU,
            t = r + (s - r) * v;
          return [
            x + t * Math.cos(a),
            y + (h - y) * v,
            z + t * ratio * Math.sin(a),
          ];
        },
        TAU * Math.max(0.00001, (r + s) / 2),
        Math.hypot(s - r, h - y),
        c,
        opt,
      );
    }
  }
  stroke(points, r, c, opt = {}) {
    const lengths = [0];
    for (let i = 1; i < points.length; i++)
      lengths.push(
        lengths[i - 1] + Math.hypot(...sub(points[i], points[i - 1])),
      );
    const length = lengths.at(-1);
    this.patch(
      (u, v) => {
        const d = limit(u, 0, 1) * length;
        let a = 0,
          b = lengths.length - 1;
        while (b - a > 1) {
          const mid = (a + b) >> 1;
          if (lengths[mid] < d) a = mid;
          else b = mid;
        }
        const tangent = norm(sub(points[b], points[a])),
          n = norm(
            cross(tangent, Math.abs(tangent[1]) > 0.92 ? [1, 0, 0] : [0, 1, 0]),
          ),
          l = cross(tangent, n);
        return add(
          mix(
            points[a],
            points[b],
            (d - lengths[a]) / (lengths[b] - lengths[a]),
          ),
          add(mul(n, r * Math.cos(v * TAU)), mul(l, r * Math.sin(v * TAU))),
        );
      },
      length,
      TAU * r,
      c,
      opt,
    );
  }
  save(file, total) {
    const patches = this.patches,
      budget = total - patches.length * 2,
      sum = patches.reduce((a, p) => a + p.weight, 0);
    if (budget < 0) throw Error('Insufficient splats for surfaces');
    const shares = patches.map((p) => (budget * p.weight) / sum),
      counts = shares.map((n) => 2 + Math.floor(n));
    const remaining = total - counts.reduce((a, b) => a + b, 0);
    shares
      .map((n, i) => [n % 1, i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, remaining)
      .forEach(([, i]) => counts[i]++);
    const bytes = Buffer.alloc(total * 56),
      ranges = [];
    let k = 0;
    for (const [i, p] of patches.entries()) {
      const n = counts[i],
        rows = limit(Math.round(Math.sqrt((n * p.h) / p.w)), 1, n);
      if (p.group) {
        const last = ranges.at(-1);
        if (last?.name === p.group && last.end === k) last.end += n;
        else ranges.push({ name: p.group, start: k, end: k + n });
      }
      for (let row = 0; row < rows; row++) {
        const cols =
          Math.floor(((row + 1) * n) / rows) - Math.floor((row * n) / rows);
        for (let col = 0; col < cols; col++, k++) {
          const u = (col + 0.18 + 0.64 * this.random()) / cols,
            v = (row + 0.18 + 0.64 * this.random()) / rows;
          const pos = p.evalPoint(u, v);
          const deriv = (axis) => {
            const h = 0.0002,
              lo = Math.max(0, (axis === 0 ? u : v) - h),
              hi = Math.min(1, (axis === 0 ? u : v) + h);
            const a = axis === 0 ? p.evalPoint(lo, v) : p.evalPoint(u, lo),
              b = axis === 0 ? p.evalPoint(hi, v) : p.evalPoint(u, hi);
            return mul(sub(b, a), 1 / (hi - lo));
          };
          const [du, dv] = p.frame ?? [deriv(0), deriv(1)];
          const axis = norm(du),
            normal = norm(cross(du, dv)),
            side = cross(normal, axis);
          const su =
            limit(
              Math.hypot(...du) / cols,
              (p.w / cols) * 0.12,
              (p.w / cols) * 2.7,
            ) * p.overlap;
          const sv =
            limit(
              Math.abs(dot(dv, side)) / rows,
              (p.h / rows) * 0.12,
              (p.h / rows) * 2.7,
            ) * p.overlap;
          const colr =
            typeof p.color === 'function' ? p.color(u, v, pos) : p.color;
          const light =
            0.78 +
            0.22 * Math.abs(dot(normal, [-0.4, 0.84, 0.37])) +
            (this.random() - 0.5) * p.noise;
          const color = tint(colr).map(
            (v) => (limit(v * light, 0, 1) - 0.5) / SH,
          );
          const vals = [
            ...pos,
            ...color,
            Math.log(p.alpha / (1 - p.alpha)),
            ...[su, sv, Math.min(su, sv) * 0.18].map((x) =>
              Math.log(Math.max(0.000018, x)),
            ),
            ...quaternion(axis, side, normal),
          ];
          for (let j = 0; j < 14; j++)
            bytes.writeFloatLE(vals[j], k * 56 + j * 4);
        }
      }
    }
    const header = [
      'ply',
      'format binary_little_endian 1.0',
      'comment FareSight procedural scene | meters | y up | forward -z',
      ...ranges.map(
        (r) => 'comment group ' + r.name + ' ' + r.start + ' ' + r.end,
      ),
      'element vertex ' + total,
      ...properties.map((s) => 'property float ' + s),
      'end_header',
      '',
    ].join('\n');
    writeFileSync(file, Buffer.concat([Buffer.from(header), bytes]));
  }
}
const arc = (fn, n = 40) => Array.from({ length: n + 1 }, (_, i) => fn(i / n));
const timber = wood('#995f3b', '#d99b5f', 6),
  oak = wood('#ba8959', '#efc697', 5),
  walnut = wood('#49322d', '#85573e', 13);
function shell(s, w, d, h, floor, back, side) {
  // Open entry side faces the supplied spawn, including the karaoke threshold.
  s.plane([-w / 2, 0, d / 2], [w, 0, 0], [0, 0, -d], floor, {
    density: 1.1,
    group: 'floor',
  });
  s.plane([-w / 2, 0, -d / 2], [w, 0, 0], [0, h, 0], back, { density: 1.2 });
  s.plane([-w / 2, 0, d / 2], [0, 0, -d], [0, h, 0], side);
  s.plane([w / 2, 0, -d / 2], [0, 0, d], [0, h, 0], side);
  s.plane([-w / 2, h, -d / 2], [w, 0, 0], [0, 0, d], '#493b3b', {
    density: 0.32,
  });
}
function table(s, x, z, h, w, d, color) {
  s.box(x, h, z, w, 0.065, d, color, { density: 2 });
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      s.box(
        x + sx * w * 0.39,
        h / 2,
        z + sz * d * 0.36,
        0.05,
        h,
        0.05,
        '#59463c',
      );
}
function bowl(s, x, y, z, rad, c) {
  s.lathe(
    x,
    z,
    [
      [0.45 * rad, y],
      [0.6 * rad, y + 0.013],
      [rad, y + rad * 0.51],
      [rad * 0.92, y + rad * 0.52],
      [rad * 0.76, y + rad * 0.37],
      [0, y + rad * 0.34],
    ],
    c,
    { density: 4 },
  );
}
function ramenRoom() {
  const s = new Cloud(9813);
  shell(
    s,
    5,
    4,
    2.75,
    wood('#946644', '#c39261', 16),
    walnut,
    wood('#543a31', '#896047', 25),
  );
  s.box(-0.83, 0.47, -0.82, 2.96, 0.94, 0.6, wood('#5e3c2d', '#925a35', 20));
  s.box(-0.83, 0.982, -0.82, 3.09, 0.085, 0.81, timber, { density: 2.3 });
  for (const x of [-2.0, -1.32, -0.64, 0.04]) {
    s.lathe(
      x,
      -0.085,
      [
        [0.15, 0.012],
        [0.17, 0.04],
        [0.04, 0.07],
        [0.035, 0.54],
        [0.15, 0.555],
        [0.17, 0.61],
        [0, 0.62],
      ],
      '#563e36',
      { density: 2 },
    );
    s.lathe(
      x,
      -0.085,
      [
        [0.157, 0.602],
        [0.162, 0.645],
        [0, 0.65],
      ],
      '#ac5639',
      { density: 3 },
    );
    bowl(s, x, 1.029, -0.61, 0.105, '#ded5b2');
    s.box(x + 0.13, 1.035, -0.63, 0.014, 0.012, 0.17, '#ce9e6a', {
      density: 3,
    });
  }
  s.box(-0.65, 1.59, -1.946, 2.64, 0.81, 0.068, '#392d29');
  s.box(-0.65, 1.235, -1.8, 2.76, 0.08, 0.32, '#a27b55');
  for (let i = 0; i < 7; i++) {
    const x = -1.74 + i * 0.363;
    s.box(
      x,
      1.96,
      -1.86,
      0.341,
      0.4 - (i % 3) * 0.03,
      0.024,
      i % 2 ? '#484b61' : '#364b61',
      { density: 3 },
    );
    s.ball(x, 1.975, -1.835, 0.045, 0.052, 0.005, '#dbcfac', { density: 5 });
    s.ball(x, 1.975, -1.824, 0.028, 0.034, 0.005, '#454f60', { density: 4 });
  }
  for (const x of [-1.9, -0.75, 0.42]) {
    s.stroke(
      [
        [x, 2.75, -0.7],
        [x, 2.49, -0.7],
      ],
      0.009,
      '#3e2d27',
    );
    s.ball(
      x,
      2.27,
      -0.7,
      0.145,
      0.213,
      0.145,
      (u, v) =>
        shade(
          x > 0 ? '#ffc064' : '#f06648',
          0.78 + 0.22 * Math.cos(v * 25 * Math.PI) ** 2,
        ),
      { density: 4 },
    );
    s.lathe(
      x,
      -0.7,
      [
        [0.069, 2.062],
        [0.069, 2.086],
      ],
      '#623f34',
      { density: 4 },
    );
  }
  for (const z of [-0.99, 0.5]) {
    s.box(2.24, 0.36, z, 0.46, 0.18, 0.9, '#955446');
    s.box(2.43, 0.69, z, 0.13, 0.61, 0.92, '#82493d');
    table(s, 1.58, z, 0.72, 0.63, 0.74, timber);
    bowl(s, 1.57, 0.76, z, 0.096, '#5b6e66');
  }
  for (let j = 0; j < 3; j++) {
    s.lathe(
      -1.12 + j * 0.36,
      -1.72,
      [
        [0.076, 1.272],
        [0.084, 1.36],
        [0.069, 1.39],
      ],
      '#ad9c82',
      { density: 3 },
    );
    const x = -1.12 + j * 0.36;
    s.stroke(
      arc((t) => [
        x + 0.03 * Math.sin(t * 8),
        1.38 + t * 0.26,
        -1.72 + 0.027 * t,
      ]),
      0.014,
      '#dfd1b6',
      { alpha: 0.17, density: 8, overlap: 0.6 },
    );
  }
  return s;
}
function karaokeRoom() {
  const s = new Cloud(733);
  shell(
    s,
    4.2,
    3.4,
    2.62,
    wood('#343343', '#515063', 10),
    (u, v) => shade('#3d344d', 0.73 + 0.27 * Math.cos(u * 52) ** 2),
    (u, v) => shade('#483c55', 0.78 + 0.22 * Math.cos(u * 35 + v * 0.5) ** 2),
  );
  // Modular upholstery sections with contrasting welts and back cushions.
  const seat = (x, z, w, d) => {
    s.box(x, 0.28, z, w, 0.37, d, '#53364f');
    s.box(x, 0.5, z, w - 0.018, 0.115, d - 0.018, '#9b4677', { density: 2.1 });
  };
  for (const sign of [-1, 1]) {
    for (let j = 0; j < 4; j++) {
      const z = -0.86 + j * 0.62;
      seat(sign * 1.74, z, 0.62, 0.61);
      s.ball(sign * 1.99, 0.736, z, 0.1, 0.255, 0.305, '#783b67', {
        density: 2,
      });
      s.stroke(
        [
          [sign * 1.46, 0.525, z - 0.28],
          [sign * 1.46, 0.525, z + 0.28],
        ],
        0.008,
        '#df86ba',
        { density: 3 },
      );
    }
    s.stroke(
      [
        [sign * 2.045, 2.45, -1.63],
        [sign * 2.045, 2.45, 1.67],
      ],
      0.02,
      sign < 0 ? '#ff5eba' : '#59ecff',
      { density: 4 },
    );
  }
  for (let j = 0; j < 5; j++) {
    const x = -1.2 + j * 0.6;
    seat(x, -1.37, 0.6, 0.48);
    s.ball(x, 0.743, -1.59, 0.294, 0.22, 0.079, '#9a477e', { density: 2 });
  }
  s.stroke(
    [
      [-2.04, 2.45, -1.64],
      [2.04, 2.45, -1.64],
    ],
    0.024,
    '#ad78ff',
    { density: 4 },
  );
  s.box(0, 1.64, -1.63, 2.28, 1.21, 0.09, '#222632');
  s.plane(
    [-1.075, 1.1, -1.574],
    [2.15, 0, 0],
    [0, 1.07, 0],
    (u, v) => {
      const wave = 0.46 + 0.12 * Math.sin(u * 16 + 1.5 * Math.cos(u * 24));
      if (v < 0.21 && v > 0.16 && u > 0.12 && u < 0.8 && u % 0.081 < 0.058)
        return '#fde3dc';
      if (Math.abs(v - wave) < 0.018) return '#9cf6f2';
      if (v > 0.84 && u < 0.36 && u > 0.08 && u % 0.058 < 0.043)
        return '#f1c1da';
      return mix(
        tint('#7f408e'),
        tint('#345284'),
        limit(v * 0.6 + u * 0.43, 0, 1),
      );
    },
    { density: 3.4 },
  );
  table(s, 0, 0.12, 0.54, 1.25, 0.68, '#463951');
  for (const sign of [-1, 1]) {
    s.stroke(
      [
        [sign * 0.22, 0.592, 0.1],
        [sign * 0.39, 0.61, 0.21],
      ],
      0.024,
      '#27272e',
      { density: 6 },
    );
    s.ball(sign * 0.4, 0.616, 0.22, 0.043, 0.04, 0.04, '#b8b2be', {
      density: 5,
    });
  }
  for (const x of [-1.6, 1.6]) {
    s.box(x, 1.65, -1.61, 0.28, 0.57, 0.12, '#272634');
    for (const y of [1.54, 1.78])
      s.ball(x, y, -1.54, 0.085, 0.085, 0.019, '#656176', { density: 3 });
  }
  return s;
}
function cafeRoom() {
  const s = new Cloud(1307);
  shell(s, 5.5, 4.5, 3.0, wood('#ab815a', '#dec39b', 17), brick, '#b59e82');
  for (const z of [-1.46, -0.05, 1.36]) {
    const x = -2.737,
      r = 0.52,
      base = 0.73,
      shoulder = 2.07;
    s.plane(
      [x, base, z - r],
      [0, 0, 2 * r],
      [0, shoulder - base, 0],
      (u, v) => mix(tint('#b8d6c6'), tint('#f6e7b9'), v),
      { density: 2.2 },
    );
    s.patch(
      (u, v) => [
        x,
        shoulder + r * Math.sin(u * Math.PI) * v,
        z + r * Math.cos(u * Math.PI),
      ],
      2 * r,
      r,
      '#dbe4c8',
      { density: 2 },
    );
    s.stroke(
      arc((t) => [
        x + 0.028,
        shoulder + r * Math.sin(t * Math.PI),
        z + r * Math.cos(t * Math.PI),
      ]),
      0.036,
      '#765943',
      { density: 2 },
    );
    for (const dz of [-r, 0, r])
      s.box(x + 0.025, 1.39, z + dz, 0.038, 1.35, 0.038, '#7e634c');
    s.box(x + 0.026, 1.64, z, 0.038, 0.04, 2 * r, '#7e634c');
    s.box(x + 0.08, base, z, 0.18, 0.08, 1.16, oak);
  }
  for (const x of [-0.92, 0.77])
    for (const z of [-0.26, 1.04]) {
      table(s, x, z, 0.77, 1.05, 0.61, oak);
      for (const sign of [-1, 1]) {
        const zz = z + sign * 0.47;
        s.box(x, 0.43, zz, 0.4, 0.06, 0.31, '#985e39');
        s.box(x, 0.63, zz + sign * 0.14, 0.38, 0.33, 0.038, '#a7794f');
        for (const xx of [-0.15, 0.15])
          s.box(x + xx, 0.21, zz, 0.044, 0.42, 0.08, '#6e5541');
      }
      s.lathe(
        x + 0.28,
        z,
        [
          [0.085, 0.806],
          [0.085, 0.82],
          [0.015, 0.835],
          [0.015, 1.115],
          [0.126, 1.13],
          [0.118, 1.16],
          [0.04, 1.23],
        ],
        '#d6ad68',
        { density: 4 },
      );
      s.box(x - 0.22, 0.818, z, 0.21, 0.025, 0.16, '#607876', { density: 4 });
    }
  table(s, -0.6, -1.75, 0.99, 2.81, 0.7, timber);
  s.box(-0.82, 1.24, -1.74, 0.64, 0.4, 0.35, '#899795', { density: 2 });
  for (const x of [-0.95, -0.71]) {
    s.stroke(
      [
        [x, 1.21, -1.55],
        [x, 1.18, -1.43],
      ],
      0.024,
      '#394747',
    );
    bowl(s, x, 1.029, -1.46, 0.063, '#e6ddc5');
  }
  s.box(1.59, 1.2, -2.125, 1.44, 2.35, 0.22, walnut);
  const colors = [
    '#a46858',
    '#7a7565',
    '#c7a574',
    '#588183',
    '#7a5861',
    '#b58f77',
  ];
  for (let j = 0; j < 4; j++) {
    const y = 0.32 + j * 0.48;
    s.box(1.59, y, -2.02, 1.42, 0.045, 0.37, oak);
    for (let k = 0; k < 17; k++) {
      const h = 0.23 + 0.11 * (0.5 + 0.5 * Math.sin(17 * k + j));
      s.box(
        0.951 + k * 0.079,
        y + h / 2 + 0.024,
        -1.97,
        0.066,
        h,
        0.17,
        colors[(j * 3 + k) % 6],
        { density: 1.6 },
      );
    }
  }
  return s;
}
function ramenDish() {
  const s = new Cloud(5001),
    rand = rng(125);
  s.lathe(
    0,
    0,
    [
      [0, 0],
      [0.05, 0],
      [0.052, 0.004],
      [0.069, 0.009],
      [0.091, 0.026],
      [0.108, 0.048],
      [0.118, 0.067],
      [0.12, 0.073],
      [0.119, 0.076],
      [0.116, 0.076],
      [0.113, 0.071],
      [0.109, 0.059],
    ],
    (u, v) =>
      shade('#394040', 0.78 + 0.19 * Math.cos(u * TAU * 28) ** 2 + 0.07 * v),
    { density: 1.2, group: 'plate' },
  );
  s.lathe(
    0,
    0,
    [
      [0, 0.063],
      [0.082, 0.065],
      [0.109, 0.064],
    ],
    (u, v, p) => {
      const a = Math.sin(p[0] * 290 + Math.sin(p[2] * 231) * 2),
        b = Math.cos(p[2] * 145 + p[0] * 183);
      return mix(tint('#dec28e'), tint('#f8ddb2'), (a * b + 1) * 0.44);
    },
    { density: 1.15 },
  );
  for (let i = 0; i < 15; i++) {
    const phase = rand() * 0.4,
      rx = 0.051 + rand() * 0.012;
    const noodle = arc((t) => {
      const a = t * TAU + phase;
      return [
        rx * Math.cos(a),
        0.07 + 0.003 * Math.sin(a * 3 + phase) + i * 0.00009,
        0.015 +
          (i - 7) * 0.0037 +
          0.011 * Math.sin(a * 2 + i * 0.12) +
          0.01 * Math.sin(a),
      ];
    }, 54);
    s.stroke(noodle, 0.0013, i % 3 ? '#f4cb72' : '#d5a755', {
      density: 5.5,
      noise: 0.05,
      overlap: 0.6,
    });
  }
  for (const [x, z] of [
    [-0.051, -0.034],
    [-0.01, -0.047],
  ]) {
    s.patch(
      (u, v) => {
        const a = u * TAU,
          r = Math.sqrt(v);
        return [
          x + 0.029 * r * Math.cos(a),
          0.073 + 0.002 * (1 - r * r) + 0.002 * r * Math.cos(a),
          z + 0.023 * r * Math.sin(a),
        ];
      },
      0.14,
      0.031,
      (u, v) => {
        const r = Math.sqrt(v),
          angle = TAU * u;
        if (r > 0.92) return '#81523b';
        const curl = Math.cos(r * 21 - angle * 1.3 + 0.6 * Math.sin(angle * 2));
        return curl > 0.66 ? '#e4b59a' : curl < -0.57 ? '#af7052' : '#cc8e73';
      },
      { density: 3.3 },
    );
  }
  s.ball(0.053, 0.07, -0.024, 0.025, 0.018, 0.033, '#f5e5bd', { density: 3 });
  s.ball(0.052, 0.085, -0.024, 0.0147, 0.006, 0.018, '#ff9a37', { density: 4 });
  s.plane(
    [-0.091, 0.068, -0.052],
    [0.052, 0.002, -0.027],
    [-0.011, 0.058, -0.01],
    (u, v) => shade('#374d39', 0.75 + 0.32 * Math.sin(u * 67 + v * 43) ** 2),
    { density: 2.4 },
  );
  for (let i = 0; i < 30; i++) {
    const a = rand() * TAU,
      r = 0.008 + 0.057 * rand(),
      x = 0.006 + r * Math.cos(a),
      z = 0.022 + r * 0.68 * Math.sin(a);
    const radius = 0.0023 + rand() * 0.0014;
    s.stroke(
      arc(
        (t) => [
          x + radius * Math.cos(t * TAU),
          0.074 + i * 0.000055 + 0.0012 * Math.sin(t * TAU),
          z + radius * 0.74 * Math.sin(t * TAU),
        ],
        15,
      ),
      0.00086,
      i % 3 ? '#69a751' : '#a8c567',
      { density: 5.8 },
    );
  }
  for (const x of [0.099, 0.113]) {
    s.stroke(
      [
        [x, 0.0065, -0.102],
        [x + 0.005, 0.0065, 0.103],
      ],
      0.00195,
      '#a97c4a',
      { density: 2.2 },
    );
  }
  return s;
}
function curryDish() {
  const s = new Cloud(6201),
    r = rng(991);
  s.lathe(
    0,
    0,
    [
      [0, 0],
      [0.079, 0],
      [0.084, 0.002],
      [0.116, 0.008],
      [0.129, 0.013],
      [0.13, 0.015],
      [0.127, 0.016],
      [0.111, 0.012],
      [0.092, 0.007],
      [0, 0.007],
    ],
    '#e7e7df',
    { density: 1, group: 'plate' },
    0.83,
  );
  s.ball(
    0.031,
    0.012,
    0.008,
    0.075,
    0.01,
    0.072,
    (u, v, p) => shade('#79432b', 1 + 0.12 * Math.sin(p[0] * 216 + p[2] * 118)),
    { density: 1.45 },
  );
  s.ball(-0.047, 0.015, -0.006, 0.053, 0.032, 0.062, '#efe6ce', {
    density: 1.2,
    upper: true,
  });
  // Separate grains follow the rice mound's upper ellipsoid.
  for (let i = 0; i < 230; i++) {
    const a = r() * TAU,
      q = Math.sqrt(r()),
      x = -0.047 + 0.051 * q * Math.cos(a),
      z = -0.006 + 0.059 * q * Math.sin(a);
    s.ball(
      x,
      0.015 + 0.032 * Math.sqrt(1 - q * q),
      z,
      0.0024,
      0.00125,
      0.0014,
      i % 4 ? '#f5ead1' : '#dbcfb3',
      { density: 4 },
    );
  }
  for (let j = 0; j < 7; j++) {
    const x = -0.057 + j * 0.0175,
      z = 0.008 * Math.sin(j * 0.55),
      half = 0.044 * Math.sqrt(1 - ((j - 3) / 4.1) ** 2);
    const y = 0.033 + 0.007 * Math.sin((j / 6) * Math.PI);
    s.box(
      x,
      y,
      z,
      0.015,
      0.018,
      half * 2,
      (u, v) =>
        mix(
          tint('#ac652d'),
          tint('#e4a452'),
          0.42 + 0.4 * Math.sin(88 * u + 32 * v) ** 2,
        ),
      { density: 2.25 },
    );
    s.box(x + 0.0077, y - 0.001, z, 0.0006, 0.009, half * 1.88, '#e6be97', {
      density: 2.5,
    });
    for (let i = 0; i < 21; i++) {
      const xx = x + (r() - 0.5) * 0.014,
        zz = z + (r() - 0.5) * half * 1.95;
      s.ball(
        xx,
        y + 0.0094,
        zz,
        0.0017,
        0.00135,
        0.0022,
        i % 3 ? '#edb05a' : '#a76531',
        { density: 3 },
      );
    }
  }
  for (let i = 0; i < 16; i++) {
    const a = r() * TAU,
      q = 0.015 * Math.sqrt(r());
    s.ball(
      0.069 + q * Math.cos(a),
      0.019 + 0.005 * r(),
      -0.052 + q * Math.sin(a),
      0.005,
      0.003,
      0.004,
      '#b74042',
      { density: 3.4 },
    );
  }
  for (let i = 0; i < 29; i++) {
    const x = -0.067 + (r() - 0.5) * 0.032,
      z = 0.06 + (r() - 0.5) * 0.022;
    s.stroke(
      arc(
        (t) => [
          x + 0.015 * t,
          0.019 + 0.008 * Math.sin(t * Math.PI),
          z + 0.006 * Math.sin(t * 5 + i),
        ],
        12,
      ),
      0.0011,
      i % 2 ? '#d6dc9a' : '#acbc7e',
      { density: 4 },
    );
  }
  return s;
}
function matchaDish() {
  const s = new Cloud(7138);
  // Walk the straight sides and corner arcs at constant speed for even coverage.
  const profile = [
    [0.00001, 0],
    [0.059, 0],
    [0.065, 0.002],
    [0.088, 0.006],
    [0.09, 0.009],
    [0.089, 0.011],
    [0.083, 0.011],
    [0.071, 0.006],
    [0.00001, 0.006],
  ];
  for (let j = 1; j < profile.length; j++) {
    const [r, y] = profile[j - 1],
      [q, h] = profile[j];
    s.patch(
      (u, v) => {
        const edge = Math.min(3, Math.floor(4 * u)),
          t = 4 * u - edge,
          k = 0.16,
          len = 2 * (1 - k) + (Math.PI * k) / 2,
          walk = t * len;
        const corner = Math.max(0, (walk - 2 * (1 - k)) / k);
        const a = walk <= 2 * (1 - k) ? 1 : 1 - k + k * Math.cos(corner),
          b =
            walk <= 2 * (1 - k) ? -1 + k + walk : 1 - k + k * Math.sin(corner);
        const sides = [
            [a, b],
            [-b, a],
            [-a, -b],
            [b, -a],
          ],
          w = r + (q - r) * v;
        return [w * sides[edge][0], y + (h - y) * v, w * sides[edge][1]];
      },
      (7.6 * (r + q)) / 2,
      Math.hypot(r - q, h - y),
      '#b8c3af',
      { group: 'plate' },
    );
  }
  let y = 0.006;
  for (const [h, col] of [
    [0.008, '#6f8453'],
    [0.01, '#e8d7ac'],
    [0.009, '#84965e'],
    [0.009, '#f1e2bf'],
    [0.008, '#8b9b63'],
    [0.009, '#f0dfb7'],
    [0.0025, '#7b963f'],
  ]) {
    s.box(
      -0.033,
      y + h / 2,
      0.004,
      0.081,
      h,
      0.074,
      (u, v) =>
        shade(
          col,
          0.91 + 0.13 * Math.cos(u * 407 + Math.sin(v * 143) * 3) ** 2,
        ),
      { density: 2.2, openBottom: true, noise: 0.09 },
    );
    y += h;
  }
  const x = 0.047,
    z = -0.006;
  s.lathe(
    x,
    z,
    [
      [0, 0.006],
      [0.018, 0.006],
      [0.021, 0.009],
      [0.026, 0.018],
      [0.029, 0.038],
      [0.03, 0.044],
      [0.028, 0.045],
      [0.027, 0.041],
    ],
    '#d6c5a8',
    { density: 2 },
  );
  s.stroke(
    arc((t) => [
      x + 0.026 + 0.012 * Math.sin(t * Math.PI),
      0.029 + 0.011 * Math.cos(t * Math.PI),
      z,
    ]),
    0.0035,
    '#d8c7a9',
    { density: 3 },
  );
  s.lathe(
    x,
    z,
    [
      [0, 0.04],
      [0.027, 0.04],
    ],
    '#bb8e62',
    { density: 2.5 },
  );
  for (let j = 0; j < 6; j++) {
    const dz = -0.011 + j * 0.0043,
      w = 0.016 * Math.sin(((j + 1) / 7) * Math.PI);
    s.stroke(
      arc(
        (t) => [
          x + (t - 0.5) * 2 * w,
          0.04045,
          z + dz + 0.0035 * Math.cos((t - 0.5) * TAU),
        ],
        18,
      ),
      0.00094,
      '#eee0bc',
      { density: 6 },
    );
  }
  s.stroke(
    [
      [x, 0.0405, z - 0.014],
      [x, 0.0405, z + 0.015],
    ],
    0.00075,
    '#f5e9cb',
    { density: 4 },
  );
  return s;
}
export function splats(dir) {
  for (const [name, count, generate] of [
    ['room-ramen-house', 24000, ramenRoom],
    ['room-karaoke-suite', 22000, karaokeRoom],
    ['room-study-cafe', 20000, cafeRoom],
    ['dish-tonkotsu-ramen', 14000, ramenDish],
    ['dish-katsu-curry', 13000, curryDish],
    ['dish-matcha-tiramisu', 10000, matchaDish],
  ])
    generate().save(dir + name + '.ply', count);
}
