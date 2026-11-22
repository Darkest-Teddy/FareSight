// The water of the map: the Charles River and Boston Harbor, inlaid in the ground plate.
//
// The outline is not drawn by hand. hydrography.json is the MassGIS Hydrography (1:25,000) water
// polygons for Boston -- the Charles from Watertown down through the basin to the dam, the harbour
// it empties into, the Mystic, Fort Point Channel, Dorchester Bay and the larger ponds -- already
// in sculpture coordinates. So the water is where it is: the Red Line crosses the basin at the
// Longfellow, the Zakim spans the river mouth, MIT stands on the north bank, the Blue Line runs
// under the harbour to East Boston, and downtown is the peninsula it really is.
//
// The survey is used at the scale of the map, which is not the scale of the survey. The polygons
// tile (the harbour alone is several, meeting along invisible seams) and carry detail far finer
// than a track plate is wide, so they are not triangulated one by one. They are drawn into one
// fine grid, cleaned there, and the shoreline is traced back out of it:
//
//   - every polygon is filled into the grid, so the seams between them are gone;
//   - land slivers standing in salt water -- the finger piers, which at this size are a comb of
//     hairlines along every waterfront -- are closed over, while the broad wharves stay;
//   - creeks and moats narrower than a train is long are left out: they would be scratches;
//   - the shoreline is traced with sub-cell accuracy and thinned to the corners that matter.
//
// A bank ends up within about three metres of where the survey puts it, on a map where a track is
// fifty-five metres wide.
//
// Water is part of the ground, not something standing on it. It is triangulated here and handed to
// ground.mjs, which lays it into the translucent plate under the contact shadows.
import { readFileSync } from 'node:fs';

/** The stretch of the sculpture the grid covers, comfortably past the plate's faded rim. */
const EXTENT = { x0: -1.14, x1: 1.14, z0: -0.96, z1: 0.96 };

/** Grid cell, in sculpture units: 5.2 m. */
const CELL = 0.0008;

/**
 * Land in salt water narrower than twice this is closed over: 32 m, so a finger pier goes and
 * Long Wharf, the Fish Pier and the Navy Yard's dry docks stay.
 */
const PIER = 0.005;

/** Fresh water narrower than twice this is dropped: a moat or a canal, 13 m. */
const CREEK = 0.001;

/**
 * A pond or a river has to be this wide on average (twice its area over its shoreline) and cover
 * this much to be drawn at all. The Muddy River and the Fens are real and are 20 m wide; at this
 * scale they are a pencil line wandering under the Green Line.
 */
const NARROWEST = 0.005;
const SMALLEST = 0.0003;

/** Shoreline corners closer to the line between their neighbours than this are dropped: 2.6 m. */
const DETAIL = 0.0004;

/** Water bodies and islands smaller than this are specks, and go. */
const SMALLEST_WATER = 0.00012;
const SMALLEST_ISLAND = 0.00003;

/** Shore edges longer than this are split, so the fade at the plate's rim has vertices to follow. */
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

function within(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------------------------
// The grid.
// ---------------------------------------------------------------------------------------------

const COLS = Math.round((EXTENT.x1 - EXTENT.x0) / CELL);
const ROWS = Math.round((EXTENT.z1 - EXTENT.z0) / CELL);

/** Fill one surveyed polygon (shore and islands, even-odd) into a mask, sampled at cell centres. */
function fill(mask, rings) {
  let low = Infinity;
  let high = -Infinity;
  for (const ring of rings)
    for (let i = 1; i < ring.length; i += 2) {
      low = Math.min(low, ring[i]);
      high = Math.max(high, ring[i]);
    }
  const first = Math.max(1, Math.floor((low / 1e5 - EXTENT.z0) / CELL - 0.5));
  const last = Math.min(ROWS - 2, Math.ceil((high / 1e5 - EXTENT.z0) / CELL - 0.5));
  for (let row = first; row <= last; row++) {
    const z = (EXTENT.z0 + (row + 0.5) * CELL) * 1e5;
    const cuts = [];
    for (const ring of rings)
      for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const [xi, zi, xj, zj] = [ring[i], ring[i + 1], ring[j], ring[j + 1]];
        if (zi > z !== zj > z) cuts.push(((xj - xi) * (z - zi)) / (zj - zi) + xi);
      }
    cuts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k += 2) {
      const from = Math.max(1, Math.ceil((cuts[k] / 1e5 - EXTENT.x0) / CELL - 0.5));
      const to = Math.min(COLS - 2, Math.floor((cuts[k + 1] / 1e5 - EXTENT.x0) / CELL - 0.5));
      for (let col = from; col <= to; col++) mask[row * COLS + col] = 1;
    }
  }
}

