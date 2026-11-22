// The landmarks of the map sculpture: the handful of Boston silhouettes people find their way by.
//
// Where each one stands is not a matter of taste. Every coordinate below was checked against two
// independent sources that agree to within about five metres:
//
//   - the city footprint data shipped with the Map Redesign export (City of Boston BPDA
//     "Boston_Buildings" and City of Cambridge BASEMAP_Buildings): the point has to fall inside a
//     footprint whose recorded height is the landmark's real height (748 ft for the Prudential,
//     788 ft for 200 Clarendon, and so on), and the centroid of that footprint is what is used;
//   - OpenStreetMap, the named way or node for the same structure.
//
// The outlines of the two towers, 660 Beacon Street and Fenway's field are the real ones from
// those datasets, simplified, so each also faces the way it really faces.
//
// One thing bends the truth and it is not the landmark: the network is drawn far larger than life.
// A track plate is 70 m wide at this scale and an explorable station drum 250 m across, so a
// landmark that really stands 25 m from a line (the Custom House on the Blue Line) or 97 m from a
// station (the Citgo sign at Kenmore) would be inside it. Those are slid straight out, the shortest
// way, until they stand clear -- same side of the line, same bearing from the station -- and
// `placeLandmarks` reports how far each one moved. Nothing else is nudged.
import { readFileSync } from 'node:fs';
import { cross, earClip, face, norm, sub } from './geometry.mjs';

const UNIT = 1 / 6500;

// ---------------------------------------------------------------------------------------------
// Colour. The city is one pale slate; a landmark is allowed its own material, muted, so it reads
// as the State House and not as another block. Nothing here is as saturated as a track, and the
// only strong notes are the gilded dome (the sunflower of the interface) and the Citgo sign's own
// livery, which comes with its model.
// ---------------------------------------------------------------------------------------------
const TONE = {
  // Towers: the city's slate, a step darker and bluer.
  towerShaft: '#8F9CB8',
  towerBand: '#6F7C98',
  towerCrown: '#A9B5CC',
  towerRoof: '#7A8499',
  glass: '#8CA6D2',
  glassRoof: '#738DB8',
  mast: '#C3CAD8',
  podium: '#A3AEC3',
  // Masonry.
  brick: '#B8826D',
  brickDark: '#A06F5D',
  marble: '#E6E1D6',
  limestone: '#D9D0BC',
  granite: '#C4C2BB',
  graniteLight: '#D6D4CD',
  white: '#F1EEE7',
  roof: '#727986',
  roofLight: '#8F96A3',
  leadDome: '#A9B0B8',
  gold: '#F0B92E',
  // Fenway.
  grass: '#8FBD7B',
  infield: '#CDA985',
  monster: '#3F7D5C',
  seats: '#A7B1C2',
  // Zakim.
  bridgeDeck: '#BFC6D1',
  bridgeTower: '#F2F3F5',
  cable: '#E3E7EC',
};

// ---------------------------------------------------------------------------------------------
// Plan geometry helpers. A ring is a list of [x, z] sculpture coordinates.
// ---------------------------------------------------------------------------------------------

const shoelace = (ring) => {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
};

/** One winding for every ring, so walls always face out and caps always face up. */
const wound = (ring) => (shoelace(ring) < 0 ? [...ring].reverse() : ring);

const centroid = (ring) => [
  ring.reduce((n, p) => n + p[0], 0) / ring.length,
  ring.reduce((n, p) => n + p[1], 0) / ring.length,
];

function inside(ring, x, z) {
  let within = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) within = !within;
  }
  return within;
}

/** Closest approach of two segments in plan: the distance and the point on each. */
function segmentGap(a, b, c, d) {
  const onto = (p, q, r) => {
    const vx = r[0] - q[0];
    const vz = r[1] - q[1];
    const t = Math.max(0, Math.min(1, ((p[0] - q[0]) * vx + (p[1] - q[1]) * vz) / (vx * vx + vz * vz || 1)));
    return [q[0] + vx * t, q[1] + vz * t];
  };
  let best = { gap: Infinity };
  for (const [p, q, r, flip] of [
    [a, c, d, false],
    [b, c, d, false],
    [c, a, b, true],
    [d, a, b, true],
  ]) {
    const hit = onto(p, q, r);
    const gap = Math.hypot(p[0] - hit[0], p[1] - hit[1]);
    if (gap < best.gap) best = flip ? { gap, mine: hit, theirs: p } : { gap, mine: p, theirs: hit };
  }
  const turn = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  if (turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) best = { ...best, gap: 0 };
  return best;
}

/** Distance from a point to a ring, zero inside it. */
export function ringDistance(ring, x, z) {
  if (inside(ring, x, z)) return 0;
  let gap = Infinity;
  for (let i = 0; i < ring.length; i++)
    gap = Math.min(gap, segmentGap([x, z], [x, z], ring[i], ring[(i + 1) % ring.length]).gap);
  return gap;
}

