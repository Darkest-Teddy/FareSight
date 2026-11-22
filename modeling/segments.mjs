import { existsSync, readFileSync } from 'node:fs';
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
  mix,
  rng,
} from './geometry.mjs';
import { focal, json } from './transit.mjs';
import { island, palette } from './segment-island.mjs';
import { TAU } from './geometry.mjs';
import { FACADES, facadeTexture } from './facades.mjs';

const deckSize = 0.856;
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
// The city is cropped to a convex, slightly irregular outline rather than a square, so its edge
// reads as a natural shoreline. Set per station by setOutline().
let outline = [];
let outlineEdges = [];
function setOutline(points) {
  outline = points;
  outlineEdges = points.map((a, i) => {
    const b = points[(i + 1) % points.length];
    return { a, b, sign: Math.sign(turn(a, b, [0, 0])), length: Math.hypot(b[0] - a[0], b[1] - a[1]) };
  });
}
// Signed distance to the outline: positive inside.
const depthInside = (p) =>
  Math.min(...outlineEdges.map(({ a, b, sign, length }) => (sign * turn(a, b, p)) / length));
// Where the ray from the deck centre through `angle` leaves the outline.
export function outlineRadius(angle) {
  const d = [Math.cos(angle), Math.sin(angle)];
  let best = Infinity;
  for (const { a, b } of outlineEdges) {
    const e = [b[0] - a[0], b[1] - a[1]],
      det = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(det) < 1e-12) continue;
    const t = (a[0] * e[1] - a[1] * e[0]) / det,
      u = (a[0] * d[1] - a[1] * d[0]) / det;
    if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.min(best, t);
  }
  return best;
}
// Clip convex pieces independently so a concave polygon can leave two separate islands.
function clip(poly) {
  for (const { a: p0, b: p1, sign } of outlineEdges) {
    if (!poly.length) return poly;
    const output = [];
    let a = poly.at(-1),
      da = sign * turn(p0, p1, a);
    for (const b of poly) {
      const db = sign * turn(p0, p1, b);
      if (da >= 0 !== db >= 0) output.push(mix(a, b, da / (da - db)));
      if (db >= 0) output.push(b);
      a = b;
      da = db;
    }
    poly = output;
  }
  return poly;
}
const inBounds = (p) => depthInside(p) >= 0;
// True when a wall lies along the crop line, i.e. it is a section through a clipped building.
const onOutline = (a, b) =>
  outlineEdges.some(
    ({ a: p0, b: p1, length }) =>
      Math.abs(turn(p0, p1, a)) / length < 1e-7 && Math.abs(turn(p0, p1, b)) / length < 1e-7,
  );
function convexHull(points) {
  const pts = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const half = (list) => {
    const out = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out.at(-2), out.at(-1), p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(pts), ...half(pts.toReversed())];
}
// A rounded, gently lopsided shoreline that stays within the surveyed crop.
function shoreline(random) {
  const waves = [2, 3, 5].map((k) => [k, random() * TAU, 0.5 + random() * 0.5]);
  const count = 44;
  return convexHull(
    Array.from({ length: count }, (_, i) => {
      const a = (i * TAU) / count,
        squircle = 1 / (Math.abs(Math.cos(a)) ** 3 + Math.abs(Math.sin(a)) ** 3) ** (1 / 3),
        noise = waves.reduce((n, [k, phase, gain]) => n + gain * Math.sin(k * a + phase), 0) / 2.2;
      const r = Math.min(0.404 * squircle * (0.955 + 0.045 * noise), 0.418 / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))));
      return [r * Math.cos(a), r * Math.sin(a)];
    }),
  );
}
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
        const base = Math.max(b.baseY ?? 0.00255, ...covered.map((o) => o.height));
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
// ---- Survey interpretation -------------------------------------------------------------------
// Heights are true to the horizontal scale apart from one uniform vertical exaggeration, so
// houses, walk-ups and towers keep their real proportions to one another.
const VERTICAL = 1.3;
const LEVEL_M = 3.2;
const GROUND_Y = 0.00255;
// Venues at least this far inside the shoreline sit on the deck; the rest become rim markers.
export const VENUE_INSET = 0.012;
const VENUE_LIMIT = 0.4; // venues this close to the deck centre are always on the island
const PLOT_LIMIT = 0.432; // furthest a kept building may reach from the deck centre
const PLOT_PAD = 0.004;
const STATION_DISC = 0.021; // clearance radius kept under the station medallion
const RIM_OFFSET = 0.007; // rim markers stand on the turf just outside the city's edge
const compress = (h) => (h <= 90 ? h : 90 + (h - 90) * 0.55);

const FAMILY = {
  house: /^(house|detached|semidetached_house|terrace|residential|bungalow|cabin|farm)$/,
  walkup: /^(apartments|dormitory|hotel)$/,
  retail: /^(retail|commercial|supermarket|restaurant|kiosk|shop)$/,
  institutional:
    /^(university|college|school|church|cathedral|chapel|synagogue|hospital|office|civic|public|government|fire_station|train_station|community_centre|museum|library)$/,
  utility:
    /^(garage|garages|shed|hut|roof|carport|service|industrial|warehouse|parking|construction|grandstand|bleachers|stadium|air_shaft|gatehouse|guardhouse|balcony|bridge)$/,
};
// Fallback heights in metres for footprints with neither a height nor a level count in OSM.
const DEFAULT_HEIGHT = { house: 9, walkup: 13.5, retail: 5.5, institutional: 15, utility: 5 };
const LOW_UTILITY = /^(garage|garages|shed|hut|roof|carport|air_shaft|gatehouse|guardhouse|balcony)$/;

