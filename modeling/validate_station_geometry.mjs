// Validate the indexed Float32 surfaces after batching. OSM vertex indices in the GLB identify
// the retained footprint before culling, including solids that emitted no faces.
import assert from 'node:assert/strict';
import { cross, dot, sub } from './geometry.mjs';

const EPS = 1e-6;
const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
const xz = ([x, , z]) => [x, z];
const edges = (ring) => ring.map((a, i) => [a, ring[(i + 1) % ring.length]]);
const box = (points) =>
  points[0].map((_, k) => [Math.min(...points.map((p) => p[k])), Math.max(...points.map((p) => p[k]))]);
const near = (a, b) => a.every(([lo, hi], i) => hi >= b[i][0] - EPS && lo <= b[i][1] + EPS);
const interpolate = (a, b, t) => a.map((v, k) => v + t * (b[k] - v));
function triangles(mesh, lo = 0, hi = mesh.indices.length / 3) {
  assert.ok(
    Number.isInteger(lo) && Number.isInteger(hi) && lo >= 0 && hi <= mesh.indices.length / 3 && hi >= lo,
  );
  const result = [];
  for (let i = lo; i < hi; i++) {
    const points = [0, 1, 2].map((k) => {
      const at = 3 * mesh.indices[3 * i + k];
      return mesh.offset.map((v, j) => v + mesh.positions[at + j]);
    });
    const sides = [sub(points[1], points[0]), sub(points[2], points[1]), sub(points[0], points[2])];
    const normal = cross(sides[0], sides[1]);
    assert.ok(normal.some((v) => v !== 0), 'Zero-area triangle ' + i + ' in ' + mesh.mat?.name);
    result.push({ points, sides, normal, bounds: box(points), index: i });
  }
  return result;
}

// Separating-axis tests include in-plane edge normals for coplanar triangles and T-junctions.
function separated(a, b, axis) {
  const tolerance = EPS * Math.hypot(...axis);
  const u = a.map((p) => dot(p, axis)),
    v = b.map((p) => dot(p, axis));
  return Math.min(...u) > Math.max(...v) + tolerance || Math.min(...v) > Math.max(...u) + tolerance;
}
function contact(a, b) {
  if (!near(a.bounds, b.bounds)) return false;
  const apart = (axis) => separated(a.points, b.points, axis);
  if (apart(a.normal) || apart(b.normal)) return false;
  for (const u of a.sides) {
    if (apart(cross(u, a.normal))) return false;
    for (const v of b.sides) if (apart(cross(u, v))) return false;
  }
  return !b.sides.some((v) => apart(cross(v, b.normal)));
}

function checkGrounded(id, faces, deckY) {
  const parent = Array.from({ length: faces.length + 1 }, (_, i) => i);
  const ground = faces.length;
  function root(i) {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  }
  faces.sort((a, b) => a.bounds[0][0] - b.bounds[0][0]);
  for (const [i, face] of faces.entries()) if (face.bounds[1][0] <= deckY + EPS) parent[i] = ground;
  for (const [i, a] of faces.entries()) {
    for (let j = i + 1; j < faces.length && faces[j].bounds[0][0] <= a.bounds[0][1] + EPS; j++) {
      const left = root(i),
        right = root(j);
      if (left !== right && contact(a, faces[j])) parent[left] = right;
    }
  }
  const floating = faces.filter((_, i) => root(i) !== root(ground));
  assert.ok(!floating.length, id + ' detached shell at OSM ' + floating[0]?.id);
}

