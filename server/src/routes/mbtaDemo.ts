import { haversineMeters, STOPS } from '@faresight/shared';
import type { MbtaAlert, MbtaPrediction, MbtaVehicle } from '@faresight/shared';

const tracks: Record<string, [number, number][]> = {
  'Green-B': [[42.34386, -71.14285], [42.35024, -71.13136], [42.35197, -71.12503], [42.35008, -71.10687], [42.34895, -71.09517], [42.34789, -71.08790], [42.34997, -71.07745], [42.35639, -71.06242], [42.35971, -71.05922]],
  'Green-C': [[42.33614, -71.14933], [42.33939, -71.13533], [42.34212, -71.12126], [42.34597, -71.10735], [42.34895, -71.09517], [42.34997, -71.07745], [42.35639, -71.06242], [42.35971, -71.05922]],
  'Green-D': [[42.33509, -71.14876], [42.33261, -71.11686], [42.34540, -71.10421], [42.34895, -71.09517], [42.34997, -71.07745], [42.35639, -71.06242], [42.37736, -71.09476]],
  'Green-E': [[42.32832, -71.11025], [42.33423, -71.10461], [42.33771, -71.09551], [42.34040, -71.08881], [42.34557, -71.08170], [42.34997, -71.07745], [42.35639, -71.06242], [42.37157, -71.07658], [42.37736, -71.09476]],
  Red: [[42.35227, -71.05524], [42.35552, -71.06023], [42.35639, -71.06242], [42.36117, -71.07063], [42.36249, -71.08618], [42.36549, -71.10380], [42.37336, -71.11896], [42.38370, -71.11905]],
  Orange: [[42.33538, -71.08965], [42.34735, -71.07573], [42.35255, -71.06275], [42.35552, -71.06023], [42.36558, -71.06129], [42.38398, -71.07699]],
  Blue: [[42.36137, -71.06204], [42.35971, -71.05922], [42.35898, -71.05760], [42.35978, -71.05165], [42.36912, -71.03953]],
};

const headsigns: Record<string, [string, string]> = {
  'Green-B': ['Boston College', 'Government Center'], 'Green-C': ['Cleveland Circle', 'Government Center'],
  'Green-D': ['Riverside', 'Union Square'], 'Green-E': ['Heath Street', 'Medford/Tufts'],
  Red: ['Ashmont / Braintree', 'Alewife'], Orange: ['Forest Hills', 'Oak Grove'], Blue: ['Bowdoin', 'Wonderland'],
};

const segments = Object.fromEntries(Object.entries(tracks).map(([route, points]) => [route,
  points.slice(1).map((to, index) => ({ from: points[index], to, length: haversineMeters(...points[index], ...to) })),
]));

export function demoVehicles(routes: string[], direction?: number): MbtaVehicle[] {
  const now = Date.now();
  return routes.flatMap((route) => {
    const routeIndex = Object.keys(tracks).indexOf(route);
    const track = segments[route];
    const length = track.reduce((total, section) => total + section.length, 0);
    const speed = route.startsWith('Green') ? 6 : 9;
    return Array.from({ length: 4 }, (_, index) => {
      const direction_id = index % 2;
      const forward = direction_id === 1;
      const phase = ((now / 1000 * speed) + length * (index / 4 + routeIndex / 10)) % length;
      let remaining = forward ? phase : length - phase;
      let position = track.at(-1)!;
      for (const section of track) {
        position = section;
        if (remaining <= section.length) break;
        remaining -= section.length;
      }
      const fraction = Math.min(1, remaining / position.length);
      const lat = position.from[0] + (position.to[0] - position.from[0]) * fraction;
      const lon = position.from[1] + (position.to[1] - position.from[1]) * fraction;
      const deltaX = (position.to[1] - position.from[1]) * Math.cos(lat * Math.PI / 180);
      const deltaY = position.to[0] - position.from[0];
      const bearing = (Math.atan2(deltaX, deltaY) * 180 / Math.PI + (forward ? 360 : 540)) % 360;
      const id = `demo-${route}-${index}`;
      return { id, route_id: route, trip_id: id, stop_id: null, lat, lon, bearing, direction_id, current_status: 'IN_TRANSIT_TO', updated_at: new Date(now).toISOString() };
    }).filter((vehicle) => direction === undefined || vehicle.direction_id === direction);
  });
}

export function demoPredictions(stop: string | undefined, routes: string[], direction?: number): MbtaPrediction[] {
  const now = Date.now();
  return STOPS.filter((station) => !stop || station.stop_id === stop).flatMap((station) =>
    station.lines.filter((route) => routes.includes(route)).flatMap((route_id) => [0, 1].flatMap((direction_id) => {
      if (direction !== undefined && direction !== direction_id) return [];
      const headway = route_id.startsWith('Green') ? 480_000 : 390_000;
      const elapsed = (now + direction_id * 123_000 + Math.round(station.lat * 61000)) % headway;
      return [0, 1, 2].map((index) => {
        const arrival = now + headway - elapsed + index * headway;
        const id = `demo-${station.stop_id}-${route_id}-${direction_id}-${Math.round(arrival / headway)}`;
        return {
          id, route_id, direction_id, stop_id: station.stop_id, trip_id: id,
          arrival_time: new Date(arrival).toISOString(), departure_time: new Date(arrival + 30_000).toISOString(),
          headsign: headsigns[route_id][direction_id], status: null, last_trip: false,
        };
      });
    })));
}

const bostonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
const bostonHour = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' });
const bostonOffset = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' });

export function serviceDate(now = new Date()): string {
  const hour = Number(bostonHour.format(now));
  return bostonDate.format(hour < 3 ? new Date(now.getTime() - 12 * 3600_000) : now);
}

export function demoSchedules(stop: string, routes: string[], date: string, direction?: number): MbtaPrediction[] {
  // Both Boston offsets are known by 05:00 UTC before either clock change.
  const midnight = new Date(`${date}T05:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() + 1);
  const nextDay = midnight.toISOString().slice(0, 10);
  const offset = bostonOffset.formatToParts(midnight).find((part) => part.type === 'timeZoneName')?.value.slice(3) ?? '-05:00';
  return routes.flatMap((route_id, index) => [0, 1].flatMap((direction_id) => {
    if (direction !== undefined && direction_id !== direction) return [];
    const minutes = String(12 + index * 3 + (direction_id === 1 ? 7 : 0)).padStart(2, '0');
    const departure = Date.parse(`${nextDay}T01:${minutes}:00${offset}`);
    const id = `demo-last-${route_id}-${direction_id}`;
    return [{
      id, route_id, direction_id, stop_id: stop, trip_id: id, headsign: headsigns[route_id][direction_id],
      arrival_time: new Date(departure - 30_000).toISOString(), departure_time: new Date(departure).toISOString(),
      status: 'Demonstration schedule', last_trip: true,
    }];
  }));
}

export function demoAlerts(routes: string[], stop?: string): MbtaAlert[] {
  if (stop && stop !== 'place-kencl') return [];
  const routeIds = routes.filter((route) => route.startsWith('Green'));
  return routeIds.length ? [{
    id: 'demo-green-platform', header: 'Demo alert: Green Line platform changes',
    description: 'Example service advisory for the FareSight demonstration.',
    severity: 3, effect: 'STATION_ISSUE', route_ids: routeIds, stop_ids: ['place-kencl'], url: null,
  }] : [];
}