// ---------------------------------------------------------------------------------------------
// The builder's kit. A landmark is described in its own metres -- `r` to the right and `f` forward
// along its bearing, `h` up -- and the kit turns that into sculpture geometry at the landmark's
// plan and height scales.
// ---------------------------------------------------------------------------------------------

function kit(surface, origin, bearing, plan, lift, base) {
  const turn = (bearing * Math.PI) / 180;
  const sin = Math.sin(turn);
  const cos = Math.cos(turn);
  /** Local metres to plan. Forward runs along the bearing, clockwise from north; z runs south. */
  const at = (r, f) => {
    const east = f * sin + r * cos;
    const north = f * cos - r * sin;
    return [origin[0] + east * plan * UNIT, origin[1] - north * plan * UNIT];
  };
  const Y = (h) => base + h * lift * UNIT;
  const up = (p, y) => [p[0], y, p[1]];

  const wall = (ring, y0, y1, colour) => {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      face(surface, [up(ring[i], y0), up(ring[i], y1), up(ring[j], y1), up(ring[j], y0)], colour);
    }
  };
  /** A sloped skin between two rings of the same corner count. */
  const band = (low, y0, high, y1, colour) => {
    for (let i = 0; i < low.length; i++) {
      const j = (i + 1) % low.length;
      face(surface, [up(low[i], y0), up(high[i], y1), up(high[j], y1), up(low[j], y0)], colour);
    }
  };
  const cap = (ring, y, colour) => {
    for (const [a, b, c] of earClip(ring)) face(surface, [up(ring[c], y), up(ring[b], y), up(ring[a], y)], colour);
  };
  const peak = (ring, y0, apex, y1, colour) => {
    for (let i = 0; i < ring.length; i++) {
      const j = (i + 1) % ring.length;
      face(surface, [up(ring[i], y0), up(apex, y1), up(ring[j], y0)], colour);
    }
  };
  /** Any flat face, wound to look away from a point inside the solid it belongs to. */
  const facing = (pts, colour, within) => {
    const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    const mid = pts.reduce((m, p) => m.map((v, k) => v + p[k] / pts.length), [0, 0, 0]);
    const out = n[0] * (mid[0] - within[0]) + n[1] * (mid[1] - within[1]) + n[2] * (mid[2] - within[2]);
    face(surface, out < 0 ? [...pts].reverse() : pts, colour);
  };

  const ringOf = (poly) => wound(poly.map(([r, f]) => at(r, f)));
  const grown = (ring, k) => {
    const c = centroid(ring);
    return ring.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]);
  };
  const rectangle = (r, f, halfR, halfF, spin = 0) => {
    const s = Math.sin((spin * Math.PI) / 180);
    const c = Math.cos((spin * Math.PI) / 180);
    return [
      [-halfR, -halfF],
      [halfR, -halfF],
      [halfR, halfF],
      [-halfR, halfF],
    ].map(([u, v]) => [r + u * c + v * s, f - u * s + v * c]);
  };
  const round = (r, f, radius, sides) =>
    Array.from({ length: sides }, (_, i) => {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      return [r + Math.cos(a) * radius, f + Math.sin(a) * radius];
    });

  const api = {
    at,
    Y,
    ringOf,
    /** One point, [r, f, h] in the landmark's metres, as a sculpture position. */
    point: (r, f, h) => up(at(r, f), Y(h)),
    /** A flat face through sculpture positions, looking away from `within`. */
    poly: facing,
    /** An outline extruded between two heights, roofed in `top` (pass null to leave it open). */
    prism(poly, h0, h1, colour, top = colour) {
      const ring = ringOf(poly);
      wall(ring, Y(h0), Y(h1), colour);
      if (top) cap(ring, Y(h1), top);
      return ring;
    },
    /** An outline that narrows about its own centre as it rises: battered walls, a roof slope. */
    taper(poly, h0, h1, shrink, colour, top = colour) {
      const low = ringOf(poly);
      const high = grown(low, shrink);
      band(low, Y(h0), high, Y(h1), colour);
      if (top) cap(high, Y(h1), top);
    },
    box(r, f, halfR, halfF, h0, h1, colour, top = colour, spin = 0) {
      return api.prism(rectangle(r, f, halfR, halfF, spin), h0, h1, colour, top);
    },
    drum(r, f, radius, h0, h1, colour, top = colour, sides = 14) {
      return api.prism(round(r, f, radius, sides), h0, h1, colour, top);
    },
    spire(poly, h0, apex, h1, colour) {
      peak(ringOf(poly), Y(h0), at(...apex), Y(h1), colour);
    },
    cone(r, f, radius, h0, h1, colour, sides = 12) {
      api.spire(round(r, f, radius, sides), h0, [r, f], h1, colour);
    },
    pyramid(r, f, halfR, halfF, h0, h1, colour) {
      api.spire(rectangle(r, f, halfR, halfF), h0, [r, f], h1, colour);
    },
    dome(r, f, radius, h0, rise, colour, sides = 16, steps = 4) {
      let last = ringOf(round(r, f, radius, sides));
      let lastY = Y(h0);
      for (let k = 1; k < steps; k++) {
        const a = (k / steps) * (Math.PI / 2);
        const ring = ringOf(round(r, f, radius * Math.cos(a), sides));
        const y = Y(h0 + rise * Math.sin(a));
        band(last, lastY, ring, y, colour);
        last = ring;
        lastY = y;
      }
      peak(last, lastY, at(r, f), Y(h0 + rise), colour);
    },
    /** A pitched roof over a rectangle, ridge along `f` (or along `r`), with its gable ends. */
    gable(r, f, halfR, halfF, h0, h1, colour, ends = colour, along = 'f') {
      const corner = (u, v, h) => api.point(r + u, f + v, h);
      const core = corner(0, 0, h0);
      const [a, b, c, d] = [corner(-halfR, -halfF, h0), corner(halfR, -halfF, h0), corner(halfR, halfF, h0), corner(-halfR, halfF, h0)];
      if (along === 'f') {
        const [m, n] = [corner(0, -halfF, h1), corner(0, halfF, h1)];
        facing([b, c, n, m], colour, core);
        facing([d, a, m, n], colour, core);
        facing([a, b, m], ends, core);
        facing([c, d, n], ends, core);
      } else {
        const [m, n] = [corner(-halfR, 0, h1), corner(halfR, 0, h1)];
        facing([a, b, n, m], colour, core);
        facing([c, d, m, n], colour, core);
        facing([d, a, m], ends, core);
        facing([b, c, n], ends, core);
      }
    },
    /** A square bar between two points given as [r, f, h]: a cable, a bridge leg, a mast. */
    strut(from, to, thick, colour) {
      const p = api.point(...from);
      const q = api.point(...to);
      const axis = norm(sub(q, p));
      const side = norm(cross(axis, Math.abs(axis[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
      const lift2 = cross(axis, side);
      const half = (thick * plan * UNIT) / 2;
      const ringAt = (o) =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([u, v]) => o.map((n, k) => n + (side[k] * u + lift2[k] * v) * half));
      const [low, high] = [ringAt(p), ringAt(q)];
      const core = p.map((n, k) => (n + q[k]) / 2);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        facing([low[i], high[i], high[j], low[j]], colour, core);
      }
      facing(high, colour, core);
    },
  };
  return api;
}

// ---------------------------------------------------------------------------------------------
// The Citgo sign. Not modelled here: it is Flowcast's model of the real double-sided sign, in
// metres, carried over from the Map Redesign export (assets/citgo-sign.glb). Its ten flat-colour
// materials become vertex colours so it joins the landmark surface without costing a draw call.
// ---------------------------------------------------------------------------------------------

function readGlb(url) {
  const file = readFileSync(url);
  const jsonLength = file.readUInt32LE(12);
  const gltf = JSON.parse(file.subarray(20, 20 + jsonLength).toString());
  const bin = file.subarray(20 + jsonLength + 8);
  const read = (index) => {
    const accessor = gltf.accessors[index];
    const view = gltf.bufferViews[accessor.bufferView];
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type];
    const Type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[accessor.componentType];
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride ?? width * Type.BYTES_PER_ELEMENT;
    const out = new Array(accessor.count * width);
    for (let i = 0; i < accessor.count; i++)
      for (let k = 0; k < width; k++) {
        const at = start + i * stride + k * Type.BYTES_PER_ELEMENT;
        out[i * width + k] =
          Type === Float32Array ? bin.readFloatLE(at)
          : Type === Uint32Array ? bin.readUInt32LE(at)
          : Type === Uint16Array ? bin.readUInt16LE(at)
          : bin.readUInt8(at);
      }
    return out;
  };
  const srgb = (linear) => (linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055);
  return gltf.meshes.flatMap((mesh) =>
    mesh.primitives.map((part) => ({
      positions: read(part.attributes.POSITION),
      normals: read(part.attributes.NORMAL),
      indices: read(part.indices),
      colour:
        '#' +
        gltf.materials[part.material].pbrMetallicRoughness.baseColorFactor
          .slice(0, 3)
          .map((c) => Math.round(srgb(c) * 255).toString(16).padStart(2, '0'))
          .join(''),
    })),
  );
}

