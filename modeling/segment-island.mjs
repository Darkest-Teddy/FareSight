import { face, mix, rgb, rng, TAU } from './geometry.mjs';

const BOUND = 0.45; // nothing may reach beyond this half-extent in x or z
const DEPTH = 0.385; // how far the rock hangs below the deck

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

// A floating chunk of land under the city: a turf margin that follows the city's shoreline, a
// ragged grass skirt, and a slim, craggy wedge of earth and rock with a few fragments below the tip.
// `outline` is the city's convex shoreline (XZ points); `radiusAt(angle)` measures it from the centre.
export function island(s, seed, outline, radiusAt) {
  const random = rng(seed);
  for (let i = 0; i < 8; i++) random();
  const between = (lo, hi) => lo + (hi - lo) * random();

  const waves = [3, 5, 8].map((k) => [k, between(0, TAU), between(0.5, 1)]);
  const wobble = (a) => {
    const n = waves.reduce((n, [k, phase, gain]) => n + gain * Math.sin(k * a + phase), 0);
    return Math.min(1, Math.max(0, 0.5 + n / 3.4));
  };
  // The turf margin is 1.2-3.2 cm wide and never crosses the model bound.
  const shoreRadius = (a) =>
    Math.min(radiusAt(a) + 0.012 + 0.02 * wobble(a), BOUND / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))));
  // Shoreline vertices share the outline's own angles, so turf meets the ground plate exactly.
  const inner = outline
    .map((p) => ({ a: (Math.atan2(p[1], p[0]) + TAU) % TAU, p: [p[0], 0, p[1]] }))
    .sort((u, v) => u.a - v.a);
  const rim = inner.map(({ a }) => ({ a, p: polar(a, shoreRadius(a), 0) }));
  const n = rim.length;
  const greens = ['#84ab68', '#7aa35e', '#6f9a55', '#76a05a'];
  const green = () => greens[Math.floor(random() * greens.length)];
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n;
    face(s.turf, [inner[i].p, inner[k].p, rim[k].p, rim[i].p], greens[0]);
  }
  // The grass skirt hangs over the cliff edge and ends in uneven teeth.
  const drape = (p, depth) => {
    const f = 1 - 0.3 * depth;
    return [p[0] * f, -depth, p[2] * f];
  };
  const hem = rim.map(({ p }) => drape(p, between(0.009, 0.016)));
  for (let i = 0; i < n; i++) {
    const k = (i + 1) % n,
      tip = drape(mix(rim[i].p, rim[k].p, between(0.35, 0.65)), between(0.02, 0.03));
    face(s.turf, [rim[i].p, tip, hem[i]], green());
    face(s.turf, [rim[i].p, rim[k].p, tip], green());
    face(s.turf, [rim[k].p, hem[k], tip], green());
  }

  const bottom = -DEPTH;
  const apex = [between(-0.015, 0.015), between(-0.015, 0.015)];
  const centre = (y) => apex.map((v) => v * (y / bottom) ** 1.5);
  // Fraction of the shoreline radius left at depth t (0 at the deck, 1 at the tip): a slim cone
  // that narrows quickly under the crust.
  const taper = (t) => (1 - t ** 0.92) ** 1.05;
  // Crags: each ring gets its own run of outcrops and notches around the circumference.
  const crags = (points) => {
    const phase = between(0, TAU),
      lobes = 3 + Math.floor(random() * 3);
    return (a) => 0.5 * Math.sin(lobes * a + phase) + (random() < 0.3 ? between(0.5, 1) : between(-0.6, 0.3));
  };
  const ring = (t, points, yJitter, rJitter) => {
    const crag = crags(points);
    return Array.from({ length: points }, (_, i) => {
      const a = ((i + between(0.2, 0.8)) * TAU) / points,
        y = bottom * t + between(-yJitter, yJitter),
        r = shoreRadius(a) * taper(t) * (1 + rJitter * crag(a));
      return { a, p: polar(a, Math.min(r, shoreRadius(a) * 0.975), y, centre(y)) };
    });
  };
  // An undercut pulls the ring above it inward and down, leaving a shelf of rock overhanging.
  const undercut = (above, pull, drop) =>
    above.map(({ a, p }) => {
      const y = p[1] - between(drop * 0.5, drop * 1.5),
        c = centre(y),
        f = pull * between(0.9, 1.06);
      return { a, p: [c[0] + (p[0] - c[0]) * f, y, c[1] + (p[2] - c[1]) * f] };
    });
  // A thin crust of soil directly under the streets, then seven craggy tiers.
  const crust = rim.map(({ a, p }) => {
    const f = between(0.95, 0.975);
    return { a, p: [p[0] * f, -between(0.014, 0.024), p[2] * f] };
  });
  const r1 = ring(0.13, 34, 0.012, 0.07),
    u1 = undercut(r1, 0.93, 0.012),
    r2 = ring(0.28, 30, 0.014, 0.11),
    r3 = ring(0.42, 26, 0.014, 0.13),
    u3 = undercut(r3, 0.88, 0.014),
    r4 = ring(0.56, 20, 0.013, 0.15),
    r5 = ring(0.7, 15, 0.012, 0.17),
    u5 = undercut(r5, 0.85, 0.012),
    r6 = ring(0.83, 10, 0.01, 0.18),
    r7 = ring(0.93, 6, 0.005, 0.15);

  const paint = (kind) => (a, b, c) => {
    const t = (a[1] + b[1] + c[1]) / 3 / bottom,
      gain = between(0.86, 1.14);
    if (kind === 'soil') return tone('#7a5236', '#69442e', random(), gain);
    if (kind === 'under') return tone('#4e3426', '#34231c', t, gain);
    if (kind === 'stone' || random() < 0.12) return tone('#b08a5c', '#8c6a48', random(), gain);
    return tone('#96693f', '#523626', t ** 0.9, gain);
  };
  const bands = [
    [rim, crust, 'soil'],
    [crust, r1, 'earth'],
    [r1, u1, 'under'],
    [u1, r2, 'earth'],
    [r2, r3, 'stone'],
    [r3, u3, 'under'],
    [u3, r4, 'earth'],
    [r4, r5, 'earth'],
    [r5, u5, 'under'],
    [u5, r6, 'stone'],
    [r6, r7, 'earth'],
  ];
  for (const [upper, lower, kind] of bands) stitch(s.earth, upper, lower, paint(kind));
  const tip = [...centre(bottom)];
  const cap = paint('earth');
  for (let i = 0; i < r7.length; i++) {
    const a = r7[i].p,
      b = r7[(i + 1) % r7.length].p,
      c = [tip[0], bottom, tip[1]];
    face(s.earth, [a, b, c], cap(a, b, c));
  }

  // Fragments drift below the tip, spaced evenly around it and clear of the rock.
  const signs = [-1, 1];
  const start = between(0, TAU);
  for (let i = 0; i < 5; i++) {
    const a = start + (i * TAU) / 5 + between(-0.4, 0.4),
      out = between(0.03, 0.08),
      r = between(0.007, 0.013) * (i === 0 ? 1.5 : 1),
      y = bottom - between(0.012, 0.035);
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
          face(s.earth, pts, random() < 0.35 ? tone('#b08a5c', '#75685c', random()) : tone('#8a5f3d', '#553828', random()));
        }
  }
}
