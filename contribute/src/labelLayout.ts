/** A stop on screen, in pixels, and the size of the label that names it. */
export interface LabelSpot { x: number; y: number; w: number; h: number }
/** Where a label goes: its centre measured from its stop, and how far it stands off the node. */
export interface LabelPlace { dx: number; dy: number; gap: number }
export interface Rect { left: number; top: number; right: number; bottom: number }

interface LayoutOptions {
  /** Radius of a stop's node. */
  radius: number;
  /** Labels stay inside this. */
  bounds: Rect;
  /** Things floating over the map that a label must not sit under. */
  blocked: Rect[];
  /** x, y pairs along the drawn lines. Labels would rather not cover them. */
  tracks: number[];
}

type Segment = [number, number, number, number];
interface Candidate extends LabelPlace {
  rect: Rect;
  /** The line back to the stop when the label stands off: from the node's centre to the label's nearest edge. */
  lead?: Segment;
  cost: number;
}

/** A label closer than this to its node needs no line back to it. */
export const LEAD_FROM = 12;
// How far off its node a label may stand, nearest first, and the directions it may stand in.
const GAPS = [5, 20, 38, 60, 86, 116, 150];
const DIRECTIONS = Array.from({ length: 16 }, (_, index) => {
  const angle = index / 16 * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)] as const;
});
// Anything that makes a label unreadable outweighs every preference added together.
const UNREADABLE = 100_000;
const CROSSING = 2_500;
const MISLEADING = 300;
// Stops within this many pixels of each other count as neighbours.
const NEIGHBOUR = 120;
const TOWARD_NEIGHBOUR = 120;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const overlaps = (a: Rect, b: Rect, margin = 0) =>
  a.left < b.right + margin && a.right > b.left - margin && a.top < b.bottom + margin && a.bottom > b.top - margin;
const nearest = (rect: Rect, x: number, y: number) => [clamp(x, rect.left, rect.right), clamp(y, rect.top, rect.bottom)] as const;

function reaches(rect: Rect, x: number, y: number, radius: number) {
  const [px, py] = nearest(rect, x, y);
  return Math.hypot(px - x, py - y) < radius;
}

/** Whether the line from a to b comes within `reach` of a point. */
function passes([ax, ay, bx, by]: Segment, px: number, py: number, reach: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(ax + dx * t - px, ay + dy * t - py) < reach;
}

function crossesRect([ax, ay, bx, by]: Segment, rect: Rect) {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 3));
  for (let step = 0; step <= steps; step++) {
    const x = ax + (bx - ax) * step / steps;
    const y = ay + (by - ay) * step / steps;
    if (x > rect.left && x < rect.right && y > rect.top && y < rect.bottom) return true;
  }
  return false;
}

function cross(a: Segment, b: Segment) {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
    Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  return side(a[0], a[1], a[2], a[3], b[0], b[1]) !== side(a[0], a[1], a[2], a[3], b[2], b[3])
    && side(b[0], b[1], b[2], b[3], a[0], a[1]) !== side(b[0], b[1], b[2], b[3], a[2], a[3]);
}

/** What two labels cost each other: sharing space, or one's line running through the other. */
function clash(a: Candidate, b: Candidate) {
  let cost = 0;
  if (overlaps(a.rect, b.rect, 4)) cost += UNREADABLE;
  if (a.lead && crossesRect(a.lead, b.rect)) cost += CROSSING;
  if (b.lead && crossesRect(b.lead, a.rect)) cost += CROSSING;
  if (a.lead && b.lead && cross(a.lead, b.lead)) cost += CROSSING;
  return cost;
}

function candidates(spot: LabelSpot, index: number, spots: LabelSpot[], { radius, bounds, blocked, tracks }: LayoutOptions) {
  const list: Candidate[] = [];
  for (const gap of GAPS) {
    DIRECTIONS.forEach(([ux, uy], direction) => {
      // Far enough along this direction for the label's edge to clear the node by the gap.
      const reach = Math.min(spot.w / 2 / Math.max(Math.abs(ux), 1e-9), spot.h / 2 / Math.max(Math.abs(uy), 1e-9));
      let dx = ux * (radius + gap + reach);
      let dy = uy * (radius + gap + reach);
      // A label that would run off the map slides back in along its edge.
      dx += Math.max(0, bounds.left - (spot.x + dx - spot.w / 2)) - Math.max(0, spot.x + dx + spot.w / 2 - bounds.right);
      dy += Math.max(0, bounds.top - (spot.y + dy - spot.h / 2)) - Math.max(0, spot.y + dy + spot.h / 2 - bounds.bottom);
      const rect = {
        left: spot.x + dx - spot.w / 2, right: spot.x + dx + spot.w / 2,
        top: spot.y + dy - spot.h / 2, bottom: spot.y + dy + spot.h / 2,
      };
      const lead: Segment | undefined = gap >= LEAD_FROM ? [spot.x, spot.y, ...nearest(rect, spot.x, spot.y)] : undefined;

      // Close to the node is best, and straight up, down or sideways reads a little cleaner.
      // Each step further off costs more than the last: a label far from its stop is hardly its label.
      let cost = gap * 2 + gap * gap / 40 + (direction % 4 ? 2 : 0);
      if (blocked.some((box) => overlaps(rect, box, 4))) cost += UNREADABLE;
      spots.forEach((other, at) => {
        if (reaches(rect, other.x, other.y, radius + 3)) cost += UNREADABLE;
        if (at === index) return;
        // Between two close stops nobody can tell whose label it is, so labels lean away from their neighbours.
        const apart = Math.hypot(other.x - spot.x, other.y - spot.y);
        const toward = (ux * (other.x - spot.x) + uy * (other.y - spot.y)) / (apart || 1);
        if (apart < NEIGHBOUR) cost += TOWARD_NEIGHBOUR * Math.max(0, toward) * (1 - apart / NEIGHBOUR);
        if (lead && passes(lead, other.x, other.y, radius + 2)) cost += CROSSING;
        // A label that sits nearer to another stop than to its own reads as that stop's name.
        else if (reaches(rect, other.x, other.y, radius + gap + 4)) cost += MISLEADING;
      });
      let covered = 0;
      for (let i = 0; i < tracks.length; i += 2) {
        if (tracks[i] > rect.left && tracks[i] < rect.right && tracks[i + 1] > rect.top && tracks[i + 1] < rect.bottom) covered++;
      }
      // Staying next to its stop matters more to a label than keeping off the tracks.
      cost += Math.min(covered, 8) * 5;
      list.push({ dx, dy, gap, rect, lead, cost });
    });
  }
  return list;
}