const PALETTE = {
  house: ['#ddd6c4', '#b9c2ba', '#cbbba2', '#abb6c4', '#dccdab', '#c1aa95', '#e6e2d9', '#b7a88f'],
  walkup: ['#a5634e', '#935946', '#b3745c', '#9d6751', '#c4aa8e', '#bbad9a'],
  retail: ['#cbc4b6', '#b8ad9d', '#a69d91', '#a86d58', '#c9b79c'],
  institutional: ['#d1c8b6', '#bfb7a8', '#aa6550', '#d8d2c6', '#b97a62'],
  utility: ['#a9a69e', '#b7b2a7', '#9c9a94', '#aea491'],
  // Towers are a soft blue-grey glass that sits with the masonry around them.
  tower: ['#ffffff', '#e4edf2', '#eef1f4', '#d7e2ea'],
};
const FLAT_ROOFS = ['#77756f', '#8a877f', '#6c6f73', '#a39d90'];
const PITCHED_ROOFS = ['#5f5b57', '#6e5f54', '#585d63', '#7a6a5c'];
const GROUND_COLOR = '#c3bdad';
const NAMED_COLOURS = {
  white: '#e8e5dd',
  grey: '#a9a8a4',
  gray: '#a9a8a4',
  black: '#4a4a4c',
  red: '#a5564a',
  brown: '#8d6b55',
  beige: '#d6c8ad',
  tan: '#c9b594',
  yellow: '#dccb8f',
  green: '#8fa58b',
  blue: '#8fa3b8',
  cream: '#e3dac5',
  orange: '#c58a5c',
};
function taggedColour(value) {
  if (!value) return null;
  const v = String(value).trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return '#' + [...v.slice(1)].map((ch) => ch + ch).join('');
  return NAMED_COLOURS[v] ?? null;
}
function shade(color, factor) {
  const n = parseInt(color.slice(1), 16);
  return (
    '#' +
    [n >> 16, (n >> 8) & 255, n & 255]
      .map((v) => Math.max(0, Math.min(255, Math.round(v * factor))).toString(16).padStart(2, '0'))
      .join('')
  );
}
const pick = (list, id, salt = 0) => list[Math.abs(Math.floor(id / 7) + id + salt) % list.length];

// The smallest enclosing rectangle gives each footprint a long axis for its ridge line.
function orientedBox(ring) {
  let best;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-9) continue;
    const u = [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
      v = [-u[1], u[0]];
    const us = ring.map((p) => p[0] * u[0] + p[1] * u[1]),
      vs = ring.map((p) => p[0] * v[0] + p[1] * v[1]);
    const u0 = Math.min(...us),
      u1 = Math.max(...us),
      v0 = Math.min(...vs),
      v1 = Math.max(...vs);
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, u, v, u0, u1, v0, v1 };
  }
  const long = best.u1 - best.u0 >= best.v1 - best.v0;
  return {
    across: long ? best.v : best.u,
    mid: long ? (best.v0 + best.v1) / 2 : (best.u0 + best.u1) / 2,
    half: (long ? best.v1 - best.v0 : best.u1 - best.u0) / 2,
    fill: Math.abs(signedArea(ring)) / best.area,
  };
}

// Resolve the family, wall finish, roof form and height of one surveyed footprint.
function classify(b, scale) {
  const areaM = Math.abs(signedArea(b.ring)) / (scale * scale);
  let family = Object.keys(FAMILY).find((k) => FAMILY[k].test(b.kind));
  if (b.material === 'brick' && (!family || family === 'house')) family = 'walkup';
  if (b.material === 'wood') family = 'house';
  if (!family) family = areaM < 260 ? 'house' : areaM < 1200 ? 'walkup' : 'institutional';

  const box = orientedBox(b.ring);
  const tagged = b.heightM ?? (b.levels ? b.levels * LEVEL_M + 1 : null);
  let heightM =
    tagged ??
    // An unsurveyed station building is a street-level headhouse over an underground station.
    (LOW_UTILITY.test(b.kind) ? 3 : b.kind === 'train_station' ? 5 : b.kind === 'parking' ? 9 : DEFAULT_HEIGHT[family]);
  heightM = Math.max(heightM, 2.4);

  const pitchedTag = /^(gabled|hipped|pyramidal|gambrel|half-hipped|saltbox|mansard)$/.test(b.roofShape ?? '');
  const pitched =
    box.fill > 0.62 &&
    heightM < 20 &&
    (pitchedTag || (family === 'house' && b.roofShape !== 'flat' && areaM < 420));
  let riseM = 0;
  if (pitched) {
    riseM = b.roofHeightM ?? Math.max(1.2, Math.min(3.6, (box.half / scale) * 0.62));
    // A tagged height is measured to the ridge, so the eaves sit one roof rise below it.
    if (tagged) heightM = Math.max(2.4, heightM - riseM);
  }
  const tower = heightM >= 45 && family !== 'utility';
  const glass = b.material === 'glass' || (tower && !/^(apartments|dormitory)$/.test(b.kind));
  const facade =
    family === 'utility'
      ? null
      : glass
        ? 'curtain'
        : { house: 'clapboard', walkup: 'brick', retail: 'brick', institutional: 'institutional' }[family];
  const finish =
    (glass ? null : taggedColour(b.colour)) ?? pick(PALETTE[glass ? 'tower' : family], b.id);
  const roofColor =
    taggedColour(b.roofColour) ?? pick(pitched ? PITCHED_ROOFS : FLAT_ROOFS, b.id, 3);
  return {
    family,
    areaM,
    box,
    heightM,
    riseM,
    pitched,
    tower,
    facade,
    finish,
    roofColor,
    storefront: !glass && family !== 'utility' && (family === 'retail' || b.shop),
    surveyed: tagged != null,
  };
}

