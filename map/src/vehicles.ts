import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { Feature, Point } from 'geojson';
import { MBTA_COLORS } from './layers';

/**
 * Live train positions from the MBTA v3 API.
 *
 * The feed updates every few seconds, but trains only report every 5-15s and jump
 * between reports. Rather than teleport the markers we interpolate each vehicle from
 * where it was drawn to where it now is, which reads as motion instead of a twitch.
 */
const API = 'https://api-v3.mbta.com';
const POLL_MS = 10_000;
const GLIDE_MS = 2_400;

interface Vehicle {
  id: string;
  routeId: string;
  color: string;
  bearing: number;
  status: string;
  /** Where the marker is drawn right now, and where it is gliding to. */
  from: [number, number];
  to: [number, number];
  startedAt: number;
}

const vehicles = new Map<string, Vehicle>();
let raf = 0;

function feature(v: Vehicle, position: [number, number]): Feature<Point> {
  return {
    type: 'Feature',
    properties: { id: v.id, routeId: v.routeId, color: v.color, bearing: v.bearing, status: v.status },
    geometry: { type: 'Point', coordinates: position },
  };
}

/** Cubic ease-out: quick off the mark, settling into the new report. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function addVehicles(map: MapLibreMap) {
  map.addSource('mbta-vehicles', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  });

  // A white collar so a train stays visible against its own route ribbon.
  map.addLayer({
    id: 'vehicle-halo',
    type: 'circle',
    source: 'mbta-vehicles',
    minzoom: 11,
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4.5, 15, 8, 18, 12],
      'circle-opacity': 0.95,
    },
  });

  map.addLayer({
    id: 'vehicle',
    type: 'circle',
    source: 'mbta-vehicles',
    minzoom: 11,
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 3, 15, 5.5, 18, 8.5],
      // A stopped train dims slightly, so dwell reads differently from running.
      'circle-opacity': ['case', ['==', ['get', 'status'], 'STOPPED_AT'], 0.65, 1],
    },
  });

  void poll();
  setInterval(() => void poll(), POLL_MS);
  tick(map);
}

async function poll() {
  try {
    const res = await fetch(
      `${API}/vehicles?filter%5Broute_type%5D=0,1&fields%5Bvehicle%5D=latitude,longitude,bearing,current_status`,
    );
    if (!res.ok) return;
    const { data } = (await res.json()) as { data: Array<Record<string, any>> };

    const now = performance.now();
    const seen = new Set<string>();

    for (const item of data) {
      const { latitude, longitude, bearing, current_status } = item.attributes;
      if (latitude == null || longitude == null) continue;
      const routeId: string | undefined = item.relationships?.route?.data?.id;
      if (!routeId || !(routeId in MBTA_COLORS)) continue;

      seen.add(item.id);
      const target: [number, number] = [longitude, latitude];
      const existing = vehicles.get(item.id);

      vehicles.set(item.id, {
        id: item.id,
        routeId,
        color: MBTA_COLORS[routeId],
        bearing: bearing ?? 0,
        status: current_status ?? '',
        // Glide from wherever the marker currently sits, not from the last report.
        from: existing ? positionOf(existing, now) : target,
        to: target,
        startedAt: now,
      });
    }

    // Trains that went out of service shouldn't linger on the map.
    for (const id of [...vehicles.keys()]) if (!seen.has(id)) vehicles.delete(id);
  } catch {
    // A dropped poll is not worth surfacing; the next one is ten seconds away.
  }
}

function positionOf(v: Vehicle, now: number): [number, number] {
  const t = Math.min(1, (now - v.startedAt) / GLIDE_MS);
  const k = ease(t);
  return [v.from[0] + (v.to[0] - v.from[0]) * k, v.from[1] + (v.to[1] - v.from[1]) * k];
}

function tick(map: MapLibreMap) {
  const source = map.getSource('mbta-vehicles') as GeoJSONSource | undefined;
  if (source) {
    const now = performance.now();
    source.setData({
      type: 'FeatureCollection',
      features: [...vehicles.values()].map((v) => feature(v, positionOf(v, now))),
    });
  }
  raf = requestAnimationFrame(() => tick(map));
}

export function stopVehicles() {
  cancelAnimationFrame(raf);
}

export function vehicleCount() {
  return vehicles.size;
}
