/**
 * Bakes the MBTA network into GeoJSON for the 3D map.
 *
 * The v3 API serves route geometry as encoded polylines, one per pattern. Each route
 * carries several patterns (short turns, diversions); the ones prefixed `canonical-`
 * are the full-length reference shapes, so we prefer those.
 *
 * Run: node scripts/build-transit-geo.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clipLine, inCore } from './core.mjs';

const API = 'https://api-v3.mbta.com';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');

/**
 * Drawn back-to-front. `offset` fans branches apart where they share a trunk — the
 * four Green Line shapes run as parallel ribbons through the Boylston subway the same
 * way AP Transit splits the NYC trunk lines, instead of stacking into one fat stripe.
 */
const ROUTES = [
  { id: 'Green-E', offset: -1.5 },
  { id: 'Green-D', offset: -0.5 },
  { id: 'Green-C', offset: 0.5 },
  { id: 'Green-B', offset: 1.5 },
  { id: 'Mattapan', offset: 0 },
  { id: 'Blue', offset: 0 },
  { id: 'Orange', offset: 0 },
  { id: 'Red', offset: 0 },
];

/** MBTA's own designation. Enough bus presence to read like a city, without 170 routes. */
const BUS_ROUTES = ['741', '742', '743', '751', '749', '1', '15', '22', '23', '28', '32', '39', '57', '66', '71', '73', '77', '111', '116'];

const key = process.env.MBTA_API_KEY?.trim();
const headers = key ? { 'x-api-key': key } : {};

async function api(path) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${API}${path}`, { headers });
    if (res.ok) return res.json();
    // Keyless callers get 429'd under load; back off rather than losing the route.
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      continue;
    }
    throw new Error(`MBTA ${path} answered ${res.status}`);
  }
  throw new Error(`MBTA ${path} kept rate-limiting`);
}

/** Google's encoded-polyline algorithm, precision 5. Returns [lon, lat] for GeoJSON. */
function decodePolyline(encoded) {
  const points = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    for (const axis of ['lat', 'lon']) {
      let result = 0, shift = 0, byte;
      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 'lat') lat += delta; else lon += delta;
    }
    points.push([lon / 1e5, lat / 1e5]);
  }
  return points;
}

async function shapesFor(routeId, { max = 4 } = {}) {
  const { data } = await api(`/shapes?filter%5Broute%5D=${encodeURIComponent(routeId)}`);
  const decoded = data
    .map((s) => ({ id: s.id, points: decodePolyline(s.attributes.polyline ?? '') }))
    .filter((s) => s.points.length > 1);
  const canonical = decoded.filter((s) => s.id.startsWith('canonical-'));
  const chosen = canonical.length ? canonical : decoded;
  return chosen.sort((a, b) => b.points.length - a.points.length).slice(0, canonical.length ? max : 1);
}

async function main() {
  const routeIndex = new Map(
    (await api('/routes?filter%5Btype%5D=0,1,3')).data.map((r) => [r.id, r.attributes]),
  );

  const lineFeatures = [];
  const stationIndex = new Map();

  for (const { id: routeId, offset } of ROUTES) {
    const attrs = routeIndex.get(routeId);
    if (!attrs) { console.warn(`! ${routeId} missing; skipping`); continue; }
    const color = `#${attrs.color}`;

    for (const shape of await shapesFor(routeId)) {
      // Clip to the modelled core; the deck this stands in for never reached Riverside.
      for (const run of clipLine(shape.points)) {
        lineFeatures.push({
          type: 'Feature',
          properties: { routeId, name: attrs.long_name, color, offset, shapeId: shape.id },
          geometry: { type: 'LineString', coordinates: run },
        });
      }
    }

    const { data: stops } = await api(
      `/stops?filter%5Broute%5D=${encodeURIComponent(routeId)}&fields%5Bstop%5D=name,latitude,longitude,wheelchair_boarding`,
    );
    for (const stop of stops) {
      const { latitude, longitude, name, wheelchair_boarding } = stop.attributes;
      if (latitude == null || longitude == null) continue;
      if (!inCore([longitude, latitude])) continue;
      const existing = stationIndex.get(stop.id);
      if (existing) {
        if (!existing.properties.routes.includes(routeId)) existing.properties.routes.push(routeId);
        continue;
      }
      stationIndex.set(stop.id, {
        type: 'Feature',
        properties: {
          id: stop.id,
          name,
          routes: [routeId],
          color,
          // 1 is fully accessible, 2 is explicitly not, 0 is unknown.
          accessible: wheelchair_boarding === 1,
        },
        geometry: { type: 'Point', coordinates: [longitude, latitude] },
      });
    }
    console.log(`  ${routeId.padEnd(9)} ${String(stops.length).padStart(3)} stops`);
  }

  const stations = [...stationIndex.values()];
  for (const s of stations) {
    s.properties.interchange = s.properties.routes.length > 1;
    // The bullet strip renders one disc per service, Green branches collapsed to a letter.
    s.properties.bullets = s.properties.routes
      .map((r) => (r.startsWith('Green-') ? r.slice(6) : r[0]))
      .join('');
  }

  /* --- bus: thin lines and stop pins, the texture under the rapid transit --- */

  const busFeatures = [];
  const busStopIndex = new Map();
  for (const routeId of BUS_ROUTES) {
    const attrs = routeIndex.get(routeId);
    if (!attrs) continue;
    try {
      for (const shape of await shapesFor(routeId, { max: 2 })) {
        for (const run of clipLine(shape.points)) {
          busFeatures.push({
            type: 'Feature',
            properties: { routeId, name: attrs.long_name, color: `#${attrs.color}` },
            geometry: { type: 'LineString', coordinates: run },
          });
        }
      }
      const { data: stops } = await api(
        `/stops?filter%5Broute%5D=${encodeURIComponent(routeId)}&fields%5Bstop%5D=name,latitude,longitude`,
      );
      for (const stop of stops) {
        const { latitude, longitude, name } = stop.attributes;
        if (latitude == null || longitude == null || busStopIndex.has(stop.id)) continue;
        if (!inCore([longitude, latitude])) continue;
        busStopIndex.set(stop.id, {
          type: 'Feature',
          properties: { id: stop.id, name },
          geometry: { type: 'Point', coordinates: [longitude, latitude] },
        });
      }
    } catch (err) {
      console.warn(`  ! bus ${routeId}: ${err.message}`);
    }
  }
  console.log(`  bus       ${String(busFeatures.length).padStart(3)} shapes, ${busStopIndex.size} stops`);

  mkdirSync(OUT, { recursive: true });
  const write = (file, features) =>
    writeFileSync(`${OUT}/${file}`, JSON.stringify({ type: 'FeatureCollection', features }));

  write('mbta-lines.geojson', lineFeatures);
  write('mbta-stations.geojson', stations);
  write('mbta-bus.geojson', busFeatures);
  write('mbta-bus-stops.geojson', [...busStopIndex.values()]);

  console.log(`\n${lineFeatures.length} rail shapes, ${stations.length} stations, ${busFeatures.length} bus shapes -> public/data/`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
