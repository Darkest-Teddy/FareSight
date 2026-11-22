// City blocks along the network, shaped by real Boston footprints.
//
// Earlier passes drew rotated boxes, which read as one building repeated. These use actual
// OpenStreetMap outlines (city-footprints.json, a pinned snapshot of the osm-data.json footprints
// across the five station crops, about 1000 of them not rectangles). Each becomes a reusable
// template carrying its outline, storey count, roof shape and use, and is then placed where that
// kind of building actually belongs in Boston.
//
// Footprints are scaled to the sculpture, not to reality: at true scale a city block is a speck
// beside a 0.015-wide track plate. The shape and proportions are authentic; absolute size is not.
import { readFileSync } from 'node:fs';
import { Surface, earClip, face, norm, rgb, rng, sub } from './geometry.mjs';
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
 * Drives three things at once: outer buildings are smaller, lower and paler, so the city thins
 * toward the edges instead of stopping dead. The paling is the "fade" -- colour walks toward the
 * ground and contrast drops, so the rim dissolves rather than ending in a hard line of
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
 * Normalised outlines from the OSM crops, grouped so a district can ask for its own kinds.
 *
 * Read from a pinned snapshot, not from osm-data.json. Every building on the map is drawn from
 * this list through one random stream, so adding a single footprint to it reshuffles the whole
 * city. osm-data.json is re-fetched whenever a station island needs its crop corrected; the
 * snapshot holds the footprints the shipped sculpture was cast from, already filtered to outlines
 * of 12 corners or fewer (a 179-point outline is invisible detail at this scale) with building
 * parts left out, so the map stays the same map.
 */
function footprintLibrary() {
  const { footprints } = JSON.parse(
    readFileSync(new URL('city-footprints.json', import.meta.url)),
  );
  const library = [];
  for (const b of footprints) {
    const ring = b.ring;
    const cx = ring.reduce((n, p) => n + p[0], 0) / ring.length;
    const cz = ring.reduce((n, p) => n + p[1], 0) / ring.length;
    const local = ring.map(([x, z]) => [x - cx, z - cz]);
    // Normalise by area, not by longest radius. Boston has many long narrow buildings; scaling
    // those by their max radius turns them into slivers with no visible mass, which is exactly
    // how the first attempt failed. Area keeps every footprint reading at a comparable weight.
    let twice = 0;
    for (let i = 0; i < local.length; i++) {
      const a = local[i];
      const c = local[(i + 1) % local.length];
      twice += a[0] * c[1] - c[0] * a[1];
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
    });
  }
  return library;
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
function build(surface, template, x, z, size, spin, height, tone, edge, slabTop, random, ground) {
  const { shape, roof } = template;
  const base = slabTop;
  // Every shade in this building is the same slate at a different brightness, so trim reads
  // as trim rather than as a different material.
  const shade = (d) => slate(tone, d, edge);
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
  const plinthTris = earClip(plinth);
  capRing(surface, liftRing(plinth, x, z, base, size, spin), plinthTris, shade(-0.03), false);
  // The ledge where the plinth stands proud of the shaft. Left open, it shows the ground through
  // the building's foot -- unnoticeable on a dark ground, a pale seam on a light one.
  capRing(surface, liftRing(plinth, x, z, plinthTop, size, spin), plinthTris, shade(-0.03), true);
  // The halo it stands in, hugging the plinth.
  ground.footprintShadow(liftRing(plinth, x, z, 0, size, spin).map((p) => [p[0], p[2]]));

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

// ---------------------------------------------------------------------------------------------
// Thinning. The layout below fills four bands either side of every line, which is the right way to
// find places for buildings and far too many buildings to look at: at that density the blocks hide
// the lines they are there to give a setting to, and a landmark is lost among them.
//
// So the layout is kept exactly as it was -- same seed, same places, same shapes -- and only some
// of what it lays out is built. Which ones is decided over the whole city at once: the most
// substantial buildings are taken first, and each one taken clears a space round itself, so what
// is left is evenly spread and made of blocks big enough to read as buildings. Landmarks and the
// explorable stations get a clearing of their own, and the river is kept clear to its banks.
// ---------------------------------------------------------------------------------------------

/** Open ground left round a landmark's foot, beyond the building's own reach. */
const LANDMARK_CLEARING = 0.016;

/** Open ground left round an explorable station's drum (radius 0.0192), likewise. */
const DRUM_CLEARING = 0.0192 + 0.014;

/**
 * The gap two neighbouring buildings must leave between them, at the heart of the network and at
 * its rim. The layout's own gap is 0.009 everywhere; these are what thin it. Wider at the rim, so
 * the city trails off instead of stopping.
 */
const SPACING_HEART = 0.0105;
const SPACING_RIM = 0.032;

/** Ground left open between a building and the river bank, beyond the building's own reach. */
const BANK = 0.004;

/** Buildings with less reach than this are specks at map scale, and go first. */
const SMALLEST_REACH = 0.0085;

/**
 * Which of the laid-out buildings to build. `blocks` is every building the layout placed, in
 * order; the result is the set of their indices that survive.
 */
function thin(blocks, { keepOut = [], drums = [], water = [] }) {
  const standing = blocks.filter((b) => {
    if (b.reach < SMALLEST_REACH) return false;
    // Nothing is built in the river, or with a corner over the bank.
    if (inWater(water, b.x, b.z)) return false;
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      if (inWater(water, b.x + Math.cos(a) * (b.reach + BANK), b.z + Math.sin(a) * (b.reach + BANK))) return false;
    }
    for (const ring of keepOut) if (ringDistance(ring, b.x, b.z) < b.reach + LANDMARK_CLEARING) return false;
    for (const [x, z] of drums) if (Math.hypot(b.x - x, b.z - z) < b.reach + DRUM_CLEARING) return false;
    return true;
  });
  // Substance first: a broad or tall building says more about the city than a small low one. But
  // not strictly, or only the big blocks would survive and the city would lose its grain: each
  // building's weight is scaled by a number fixed by its place in the layout, so some modest ones
  // outrank their neighbours. Nothing here is random, and the index breaks ties, so the choice is
  // the same on every run.
  const luck = (index) => (Math.imul(index + 1, 2654435761) >>> 0) / 4294967296;
  const weight = (b) => b.reach * (1 + b.height / 0.03) * (0.55 + 0.9 * luck(b.index));
  standing.sort((a, b) => weight(b) - weight(a) || a.index - b.index);
  const kept = [];
  for (const b of standing) {
    const spacing = SPACING_RIM + (SPACING_HEART - SPACING_RIM) * b.edge;
    if (kept.every((k) => Math.hypot(k.x - b.x, k.z - b.z) >= k.reach + b.reach + spacing)) kept.push(b);
  }
  return new Set(kept.map((b) => b.index));
}

