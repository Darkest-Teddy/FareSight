import type { SlabSpec } from './Shell';

/**
 * The living room, described as the pieces it will break into.
 *
 * Proportions follow the reference capture: a panelled room with a waist-high
 * wainscot under a picture rail, tall windows reaching most of the way to the
 * ceiling, and a plank floor. Those divisions are not decoration. They are
 * where a real room would come apart, so letting the panelling decide the
 * break lines is what keeps the pieces reading as architecture instead of as
 * a wall that has been diced into a grid.
 *
 * Room space has the camera near the origin facing -Z, so the wall at -Z is
 * the one in view for most of the first section.
 */

/** Metres. */
const halfWidth = 3.5;
const halfDepth = 3.5;
const height = 3.2;
const thickness = 0.12;

/** Height of the wainscot, and of the rail that caps it. */
const wainscotTop = 0.95;
const railHeight = 0.07;

type Axis = 'x' | 'z';

interface WallOptions {
  /** Which axis the wall runs along. */
  readonly along: Axis;
  /** Offset on the other axis: the wall's distance from the middle. */
  readonly offset: number;
  /** Panels across the wall. */
  readonly bays: number;
  /**
   * Bays left open as windows, by index. The upper panel is omitted and the
   * daylight behind the room comes through.
   */
  readonly openBays?: readonly number[];
}

/** Places a slab, mapping (across, up) in the wall's own plane into room space. */
function slab(options: WallOptions, across: number, up: number, width: number, tall: number, surface: string): SlabSpec {
  const position: [number, number, number] = options.along === 'x'
    ? [across, up, options.offset]
    : [options.offset, up, across];
  const size: [number, number, number] = options.along === 'x'
    ? [width, tall, thickness]
    : [thickness, tall, width];
  return { position, size, surface };
}

function wall(options: WallOptions): SlabSpec[] {
  const span = (options.along === 'x' ? halfWidth : halfDepth) * 2;
  const bayWidth = span / options.bays;
  const open = new Set(options.openBays ?? []);
  const pieces: SlabSpec[] = [];

  for (let bay = 0; bay < options.bays; bay += 1) {
    const centre = -span / 2 + bayWidth * (bay + 0.5);
    // A hair of overlap, so the joins do not show a seam of daylight before
    // the room has any business letting daylight in.
    const width = bayWidth * 1.01;

    pieces.push(slab(options, centre, wainscotTop / 2, width, wainscotTop, 'wall'));
    pieces.push(slab(options, centre, wainscotTop + railHeight / 2, width, railHeight, 'rail'));

    if (open.has(bay)) {
      // A window bay keeps only its head, so the opening reads as a window
      // rather than as a missing panel.
      const headHeight = 0.28;
      pieces.push(slab(options, centre, height - headHeight / 2, width, headHeight, 'wall'));
      continue;
    }

    const upperBase = wainscotTop + railHeight;
    pieces.push(slab(options, centre, (upperBase + height) / 2, width, height - upperBase, 'wall'));
  }
  return pieces;
}

/** Floor planks. They run along X, so they peel off in strips front to back. */
function floor(strips: number): SlabSpec[] {
  const stripDepth = (halfDepth * 2) / strips;
  const pieces: SlabSpec[] = [];
  for (let i = 0; i < strips; i += 1) {
    pieces.push({
      position: [0, -thickness / 2, -halfDepth + stripDepth * (i + 0.5)],
      size: [halfWidth * 2, thickness, stripDepth * 1.01],
      surface: 'floor',
    });
  }
  return pieces;
}

/**
 * The chimney breast on the facing wall. The reference has one, and it gives
 * the break-up a piece with real mass among all the flat panels.
 */
const chimney: SlabSpec[] = [
  { position: [0, 1.1, -halfDepth + 0.3], size: [1.5, 2.2, 0.45], surface: 'wall' },
  { position: [0, 2.26, -halfDepth + 0.36], size: [1.9, 0.12, 0.6], surface: 'rail' },
];

export const homeSlabs: readonly SlabSpec[] = [
  // Facing wall. No windows: it carries the chimney breast instead.
  ...wall({ along: 'x', offset: -halfDepth, bays: 5 }),
  // Side walls, each with two window bays letting the daylight in.
  ...wall({ along: 'z', offset: -halfWidth, bays: 5, openBays: [1, 3] }),
  ...wall({ along: 'z', offset: halfWidth, bays: 5, openBays: [1, 3] }),
  // Wall behind the camera. Fewer bays; it is barely seen before it leaves.
  ...wall({ along: 'x', offset: halfDepth, bays: 4 }),
  ...chimney,
  ...floor(6),
];

export const homeRoom = { halfWidth, halfDepth, height };
