import { CRAVING_FILTERS as cravings, MBTA_SUBWAY_FARE, type Place } from '@faresight/shared';

export { cravings };

/** The whole filter model: where the trip starts and what it may cost per person, fare included. */
export interface Filters {
  maxBudget: number;
  startStopId: string;
}
export const budgetRange = { min: 8, max: 50 } as const;
export const initialFilters: Filters = { maxBudget: budgetRange.max, startStopId: 'place-bucen' };

export function oneWayCost(place: Place, startStopId: string) {
  const room = place.rooms.find((entry) => /hour/i.test(entry.price_unit));
  return (room ? room.price : place.typical_price)
    + (place.stop_id === startStopId ? 0 : MBTA_SUBWAY_FARE);
}

export function matchingPlaces(places: Place[], filters: Filters) {
  return places.filter((place) => oneWayCost(place, filters.startStopId) <= filters.maxBudget);
}

/** Cravings are no longer a filter. The voice assistant still searches the catalog by them. */
export type Craving = typeof cravings[number][0];
const cravingTests: Record<Craving, (place: Place) => boolean> = {
  all: () => true,
  ramen: (place) => place.cravings.some((craving) => /ramen|noodles/i.test(craving)),
  cheap: (place) => ['restaurant', 'study', 'market'].includes(place.category) && place.typical_price <= 15,
  study: (place) => place.category === 'study',
  groups: (place) => place.rooms.length > 0 || place.cravings.some((craving) => /karaoke|groups/i.test(craving)),
  music: (place) => place.category === 'music',
  shops: (place) => ['shop', 'market'].includes(place.category),
  parks: (place) => place.category === 'outdoor',
};
export const matchesCraving = (place: Place, craving: Craving) => cravingTests[craving](place);
