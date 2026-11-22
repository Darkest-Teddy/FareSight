import { CRAVING_FILTERS as cravings, MBTA_SUBWAY_FARE, type Place } from '@faresight/shared';

export { cravings };

export type Craving = typeof cravings[number][0];
/**
 * The menu only offers the start stop and the budget. Craving, group size and family visit have no
 * control on screen: the voice assistant sets them, and they stay at their defaults otherwise.
 */
export interface Filters {
  craving: Craving;
  maxBudget: number;
  startStopId: string;
  groupSize: number;
  familyVisit: boolean;
}
export const budgetRange = { min: 8, max: 50 } as const;
export const initialFilters: Filters = {
  craving: 'all', maxBudget: budgetRange.max, startStopId: 'place-bucen', groupSize: 1, familyVisit: false,
};

export function oneWayCost(place: Place, startStopId: string, groupSize = 1) {
  const room = place.rooms.find((entry) => /hour/i.test(entry.price_unit));
  return (room ? room.price / groupSize : place.typical_price)
    + (place.stop_id === startStopId ? 0 : MBTA_SUBWAY_FARE);
}

const matchCraving: Record<Craving, (place: Place) => boolean> = {
  all: () => true,
  ramen: (place) => place.cravings.some((craving) => /ramen|noodles/i.test(craving)),
  cheap: (place) => ['restaurant', 'study', 'market'].includes(place.category) && place.typical_price <= 15,
  study: (place) => place.category === 'study',
  groups: (place) => place.rooms.length > 0 || place.cravings.some((craving) => /karaoke|groups/i.test(craving)),
  music: (place) => place.category === 'music',
  shops: (place) => ['shop', 'market'].includes(place.category),
  parks: (place) => place.category === 'outdoor',
};

export function matchingPlaces(places: Place[], filters: Filters) {
  return places.filter((place) => (
    (!filters.familyVisit || place.family_friendly)
    && oneWayCost(place, filters.startStopId, filters.groupSize) <= filters.maxBudget
    && matchCraving[filters.craving](place)
  ));
}

/** Whether any filter differs from its default, including the ones only the voice assistant can set. */
export function filtersNarrowed(filters: Filters) {
  return filters.maxBudget < budgetRange.max || filters.craving !== 'all' || filters.groupSize !== 1 || filters.familyVisit;
}
