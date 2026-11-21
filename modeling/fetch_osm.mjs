import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { places } from '../server/src/db/seed.ts';
import { focal } from './transit.mjs';

// Each station is modelled as a square crop small enough for buildings to read at a realistic
// scale on the 0.856 m deck. The crop is placed to keep as many curated venues in range as
// possible; venues that still fall outside are listed as off-deck markers by segments.mjs.
const SPANS = [400, 420, 440, 460, 480];
const VENUE_MARGIN = 0.9; // venues and the station stay inside this fraction of the half-span
const stops = JSON.parse(readFileSync(new URL('./stops.json', import.meta.url)));

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

const metersPerLat = 110540;
const metersPerLon = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

function chooseArea(stopId, stationName, label) {
  const [lat0, lon0] = stops[stationName];
  const venues = places
    .filter((p) => p.stop_id === stopId)
    .map((p) => [(p.lon - lon0) * metersPerLon(lat0), -(p.lat - lat0) * metersPerLat]);
  let best;
  for (const span of SPANS) {
    const inner = (span / 2) * VENUE_MARGIN;
    for (let cx = -inner; cx <= inner; cx += 5)
      for (let cz = -inner; cz <= inner; cz += 5) {
        const inside = venues.filter(
          (v) => Math.abs(v[0] - cx) <= inner && Math.abs(v[1] - cz) <= inner,
        );
        // Prefer the window that centres the station and its in-range venues.
        const pts = [[0, 0], ...inside];
        const mid = [0, 1].map(
          (k) => (Math.min(...pts.map((p) => p[k])) + Math.max(...pts.map((p) => p[k]))) / 2,
        );
        const offCentre = Math.hypot(cx - mid[0], cz - mid[1]);
        const candidate = { span, cx, cz, count: inside.length, offCentre };
        if (
          !best ||
          candidate.count > best.count ||
          (candidate.count === best.count && span === best.span && offCentre < best.offCentre)
        )
          best = candidate;
      }
  }
  return {
    stopId,
    name: label,
    centerLat: Number((lat0 - best.cz / metersPerLat).toFixed(5)),
    centerLon: Number((lon0 + best.cx / metersPerLon(lat0)).toFixed(5)),
    spanMeters: best.span,
    venuesInRange: best.count,
    venuesTotal: venues.length,
  };
}

function bboxFor(area) {
  const half = area.spanMeters / 2;
  const dLat = half / metersPerLat;
  const dLon = half / metersPerLon(area.centerLat);
  return {
    south: area.centerLat - dLat,
    west: area.centerLon - dLon,
    north: area.centerLat + dLat,
    east: area.centerLon + dLon,
  };
}

function meters(value) {
  if (value == null) return null;
  const raw = String(value).trim().toLowerCase();
  const num = parseFloat(raw);
  if (!Number.isFinite(num) || num < 0) return null;
  return raw.includes('ft') || raw.includes("'") ? num * 0.3048 : num;
}
const count = (value) => {
  const num = parseFloat(String(value ?? ''));
  return Number.isFinite(num) && num >= 0 ? num : null;
};

