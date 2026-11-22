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

/**
 * How far the rim fades out. Short on purpose: the ground is one blob around the network, not a
 * set of concentric shells. This was 0.42 across two extra rings, which read as two further blobs
 * ringing the first rather than as one shape dissolving.
 */
const FADE = 0.1;

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
/**
 * Build the ground into `surface`, which is shared with the city so this costs no extra draw call.
 *
 * One blob, not a stack of rings. An earlier version drew concentric bands with face(), which
 * bakes a single flat colour per quad -- so each band came out a uniform shade with a hard edge
 * against its neighbour, and the ground read as three separate blobs rather than one fading out.
 * Removing bands only changed how many of those edges there were.
 *
 * The fix is to colour per vertex instead. Surface.vertex() takes its own colour, so the shade is
 * interpolated across every triangle and the rim dissolves continuously with no steps anywhere.
 */
const RINGS = 14;

/** Fraction of the radius that stays full-strength ground before the rim starts to fade. */
const SOLID = 0.74;

/** Smooth, so the fade has no visible start or end. */
const smoothstep = (t) => t * t * (3 - 2 * t);

function quad(surface, points, colours) {
  const up = [0, 1, 0];
  const ids = points.map((point, i) => surface.vertex(point, up, colours[i]));
  surface.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
}

export function groundBlob(surface, lines, y) {
  const centre = [0.02, 0];
  const reach = reaches(lines, centre);

  // Radius and colour at ring `u` (0 at the centre, 1 at the outer rim) along spoke `i`.
  const radiusAt = (u, i) => {
    const solid = reach[i] + SKIRT;
    return u <= SOLID
      ? solid * (u / SOLID)
      : solid + FADE * ((u - SOLID) / (1 - SOLID));
  };
  const tintAt = (u) => (u <= SOLID ? 0 : smoothstep((u - SOLID) / (1 - SOLID)));
  const colourAt = (u) => mixHex(GROUND, BACKDROP, tintAt(u));
  const pointAt = (u, i) => {
    const angle = (i / SPOKES) * Math.PI * 2;
    const r = radiusAt(u, i);
    return [centre[0] + Math.cos(angle) * r, y, centre[1] + Math.sin(angle) * r];
  };

  // Core fan out to the first ring.
  const hub = [centre[0], y, centre[1]];
  const first = 1 / RINGS;
  const core = colourAt(0);
  const firstColour = colourAt(first);
  for (let i = 0; i < SPOKES; i++) {
    const j = (i + 1) % SPOKES;
    const a = pointAt(first, i);
    const b = pointAt(first, j);
    const up = [0, 1, 0];
    const ids = [
      surface.vertex(hub, up, core),
      surface.vertex(b, up, firstColour),
      surface.vertex(a, up, firstColour),
    ];
    surface.indices.push(ids[0], ids[1], ids[2]);
  }

  // Then one continuous sheet out to the rim, shaded per vertex.
  for (let k = 1; k < RINGS; k++) {
    const inner = k / RINGS;
    const outer = (k + 1) / RINGS;
    const ci = colourAt(inner);
    const co = colourAt(outer);
    for (let i = 0; i < SPOKES; i++) {
      const j = (i + 1) % SPOKES;
      quad(
        surface,
        [pointAt(inner, i), pointAt(inner, j), pointAt(outer, j), pointAt(outer, i)],
        [ci, ci, co, co],
      );
    }
  }
}
