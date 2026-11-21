import { MBTA_SUBWAY_FARE, type Place, type Stop } from '@faresight/shared';

export const cravings = [
  ['all', 'All'], ['ramen', 'Ramen & Noodles'], ['cheap', 'Cheap Eats'], ['study', 'Study Cafes'],
  ['groups', 'Karaoke & Groups'], ['music', 'Live Music'], ['shops', 'Shops & Markets'], ['parks', 'Parks & Views'],
] as const;

export type Craving = typeof cravings[number][0];
export interface Filters {
  craving: Craving;
  maxBudget: number;
  startStopId: string;
  groupSize: number;
  familyVisit: boolean;
}
export const initialFilters: Filters = {
  craving: 'all', maxBudget: 50, startStopId: 'place-bucen', groupSize: 1, familyVisit: false,
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

export function placesAt(places: Place[], stop: Stop, filters: Filters) {
  return places.filter((place) => place.stop_id === stop.stop_id).sort((a, b) => {
    const fit = (place: Place) => Number(place.stated_capacity !== undefined && place.stated_capacity < filters.groupSize);
    return fit(a) - fit(b)
      || oneWayCost(a, filters.startStopId, filters.groupSize) - oneWayCost(b, filters.startStopId, filters.groupSize)
      || a.walk_from_stop_m - b.walk_from_stop_m;
  });
}
