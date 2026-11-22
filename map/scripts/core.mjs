/**
 * The footprint this map models.
 *
 * FareSight's original map sculpture is a 1.476 x 1.026 deck — a 1.44 landscape plaque
 * carrying five curated stations, not the whole MBTA. Riverside and Wonderland are
 * nowhere on it. This box is that same deck expressed in degrees: the bounding box of
 * those five stations, padded, with the latitude span set so the result is 1.44 wide,
 * matching the deck it is standing in for.
 *
 * Everything baked for this map gets clipped to it. Without the clip the network runs
 * twelve miles west to Newton and the model scale collapses.
 */

/** The stations the original deck was built around. */
export const CURATED = [
  { id: 'place-bucen', name: 'BU Central', lat: 42.3504, lon: -71.1066 },
  { id: 'place-brico', name: "Packard's Corner", lat: 42.3534, lon: -71.1278 },
  { id: 'place-kencl', name: 'Kenmore', lat: 42.3489, lon: -71.0972 },
  { id: 'place-harsq', name: 'Harvard', lat: 42.3735, lon: -71.1176 },
  { id: 'place-chncl', name: 'Chinatown', lat: 42.3526, lon: -71.0609 },
];

export const CORE = {
  west: -71.1375,
  east: -71.0512,
  south: 42.3389,
  north: 42.3835,
};

/**
 * The area buildings are baked over — the deck plus a margin.
 *
 * The deck is the *subject*: lines and stations are clipped to it. But a viewport is
 * wider than 1.44 and a pitched camera sees well past the far edge, so building only
 * the deck leaves bare basemap around the model. AP Transit never shows an edge; the
 * city runs to every border of the screen. This margin is what pays for that — about
 * 11.2km by 8.9km, which covers the frame at the opening zoom with room to pan.
 */
export const CANVAS = {
  west: CORE.west - 0.025,
  east: CORE.east + 0.025,
  south: CORE.south - 0.018,
  north: CORE.north + 0.018,
};

export function inCanvas([lon, lat]) {
  return lon >= CANVAS.west && lon <= CANVAS.east && lat >= CANVAS.south && lat <= CANVAS.north;
}

export const CORE_CENTER = [(CORE.west + CORE.east) / 2, (CORE.south + CORE.north) / 2];

export function inCore([lon, lat]) {
  return lon >= CORE.west && lon <= CORE.east && lat >= CORE.south && lat <= CORE.north;
}

/**
 * Split a line into the runs that fall inside the core. A route that leaves and
 * re-enters comes back as separate pieces rather than a chord across the gap.
 */
export function clipLine(coordinates) {
  const runs = [];
  let run = [];
  for (const point of coordinates) {
    if (inCore(point)) {
      run.push(point);
    } else if (run.length) {
      // Carry one step past the edge so the ribbon reaches the boundary, not short of it.
      run.push(point);
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length > 1);
}
