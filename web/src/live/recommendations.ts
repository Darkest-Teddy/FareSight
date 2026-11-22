import { computeTripEstimate, formatDishPrice, RIDE_TIMES, type Place, type Stop } from '@faresight/shared';
import type { Alert, Trip } from '../api/client.ts';
import { has3D, has3DDish, has3DRoom, hasDishPreview } from '../data/preview3D.ts';
import { bostonHours, scheduledHours, type Weekday } from '../data/reviewBriefing.ts';
import { matchingPlaces, oneWayCost, type Craving, type Filters } from '../ui/state.ts';

interface DiscoveryFilters {
  query?: string;
  craving?: Craving;
  maxBudget?: number;
  groupSize?: number;
  openNow?: boolean;
  familyFriendly?: boolean;
  eveningOnly?: boolean;
  has3DRoom?: boolean;
  has3DDish?: boolean;
  only3D?: boolean;
}

export interface RecommendationFilters extends DiscoveryFilters {
  stopIds?: string[];
  line?: string;
  category?: Place['category'];
  maxTotalMinutes?: number;
  maxWalkMeters?: number;
  openAt?: { day: Weekday; time: string };
  minRating?: number;
  hasAwards?: boolean;
  excludePlaceIds?: string[];
  sortBy?: 'best_match' | 'fastest' | 'cheapest' | 'highest_rated' | 'closest_walk' | 'most_3d';
  limit?: number;
}

interface DishFilters {
  query?: string;
  stopId?: string;
  placeId?: string;
  maxPrice?: number;
  maxOneWayTotal?: number;
  only3D?: boolean;
  openNow?: boolean;
  sortBy?: 'best_match' | 'cheapest' | 'fastest' | '3d_first';
  limit?: number;
}

export interface CatalogContext {
  stops: Stop[];
  places: Place[];
  filters: Filters;
}

const cash = (value: number) => Number(value.toFixed(2));
const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9]+/g, ' ').trim();

function queryScore(query: string, fields: string[]): number {
  if (!query) return 0;
  const normalized = fields.map(normalize);
  const name = normalized[0];
  if (name === query) return 100;
  if (name.includes(query)) return 80;
  if (normalized.some((field) => field.includes(query))) return 60;
  const words = normalized.join(' ').split(' ');
  return query.split(' ').every((token) => words.some((word) => word === token || (token.length >= 3 && word.startsWith(token)))) ? 40 : 0;
}

function matches(value: boolean, filter?: boolean) {
  return filter === undefined || value === filter;
}

export function alertsForStops(alerts: Alert[], stops: Stop[], routeIds = stops.flatMap(({ lines }) => lines)) {
  const stopIds = new Set(stops.map(({ stop_id }) => stop_id));
  return alerts.filter((alert) => alert.stop_ids.some((id) => stopIds.has(id)) ||
    alert.route_ids.some((id) => routeIds.includes(id)));
}

function tripAlerts(alerts: Alert[], from: Stop, to: Stop) {
  const first = RIDE_TIMES[from.stop_id]?.[to.stop_id]?.route_id;
  const last = RIDE_TIMES[to.stop_id]?.[from.stop_id]?.route_id;
  return alertsForStops(alerts, [from, to], first && last ? [first, last] : to.lines);
}

export function tripBreakdown(trip: Trip) {
  return {
    fromStopId: trip.from_stop_id, toStopId: trip.to_stop_id, routeId: trip.route_id,
    transferStation: trip.transfer_station, transfers: trip.transfers, directLine: trip.transfer_min === 0,
    walkToStationMinutes: trip.walk_to_station_min, walkToVenueMinutes: trip.walk_to_venue_min,
    walkMinutes: trip.walk_to_station_min + trip.walk_to_venue_min,
    waitMinutes: trip.wait_min, rideMinutes: trip.ride_min, transferMinutes: trip.transfer_min, totalMinutes: trip.total_min,
    oneWayFare: trip.fare, roundTripFare: trip.round_trip_fare, plannerUrl: trip.planner_url,
    lastTrainTime: trip.last_train_time ?? null, predictionSource: trip.prediction_source ?? 'estimate',
    scheduleSource: trip.schedule_source ?? null,
  };
}

