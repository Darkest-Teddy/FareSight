// City blocks along the network, shaped by real Boston footprints.
//
// Earlier passes drew rotated boxes, which read as one building repeated. These use the actual
// OpenStreetMap outlines already in the repo (osm-data.json — 2354 footprints across the five
// station crops, about 1000 of them not rectangles). Each becomes a reusable template carrying its
// outline, storey count, roof shape and use, and is then placed where that kind of building
// actually belongs in Boston.
//
// Footprints are scaled to the sculpture, not to reality: at true scale a city block is a speck
// beside a 0.015-wide track plate. The shape and proportions are authentic; absolute size is not.
import { readFileSync } from 'node:fs';
import { face, norm, rng, sub } from './geometry.mjs';

const blockGap = 0.009;

/**
 * Nothing is built within this distance of either end of a line, measured along the track.
 *
 * The MBTA runs out of the city at both ends -- the B branch finishes at Boston College, the Red
 * Line at Alewife and Braintree -- and those outer stretches are low-rise residential and
 * parkland, not the dense blocks found downtown. Building right to the end of every line made the
 * map read as uniformly urban, which Boston is not.
 *
 * 0.18 units is about two and a half average stop gaps.
 */
const endClear = 0.18;

/** Density then ramps back in over this much more track, so the city fades in rather than starts. */
const endFade = 0.22;

/** Where Boston's character changes, in sculpture coordinates, with the buildings each favours. */
const districts = [
  {
    name: 'downtown',
    at: [0.413, -0.041],
    reach: 0.2,
    kinds: ['office', 'commercial', 'hotel', 'yes'],
    mix: [0.44, 0.33, 0.23],
    size: [0.020, 0.032],
    tone: [0.3, 0.2],
  },
  {
    name: 'back bay',
    at: [0.2, 0.01],
    reach: 0.22,
    kinds: ['apartments', 'commercial', 'hotel', 'yes'],
    mix: [0.58, 0.31, 0.11],
    size: [0.018, 0.028],
    tone: [0.27, 0.16],
  },
  {
    name: 'kenmore and fenway',
    at: [-0.02, 0.02],
    reach: 0.22,
    kinds: ['apartments', 'commercial', 'university', 'yes'],
    mix: [0.72, 0.24, 0.04],
    size: [0.018, 0.028],
    tone: [0.25, 0.16],
  },
  {
    name: 'cambridge',
    at: [-0.19, -0.33],
    reach: 0.3,
    kinds: ['university', 'college', 'apartments', 'residential', 'yes'],
    mix: [0.82, 0.17, 0.01],
    size: [0.016, 0.026],
    tone: [0.24, 0.15],
  },
  {
    // The Green Line B runs out through Allston and Brighton: low, repetitive, residential.
    name: 'allston and brighton',
    at: [-0.45, 0.06],
    reach: 0.4,
    kinds: ['residential', 'apartments', 'house', 'yes'],
    mix: [0.94, 0.06, 0],
    size: [0.014, 0.022],
    tone: [0.22, 0.14],
  },
];

/**
 * How central a point is, 1 at the heart of the network and 0 out at the rim.
 *
 * Drives three things at once: outer buildings are smaller, lower and dimmer, so the city thins
 * toward the edges instead of stopping dead. The dimming is the "fade" -- tone walks down toward
 * the background colour, so the rim dissolves rather than ending in a hard line of full-bright
 * blocks competing with the network for attention.
 */
function centrality(x, z) {
  const reach = Math.hypot((x - 0.06) / 0.62, z / 0.46);
  return Math.max(0, Math.min(1, 1.18 - reach));
}

function districtAt(x, z) {
  let best = districts[districts.length - 1];
  let score = Infinity;
  for (const d of districts) {
    const reach = Math.hypot(x - d.at[0], z - d.at[1]) / d.reach;
    if (reach < score) {
      score = reach;
      best = d;
    }
  }
  return best;
}