async function queryOverpass(ql) {
  let lastError;
  // The public mirrors are often busy, so cycle through them several times with a growing pause.
  for (let round = 0; round < 8; round++) {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'User-Agent': 'osm-diorama-builder/1.0',
          },
          body: 'data=' + encodeURIComponent(ql),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${endpoint}`);
        const json = await res.json();
        if (!Array.isArray(json.elements)) throw new Error('Invalid Overpass response');
        return json;
      } catch (err) {
        lastError = err;
        console.log(`  retrying after: ${err.message}`);
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
    await new Promise((r) => setTimeout(r, 15_000 * (round + 1)));
  }
  throw lastError;
}

const round = (p) => [Number(p[0].toFixed(2)), Number(p[1].toFixed(2))];
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
const signedArea = (ring) =>
  ring.reduce((n, a, i) => {
    const b = ring[(i + 1) % ring.length];
    return n + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;

// Join the member ways of a multipolygon into closed rings.
function assembleRings(ways) {
  const open = ways.map((w) => w.slice());
  const rings = [];
  const same = (a, b) => Math.abs(a[0] - b[0]) < 0.02 && Math.abs(a[1] - b[1]) < 0.02;
  while (open.length) {
    let ring = open.pop();
    let grew = true;
    while (!same(ring[0], ring.at(-1)) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i];
        if (same(ring.at(-1), w[0])) ring = ring.concat(w.slice(1));
        else if (same(ring.at(-1), w.at(-1))) ring = ring.concat(w.toReversed().slice(1));
        else if (same(ring[0], w.at(-1))) ring = w.concat(ring.slice(1));
        else if (same(ring[0], w[0])) ring = w.toReversed().concat(ring.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring.at(-1))) rings.push(ring.slice(0, -1));
  }
  return rings;
}

// Cut each courtyard into its outer ring through a 6 cm slit, leaving one simple polygon.
function cutHoles(outer, holes) {
  let ring = signedArea(outer) < 0 ? outer.toReversed() : outer.slice();
  for (const rawHole of holes.toSorted((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))) {
    const hole = signedArea(rawHole) > 0 ? rawHole.toReversed() : rawHole.slice();
    let best;
    for (let i = 0; i < ring.length; i++)
      for (let j = 0; j < hole.length; j++) {
        const d = Math.hypot(ring[i][0] - hole[j][0], ring[i][1] - hole[j][1]);
        if (!best || d < best.d) best = { d, i, j };
      }
    if (!best || best.d < 0.2) continue;
    const a = ring[best.i],
      b = hole[best.j];
    const nx = (-(b[1] - a[1]) / best.d) * 0.03,
      nz = ((b[0] - a[0]) / best.d) * 0.03;
    const loop = [...hole.slice(best.j), ...hole.slice(0, best.j)];
    ring = [
      ...ring.slice(0, best.i),
      [a[0] + nx, a[1] + nz],
      [b[0] + nx, b[1] + nz],
      ...loop.slice(1),
      [b[0] - nx, b[1] - nz],
      [a[0] - nx, a[1] - nz],
      ...ring.slice(best.i + 1),
    ];
  }
  return ring;
}

async function fetchArea(area) {
  const b = bboxFor(area);
  const bb = `${b.south.toFixed(6)},${b.west.toFixed(6)},${b.north.toFixed(6)},${b.east.toFixed(6)}`;
  const ql = `
[out:json][timeout:80];
(
  way["building"](${bb});
  way["building:part"](${bb});
  relation["type"="multipolygon"]["building"](${bb});
  relation["type"="multipolygon"]["building:part"](${bb});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian|footway|path|cycleway|service)(_link)?$"](${bb});
  way["railway"~"^(light_rail|tram|rail|platform)$"](${bb});
  way["leisure"~"^(park|pitch|garden|stadium|playground)$"](${bb});
  relation["type"="multipolygon"]["leisure"~"^(park|garden)$"](${bb});
  way["landuse"~"^(grass|meadow|recreation_ground|village_green|cemetery)$"](${bb});
  way["natural"~"^(water|wood)$"](${bb});
  relation["type"="multipolygon"]["natural"="water"](${bb});
  way["amenity"="parking"](${bb});
  way["natural"="tree_row"](${bb});
  node["natural"="tree"](${bb});
);
out body geom;
`;
  const data = await queryOverpass(ql);
  const project = (g) =>
    round([
      (g.lon - area.centerLon) * metersPerLon(area.centerLat),
      -(g.lat - area.centerLat) * metersPerLat,
    ]);
  const buildings = [],
    roads = [],
    rails = [],
    platforms = [],
    parks = [],
    waters = [],
    parking = [],
    trees = [];
  const seen = new Set();

  function building(id, tags, ring) {
    ring = simplifyRing(ring, 0.36);
    if (ring.length < 3 || Math.abs(signedArea(ring)) < 4) return;
    const height = meters(tags.height ?? tags['building:height']);
    const levels = count(tags['building:levels']);
    buildings.push({
      id,
      name: tags.name ?? null,
      kind: tags.building ?? tags['building:part'] ?? 'yes',
      part: !tags.building,
      heightM: height && height > 0 ? Number(height.toFixed(1)) : null,
      levels,
      minHeightM: meters(tags.min_height) ?? (count(tags['building:min_level']) ?? 0) * 3.2,
      roofShape: tags['roof:shape'] ?? null,
      roofHeightM: meters(tags['roof:height']),
      roofLevels: count(tags['roof:levels']),
      colour: tags['building:colour'] ?? tags['building:color'] ?? null,
      roofColour: tags['roof:colour'] ?? tags['roof:color'] ?? null,
      material: tags['building:material'] ?? null,
      shop: Boolean(tags.shop || tags.amenity),
      ring,
    });
  }

  for (const el of data.elements) {
    const tags = el.tags ?? {};
    if (seen.has(el.type + el.id)) continue;
    seen.add(el.type + el.id);
    if (el.type === 'node') {
      if (tags.natural === 'tree') trees.push(project(el));
      continue;
    }
    if (el.type === 'relation') {
      const member = (role) =>
        (el.members ?? [])
          .filter((m) => m.type === 'way' && m.role === role && m.geometry?.length > 1)
          .map((m) => m.geometry.map(project));
      const outers = assembleRings(member('outer'));
      const inners = assembleRings(member('inner'));
      for (const [i, outer] of outers.entries()) {
        const mine = inners.filter((h) => contains(outer, h[0]));
        const id = el.id * 10 + i + 9e9;
        if (tags.building || tags['building:part']) building(id, tags, cutHoles(outer, mine));
        else if (tags.natural === 'water')
          waters.push({ id, name: tags.name ?? null, ring: simplifyRing(outer, 4) });
        else if (tags.leisure)
          parks.push({ id, name: tags.name ?? null, kind: tags.leisure, ring: simplifyRing(outer, 2) });
      }
      continue;
    }
    if (!Array.isArray(el.geometry) || el.geometry.length < 2) continue;
    const pts = el.geometry.map(project);
    const closed =
      pts.length >= 4 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1];
    const tunnel = tags.tunnel && tags.tunnel !== 'no' && tags.tunnel !== 'building_passage';

    if (tags.building || tags['building:part']) {
      if (closed) building(el.id, tags, pts.slice(0, -1));
    } else if (tags.railway === 'platform') {
      if (!tunnel && tags.level == null && tags.layer == null)
        platforms.push({ id: el.id, closed, points: closed ? pts.slice(0, -1) : pts });
    } else if (tags.railway) {
      if (!tunnel) rails.push({ id: el.id, kind: tags.railway, points: simplifyRing(pts, 1) });
    } else if (tags.highway) {
      const kind = tags.highway.replace(/_link$/, '');
      const sub = tags.footway ?? tags.service ?? null;
      if (tunnel || (tags.area === 'yes' && kind !== 'pedestrian')) continue;
      if (sub === 'sidewalk' || sub === 'crossing' || sub === 'parking_aisle') continue;
      const major = /^(motorway|trunk|primary|secondary|tertiary)$/.test(kind);
      roads.push({
        id: el.id,
        kind,
        major,
        name: tags.name ?? null,
        lanes: count(tags.lanes),
        widthM: meters(tags.width),
        oneway: tags.oneway === 'yes',
        bridge: Boolean(tags.bridge && tags.bridge !== 'no'),
        points: simplifyRing(pts, major ? 2 : 4),
      });
    } else if (tags.natural === 'tree_row') {
      let carried = 0;
      for (let i = 1; i < pts.length; i++) {
        const length = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        for (let d = (9 - carried) % 9; d < length; d += 9)
          trees.push(round(pts[i - 1].map((v, k) => v + ((pts[i][k] - v) * d) / length)));
        carried = (carried + length) % 9;
      }
    } else if (!closed) {
      continue;
    } else if (tags.natural === 'water') {
      waters.push({ id: el.id, name: tags.name ?? null, ring: simplifyRing(pts.slice(0, -1), 4) });
    } else if (tags.amenity === 'parking') {
      if (!tags.parking || tags.parking === 'surface')
        parking.push({ id: el.id, ring: simplifyRing(pts.slice(0, -1), 2) });
    } else if (tags.leisure || tags.landuse || tags.natural === 'wood') {
      parks.push({
        id: el.id,
        name: tags.name ?? null,
        kind: tags.leisure ?? tags.landuse ?? 'wood',
        ring: simplifyRing(pts.slice(0, -1), 2),
      });
    }
  }

  console.log(
    `${area.stopId} (${area.name}): ${area.spanMeters} m crop, ${area.venuesInRange}/${area.venuesTotal} venues in range, ` +
      `${buildings.length} buildings, ${roads.length} roads, ${rails.length} rails, ${trees.length} trees, ` +
      `${parks.length} parks, ${waters.length} water`,
  );
  return {
    ...area,
    bbox: b,
    buildings,
    roads,
    rails,
    platforms,
    parks,
    waters,
    parking,
    trees,
  };
}

function contains(ring, [x, z]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i],
      [c, d] = ring[j];
    if (b > z !== d > z && x < a + ((c - a) * (z - b)) / (d - b)) inside = !inside;
  }
  return inside;
}

// Crops already fetched with the same centre and span are reused; pass --refresh to re-download.
const outPath = fileURLToPath(new URL('./osm-data.json', import.meta.url));
const refresh = process.argv.includes('--refresh');
const cached = existsSync(outPath) ? (JSON.parse(readFileSync(outPath, 'utf8')).areas ?? {}) : {};
const areas = {};
for (const [stopId, stationName, label] of focal) {
  const area = chooseArea(stopId, stationName, label);
  const old = cached[stopId];
  if (
    !refresh &&
    old?.rails &&
    old.centerLat === area.centerLat &&
    old.centerLon === area.centerLon &&
    old.spanMeters === area.spanMeters
  ) {
    areas[stopId] = old;
    console.log(`${stopId} (${label}): cached (${old.buildings.length} buildings)`);
    continue;
  }
  areas[stopId] = await fetchArea(area);
  writeFileSync(
    outPath,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      attribution: 'OpenStreetMap contributors (ODbL)',
      areas: { ...cached, ...areas },
    }),
  );
  await new Promise((r) => setTimeout(r, 2500));
}
console.log(`Wrote ${outPath}`);
