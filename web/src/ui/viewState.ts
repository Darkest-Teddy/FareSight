import type { Asset, Dish, Place } from '@faresight/shared';

export type Seating = 'seated' | 'standing';

/** Something fetched for the current view: the data, why it is missing, or a bundled stand-in. */
export interface Load<T> {
  data?: T;
  error?: string;
  offline?: boolean;
}

/** The second dish on the table in a side-by-side comparison. */
export interface DishComparison {
  place: Place;
  dish: Dish;
  asset: Asset;
  offline?: boolean;
}