// Intersect a polygon with a vertical line strictly between consecutive vertex abscissas.
function intervals(poly, x) {
  const hits = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if (a[0] > x !== b[0] > x) hits.push(a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]));
  }
  hits.sort((a, b) => a - b);
  return hits.filter((_, i) => !(i % 2)).map((v, i) => [v, hits[2 * i + 1]]);
}
function assertCovered(bands, lo, hi, label) {
  let cursor = lo;
  for (const [start, end] of bands.sort((a, b) => a[0] - b[0])) {
    if (start > cursor + EPS) break;
    cursor = Math.max(cursor, end);
  }
  assert.ok(cursor >= hi - EPS, label + ' uncovered from ' + cursor + ' to ' + hi);
}
function inside(p, ring) {
  return intervals(ring, p[0]).some(([lo, hi]) => lo < p[1] && p[1] < hi);
}
function edgeBreaks(a, d, length, neighbors) {
  const cuts = [0, length];
  for (const n of neighbors)
    for (const [p, q] of n.edges) {
      const delta = sub(q, p),
        from = sub(p, a),
        denominator = cross2(d, delta);
      if (Math.abs(denominator) > 1e-12) {
        const along = cross2(from, delta) / denominator,
          t = cross2(from, d) / denominator;
        if (t >= -1e-9 && t <= 1 + 1e-9 && along > 0 && along < length) cuts.push(along);
      }
      // Endpoints also split coincident and nearly parallel party walls.
      if (Math.abs(cross2(d, from)) < EPS) {
        const along = dot(from, d);
        if (along > 0 && along < length) cuts.push(along);
      }
    }
  return cuts;
}
function checkWalls(id, b, neighbors) {
  for (const [a, end] of b.edges) {
    const dir = sub(end, a),
      length = Math.hypot(...dir);
    if (length <= EPS) continue;
    const d = dir.map((v) => v / length);
    const cuts = edgeBreaks(a, d, length, neighbors),
      panels = [];
    for (const face of b.faces) {
      if (face.bounds[1][1] - face.bounds[1][0] < EPS) continue;
      const local = face.points.map((p) => sub(xz(p), a));
      if (!local.every((p) => Math.abs(cross2(d, p)) < EPS / 4)) continue;
      const panel = local.map((p, i) => [dot(d, p), face.points[i][1]]);
      panels.push(panel);
      for (const [t] of panel) if (t > 0 && t < length) cuts.push(t);
    }
    cuts.sort((u, v) => u - v);
    for (let i = 1; i < cuts.length; i++) {
      const width = cuts[i] - cuts[i - 1];
      if (width < EPS) continue;
      const t = cuts[i - 1] + width / 2,
        p = interpolate(a, end, t / length);
      const offset = [d[1] * 1e-12, -d[0] * 1e-12];
      const occupied = neighbors
        .filter(
          (n) =>
            inside([p[0] + offset[0], p[1] + offset[1]], n.ring) ||
            (n.rank < b.rank && inside(sub(p, offset), n.ring)),
        )
        .map((n) => [n.base, n.top]);
      // Actual triangle heights are linear within this strip. Check both ends so a missing
      // triangular half of a textured wall cannot pass just by touching the middle sample.
      for (const at of [cuts[i - 1] + width * 0.1, cuts[i] - width * 0.1]) {
        const actual = panels.flatMap((panel) => intervals(panel, at));
        assertCovered([...occupied, ...actual], b.base, b.top, id + ' OSM ' + b.id + ' wall ' + p);
      }
    }
  }
}

// Across a horizontal face, compare cross-sectional lengths of footprint minus covering solids
// with the exported triangles. Between boundary intersections these lengths are piecewise linear.
function checkHorizontal(id, b, neighbors, bottom) {
  const level = bottom ? b.base : b.top;
  const covers = neighbors.filter((n) =>
    bottom
      ? n.top >= level && (n.base < level || (n.base === level && n.rank < b.rank))
      : n.base <= level && (n.top > level || (n.top === level && n.rank < b.rank)),
  );
  const panels = b.faces
    .filter((f) =>
      bottom
        ? f.normal[1] < 0 && Math.abs(f.bounds[1][1] - level) < EPS && Math.abs(f.bounds[1][0] - level) < EPS
        : f.normal[1] > 0 &&
          (b.pitched || (Math.abs(f.bounds[1][1] - level) < EPS && Math.abs(f.bounds[1][0] - level) < EPS)),
    )
    .map((f) => f.points.map(xz));
  const rings = [b.ring, ...covers.map((n) => n.ring)];
  const cuts = [...rings, ...panels].flatMap((ring) => ring.map(([x]) => x));
  // Triangles already split at clipping intersections. Include independent source/source cuts
  // too, so a missing triangular patch still has its own integration interval.
  for (const [i, ring] of rings.entries())
    for (const other of rings.slice(0, i)) {
      for (const [a, c] of edges(ring))
        for (const [p, q] of edges(other)) {
          const u = sub(c, a),
            v = sub(q, p),
            d = cross2(u, v);
          if (Math.abs(d) < 1e-16) continue;
          const delta = sub(p, a),
            t = cross2(delta, v) / d,
            w = cross2(delta, u) / d;
          if (t > 0 && t < 1 && w > 0 && w < 1) cuts.push(a[0] + u[0] * t);
        }
    }
  cuts.sort((u, v) => u - v);
  let error = 0;
  for (let i = 1; i < cuts.length; i++) {
    const dx = cuts[i] - cuts[i - 1];
    if (dx < 1e-10) continue;
    const x = (cuts[i] + cuts[i - 1]) / 2;
    const events = [];
    function add(poly, kind) {
      for (const [lo, hi] of intervals(poly, x)) events.push([lo, kind, 1], [hi, kind, -1]);
    }
    add(b.ring, 0);
    for (const n of covers) add(n.ring, 1);
    for (const panel of panels) add(panel, 2);
    events.sort((a, c) => a[0] - c[0]);
    const active = [0, 0, 0];
    let last = 0;
    for (const [y, kind, change] of events) {
      const expected = active[0] && !active[1] ? 1 : 0;
      error += dx * (y - last) * Math.abs(active[2] - expected);
      active[kind] += change;
      last = y;
    }
  }
  // Quantizing the survey coordinates to Float32 can shift the boundary by tens of nanometres.
  const perimeter = b.edges.reduce((sum, [a, c]) => sum + Math.hypot(...sub(c, a)), 0);
  assert.ok(
    error <= 5e-8 * perimeter + 1e-10,
    id + ' OSM ' + b.id + (bottom ? ' soffit' : ' roof') + ' area discrepancy ' + error,
  );
}