/**
 * Distance from every cell to the nearest cell where `mask` equals `value`, in sculpture units: a
 * two-pass 3-4 chamfer, good to a few percent, which is all a pier's width needs.
 */
function distanceTo(mask, value) {
  const far = 1e9;
  const d = new Float32Array(COLS * ROWS);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] === value ? 0 : far;
  const step = (i, j, cost) => {
    if (d[j] + cost < d[i]) d[i] = d[j] + cost;
  };
  for (let row = 1; row < ROWS - 1; row++)
    for (let col = 1; col < COLS - 1; col++) {
      const i = row * COLS + col;
      if (!d[i]) continue;
      step(i, i - 1, 3);
      step(i, i - COLS, 3);
      step(i, i - COLS - 1, 4);
      step(i, i - COLS + 1, 4);
    }
  for (let row = ROWS - 2; row > 0; row--)
    for (let col = COLS - 2; col > 0; col--) {
      const i = row * COLS + col;
      if (!d[i]) continue;
      step(i, i + 1, 3);
      step(i, i + COLS, 3);
      step(i, i + COLS + 1, 4);
      step(i, i + COLS - 1, 4);
    }
  const unit = CELL / 3;
  for (let i = 0; i < d.length; i++) d[i] *= unit;
  return d;
}

/** Grow the set cells of a mask by `reach`, or (negative) wear them back by it. */
function grow(mask, reach) {
  const out = new Uint8Array(mask.length);
  if (reach >= 0) {
    const d = distanceTo(mask, 1);
    for (let i = 0; i < out.length; i++) out[i] = d[i] <= reach ? 1 : 0;
  } else {
    const d = distanceTo(mask, 0);
    for (let i = 0; i < out.length; i++) out[i] = d[i] > -reach ? 1 : 0;
  }
  // The outermost cells stay dry, so every shoreline closes inside the grid.
  for (let col = 0; col < COLS; col++) out[col] = out[(ROWS - 1) * COLS + col] = 0;
  for (let row = 0; row < ROWS; row++) out[row * COLS] = out[row * COLS + COLS - 1] = 0;
  return out;
}

/** The mask as a soft field, 1 in water and 0 on land, so the shoreline can be traced between cells. */
function soften(mask) {
  let field = Float32Array.from(mask);
  for (let pass = 0; pass < 2; pass++) {
    const across = new Float32Array(field.length);
    for (let row = 0; row < ROWS; row++)
      for (let col = 1; col < COLS - 1; col++) {
        const i = row * COLS + col;
        across[i] = (field[i - 1] + 2 * field[i] + field[i + 1]) / 4;
      }
    const down = new Float32Array(field.length);
    for (let row = 1; row < ROWS - 1; row++)
      for (let col = 0; col < COLS; col++) {
        const i = row * COLS + col;
        down[i] = (across[i - COLS] + 2 * across[i] + across[i + COLS]) / 4;
      }
    field = down;
  }
  return field;
}

/**
 * Trace the half-way contour of a field: marching squares over the cell centres, the crossing on
 * each grid edge placed by interpolation, the pieces then joined end to end into closed rings.
 */
