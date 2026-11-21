import { haversineMeters } from './projection.js';
import type { Stop, TripEstimate } from './types.js';

export const MBTA_SUBWAY_FARE = 2.40;
export const MBTA_BUS_FARE = 1.70;
export const MBTA_ROUND_TRIP_SUBWAY_FARE = 4.80;

export const ROUTE_COLORS: Record<string, string> = {
  'Green-B': '#00843D', 'Green-C': '#00843D', 'Green-D': '#00843D', 'Green-E': '#00843D',
  Red: '#DA291C', Orange: '#ED8B00', Blue: '#003DA5',
};

export const FOCAL_STOP_IDS = ['place-bucen', 'place-brico', 'place-kencl', 'place-harsq', 'place-chncl'] as const;
export type FocalStopId = typeof FOCAL_STOP_IDS[number];

export const STOPS: Stop[] = [
  { stop_id: 'place-bucen', name: 'BU Central', area_code: 'AREA - 001', lat: 42.350082, lon: -71.106865, lines: ['Green-B'], primary_color: ROUTE_COLORS['Green-B'], segment_asset: '/assets-demo/segment-place-bucen.glb' },
  { stop_id: 'place-brico', name: "Packard's Corner", area_code: 'AREA - 002', lat: 42.351967, lon: -71.125031, lines: ['Green-B'], primary_color: ROUTE_COLORS['Green-B'], segment_asset: '/assets-demo/segment-place-brico.glb' },
  { stop_id: 'place-kencl', name: 'Kenmore', area_code: 'AREA - 003', lat: 42.348949, lon: -71.095169, lines: ['Green-B', 'Green-C', 'Green-D'], primary_color: ROUTE_COLORS['Green-B'], segment_asset: '/assets-demo/segment-place-kencl.glb' },
  { stop_id: 'place-harsq', name: 'Harvard', area_code: 'AREA - 004', lat: 42.373362, lon: -71.118956, lines: ['Red'], primary_color: ROUTE_COLORS.Red, segment_asset: '/assets-demo/segment-place-harsq.glb' },
  { stop_id: 'place-chncl', name: 'Chinatown', area_code: 'AREA - 005', lat: 42.352547, lon: -71.062752, lines: ['Orange'], primary_color: ROUTE_COLORS.Orange, segment_asset: '/assets-demo/segment-place-chncl.glb' },
];

export interface RideTime {
  minutes: number;
  transfers: number;
  transfer_station: string | null;
  route_id: string | null;
  direction_id: 0 | 1 | null;
}

const ridePairs: [number, number, number, string | null][] = [
  [0, 1, 5, null], [0, 2, 4, null], [0, 3, 24, 'Park Street'], [0, 4, 19, 'Park Street'],
  [1, 2, 9, null], [1, 3, 29, 'Park Street'], [1, 4, 24, 'Park Street'],
  [2, 3, 20, 'Park Street'], [2, 4, 15, 'Park Street'], [3, 4, 15, 'Downtown Crossing'],
];
const RIDE_FROM: Record<string, Record<string, RideTime>> = {};
for (const id of FOCAL_STOP_IDS) {
  RIDE_FROM[id] = { [id]: { minutes: 0, transfers: 0, transfer_station: null, route_id: null, direction_id: null } };
}
for (const [from, to, minutes, transfer_station] of ridePairs) {
  const a = FOCAL_STOP_IDS[from];
  const b = FOCAL_STOP_IDS[to];
  const transfers = Number(transfer_station !== null);
  RIDE_FROM[a][b] = { minutes, transfers, transfer_station, route_id: STOPS[from].lines[0], direction_id: from === 3 || (from === 0 && to === 1) ? 0 : 1 };
  RIDE_FROM[b][a] = { minutes, transfers, transfer_station, route_id: STOPS[to].lines[0], direction_id: to === 4 || (from === 0 && to === 1) ? 1 : 0 };
}
export const RIDE_TIMES: Readonly<Record<string, Readonly<Record<string, RideTime>>>> = RIDE_FROM;

export interface Location { lat: number; lon: number }
export interface TripInput {
  from_stop_id: string;
  to_stop_id: string;
  origin?: Location;
  venue?: Location;
  walk_from_stop_m?: number;
  wait_min?: number;
  mode?: 'subway' | 'bus';
}

export function buildMbtaTripPlannerUrl(from: string | Location, to: string | Location): string {
  const params = new URLSearchParams();
  for (const [direction, input] of [['from', from], ['to', to]] as const) {
    const station = typeof input === 'string'
      ? STOPS.find((stop) => stop.stop_id === input || stop.name.toLowerCase() === input.toLowerCase())
      : 'stop_id' in input ? input as Stop : undefined;
    const location = station ?? (typeof input === 'string' ? undefined : input);
    const name = station?.name ?? (typeof input === 'string' ? input : `${input.lat}, ${input.lon}`);
    params.set(`plan[${direction}]`, name);
    if (location) {
      params.set(`plan[${direction}_latitude]`, String(location.lat));
      params.set(`plan[${direction}_longitude]`, String(location.lon));
    }
    if (station) params.set(`plan[${direction}_stop_id]`, station.stop_id);
  }
  return `https://www.mbta.com/trip-planner?${params}`;
}

export function computeTripEstimate(input: TripInput): TripEstimate {
  const from = STOPS.find((stop) => stop.stop_id === input.from_stop_id);
  const to = STOPS.find((stop) => stop.stop_id === input.to_stop_id);
  if (!from || !to) throw new RangeError('Trip requires two focal MBTA stops');
  const ride = RIDE_TIMES[from.stop_id][to.stop_id];
  const sameStop = from === to;
  const walkMinutes = (meters: number) => Math.max(0, meters) * 1.3 / 80;
  const distance = (a: Location, b: Location) => haversineMeters(a.lat, a.lon, b.lat, b.lon);
  const walkToStation = input.origin ? walkMinutes(distance(input.origin, from)) : 0;
  const walkToVenue = walkMinutes(input.walk_from_stop_m ?? (input.venue ? distance(to, input.venue) : 0));
  const wait = sameStop ? 0 : Math.max(0, input.wait_min ?? 6);
  const transfer = ride.transfers * 5;
  const fare = sameStop ? 0 : input.mode === 'bus' ? MBTA_BUS_FARE : MBTA_SUBWAY_FARE;
  return {
    from_stop_id: from.stop_id, to_stop_id: to.stop_id, route_id: ride.route_id,
    transfer_station: ride.transfer_station, transfers: ride.transfers,
    walk_to_station_min: walkToStation, wait_min: wait, ride_min: ride.minutes, transfer_min: transfer,
    walk_to_venue_min: walkToVenue, total_min: walkToStation + wait + ride.minutes + transfer + walkToVenue,
    fare, round_trip_fare: fare * 2,
    planner_url: buildMbtaTripPlannerUrl(input.origin ?? from, input.venue ?? to),
  };
}

export function computeTotalCost(foodPrice: number, roundTrip = false, groupSize = 1): number {
  if (!Number.isFinite(foodPrice) || foodPrice < 0 || !Number.isInteger(groupSize) || groupSize < 1) {
    throw new RangeError('Price must be nonnegative and group size must be a positive integer');
  }
  const fare = roundTrip ? MBTA_ROUND_TRIP_SUBWAY_FARE : MBTA_SUBWAY_FARE;
  return Math.round((foodPrice + fare) * groupSize * 100) / 100;
}