function catalogTrip(from: string, place: Place) {
  return computeTripEstimate({
    from_stop_id: from, to_stop_id: place.stop_id, venue: place, walk_from_stop_m: place.walk_from_stop_m,
  });
}

function venueRating(place: Place) {
  const ratings = place.details?.ratings ?? [];
  const average = ratings.length ? ratings.reduce((sum, { rating }) => sum + rating, 0) / ratings.length : null;
  return { average, sources: ratings };
}

function visits(context: CatalogContext, options: RecommendationFilters, now: Date) {
  const { stops, places, filters } = context;
  const groupSize = options.groupSize ?? filters.groupSize;
  const candidates = matchingPlaces(places, {
    ...filters, craving: options.craving ?? 'all', maxBudget: Infinity, groupSize,
    familyVisit: false,
  });
  const query = normalize(options.query ?? '');
  const byStop = new Map(stops.map((station) => [station.stop_id, station]));
  return candidates.flatMap((place) => {
    const stop = byStop.get(place.stop_id);
    if (!stop || (options.stopIds && !options.stopIds.includes(stop.stop_id)) ||
        (options.line && !stop.lines.includes(options.line)) ||
        (options.category && place.category !== options.category) || options.excludePlaceIds?.includes(place.id)) return [];
    const cost = oneWayCost(place, filters.startStopId, groupSize);
    if (cash(cost) > (options.maxBudget ?? Infinity)) return [];
    const hasRoom = has3DRoom(place);
    const hasDish = has3DDish(place);
    const awards = place.details?.awards ?? [];
    const rating = venueRating(place);
    const hours = bostonHours(place.hours, now);
    const planningHours = options.openAt ? scheduledHours(place.hours, options.openAt) : undefined;
    if ((options.openNow && !hours.openNow) || (planningHours && !planningHours.openNow) ||
        !matches(place.family_friendly, options.familyFriendly) || (options.eveningOnly && !place.evening_venue) ||
        !matches(hasRoom, options.has3DRoom) || !matches(hasDish, options.has3DDish) ||
        (options.only3D && !hasRoom && !hasDish) || !matches(awards.length > 0, options.hasAwards) ||
        (options.minRating !== undefined && (rating.average === null || rating.average < options.minRating))) return [];
    const score = queryScore(query, [
      place.name, place.category, place.vibe, stop.name, ...place.cravings,
      ...place.dishes.flatMap(({ name, portion_note }) => [name, portion_note]),
      ...(place.details?.review_highlights ?? []), ...awards.flatMap(({ title, org }) => [title, org]),
    ]);
    if (query && !score) return [];
    const trip = catalogTrip(filters.startStopId, place);
    if (trip.total_min > (options.maxTotalMinutes ?? Infinity) || place.walk_from_stop_m > (options.maxWalkMeters ?? Infinity)) return [];
    const roomCapacity = place.rooms.length ? Math.max(...place.rooms.map(({ stated_capacity }) => stated_capacity)) : null;
    const capacity = place.stated_capacity ?? roomCapacity;
    const fitsGroup = capacity === null ? null : capacity >= groupSize;
    return [{
      place, stop, trip, hours, planningHours, hasRoom, hasDish, awards, rating, score, roomCapacity, fitsGroup,
      cost,
      threeDCount: Number(hasRoom) + place.dishes.filter(hasDishPreview).length,
      matchingDishes: place.dishes.filter((dish) => query && queryScore(query, [dish.name, dish.portion_note])),
    }];
  });
}

export function listPlaces(context: CatalogContext, options: DiscoveryFilters & { stopId?: string }, now: Date) {
  const { filters } = context;
  const results = visits(context, {
    ...options, stopIds: options.stopId ? [options.stopId] : undefined, craving: options.craving ?? filters.craving,
    familyFriendly: options.familyFriendly ?? (filters.familyVisit ? true : undefined), maxBudget: options.maxBudget ?? filters.maxBudget,
  }, now);
  return results.sort((a, b) => b.score - a.score).map(({ place, cost }) => ({
    id: place.id, name: place.name, stopId: place.stop_id, fareInclusiveCost: cash(cost),
    walkMeters: place.walk_from_stop_m, has3D: has3D(place), dishes: place.dishes.map(({ id, name }) => ({ id, name })),
  }));
}