function trace(field) {
  const LEVEL = 0.5;
  // A crossing is known by the grid edge it lies on: twice the index of the edge's first node,
  // plus one if the edge runs down instead of across.
  const where = new Map();
  const point = (key) => {
    if (where.has(key)) return where.get(key);
    const node = key >> 1;
    const next = key & 1 ? node + COLS : node + 1;
    const t = (LEVEL - field[node]) / (field[next] - field[node]);
    const col = node % COLS;
    const row = (node - col) / COLS;
    const p =
      key & 1
        ? [EXTENT.x0 + (col + 0.5) * CELL, EXTENT.z0 + (row + 0.5 + t) * CELL]
        : [EXTENT.x0 + (col + 0.5 + t) * CELL, EXTENT.z0 + (row + 0.5) * CELL];
    where.set(key, p);
    return p;
  };
  /** For each crossing, the crossings it is joined to (two, once every cell has been visited). */
  const joins = new Map();
  const join = (a, b) => {
    for (const [from, to] of [[a, b], [b, a]]) {
      if (!joins.has(from)) joins.set(from, []);
      joins.get(from).push(to);
    }
  };
  for (let row = 0; row < ROWS - 1; row++)
    for (let col = 0; col < COLS - 1; col++) {
      const node = row * COLS + col;
      const a = field[node] >= LEVEL;
      const b = field[node + 1] >= LEVEL;
      const c = field[node + COLS + 1] >= LEVEL;
      const d = field[node + COLS] >= LEVEL;
      if (a === b && b === c && c === d) continue;
      const top = node * 2;
      const right = (node + 1) * 2 + 1;
      const bottom = (node + COLS) * 2;
      const left = node * 2 + 1;
      const cut = [];
      if (a !== b) cut.push(top);
      if (b !== c) cut.push(right);
      if (c !== d) cut.push(bottom);
      if (d !== a) cut.push(left);
      if (cut.length === 2) join(cut[0], cut[1]);
      else {
        // A saddle: two opposite corners wet. Whether they are one body or two is decided by the
        // middle of the cell.
        const middle = (field[node] + field[node + 1] + field[node + COLS + 1] + field[node + COLS]) / 4 >= LEVEL;
        if (a === middle) {
          join(top, right);
          join(bottom, left);
        } else {
          join(top, left);
          join(right, bottom);
        }
      }
    }
  const rings = [];
  const done = new Set();
  for (const start of joins.keys()) {
    if (done.has(start)) continue;
    const ring = [];
    let before = -1;
    let at = start;
    while (!done.has(at)) {
      done.add(at);
      ring.push(point(at));
      const [one, other] = joins.get(at);
      const next = one === before ? other : one;
      before = at;
      at = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Whether a closed ring crosses itself. */
function tangled(ring) {
  const n = ring.length;
  // Sorted by x, so only edges that overlap in x are compared.
  const edges = ring.map((a, i) => {
    const b = ring[(i + 1) % n];
    return { i, a, b, low: Math.min(a[0], b[0]), high: Math.max(a[0], b[0]) };
  });
  edges.sort((p, q) => p.low - q.low);
  for (let p = 0; p < n; p++)
    for (let q = p + 1; q < n && edges[q].low <= edges[p].high; q++) {
      const gap = Math.abs(edges[p].i - edges[q].i);
      if (gap === 1 || gap === n - 1) continue;
      if (crosses(edges[p].a, edges[p].b, edges[q].a, edges[q].b)) return true;
    }
  return false;
}

/** Douglas-Peucker on a closed ring: only the corners further than `detail` from the line survive. */
function thinned(ring, detail) {
  const keep = (from, to, out) => {
    const a = ring[from];
    const b = ring[to % ring.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let far = 0;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const p = ring[i];
      const off = Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / length;
      if (off > far) {
        far = off;
        at = i;
      }
    }
    if (far <= detail) return;
    keep(from, at, out);
    out.push(ring[at]);
    keep(at, to, out);
  };
  // Anchored at the two ends of the ring's longest reach, so the cut points are real corners.
  let west = 0;
  let east = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i][0] < ring[west][0]) west = i;
    if (ring[i][0] > ring[east][0]) east = i;
  }
  const turned = [...ring.slice(west), ...ring.slice(0, west)];
  const half = (east - west + ring.length) % ring.length;
  ring = turned;
  const out = [ring[0]];
  keep(0, half, out);
  out.push(ring[half]);
  keep(half, ring.length, out);
  return out;
}

/** A traced ring, thinned as far as it can be without tying itself in a knot. */
function shoreline(ring) {
  for (let detail = DETAIL; detail > DETAIL / 20; detail /= 2) {
    const out = thinned(ring, detail);
    if (out.length >= 3 && !tangled(out)) return out;
  }
  return ring;
}

// ---------------------------------------------------------------------------------------------
// Triangles.
// ---------------------------------------------------------------------------------------------

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
 * Join an island to the shore so the two become one outline: a cut out from the island to a shore
 * corner it can see, walked once each way. Islands furthest east are joined first, so a cut never
 * has to pass another island that is still loose.
 */