/**
 * Stand the sign with its foot at `origin`, `y` up, one face looking along `bearing` (the other
 * looks the opposite way: it is the same sign from behind).
 */
function citgoSign(surface, origin, y, bearing, scale) {
  const turn = (bearing * Math.PI) / 180;
  // The model's face looks down its own +z. North is -z on the sculpture.
  const spin = Math.atan2(Math.sin(turn), -Math.cos(turn));
  const sin = Math.sin(spin);
  const cos = Math.cos(spin);
  const k = scale * UNIT;
  for (const part of readGlb(new URL('assets/citgo-sign.glb', import.meta.url))) {
    const { positions: p, normals: n, indices } = part;
    const place = (i) => [
      origin[0] + (p[i * 3] * cos + p[i * 3 + 2] * sin) * k,
      y + p[i * 3 + 1] * k,
      origin[1] + (-p[i * 3] * sin + p[i * 3 + 2] * cos) * k,
    ];
    const lean = (i) => norm([n[i * 3] * cos + n[i * 3 + 2] * sin, n[i * 3 + 1], -n[i * 3] * sin + n[i * 3 + 2] * cos]);
    for (let t = 0; t < indices.length; t += 3) {
      const corners = [indices[t], indices[t + 1], indices[t + 2]];
      const pts = corners.map(place);
      const normals = corners.map(lean);
      // Keep the model's own shading normals, and wind each triangle to agree with them.
      const flat = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
      const agree = normals.reduce((sum, v) => sum + v[0] * flat[0] + v[1] * flat[1] + v[2] * flat[2], 0);
      const order = agree < 0 ? [0, 2, 1] : [0, 1, 2];
      const ids = order.map((c) => surface.vertex(pts[c], normals[c], part.colour));
      surface.indices.push(...ids);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The landmarks.
//
// `at` is [latitude, longitude]. `bearing` is the way the landmark's own forward axis points,
// degrees clockwise from north; outlines given as [east, north] metres use bearing 0. `plan` and
// `lift` are how much larger than life it is drawn across and up: the network is a diagram, and a
// true-scale tower would be thinner than a track. Bridges and the ballpark keep (nearly) their real
// size in plan, because their length is what puts them in the right place.
//
// `foot` is what has to stand clear of the network, and what the city keeps away from.
// ---------------------------------------------------------------------------------------------

const square = (half) => [
  [-half, -half],
  [half, -half],
  [half, half],
  [-half, half],
];
const oblong = (halfR, halfF, r = 0, f = 0) => [
  [r - halfR, f - halfF],
  [r + halfR, f - halfF],
  [r + halfR, f + halfF],
  [r - halfR, f + halfF],
];

// Real outlines, [east, north] metres about the footprint's centroid (BPDA Boston_Buildings).
const PRUDENTIAL_OUTLINE = [[-11.1, -30.7], [-28.2, 16.4], [11.1, 30.7], [28.2, -16.4]];
const CLARENDON_OUTLINE = [
  [48.8, -24.1], [38, -28], [33.7, -24.1], [32.3, -30.1], [15.2, -36.4],
  [-48.8, 24.1], [-38, 28.1], [-33.5, 23.9], [-32, 30.3], [-15.2, 36.4],
];
const BEACON_660_OUTLINE = [[-18.9, 13], [7.7, 19.4], [18.9, -11.8], [-7.2, -20.3]];
// Fenway's playing field (OpenStreetMap way 813683133) about its own centre. The left-field line
// runs north from home plate in the south-west corner; the wall along the north edge is the
// Green Monster. The second ring is the back of the stands, corner for corner.
const FENWAY_FIELD = [
  [-38, -18], [-35, 21], [-24, 34], [-24, 68], [34, 68], [60, 53],
  [81, 1], [77, -6], [61, -12], [39, -13], [6, -25], [-28, -29],
];
const FENWAY_STANDS = [
  [-88, -30], [-84, 30], [-66, 52], [-36, 76], [38, 76], [88, 72],
  [128, 10], [122, -22], [92, -48], [50, -62], [4, -78], [-62, -70],
];
const FENWAY_STAND_HEIGHT = [17, 17, 15, 12, 12, 10, 11, 13, 16, 18, 18, 18];

/**
 * The way the Citgo sign looks, as a bearing. This is the one thing here that is not as built. The
 * real sign faces 245 and 65 degrees (OSM `direction=245;65`), up and down Beacon Street, which
 * turns it nearly edge-on to the map's opening view from the south and leaves the most
 * recognisable thing on the map as a sliver. It is turned to look out over the building's own
 * Beacon Street front instead -- square to the roof it stands on, and the face Fenway Park sees.
 * (An earlier pass split the difference at 200 degrees, which left the sign standing crooked on
 * its roof, 34 degrees off the walls below it.) Set this to 245 for the real orientation.
 */
const CITGO_FACES = 166.5;

/**
 * How much larger than life the sign is drawn. Its building is drawn at 2.4; the sign is the
 * landmark, not the building, so it gets nearly three times that and reads from the opening view:
 * 60 ft of sign comes out a little wider than the roof under it, as it looks from Kenmore Square.
 */
const CITGO_SIGN_SCALE = 6.6;

export const LANDMARKS = [
  {
    id: 'citgo',
    name: 'Citgo Sign',
    // On the roof of 660 Beacon Street, Kenmore Square. OSM node 7599402961; the point lies in the
    // 82 ft BPDA footprint at 42.34931, -71.09623.
    at: [42.3492818, -71.0962619],
    bearing: 0,
    // Small in plan: the sign really stands 97 m from Kenmore station, which is inside the
    // station's drum at this scale, so the less ground the building takes the nearer it can stay.
    // Across and up alike, so 660 Beacon Street keeps its real, rather squat, proportions and the
    // sign is not left standing on a pillar.
    plan: 2.4,
    lift: 2.4,
    foot: [BEACON_660_OUTLINE],
    build(k, glass, surface) {
      k.prism(BEACON_660_OUTLINE, 0, 2.2, TONE.brickDark, null);
      k.prism(BEACON_660_OUTLINE, 2.2, 23.6, TONE.brick, null);
      k.prism(BEACON_660_OUTLINE.map(([e, n]) => [e * 1.04, n * 1.04]), 23.6, 25, TONE.marble, TONE.roof);
      citgoSign(surface, k.at(0, 0), k.Y(25), CITGO_FACES, CITGO_SIGN_SCALE);
    },
  },
  {
    id: 'fenway',
    name: 'Fenway Park',
    // Centre of the playing field, OSM way 813683133 (stadium relation 11188464).
    at: [42.346411, -71.097433],
    bearing: 0,
    plan: 1.4,
    lift: 2.6,
    foot: [FENWAY_STANDS],
    build(k) {
      k.prism(FENWAY_FIELD, 0, 0.9, TONE.monster, TONE.grass);
      // The infield: a dirt square with home plate in its south-west corner, grass inside it.
      k.prism(oblong(13.5, 13.5, -14, -5), 0.9, 1.15, TONE.infield);
      k.prism(oblong(7.5, 7.5, -14, -5), 1.15, 1.35, TONE.grass);
      // The stands, one wedge per stretch of the field's edge: seats rising from the rail to the
      // back wall, which is brick on the street side.
      const n = FENWAY_FIELD.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // No seats on the Monster itself; the wall is built below.
        if (i === 3) continue;
        const [h0, h1] = [FENWAY_STAND_HEIGHT[i], FENWAY_STAND_HEIGHT[j]];
        const [a, b, c, d] = [FENWAY_FIELD[i], FENWAY_FIELD[j], FENWAY_STANDS[j], FENWAY_STANDS[i]];
        const P = (p, h) => k.point(p[0], p[1], h);
        const core = P([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], 1);
        k.poly([P(a, 3), P(b, 3), P(c, h1), P(d, h0)], TONE.seats, core);
        k.poly([P(d, 0), P(c, 0), P(c, h1), P(d, h0)], TONE.brick, core);
        k.poly([P(a, 0.9), P(b, 0.9), P(b, 3), P(a, 3)], TONE.monster, core);
        k.poly([P(a, 0), P(d, 0), P(d, h0), P(a, 3)], TONE.brickDark, core);
        k.poly([P(b, 0), P(c, 0), P(c, h1), P(b, 3)], TONE.brickDark, core);
      }
      // The Green Monster: 37 ft of wall along Lansdowne Street, with its seats on top.
      k.box(5, 71.5, 30.5, 3.5, 0, 11.3, TONE.monster, TONE.seats);
      for (const [e, north] of [[-70, 44], [-74, -44], [-14, -74], [70, -54], [118, -4], [62, 70]])
        k.strut([e, north, 0], [e, north, 40], 2.6, TONE.mast);
    },
  },
  {
    id: 'prudential',
    name: 'Prudential Tower',
    // 800 Boylston Street. Centroid of the 748 ft BPDA footprint; OSM way 29869880 agrees.
    at: [42.347166, -71.08252],
    bearing: 0,
    plan: 3.2,
    lift: 2.6,
    foot: [PRUDENTIAL_OUTLINE],
    build(k) {
      const inset = (s) => PRUDENTIAL_OUTLINE.map(([e, n]) => [e * s, n * s]);
      // The Prudential Center it rises from, then the shaft, the dark band below the crown, the
      // crown with its recessed plant floor, and the mast that makes it the tallest thing here.
      k.prism(inset(1.42), 0, 9, TONE.podium);
      k.prism(PRUDENTIAL_OUTLINE, 9, 198, TONE.towerShaft, null);
      k.prism(inset(0.93), 198, 205, TONE.towerBand, null);
      k.prism(inset(1.03), 205, 222, TONE.towerCrown, TONE.towerRoof);
      k.prism(inset(0.6), 222, 229, TONE.towerBand, TONE.towerRoof);
      k.strut([0, 0, 229], [0, 0, 276], 4.2, TONE.mast);
    },
  },
  {
    id: 'clarendon',
    name: '200 Clarendon (John Hancock Tower)',
    // Centroid of the 788 ft BPDA footprint; OSM way 405843558 agrees. The outline is the real
    // rhomboid with its two notches, which is the whole of the building's character.
    at: [42.349278, -71.075124],
    bearing: 0,
    // Narrower in plan than the other towers: it really does stand between the Green Line under
    // Boylston Street and the Orange Line behind it, and has to fit between them here too.
    plan: 2.2,
    lift: 2.6,
    foot: [CLARENDON_OUTLINE],
    build(k, glass) {
      glass.prism(CLARENDON_OUTLINE, 0, 4, TONE.glassRoof, null);
      glass.prism(CLARENDON_OUTLINE, 4, 236, TONE.glass, null);
      glass.prism(CLARENDON_OUTLINE, 236, 240.8, TONE.glassRoof, TONE.glassRoof);
    },
  },
  {
    id: 'statehouse',
    name: 'Massachusetts State House',
    // The dome, on the Bulfinch front at 24 Beacon Street: the 178 ft BPDA lantern footprint inside
    // OSM way 29718019. The front looks down over the Common, bearing 169.
    at: [42.358171, -71.063684],
    bearing: 168.7,
    plan: 3.2,
    lift: 3.2,
    foot: [oblong(27, 11, 0, 0), oblong(16, 4, 0, 14)],
    build(k, glass) {
      // Bulfinch's brick front, the portico with its colonnade and pediment, and the gilded dome.
      // The later marble wings are left off: the Red Line passes 90 m from the dome, and at this
      // scale they would reach it.
      k.box(0, 0, 26, 10, 0, 18, TONE.brick, TONE.roof);
      k.box(0, 14, 15.5, 4, 0, 6.5, TONE.marble);
      for (let i = 0; i < 6; i++) k.box(-12.5 + i * 5, 16.2, 1, 1, 6.5, 14.5, TONE.white);
      k.box(0, 14, 15.5, 4, 14.5, 16.8, TONE.marble, TONE.white);
      k.gable(0, 14, 15.5, 4, 16.8, 20.6, TONE.roofLight, TONE.white, 'r');
      k.drum(0, -1, 9.6, 18, 23.5, TONE.white, TONE.white, 16);
      glass.dome(0, -1, 8.6, 23.5, 9.5, TONE.gold);
      k.drum(0, -1, 1.9, 32.6, 36, TONE.white, TONE.white, 8);
      glass.cone(0, -1, 1.9, 36, 39.5, TONE.gold, 8);
    },
  },
  {
    id: 'customhouse',
    name: 'Custom House Tower',
    // 3 McKinley Square. Centroid of the 422 ft BPDA tower footprint; OSM way 29719177 agrees.
    at: [42.359055, -71.053562],
    bearing: 77.6,
    plan: 2.2,
    lift: 2.6,
    foot: [oblong(13, 16)],
    build(k) {
      // The 1847 temple it was built on top of, then the shaft, the clock stage and the pyramid.
      k.box(0, 0, 13, 16, 0, 20, TONE.granite, TONE.roofLight);
      k.box(0, 0, 10.5, 11.5, 20, 34, TONE.graniteLight, TONE.granite);
      k.box(0, 0, 8.6, 8.6, 34, 112, TONE.graniteLight, TONE.granite);
      k.box(0, 0, 9.6, 9.6, 112, 116, TONE.granite, TONE.granite);
      k.box(0, 0, 7.6, 7.6, 116, 130, TONE.white, TONE.granite);
      k.pyramid(0, 0, 7.6, 7.6, 130, 151, TONE.roof);
    },
  },
  {
    id: 'oldnorth',
    name: 'Old North Church',
    // 193 Salem Street. Centroid of the nave's BPDA footprint; OSM way 29650592 agrees. The steeple
    // stands at the Salem Street end, so the nave runs away from it on bearing 121.
    at: [42.366334, -71.054443],
    bearing: 121,
    plan: 4.5,
    lift: 3.6,
    foot: [oblong(8.5, 17, 0, -2.5)],
    build(k) {
      k.box(0, 1, 8, 11.5, 0, 12, TONE.brick, null);
      k.gable(0, 1, 8, 11.5, 12, 17.5, TONE.roof, TONE.brick, 'f');
      k.box(0, -14, 4.4, 4.4, 0, 27, TONE.brick, TONE.white);
      k.box(0, -14, 3.5, 3.5, 27, 33, TONE.white);
      k.drum(0, -14, 2.9, 33, 38.5, TONE.white, TONE.white, 8);
      k.drum(0, -14, 2.1, 38.5, 43, TONE.white, TONE.white, 8);
      k.cone(0, -14, 2.1, 43, 53.3, TONE.white, 8);
    },
  },
  {
    id: 'bunkerhill',
    name: 'Bunker Hill Monument',
    // Monument Square, Charlestown. BPDA footprint centroid; OSM way 212292402 agrees (67 m).
    at: [42.37635, -71.06077],
    bearing: 0,
    plan: 5,
    lift: 3.2,
    foot: [square(7)],
    build(k) {
      k.prism(square(7), 0, 1.6, TONE.granite, TONE.granite);
      k.taper(square(4.6), 1.6, 62, 0.5, TONE.graniteLight, null);
      k.pyramid(0, 0, 2.3, 2.3, 62, 67, TONE.white);
    },
  },
  {
    id: 'zakim',
    name: 'Leonard P. Zakim Bunker Hill Memorial Bridge',
    // Midpoint of the deck, OSM way 508557869. The deck is drawn at its real 409 m, on its real
    // bearing, with the two towers 227 m apart as built, so it lands on its own two banks.
    at: [42.36876, -71.06314],
    bearing: 320,
    plan: 1,
    lift: 2.6,
    // Only the four tower legs touch the ground. The deck is free to pass over a line, as it
    // does: the Orange Line tunnel runs under the real bridge beside its north tower.
    foot: [-113, 113].flatMap((f) => [-31, 31].map((r) => oblong(4.5, 4.5, r, f))),
    keepOut: [oblong(40, 215)],
    build(k) {
      k.box(0, 0, 28, 204, 19, 23, TONE.bridgeDeck, TONE.roofLight);
      for (const tower of [-113, 113]) {
        for (const side of [-1, 1]) {
          k.strut([side * 31, tower, 0], [side * 31, tower, 22], 9, TONE.bridgeTower);
          k.strut([side * 31, tower, 22], [0, tower, 64], 8, TONE.bridgeTower);
        }
        k.strut([0, tower, 62], [0, tower, 98], 8, TONE.bridgeTower);
        // The fans: longer toward mid-span, shorter over the back span.
        const toward = tower < 0 ? 1 : -1;
        for (let n = 1; n <= 6; n++) k.strut([0, tower, 64 + n * 5], [0, tower + toward * n * 17, 23.2], 2.8, TONE.cable);
        for (let n = 1; n <= 4; n++) k.strut([0, tower, 64 + n * 5], [0, tower - toward * n * 19, 23.2], 2.8, TONE.cable);
      }
    },
  },
  {
    id: 'mitdome',
    name: 'MIT Great Dome',
    // Building 10, on Killian Court. Centroid of OSM way 479313188 ("Great Dome"), inside the
    // 147 ft BPDA footprint. The portico looks out over the court to the river, bearing 156.
    at: [42.359756, -71.092061],
    bearing: 155.9,
    plan: 3.4,
    lift: 3.4,
    foot: [oblong(52, 24, 0, 2)],
    build(k) {
      k.box(0, 0, 30, 22, 0, 22, TONE.limestone, TONE.roofLight);
      for (const side of [-1, 1]) k.box(side * 41, -4, 11, 16, 0, 19, TONE.limestone, TONE.roofLight);
      k.box(0, 23.5, 20, 3.5, 0, 3.5, TONE.limestone);
      for (let i = 0; i < 8; i++) k.box(-17.5 + i * 5, 24.5, 1.1, 1.1, 3.5, 17, TONE.white);
      k.box(0, 23.5, 20.5, 3.5, 17, 21, TONE.limestone, TONE.white);
      k.drum(0, -2, 15, 22, 27.5, TONE.limestone, TONE.limestone, 18);
      k.dome(0, -2, 14.2, 27.5, 11, TONE.leadDome, 18);
      k.drum(0, -2, 2.4, 38, 40.7, TONE.white, TONE.leadDome, 8);
    },
  },
  {
    id: 'memorialhall',
    name: 'Memorial Hall, Harvard',
    // 45 Quincy Street, Cambridge. Centroid of the 210 ft BPDA footprint; OSM way 29530473 agrees.
    // The long axis runs from Annenberg Hall to Sanders Theatre on bearing 100.
    at: [42.375969, -71.115082],
    bearing: 99.7,
    plan: 3,
    lift: 3,
    foot: [oblong(19, 47, 0, 1)],
    build(k) {
      // Annenberg Hall, the transept with the tower over it, and the round end of Sanders Theatre.
      k.box(0, -26, 10, 19, 0, 19, TONE.brick, null);
      k.gable(0, -26, 10, 19, 19, 30, TONE.roof, TONE.brick, 'f');
      k.box(0, -1, 18, 7, 0, 21, TONE.brick, null);
      k.gable(0, -1, 18, 7, 21, 31, TONE.roof, TONE.brick, 'r');
      k.box(0, -1, 7.5, 7.5, 0, 40, TONE.brickDark, TONE.roof);
      k.taper(square(7.5).map(([r, f]) => [r, f - 1]), 40, 55, 0.42, TONE.roof, TONE.roofLight);
      for (const [r, f] of [[-6.8, -7.8], [6.8, -7.8], [6.8, 5.8], [-6.8, 5.8]]) k.cone(r, f, 1.5, 40, 46.5, TONE.roofLight, 6);
      k.drum(0, 26, 17, 0, 18, TONE.brick, null, 12);
      k.cone(0, 26, 17, 18, 28, TONE.roof, 12);
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Placement.
// ---------------------------------------------------------------------------------------------

/** How far, in sculpture units, a landmark's foot has to stand from each part of the network. */
const CLEAR = { track: 0.0066, bead: 0.0092, drum: 0.0206 };

/**
 * Where every landmark stands: its true position projected onto the sculpture and, for the few
 * that the oversized network would otherwise run through, the nearest clear spot.
 *
 * `network` is what they have to clear: `tracks` (each a `name` and its [x, y, z] centreline
 * `points`), `beads` (ordinary stops) and `drums` (the explorable stops), both as [x, y, z].
 */
export function placeLandmarks(project, network) {
  const obstacles = [];
  for (const { name, points } of network.tracks)
    for (let i = 1; i < points.length; i++)
      obstacles.push({ a: [points[i - 1][0], points[i - 1][2]], b: [points[i][0], points[i][2]], need: CLEAR.track, what: name });
  for (const p of network.beads) obstacles.push({ a: [p[0], p[2]], b: [p[0], p[2]], need: CLEAR.bead, what: 'a stop' });
  for (const p of network.drums) obstacles.push({ a: [p[0], p[2]], b: [p[0], p[2]], need: CLEAR.drum, what: 'a station drum' });

  return LANDMARKS.map((landmark) => {
    const [x, , z] = project(landmark.at[0], landmark.at[1], 0);
    const rings = (origin, polys) => polys.map((poly) => kit(null, origin, landmark.bearing, landmark.plan, 1, 0).ringOf(poly));
    // Only what is near enough to matter.
    const nearby = obstacles.filter((o) => Math.hypot(o.a[0] - x, o.a[1] - z) < 0.16);
    /** Everything the foot would be too close to if the landmark stood at `origin`. */
    const blocked = (origin, all) => {
      const found = new Set();
      for (const ring of rings(origin, landmark.foot))
        for (const o of nearby) {
          let gap = inside(ring, o.a[0], o.a[1]) ? 0 : Infinity;
          for (let i = 0; i < ring.length && gap >= o.need; i++)
            gap = Math.min(gap, segmentGap(ring[i], ring[(i + 1) % ring.length], o.a, o.b).gap);
          if (gap < o.need) {
            found.add(o.what);
            if (!all) return found;
          }
        }
      return found;
    };
    // The nearest clear spot: its true position if that is clear, otherwise the first that is on
    // ever wider circles round it, two metres at a time. Searching outward like this finds the
    // smallest move there is, which leaves the landmark on the side of the line it is really on.
    const cleared = [...blocked([x, z], true)];
    let origin = [x, z];
    search: for (let ring = 1; cleared.length && ring <= 150; ring++) {
      const radius = ring * 2 * UNIT;
      const around = Math.max(12, Math.ceil(ring * Math.PI));
      for (let n = 0; n < around; n++) {
        const angle = (n / around) * Math.PI * 2;
        const spot = [x + Math.cos(angle) * radius, z + Math.sin(angle) * radius];
        if (blocked(spot, false).size) continue;
        origin = spot;
        break search;
      }
    }
    if (blocked(origin, false).size) throw new Error(landmark.name + ' has nowhere clear to stand within 300 m');
    return {
      landmark,
      origin,
      truth: [x, z],
      /** How far the network's size pushed it from its real position, in real metres. */
      moved: Math.hypot(origin[0] - x, origin[1] - z) / UNIT,
      /** What it was moved clear of. */
      cleared,
      foot: rings(origin, landmark.foot),
      keepOut: rings(origin, landmark.keepOut ?? landmark.foot),
    };
  });
}

/**
 * Build every placed landmark and lay its contact shadow on the ground. `stone` takes the masonry;
 * `glass` is the glossier surface, for curtain wall and gilding.
 *
 * Returns one anchor per landmark: what it is, where it really is, how far it was moved, the box
 * it occupies on the sculpture and the outline it stands on. The app reads these to keep station
 * labels off the landmarks, and validate_assets.mjs to check the placement.
 */
export function buildLandmarks(stone, glass, placements, base, ground) {
  return placements.map(({ landmark, origin, foot, moved }) => {
    const from = [stone.positions.length, glass.positions.length];
    const tools = (surface) => kit(surface, origin, landmark.bearing, landmark.plan, landmark.lift, base);
    landmark.build(tools(stone), tools(glass), stone);
    for (const ring of foot) ground.footprintShadow(ring);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const [surface, start] of [[stone, from[0]], [glass, from[1]]])
      for (let i = start; i < surface.positions.length; i++) {
        min[i % 3] = Math.min(min[i % 3], surface.positions[i]);
        max[i % 3] = Math.max(max[i % 3], surface.positions[i]);
      }
    const round = (v) => Math.round(v * 1e5) / 1e5;
    return {
      id: landmark.id,
      name: landmark.name,
      lat: landmark.at[0],
      lon: landmark.at[1],
      movedMetres: Math.round(moved),
      position: [round(origin[0]), base, round(origin[1])],
      min: min.map(round),
      max: max.map(round),
      /** What stands on the ground, as [x, z] outlines. */
      foot: foot.map((ring) => ring.map((p) => p.map(round))),
    };
  });
}