/** A surface and a ground that take a building and keep nothing: where the thinned ones go. */
const nowhere = { surface: new Surface(0, 'Unbuilt'), ground: { footprintShadow() {} } };

/**
 * Lay the city out and build what survives the thinning. `clear` says what to leave room for:
 * `keepOut`, the plan outlines of the landmarks; `drums`, the explorable stations; and `water`,
 * the reaches of the river.
 *
 * The layout runs twice on the same seed. The first pass builds nothing and only reports where
 * every building would go; the second builds the survivors. Running the whole layout both times is
 * what keeps each surviving building identical to the one the unthinned city had in that place:
 * every building draws from one random stream, so skipping one would reshuffle all that follow.
 */
export function cityBlocks(surface, lines, slabTop, ground, clear = {}) {
  const blocks = [];
  layOut(lines, slabTop, (block) => {
    blocks.push(block);
    return nowhere;
  });
  const kept = thin(blocks, clear);
  layOut(lines, slabTop, (block) => (kept.has(block.index) ? { surface, ground } : nowhere));
  return { placed: blocks.length, kept: kept.size };
}

/**
 * The layout itself. `site(block)` is asked, for each building in turn, which surface and ground
 * it should be built on.
 */
function layOut(lines, slabTop, site) {
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
  /**
   * Centreline samples on the built stretch of each line.
   *
   * The ground needs these for continuity. Buildings alone are spaced further apart than any
   * sensible pavement, so a union of discs around them breaks into islands; the spine stitches
   * the corridor together while the buildings are what push the edge outward. It stops where the
   * end clearance begins, so the ground still ends before the line does.
   */
  const spine = [];
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
      spine.push([pts[i][0], pts[i][2], 0]);

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
          // The building's own tone. The fade toward the rim is not here: slate() does it, from
          // how central the building stands.
          const tone = district.tone[0] + random() * district.tone[1];
          const { surface, ground } = site({ index: count, x, z, reach, height, edge });
          build(surface, template, x, z, size, spin, height, tone, edge, slabTop, random, ground);

          const k = bucket(x, z);
          if (!placed.has(k)) placed.set(k, []);
          placed.get(k).push([x, z, reach]);
          sites.push([x, z, reach]);
          count++;
        }
    }
  }

  return { count, sites, spine };
}
