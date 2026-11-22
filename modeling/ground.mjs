// The ground the network sits on.
//
// Two problems had to be solved together. A rectangular deck reads as a slab dropped under the
// map -- its corners have nothing to do with where Boston actually is. And any finite ground ends
// somewhere, and a hard edge against the backdrop looks like the map ran out rather than like a
// place.
//
// So the shape is derived from the network itself: for each direction out from the centre, the
// ground reaches as far as the furthest track in that direction plus the width of the city beside
// it, then those radii are smoothed into an organic outline. No corners, no bounding box, and the
// silhouette follows the lines because it is built from them.
//
// The blend is done with vertex colour rather than transparency. Everything in this pipeline bakes
// colour per face, so the outer ring is written at exactly the renderer's backdrop value and the
// rings inside it step up to the ground tone. The rim therefore dissolves into the background
// instead of ending -- no alpha, no blend state, no sort-order fighting with the buildings, and it
// behaves identically from every camera angle.
import { face } from './geometry.mjs';

/** Must match studioBackdrop in web/src/xr/PlayCanvasApp.ts, or the rim will show a seam. */
const BACKDROP = '#151922';

/** The lit ground under the middle of the network. */
const GROUND = '#1e2432';

/** Directions sampled around the centre. 128 is smooth at this scale and costs little. */
const SPOKES = 128;

/**
 * How far past the outermost track the solid ground reaches. The city is placed in four bands out
 * to roughly 0.22 units from a line, so this clears the buildings before the fade starts.
 */
const SKIRT = 0.3;

/** How much further the fade runs before it is fully background. */
const FADE = 0.42;

const mixHex = (a, b, t) =>
  '#' +
  [1, 3, 5]
    .map((i) => {
      const u = parseInt(a.slice(i, i + 2), 16);
      const v = parseInt(b.slice(i, i + 2), 16);
      return Math.round(u + (v - u) * t)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');

/**
 * Reach per direction, from the track geometry.
 *
 * Bins every centreline sample by bearing and keeps the furthest in each bin. Empty bins are
 * filled by walking out to the nearest neighbour that has a value, then the whole ring is
 * smoothed circularly so the outline curves instead of stepping.
 */
function reaches(lines, centre) {
  const raw = new Array(SPOKES).fill(0);
  for (const line of lines)
    for (const p of line.points) {
      const dx = p[0] - centre[0];
      const dz = p[2] - centre[1];
      const bin =
        (Math.round((Math.atan2(dz, dx) / (Math.PI * 2)) * SPOKES) + SPOKES) % SPOKES;
      raw[bin] = Math.max(raw[bin], Math.hypot(dx, dz));
    }

  // Fill gaps: a direction with no track still needs ground if its neighbours have some.
  for (let i = 0; i < SPOKES; i++) {
    if (raw[i] > 0) continue;
    let back = 0;
    let forward = 0;
    while (raw[(i - back + SPOKES) % SPOKES] === 0 && back < SPOKES) back++;
    while (raw[(i + forward) % SPOKES] === 0 && forward < SPOKES) forward++;
    const a = raw[(i - back + SPOKES) % SPOKES];
    const b = raw[(i + forward) % SPOKES];
    raw[i] = (a * forward + b * back) / Math.max(1, back + forward);
  }

  // Circular smoothing, twice, so the outline reads as a coastline and not as a polygon.
  let smooth = raw;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Array(SPOKES);
    for (let i = 0; i < SPOKES; i++) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) sum += smooth[(i + k + SPOKES) % SPOKES];
      next[i] = sum / 13;
    }
    smooth = next;
  }
  return smooth;
}

/**
 * Build the ground into `surface`, which is shared with the city so this costs no extra draw call.
 *
 * Four concentric rings: a solid core, a solid outer edge at the city limit, then two fading rings
 * that reach the backdrop colour exactly.
 */
export function groundBlob(surface, lines, y) {
  const centre = [0.02, 0];
  const reach = reaches(lines, centre);

  // Ring radii as a fraction of each spoke's reach, with the colour each is written at.
  const bands = [
    { scale: 0.42, pad: 0, tint: 0 },
    { scale: 1, pad: SKIRT * 0.55, tint: 0.06 },
    { scale: 1, pad: SKIRT, tint: 0.3 },
    { scale: 1, pad: SKIRT + FADE * 0.45, tint: 0.72 },
    { scale: 1, pad: SKIRT + FADE, tint: 1 },
  ];

  const at = (band, i) => {
    const angle = (i / SPOKES) * Math.PI * 2;
    const r = reach[i] * band.scale + band.pad;
    return [centre[0] + Math.cos(angle) * r, y, centre[1] + Math.sin(angle) * r];
  };
  const colourOf = (band) => mixHex(GROUND, BACKDROP, band.tint);

  // Core: a fan from the centre out to the first ring.
  const hub = [centre[0], y, centre[1]];
  const core = colourOf(bands[0]);
  for (let i = 0; i < SPOKES; i++) {
    const j = (i + 1) % SPOKES;
    face(surface, [hub, at(bands[0], j), at(bands[0], i)], core);
  }

  // Then a quad strip per band, each step closer to the backdrop.
  for (let b = 1; b < bands.length; b++) {
    const inner = bands[b - 1];
    const outer = bands[b];
    // One colour per quad: with 128 spokes the steps are far finer than the eye resolves, and it
    // keeps every face flat-shaded like the rest of the model.
    const shade = mixHex(colourOf(inner), colourOf(outer), 0.5);
    for (let i = 0; i < SPOKES; i++) {
      const j = (i + 1) % SPOKES;
      face(surface, [at(inner, i), at(inner, j), at(outer, j), at(outer, i)], shade);
    }
  }
}