/** Normalised outlines from the OSM crops, grouped so a district can ask for its own kinds. */
function footprintLibrary() {
  const raw = JSON.parse(readFileSync(new URL('osm-data.json', import.meta.url)));
  const library = [];
  for (const area of Object.values(raw.areas))
    for (const b of area.buildings) {
      const ring = b.ring;
      // Keep the vertex count sane: a 179-point outline is invisible detail at this scale.
      if (!Array.isArray(ring) || ring.length < 3 || ring.length > 12) continue;
      if (b.part) continue;
      const cx = ring.reduce((n, p) => n + p[0], 0) / ring.length;
      const cz = ring.reduce((n, p) => n + p[1], 0) / ring.length;
      const local = ring.map(([x, z]) => [x - cx, z - cz]);
      // Normalise by area, not by longest radius. Boston has many long narrow buildings; scaling
      // those by their max radius turns them into slivers with no visible mass, which is exactly
      // how the first attempt failed. Area keeps every footprint reading at a comparable weight.
      let twice = 0;
      for (let i = 0; i < local.length; i++) {
        const a = local[i];
        const b = local[(i + 1) % local.length];
        twice += a[0] * b[1] - b[0] * a[1];
      }
      const area = Math.abs(twice) / 2;
      if (!(area > 4)) continue;
      // Reject the most extreme slivers outright; a 4:1 shed is noise at this scale.
      const xs = local.map((q) => q[0]);
      const zs = local.map((q) => q[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      const d = Math.max(...zs) - Math.min(...zs);
      if (Math.max(w, d) / Math.max(1e-6, Math.min(w, d)) > 2.8) continue;
      const span = Math.sqrt(area);
      // Force one winding. OSM supplies both, and with single-sided materials a clockwise ring
      // builds its walls facing inward: the building is there but you look straight through it.
      const wound = twice < 0 ? [...local].reverse() : local;
      library.push({
        // Unit outline: sqrt(area) is 1, so a caller scales by the footprint weight it wants.
        shape: wound.map(([x, z]) => [x / span, z / span]),
        levels: Number.isFinite(b.levels) && b.levels > 0 ? b.levels : null,
        roof: b.roofShape ?? 'flat',
        kind: b.kind ?? 'yes',
        material: b.material ?? null,
      });
    }
  return library;
}

/**
 * Ear clipping, so concave outlines — Boston has many — cap correctly. A naive triangle fan folds
 * over itself on anything non-convex, which is most L-shaped and stepped footprints.
 */
function earClip(poly) {
  const live = poly.map((_, i) => i);
  const turn = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  let signed = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    signed += a[0] * b[1] - b[0] * a[1];
  }
  if (signed < 0) live.reverse();
  const tris = [];
  let guard = poly.length * poly.length + 16;
  while (live.length > 3 && guard-- > 0) {
    let cut = false;
    for (let i = 0; i < live.length; i++) {
      const ai = live[(i + live.length - 1) % live.length];
      const bi = live[i];
      const ci = live[(i + 1) % live.length];
      const a = poly[ai];
      const b = poly[bi];
      const c = poly[ci];
      if (turn(a, b, c) <= 0) continue;
      let clear = true;
      for (const j of live) {
        if (j === ai || j === bi || j === ci) continue;
        const q = poly[j];
        if (turn(a, b, q) >= 0 && turn(b, c, q) >= 0 && turn(c, a, q) >= 0) {
          clear = false;
          break;
        }
      }
      if (!clear) continue;
      tris.push([ai, bi, ci]);
      live.splice(i, 1);
      cut = true;
      break;
    }
    if (!cut) break;
  }
  if (live.length === 3) tris.push([live[0], live[1], live[2]]);
  return tris;
}

const slate = (t) => {
  const v = Math.max(0.1, Math.min(0.66, t));
  const c = (k) =>
    Math.round(255 * Math.min(1, v * k))
      .toString(16)
      .padStart(2, '0');
  return '#' + c(0.86) + c(0.93) + c(1.08);
};

/** A normalised outline grown or shrunk about its own centre, for plinths and cornices. */
const swell = (shape, k) => shape.map(([u, v]) => [u * k, v * k]);

/** Lift a normalised outline into world space at one height. */
const liftRing = (shape, x, z, y, size, spin) => {
  const cos = Math.cos(spin);
  const sin = Math.sin(spin);
  return shape.map(([u, v]) => [
    x + (u * cos - v * sin) * size,
    y,
    z + (u * sin + v * cos) * size,
  ]);
};

function raise(surface, shape, x, z, size, spin, bottom, top, colour) {
  const low = liftRing(shape, x, z, bottom, size, spin);
  const high = liftRing(shape, x, z, top, size, spin);
  for (let i = 0; i < shape.length; i++) {
    const j = (i + 1) % shape.length;
    face(surface, [low[i], high[i], high[j], low[j]], colour);
  }
  return { low, high };
}

function capRing(surface, ring, tris, colour, up) {
  for (const [a, b, c] of tris) {
    // earClip emits positive-turn triangles; in 3D that cross product points down, so the roof
    // needs reversing to face the camera and the floor does not.
    const pts = [ring[a], ring[b], ring[c]];
    face(surface, up ? [...pts].reverse() : pts, colour);
  }
}

/** A square, wound positive, for masts and rooftop plant. */
const SQUARE = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

/** A thin tapered mast: the antenna or spire that tops most of Boston's towers. */
function mast(surface, x, z, foot, head, width, taper, colour) {
  const low = liftRing(SQUARE, x, z, foot, width, 0);
  const high = liftRing(SQUARE, x, z, head, width * taper, 0);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    face(surface, [low[i], high[i], high[j], low[j]], colour);
  }
  face(surface, [high[3], high[2], high[1], high[0]], colour);
}

