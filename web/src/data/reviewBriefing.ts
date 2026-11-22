import { computeTripEstimate, formatDishPrice, type Dish, type LiveReviewsResponse, type MbtaSource, type Place, type Stop } from '@faresight/shared';
import { api, type Alert, type Prediction } from '../api/client';
import { oneWayCost, type Filters } from '../ui/state';
import { has3D, has3DRoom, hasDishPreview, isSplat } from './preview3D';

export interface BriefingFact { label: string; value: string }
export interface BriefingReview {
  placeId?: string; placeName?: string; author: string; text: string; sample?: boolean; unverified?: boolean;
  live?: boolean; source?: string; rating?: number; date_label?: string; url?: string;
}
export type ReviewSnapshot = Omit<BriefingReview, 'author' | 'placeId' | 'placeName'> &
  { id: string; author_label: string; created_at: string; sample: boolean };

export function catalogReviewSnapshots(place: Place): ReviewSnapshot[] {
  return place.reviews.map(({ id, author, text, created_at, sample }) =>
    ({ id, author_label: author, text, created_at, sample: !!sample }));
}

export function reviewFacts(facts: Place['details'] | null, web?: LiveReviewsResponse) {
  const catalogRatings = facts?.ratings ?? [];
  const ratings = new Map(catalogRatings.map((rating) => [rating.source.toLowerCase(), rating]));
  if (web?.live) {
    for (const rating of web.ratings ?? []) {
      if (typeof rating.source !== 'string' || !rating.source.trim()) continue;
      const key = rating.source.trim().toLowerCase();
      const previous = ratings.get(key);
      ratings.set(key, { ...rating, rating: Number.isFinite(rating.rating) ? rating.rating : previous?.rating ?? NaN,
        count: rating.count ?? previous?.count ?? null, url: rating.url || previous?.url || null });
    }
  }
  return {
    ratings: [...ratings.values()].filter(({ rating }) => Number.isFinite(rating)),
    highlights: web?.live && web.highlights?.length ? web.highlights : facts?.review_highlights ?? [],
  };
}

const liveLookups = new Map<string, Promise<LiveReviewsResponse>>();

export function loadLiveReviews(placeId: string): Promise<LiveReviewsResponse> {
  const active = liveLookups.get(placeId);
  if (active) return active;
  const lookup = api.liveReviews(placeId).finally(() => liveLookups.delete(placeId));
  liveLookups.set(placeId, lookup);
  return lookup;
}
export interface BriefingListItem { label: string; detail?: string; badge?: string; url?: string }
export interface BriefingComparison {
  placeId?: string; name: string; subtitle?: string; metrics: BriefingFact[]; note?: string;
}
export type BriefingSection = { heading?: string } & (
  | { kind: 'text'; body: string }
  | { kind: 'reviews'; items: BriefingReview[] }
  | { kind: 'list'; items: BriefingListItem[] }
  | { kind: 'comparison'; items: BriefingComparison[] }
);
export type BriefingAction = { label: string } & (
  | { kind: 'venue'; placeId: string }
  | { kind: 'map'; stopId: string }
  | { kind: 'dish'; placeId: string; dishId: string }
  | { kind: 'compare-dishes'; placeId: string; dishId: string; comparePlaceId: string; compareDishId: string }
);
export interface BriefingCard {
  id: string;
  kicker?: string;
  title: string;
  subtitle?: string;
  facts?: BriefingFact[];
  sections: BriefingSection[];
  actions?: BriefingAction[];
}
export type BriefingMode = 'add' | 'replace';
export const maxBriefingCards = 4;

export interface PlaceDecision {
  id: string;
  name: string;
  stop: Stop;
  category: Place['category'];
  vibe: string;
  familyFriendly: boolean;
  eveningVenue: boolean;
  openNow: boolean;
  hours: Place['hours'];
  hoursToday: string;
  priceCheckedOn: string;
  has3D: boolean;
  has3DRoom: boolean;
  statedCapacity: number | null;
  trip: {
    fromStopId: string; typicalPrice: number; costBasis: string; oneWayFare: number; roundTripFare: number;
    oneWayTotal: number; roundTripTotal: number; walkMeters: number; walkMinutes: number; rideMinutes: number;
  };
  transit: {
    source: MbtaSource | 'checking' | 'unavailable'; arrivals: Prediction[]; alerts: Alert[];
    alertsAvailable: boolean;
  };
  dishes: (Pick<Dish, 'id' | 'name' | 'price'> & { priceLabel: string; portionNote: string; has3D: boolean })[];
  rooms: { name: string; statedCapacity: number; seating: string; price: number; priceUnit: string; has3D: boolean }[];
  reviews: ReviewSnapshot[];
  /** Researched public facts: hours note, awards, aggregate ratings and review highlights. */
  details: Place['details'] | null;
}

