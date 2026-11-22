// The city on the map: real Boston and Cambridge buildings, standing where they stand.
//
// Earlier passes laid blocks out along the lines by rule -- first rotated boxes, then OpenStreetMap
// outlines used as templates and dropped wherever the layout wanted one. They read as a city, but
// not as this city: nothing was where it really is. These are the actual buildings.
//
// The layout is the one the Map Redesign export arrived at (map.js, buildCity), ported here:
//
//   - the candidates are the compact, tower-like footprints of the two cities' own surveys (City of
//     Boston BPDA and City of Cambridge GIS, pinned in city-footprints.json), ranked most slender
//     and tallest first;
//   - they are taken in that order, each at its true position and facing, until ninety stand, and
//     one is passed over only if it would touch one already standing, a line, a station or a
//     landmark;
//   - each is drawn five times life size across and up, so footprint and height keep the
//     proportions they really have, with the height of a tower compressed above 35 m so the
//     skyline is not all Financial District;
//   - and each brings its complex with it: the neighbours that share its walls, at their own
//     heights, so a tower stands on its real podium and a town house in its real row.
//
// Ninety is the export's number and it is kept on purpose. The map is a setting for the network,
// and at any real density the blocks bury the lines they are there to place.
//
// What is not taken from the export is the finish. Its buildings are brick, stone and glass in a
// dozen colours; this city is one pale slate, so the lines stay the only saturated thing on the
// plate.
import { readFileSync } from 'node:fs';
import { earClip, face, rgb, rng } from './geometry.mjs';
import { ringDistance } from './landmarks.mjs';
import { inWater } from './water.mjs';

// ---------------------------------------------------------------------------------------------
// The colour of the city. One material, one hue family: a light slate with a blue bias, pale
// enough to sit behind the network on a cream backdrop. These are surface colours, before
// lighting -- the app's lights lift a roof well above its albedo and leave a shaded wall below it.
// ---------------------------------------------------------------------------------------------

/**
 * The roof of an ordinary block at the heart of the network. Under the studio lights it reads
 * about #C5CCD8; the walls beneath it are a step darker (see TRIM_GAIN) and, turned away from the
 * key light, read about #8A9096.
 */
const SLATE_HEART = '#BBC8DD';

/**
 * What a roof becomes at the rim: paler, less blue and close to the plate's own value, so the
 * city thins into the ground instead of ending in a row of full-strength blocks. Lit, it reads
 * about #DAD9D5.
 */
const SLATE_RIM = '#D2D3D0';

/** The building tone that lands exactly on those colours. District tones run 0.22 to 0.5. */
const TONE_MID = 0.35;

/**
 * How far one building's brightness may differ from the next: the change per unit of tone, so a
 * building 0.1 lighter in tone is TONE_GAIN x 10 percent brighter.
 */
const TONE_GAIN = 0.6;

/**
 * The same for the trim within one building. Every part of a building is drawn at an offset from
 * its wall -- plinth -0.03, cornice +0.05, roof +0.09, mast +0.12 -- and this turns the offset
 * into brightness. It is what keeps the massing detailed once it is pale, and what sets the walls
 * below the roofs.
 */
const TRIM_GAIN = 1.2;

/** The trim offset of a flat roof, which is the part the two colours above describe. */
const TRIM_ROOF = 0.09;

/** The share of both contrasts left at the rim, where the massing should flatten out. */
const RIM_CONTRAST = 0.4;

/**
 * Where Boston's character changes, in sculpture coordinates. A district only sets how light or
 * dark its buildings run (`tone`: the darkest, and the range above it), so that downtown reads a
 * shade deeper than Allston. Which buildings stand in it is the survey's business.
 */
const districts = [
  { name: 'downtown', at: [0.413, -0.041], reach: 0.2, tone: [0.3, 0.2] },
  { name: 'back bay', at: [0.2, 0.01], reach: 0.22, tone: [0.27, 0.16] },
  { name: 'kenmore and fenway', at: [-0.02, 0.02], reach: 0.22, tone: [0.25, 0.16] },
  { name: 'cambridge', at: [-0.19, -0.33], reach: 0.3, tone: [0.24, 0.15] },
  { name: 'allston and brighton', at: [-0.45, 0.06], reach: 0.4, tone: [0.22, 0.14] },
];

