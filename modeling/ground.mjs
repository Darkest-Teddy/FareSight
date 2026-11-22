// The ground the network sits on.
//
// It is cut to the city: solid where buildings stand, fading out a short way past the last of
// them, and absent beyond that so the rails run on over nothing at the cleared ends of each line.
//
// The shape comes from a distance field rather than from a radius per compass direction. The
// earlier polar version measured one reach for each of 128 bearings out of a single centre, and
// that cannot hug a city: a reach spread even a few degrees to its neighbours bulges by a tenth of
// a unit at this radius, so the outline ballooned into an ellipse no matter how the skirt was
// tuned. Here every building is measured individually -- the ground exists wherever it is within
// REACH of any of them -- which is what makes the edge follow the blocks instead of circling them.
//
// The outline stays organic for free. A union of discs has no corners, and the rim is a gradient
// rather than a hard boundary, so no contour has to be extracted or triangulated: the field is
// sampled on a grid and written straight out as vertex colour.
import { face } from './geometry.mjs';

/** Must match studioBackdrop in web/src/xr/PlayCanvasApp.ts, or the rim will show a seam. */
const BACKDROP = '#151922';

/**
 * The lit ground under the middle of the network.
 *
 * Lighter than it used to be. The old tone was only a shade off the backdrop, which was fine when
 * the blob sprawled across most of the frame but leaves a tight one almost invisible: once the
 * ground hugs the buildings, contrast is the only thing telling you it is there.
 */
const GROUND = '#38425a';

/**
 * The ground is a morphological closing of the city: grown by GROW so the gaps between scattered
 * blocks seal into one surface, then shrunk back by nearly the same amount so the outer edge
 * returns to the buildings it came from.
 *
 * Doing only the growth leaves the edge GROW away from the last block, which is far too generous.
 * Doing only a small growth never seals the interior and the ground breaks into islands around
 * each building. Closing gets both: a continuous surface that still finishes a pavement's width
 * past the outermost block.
 */
const GROW = 0.085;
const KEEP = 0.018;

/** How far the rim then takes to dissolve into the backdrop. */
const FADE = 0.042;

/**
 * Grid step for sampling the field.
 *
 * The interior is one flat colour, so resolution only matters at the rim, where the fade spans a
 * couple of cells and the per-vertex gradient hides the rest.
 */
const STEP = 0.012;

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

/** Smooth, so the fade has no visible start or end. */
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Distance from a point to the nearest building's edge, negative inside one.
 *
 * Sites are bucketed by cell so each sample only tests the handful nearby; checking all of them
 * for every grid point is the one part of this that would actually be slow.
 */
function fieldSampler(sites) {
  const cell = 0.08;
  const buckets = new Map();
  const key = (i, j) => i + ':' + j;
  let span = 0;
  for (const site of sites) {
    span = Math.max(span, site[2]);
    const i = Math.floor(site[0] / cell);
    const j = Math.floor(site[1] / cell);
    const k = key(i, j);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(site);
  }
  // How many rings of cells can hold a site whose edge still reaches GROW from here.
  const rings = Math.ceil((GROW + span) / cell);

  return (x, z) => {
    const ci = Math.floor(x / cell);
    const cj = Math.floor(z / cell);
    let best = Infinity;
    for (let i = -rings; i <= rings; i++)
      for (let j = -rings; j <= rings; j++) {
        const here = buckets.get(key(ci + i, cj + j));
        if (!here) continue;
        for (const [sx, sz, radius] of here) {
          const d = Math.hypot(x - sx, z - sz) - radius;
          if (d < best) best = d;
        }
      }
    return best;
  };
}

/**
 * Build the ground into `surface`, which is shared with the city so this costs no extra draw call.
 */