export function recommendPlaces(context: CatalogContext, options: RecommendationFilters, origin: Stop, alerts: Alert[], now: Date) {
  const groupSize = options.groupSize ?? context.filters.groupSize;
  const candidates = visits(context, options, now).map((entry) => {
    const activeAlerts = tripAlerts(alerts, origin, entry.stop);
    const disruptions = activeAlerts.filter(({ source }) => source !== 'simulated').length;
    const rank = entry.score + (entry.fitsGroup === true ? 8 : entry.fitsGroup === false ? -24 : 0)
      + (entry.rating.average ?? 0) * 2 + Math.min(entry.awards.length, 2) * 2 + Math.min(entry.threeDCount, 3)
      + Number((entry.planningHours ?? entry.hours).openNow) * 2 + Number(entry.trip.transfer_min === 0) * 3
      - entry.trip.total_min * 0.3 - entry.cost * 0.2 - disruptions * 2;
    return { ...entry, activeAlerts, rank };
  });
  candidates.sort((a, b) => {
    const order = {
      fastest: a.trip.total_min - b.trip.total_min,
      cheapest: a.cost - b.cost,
      highest_rated: (b.rating.average ?? -1) - (a.rating.average ?? -1),
      closest_walk: a.place.walk_from_stop_m - b.place.walk_from_stop_m,
      most_3d: b.threeDCount - a.threeDCount,
      best_match: 0,
    };
    return order[options.sortBy ?? 'best_match'] || b.rank - a.rank || a.place.id.localeCompare(b.place.id);
  });
  const places = candidates.slice(0, options.limit ?? 6).map((entry) => {
    const { place, stop, trip, cost, hours, planningHours, rating, awards, hasRoom, hasDish, matchingDishes, fitsGroup, roomCapacity, activeAlerts } = entry;
    const matchReasons = [
      trip.fare === 0 ? 'No subway fare from this stop' : trip.transfer_min === 0 ? 'Direct train' : '',
      planningHours ? 'Open at requested time' : hours.openNow ? 'Open on catalog schedule now' : '',
      fitsGroup === true ? `Listed capacity fits ${groupSize}` : fitsGroup === false ? `Listed capacity is below ${groupSize}` : '',
      rating.average === null ? '' : `${rating.average.toFixed(1)}/5 across ${rating.sources.length} rating source(s)`,
      awards.length ? awards[0].title : '',
      hasRoom && hasDish ? '3D room and dishes' : hasRoom ? '3D room' : hasDish ? '3D dishes' : '',
      ...matchingDishes.slice(0, 2).map(({ name }) => name),
    ].filter(Boolean);
    return {
      id: place.id, name: place.name, stopId: stop.stop_id, stopName: stop.name, lines: stop.lines,
      category: place.category, vibe: place.vibe, familyFriendly: place.family_friendly, eveningVenue: place.evening_venue,
      ...hours, openAt: options.openAt ? { ...options.openAt, open: planningHours!.openNow } : null,
      hoursVerified: place.details?.hours_verified ?? false,
      groupSize, statedCapacity: place.stated_capacity ?? null, roomCapacity, fitsGroup,
      has3DRoom: hasRoom, has3DDish: hasDish, has3D: hasRoom || hasDish,
      walkMeters: place.walk_from_stop_m, ...tripBreakdown(trip),
      oneWayTotal: cash(cost), roundTripTotal: cash(cost + trip.round_trip_fare - trip.fare),
      costBasis: place.rooms.some(({ price_unit }) => /hour/i.test(price_unit)) ? 'One hour of room hire split by group size' : 'Typical spend per person',
      rating, awards, reviewHighlights: place.details?.review_highlights ?? [], activeAlerts, matchReasons,
      matchingDishes: matchingDishes.map((dish) => ({ id: dish.id, name: dish.name, price: dish.price,
        priceLabel: formatDishPrice(dish.price), portionNote: dish.portion_note, has3D: hasDishPreview(dish) })),
    };
  });
  return { count: candidates.length, places };
}

