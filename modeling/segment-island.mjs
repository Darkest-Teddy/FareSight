import { face, mix, rgb, rng, TAU } from './geometry.mjs';

// The deck plate the city stands on: a chamfered square the turf has to meet exactly.
const DECK = 0.428,
  CHAMFER = 0.017;
// The turf rim is flat at y = 0 out to at least RIM_MIN; the shoreline wobbles between the two.
const RIM_MIN = 0.4372,
  RIM_MAX = 0.4472;
const SOIL_DEPTH = 0.03;

export function palette(m) {
  const b = (name, opts) => m.surface(m.material(name, opts));
  return {
    city: b('Masonry, foliage and streets', { rough: 0.79 }),
    turf: b('Island turf', { rough: 0.92 }),
    earth: b('Island earth and rock', { rough: 0.9 }),
  };
}

const tone = (a, b, t, gain = 1) =>
  '#' +
  mix(rgb(a), rgb(b), Math.min(1, Math.max(0, t)))
    .map((v) =>
      Math.round(Math.min(1, v * gain) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('');
const square = (a) => 1 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)));
const polar = (a, r, y, c = [0, 0]) => [c[0] + r * Math.cos(a), y, c[1] + r * Math.sin(a)];

// Joins two rings of different vertex counts. Both run in increasing angle, upper ring first.
function stitch(s, upper, lower, paint) {
  const at = (ring, k) => ring[k % ring.length].a + (k >= ring.length ? TAU : 0);
  let i = 0,
    j = 0;
  while (i < upper.length || j < lower.length) {
    const a = upper[i % upper.length].p,
      b = lower[j % lower.length].p;
    if (j >= lower.length || (i < upper.length && at(upper, i + 1) <= at(lower, j + 1))) {
      const next = upper[++i % upper.length].p;
      face(s, [a, next, b], paint(a, next, b));
    } else {
      const next = lower[++j % lower.length].p;
      face(s, [a, next, b], paint(a, next, b));
    }
  }
}

