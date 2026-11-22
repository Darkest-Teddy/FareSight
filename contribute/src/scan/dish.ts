// Geometry of the guided dish scan. Unlike the room scan, where the person turns on one spot, here
// the phone circles the dish and always points at it. Every photo is one stop on a ring round the
// dish, and how high the ring sits depends on the shape of what is being scanned.
import { MAX_DISH_PHOTOS } from '@faresight/shared';
import { direction, type Target } from './sphere';

export type DishShape = 'plate' | 'bowl' | 'drink';

export interface DishPlan {
  shape: DishShape;
  name: string;
  /** What counts as this shape, in a few examples. */
  examples: string;
  /**
   * The rings of stops, in the order they are taken: how steeply the phone looks down at the dish,
   * in degrees above the table, and how many stops go round. 90 is one photo from straight above.
   */
  rings: [elevation: number, stops: number][];
  /** The outline the dish is fitted in, as shares of the screen's short side: width, then height. */
  outline: [width: number, height: number];
  /** Where the ring round the dish sits in that outline: 0 at its middle, 1 at its bottom edge. */
  base: number;
}

// Every shape is scanned in two photos, the two that show the most of it. A flat plate shows most of
// itself from above, so it gets one photo at a slant and one from straight overhead. A bowl and a
// drink are mostly side, so they get one photo from each of two opposite sides: the bowl from higher
// up, where its filling shows, and the drink from near table level.
export const dishPlans: DishPlan[] = [
  { shape: 'plate', name: 'Flat plate', examples: 'Pasta, pizza, salad, sushi', rings: [[50, 1], [90, 1]], outline: [0.74, 0.46], base: 0.1 },
  { shape: 'bowl', name: 'Bowl or tall dish', examples: 'Ramen, burger, cake, poke', rings: [[40, 2]], outline: [0.64, 0.56], base: 0.5 },
  { shape: 'drink', name: 'Drink or bottle', examples: 'Coffee, bubble tea, cocktail', rings: [[20, 2]], outline: [0.42, 0.78], base: 0.82 },
];

/** How steeply a stop looks down at the dish, in degrees above the table. */
export const elevationOf = (target: Target) => -target.pitch;

/** The stops for a dish of this shape, first ring first, starting from where the phone points now. */
export function createDishTargets(startYaw: number, plan: DishPlan): Target[] {
  const targets: Target[] = [];
  for (const [ring, [elevation, stops]] of plan.rings.entries()) {
    for (let index = 0; index < stops; index++) {
      const yaw = index * 360 / stops;
      targets.push({ yaw, pitch: -elevation, ring, direction: direction(startYaw + yaw, -elevation) });
    }
  }
  return targets.slice(0, MAX_DISH_PHOTOS);
}