function checkBridge(id, b, neighbors) {
  // Find the two cross-sections at opposite ends using the longest footprint dimension.
  let longest = 0,
    axis;
  for (const a of b.ring)
    for (const p of b.ring) {
      const d = sub(a, p),
        length = Math.hypot(...d);
      if (length > longest) {
        longest = length;
        axis = d.map((v) => v / length);
      }
    }
  const stations = b.ring.map((p) => dot(p, axis));
  const lo = Math.min(...stations),
    hi = Math.max(...stations);
  const hosts = [new Set(), new Set()];
  for (const face of b.faces)
    for (const p of face.points) {
      const u = (dot(xz(p), axis) - lo) / (hi - lo);
      if (u > 0.25 && u < 0.75) continue;
      const point = {
        points: [p, p, p],
        sides: [
          [0, 0, 0],
          [0, 0, 0],
          [0, 0, 0],
        ],
        normal: [0, 0, 0],
        bounds: box([p]),
      };
      for (const n of neighbors) {
        if (n.kind === 'bridge' || n.top <= b.base || n.base >= b.top) continue;
        if (n.faces.some((f) => contact(point, f))) hosts[u < 0.5 ? 0 : 1].add(n.id);
      }
    }
  assert.ok(
    [...hosts[0]].some((a) => [...hosts[1]].some((c) => c !== a)),
    id + ' missing abutment for ' + b.id,
  );
}

function checkRoads(id, roads, mesh) {
  const byHeight = new Map();
  for (const tri of roads) {
    const y = tri.points[0][1];
    assert.ok(
      tri.points.every((p) => p[1] === y),
      id + ' tilted road',
    );
    const i = 4 * mesh.indices[tri.index * 3];
    tri.color = mesh.colors[i] * 65536 + mesh.colors[i + 1] * 256 + mesh.colors[i + 2];
    tri.projected = tri.points.map(xz);
    if (!byHeight.has(y)) byHeight.set(y, []);
    byHeight.get(y).push(tri);
  }
  for (const layer of byHeight.values()) {
    layer.sort((a, b) => a.bounds[0][0] - b.bounds[0][0]);
    for (const [i, a] of layer.entries())
      for (let j = i + 1; j < layer.length; j++) {
        const b = layer[j];
        if (b.bounds[0][0] >= a.bounds[0][1]) break;
        if (a.color === b.color || !near(a.bounds, b.bounds)) continue;
        const apart = [...a.sides, ...b.sides].some(([x, , z]) => {
          const axis = [z, -x],
            t = 1e-9 * Math.hypot(...axis);
          const u = a.projected.map((p) => dot(p, axis)),
            v = b.projected.map((p) => dot(p, axis));
          return Math.min(...u) >= Math.max(...v) - t || Math.min(...v) >= Math.max(...u) - t;
        });
        assert.ok(apart, id + ' competing road faces ' + [a.index, b.index]);
      }
  }
}