// A wall panel whose colour darkens toward the pavement, standing in for ambient occlusion.
function wall(surface, a, end, lo, hi, colorLo, colorHi, uv) {
  const pts = [to3(a, lo), to3(a, hi), to3(end, hi), to3(end, lo)];
  const normal = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  const colors = [colorLo, colorHi, colorHi, colorLo];
  const ids = pts.map((p, i) => surface.vertex(p, normal, colors[i], uv?.[i]));
  surface.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
}

function gableRoof(s, b) {
  const { across, mid, half } = b.box;
  const offset = (p) => p[0] * across[0] + p[1] * across[1] - mid;
  const height = (p) => b.height + b.rise * Math.max(0, 1 - Math.abs(offset(p)) / half);
  function split(points, sign) {
    const out = [];
    let prev = points.at(-1),
      a = offset(prev) * sign;
    for (const p of points) {
      const d = offset(p) * sign;
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
      if (piece.length < 3 || signedArea(piece) < 1e-12) continue;
      face(
        s.city,
        piece.reverse().map((p) => to3(p, height(p))),
        b.roofColor,
      );
    }
  // Close each gable end with wall finish between the eaves line and the roof slope.
  for (const [a, c] of b.visibleWalls) {
    const cuts = [a],
      d0 = offset(a),
      d1 = offset(c);
    if (d0 * d1 < 0) cuts.push(mix(a, c, d0 / (d0 - d1)));
    cuts.push(c);
    for (let i = 1; i < cuts.length; i++) {
      const start = cuts[i - 1],
        end = cuts[i];
      const quad = [to3(start, b.height), to3(start, height(start)), to3(end, height(end)), to3(end, b.height)];
      for (const tri of [
        [quad[0], quad[1], quad[2]],
        [quad[0], quad[2], quad[3]],
      ])
        if (Math.hypot(...cross(sub(tri[1], tri[0]), sub(tri[2], tri[0]))) > 1e-10)
          face(s.city, tri, b.finish);
    }
  }
  return height;
}

// Fit a rooftop plant enclosure inside one exposed roof triangle, clear of venue and fallback pins.
function rooftopPlant(s, b, pins, scale) {
  for (const tri of b.visibleRoof.toSorted((a, c) => turn(...c) - turn(...a))) {
    const p = [0, 1].map((k) => tri.reduce((n, q) => n + q[k], 0) / 3);
    const radius = Math.min(...tri.map((a, i) => segmentDistance(p, a, tri[(i + 1) % 3])));
    const w = Math.min(9 * scale, radius * 1.3),
      d = w * 0.67;
    if (w < 3.5 * scale || pins.some((q) => Math.hypot(...sub(q, p)) < w + 0.004)) continue;
    const top = b.height + 2.6 * scale * VERTICAL;
    loft(s.city, [rect(p[0], b.height - 0.0001, p[1], w, d), rect(p[0], top, p[1], w, d)], '#8d8b85', {
      bottom: false,
    });
    return;
  }
}

function renderBuilding(s, b, pins, scale) {
  const y = b.height;
  if (b.pitched) gableRoof(s, b);
  else {
    roofFaces(s.city, b.visibleRoof, y, b.roofColor);
    if (b.areaM > 450 && b.heightM > 7) rooftopPlant(s, b, pins, scale);
  }
  const storeys = Math.max(1, Math.round(b.heightM / LEVEL_M));
  const storeyY = (y - GROUND_Y) / storeys;
  const cornice = b.pitched || !b.facade ? 0 : Math.min(0.6 * scale * VERTICAL, (y - GROUND_Y) * 0.12);
  const low = shade(b.finish, 0.78);
  const tint = (h) => shade(b.finish, 0.78 + 0.22 * Math.min(1, (h - GROUND_Y) / (storeyY * 1.5)));
  const v = (h) => (y - h) / storeyY;
  for (const [a, end, base] of b.visibleWalls) {
    const lengthM = Math.hypot(...sub(a, end)) / scale;
    if (lengthM < 1e-4) continue;
    const atEdge = onOutline(a, end);
    const top = y - cornice;
    if (!b.facade || atEdge || lengthM < 2.2 || top - base < storeyY * 0.45) {
      wall(s.city, a, end, base, y, atEdge ? shade(b.finish, 0.7) : tint(base), atEdge ? shade(b.finish, 0.7) : tint(y));
      continue;
    }
    let from = base;
    const shopTop = GROUND_Y + storeyY;
    if (b.storefront && base <= GROUND_Y + 1e-6 && lengthM >= 4 && shopTop <= top + 1e-9) {
      const cols = Math.max(1, Math.round(lengthM / FACADES.storefront.bayM));
      const lift = Math.min(shopTop, top);
      wall(s.facades.storefront, a, end, base, lift, low, tint(lift), [
        [0, 1],
        [0, 0],
        [cols, 0],
        [cols, 1],
      ]);
      from = lift;
    }
    if (top - from > 1e-6) {
      const cols = Math.max(1, Math.round(lengthM / FACADES[b.facade].bayM));
      wall(s.facades[b.facade], a, end, from, top, tint(from), tint(top), [
        [0, v(from)],
        [0, v(top)],
        [cols, v(top)],
        [cols, v(from)],
      ]);
    }
    if (cornice) wall(s.city, a, end, top, y, '#e3ddd0', '#e3ddd0');
  }
}

const LEAVES = ['#719c74', '#7da67a', '#68936d'];
function tree(s, [x, z], h, pine, simple) {
  const leaf = LEAVES[Math.floor((Math.abs(x * 7919 + z * 104729) * 1000) % LEAVES.length)];
  rod(s.city, [x, 0.0015, z], [x, h * 0.58, z], h * 0.045, '#826b51', simple ? 3 : 5);
  if (pine) {
    for (let i = 0; i < (simple ? 2 : 3); i++) {
      const y = h * (0.22 + i * 0.18),
        r = h * (0.25 - i * 0.044);
      const ring = circle(x, y, z, r, 6),
        tip = [x, y + h * 0.42, z];
      for (let k = 0; k < ring.length; k++)
        face(s.city, [ring[k], tip, ring[(k + 1) % 6]], ['#317365', '#438e6b', '#6aa573'][i]);
    }
  } else {
    ellipsoid(s.city, [x, h * 0.66, z], [h * 0.3, h * 0.33, h * 0.28], leaf, simple ? 6 : 7, simple ? 3 : 4);
    if (!simple)
      ellipsoid(s.city, [x + h * 0.1, h * 0.8, z], [h * 0.19, h * 0.22, h * 0.18], '#94b67a', 6, 3);
  }
}
function distanceTo(b, p) {
  if (contains(b.ring, p)) return 0;
  return b.walls.reduce((d, [a, end]) => Math.min(d, segmentDistance(p, a, end)), Infinity);
}
// Surveyed street trees first, then planting inside parks that carry no individual trees.
function plant(s, area, parks, buildings, roads, venues, random, scale, limit) {
  const trees = [];
  const blocked = (p, r, roadClear) =>
    depthInside(p) < r ||
    buildings.some((b) => distanceTo(b, p) < r * 0.5) ||
    venues.some((q) => Math.hypot(...sub(q, p)) < r + 0.004) ||
    trees.some((q) => Math.hypot(...sub(q, p)) < r * 1.2) ||
    roads.some(
      ({ points, radius, foot }) =>
        !foot && points.some((q, j) => j && segmentDistance(p, q, points[j - 1]) < radius * roadClear),
    );
  for (const point of area.trees ?? []) {
    if (trees.length >= limit) break;
    const p = point.map((n) => n * scale);
    const h = (7 + random() * 4.5) * scale * VERTICAL,
      r = h * 0.3;
    if (blocked(p, r, 0.7)) continue;
    tree(s, p, h, false, true);
    trees.push(p);
  }
  // Few street trees are mapped in some neighbourhoods; line the through streets there instead.
  if ((area.trees ?? []).length < 40)
    for (const road of roads) {
      if (!/^(primary|secondary|tertiary|residential)$/.test(road.kind)) continue;
      let side = 1,
        carried = 0;
      const spacing = 16 * scale;
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1],
          b = road.points[i];
        const length = Math.hypot(...sub(b, a));
        const normal = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
        for (let d = (spacing - carried) % spacing; d < length && trees.length < limit * 0.7; d += spacing) {
          side = -side;
          const h = (6.5 + random() * 3.5) * scale * VERTICAL,
            r = h * 0.3;
          const p = mix(a, b, d / length).map((n, k) => n + side * normal[k] * (road.radius + 1.7 * scale));
          if (blocked(p, r, 1)) continue;
          tree(s, p, h, false, true);
          trees.push(p);
        }
        carried = (carried + length) % spacing;
      }
    }
  for (const park of parks.toSorted((a, b) => b.area - a.area)) {
    if (!['park', 'garden', 'wood', 'grass', 'village_green', 'recreation_ground', 'cemetery'].includes(park.kind))
      continue;
    const vertices = park.roof.flat();
    const bounds = [0, 1].map((j) => [
      Math.min(...vertices.map((p) => p[j])),
      Math.max(...vertices.map((p) => p[j])),
    ]);
    const wanted = Math.min(14, Math.ceil(park.area / (260 * scale * scale)));
    let planted = trees.filter((q) => distanceTo(park, q) === 0).length;
    for (let i = 0; i < wanted * 40 && planted < wanted && trees.length < limit; i++) {
      const p = bounds.map(([a, b]) => a + (b - a) * random());
      const h = (7 + random() * 5) * scale * VERTICAL,
        r = h * 0.3;
      if (distanceTo(park, p) > 0 || blocked(p, r, 1.2)) continue;
      tree(s, p, h, random() < 0.3, false);
      trees.push(p);
      planted++;
    }
  }
  return trees.length;
}