/** Rooftop plant: the lift overrun and air handling that makes a real roof uneven. */
function rooftop(surface, shape, x, z, size, spin, deck, tone, random) {
  const boxes = 1 + ((random() * 2.4) | 0);
  for (let n = 0; n < boxes; n++) {
    const k = 0.2 + random() * 0.26;
    const lean = swell(shape, k);
    const drift = 0.42 * (1 - k);
    const ox = x + Math.cos(random() * Math.PI * 2) * size * drift;
    const oz = z + Math.sin(random() * Math.PI * 2) * size * drift;
    const tall = 0.0016 + random() * 0.0042;
    raise(surface, lean, ox, oz, size, spin, deck, deck + tall, slate(tone + 0.03));
    capRing(
      surface,
      liftRing(lean, ox, oz, deck + tall, size, spin),
      earClip(lean),
      slate(tone + 0.05),
      true,
    );
  }
}

/**
 * One building: its real outline extruded, then broken up so it does not read as a plain block.
 *
 * The vocabulary is Flowcast's (data-pipeline/make_building_models.py gives every volume a ground
 * band, a cornice and a parapet) extended with what the reference model shows on a real skyline:
 * towers step back as they rise, roofs carry plant, and the tall ones finish in a mast or spire.
 * Detail is spent by height -- a three-storey block gets a plinth and a cornice, a fifty-storey
 * tower gets setbacks and an antenna -- so the triangles go where they are actually visible.
 *
 * Colours are unchanged throughout; this is geometry only.
 */