const week = [
  ['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'],
  ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'],
] as const;

const bostonClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});

function minutes(clock: string) {
  const [hour, minute] = clock.split(':').map(Number);
  return hour * 60 + minute;
}

function shortTime(clock: string) {
  const [hour, minute] = clock.split(':').map(Number);
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour % 24 < 12 ? 'AM' : 'PM'}`;
}

function formatHours(hours: [string, string] | undefined): string {
  return hours ? `${shortTime(hours[0])}–${shortTime(hours[1])}` : 'Closed';
}

function bostonHours(hours: Place['hours'], now: Date) {
  const parts = bostonClock.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const index = week.findIndex(([day]) => day === part('weekday').toLowerCase());
  const today = hours[week[index][0]];
  const previous = hours[week[(index + 6) % 7][0]];
  const local = Number(part('hour')) * 60 + Number(part('minute'));
  const overnight = previous && minutes(previous[1]) < minutes(previous[0]) && local < minutes(previous[1]);
  const openNow = !!overnight || !!(today && local >= minutes(today[0]) &&
    (minutes(today[1]) <= minutes(today[0]) || local < minutes(today[1])));
  return { openNow, hoursToday: formatHours(overnight ? previous : today) };
}

function placeDecision(place: Place, stop: Stop, filters: Filters, now = new Date()): PlaceDecision {
  const trip = computeTripEstimate({ from_stop_id: filters.startStopId, to_stop_id: stop.stop_id, walk_from_stop_m: place.walk_from_stop_m });
  const hourly = place.rooms.some((room) => /hour/i.test(room.price_unit));
  const total = oneWayCost(place, filters.startStopId);
  const capacity = place.stated_capacity ?? Math.max(0, ...place.rooms.map((room) => room.stated_capacity));
  return {
    id: place.id, name: place.name, stop, category: place.category, vibe: place.vibe,
    familyFriendly: place.family_friendly, eveningVenue: place.evening_venue,
    ...bostonHours(place.hours, now), hours: place.hours, priceCheckedOn: place.price_checked_on,
    has3D: has3D(place), has3DRoom: has3DRoom(place), statedCapacity: capacity || null,
    trip: {
      fromStopId: filters.startStopId, typicalPrice: place.typical_price,
      costBasis: hourly ? 'One hour of room hire' : 'Typical spend per person',
      oneWayFare: trip.fare, roundTripFare: trip.round_trip_fare,
      oneWayTotal: Number(total.toFixed(2)), roundTripTotal: Number((total + trip.fare).toFixed(2)),
      walkMeters: place.walk_from_stop_m, walkMinutes: Number(trip.walk_to_venue_min.toFixed(1)), rideMinutes: trip.ride_min,
    },
    transit: { source: 'checking', arrivals: [], alerts: [], alertsAvailable: false },
    dishes: place.dishes.map((dish) => ({
      id: dish.id, name: dish.name, price: dish.price, priceLabel: formatDishPrice(dish.price),
      portionNote: dish.portion_note, has3D: hasDishPreview(dish),
    })),
    rooms: place.rooms.map((room) => ({
      name: room.name, statedCapacity: room.stated_capacity, seating: room.seating, price: room.price,
      priceUnit: room.price_unit, has3D: !!room.asset_id || isSplat(room.asset),
    })),
    reviews: catalogReviewSnapshots(place),
    details: place.details ?? null,
  };
}

export async function loadPlaceDecision(place: Place, stop: Stop, filters: Filters): Promise<PlaceDecision> {
  const [fresh, predictions, alerts] = await Promise.allSettled([api.place(place.id), api.predictions(stop.stop_id), api.alerts()]);
  const details = placeDecision(fresh.status === 'fulfilled' ? fresh.value : place, stop, filters);
  details.transit = {
    source: predictions.status === 'fulfilled' ? predictions.value.source : 'unavailable',
    arrivals: predictions.status === 'fulfilled' ? predictions.value.predictions.filter(({ arrival_min }) => arrival_min !== null)
      .sort((a, b) => a.arrival_min! - b.arrival_min!).slice(0, 5) : [],
    alerts: alerts.status === 'fulfilled' ? alerts.value.filter((alert) => alert.stop_ids.includes(stop.stop_id)
      || alert.route_ids.some((route) => stop.lines.includes(route)) || (!alert.stop_ids.length && !alert.route_ids.length)) : [],
    alertsAvailable: alerts.status === 'fulfilled',
  };
  return details;
}

export function nextTrainLabel({ source, arrivals }: PlaceDecision['transit']): string {
  const next = arrivals[0]?.arrival_min;
  if (next != null) return `${next === 0 ? 'Due' : `${next} min`}${source === 'simulated' ? ' · estimate' : ''}`;
  return source === 'checking' ? 'Checking…' : source === 'unavailable' ? 'Unavailable' : 'No timed arrivals';
}
