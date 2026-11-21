import { computeTotalCost, MBTA_SUBWAY_FARE, ROUTE_COLORS, STOPS } from '@faresight/shared';

/**
 * The dishes the second section steps through.
 *
 * Master plan 5 is strict about this and it is worth honouring on the
 * marketing page too: prices, hours and portions are facts, recorded with the
 * date they were checked, and nothing is ever presented as verified when it
 * is not. None of the entries below have been to a restaurant yet, so every
 * one of them is marked unverified and the page says so on screen. When the
 * team has walked the venues, fill in `checkedOn` and flip `scale`.
 *
 * The stops are real, and so is the fare, which comes from the shared transit
 * constants rather than being retyped here.
 */

export type ScaleStatus = 'measured' | 'unverified';

export interface Dish {
  readonly id: string;
  readonly name: string;
  /** The line under the name, in the manner of the reference frame. */
  readonly description: string;
  readonly price: number;
  /** What you actually get. The thing a listing app will not tell you. */
  readonly portion: string;
  readonly venue: string;
  /** A stop_id from the shared STOPS list. */
  readonly stopId: string;
  readonly scale: ScaleStatus;
  /** ISO date the price was checked, or null while it is still a placeholder. */
  readonly checkedOn: string | null;
}

export const dishes: readonly Dish[] = [
  {
    id: 'tonkotsu',
    name: 'Tonkotsu Ramen',
    description: 'with chashu, soft egg and scallion',
    price: 16.0,
    portion: 'One bowl, about 500 ml. Enough on its own.',
    venue: 'Sample venue',
    stopId: 'place-bucen',
    scale: 'unverified',
    checkedOn: null,
  },
  {
    id: 'katsu',
    name: 'Katsu Curry',
    description: 'with short-grain rice and pickles',
    price: 14.5,
    portion: 'Plate, about 420 g. Most people finish it.',
    venue: 'Sample venue',
    stopId: 'place-brico',
    scale: 'unverified',
    checkedOn: null,
  },
  {
    id: 'banhmi',
    name: 'Grilled Pork Banh Mi',
    description: 'with pickled daikon, carrot and coriander',
    price: 9.75,
    portion: 'A 9-inch roll. One is a light lunch.',
    venue: 'Sample venue',
    stopId: 'place-chncl',
    scale: 'unverified',
    checkedOn: null,
  },
  {
    id: 'tiramisu',
    name: 'Matcha Tiramisu',
    description: 'with mascarpone and a dusting of matcha',
    price: 7.5,
    portion: 'A small square, about 110 g. Share it.',
    venue: 'Sample venue',
    stopId: 'place-harsq',
    scale: 'unverified',
    checkedOn: null,
  },
];

export interface DishCost {
  readonly price: number;
  readonly fare: number;
  readonly total: number;
}

/** Food plus the fare to go and get it, which is the whole pitch. */
export function costOf(dish: Dish): DishCost {
  return { price: dish.price, fare: MBTA_SUBWAY_FARE, total: computeTotalCost(dish.price) };
}

export interface DishStop {
  readonly name: string;
  readonly line: string;
  readonly color: string;
}

export function stopOf(dish: Dish): DishStop {
  const stop = STOPS.find((candidate) => candidate.stop_id === dish.stopId);
  if (!stop) throw new Error(`${dish.id}: unknown stop ${dish.stopId}`);
  const line = stop.lines[0] ?? 'Red';
  return {
    name: stop.name,
    line: line.startsWith('Green') ? 'Green Line' : `${line} Line`,
    color: ROUTE_COLORS[line] ?? ROUTE_COLORS.Red,
  };
}

export const money = (value: number) => '$' + value.toFixed(2);