/**
 * How central a point is, 1 at the heart of the network and 0 out at the rim.
 *
 * Outer buildings are paler, so the city thins toward the edges instead of stopping dead: colour
 * walks toward the ground and contrast drops, and the rim dissolves rather than ending in
 * full-strength blocks competing with the network for attention.
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

/**
 * The slate for a building of brightness `tone`, on a part of it `trim` lighter or darker than
 * its walls, standing `edge` of the way in from the rim (1 at the heart).
 *
 * The hue comes from where the building stands, sliding from the rim colour to the heart colour.
 * Tone and trim only make it lighter or darker, and by less the further out it is.
 */
const slate = (tone, trim, edge) => {
  const rim = rgb(SLATE_RIM);
  const heart = rgb(SLATE_HEART);
  const lift =
    1 +
    ((tone - TONE_MID) * TONE_GAIN + (trim - TRIM_ROOF) * TRIM_GAIN) *
      (RIM_CONTRAST + (1 - RIM_CONTRAST) * edge);
  return (
    '#' +
    rim
      .map((c, k) =>
        Math.round(255 * Math.max(0, Math.min(1, (c + (heart[k] - c) * edge) * lift)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
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
function rooftop(surface, shape, x, z, size, spin, deck, shade, random) {
  const boxes = 1 + ((random() * 2.4) | 0);
  for (let n = 0; n < boxes; n++) {
    const k = 0.2 + random() * 0.26;
    const lean = swell(shape, k);
    const drift = 0.42 * (1 - k);
    const ox = x + Math.cos(random() * Math.PI * 2) * size * drift;
    const oz = z + Math.sin(random() * Math.PI * 2) * size * drift;
    const tall = 0.0016 + random() * 0.0042;
    raise(surface, lean, ox, oz, size, spin, deck, deck + tall, shade(0.03));
    capRing(
      surface,
      liftRing(lean, ox, oz, deck + tall, size, spin),
      earClip(lean),
      shade(0.05),
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
 * `tone` is the building's own brightness and `edge` how central it stands; between them they
 * pick every colour on it. `ground` is where it leaves its contact shadow.
 */
function build(surface, shape, x, z, size, spin, height, tone, edge, slabTop, random, ground) {
  const base = slabTop;
  // Every shade in this building is the same slate at a different brightness, so trim reads
  // as trim rather than as a different material.
  const shade = (d) => slate(tone, d, edge);
  const colour = shade(0);

  const midRise = height > 0.022;
  const tower = height > 0.042;

  // Street-level band: wider than the shaft, so the base reads as grounded.
  const plinthTop = base + Math.min(height * 0.16, 0.0045);
  const plinth = swell(shape, 1.075);
  raise(surface, plinth, x, z, size, spin, base, plinthTop, shade(-0.03));
  const plinthTris = earClip(plinth);
  capRing(surface, liftRing(plinth, x, z, base, size, spin), plinthTris, shade(-0.03), false);
  // The ledge where the plinth stands proud of the shaft. Left open, it shows the ground through
  // the building's foot -- unnoticeable on a dark ground, a pale seam on a light one.
  capRing(surface, liftRing(plinth, x, z, plinthTop, size, spin), plinthTris, shade(-0.03), true);
  // The halo it stands in, hugging the plinth.
  ground.footprintShadow(liftRing(plinth, x, z, 0, size, spin).map((p) => [p[0], p[2]]));

  // Shaft, optional setbacks, cornice, parapet, then whatever tops it. The surveys record no roof
  // shape, and at five times life size a flat roof with its parapet is the honest reading.
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
  raise(surface, waist, x, z, waistSize, spin, footY, wallTop, colour);

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
    rooftop(surface, waist, x, z, waistSize, spin, deckY, shade, random);
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

/**
 * A neighbour in a building's complex: the adjoining footprint at its own height, finished plainly
 * -- wall, a cornice band, a roof -- so the building it belongs to stays the one with the detail.
 * `shape` is in the main building's own frame, so the two meet exactly where they really do.
 */
function annex(surface, shape, x, z, size, height, tone, edge, slabTop, ground) {
  const shade = (d) => slate(tone, d, edge);
  const top = slabTop + height;
  const band = top - Math.min(height * 0.1, 0.0014);
  raise(surface, shape, x, z, size, 0, slabTop, band, shade(-0.015));
  raise(surface, shape, x, z, size, 0, band, top, shade(0.05));
  capRing(surface, liftRing(shape, x, z, top, size, 0), earClip(shape), shade(0.08), true);
  ground.footprintShadow(liftRing(shape, x, z, 0, size, 0).map((p) => [p[0], p[2]]));
}

// ---------------------------------------------------------------------------------------------
// The layout: which of the surveyed buildings stand, and how large.
//
// Every number in this section is the Map Redesign export's (map.js: SETTINGS and buildCity),
// unless it says otherwise.
// ---------------------------------------------------------------------------------------------

/** How many buildings stand. */
const BUILDINGS = 90;

/** How much larger than life a building is drawn, across and up alike. */
const SCALE = 5;

/** No building stands taller than this on the sculpture; one that would is scaled down whole. */
const TALLEST = 0.16;

/**
 * Height above this many metres counts for less and less (it grows as a square root), so a 160 m
 * tower is three times a 35 m block rather than five and the towers do not flatten everything
 * round them. The landmarks are not compressed, which is what keeps the Prudential and the Hancock
 * the tallest things on the map.
 */
const KNEE = 35;
const squash = (metres) => (metres <= KNEE ? metres : KNEE * Math.sqrt(metres / KNEE));

/** Open ground between a building and its neighbour, or a line. */
const GAP = 0.008;

/** A building has to stand this far inside the ground plate, 1 being its solid part. */
const ON_THE_PLATE = 0.35;

// What the export page does not have to clear, and this sculpture does: the network is drawn far
// larger here, the landmarks are models with real outlines, and the water is in the plate.

/** Half the width of a track plate; the export measures to the plate's edge, this to its middle. */
const TRACK_HALF_WIDTH = 0.0042;

/** Open ground left round a landmark's outline, so it stands apart from the blocks. */
const LANDMARK_CLEARING = 0.012;

/** Open ground left round an explorable station's drum (radius 0.0192), for its ring and label. */
const DRUM_CLEARING = 0.0192 + 0.01;

/** Ground left open between a building and the water's edge. */
const BANK = 0.003;

const METRES = 6500;
const FEET = 0.3048;

/** Signed area of an outline; positive is the winding every wall and roof here expects. */
const shoelace = (ring) => {
  let twice = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
};

/**
 * A surveyed ring as an outline in a building's own frame: about `centre`, in units of `span`,
 * wound one way, without the repeated closing corner or the corners that lie on a straight run
 * (which the survey is full of, and which an ear-clipped roof cannot use).
 */
function outline(flat, centre, span) {
  let pts = [];
  for (let i = 0; i < flat.length; i += 2)
    pts.push([(flat[i] / 1e5 - centre[0]) / span, (flat[i + 1] / 1e5 - centre[1]) / span]);
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-4;
  pts = pts.filter((p, i) => !near(p, pts[(i + 1) % pts.length]));
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 2e-5) {
        pts.splice(i--, 1);
        changed = true;
      }
    }
  }
  return shoelace(pts) < 0 ? pts.reverse() : pts;
}

/**
 * The block a footprint amounts to: Douglas-Peucker down to eight corners or fewer. Only its reach
 * is used -- how much room the building needs -- so a notch in a wall does not claim ground.
 */
function blockOf(ring) {
  const dp = (pts, tol) => {
    if (pts.length < 3) return pts;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    let far = 0;
    let at = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const d =
        Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) /
        (Math.hypot(b[0] - a[0], b[1] - a[1]) || 1);
      if (d > far) {
        far = d;
        at = i;
      }
    }
    return far > tol ? [...dp(pts.slice(0, at + 1), tol).slice(0, -1), ...dp(pts.slice(at), tol)] : [a, b];
  };
  let start = 0;
  for (let i = 1; i < ring.length; i++) if (Math.hypot(...ring[i]) > Math.hypot(...ring[start])) start = i;
  const turned = [...ring.slice(start), ...ring.slice(0, start), ring[start]];
  let tol = 0.12;
  let out = dp(turned, tol).slice(0, -1);
  while (out.length > 8 && tol < 1) {
    tol *= 1.5;
    out = dp(turned, tol).slice(0, -1);
  }
  if (out.length < 4) {
    // Too few corners to be a block: use the box that holds the footprint, along its first wall.
    const lean = Math.atan2(ring[1][1] - ring[0][1], ring[1][0] - ring[0][0]);
    const [cos, sin] = [Math.cos(lean), Math.sin(lean)];
    let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, z] of ring) {
      const [u, v] = [x * cos + z * sin, -x * sin + z * cos];
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    out = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => [u * cos - v * sin, u * sin + v * cos]);
  }
  return out;
}

const furthest = (ring) => ring.reduce((reach, p) => Math.max(reach, Math.hypot(p[0], p[1])), 0);

function segmentDistance(x, z, a, b) {
  const vx = b[0] - a[0];
  const vz = b[2] - a[2];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[2]) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(a[0] + vx * t - x, a[2] + vz * t - z);
}

/**
 * Choose the buildings and build them. `clear` says what they leave room for, beyond each other
 * and the lines: `keepOut`, the plan outlines of the landmarks; `drums`, the explorable stations;
 * and `water`, the bodies of water in the plate.
 *
 * Returns how many candidates there were and how many stand.
 */
export function cityBlocks(surface, lines, slabTop, ground, clear = {}) {
  const { keepOut = [], drums = [], water = [] } = clear;
  const { footprints } = JSON.parse(readFileSync(new URL('city-footprints.json', import.meta.url)));

  const candidates = footprints.map((f) => {
    const n = f.r.length / 2;
    let x = 0;
    let z = 0;
    for (let i = 0; i < f.r.length; i += 2) {
      x += f.r[i];
      z += f.r[i + 1];
    }
    const centre = [x / n / 1e5, z / n / 1e5];
    let twice = 0;
    for (let i = 0; i < f.r.length; i += 2) {
      const j = (i + 2) % f.r.length;
      twice += f.r[i] * f.r[j + 1] - f.r[j] * f.r[i + 1];
    }
    // The side of the square with the footprint's area: its size, whatever its shape.
    const span = Math.sqrt(Math.abs(twice) / 2 / 1e10);
    const metres = f.h * FEET;
    return {
      ...f,
      centre,
      span,
      metres,
      // Tower-like before squat; within each, slender and tall first.
      score: (f.tier ? 0 : 1e6) + (metres / (span * METRES)) * Math.sqrt(metres) * (0.7 + f.zone * 0.3),
    };
  });
  candidates.sort((a, b) => b.score - a.score);

  const standing = [];
  /** Whether a building of this reach, standing here, would crowd anything. */
  const crowded = (x, z, reach) => {
    for (const s of standing) if (Math.hypot(s.x - x, s.z - z) < reach + GAP + s.reach) return true;
    for (const line of lines)
      for (let i = 1; i < line.points.length; i++)
        if (segmentDistance(x, z, line.points[i - 1], line.points[i]) < reach + GAP + TRACK_HALF_WIDTH) return true;
    for (const ring of keepOut) if (ringDistance(ring, x, z) < reach + LANDMARK_CLEARING) return true;
    for (const [dx, dz] of drums) if (Math.hypot(dx - x, dz - z) < reach + DRUM_CLEARING) return true;
    // Nothing is built in the water, or with a corner over the bank.
    if (inWater(water, x, z)) return true;
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      if (inWater(water, x + Math.cos(a) * (reach + BANK), z + Math.sin(a) * (reach + BANK))) return true;
    }
    return false;
  };

  for (const c of candidates) {
    if (standing.length >= BUILDINGS) break;
    const [x, z] = c.centre;
    if (ground.coverage(x, z) < ON_THE_PLATE) continue;
    // One factor for footprint and height, so the building keeps its real proportions.
    const scale = Math.min(SCALE, (TALLEST * METRES) / squash(c.metres));
    const size = c.span * scale;
    const shape = outline(c.r, c.centre, c.span);
    const block = blockOf(shape);
    if (shape.length < 3 || block.length < 3 || furthest(block) > 2) continue;
    // A little inside its furthest corner: buildings may stand shoulder to shoulder.
    const reach = furthest(block) * size * 0.85;
    if (crowded(x, z, reach)) continue;

    // Its complex, if the complex fits: the neighbours no taller than it is.
    let parts = c.parts
      .filter(([h]) => h <= c.h)
      .map(([h, r]) => ({ h, shape: outline(r, c.centre, c.span) }))
      .filter((part) => part.shape.length >= 3);
    let whole = Math.max(furthest(shape), ...parts.map((part) => furthest(part.shape))) * size;
    const alone = reach / 0.85;
    if (whole > reach * 2.2 || (whole > alone && crowded(x, z, whole * 0.9))) {
      parts = [];
      whole = alone;
    }
    standing.push({ c, x, z, reach: Math.max(reach, whole * 0.9), size, scale, shape, parts });
  }

  // One random stream, drawn from in the order the buildings were chosen, for tone and trim.
  const random = rng(20260221);
  for (const { c, x, z, size, scale, shape, parts } of standing) {
    const edge = centrality(x, z);
    const district = districtAt(x, z);
    const tone = district.tone[0] + random() * district.tone[1];
    const rise = (squash(c.metres) / c.metres) * scale * FEET / METRES;
    build(surface, shape, x, z, size, 0, c.h * rise, tone, edge, slabTop, random, ground);
    parts.forEach((part, n) =>
      annex(surface, part.shape, x, z, size, part.h * rise, tone - 0.02 + (n % 3) * 0.015, edge, slabTop, ground),
    );
  }
  return { placed: candidates.length, kept: standing.length };
}