function build(surface, template, x, z, size, spin, height, tone, slabTop, random) {
  const { shape, roof } = template;
  const base = slabTop;
  // Every shade in this building is the original slate at a different brightness, so trim reads
  // as trim rather than as a different material.
  const shade = (d) => slate(tone + d);
  const colour = shade(0);
  const tris = earClip(shape);

  const pitched =
    roof === 'gabled' ||
    roof === 'hipped' ||
    roof === 'pyramidal' ||
    roof === 'gambrel' ||
    roof === 'round';
  const stepped = roof === 'mansard' || roof === 'skillion';
  const midRise = height > 0.022;
  const tower = height > 0.042;

  // Street-level band: wider than the shaft, so the base reads as grounded.
  const plinthTop = base + Math.min(height * 0.16, 0.0045);
  const plinth = swell(shape, 1.075);
  raise(surface, plinth, x, z, size, spin, base, plinthTop, shade(-0.03));
  capRing(surface, liftRing(plinth, x, z, base, size, spin), earClip(plinth), shade(-0.03), false);

  if (pitched) {
    const wallTop = base + height * 0.78;
    const body = raise(surface, shape, x, z, size, spin, plinthTop, wallTop, colour);
    const peak = liftRing(shape, x, z, base + height, size * 0.16, spin);
    for (let i = 0; i < shape.length; i++) {
      const j = (i + 1) % shape.length;
      face(surface, [body.high[i], peak[i], peak[j], body.high[j]], shade(0.08));
    }
    capRing(surface, peak, tris, shade(0.08), true);
    return;
  }

  if (stepped) {
    const wallTop = base + height * 0.84;
    raise(surface, shape, x, z, size, spin, plinthTop, wallTop, colour);
    const crown = raise(
      surface, shape, x, z, size * 0.76, spin, wallTop, base + height, shade(0.05),
    );
    capRing(surface, crown.high, tris, shade(0.06), true);
    return;
  }

  // Flat-roofed: shaft, optional setbacks, cornice, parapet, then whatever tops it.
  let footY = plinthTop;
  let waist = shape;
  let waistSize = size;
  if (tower) {
    // Towers step back as they rise. Two shoulders is enough to read at this scale.
    const steps = random() < 0.45 ? 2 : 1;
    for (let n = 0; n < steps; n++) {
      const share = (0.46 - n * 0.1) + random() * 0.14;
      const stepTop = footY + (base + height - footY) * share;
      raise(surface, waist, x, z, waistSize, spin, footY, stepTop, shade(-n * 0.02));
      // The shoulder itself: the ring left exposed where the next volume narrows.
      const next = waistSize * (0.76 + random() * 0.1);
      capRing(
        surface,
        liftRing(waist, x, z, stepTop, waistSize, spin),
        earClip(waist),
        shade(0.04),
        true,
      );
      footY = stepTop;
      waistSize = next;
    }
  }

  const wallTop = base + height * 0.93;
  const body = raise(surface, waist, x, z, waistSize, spin, footY, wallTop, colour);
  void body;

  const corniceTop = base + height;
  const lip = swell(waist, 1.055);
  const lipTris = earClip(lip);
  raise(surface, lip, x, z, waistSize, spin, wallTop, corniceTop, shade(0.05));

  const deckY = corniceTop - height * 0.035;
  const deckShape = swell(waist, 0.985);
  capRing(
    surface,
    liftRing(deckShape, x, z, deckY, waistSize, spin),
    earClip(deckShape),
    shade(-0.02),
    true,
  );

  const parapet = corniceTop + Math.min(height * 0.05, 0.0022);
  raise(surface, lip, x, z, waistSize, spin, corniceTop, parapet, shade(0.07));
  capRing(surface, liftRing(lip, x, z, parapet, waistSize, spin), lipTris, shade(0.09), true);

  // Plant on anything tall enough to need it.
  if (midRise && random() < 0.55) {
    rooftop(surface, waist, x, z, waistSize, spin, deckY, tone, random);
  }

  // Masts and spires: the thing that gives a skyline its ragged top edge.
  if (tower) {
    const spire = random() < 0.4;
    const reach = height * (spire ? 0.34 : 0.2) + 0.004;
    mast(
      surface, x, z, deckY, deckY + reach,
      waistSize * (spire ? 0.05 : 0.035),
      spire ? 0.12 : 0.55,
      shade(0.12),
    );
  } else if (midRise && random() < 0.3) {
    mast(surface, x, z, deckY, deckY + 0.0055, waistSize * 0.03, 0.5, shade(0.1));
  }
}

