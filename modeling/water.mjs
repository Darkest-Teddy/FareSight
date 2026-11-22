// The Charles River, inlaid in the ground plate.
//
// The outline is not drawn by hand: charles-river.json is the MassGIS Hydrography (1:25,000) water
// polygons for the river, from Watertown down to the Charles River Dam, with its islands, already
// in sculpture coordinates. Every bank vertex is used as surveyed, so the river is where it is --
// the Red Line crosses it at the Longfellow, the Zakim spans it, MIT stands on its north bank.
//
// It is the river only. The harbour beyond the dam is in the same dataset and is left out: it is
// several times the river's area and its piers are exactly the kind of detail the map was thinned
// to lose.
//
// Water is part of the ground, not something standing on it. It is triangulated here and handed to
// ground.mjs, which lays it into the translucent plate under the contact shadows.
import { readFileSync } from 'node:fs';

/** Bank edges longer than this are split, so the fade at the plate's rim has vertices to follow. */
const LONGEST_EDGE = 0.02;

const signedArea = (ring) => {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
};

const turn = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Whether two segments cross anywhere but at a shared end. */
function crosses(a, b, c, d) {
  if (same(a, c) || same(a, d) || same(b, c) || same(b, d)) return false;
  const d1 = turn(a, b, c);
  const d2 = turn(a, b, d);
  const d3 = turn(c, d, a);
  const d4 = turn(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A ring from the file: flat [x, z, ...] in units x 1e5, closed. Returns open [x, z] corners. */
function corners(flat) {
  const ring = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i] / 1e5, flat[i + 1] / 1e5]);
  if (ring.length > 1 && same(ring[0], ring.at(-1))) ring.pop();
  return ring;
}

function split(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const pieces = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / LONGEST_EDGE));
    for (let k = 0; k < pieces; k++) out.push([a[0] + ((b[0] - a[0]) * k) / pieces, a[1] + ((b[1] - a[1]) * k) / pieces]);
  }
  return out;
}

/**
 * Join an island to the bank so the two become one outline: a cut out from the island to a bank
 * corner it can see, walked once each way. Islands furthest east are joined first, so a cut never
 * has to pass another island that is still loose.
 */
function withIslands(bank, islands) {
  let outline = [...bank];
  const loose = islands
    .map((island) => {
      let east = 0;
      for (let i = 1; i < island.length; i++) if (island[i][0] > island[east][0]) east = i;
      return { island, east };
    })
    .sort((a, b) => b.island[b.east][0] - a.island[a.east][0]);
  for (const { island, east } of loose) {
    const from = island[east];
    const edges = [];
    for (const ring of [outline, ...loose.map((l) => l.island)])
      for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
    const order = outline
      .map((p, i) => [Math.hypot(p[0] - from[0], p[1] - from[1]), i])
      .sort((a, b) => a[0] - b[0]);
    const seen = order.find(([, i]) => edges.every(([c, d]) => !crosses(from, outline[i], c, d)));
    if (!seen) throw new Error('An island of the Charles cannot be joined to its bank');
    const at = seen[1];
    outline = [
      ...outline.slice(0, at + 1),
      ...island.slice(east),
      ...island.slice(0, east + 1),
      ...outline.slice(at),
    ];
  }
  return outline;
}

/**
 * Ear clipping for an outline that runs counter-clockwise in (x, z) and may touch itself along the
 * cuts that join its islands. Returns triangles as index triples into the outline.
 */
function triangulate(outline) {
  const live = outline.map((_, i) => i);
  const triangles = [];
  let guard = outline.length * outline.length + 64;
  while (live.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < live.length; i++) {
      const ia = live[(i + live.length - 1) % live.length];
      const ib = live[i];
      const ic = live[(i + 1) % live.length];
      const [a, b, c] = [outline[ia], outline[ib], outline[ic]];
      const bend = turn(a, b, c);
      if (bend < 0) continue;
      // A corner on a straight run, or folded back along a cut, encloses nothing: drop it.
      if (bend < 1e-14) {
        live.splice(i, 1);
        clipped = true;
        break;
      }
      let clear = true;
      for (const j of live) {
        const q = outline[j];
        // The cuts put the same point in the outline twice; a twin of a corner is not in the way.
        if (same(q, a) || same(q, b) || same(q, c)) continue;
        if (turn(a, b, q) >= 0 && turn(b, c, q) >= 0 && turn(c, a, q) >= 0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      triangles.push([ia, ib, ic]);
      live.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (live.length === 3) triangles.push([live[0], live[1], live[2]]);
  return triangles;
}

/**
 * The river: `reaches`, each a bank and its islands as rings of [x, z], for asking whether a point
 * is in the water; and `mesh`, the same water as triangles over shared `points`.
 */
export function charlesRiver() {
  const { reaches } = JSON.parse(readFileSync(new URL('charles-river.json', import.meta.url)));
  const points = [];
  const triangles = [];
  const shapes = [];
  for (const reach of reaches) {
    const rings = reach.rings.map(corners);
    // One winding for the banks and the opposite for islands, whatever the file used.
    const bank = signedArea(rings[0]) < 0 ? [...rings[0]].reverse() : rings[0];
    const islands = rings.slice(1).map((ring) => (signedArea(ring) > 0 ? [...ring].reverse() : ring));
    shapes.push({ name: reach.name, rings: [bank, ...islands] });

    const outline = withIslands(split(bank), islands.map(split));
    const found = triangulate(outline);
    // The triangles must cover the water exactly: bank less islands, nothing twice, nothing missed.
    const water = signedArea(bank) + islands.reduce((sum, ring) => sum + signedArea(ring), 0);
    const covered = found.reduce((sum, [a, b, c]) => sum + turn(outline[a], outline[b], outline[c]) / 2, 0);
    if (Math.abs(covered - water) > water * 1e-6)
      throw new Error(`${reach.name}: triangulated ${covered.toFixed(7)} of ${water.toFixed(7)}`);
    const base = points.length;
    points.push(...outline);
    for (const [a, b, c] of found) triangles.push([base + a, base + b, base + c]);
  }
  return { reaches: shapes, mesh: { points, triangles } };
}

/** Whether a point is in the river: inside a bank and not on one of its islands. */
export function inWater(reaches, x, z) {
  for (const { rings } of reaches) {
    let within = false;
    for (const ring of rings)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i];
        const [xj, zj] = ring[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
      }
    if (within) return true;
  }
  return false;
}