export function groundBlob(surface, sites, y) {
  if (!sites.length) return 0;
  // The shrink step can only pull the edge back to where the growth put it.
  const erode = Math.max(0, GROW - KEEP);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z, radius] of sites) {
    minX = Math.min(minX, x - radius - GROW - STEP);
    maxX = Math.max(maxX, x + radius + GROW + STEP);
    minZ = Math.min(minZ, z - radius - GROW - STEP);
    maxZ = Math.max(maxZ, z + radius + GROW + STEP);
  }

  const distanceAt = fieldSampler(sites);
  const cols = Math.ceil((maxX - minX) / STEP) + 1;
  const rows = Math.ceil((maxZ - minZ) / STEP) + 1;
  const at = (c, r) => r * cols + c;

  // Distance from every grid vertex to the nearest building's edge.
  const field = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      field[at(c, r)] = distanceAt(minX + c * STEP, minZ + r * STEP);

  // The closing, done on the field itself rather than on a mask of it.
  //
  // A point survives if a disc of radius `erode` around it still lies entirely inside the grown
  // shape -- that is, if the largest distance-to-a-building anywhere in that disc is still within
  // GROW. So the test is a dilation of the field, and GROW minus that peak is how deep the point
  // sits inside the closed region.
  //
  // Thresholding the field into a grown/not-grown mask first, as this did before, throws away
  // everything between one grid step and the next: the boundary could then only land on a cell
  // edge, and the rim came out in visible squares before cutting off. Keeping the field
  // continuous means the depth varies smoothly across a cell and the vertex colours interpolate
  // over it.
  const stencil = [];
  const reach = Math.ceil(erode / STEP);
  for (let j = -reach; j <= reach; j++)
    for (let i = -reach; i <= reach; i++)
      if (Math.hypot(i, j) * STEP <= erode) stencil.push([i, j]);

  const depth = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      let peak = -Infinity;
      for (const [i, j] of stencil) {
        const cc = c + i;
        const rr = r + j;
        // Off the grid counts as infinitely far from any building, so the shape cannot leak out.
        const v = cc < 0 || cc >= cols || rr < 0 || rr >= rows ? Infinity : field[at(cc, rr)];
        if (v > peak) peak = v;
      }
      depth[at(c, r)] = GROW - peak;
    }

  // Solid once a vertex sits a full FADE inside the closed edge, dissolving to nothing at it.
  const tintAt = (d) => 1 - smoothstep(Math.max(0, Math.min(1, d / FADE)));
  const up = [0, 1, 0];
  let quads = 0;

  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const corners = [
        depth[at(c, r)],
        depth[at(c + 1, r)],
        depth[at(c + 1, r + 1)],
        depth[at(c, r + 1)],
      ];
      // Nothing to draw where every corner has already dissolved.
      if (corners.every((d) => d <= 0)) continue;

      const x0 = minX + c * STEP;
      const z0 = minZ + r * STEP;
      const points = [
        [x0, y, z0],
        [x0 + STEP, y, z0],
        [x0 + STEP, y, z0 + STEP],
        [x0, y, z0 + STEP],
      ];
      const colours = corners.map((d) => mixHex(GROUND, BACKDROP, tintAt(d)));
      const ids = points.map((point, i) => surface.vertex(point, up, colours[i]));
      surface.indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      quads++;
    }

  return quads;
}

// ---------------------------------------------------------------------------------------------
// The flat maps' ground.
//
// The Contribute app draws the network on one rounded island. That outline is still measured the
// polar way the 3D ground used to be: a reach per compass direction out of one centre, smoothed.
// It is deliberately simpler than the 3D ground above, which is cut to the buildings.

/** The point the outline is measured out from. */
const CENTRE = [0.02, 0];
/** Directions sampled around the centre. */
const SPOKES = 128;
/** How far past the outermost track the solid ground reaches, and how far its rim then fades. */
const OUTLINE_SKIRT = 0.3;
const OUTLINE_FADE = 0.1;

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
 * The ground seen from above, for the flat maps: `solid` is the edge of the lit ground and
 * `rim` is where it has faded into the backdrop. Both are rings of [x, z].
 */
export function groundOutline(lines) {
  const reach = reaches(lines, CENTRE);
  const ring = (pad) =>
    reach.map((r, i) => {
      const angle = (i / SPOKES) * Math.PI * 2;
      return [CENTRE[0] + Math.cos(angle) * (r + pad), CENTRE[1] + Math.sin(angle) * (r + pad)];
    });
  return { solid: ring(OUTLINE_SKIRT), rim: ring(OUTLINE_SKIRT + OUTLINE_FADE) };
}