// ---- Ground plane ----------------------------------------------------------------------------
const ROAD_WIDTH = {
  motorway: 13,
  trunk: 12,
  primary: 11,
  secondary: 10,
  tertiary: 9,
  residential: 7.5,
  unclassified: 7,
  living_street: 5.5,
  service: 3.8,
  pedestrian: 5,
  footway: 2.4,
  path: 2,
  cycleway: 2.4,
};
// Sweep a clipped ribbon along a surveyed centreline.
function ribbon(s, source, scale, widthM, y, color) {
  const points = simplify(
    source.map((p) => p.map((n) => n * scale)),
    0.0006,
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
    const half = (widthM * scale) / (2 * Math.max(0.5, bisector[0] * n[0] + bisector[1] * n[1]));
    return [-1, 1].map((sign) => p.map((n, j) => n + sign * half * bisector[j]));
  });
  for (let i = 1; i < halves.length; i++) {
    const [a, b] = halves[i - 1],
      [c, d] = halves[i];
    for (const tri of [
      [a, c, d],
      [a, d, b],
    ]) {
      const piece = simplify(clip(tri), 1e-9, true);
      const area = signedArea(piece);
      if (piece.length < 3 || Math.abs(area) < 1e-11) continue;
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
const isFoot = (road) => /^(footway|path|cycleway|pedestrian)$/.test(road.kind);
function roadWidth(road) {
  const table = ROAD_WIDTH[road.kind] ?? 6;
  const lanes = road.lanes && !isFoot(road) ? Math.max(table * 0.8, road.lanes * 3.4 + 2.4) : table;
  // Many Boston widths are surveyed in feet but tagged without a unit. A width far beyond what
  // the lane count allows is read as feet, and ignored if it is still implausible.
  let tagged = road.widthM;
  if (tagged && tagged > lanes * 1.5) tagged *= 0.3048;
  if (tagged && (tagged > lanes * 1.5 || tagged < lanes * 0.45)) tagged = null;
  return Math.min(22, tagged ?? lanes);
}
// Every way is drawn flat on the plate, so the network stays connected end to end. Crossings at
// different levels are told apart by stacking: a bridge lies a millimetre above what it crosses
// on a pale deck, and a road tunnel shows as a darker band beneath the streets over it.
const roadColor = (road) =>
  road.tunnel === 'yes'
    ? '#3d4048'
    : isFoot(road)
      ? '#e2dbc9'
      : road.major
        ? '#484c56'
        : road.kind === 'service'
          ? '#777a82'
          : '#5b5f69';
const roadY = (road) =>
  (isFoot(road) ? 0.00184 : road.major ? 0.0024 : 0.0021) + (road.lift ?? 0) - (road.tunnel === 'yes' ? 0.00035 : 0);
const hasSidewalk = (road) =>
  road.tunnel !== 'yes' && (road.bridge || !(isFoot(road) || road.kind === 'service' || road.kind === 'motorway'));
const sidewalkWidth = (road) => roadWidth(road) + (isFoot(road) ? 1.2 : road.kind === 'motorway' ? 2.4 : 5);
function sidewalk(s, road, scale) {
  if (hasSidewalk(road)) ribbon(s, road.points, scale, sidewalkWidth(road), 0.0017 + (road.lift ?? 0), '#dcd7cb');
}
function street(s, road, scale) {
  const foot = isFoot(road);
  const widthM = roadWidth(road);
  const out = ribbon(s, road.points, scale, widthM, roadY(road), roadColor(road));
  // Two-way arterials carry a painted centre line.
  if (road.major && !road.oneway && widthM >= 9 && road.tunnel !== 'yes')
    ribbon(s, road.points, scale, 0.45, 0.0025 + (road.lift ?? 0), '#e6c65c');
  return { ...out, foot, kind: road.kind };
}
// A round joint at each end of a carriageway closes the notch where two ways meet at an angle.
function roadJoints(s, roads, scale) {
  const done = new Set();
  const disc = (p, radius, y, color) => {
    const key = [p[0], p[1], radius.toFixed(6), y.toFixed(6), color].join(',');
    if (done.has(key) || depthInside(p) < radius) return;
    done.add(key);
    face(s.city, circle(p[0], y, p[1], radius, 10).reverse(), color);
  };
  for (const road of roads) {
    if (isFoot(road) || road.points.length < 2) continue;
    for (const end of [road.points[0], road.points.at(-1)]) {
      const p = end.map((n) => n * scale);
      if (hasSidewalk(road) && !road.bridge) disc(p, (sidewalkWidth(road) * scale) / 2, 0.0017 + (road.lift ?? 0), '#dcd7cb');
      disc(p, (roadWidth(road) * scale) / 2, roadY(road), roadColor(road));
    }
  }
}
// ---- Grade separation ------------------------------------------------------------------------
// Roads and rails become one list of ways. A bridge is lifted a millimetre per level so it lies
// over what it crosses; subway tunnels are left out; buildings are never altered.
function gradeWays(area) {
  const ways = [
    ...area.roads.map((r) => ({ ...r, width: roadWidth(r), foot: isFoot(r) })),
    ...(area.rails ?? []).map((r) => ({ ...r, rail: true, width: 3, foot: false })),
  ];
  for (const w of ways) {
    w.hidden = w.rail && w.tunnel === 'yes';
    w.lift = w.bridge && !w.hidden ? 0.001 * Math.max(1, w.layer || 1) : 0;
  }
  return ways;
}
// A road that runs on beneath a building shows as a dark archway where it meets the wall.
function archways(s, ways, buildings, scale) {
  let count = 0;
  for (const w of ways) {
    if (w.rail || w.bridge) continue;
    const pts = w.points.map((p) => p.map((n) => n * scale));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1],
        c = pts[i],
        length = Math.hypot(...sub(c, a));
      if (length < 1e-9) continue;
      const dir = sub(c, a).map((n) => n / length),
        bounds = boundsOf([a, c]);
      for (const b of buildings) {
        if (!overlaps(bounds, b.bounds)) continue;
        for (const [u, v, base] of b.visibleWalls) {
          if (base > GROUND_Y + 1e-6) continue;
          const d0 = turn(u, v, a),
            d1 = turn(u, v, c);
          if (d0 * d1 >= 0 || turn(a, c, u) * turn(a, c, v) >= 0) continue;
          const x = mix(a, c, d0 / (d0 - d1));
          // Only where the road really carries on under the building, not where it clips a corner.
          const reach = (m) => contains(b.ring, x.map((n, k) => n + dir[k] * m * scale));
          if (!((reach(2) && reach(7)) || (reach(-2) && reach(-7)))) continue;
          const wallLength = Math.hypot(...sub(v, u)),
            along = sub(v, u).map((n) => n / wallLength),
            out = [along[1], -along[0]];
          const t = Math.hypot(...sub(x, u)),
            half = Math.min((w.width * scale) / 2, t - 0.4 * scale, wallLength - t - 0.4 * scale);
          const rise = Math.min((w.foot ? 2.8 : 4.3) * scale * VERTICAL, (b.height - GROUND_Y) * 0.8);
          if (half < 0.7 * scale || inBounds(x) === false) continue;
          for (const sign of [-1, 1]) {
            const corner = (k) => x.map((n, j) => n + along[j] * k * half + out[j] * sign * 0.00012);
            const quad = [to3(corner(-1), 0.0015), to3(corner(-1), GROUND_Y + rise), to3(corner(1), GROUND_Y + rise), to3(corner(1), 0.0015)];
            face(s.city, sign > 0 ? quad : quad.toReversed(), '#1b1e23');
            face(s.city, sign > 0 ? quad.toReversed() : quad, '#1b1e23');
          }
          count++;
        }
      }
    }
  }
  return count;
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
        y = Math.max(y, dy + u * p[a + 1] + v * p[b + 1] + (1 - u - v) * p[c + 1]);
    }
  }
  if (!Number.isFinite(y)) throw new Error('No deck under pin at ' + [x, z]);
  return [x, y + 0.018, z];
}
// Spread eight spare pin sites over flat roofs for venues added without surveyed coordinates.
function fallbackSites(buildings) {
  const candidates = buildings
    .filter((b) => b.visibleRoof.length && !b.pitched)
    .map((b) => {
      const tri = b.visibleRoof.reduce((a, c) => (turn(...a) > turn(...c) ? a : c));
      return [0, 1].map((i) => tri.reduce((n, p) => n + p[i], 0) / 3);
    });
  const picks = [candidates.shift()];
  while (picks.length < 8 && candidates.length) {
    const score = (p) => Math.min(...picks.map((q) => Math.hypot(...sub(q, p))));
    const next = candidates.reduce((a, b) => (score(a) > score(b) ? a : b));
    picks.push(next);
    candidates.splice(candidates.indexOf(next), 1);
  }
  return picks;
}
const COMPASS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

