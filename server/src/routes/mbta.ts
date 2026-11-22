import { computeTripEstimate, RIDE_TIMES, ROUTE_COLORS, STOPS } from '@faresight/shared';
import type { MbtaAlert, MbtaPrediction, MbtaSource, MbtaVehicle, TripInput } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { Store } from '../db/database.ts';
import { demoAlerts, demoPredictions, demoSchedules, demoVehicles, serviceDate } from './mbtaDemo.ts';

type Service = 'vehicles' | 'predictions' | 'alerts' | 'schedules';
const ttl: Record<Service, number> = { vehicles: 10_000, predictions: 10_000, alerts: 60_000, schedules: 3600_000 };
const routes = Object.keys(ROUTE_COLORS);
type Query = { stop?: string; route?: string; direction?: number; date?: string };
type TripQuery = {
  from?: string; to?: string; from_stop_id?: string; to_stop_id?: string; place_id?: string;
  origin_lat?: string; origin_lon?: string; venue_lat?: string; venue_lon?: string;
  venueLat?: string; venueLon?: string; walkToVenueM?: string;
};
interface Resource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, { data: { id: string } | null }>;
}
interface ResponseData { data: Resource[]; included?: Resource[] }

const textOrNull = (value: unknown) => typeof value === 'string' ? value : null;
const relation = (item: Resource, key: string) => item.relationships?.[key]?.data?.id ?? null;
const routeIds = (query: Query) => query.route ? [...new Set(query.route.split(','))] : routes;

function toPrediction(item: Resource, trips: Map<string, string>, lastTrip = false): MbtaPrediction {
  const attrs = item.attributes;
  const trip_id = relation(item, 'trip');
  return {
    id: item.id, trip_id, route_id: relation(item, 'route') ?? '', stop_id: relation(item, 'stop') ?? '',
    direction_id: Number(attrs.direction_id), arrival_time: textOrNull(attrs.arrival_time), departure_time: textOrNull(attrs.departure_time),
    headsign: (trip_id && trips.get(trip_id)) || textOrNull(attrs.trip_headsign), status: textOrNull(attrs.status),
    last_trip: lastTrip || attrs.last_trip === true,
  };
}

function tripHeadsigns(data: ResponseData) {
  return new Map((data.included ?? []).filter((entry) => entry.type === 'trip')
    .map((entry) => [entry.id, String(entry.attributes.headsign ?? '')]));
}

function stationRoutes(query: Query): string[] {
  const known = STOPS.find((stop) => stop.stop_id === query.stop);
  return known ? known.lines.filter((route) => routeIds(query).includes(route)) : routeIds(query);
}

function coordinates(lat?: string, lon?: string) {
  if (lat === undefined && lon === undefined) return undefined;
  if (!lat?.trim() || !lon?.trim() || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))
    || Math.abs(Number(lat)) > 90 || Math.abs(Number(lon)) > 180) {
    throw new RangeError('Provide a valid latitude/longitude pair');
  }
  return { lat: Number(lat), lon: Number(lon) };
}

const querySchema = {
  type: 'object',
  properties: {
    stop: { type: 'string', pattern: '^[A-Za-z0-9_.-]{1,45}$' },
    route: { type: 'string', pattern: '^[A-Za-z0-9,-]{1,60}$' },
    direction: { type: 'integer', enum: [0, 1] },
    date: { type: 'string', format: 'date' },
  },
};

