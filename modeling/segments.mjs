import { readFileSync } from 'node:fs';
import { places } from '../server/src/db/seed.ts';
import {
  Model,
  box,
  face,
  rect,
  loft,
  rod,
  circle,
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
  pink: '#ff73ca',
  cyan: '#62e9fa',
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
const deckSize = 0.856;
const edge = 0.424;
const to3 = ([x, z], y) => [x, y, z];
const turn = (a, b, p) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const signedArea = (ring) =>
  ring.reduce((n, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return n + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
function segmentDistance(p, a, b) {
  const dx = b[0] - a[0],
    dz = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1),
    ),
  );
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function contains(ring, [x, z]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j];
    if (b > z !== d > z && x < a + ((c - a) * (z - b)) / (d - b))
      inside = !inside;
  }
  return inside;
}
function simplify(ring, tolerance, closed) {
  const points = ring.slice();
  let changed = true;
  while (changed && points.length > (closed ? 3 : 2)) {
    changed = false;
    for (let i = closed ? 0 : 1; i < points.length - (closed ? 0 : 1); i++) {
      const a = points[(i + points.length - 1) % points.length];
      const b = points[(i + 1) % points.length];
      if (segmentDistance(points[i], a, b) <= tolerance) {
        points.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}
// Positive signed area in XZ faces down in glTF. Reverse only the emitted roof triangles.
function triangulate(ring) {
  const active = ring.map((_, i) => i);
  const triangles = [];
  while (active.length > 3) {
    const ear = active.findIndex((j, i) => {
      const a = ring[active[(i + active.length - 1) % active.length]];
      const b = ring[j],
        c = ring[active[(i + 1) % active.length]];
      return (
        turn(a, b, c) > 1e-14 &&
        !active.some((k) => {
          const p = ring[k];
          return (
            p !== a &&
            p !== b &&
            p !== c &&
            turn(a, b, p) >= -1e-14 &&
            turn(b, c, p) >= -1e-14 &&
            turn(c, a, p) >= -1e-14
          );
        })
      );
    });
    if (ear < 0) return null;
    triangles.push([
      active[(ear + active.length - 1) % active.length],
      active[ear],
      active[(ear + 1) % active.length],
    ]);
    active.splice(ear, 1);
  }
  if (turn(...active.map((i) => ring[i])) > 1e-14) triangles.push(active);
  return triangles.map((tri) => tri.map((i) => ring[i]));
}
// Clip convex pieces independently so a concave polygon can leave two separate islands.
function clip(poly) {
  for (const axis of [0, 1])
    for (const sign of [-1, 1]) {
      if (!poly.length) return poly;
      const output = [];
      let a = poly.at(-1);
      for (const b of poly) {
        const insideA = sign * a[axis] <= edge,
          insideB = sign * b[axis] <= edge;
        if (insideA !== insideB) {
          const p = mix(a, b, (sign * edge - a[axis]) / (b[axis] - a[axis]));
          p[axis] = sign * edge;
          output.push(p);
        }
        if (insideB) output.push(b);
        a = b;
      }
      poly = output;
    }
  return poly;
}
const inBounds = (p) => p.every((v) => Math.abs(v) <= edge);
function polygon(feature, scale, tolerance) {
  const raw = feature.ring.map((p) => p.map((v) => v * scale));
  let ring = simplify(raw, tolerance, true);
  if (signedArea(ring) < 0) ring.reverse();
  let triangles = triangulate(ring);
  if (!triangles) {
    ring = simplify(raw, 1e-8, true);
    if (signedArea(ring) < 0) ring.reverse();
    triangles = triangulate(ring);
  }
  if (!triangles) return null; // A self-crossing OSM way does not define a unique interior.
  const walls = [],
    roof = [];
  if (ring.every(inBounds)) {
    ring.forEach((a, i) => walls.push([a, ring[(i + 1) % ring.length]]));
    roof.push(...triangles);
  } else {
    const boundary = new Map();
    const key = ([x, z]) => Math.round(x * 1e9) + ',' + Math.round(z * 1e9);
    for (const tri of triangles) {
      const piece = clip(tri);
      if (piece.length < 3 || signedArea(piece) < 1e-12) continue;
      for (let i = 1; i < piece.length - 1; i++)
        if (turn(piece[0], piece[i], piece[i + 1]) > 1e-12)
          roof.push([piece[0], piece[i], piece[i + 1]]);
      piece.forEach((a, i) => {
        const b = piece[(i + 1) % piece.length],
          ka = key(a),
          kb = key(b);
        if (ka !== kb && !boundary.delete(kb + ':' + ka))
          boundary.set(ka + ':' + kb, [a, b]);
      });
    }
    walls.push(...boundary.values());
  }
  const area = roof.reduce((sum, tri) => sum + turn(...tri) / 2, 0);
  return area > 1e-10 ? { ...feature, ring, walls, roof, area } : null;
}
function roofFaces(surface, roof, y, color) {
  for (const [a, b, c] of roof)
    face(surface, [to3(a, y), to3(c, y), to3(b, y)], color);
}
function street(s, road, scale) {
  const widthM =
    {
      primary: 12,
      secondary: 10,
      tertiary: 8,
      residential: 6.5,
      pedestrian: 4,
      service: 3.8,
      footway: 1.8,
      unclassified: 6,
    }[road.kind] ?? 5;
  const points = simplify(
    road.points.map((p) => p.map((v) => v * scale)),
    0.0008,
    false,
  ).filter((p, i, arr) => !i || Math.hypot(...sub(p, arr[i - 1])) > 1e-8);
  const offsets = points.slice(1).map((p, i) => {
    const [dx, dz] = norm(sub(p, points[i]));
    return [-dz, dx];
  });
  const halves = points.map((p, i) => {
    const n = offsets[i] ?? offsets.at(-1);
    if (!n) return [p, p];
    const prev = offsets[i - 1] ?? n,
      bisector = norm([n[0] + prev[0], n[1] + prev[1]]);
    const half =
      (widthM * scale) /
      (2 * Math.max(0.5, bisector[0] * n[0] + bisector[1] * n[1]));
    return [-1, 1].map((sign) =>
      p.map((v, j) => v + sign * half * bisector[j]),
    );
  });
  const foot = road.kind === 'footway' || road.kind === 'pedestrian';
  const y = foot ? 0.00184 : road.major ? 0.0024 : 0.0021;
  const color = foot ? '#bfb9a7' : road.major ? '#53596a' : '#747783';
  for (let i = 1; i < halves.length; i++) {
    const [a, b] = halves[i - 1],
      [c, d] = halves[i];
    for (const tri of [
      [a, c, d],
      [a, d, b],
    ]) {
      const piece = simplify(clip(tri), 1e-9, true);
      const area = signedArea(piece);
      if (Math.abs(area) < 1e-11) continue;
      if (area > 0) piece.reverse();
      face(
        s.city,
        piece.map((p) => to3(p, y)),
        color,
      );
    }
  }
  return { points, radius: (widthM * scale) / 2 };
}
// OSM often supplies both an overall building and its component parts. Keep only exposed
// surfaces so equal-height roofs and shared party walls never compete for the same pixels.
function boundsOf(points) {
  return [0, 1].map((i) => [
    Math.min(...points.map((p) => p[i])),
    Math.max(...points.map((p) => p[i])),
  ]);
}
const overlaps = (a, b) =>
  a.every(([lo, hi], i) => lo <= b[i][1] + 1e-8 && hi >= b[i][0] - 1e-8);
function subtractTriangle(poly, tri) {
  let inside = poly;
  const outside = [];
  for (let i = 0; i < 3; i++) {
    const a = tri[i],
      b = tri[(i + 1) % 3],
      keep = [],
      cut = [];
    let prev = inside.at(-1),
      d0 = turn(a, b, prev);
    for (const p of inside) {
      const d1 = turn(a, b, p);
      if (d0 < 0 !== d1 < 0) {
        const q = mix(prev, p, d0 / (d0 - d1));
        keep.push(q);
        cut.push(q);
      }
      (d1 < 0 ? cut : keep).push(p);
      prev = p;
      d0 = d1;
    }
    if (signedArea(keep) < 1e-12) return [poly];
    if (signedArea(cut) > 1e-12) outside.push(cut);
    inside = keep;
  }
  return outside;
}
function exposedShells(buildings) {
  for (const b of buildings) {
    b.bounds = boundsOf(b.roof.flat());
    b.triangles = b.roof.map((tri) => ({ tri, bounds: boundsOf(tri) }));
  }
  buildings.sort(
    (a, b) =>
      b.height - a.height ||
      Number(b.hero) - Number(a.hero) ||
      (b.groundPriority ?? 0) - (a.groundPriority ?? 0) ||
      Number(Boolean(b.name)) - Number(Boolean(a.name)) ||
      b.area - a.area ||
      a.id - b.id,
  );
  for (const [rank, b] of buildings.entries()) b.rank = rank;
  for (const b of buildings) {
    const neighbors = buildings.filter(
      (other) => other !== b && overlaps(b.bounds, other.bounds),
    );
    b.visibleRoof = [];
    for (const { tri, bounds } of b.triangles) {
      let pieces = [tri];
      for (const other of neighbors) {
        if (other.rank > b.rank || !overlaps(bounds, other.bounds)) continue;
        for (const cutter of other.triangles) {
          if (overlaps(bounds, cutter.bounds))
            pieces = pieces.flatMap((piece) =>
              subtractTriangle(piece, cutter.tri),
            );
          if (!pieces.length) break;
        }
        if (!pieces.length) break;
      }
      for (const piece of pieces)
        for (let i = 1; i < piece.length - 1; i++) {
          if (turn(piece[0], piece[i], piece[i + 1]) > 1e-11)
            b.visibleRoof.push([piece[0], piece[i], piece[i + 1]]);
        }
    }
    b.visibleWalls = [];
    for (const [a, c] of b.walls) {
      const bounds = boundsOf([a, c]),
        near = neighbors.filter((o) => overlaps(bounds, o.bounds));
      const length = Math.hypot(...sub(c, a));
      if (length < 1e-7) continue;
      const cuts = [0, 1],
        dir = sub(c, a),
        normal = [dir[1] / length, -dir[0] / length];
      for (const o of near)
        for (const [u, v] of o.walls) {
          if (!overlaps(bounds, boundsOf([u, v]))) continue;
          const d0 = turn(u, v, a),
            d1 = turn(u, v, c);
          if (Math.abs(d0 - d1) > 1e-14) {
            const t = d0 / (d0 - d1);
            if (t > 0 && t < 1 && segmentDistance(mix(a, c, t), u, v) < 1e-8)
              cuts.push(t);
          } else if (
            segmentDistance(u, a, c) < 1e-8 ||
            segmentDistance(v, a, c) < 1e-8
          ) {
            for (const p of [u, v]) {
              const t =
                ((p[0] - a[0]) * dir[0] + (p[1] - a[1]) * dir[1]) /
                (length * length);
              if (t > 0 && t < 1) cuts.push(t);
            }
          }
        }
      cuts.sort((u, v) => u - v);
      for (let i = 1; i < cuts.length; i++) {
        if ((cuts[i] - cuts[i - 1]) * length < 1e-7) continue;
        const mid = mix(a, c, (cuts[i - 1] + cuts[i]) / 2);
        const side = (sign) => mid.map((v, k) => v + sign * normal[k] * 1e-7);
        const covered = near.filter(
          (o) =>
            (inBounds(side(1)) && contains(o.ring, side(1))) ||
            (o.rank < b.rank && contains(o.ring, side(-1))),
        );
        const base = Math.max(0.00255, ...covered.map((o) => o.height));
        if (base < b.height - 1e-6)
          b.visibleWalls.push([
            mix(a, c, cuts[i - 1]),
            mix(a, c, cuts[i]),
            base,
          ]);
      }
    }
  }
  return buildings.filter((b) => b.visibleRoof.length || b.visibleWalls.length);
}

// A repeating sash, mullion and sill for the miniature street elevations (32 x 32 RGB PNG).
const sashTile = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAyElEQVR42u3VOQoCQRSE4bmzK+5eQEcHe1wmdsXdQ5gJHsBA8AyCGCi8sCqwBjpy4M8K3kdHHbxfT68FGfCvQBy5FGlArjPFQpd8o5MM5LszzAA6yUAhnGMG0EkGir0FZgCdZKDUX2IG0EkGytEKM4BOMmC3fk8GKoM1ZrfoJANVt8EMoJMM1OItZgCdZKA+3GEG0EkGGqM9ZgCdZKA5PmAG0EkGWpMjZgCdZKCdnDAD6CQDHv+D6+WcuuzTzwAvwON+85r3F3wAl3Y27/RpLRsAAAAASUVORK5CYII=',
  'base64',
);
const masonry = [
  ['#ae7972', '#855c5b', '#c6a69b'],
  ['#d9c8b0', '#b1a28d', '#ede2c8'],
  ['#a1b1bc', '#798b9b', '#c4d0d3'],
  ['#b38b7c', '#97786e', '#d8bc9e'],
  ['#9999a6', '#717381', '#b9bdc6'],
  ['#c0b6af', '#998e89', '#d9d0c1'],
];
const spectral = [
  ['#553790', '#b349bf', '#ffa4df', '#a0f2fa', '#ff83d2'],
  ['#4157a4', '#477fd4', '#93faff', '#d9a0fb', '#8cedfb'],
];
// Two shallow, angled planes meet on a luminous ridge. Split the original roof
// triangles at that line, preserving setbacks, concavities and the street footprint.
function crystalRoof(s, b, hue, neon) {
  const [[x0, x1], [z0, z1]] = b.bounds;
  const direction = x1 - x0 < z1 - z0 ? [0.94, 0.34] : [0.31, 0.95];
  const project = (p) => p[0] * direction[0] + p[1] * direction[1];
  const projections = b.roof.flat().map(project);
  const lo = Math.min(...projections),
    hi = Math.max(...projections),
    ridge = lo + 0.62 * (hi - lo);
  const rise = Math.min(0.031, b.height * 0.095, (hi - lo) * 0.32);
  const height = (p) =>
    b.height +
    rise *
      Math.max(
        0,
        Math.min(
          (project(p) - lo) / (ridge - lo),
          (hi - project(p)) / (hi - ridge),
        ),
      );
  function split(points, sign) {
    const out = [];
    let prev = points.at(-1),
      a = (project(prev) - ridge) * sign;
    for (const p of points) {
      const d = (project(p) - ridge) * sign;
      if (a < 0 !== d < 0) out.push(mix(prev, p, a / (a - d)));
      if (d >= 0) out.push(p);
      prev = p;
      a = d;
    }
    return out;
  }
  for (const tri of b.visibleRoof)
    for (const side of [-1, 1]) {
      const piece = simplify(split(tri, side), 1e-9, true);
      if (signedArea(piece) < 1e-12) continue;
      face(
        s.glass,
        piece.reverse().map((p) => to3(p, height(p))),
        side < 0 ? hue[2] : hue[3],
      );
    }
  for (const [a, c] of b.visibleWalls) {
    const cuts = [a],
      p0 = project(a) - ridge,
      p1 = project(c) - ridge;
    if (p0 * p1 < 0) cuts.push(mix(a, c, p0 / (p0 - p1)));
    cuts.push(c);
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1],
        end = cuts[i],
        h0 = height(start),
        h1 = height(end);
      const low = to3(start, b.height),
        last = to3(end, b.height);
      const trim0 = Math.max(b.height, h0 - 0.0011),
        trim1 = Math.max(b.height, h1 - 0.0011);
      for (const [surf, pts, tint] of [
        [s.glass, [low, to3(start, trim0), to3(end, trim1), last], hue[1]],
        [
          neon,
          [to3(start, trim0), to3(start, h0), to3(end, h1), to3(end, trim1)],
          hue[4],
        ],
      ]) {
        for (const tri of [
          [pts[0], pts[1], pts[2]],
          [pts[0], pts[2], pts[3]],
        ])
          if (
            Math.hypot(...cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) >
            1e-12
          )
            face(surf, tri, tint);
      }
    }
  }
}
function renderBuilding(s, b, detail) {
  const tone = masonry[b.id % masonry.length];
  const hue = spectral[b.tint],
    neon = b.tint ? s.neonBlue : s.neonPink;
  const y = b.height;
  const corniceHeight = Math.min(0.0026, y * 0.07);
  const crown =
    b.hero &&
    y > 0.07 &&
    b.visibleRoof.length &&
    b.visibleRoof.reduce((n, tri) => n + turn(...tri) / 2, 0) > b.area * 0.98;
  if (crown) crystalRoof(s, b, hue, neon);
  else
    roofFaces(
      b.hero ? s.glass : s.city,
      b.visibleRoof,
      y,
      b.hero ? hue[2] : tone[2],
    );
  for (const [i, [a, end, base]] of b.visibleWalls.entries()) {
    const trimY = Math.max(base + (y - base) * 0.1, y - corniceHeight);
    const length = Math.hypot(...sub(a, end));
    if (length < 1e-7) continue;
    const cut = a.some(
      (v, j) =>
        Math.abs(Math.abs(v) - edge) < 1e-8 && Math.abs(v - end[j]) < 1e-8,
    );
    const raised = (p, h) => [p[0], h, p[1]];
    const wall = (surface, bottom, top, color, start = a, finish = end) =>
      face(
        surface,
        [
          raised(start, bottom),
          raised(start, top),
          raised(finish, top),
          raised(finish, bottom),
        ],
        color,
      );
    if (b.hero) {
      const lo = raised(a, base),
        hi = raised(a, trimY),
        next = raised(end, trimY),
        foot = raised(end, base);
      const sideShade = (i + b.id) % 3;
      for (const [points, colors] of [
        [
          [lo, hi, next],
          [hue[0], hue[2], hue[sideShade + 1]],
        ],
        [
          [lo, next, foot],
          [hue[0], hue[sideShade + 1], hue[1]],
        ],
      ]) {
        const normal = norm(
          cross(sub(points[1], points[0]), sub(points[2], points[0])),
        );
        s.glass.indices.push(
          ...points.map((p, k) => s.glass.vertex(p, normal, colors[k])),
        );
      }
      wall(neon, trimY, y, hue[4]);
    } else {
      const cornice = detail && length > 0.014;
      const top = cornice ? trimY : y;
      const bodyColor = tone[b.id % 6 === 0 ? 1 : 0];
      if (cut || length < 0.004) wall(s.city, base, top, bodyColor);
      else {
        const cols = Math.max(1, Math.round(length / 0.009)),
          stories = Math.max(1, Math.round((top - base) / 0.02));
        face(
          s.facade,
          [
            raised(a, base),
            raised(a, top),
            raised(end, top),
            raised(end, base),
          ],
          bodyColor,
          [
            [0, stories],
            [0, 0],
            [cols, 0],
            [cols, stories],
          ],
        );
      }
      if (cornice) wall(s.city, trimY, y, tone[2]);
    }
    // Coplanar decoration would flicker in the headset. Lift facade details out by 0.08 mm.
    const shift = [
      (0.00008 * (end[1] - a[1])) / length,
      (0.00008 * (a[0] - end[0])) / length,
    ];
    const at = (t) => mix(a, end, t).map((v, k) => v + shift[k]);
    if (cut || !inBounds(at(0)) || !inBounds(at(1)) || length < 0.008) continue;
    if (b.hero) {
      wall(
        neon,
        base,
        trimY,
        hue[4],
        at(0.01),
        at(Math.min(0.16, 0.01 + 0.0012 / length)),
      );
      if (length > 0.022) {
        const count = Math.min(
          14,
          Math.max(1, Math.floor((trimY - base) / 0.021)),
        );
        for (let j = 1; j <= count; j++) {
          const h = base + ((trimY - base) * j) / (count + 1);
          wall(
            s.window,
            h,
            Math.min(trimY, h + 0.00085),
            hue[3],
            at(0.07),
            at(0.93),
          );
        }
      }
      if (length > 0.018 && y - base > 0.07) {
        const q = at(0.08),
          r = at(0.92),
          delta = (trimY - base) * 0.1;
        face(
          s.light,
          [
            raised(q, base + delta),
            raised(q, base + delta + 0.0015),
            raised(r, trimY - delta + 0.0015),
            raised(r, trimY - delta),
          ],
          hue[3],
        );
      }
    }
  }
}
function tree(s, [x, z], h, pine) {
  rod(s.city, [x, 0.0015, z], [x, h * 0.58, z], h * 0.045, '#826b51', 5);
  if (pine) {
    for (let i = 0; i < 3; i++) {
      const y = h * (0.22 + i * 0.18),
        r = h * (0.25 - i * 0.044);
      const ring = circle(x, y, z, r, 7),
        tip = [x, y + h * 0.42, z];
      for (let k = 0; k < ring.length; k++)
        face(
          s.city,
          [ring[k], tip, ring[(k + 1) % 7]],
          ['#317365', '#438e6b', '#6aa573'][i],
        );
    }
  } else {
    ellipsoid(
      s.city,
      [x, h * 0.63, z],
      [h * 0.28, h * 0.32, h * 0.25],
      '#719c74',
      7,
      4,
    );
    ellipsoid(
      s.city,
      [x + h * 0.1, h * 0.78, z],
      [h * 0.19, h * 0.22, h * 0.18],
      '#94b67a',
      6,
      3,
    );
  }
}
function distanceTo(b, p) {
  if (contains(b.ring, p)) return 0;
  return b.walls.reduce(
    (d, [a, end]) => Math.min(d, segmentDistance(p, a, end)),
    Infinity,
  );
}
function plant(s, parks, buildings, roads, venues, random, limit) {
  const trees = [];
  for (const park of parks.toSorted((a, b) => b.area - a.area)) {
    if (['pitch', 'stadium'].includes(park.kind)) continue;
    const vertices = park.roof.flat();
    const bounds = [0, 1].map((j) => [
      Math.min(...vertices.map((p) => p[j])),
      Math.max(...vertices.map((p) => p[j])),
    ]);
    const wanted = Math.min(30, Math.ceil(park.area / 0.0013));
    let planted = 0;
    for (
      let i = 0;
      i < wanted * 45 && planted < wanted && trees.length < limit;
      i++
    ) {
      const p = bounds.map(([a, b]) => a + (b - a) * random());
      const h = 0.019 + random() * 0.024,
        r = h * 0.31;
      if (
        p.some((v) => Math.abs(v) + r > edge) ||
        distanceTo(park, p) > 0 ||
        buildings.some((b) => distanceTo(b, p) < r) ||
        venues.some((v) => Math.hypot(...sub(v.p, p)) < r) ||
        trees.some((q) => Math.hypot(...sub(q, p)) < r + 0.006) ||
        roads.some(({ points, radius }) =>
          points.some(
            (q, j) => j && segmentDistance(p, q, points[j - 1]) < radius + r,
          ),
        )
      )
        continue;
      tree(s, p, h, random() < 0.5);
      trees.push(p);
      planted++;
    }
  }
}
// Use the same float32 positions and indexed triangles that Model.save writes to the GLB.
function topAt(meshes, [x, z]) {
  let y = -Infinity;
  for (const {
    positions: p,
    indices,
    translation: [dx, dy, dz] = [0, 0, 0],
  } of meshes) {
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3,
        b = indices[i + 1] * 3,
        c = indices[i + 2] * 3;
      const ax = p[a] - p[c],
        az = p[a + 2] - p[c + 2],
        bx = p[b] - p[c],
        bz = p[b + 2] - p[c + 2];
      const det = ax * bz - bx * az;
      if (Math.abs(det) < 1e-12) continue;
      const px = x - dx - p[c],
        pz = z - dz - p[c + 2];
      const u = (px * bz - pz * bx) / det,
        v = (ax * pz - az * px) / det;
      if (u >= -1e-7 && v >= -1e-7 && u + v <= 1.0000001)
        y = Math.max(
          y,
          dy + u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1],
        );
    }
  }
  if (!Number.isFinite(y)) throw new Error('No deck under pin at ' + [x, z]);
  return [x, y + 0.018, z];
}
function fallbackPins(buildings, meshes) {
  const candidates = buildings
    .filter((b) => b.visibleRoof.length)
    .map((b) => {
      const tri = b.visibleRoof.reduce((a, c) =>
        turn(...a) > turn(...c) ? a : c,
      );
      return [0, 1].map((i) => tri.reduce((n, p) => n + p[i], 0) / 3);
    });
  const picks = [candidates.shift()];
  while (picks.length < 8) {
    const score = (p) =>
      Math.min(...picks.map((q) => Math.hypot(...sub(q, p))));
    const next = candidates.reduce((a, b) => (score(a) > score(b) ? a : b));
    picks.push(next);
    candidates.splice(candidates.indexOf(next), 1);
  }
  return picks.map((p) => topAt(meshes, p));
}
export function segments(dir) {
  const { areas } = JSON.parse(
    readFileSync(new URL('./osm-data.json', import.meta.url)),
  );
  const anchors = {};
  for (const [index, [id, , station, code]] of focal.entries()) {
    const area = areas[id],
      { centerLat, centerLon, spanMeters } = area,
      scale = deckSize / spanMeters;
    const random = rng(700 + index),
      m = new Model(),
      s = palette(m);
    hardware(m, s, code, station);
    s.facade = m.surface(
      m.material('Masonry street elevations', { rough: 0.84 }),
    );
    m.textures.push({
      bytes: sashTile,
      material: s.facade.material,
      name: 'Miniature window sash',
    });
    box(s.city, 0, -0.0035, 0, deckSize, 0.007, deckSize, '#b2b2a6', 0.017);
    const venues = places
      .filter((p) => p.stop_id === id)
      .map((v) => ({
        id: v.id,
        p: [
          (v.lon - centerLon) *
            111320 *
            Math.cos((centerLat * Math.PI) / 180) *
            scale,
          -(v.lat - centerLat) * 110540 * scale,
        ],
      }));
    const buildings = area.buildings
      .map((b) => polygon(b, scale, 0.00036))
      .filter((b) => b && b.area >= 18 * scale * scale);
    const parks = [
      ...area.parks,
      ...area.waters.map((w) => ({ ...w, kind: 'water' })),
    ]
      .map((p) => polygon(p, scale, 0.00033))
      .filter(Boolean);
    // Trim nested parks and pitches before drawing their shared ground plane.
    for (const p of parks) {
      p.height = 0.0015;
      p.groundPriority = 1 / p.area;
    }
    for (const p of exposedShells(parks))
      roofFaces(
        s.city,
        p.visibleRoof,
        0.0015,
        p.kind === 'water'
          ? '#6da4ad'
          : p.kind === 'pitch'
            ? '#7cab80'
            : ['#88a581', '#94af86', '#a2b88c'][p.id % 3],
      );
    const roads = area.roads.map((r) => street(s, r, scale));
    buildings.sort(
      (a, b) => b.heightM - a.heightM || b.area - a.area || a.id - b.id,
    );
    const tallest = buildings[0].heightM;
    const landmark =
      /Computing & Data Sciences|Marshall Tower|Fairfield Tower|Shields Tower|George Sherman Union|Brighton Music Hall|88 Food Connection|Green Monster|Vineyard Vines Club|Fenway Farms|Kenmore Tower|Memorial Hall|Memorial Church|Widener Library|Winthrop Center|State Street Financial Center/i;
    const highlights = new Set();
    const skyline = [];
    for (const b of buildings) {
      if (b.area < 0.0004 || b.area < Math.abs(signedArea(b.ring)) * 0.23)
        continue;
      const site = b.roof[0][0];
      if (skyline.some((p) => Math.hypot(...sub(site, p)) < 0.07)) continue;
      skyline.push(site);
      highlights.add(b);
      if (skyline.length === 6) break;
    }
    for (const v of venues) {
      const nearest = buildings.reduce((best, b) =>
        distanceTo(b, v.p) < distanceTo(best, v.p) ? b : best,
      );
      highlights.add(nearest);
    }
    let color = 0;
    // Reserve facade detail for large, legible street fronts. All eligible footprints keep roofs and walls.
    const detailed = new Set(
      buildings
        .toSorted((a, b) => b.area - a.area)
        .slice(0, area.buildings.length > 300 ? 15 : 30),
    );
    const scaleHeight = (h) => 0.46 * Math.tanh(0.014 * h);
    for (const b of buildings) {
      b.hero = highlights.has(b) || landmark.test(b.name ?? '');
      if (b.hero) b.tint = color++ % 2;
      b.height =
        scaleHeight(b.heightM) +
        Math.max(0, 0.35 - scaleHeight(tallest)) * (b.heightM / tallest) ** 5;
    }
    const rendered = exposedShells(buildings);
    for (const b of rendered) renderBuilding(s, b, detailed.has(b));
    plant(s, parks, buildings, roads, venues, random, 40);
    const meshes = m.surfaces.map((surface) => ({
      ...surface,
      positions: Float32Array.from(surface.positions),
    }));
    const tris = meshes.reduce((n, s) => n + s.indices.length / 3, 0);
    if (tris >= 35000)
      throw new Error(id + ' exceeds geometry budget: ' + tris);
    anchors[id] = {
      lcdNode: 'LCD_Screen',
      dialNode: 'Rotary_Dial',
      deckY: 0,
      projection: { centerLat, centerLon, spanMeters, deckSize },
      placeAnchors: Object.fromEntries(
        venues.map(({ id, p }) => [id, topAt(meshes, p)]),
      ),
      pinAnchors: fallbackPins(rendered, meshes),
    };
    m.save(dir + 'segment-' + id + '.glb');
    console.log(
      id,
      rendered.length + ' OSM building ways',
      tris + ' triangles',
      meshes.filter((s) => s.indices.length).length + ' primitives',
    );
  }
  json(dir + 'segment-anchors.json', anchors);
}