export function validateStationGeometry(id, model, area, deckY) {
  const audit = model.geometry;
  assert.ok(audit?.solids.length && audit.trunks.length, id + ' missing station geometry provenance');
  const scale = 0.856 / area.spanMeters;
  const city = model.meshes.get('Masonry, foliage and streets');
  const deck = triangles(city, 0, audit.deckEnd);
  const turf = triangles(model.meshes.get('Island turf')).filter((f) =>
    f.points.every((p) => p[1] === deckY),
  );
  const rimEdges = new Set(
    turf.flatMap((f) => edges(f.points).map(([a, b]) => [a.join(','), b.join(',')].sort().join('|'))),
  );
  const boundary = deck.map(({ points }) => {
    assert.ok(points.every((p) => p[1] === deckY) && points[0].every((v) => v === 0));
    const [, a, b] = points;
    assert.ok(rimEdges.has([a.join(','), b.join(',')].sort().join('|')), id + ' turf seam');
    return [xz(a), xz(b)];
  });
  // The exported mesh is a convex fan. Check its closure and all half-planes; convexity then
  // guarantees containment of the entire triangle, including the interior of each edge.
  const ends = boundary.map(([, b]) => b.join(',')).sort();
  assert.deepEqual(boundary.map(([a]) => a.join(',')).sort(), ends);
  for (const [a, b] of boundary) {
    const d = sub(b, a),
      sign = Math.sign(
        cross2(
          d,
          a.map((v) => -v),
        ),
      ),
      tol = EPS * Math.hypot(...d);
    assert.ok(sign !== 0);
    for (const [name, mesh] of model.meshes) {
      if (name.startsWith('Island')) continue;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const u = mesh.positions[i] + mesh.offset[0] - a[0],
          v = mesh.positions[i + 2] + mesh.offset[2] - a[1];
        assert.ok(sign * (d[0] * v - d[1] * u) >= -tol, id + ' city crosses the deck');
      }
    }
  }
  for (const [lo, hi] of audit.trunks) {
    const trunk = triangles(city, lo, hi);
    const columns = new Map();
    for (const { points } of trunk)
      for (const point of points) {
        const key = xz(point).join(',');
        columns.set(key, Math.min(columns.get(key) ?? Infinity, point[1]));
      }
    assert.ok(
      columns.size >= 3 && [...columns.values()].every((y) => Math.abs(y - deckY) < EPS),
      id + ' trunk foot ' + lo,
    );
  }
  checkRoads(id, triangles(city, audit.roadStart, audit.roadEnd), city);
  const source = new Map(area.buildings.map((s) => [s.id, s]));
  const solids = audit.solids.map((s, rank) => {
    const row = source.get(s.id);
    assert.ok(s.base >= deckY && s.top > s.base, id + ' invalid solid interval ' + s.id);
    const ring = s.ring.map((i) => row.ring[i].map((v) => v * scale));
    const faces = s.ranges.flatMap(([batch, lo, hi]) =>
      triangles(model.meshes.get(audit.batches[batch]), lo, hi),
    );
    for (const face of faces) face.id = s.id;
    if (row.minHeightM > 0) assert.ok(s.base > deckY, id + ' missing clearance for OSM ' + s.id);
    else assert.equal(s.base, deckY, id + ' grade for OSM ' + s.id);
    return { ...s, rank, ring, faces, kind: row.kind, edges: edges(ring), bounds: box(ring) };
  });
  const landmarks = {
    'place-haecl': [240553609, 240553612, 29740970, 1420293158, 1420293163],
    'place-chncl': [241933506, 241937988],
    'place-aqucl': [240370265],
  };
  for (const osm of landmarks[id] ?? [])
    assert.ok(
      solids.some((b) => b.id === osm && b.faces.length),
      id + ' missing OSM ' + osm,
    );
  if (id === 'place-haecl') {
    const podium = solids.find((b) => b.id === 1420293163);
    const upper = solids.find((b) => b.id === 1420293158);
    assert.ok(podium.top >= upper.base - EPS, 'Boston City Hall podium ends below the upper storeys');
  }
  for (const b of solids) {
    const neighbors = solids.filter((n) => n !== b && near(n.bounds, b.bounds));
    checkWalls(id, b, neighbors);
    checkHorizontal(id, b, neighbors, false);
    if (b.base > deckY) checkHorizontal(id, b, neighbors, true);
    if (b.kind === 'bridge' && b.base > deckY) checkBridge(id, b, neighbors);
  }
  checkGrounded(
    id,
    solids.flatMap((b) => b.faces),
    deckY,
  );
  console.log(id, 'geometry gates passed for', solids.length, 'solids and', audit.trunks.length, 'trunks');
}