/**
 * Places every stop's label where it can be read: clear of the other labels, of every node and of
 * the controls floating over the map, as close to its own stop as that allows.
 *
 * Each label picks the cheapest spot given the others, most crowded stop first, then all of them
 * get to reconsider, alone and in neighbouring pairs, until nobody moves. A few starting orders are
 * tried and the best result kept.
 */
export function placeLabels(spots: LabelSpot[], options: LayoutOptions): LabelPlace[] {
  const choices = spots.map((spot, index) => candidates(spot, index, spots, options));
  const crowd = spots.map((spot) => spots.filter((other) => Math.hypot(other.x - spot.x, other.y - spot.y) < NEIGHBOUR).length);
  const byIndex = spots.map((_, index) => index);
  const orders = [
    [...byIndex].sort((a, b) => crowd[b] - crowd[a]),
    [...byIndex].sort((a, b) => spots[a].x - spots[b].x),
    [...byIndex].sort((a, b) => spots[b].x - spots[a].x),
    [...byIndex].sort((a, b) => spots[a].y - spots[b].y),
  ];

  let best: { picks: Candidate[]; cost: number } | undefined;
  for (const order of orders) {
    const picks: (Candidate | undefined)[] = spots.map(() => undefined);
    const settle = (index: number) => {
      let winner = choices[index][0];
      let lowest = Infinity;
      for (const candidate of choices[index]) {
        let cost = candidate.cost;
        for (let other = 0; other < picks.length && cost < lowest; other++) {
          const pick = picks[other];
          if (pick && other !== index) cost += clash(candidate, pick);
        }
        if (cost < lowest) {
          lowest = cost;
          winner = candidate;
        }
      }
      const moved = picks[index] !== winner;
      picks[index] = winner;
      return moved;
    };
    // What each of a label's spots costs against everyone but one neighbour.
    const against = (index: number, skip: number) => choices[index].map((candidate) => {
      let cost = candidate.cost;
      picks.forEach((pick, other) => {
        if (pick && other !== index && other !== skip) cost += clash(candidate, pick);
      });
      return cost;
    });
    // Two neighbours can each be stuck in the other's way, so close pairs also get to move together.
    const settlePair = (a: number, b: number) => {
      const costA = against(a, b);
      const costB = against(b, a);
      const pickA = picks[a]!;
      const pickB = picks[b]!;
      let lowest = costA[choices[a].indexOf(pickA)] + costB[choices[b].indexOf(pickB)] + clash(pickA, pickB) - 0.001;
      let moved = false;
      choices[a].forEach((candidateA, i) => {
        if (costA[i] >= lowest) return;
        choices[b].forEach((candidateB, j) => {
          if (costA[i] + costB[j] >= lowest) return;
          const cost = costA[i] + costB[j] + clash(candidateA, candidateB);
          if (cost >= lowest) return;
          lowest = cost;
          picks[a] = candidateA;
          picks[b] = candidateB;
          moved = true;
        });
      });
      return moved;
    };
    order.forEach(settle);
    for (let round = 0; round < 6; round++) {
      let moved = order.map(settle).some(Boolean);
      for (let a = 0; a < spots.length; a++) {
        for (let b = a + 1; b < spots.length; b++) {
          if (Math.hypot(spots[a].x - spots[b].x, spots[a].y - spots[b].y) < NEIGHBOUR * 2 && settlePair(a, b)) moved = true;
        }
      }
      if (!moved) break;
    }
    const placed = picks as Candidate[];
    let cost = 0;
    placed.forEach((pick, index) => {
      cost += pick.cost;
      for (let other = index + 1; other < placed.length; other++) cost += clash(pick, placed[other]);
    });
    if (!best || cost < best.cost) best = { picks: placed, cost };
  }
  return (best?.picks ?? []).map(({ dx, dy, gap }) => ({ dx, dy, gap }));
}