function withIslands(shore, islands) {
  let outline = [...shore];
  const loose = islands
    .map((island) => {
      let east = 0;
      for (let i = 1; i < island.length; i++) if (island[i][0] > island[east][0]) east = i;
      return { island, east };
    })
    .sort((a, b) => b.island[b.east][0] - a.island[a.east][0]);
  for (const [n, { island, east }] of loose.entries()) {
    const from = island[east];
    const edges = [];
    // Only the islands still loose can be in the way: the joined ones are part of the outline.
    for (const ring of [outline, ...loose.slice(n).map((l) => l.island)])
      for (let i = 0; i < ring.length; i++) edges.push([ring[i], ring[(i + 1) % ring.length]]);
    const order = outline
      .map((p, i) => [Math.hypot(p[0] - from[0], p[1] - from[1]), i])
      .sort((a, b) => a[0] - b[0]);
    const seen = order.find(([, i]) => edges.every(([c, d]) => !crosses(from, outline[i], c, d)));
    if (!seen) throw new Error('An island cannot be joined to its shore');
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

// ---------------------------------------------------------------------------------------------
// The water.
// ---------------------------------------------------------------------------------------------

let cached;

/**
 * All the water on the map: `bodies`, each a shore and its islands as rings of [x, z], for asking
 * whether a point is in the water and for drawing the shoreline; and `mesh`, the same water as
 * triangles over shared `points`. The shore of each body runs counter-clockwise in (x, z) and its
 * islands clockwise, so the water is always on the same hand of a ring.
 */
export function water() {
  if (cached) return cached;
  const { polygons } = JSON.parse(readFileSync(new URL('hydrography.json', import.meta.url)));
  const salt = new Uint8Array(COLS * ROWS);
  const fresh = new Uint8Array(COLS * ROWS);
  for (const { c, r } of polygons) {
    if (c !== 6) {
      fill(salt, r);
      continue;
    }
    const shore = [];
    for (let i = 0; i < r[0].length; i += 2) shore.push([r[0][i] / 1e5, r[0][i + 1] / 1e5]);
    const area = Math.abs(signedArea(shore));
    let around = 0;
    for (let i = 0; i < shore.length; i++) {
      const b = shore[(i + 1) % shore.length];
      around += Math.hypot(b[0] - shore[i][0], b[1] - shore[i][1]);
    }
    if (area < SMALLEST || (2 * area) / around < NARROWEST) continue;
    fill(fresh, r);
  }
  // Piers closed over in the harbour; moats and canals worn off the rivers and ponds.
  const harbour = grow(grow(salt, PIER), -PIER);
  const rivers = grow(grow(fresh, -CREEK), CREEK);
  let all = new Uint8Array(COLS * ROWS);
  for (let i = 0; i < all.length; i++) all[i] = harbour[i] | rivers[i];
  // One last pass at the grain of the grid, both ways, so nothing a cell and a half wide is left
  // for the tracing to trip over.
  all = grow(grow(all, -CELL * 1.5), CELL * 1.5);
  all = grow(grow(all, CELL * 1.5), -CELL * 1.5);

  const rings = trace(soften(all)).map(shoreline);
  // A ring is a shore if it lies inside an even number of the others, and an island if odd.
  const depth = rings.map((ring, i) => rings.reduce((n, other, j) => n + (i !== j && within(other, ring[0][0], ring[0][1]) ? 1 : 0), 0));
  const bodies = [];
  rings.forEach((ring, i) => {
    if (depth[i] % 2 || Math.abs(signedArea(ring)) < SMALLEST_WATER) return;
    const shore = signedArea(ring) < 0 ? [...ring].reverse() : ring;
    const islands = rings
      .filter((other, j) => depth[j] === depth[i] + 1 && within(ring, other[0][0], other[0][1]) && Math.abs(signedArea(other)) >= SMALLEST_ISLAND)
      .map((other) => (signedArea(other) > 0 ? [...other].reverse() : other));
    bodies.push({ rings: [shore, ...islands] });
  });
  // Largest first, so the listing reads harbour, basin, ponds.
  bodies.sort((a, b) => signedArea(b.rings[0]) - signedArea(a.rings[0]));

  const points = [];
  const triangles = [];
  for (const { rings: [shore, ...islands] } of bodies) {
    const outline = withIslands(split(shore), islands.map(split));
    const found = triangulate(outline);
    // The triangles must cover the water exactly: shore less islands, nothing twice, nothing missed.
    const wet = signedArea(shore) + islands.reduce((sum, ring) => sum + signedArea(ring), 0);
    const covered = found.reduce((sum, [a, b, c]) => sum + turn(outline[a], outline[b], outline[c]) / 2, 0);
    if (Math.abs(covered - wet) > wet * 1e-6)
      throw new Error(`Water at ${shore[0].map((v) => v.toFixed(3))}: triangulated ${covered.toFixed(7)} of ${wet.toFixed(7)}`);
    const base = points.length;
    points.push(...outline);
    for (const [a, b, c] of found) triangles.push([base + a, base + b, base + c]);
  }
  cached = { bodies, mesh: { points, triangles, shores: bodies.flatMap((body) => body.rings.map(split)) } };
  return cached;
}

/** Whether a point is in the water: inside a shore and not on one of its islands. */
export function inWater(bodies, x, z) {
  for (const { rings } of bodies) {
    let wet = false;
    for (const ring of rings) if (within(ring, x, z)) wet = !wet;
    if (wet) return true;
  }
  return false;
}

/**
 * The same water under the name the sculpture has always asked for it by: `reaches` are the
 * bodies. It was once the river alone.
 */
export function charlesRiver() {
  const { bodies, mesh } = water();
  return { reaches: bodies, mesh };
}