export function cityBlocks(surface, lines, slabTop) {
  const random = rng(20260221);
  const library = footprintLibrary();
  // Boston is a low-rise city with a small cluster of towers, and the OSM sample says so:
  // of 1081 footprints with a storey count, the median is 3 and only 12 exceed 20. Sorting the
  // library into tiers lets each district draw from that real distribution with its own bias,
  // instead of every building being clamped into a narrow district range and coming out uniform.
  const tiers = { low: [], mid: [], tall: [] };
  for (const t of library) {
    const n = t.levels ?? 3;
    (n >= 14 ? tiers.tall : n >= 6 ? tiers.mid : tiers.low).push(t);
  }
  const pick = (district) => {
    const roll = random();
    const [lowW, midW] = district.mix;
    const want = roll < lowW ? 'low' : roll < lowW + midW ? 'mid' : 'tall';
    const pool = tiers[want].length ? tiers[want] : library;
    // Prefer one of the district's own uses within that tier.
    for (let tries = 0; tries < 8; tries++) {
      const c = pool[(random() * pool.length) | 0];
      if (district.kinds.includes(c.kind)) return c;
    }
    return pool[(random() * pool.length) | 0];
  };

  const cell = 0.026;
  const bucket = (x, z) => Math.floor(x / cell) + ':' + Math.floor(z / cell);
  const rails = new Map();
  for (const line of lines)
    for (const point of line.points) {
      const k = bucket(point[0], point[2]);
      if (!rails.has(k)) rails.set(k, []);
      rails.get(k).push(point);
    }
  const onRails = (x, z, clearance) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const p of rails.get(cx + i + ':' + (cz + j)) ?? [])
          if (Math.hypot(p[0] - x, p[2] - z) < clearance) return true;
    return false;
  };
  const placed = new Map();
  const collides = (x, z, reach) => {
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const b of placed.get(cx + i + ':' + (cz + j)) ?? [])
          if (Math.hypot(b[0] - x, b[1] - z) < reach + b[2]) return true;
    return false;
  };

  let count = 0;
  /** Where a building actually went, so the ground can be drawn to exactly this extent. */
  const sites = [];
  for (const line of lines) {
    const pts = line.points;
    // Cumulative distance along the track, so placement can tell how near a line's end it is.
    const along = [0];
    for (let i = 1; i < pts.length; i++)
      along[i] = along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
    const span = along[pts.length - 1];
    // Capped at a share of the line, so a short one is not swallowed whole. The Blue Line runs
    // only 0.417 units here and a flat 0.18 off each end left just 14% of it built, which is
    // wrong: the stretch it covers is downtown and East Boston, some of the densest ground on
    // the map. The long radial branches are unaffected and keep the full clearance.
    const clear = Math.min(endClear, span * 0.3);

    // Every sample, not every other one. The inner band wants to read as a continuous street
    // wall along the track; sampling at half the rate left visible gaps in it.
    for (let i = 2; i < pts.length - 2; i += 1) {
      // How far this sample is from whichever end of the line is nearer.
      const fromEnd = Math.min(along[i], span - along[i]);
      if (fromEnd < clear) continue;
      // Ramps 0 to 1 across the fade stretch just inside the cleared ends.
      const reached = Math.min(1, (fromEnd - clear) / endFade);

      const tangent = norm(sub(pts[i + 1], pts[i - 1]));
      const side = [-tangent[2], 0, tangent[0]];
      for (const hand of [-1, 1])
        for (const row of [0, 1, 2, 3]) {
          // Four bands out from the line, each markedly sparser than the one inside it, so blocks
          // crowd the track and give out well before the edge of the map rather than tiling it.
          const band = [0.18, 0.5, 0.76, 0.9][row];
          // Near a line's end even the inner band is thin, and the outer ones never arrive.
          if (random() > (1 - band) * reached) continue;
          const probe = [
            pts[i][0] + side[0] * 0.04 * hand,
            pts[i][2] + side[2] * 0.04 * hand,
          ];
          const district = districtAt(probe[0], probe[1]);
          const template = pick(district);
          // Long tail on footprint: mostly modest blocks, occasionally a big one. The edge
          // factor shrinks whatever is drawn, so rim buildings never rival the core.
          const edge = centrality(probe[0], probe[1]);
          const bulk = (0.66 + random() ** 1.7 * 1.25) * (0.52 + edge * 0.48);
          const size =
            (district.size[0] + random() * (district.size[1] - district.size[0])) * bulk;
          const reach = size * 0.8;
          const away =
            0.016 + reach + random() * 0.045 + row * (0.052 + random() * 0.055);
          const jitter = (random() - 0.5) * 0.03;
          const x = pts[i][0] + side[0] * away * hand + tangent[0] * jitter;
          const z = pts[i][2] + side[2] * away * hand + tangent[2] * jitter;
          if (Math.abs(x) + reach > 0.738 || Math.abs(z) + reach > 0.512) continue;
          if (onRails(x, z, reach + 0.013)) continue;
          if (collides(x, z, reach + blockGap)) continue;

          // Storeys come straight from the real footprint, jittered only lightly so two copies
          // of one template differ without washing out Boston's actual distribution.
          const storeys = Math.max(1, (template.levels ?? 3) * (0.86 + random() * 0.3));
          // Capped below the landmarks (tallest ~0.096): the Prudential and the Hancock should
          // still be the tallest things on the map, not an anonymous office block.
          // Compressed so a 3-storey block is still visible while a 54-storey tower still reads
          // as a tower: the exponent keeps the spread dramatic without the tall tail running away.
          const height = Math.min(
            0.082,
            (0.006 + storeys ** 0.8 * 0.0042) * (0.58 + edge * 0.42),
          );
          const spin = random() * Math.PI * 2;
          // Fade: tone falls toward the background at the rim, so the city dissolves outward.
          const tone = (district.tone[0] + random() * district.tone[1]) * (0.4 + edge * 0.6);
          build(surface, template, x, z, size, spin, height, tone, slabTop, random);

          const k = bucket(x, z);
          if (!placed.has(k)) placed.set(k, []);
          placed.get(k).push([x, z, reach]);
          sites.push([x, z, reach]);
          count++;
        }
    }
  }

  return { count, sites };
}
