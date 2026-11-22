import { computeTripEstimate, formatDishPrice, type Dish, type LiveReviewItem, type LiveReviewsResponse, type MbtaSource, type Place, type Stop } from '@faresight/shared';
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

export function liveBriefingReview(review: LiveReviewItem): BriefingReview {
  return { ...review, live: true, sample: false, unverified: false };
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
  groupSize: number;
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

export const week = [
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

export function formatHours(hours: [string, string] | undefined): string {
  return hours ? `${shortTime(hours[0])}–${shortTime(hours[1])}` : 'Closed';
}

export function bostonHours(hours: Place['hours'], now: Date) {
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

export function placeDecision(place: Place, stop: Stop, filters: Filters, now = new Date()): PlaceDecision {
  const trip = computeTripEstimate({ from_stop_id: filters.startStopId, to_stop_id: stop.stop_id, walk_from_stop_m: place.walk_from_stop_m });
  const hourly = place.rooms.some((room) => /hour/i.test(room.price_unit));
  const total = oneWayCost(place, filters.startStopId, filters.groupSize);
  const capacity = place.stated_capacity ?? Math.max(0, ...place.rooms.map((room) => room.stated_capacity));
  return {
    id: place.id, name: place.name, stop, category: place.category, vibe: place.vibe,
    familyFriendly: place.family_friendly, eveningVenue: place.evening_venue,
    ...bostonHours(place.hours, now), hours: place.hours, priceCheckedOn: place.price_checked_on,
    has3D: has3D(place), has3DRoom: has3DRoom(place), statedCapacity: capacity || null, groupSize: filters.groupSize,
    trip: {
      fromStopId: filters.startStopId, typicalPrice: place.typical_price,
      costBasis: hourly ? `One hour of room hire split ${filters.groupSize} ways` : 'Typical spend per person',
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

const money = (amount: number) => `$${amount.toFixed(2)}`;

export function buildComparisonBriefingCard(decisions: PlaceDecision[], startStopName: string): BriefingCard {
  const picks = decisions.flatMap((entry) => {
    const dish = entry.dishes.find(({ has3D }) => has3D) ?? entry.dishes[0];
    return dish ? [{ entry, dish }] : [];
  });
  const reviews = decisions.flatMap((entry) => {
    const review = entry.reviews.find(({ sample }) => !sample) ?? entry.reviews[0];
    return review ? [{ placeId: entry.id, placeName: entry.name, author: review.author_label, text: review.text, sample: review.sample }] : [];
  });
  const includeRatings = decisions.some(({ details }) => details?.ratings.length);
  const includeAwards = decisions.some(({ details }) => details?.awards.length);
  const sections: BriefingSection[] = [{
    kind: 'comparison', items: decisions.map((entry) => {
      const { trip, transit } = entry;
      const previews = [entry.has3DRoom && 'Room', entry.dishes.some(({ has3D }) => has3D) && 'Dishes'].filter(Boolean);
      const metrics: BriefingFact[] = [
        { label: 'One way with fare', value: money(trip.oneWayTotal) },
        { label: 'Round trip with fare', value: money(trip.roundTripTotal) },
        { label: 'Walk + ride', value: `${trip.walkMeters} m · ${trip.walkMinutes} min walk · ${trip.rideMinutes} min ride` },
        { label: 'Next train', value: nextTrainLabel(transit) },
        { label: 'Boston hours', value: `${entry.openNow ? 'Open' : 'Closed'} now · ${entry.hoursToday}` },
        { label: 'Seating', value: entry.statedCapacity ? `${entry.statedCapacity} people` : 'Check with venue' },
        { label: 'Preview', value: previews.join(' & ') || '2D' },
      ];
      if (includeRatings) metrics.push({ label: 'Rating', value: entry.details?.ratings.map(({ source, rating }) => `${source} ${rating.toFixed(1)}/5`).join(' · ') || '—' });
      if (includeAwards) metrics.push({ label: 'Awards', value: entry.details?.awards.map(({ title }) => title).join(' · ') || '—' });
      return { placeId: entry.id, name: entry.name, subtitle: entry.stop.name, metrics, note: entry.vibe };
    }),
  }];
  if (reviews.length) sections.push({ kind: 'reviews', heading: 'Diner reviews', items: reviews });
  if (picks.length) sections.push({ kind: 'list', heading: 'Menu picks', items: picks.map(({ entry, dish }) => ({
    label: `${dish.name} · ${dish.priceLabel}`, detail: entry.name, badge: dish.has3D ? '3D' : undefined,
  })) });
  const alerts = [...new Set(decisions.flatMap(({ transit }) => transit.alerts.map(({ header }) => header)))];
  if (alerts.length) sections.push({ kind: 'list', heading: 'Service alerts', items: alerts.map((label) => ({ label })) });
  const actions: BriefingAction[] = decisions.map(({ id, name }) => ({ kind: 'venue', placeId: id, label: `Step inside ${name}` }));
  const [first, second] = picks.filter(({ dish }) => dish.has3D);
  if (first && second) actions.unshift({ kind: 'compare-dishes', label: 'Compare 3D dishes on table',
    placeId: first.entry.id, dishId: first.dish.id, comparePlaceId: second.entry.id, compareDishId: second.dish.id });
  const groupSize = decisions[0]?.groupSize ?? 1;
  return {
    id: 'restaurant-comparison', kicker: 'RESTAURANT COMPARISON',
    title: decisions.length === 2 ? decisions.map(({ name }) => name).join(' vs. ') : 'Comparing 3 Boston spots',
    subtitle: `From ${startStopName} · ${groupSize} ${groupSize === 1 ? 'person' : 'people'}`, sections, actions,
  };
}

export function buildPlaceBriefingCard(details: PlaceDecision, web?: LiveReviewsResponse): BriefingCard {
  const { trip, transit } = details;
  const sections: BriefingSection[] = [{ kind: 'text', heading: 'Overview', body:
    `${details.vibe}\n${trip.costBasis} · ${money(trip.roundTripTotal)} with return fare · ${trip.rideMinutes} min estimated ride.` }];
  const facts = details.details;
  const { ratings, highlights } = reviewFacts(facts, web);
  if (ratings.length || highlights.length) sections.push({ kind: 'list', heading: 'What reviewers say', items: [
    ...(ratings.map(({ source, rating, count, url }) => ({
      label: `${source} ${rating.toFixed(1)} / 5`, detail: count ? `${count.toLocaleString('en-US')} reviews` : undefined,
      url: url ?? undefined,
    }))),
    ...highlights.map((label) => ({ label })),
  ] });
  if (web?.live && web.reviews?.length) {
    sections.push({ kind: 'reviews', heading: 'Live web reviews', items: web.reviews.map(liveBriefingReview) });
  }
  if (facts?.awards.length) sections.push({ kind: 'list', heading: 'Recognition', items: facts.awards.map((award) => ({
    label: [award.title, award.year].filter(Boolean).join(', '), detail: award.org,
  })) });
  sections.push(details.reviews.length ? { kind: 'reviews', heading: 'Diner Reviews', items: details.reviews.map((review) => ({
    author: review.author_label, text: review.text, sample: review.sample,
  })) } : { kind: 'text', heading: 'Diner Reviews', body: 'No approved reviews yet.' });
  if (details.dishes.length) sections.push({ kind: 'list', heading: 'Menu Highlights', items: details.dishes.map((dish) => ({
    label: `${dish.name} · ${dish.priceLabel}`, detail: dish.portionNote, badge: dish.has3D ? '3D' : undefined,
  })) });
  if (details.rooms.length) sections.push({ kind: 'list', heading: 'Rooms', items: details.rooms.map((room) => ({
    label: room.name, detail: `${room.statedCapacity} ${room.seating} · ${money(room.price)} ${room.priceUnit}`,
    badge: room.has3D ? '3D' : undefined,
  })) });
  sections.push({ kind: 'list', heading: 'Hours', items: [
    ...week.map(([day, label]) => ({ label, detail: formatHours(details.hours[day]) })),
    ...(facts?.hours_note ? [{ label: facts.hours_note }] : []),
  ] });
  if (transit.alerts.length) sections.push({ kind: 'list', heading: 'Service Alerts', items: transit.alerts.map(({ header }) => ({ label: header })) });
  const actions: BriefingAction[] = [
    { kind: 'venue', placeId: details.id, label: 'Step inside' }, { kind: 'map', stopId: details.stop.stop_id, label: 'View on map' },
    ...details.dishes.filter(({ has3D }) => has3D).map(({ id, name }): BriefingAction =>
      ({ kind: 'dish', placeId: details.id, dishId: id, label: `View ${name} in 3D` })),
  ];
  return {
    id: `place-${details.id}`, kicker: 'VENUE BRIEFING', title: details.name,
    subtitle: `${details.stop.name} · ${details.openNow ? 'Open' : 'Closed'} by schedule · ${details.hoursToday}${details.has3D ? ' · 3D previews' : ''}`,
    facts: [{ label: 'One way with fare', value: money(trip.oneWayTotal) },
      { label: 'Walk from the T', value: `${trip.walkMeters} m · ${trip.walkMinutes} min` },
      { label: 'Next train', value: nextTrainLabel(transit) },
      { label: 'Seating', value: details.statedCapacity ? `${details.statedCapacity} people` : 'Check with venue' }],
    sections, actions,
  };
}