// A floating chunk of land: flat turf rim around the deck, a ragged grass skirt, and a faceted
// wedge of earth and rock tapering to an off-centre point with a few fragments adrift below it.
export function island(s, seed) {
  const random = rng(seed);
  for (let i = 0; i < 8; i++) random();
  const between = (lo, hi) => lo + (hi - lo) * random();
  const waves = [2, 3, 5, 7].map((k) => [k, between(0, TAU), between(0.5, 1)]);
  const wobble = (a) => {
    const n = waves.reduce((n, [k, phase, gain]) => n + gain * Math.sin(k * a + phase), 0);
    return Math.min(1, Math.max(0, 0.5 + n / 3.2));
  };

  // Shoreline angles include the deck plate's corners and the diagonals, so the turf meets the
  // plate edge to edge and the rim never dips inside RIM_MIN.
  const corner = Math.atan2(DECK - CHAMFER, DECK);
  const fixed = [0, 1, 2, 3].flatMap((q) =>
    [corner, Math.PI / 4, Math.PI / 2 - corner].map((a) => a + (q * Math.PI) / 2),
  );
  const count = 60;
  const angles = Array.from({ length: count }, (_, i) => ((i + between(0.3, 0.7)) * TAU) / count)
    .filter((a) => fixed.every((f) => Math.abs(a - f) > 0.045))
    .concat(fixed)
    .sort((a, b) => a - b);
  const shore = angles.map((a) => polar(a, (RIM_MIN + (RIM_MAX - RIM_MIN) * wobble(a)) * square(a), 0));
  const plate = angles.map((a) =>
    polar(a, Math.min(DECK * square(a), (2 * DECK - CHAMFER) / (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)))), 0),
  );
  const n = angles.length;

  const grass = '#84ab68';
  // A sliver of turf tucked under the plate edge closes any hairline between plate and rim.
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n,
      under = (p, f) => [p[0] * f, -0.0012, p[2] * f];
    face(s.turf, [under(plate[i], 0.985), under(plate[k], 0.985), under(plate[k], 1.012), under(plate[i], 1.012)], grass);
    face(s.turf, [plate[i], plate[k], shore[k], shore[i]], grass);
  }

  // The skirt lies just proud of the soil band beneath the rim and ends in uneven teeth.
  const drape = (p, depth) => {
    const f = 1 - (0.015 * depth) / SOIL_DEPTH;
    return [p[0] * f, -depth, p[2] * f];
  };
  const blades = ['#7aa35e', '#6f9a55', '#648e4c', '#76a05a'];
  const hem = shore.map((p) => drape(p, between(0.008, 0.015)));
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n,
      tip = drape(mix(shore[i], shore[k], between(0.35, 0.65)), between(0.017, 0.025));
    const pick = () => blades[Math.floor(random() * blades.length)];
    face(s.turf, [shore[i], tip, hem[i]], pick());
    face(s.turf, [shore[i], shore[k], tip], pick());
    face(s.turf, [shore[k], hem[k], tip], pick());
  }

  // Earth: a soil band under the turf, then irregular rings shrinking toward the apex.
  const bottom = between(-0.316, -0.302);
  const lean = between(0, TAU),
    reach = between(0.07, 0.11);
  const apex = [reach * Math.cos(lean), reach * Math.sin(lean)];
  const centre = (y) => apex.map((v) => v * (y / bottom) ** 1.4);
  const soilTop = shore.map((p, i) => ({ a: angles[i], p: [p[0] * 0.995, -0.0004, p[2] * 0.995] })),
    soilBase = shore.map((p, i) => ({ a: angles[i], p: [p[0] * 0.98, -SOIL_DEPTH, p[2] * 0.98] }));
  // Rings that reuse the angles of the one above keep its buttresses, so cliffs read as columns.
  const ring = (y, scale, points, yJitter, rJitter, above) =>
    Array.from({ length: above?.length ?? points }, (_, i) => {
      const a = above ? above[i].a : ((i + between(0.25, 0.75)) * TAU) / points,
        swell = above ? above[i].swell : between(-1, 1),
        h = 0.44 * scale,
        round = Math.min(1, Math.max(0, (y / bottom - 0.3) * 1.6)),
        level = y + between(-yJitter, yJitter);
      const r =
        h * square(a) ** (1 - round) * (1 + 0.1 * round * round) * (1 + rJitter * (0.65 * swell + between(-0.35, 0.35)));
      const p = polar(a, r, level, centre(level)),
        over = Math.max(Math.abs(p[0]), Math.abs(p[2])) / 0.44;
      return { a, swell, p: over > 1 ? [p[0] / over, level, p[2] / over] : p };
    });
  // An undercut pulls the ring above it inward and down, leaving a shelf of rock overhanging.
  const undercut = (above, pull, drop) =>
    above.map(({ a, p }) => {
      const y = p[1] - between(drop * 0.6, drop * 1.3),
        c = centre(y),
        f = pull * between(0.94, 1.06);
      return { a, p: [c[0] + (p[0] - c[0]) * f, y, c[1] + (p[2] - c[1]) * f] };
    });
  const depth = bottom / -0.31;
  const r1 = ring(-0.07 * depth, 0.945, 24, 0.008, 0.03),
    r2 = ring(-0.14 * depth, 0.83, 24, 0.012, 0.07, r1),
    u2 = undercut(r2, 0.9, 0.012),
    r3 = ring(-0.21 * depth, 0.55, 16, 0.012, 0.09),
    u3 = undercut(r3, 0.86, 0.01),
    r4 = ring(-0.265 * depth, 0.28, 10, 0.008, 0.1),
    r5 = ring(-0.295 * depth, 0.09, 6, 0.003, 0.12);

  const ledges = [between(0, TAU), between(0, TAU)];
  const near = (a, b, width) => Math.abs(((a - b + TAU * 1.5) % TAU) - Math.PI) < width;
  const paint = (kind) => (a, b, c) => {
    const y = (a[1] + b[1] + c[1]) / 3,
      t = y / bottom,
      gain = between(0.9, 1.1);
    if (kind === 'soil') return tone('#6b4a33', '#5c3f2c', random(), gain);
    if (kind === 'under') return tone('#4d3427', '#33231d', t, gain);
    const angle = (Math.atan2((a[2] + b[2] + c[2]) / 3, (a[0] + b[0] + c[0]) / 3) + TAU) % TAU;
    if ((kind === 'shelf2' && near(angle, ledges[0], 0.85)) || (kind === 'shelf3' && near(angle, ledges[1], 1.1)))
      return tone('#a89a86', '#8f8272', random(), gain);
    return tone('#8c6344', '#4a3126', t ** 0.85, gain);
  };
  const bands = [
    [soilTop, soilBase, 'soil'],
    [soilBase, r1, 'earth'],
    [r1, r2, 'shelf2'],
    [r2, u2, 'under'],
    [u2, r3, 'shelf3'],
    [r3, u3, 'under'],
    [u3, r4, 'earth'],
    [r4, r5, 'earth'],
  ];
  for (const [upper, lower, kind] of bands) stitch(s.earth, upper, lower, paint(kind));
  const tipY = bottom,
    tip = [...centre(tipY)];
  const cap = paint('earth');
  for (let i = 0; i < r5.length; i++) {
    const a = r5[i].p,
      b = r5[(i + 1) % r5.length].p,
      c = [tip[0], tipY, tip[1]];
    face(s.earth, [a, b, c], cap(a, b, c));
  }

  // Fragments drifting below the point, all above y = -0.34.
  const signs = [-1, 1];
  for (let i = 0; i < 5; i++) {
    const a = lean + between(-1.3, 1.3) + (i % 2 ? Math.PI : 0),
      out = between(0.05, 0.2),
      r = between(0.009, 0.016) * (i === 0 ? 1.6 : 1),
      y = Math.max(bottom + 0.42 * out - between(0.048, 0.07), -0.336 + r * 1.35);
    const at = [tip[0] + out * Math.cos(a), y, tip[1] + out * Math.sin(a)];
    const axis = (k, sign) => at.map((v, j) => v + (j === k ? sign * r * between(0.6, 1.3) : r * between(-0.45, 0.45)));
    const x = signs.map((sign) => axis(0, sign)),
      v = signs.map((sign) => axis(1, sign)),
      z = signs.map((sign) => axis(2, sign));
    for (const i of [0, 1])
      for (const j of [0, 1])
        for (const k of [0, 1]) {
          const pts = [x[i], v[j], z[k]];
          if ((i + j + k) % 2 === 0) pts.reverse();
          face(s.earth, pts, random() < 0.35 ? tone('#9f907d', '#6a5f56', random()) : tone('#7a553b', '#49322a', random()));
        }
  }
}
