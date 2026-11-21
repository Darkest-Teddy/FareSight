import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Bounding areas centered so every curated place + iconic neighborhood landmark sits cleanly on the 0.856 m cartridge deck.
const AREAS = [
  { stopId: 'place-bucen', name: 'BU Central', centerLat: 42.3504, centerLon: -71.1066, spanMeters: 560 },
  { stopId: 'place-brico', name: "Packard's Corner", centerLat: 42.3534, centerLon: -71.1278, spanMeters: 880 },
  { stopId: 'place-kencl', name: 'Kenmore', centerLat: 42.3489, centerLon: -71.0972, spanMeters: 780 },
  { stopId: 'place-harsq', name: 'Harvard', centerLat: 42.3735, centerLon: -71.1176, spanMeters: 680 },
  { stopId: 'place-chncl', name: 'Chinatown', centerLat: 42.3526, centerLon: -71.0609, spanMeters: 560 },
];

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

function bboxFor(area) {
  const half = area.spanMeters / 2;
  const dLat = half / 110540;
  const dLon = half / (111320 * Math.cos((area.centerLat * Math.PI) / 180));
  return {
    south: area.centerLat - dLat,
    west: area.centerLon - dLon,
    north: area.centerLat + dLat,
    east: area.centerLon + dLon,
  };
}

function parseHeightMeters(tags = {}) {
  if (tags.height) {
    const raw = String(tags.height).trim().toLowerCase();
    const num = parseFloat(raw);
    if (Number.isFinite(num) && num > 0) {
      if (raw.includes('ft') || raw.includes("'")) return num * 0.3048;
      return num;
    }
  }
  if (tags['building:levels']) {
    const levels = parseFloat(String(tags['building:levels']));
    if (Number.isFinite(levels) && levels > 0) return levels * 3.2;
  }
  return 10.5;
}

async function queryOverpass(ql) {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'FareSight-BostonHacks-2026/1.0',
          },
          body: 'data=' + encodeURIComponent(ql),
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
        const json = await res.json();
        if (!Array.isArray(json.elements)) throw new Error('Invalid Overpass response');
        return json;
      } catch (err) {
        lastError = err;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  }
  throw lastError;
}

function simplifyRing(ring, minDistSq) {
  if (ring.length <= 4) return ring;
  const out = [ring[0]];
  for (let i = 1; i < ring.length - 1; i++) {
    const prev = out[out.length - 1];
    const dx = ring[i][0] - prev[0];
    const dz = ring[i][1] - prev[1];
    if (dx * dx + dz * dz >= minDistSq) out.push(ring[i]);
  }
  return out;
}

function projectToMeters(lat, lon, centerLat, centerLon) {
  const x = (lon - centerLon) * 111320 * Math.cos((centerLat * Math.PI) / 180);
  const z = -(lat - centerLat) * 110540;
  return [Number(x.toFixed(2)), Number(z.toFixed(2))];
}

async function fetchArea(area) {
  const b = bboxFor(area);
  const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  const ql = `
[out:json][timeout:35];
(
  way["building"](${bb});
  way["building:part"](${bb});
  way["highway"~"^(primary|secondary|tertiary|residential|unclassified|pedestrian|footway|service)$"](${bb});
  way["leisure"~"^(park|pitch|garden|stadium)$"](${bb});
  way["landuse"~"^(grass|meadow|recreation_ground|village_green)$"](${bb});
  way["natural"="water"](${bb});
  way["waterway"="riverbank"](${bb});
);
out body geom;
`;
  const data = await queryOverpass(ql);
  const buildings = [];
  const roads = [];
  const parks = [];
  const waters = [];
  const seenBuildingIds = new Set();

  for (const el of data.elements) {
    if (el.type !== 'way' || !Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const tags = el.tags ?? {};
    const pts = el.geometry.map((g) => projectToMeters(g.lat, g.lon, area.centerLat, area.centerLon));

    if (tags.building || tags['building:part']) {
      if (pts.length < 4 || seenBuildingIds.has(el.id)) continue;
      seenBuildingIds.add(el.id);
      const ring = simplifyRing(pts, 1.2);
      if (ring.length < 3) continue;
      buildings.push({
        id: el.id,
        name: tags.name ?? null,
        kind: tags.building ?? tags['building:part'] ?? 'yes',
        heightM: Number(parseHeightMeters(tags).toFixed(1)),
        levels: tags['building:levels'] ? Number(tags['building:levels']) : null,
        ring,
      });
    } else if (tags.highway) {
      const major = /^(primary|secondary|tertiary)$/.test(tags.highway);
      roads.push({
        id: el.id,
        kind: tags.highway,
        major,
        points: simplifyRing(pts, major ? 4 : 9),
      });
    } else if (tags.natural === 'water' || tags.waterway === 'riverbank') {
      if (pts.length >= 4) waters.push({ id: el.id, name: tags.name ?? null, ring: simplifyRing(pts, 6) });
    } else if (tags.leisure || tags.landuse) {
      if (pts.length >= 4) parks.push({ id: el.id, name: tags.name ?? null, kind: tags.leisure ?? tags.landuse, ring: simplifyRing(pts, 4) });
    }
  }

  console.log(
    `${area.stopId} (${area.name}): ${buildings.length} buildings, ${roads.length} roads, ${parks.length} parks, ${waters.length} water`,
  );
  return {
    stopId: area.stopId,
    name: area.name,
    centerLat: area.centerLat,
    centerLon: area.centerLon,
    spanMeters: area.spanMeters,
    bbox: b,
    buildings,
    roads,
    parks,
    waters,
  };
}

const out = {};
for (const area of AREAS) {
  out[area.stopId] = await fetchArea(area);
  await new Promise((r) => setTimeout(r, 700));
}

const outPath = fileURLToPath(new URL('./osm-data.json', import.meta.url));
writeFileSync(outPath, JSON.stringify({ fetchedAt: new Date().toISOString(), attribution: 'OpenStreetMap contributors (ODbL)', areas: out }));
console.log('Saved real OSM dataset to ' + outPath);
