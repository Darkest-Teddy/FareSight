// The ground the network sits on, and the contact shadows that sit on the ground.
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
// The plate is a sheet of cool gray glass on a light backdrop. Its colour and its opacity are both
// written per vertex, so the rim is a real gradient to nothing rather than a step, and it dissolves
// into whatever is behind it without knowing what that colour is. That needs alpha blending, so the
// plate is its own surface ('Ground plate'); the renderer draws it after everything opaque and
// without writing depth.
//
// The Charles is in the sheet too (water.mjs): a blue tint at the plate's own level, drawn after
// the plate and before the shadows.
//
// The same surface carries the contact shadows: a soft strip under each track and a halo round the
// foot of each building. They are darker ink on the same sheet, lifted a hair above it, and they
// come after the plate in the index buffer so that within the one draw call they blend over it.
import { TAU, norm, sub } from './geometry.mjs';

/** The plate's tint. Light passes through it, so on screen it reads paler than this. */
export const PLATE_COLOUR = '#687080';

/** Opacity of the solid part of the plate, before the rim fades it out. */
export const PLATE_ALPHA = 0.23;

/** Directions sampled around the centre. 128 is smooth at this scale and costs little. */
const SPOKES = 128;

/**
 * How far past the outermost track the ground reaches before its edge. The city is placed in four
 * bands out to roughly 0.22 units from a line, so this clears the buildings.
 */
const SKIRT = 0.3;

/** How far past the skirt the rim runs before it is gone. */
const FADE = 0.1;

/**
 * Where the dissolve begins, measured like the skirt. Inside this the plate is at full strength;
 * from here to SKIRT + FADE it eases to nothing.
 */
const SOLID = SKIRT * 0.55;

/**
 * Rings across the dissolve, split either side of the skirt. Vertex alpha interpolates linearly, so
 * the ease is drawn as this many straight pieces; six is past the point where the eye finds them.
 */
const RIM_STEPS = [3, 3];

/**
 * The river. A soft map blue, well short of the Blue Line's, laid into the plate at this opacity
 * where the plate is solid; like everything else on the plate it fades out with the rim.
 */
export const WATER_COLOUR = '#4F86C6';
export const WATER_ALPHA = 0.5;

/** Ink of every contact shadow. Neutral and near black, so it darkens without tinting. */
export const SHADOW_INK = '#22252B';

/** How far the shadows float above the plate. They never write depth; this only clears the sheet. */
export const SHADOW_LIFT = 0.0002;

/** Shadow under a track: opacity under its centreline, and how far out the strip reaches each side. */
export const TRACK_SHADOW_ALPHA = 0.22;
export const TRACK_SHADOW_HALF_WIDTH = 0.011;

/** Halo round a building's foot: opacity at the wall, and how far out it takes to reach nothing. */
export const BUILDING_SHADOW_ALPHA = 0.2;
export const BUILDING_SHADOW_REACH = 0.0055;

const UP = [0, 1, 0];
const smooth = (t) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

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
  let smoothed = raw;
  for (let pass = 0; pass < 2; pass++) {
    const next = new Array(SPOKES);
    for (let i = 0; i < SPOKES; i++) {
      let sum = 0;
      for (let k = -6; k <= 6; k++) sum += smoothed[(i + k + SPOKES) % SPOKES];
      next[i] = sum / 13;
    }
    smoothed = next;
  }
  return smoothed;
}

/** How much of the plate is left at `pad` units past the outermost track: 1 solid, 0 gone. */
const rim = (pad) => 1 - smooth((pad - SOLID) / (SKIRT + FADE - SOLID));

/** One flat triangle, wound so it faces up whichever way its corners run. */
function triUp(surface, a, b, c) {
  const p = surface.positions;
  const turn =
    (p[b * 3 + 2] - p[a * 3 + 2]) * (p[c * 3] - p[a * 3]) -
    (p[b * 3] - p[a * 3]) * (p[c * 3 + 2] - p[a * 3 + 2]);
  if (turn >= 0) surface.indices.push(a, b, c);
  else surface.indices.push(a, c, b);
}

function quadUp(surface, a, b, c, d) {
  triUp(surface, a, b, c);
  triUp(surface, a, c, d);
}

/**
 * Build the plate into `surface` and return the ground, which the tracks and the city then draw
 * their shadows onto. Call this before anything casts a shadow: the plate has to come first in the
 * index buffer for the shadows to blend over it.
 *
 * The outline is a hub and rings: the solid part out to its edge, then a short run of rings across
 * which the opacity eases to zero. Ring vertices are shared, so the fade is one continuous
 * gradient.
 */