export function segments(dir, only) {
  const { areas } = JSON.parse(readFileSync(new URL('./osm-data.json', import.meta.url)));
  const stops = JSON.parse(readFileSync(new URL('./stops.json', import.meta.url)));
  const anchors = {};
  for (const [index, [id, stationName, , , , lineColor]] of focal.entries()) {
    if (only && !only.includes(id)) continue;
    const area = areas[id],
      { centerLat, centerLon, spanMeters } = area,
      scale = deckSize / spanMeters;
    const random = rng(700 + index),
      m = new Model(),
      s = palette(m);
    const toDeck = (lat, lon) => [
      (lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180) * scale,
      -(lat - centerLat) * 110540 * scale,
    ];
    const stationAt = toDeck(...stops[stationName]);
    const rings = area.buildings.map((b) => b.ring.map((p) => p.map((n) => n * scale)));
    // OSM maps a shop as a point at its door, which can sit on the pavement just outside the
    // footprint. Such a pin is moved a couple of metres inside the building it belongs to, so it
    // stands on that roof. Open-air venues stay exactly where they are surveyed.
    const indoors = (v, p) => {
      if (v.category === 'outdoor' || v.category === 'stadium' || rings.some((ring) => contains(ring, p))) return p;
      let best;
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length],
            dx = b[0] - a[0],
            dz = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
          const q = [a[0] + t * dx, a[1] + t * dz],
            d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (!best || d < best.d) best = { d, q, ring };
        }
      if (!best || best.d > 15 * scale || best.d < 1e-9) return p;
      for (const inset of [2.5, 1.2, 0.5]) {
        const moved = best.q.map((n, k) => n + ((n - p[k]) / best.d) * inset * scale);
        if (contains(best.ring, moved)) return moved;
      }
      return p;
    };
    const all = places.filter((p) => p.stop_id === id).map((v) => ({ id: v.id, p: indoors(v, toDeck(v.lat, v.lon)) }));
    // Grow the shoreline around any building it would cut, so footprints are never sliced.
    // The shoreline also reaches out to every venue inside the surveyed crop.
    const reach = all
      .map((v) => v.p)
      .concat([stationAt])
      .filter((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])) <= VENUE_LIMIT)
      .flatMap((p) => circle(p[0], 0, p[1], VENUE_INSET + 0.012, 8).map(([x, , z]) => [x, z]));
    const base = convexHull([...shoreline(rng(4200 + index)), ...reach]);
    const crossing = (ring) => {
      const inside = ring.filter((p) => depthInside(p) >= 0).length;
      return inside > 0 && inside < ring.length;
    };
    const whole = new Set();
    setOutline(base);
    for (let pass = 0; pass < 16; pass++) {
      let grew = false;
      for (const [i, ring] of rings.entries()) {
        if (whole.has(i) || !crossing(ring)) continue;
        const c = [0, 1].map((k) => ring.reduce((n, p) => n + p[k], 0) / ring.length);
        // Only buildings centred on the island that fit inside the surveyed crop are taken in.
        if (depthInside(c) < 0 || ring.some((p) => Math.max(Math.abs(p[0]), Math.abs(p[1])) > PLOT_LIMIT)) continue;
        whole.add(i);
        grew = true;
      }
      if (!grew) break;
      const padded = [...whole].flatMap((i) => {
        const ring = rings[i],
          c = [0, 1].map((k) => ring.reduce((n, p) => n + p[k], 0) / ring.length);
        return ring.map((p) => {
          const d = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1;
          return p.map((n, k) => n + ((n - c[k]) / d) * PLOT_PAD);
        });
      });
      setOutline(convexHull([...base, ...padded]));
    }
    // No footprint is ever sliced by the shoreline. A building the shoreline could not grow
    // around (centred beyond the edge, or reaching past the surveyed crop) is left out whole,
    // together with any outline or building part that belongs to it.
    const centreOf = (ring) => [0, 1].map((k) => ring.reduce((n, p) => n + p[k], 0) / ring.length);
    const crosses = (a, b, c, d) => turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0;
    const cut = (ring) => {
      const inside = ring.filter((p) => depthInside(p) >= 0).length;
      if (inside === ring.length) return false;
      return (
        inside > 0 ||
        outline.some((p) => contains(ring, p)) ||
        ring.some((a, i) =>
          outlineEdges.some((e) => crosses(a, ring[(i + 1) % ring.length], e.a, e.b)),
        )
      );
    };
    const dropped = new Set(rings.keys().filter((i) => cut(rings[i])));
    const onIsland = [...rings.keys()].filter((i) => !dropped.has(i) && rings[i].every((p) => depthInside(p) >= 0));
    for (let grew = true; grew; ) {
      grew = false;
      for (const i of onIsland) {
        if (dropped.has(i)) continue;
        const c = centreOf(rings[i]);
        if ([...dropped].some((k) => contains(rings[k], c) || contains(rings[i], centreOf(rings[k])))) {
          dropped.add(i);
          grew = true;
        }
      }
    }
    const trimmed = dropped.size;
    const kept = area.buildings.filter((_, i) => !dropped.has(i));
    const droppedNames = [...new Set([...dropped].map((i) => area.buildings[i].name).filter(Boolean))];
    island(s, 9100 + index, outline, outlineRadius);
    s.facades = {};
    for (const [kind, { label }] of Object.entries(FACADES)) {
      const material = m.material(label, { rough: kind === 'curtain' ? 0.38 : 0.86, metal: kind === 'curtain' ? 0.25 : 0 });
      s.facades[kind] = m.surface(material);
      m.textures.push({ bytes: facadeTexture(kind), material, name: label });
    }
    // The ground plate follows the shoreline; the island's turf meets it edge to edge.
    for (let i = 0; i < outline.length; i++)
      face(
        s.city,
        outlineEdges[i].sign > 0
          ? [[0, 0, 0], to3(outline[(i + 1) % outline.length], 0), to3(outline[i], 0)]
          : [[0, 0, 0], to3(outline[i], 0), to3(outline[(i + 1) % outline.length], 0)],
        GROUND_COLOR,
      );

    const venues = all.filter((v) => depthInside(v.p) >= VENUE_INSET);
    if (depthInside(stationAt) < VENUE_INSET) throw new Error(id + ' station falls outside the shoreline');
    const venuePoints = venues.map((v) => v.p);

    // Ground cover: parks, water and surface car parks share one trimmed layer.
    const cover = [
      ...area.parks,
      ...area.waters.map((w) => ({ ...w, kind: 'water' })),
      ...(area.parking ?? []).map((w) => ({ ...w, kind: 'parking' })),
    ]
      .map((p) => polygon(p, scale, 0.00033))
      .filter(Boolean);
    for (const p of cover) {
      p.height = 0.0015;
      p.groundPriority = 1 / p.area;
    }
    for (const p of exposedShells(cover))
      roofFaces(
        s.city,
        p.visibleRoof,
        0.0015,
        p.kind === 'water'
          ? '#6da4ad'
          : p.kind === 'parking'
            ? '#aeb0b2'
            : p.kind === 'pitch'
              ? '#7cab80'
              : ['#8fae7f', '#9ab887', '#86a678'][p.id % 3],
      );
    // Pale sidewalks under every carriageway outline the city blocks.
    const ways = gradeWays(area);
    const atGrade = ways.filter((w) => !w.hidden);
    for (const w of atGrade) if (!w.rail) sidewalk(s, w, scale);
    const roads = atGrade.filter((w) => !w.rail).map((w) => street(s, w, scale));
    // Surface rail: a ballast bed with the line colour running down the centre.
    roadJoints(s, atGrade.filter((w) => !w.rail), scale);
    for (const rail of atGrade.filter((w) => w.rail)) {
      ribbon(s, rail.points, scale, 3, 0.00245 + rail.lift, '#9c9588');
      ribbon(s, rail.points, scale, 0.8, 0.0025 + rail.lift, rail.kind === 'rail' ? '#5f636b' : lineColor);
    }
    for (const platform of area.platforms ?? []) {
      const y = GROUND_Y + 0.5 * scale * VERTICAL;
      if (!platform.closed) {
        ribbon(s, platform.points, scale, 3, y, '#dcd8ce');
        continue;
      }
      const slab = polygon({ id: platform.id, ring: platform.points }, scale, 0.0003);
      if (!slab) continue;
      roofFaces(s.city, slab.roof, y, '#dcd8ce');
      for (const [a, end] of slab.walls) wall(s.city, a, end, 0.0015, y, '#b9b5ab', '#b9b5ab');
    }

    let buildings = kept
      .filter((b) => b.ring.some((p) => depthInside(p.map((n) => n * scale)) >= 0))
      .map((b) => polygon(b, scale, 0.00036))
      .filter((b) => b && b.area >= 12 * scale * scale);
    // Where OSM models a building as parts, the parts replace its overall outline.
    const parts = buildings.filter((b) => b.part);
    const centroid = (b) => [0, 1].map((k) => b.ring.reduce((n, p) => n + p[k], 0) / b.ring.length);
    buildings = buildings.filter((b) => {
      if (b.part) return true;
      const inside = parts.filter((p) => contains(b.ring, centroid(p)));
      return inside.reduce((n, p) => n + Math.abs(signedArea(p.ring)), 0) < 0.5 * Math.abs(signedArea(b.ring));
    });
    let surveyed = 0;
    const yOf = (meters) => GROUND_Y + compress(meters) * scale * VERTICAL;
    for (const b of buildings) {
      Object.assign(b, classify(b, scale));
      b.height = yOf(b.heightM);
      b.rise = b.riseM * scale * VERTICAL;
      b.baseY = b.minHeightM > 0 && b.minHeightM < b.heightM - 1 ? yOf(b.minHeightM) : GROUND_Y;
      if (b.surveyed) surveyed++;
    }
    const rendered = exposedShells(buildings);
    const sites = fallbackSites(rendered);
    const pins = sites.concat(venuePoints);
    for (const b of rendered) renderBuilding(s, b, pins, scale);
    const archCount = archways(s, ways, rendered, scale);
    // A wider crop covers more parks and streets, so it carries proportionally more trees.
    const treeLimit = spanMeters > 480 ? 300 : 130;
    const treeCount = plant(s, area, cover, buildings, roads, venuePoints.concat(sites), random, scale, treeLimit);

    const meshes = m.surfaces.map((surface) => ({
      ...surface,
      positions: Float32Array.from(surface.positions),
    }));
    const tris = meshes.reduce((n, s) => n + s.indices.length / 3, 0);
    if (tris >= 40000) throw new Error(id + ' exceeds geometry budget: ' + tris);
    // Venues beyond the crop are pinned to the turf rim on their bearing from the deck centre.
    const offDeck = {};
    for (const v of all.filter((v) => !venues.includes(v))) {
      const bearing = Math.atan2(v.p[1], v.p[0]);
      const reach = (outlineRadius(bearing) + RIM_OFFSET) / Math.hypot(...v.p);
      const east = (v.p[0] - stationAt[0]) / scale,
        south = (v.p[1] - stationAt[1]) / scale;
      offDeck[v.id] = {
        position: topAt(meshes, [v.p[0] * reach, v.p[1] * reach]),
        distanceM: Math.round(Math.hypot(east, south) / 10) * 10,
        compass: COMPASS[(Math.round(Math.atan2(south, east) / (Math.PI / 4)) + 8) % 8],
      };
    }
    // The station medallion stands on a post that clears every roof and tree under its disc.
    const groundAt = (p) => topAt(meshes, p)[1] - 0.018;
    // Among spots within about 40 m of the entrance it takes the one needing the shortest post,
    // so a tower beside the station never lifts the medallion out of sight.
    const discTop = (c) => {
      const under = [c];
      for (const r of [STATION_DISC * 0.5, STATION_DISC])
        for (let k = 0; k < 10; k++) under.push([c[0] + r * Math.cos((k * TAU) / 10), c[1] + r * Math.sin((k * TAU) / 10)]);
      return under.some((p) => depthInside(p) < 0) ? Infinity : Math.max(...under.map(groundAt));
    };
    let stand = { at: stationAt, top: discTop(stationAt), cost: discTop(stationAt) };
    for (const r of [0.011, 0.022, 0.033, 0.044])
      for (let k = 0; k < 16; k++) {
        const at = [stationAt[0] + r * Math.cos((k * TAU) / 16), stationAt[1] + r * Math.sin((k * TAU) / 16)];
        const top = discTop(at),
          cost = top + 0.35 * r;
        if (cost < stand.cost - 1e-9) stand = { at, top, cost };
      }
    const stationAnchor = {
      base: [stand.at[0], groundAt(stand.at), stand.at[1]],
      top: stand.top + 0.02,
    };
    anchors[id] = {
      deckY: 0,
      stationAnchor,
      projection: { centerLat, centerLon, spanMeters, deckSize },
      // The city's shoreline as [x, z] on the deck, for the flat maps that draw the same island.
      outline: outline.map((p) => p.map((v) => Number(v.toFixed(5)))),
      placeAnchors: Object.fromEntries(venues.map(({ id, p }) => [id, topAt(meshes, p)])),
      offDeck,
      pinAnchors: sites.map((p) => topAt(meshes, p)),
    };
    m.save(dir + 'segment-' + id + '.glb');
    console.log(
      id,
      `1:${Math.round(1 / scale)}`,
      rendered.length + ' buildings (' + surveyed + ' with surveyed heights)',
      treeCount + ' trees',
      venues.length + '/' + all.length + ' venues on deck',
      trimmed + ' edge buildings left out whole' + (droppedNames.length ? ' (' + droppedNames.join(', ') + ')' : ''),
      ways.filter((w) => w.lift).length + ' bridge spans, ' + archCount + ' archways',
      tris + ' triangles',
      meshes.filter((s) => s.indices.length).length + ' primitives',
    );
  }
  // A partial rebuild keeps the other stations' existing anchors.
  const file = dir + 'segment-anchors.json';
  json(file, only && existsSync(file) ? { ...JSON.parse(readFileSync(file)), ...anchors } : anchors);
}