export function registerMbta(app: FastifyInstance, config: Config, store: Store) {
  const cache = new Map<string, { expires: number; data: Promise<{ source: MbtaSource; items: unknown[] }> }>();

  let inFlight = 0;
  let cooldownUntil = 0;
  const waiting: (() => void)[] = [];

  async function acquire() {
    if (Date.now() < cooldownUntil || waiting.length >= 32) throw new Error('MBTA capacity unavailable');
    if (inFlight >= 8) await new Promise<void>((resolve) => waiting.push(resolve));
    else inFlight++;
  }

  function release() {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }

  async function fetchMbta(service: Service, params: Record<string, string>): Promise<ResponseData> {
    await acquire();
    try {
      if (Date.now() < cooldownUntil) throw new Error('MBTA capacity unavailable');
      const url = new URL(`https://api-v3.mbta.com/${service}`);
      url.search = new URLSearchParams(params).toString();
      const response = await fetch(url, {
        headers: config.mbtaKey ? { 'x-api-key': config.mbtaKey } : undefined,
        signal: AbortSignal.timeout(3500),
        redirect: 'error',
      });
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const now = Date.now();
        const deadline = retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry ?? '');
        cooldownUntil = Math.max(cooldownUntil, Number.isFinite(deadline) ? deadline : now + 30_000);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`MBTA HTTP ${response.status}`);
      }
      const result = await response.json() as ResponseData;
      if (!Array.isArray(result?.data)) throw new Error('Invalid MBTA response');
      return result;
    } finally {
      release();
    }
  }

  async function queryCached<T>(service: Service, key: Query, live: () => Promise<T[] | { partial: T[] }>, demo: () => T[]) {
    const id = JSON.stringify([service, key.stop, [...routeIds(key)].sort(), key.direction, key.date]);
    const found = cache.get(id);
    if (found && found.expires > Date.now()) return found.data as Promise<{ source: MbtaSource; items: T[] }>;
    if (cache.size >= 256) cache.delete(cache.keys().next().value!);
    const entry = { expires: Date.now() + ttl[service], data: resolve() };
    cache.set(id, entry);
    return entry.data;

    async function resolve(): Promise<{ source: MbtaSource; items: T[] }> {
      try {
        const result = await live();
        if (Array.isArray(result)) return { source: 'live', items: result };
        entry.expires = Date.now() + 10_000;
        return { source: 'live', items: result.partial };
      } catch {
        entry.expires = Date.now() + Math.min(ttl[service], 10_000);
        return { source: 'simulated', items: demo() };
      }
    }
  }

  function params(query: Query, allowStop = true) {
    return {
      'filter[route]': routeIds(query).join(','),
      ...(allowStop && query.stop ? { 'filter[stop]': query.stop } : {}),
      ...(query.direction !== undefined ? { 'filter[direction_id]': String(query.direction) } : {}),
    };
  }

  function predictions(query: Query) {
    return queryCached('predictions', query, async () => {
      const result = await fetchMbta('predictions', { ...params(query), sort: 'departure_time', include: 'trip', 'page[limit]': '100' });
      const trips = tripHeadsigns(result);
      return result.data.map((item) => toPrediction(item, trips));
    }, () => demoPredictions(query.stop, routeIds(query), query.direction));
  }

  app.get<{ Querystring: Query }>('/api/mbta/vehicles', { schema: { querystring: querySchema } }, async ({ query }, reply) => {
    if (routeIds(query).some((route) => !routes.includes(route))) return reply.code(400).send({ error: 'Unknown subway route' });
    const result = await queryCached('vehicles', { route: query.route, direction: query.direction }, async () => {
      const data = await fetchMbta('vehicles', params(query, false));
      return data.data.flatMap((item): MbtaVehicle[] => {
        const attrs = item.attributes;
        if (typeof attrs.latitude !== 'number' || typeof attrs.longitude !== 'number') return [];
        return [{
          id: item.id, route_id: relation(item, 'route') ?? '', stop_id: relation(item, 'stop'), trip_id: relation(item, 'trip'),
          lat: attrs.latitude, lon: attrs.longitude, bearing: typeof attrs.bearing === 'number' ? attrs.bearing : null,
          direction_id: Number(attrs.direction_id), current_status: String(attrs.current_status), updated_at: String(attrs.updated_at),
        }];
      });
    }, () => demoVehicles(routeIds(query), query.direction));
    return { source: result.source, vehicles: result.items, updated_at: result.items.map((item) => item.updated_at).sort().at(-1) ?? new Date().toISOString() };
  });

  app.get<{ Querystring: Query }>('/api/mbta/predictions', { schema: { querystring: querySchema } }, async ({ query }, reply) => {
    if (routeIds(query).some((route) => !routes.includes(route))) return reply.code(400).send({ error: 'Unknown subway route' });
    const result = await predictions({ stop: query.stop, route: query.route, direction: query.direction });
    return { source: result.source, predictions: result.items };
  });

  app.get<{ Querystring: Query }>('/api/mbta/alerts', { schema: { querystring: querySchema } }, async ({ query }, reply) => {
    if (routeIds(query).some((route) => !routes.includes(route))) return reply.code(400).send({ error: 'Unknown subway route' });
    const { route, stop } = query;
    const result = await queryCached('alerts', { route, stop }, async () => {
      const data = await fetchMbta('alerts', params({ route, stop }));
      return data.data.map((item): MbtaAlert => {
        const attrs = item.attributes;
        const entities = Array.isArray(attrs.informed_entity) ? attrs.informed_entity as { route?: string; stop?: string }[] : [];
        return {
          id: item.id, header: String(attrs.header ?? ''), description: textOrNull(attrs.description),
          severity: Number(attrs.severity), effect: String(attrs.effect), url: textOrNull(attrs.url),
          route_ids: [...new Set(entities.flatMap((entry) => entry.route ? [entry.route] : []))],
          stop_ids: [...new Set(entities.flatMap((entry) => entry.stop ? [entry.stop] : []))],
        };
      });
    }, () => demoAlerts(routeIds(query), stop));
    return { source: result.source, alerts: result.items };
  });

  function schedules(query: Query & { stop: string; date: string }) {
    const { stop, date } = query;
    const selectedRoutes = stationRoutes(query);
    const directions = query.direction === undefined ? [0, 1] : [query.direction];
    return queryCached('schedules', query, async () => {
      const schedules = await Promise.allSettled(selectedRoutes.flatMap((route) => directions.map(async (direction) => {
        const data = await fetchMbta('schedules', {
          ...params({ stop, route, direction }), 'filter[date]': date,
          'page[limit]': '1', sort: '-departure_time', include: 'trip',
        });
        return data.data.map((item) => toPrediction(item, tripHeadsigns(data), true));
      })));
      const successful = schedules.filter((result) => result.status === 'fulfilled');
      if (schedules.length && !successful.length) throw new Error('MBTA schedules unavailable');
      const items = successful.flatMap((result) => result.value);
      return successful.length === schedules.length ? items : { partial: items };
    }, () => demoSchedules(stop, selectedRoutes, date, query.direction));
  }

  app.get<{ Querystring: Query }>('/api/mbta/schedules', { schema: { querystring: querySchema } }, async ({ query }, reply) => {
    if (routeIds(query).some((route) => !routes.includes(route))) return reply.code(400).send({ error: 'Unknown subway route' });
    const stop = query.stop ?? 'place-bucen';
    const date = query.date ?? serviceDate();
    const result = await schedules({ stop, date, direction: query.direction, route: stationRoutes({ ...query, stop }).join(',') || query.route });
    return { source: result.source, stop_id: stop, service_date: date, schedules: result.items };
  });

  app.get<{ Querystring: TripQuery }>('/api/mbta/trip', async ({ query }, reply) => {
    const place = query.place_id && store.get('places', query.place_id);
    if (query.place_id && !place) return reply.code(404).send({ error: 'Place not found' });
    const from = query.from_stop_id ?? query.from ?? 'place-bucen';
    const to = query.to_stop_id ?? query.to ?? (place || undefined)?.stop_id;
    if (place && to !== place.stop_id) return reply.code(400).send({ error: 'Destination stop must match place_id' });
    const ride = RIDE_TIMES[from]?.[to ?? ''];
    if (!to || !ride || !STOPS.some((stop) => stop.stop_id === from) || !STOPS.some((stop) => stop.stop_id === to)) {
      return reply.code(400).send({ error: 'Trip requires two focal MBTA stops' });
    }
    let input: TripInput;
    try {
      const venueDistance = query.walkToVenueM === undefined ? undefined : Number(query.walkToVenueM);
      if (venueDistance !== undefined && (!Number.isFinite(venueDistance) || venueDistance < 0)) {
        throw new RangeError('Walking distance must be nonnegative');
      }
      input = {
        from_stop_id: from, to_stop_id: to, origin: coordinates(query.origin_lat, query.origin_lon),
        venue: coordinates(query.venue_lat ?? query.venueLat, query.venue_lon ?? query.venueLon) ?? (place || undefined),
        walk_from_stop_m: place ? place.walk_from_stop_m : venueDistance,
      };
    } catch (error) {
      return reply.code(400).send({ error: (error as Error).message });
    }
    let prediction_source: MbtaSource | 'estimate' = 'estimate';
    let last_train_time: string | null = null;
    let schedule_source: MbtaSource | undefined;
    const reverse = RIDE_TIMES[to][from];
    if (ride.route_id && ride.direction_id !== null && reverse.route_id && reverse.direction_id !== null) {
      const now = Date.now();
      const walked = computeTripEstimate(input).walk_to_station_min;
      const reachStation = now + walked * 60_000;
      const boardTimes: number[] = [];
      const routeChoices = from === 'place-kencl' && ride.direction_id === 1 && ride.route_id === 'Green-B'
        ? STOPS.find((stop) => stop.stop_id === from)!.lines.join(',') : ride.route_id;
      const reverseRoutes = to === 'place-kencl' && reverse.direction_id === 1 && reverse.route_id === 'Green-B'
        ? STOPS.find((stop) => stop.stop_id === to)!.lines.join(',') : reverse.route_id;
      const [result, returnSchedule] = await Promise.all([
        predictions({ stop: from, route: routeChoices, direction: ride.direction_id }),
        schedules({ stop: to, route: reverseRoutes, direction: reverse.direction_id, date: serviceDate() }),
      ]);
      const departures = returnSchedule.items.map((item) => Date.parse(item.departure_time ?? '')).filter(Number.isFinite);
      last_train_time = departures.length ? new Date(Math.max(...departures)).toISOString() : null;
      schedule_source = returnSchedule.source;
      for (const item of result.items) {
        const time = Date.parse(item.departure_time ?? item.arrival_time ?? '');
        if (time >= reachStation) boardTimes.push(time);
      }
      if (boardTimes.length) {
        input.wait_min = (Math.min(...boardTimes) - reachStation) / 60_000;
        prediction_source = result.source;
      }
    }
    return { ...computeTripEstimate(input), prediction_source, last_train_time, schedule_source };
  });
}