export function groundPlate(surface, lines, y) {
  const centre = [0.02, 0];
  const reach = reaches(lines, centre);

  // Rings by how far past each spoke's reach they sit. The first is the edge of the solid part,
  // fanned straight from the hub; the rest step outward through the dissolve.
  const bands = [{ pad: SOLID }];
  for (let k = 1; k <= RIM_STEPS[0]; k++)
    bands.push({ pad: SOLID + ((SKIRT - SOLID) * k) / RIM_STEPS[0] });
  for (let k = 1; k <= RIM_STEPS[1]; k++)
    bands.push({ pad: SKIRT + (FADE * k) / RIM_STEPS[1] });

  const hub = surface.vertex([centre[0], y, centre[1]], UP, PLATE_COLOUR, undefined, PLATE_ALPHA);
  const rings = bands.map((band) =>
    Array.from({ length: SPOKES }, (_, i) => {
      const angle = (i / SPOKES) * Math.PI * 2;
      const r = reach[i] + band.pad;
      return surface.vertex(
        [centre[0] + Math.cos(angle) * r, y, centre[1] + Math.sin(angle) * r],
        UP,
        PLATE_COLOUR,
        undefined,
        PLATE_ALPHA * rim(band.pad),
      );
    }),
  );
  for (let i = 0; i < SPOKES; i++) {
    const j = (i + 1) % SPOKES;
    surface.indices.push(hub, rings[0][j], rings[0][i]);
    for (let b = 1; b < rings.length; b++)
      surface.indices.push(
        rings[b - 1][i], rings[b - 1][j], rings[b][j],
        rings[b - 1][i], rings[b][j], rings[b][i],
      );
  }

  /**
   * How much plate there is under a point, 1 on the solid part and 0 past the rim. A shadow is
   * multiplied by this, so nothing is left lying on the backdrop where the plate has dissolved.
   */
  const coverage = (x, z) => {
    const dx = x - centre[0];
    const dz = z - centre[1];
    const turn = ((Math.atan2(dz, dx) / TAU) * SPOKES + SPOKES) % SPOKES;
    const i = Math.floor(turn) % SPOKES;
    const f = turn - Math.floor(turn);
    const edge = reach[i] + (reach[(i + 1) % SPOKES] - reach[i]) * f;
    return rim(Math.hypot(dx, dz) - edge);
  };

  const level = y + SHADOW_LIFT;
  const ink = (x, z, alpha) =>
    surface.vertex([x, level, z], UP, SHADOW_INK, undefined, alpha * coverage(x, z));

  return {
    coverage,

    /**
     * Water, as `points` ([x, z]) and `triangles` over them (water.mjs). It is a tint in the sheet
     * itself, at the plate's own level, so call this before anything casts a shadow: the shadows
     * then fall across the water as they do across the ground.
     */
    water({ points, triangles }) {
      const cover = points.map(([x, z]) => coverage(x, z));
      const placed = new Map();
      const corner = (i) => {
        if (!placed.has(i))
          placed.set(i, surface.vertex([points[i][0], y, points[i][1]], UP, WATER_COLOUR, undefined, WATER_ALPHA * cover[i]));
        return placed.get(i);
      };
      for (const [a, b, c] of triangles) {
        // Past the rim there is no plate to tint, and nothing to draw.
        if (cover[a] + cover[b] + cover[c] === 0) continue;
        triUp(surface, corner(a), corner(b), corner(c));
      }
    },

    /**
     * The shadow of one track: a strip along its centreline, darkest under the middle of the
     * plate and falling to nothing at the strip's edge, with a rounded end so a terminus does not
     * cast a square.
     */
    trackShadow(points) {
      const wide = TRACK_SHADOW_HALF_WIDTH;
      const profile = [
        [-wide, 0],
        [0, TRACK_SHADOW_ALPHA],
        [wide, 0],
      ];
      const frames = points.map((point, i) => {
        const along = norm(
          sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]),
        );
        const flat = norm([along[0], 0, along[2]]);
        return { at: point, along: flat, side: [-flat[2], 0, flat[0]] };
      });
      const rows = frames.map(({ at, side }) =>
        profile.map(([offset, alpha]) =>
          ink(at[0] + side[0] * offset, at[2] + side[2] * offset, alpha),
        ),
      );
      for (let i = 1; i < rows.length; i++)
        for (let k = 1; k < profile.length; k++)
          quadUp(surface, rows[i - 1][k - 1], rows[i - 1][k], rows[i][k], rows[i][k - 1]);

      // Round ends: half a disc beyond each terminus, on the same falloff as the strip.
      const steps = 6;
      for (const [frame, sign] of [
        [frames[0], -1],
        [frames.at(-1), 1],
      ]) {
        const { at, along, side } = frame;
        const middle = ink(at[0], at[2], TRACK_SHADOW_ALPHA);
        const arc = Array.from({ length: steps + 1 }, (_, k) => {
          const a = -Math.PI / 2 + (Math.PI * k) / steps;
          const u = Math.cos(a) * wide * sign;
          const v = Math.sin(a) * wide;
          return ink(at[0] + along[0] * u + side[0] * v, at[2] + along[2] * u + side[2] * v, 0);
        });
        for (let k = 0; k < steps; k++) triUp(surface, middle, arc[k], arc[k + 1]);
      }
    },

    /**
     * The halo round a building: a band hugging its footprint, darkest against the wall. `outline`
     * is the footprint in plan, [x, z] corners in either winding.
     */
    footprintShadow(outline, reachOut = BUILDING_SHADOW_REACH, alpha = BUILDING_SHADOW_ALPHA) {
      const count = outline.length;
      let signed = 0;
      for (let i = 0; i < count; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % count];
        signed += a[0] * b[1] - b[0] * a[1];
      }
      const hand = signed < 0 ? -1 : 1;
      // Outward normal of each edge, then each corner pushed out along the mitre of its two edges.
      const normals = outline.map((a, i) => {
        const b = outline[(i + 1) % count];
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return [((b[1] - a[1]) / length) * hand, (-(b[0] - a[0]) / length) * hand];
      });
      const inner = [];
      const outer = [];
      for (let i = 0; i < count; i++) {
        const before = normals[(i + count - 1) % count];
        const after = normals[i];
        let mx = before[0] + after[0];
        let mz = before[1] + after[1];
        const length = Math.hypot(mx, mz);
        if (length < 1e-6) [mx, mz] = after;
        else [mx, mz] = [mx / length, mz / length];
        // A sharp corner would throw its mitre a long way out; capped so the halo stays a halo.
        const stretch = Math.min(2, 1 / Math.max(1e-6, mx * after[0] + mz * after[1]));
        const [x, z] = outline[i];
        inner.push(ink(x, z, alpha));
        outer.push(ink(x + mx * reachOut * stretch, z + mz * reachOut * stretch, 0));
      }
      for (let i = 0; i < count; i++) {
        const j = (i + 1) % count;
        quadUp(surface, inner[i], inner[j], outer[j], outer[i]);
      }
    },

    /** The halo round something circular standing on the plate, such as a station drum. */
    discShadow(x, z, radius, reachOut, alpha = BUILDING_SHADOW_ALPHA, sides = 24) {
      const ringAt = (r, a) =>
        Array.from({ length: sides }, (_, i) => {
          const turn = (i / sides) * TAU;
          return ink(x + Math.cos(turn) * r, z + Math.sin(turn) * r, a);
        });
      const inner = ringAt(radius, alpha);
      const outer = ringAt(radius + reachOut, 0);
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        quadUp(surface, inner[i], inner[j], outer[j], outer[i]);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// The flat maps' ground.
//
// The Contribute app draws the network on one rounded island. Its outline is measured the same
// polar way as the plate above: a reach per compass direction out of one centre, smoothed.

/** How far past the outermost track the solid ground reaches, and how far its rim then fades. */
const OUTLINE_SKIRT = 0.3;
const OUTLINE_FADE = 0.1;

/**
 * The ground seen from above, for the flat maps: `solid` is the edge of the lit ground and
 * `rim` is where it has faded into the backdrop. Both are rings of [x, z].
 */
export function groundOutline(lines) {
  const centre = [0.02, 0];
  const reach = reaches(lines, centre);
  const ring = (pad) =>
    reach.map((r, i) => {
      const angle = (i / SPOKES) * Math.PI * 2;
      return [centre[0] + Math.cos(angle) * (r + pad), centre[1] + Math.sin(angle) * (r + pad)];
    });
  return { solid: ring(OUTLINE_SKIRT), rim: ring(OUTLINE_SKIRT + OUTLINE_FADE) };
}