export function searchDishes(context: CatalogContext, options: DishFilters, now: Date) {
  const { places, stops, filters } = context;
  const query = normalize(options.query ?? '');
  const entries = places.flatMap((place) => {
    if ((options.placeId && place.id !== options.placeId) || (options.stopId && place.stop_id !== options.stopId)) return [];
    const stop = stops.find(({ stop_id }) => stop_id === place.stop_id);
    if (!stop) return [];
    const { openNow } = bostonHours(place.hours, now);
    if (options.openNow && !openNow) return [];
    const trip = catalogTrip(filters.startStopId, place);
    return place.dishes.flatMap((dish) => {
      const has3D = hasDishPreview(dish);
      const score = queryScore(query, [dish.name, dish.portion_note, place.name, stop.name]);
      const total = dish.price === null ? null : cash(dish.price + trip.fare);
      if ((query && !score) || (options.only3D && !has3D) ||
          (options.maxPrice !== undefined && (dish.price === null || dish.price > options.maxPrice)) ||
          (options.maxOneWayTotal !== undefined && (total === null || total > options.maxOneWayTotal))) return [];
      return [{ score, dishId: dish.id, name: dish.name, price: dish.price, priceLabel: formatDishPrice(dish.price),
        portionNote: dish.portion_note, plateDiameterCm: dish.plate_diameter_m == null ? null : Number((dish.plate_diameter_m * 100).toFixed(1)),
        has3D, placeId: place.id, placeName: place.name, stopId: stop.stop_id, stopName: stop.name, openNow,
        estimatedTotalMin: trip.total_min, oneWayDishPlusFare: total }];
    });
  });
  entries.sort((a, b) => {
    const order = {
      best_match: 0,
      cheapest: (a.price ?? Infinity) - (b.price ?? Infinity),
      fastest: a.estimatedTotalMin - b.estimatedTotalMin,
      '3d_first': Number(b.has3D) - Number(a.has3D),
    };
    return order[options.sortBy ?? 'best_match'] || b.score - a.score || a.estimatedTotalMin - b.estimatedTotalMin || a.dishId.localeCompare(b.dishId);
  });
  return { count: entries.length, dishes: entries.slice(0, options.limit ?? 10).map(({ score, ...dish }) => dish) };
}

export function stationOverview(context: CatalogContext, options: DiscoveryFilters & { stopId?: string }, origin: Stop, alerts: Alert[], now: Date) {
  const matched = visits(context, options, now);
  return context.stops.filter((stop) => !options.stopId || options.stopId === stop.stop_id).map((stop) => {
    const local = context.places.filter(({ stop_id }) => stop_id === stop.stop_id);
    const matching = matched.filter((entry) => entry.stop.stop_id === stop.stop_id);
    const trip = computeTripEstimate({ from_stop_id: origin.stop_id, to_stop_id: stop.stop_id });
    const topRated = local.flatMap((place) => {
      const { average, sources } = venueRating(place);
      return average === null ? [] : [{ id: place.id, name: place.name, rating: average, sources }];
    }).sort((a, b) => b.rating - a.rating).slice(0, 3);
    const categories: Partial<Record<Place['category'], number>> = {};
    for (const { category } of local) categories[category] = (categories[category] ?? 0) + 1;
    return {
      stopId: stop.stop_id, name: stop.name, areaCode: stop.area_code, lines: stop.lines,
      rideMinutes: trip.ride_min, transferMinutes: trip.transfer_min, directLine: trip.transfer_min === 0,
      activeAlerts: tripAlerts(alerts, origin, stop), totalPlaces: local.length, matchingPlaces: matching.length,
      openNowCount: local.filter((place) => bostonHours(place.hours, now).openNow).length,
      minOneWayCost: matching.length ? cash(Math.min(...matching.map(({ cost }) => cost))) : null,
      avgOneWayCost: matching.length ? cash(matching.reduce((sum, { cost }) => sum + cost, 0) / matching.length) : null,
      placesWith3DRoom: local.filter(has3DRoom).length, placesWith3DDish: local.filter(has3DDish).length,
      topRated, categories,
    };
  });
}
