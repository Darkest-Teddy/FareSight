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
const GROUND = '#272f3e';

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
const FADE = 0.028;

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

  // Grow: every vertex within GROW of a building. This is the sealed, over-generous shape.
  const grown = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      grown[at(c, r)] = distanceAt(minX + c * STEP, minZ + r * STEP) <= GROW ? 1 : 0;

  // Shrink: how far each vertex is from the nearest point outside that shape. Vertices deep
  // inside keep a large clearance; ones near the grown edge lose it, which is what walks the
  // boundary back in towards the buildings.
  const window = Math.ceil((erode + FADE) / STEP) + 1;
  const clearance = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (!grown[at(c, r)]) continue;
      let best = Infinity;
      for (let j = -window; j <= window; j++) {
        const rr = r + j;
        if (rr < 0 || rr >= rows) continue;
        for (let i = -window; i <= window; i++) {
          const cc = c + i;
          // Outside the grid counts as outside the shape, so the edge cannot leak off it.
          const outside = cc < 0 || cc >= cols || !grown[at(cc, rr)];
          if (!outside) continue;
          const d = Math.hypot(i, j) * STEP;
          if (d < best) best = d;
        }
      }
      clearance[at(c, r)] = best;
    }

  // Solid once a vertex clears the erode depth; dissolving over the FADE just inside that.
  const tintAt = (d) =>
    1 - smoothstep(Math.max(0, Math.min(1, (d - (erode - FADE)) / FADE)));
  const up = [0, 1, 0];
  let quads = 0;

  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols - 1; c++) {
      const corners = [
        clearance[at(c, r)],
        clearance[at(c + 1, r)],
        clearance[at(c + 1, r + 1)],
        clearance[at(c, r + 1)],
      ];
      // Nothing to draw where every corner has already dissolved.
      if (corners.every((d) => d <= erode - FADE)) continue;

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
