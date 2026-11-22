import type { ExpressionSpecification, Map as MapLibreMap } from 'maplibre-gl';

/**
 * The AP Transit read works because the city is drained of colour and the network is the
 * only saturated thing on screen. Buildings are near-white greys separated by a faint
 * height ramp; the whole hue budget goes to the transit.
 */
const BUILDING_LOW = '#e6e7e9';
const BUILDING_MID = '#d8dadd';
const BUILDING_HIGH = '#c2c6cc';

/**
 * The deck carries almost no relief: 0.024 of height across 1.476 of width, about 1.6%.
 * Real massing at true scale would tower over a model this compressed, so heights are
 * damped to keep the city reading as a plaque the ribbons travel across.
 */
const HEIGHT_SCALE = 0.55;

/**
 * `h` is metres, baked from OSM's own `height` / `building:levels` by
 * scripts/build-buildings.mjs, then damped to model relief.
 */
const HEIGHT: ExpressionSpecification = ['*', ['coalesce', ['get', 'h'], 10], HEIGHT_SCALE];

export const MBTA_COLORS: Record<string, string> = {
  Red: '#DA291C',
  Mattapan: '#DA291C',
  Orange: '#ED8B00',
  Blue: '#003DA5',
  'Green-B': '#00843D',
  'Green-C': '#00843D',
  'Green-D': '#00843D',
  'Green-E': '#00843D',
};

/**
 * The modelled footprint — the same ground the original FareSight map sculpture covers.
 * That deck is 1.476 x 1.026 (a 1.44 landscape plaque) holding five curated stations,
 * so this box is those stations' extent padded to the identical 1.44 aspect: 7.10km by
 * 4.93km. Kept in step with `scripts/core.mjs`, which clips the baked data to match.
 */
export const CORE: [[number, number], [number, number]] = [
  [-71.1375, 42.3389],
  [-71.0512, 42.3835],
];

/**
 * Opens with the deck filling the frame, the way the sculpture reads on a table.
 *
 * At latitude 42.36 a pixel spans 115_655 / 2^zoom metres, so z14.4 puts the 7.10km
 * footprint across about 1500px — the deck edge to edge. Pulling back to z13 instead
 * shows twenty kilometres of Massachusetts and the model scale is gone.
 */
export const HOME = {
  center: [-71.0943, 42.3600] as [number, number],
  // z14.2 puts the deck's 4.93km height across the viewport almost exactly.
  zoom: 14.2,
  // Steeper than this and the view runs far past the deck's north edge into Somerville,
  // where nothing is baked; 42 degrees keeps the massing readable without overshooting.
  pitch: 42,
  bearing: -20,
};

/**
 * Panning stops before the baked canvas runs out, so the frame is never half city and
 * half blank. Tighter than the canvas itself because a pitched camera sees well past
 * the centre point.
 */
export const BOUNDS: [[number, number], [number, number]] = [
  [-71.148, 42.332],
  [-71.041, 42.391],
];

/** Minimum zoom — any further out and the canvas edge comes into frame. */
export const MIN_ZOOM = 13.4;

/**
 * Ribbon width in screen pixels, by zoom. Casing and offset are both derived from these
 * same stops so the three stay locked together as you zoom.
 *
 * MapLibre only accepts a `zoom` expression as the direct input of a top-level
 * `interpolate`, so these helpers bake the scale factor into the stop *values* rather
 * than multiplying the finished expression — `['*', WIDTH, 1.8]` is rejected outright.
 */
const WIDTH_STOPS: ReadonlyArray<readonly [number, number]> = [
  [10, 2.4],
  [13, 4.8],
  [15, 7.5],
  [17, 12],
  [19, 18],
];

/** A width curve scaled by `factor`. */
function widthAt(factor: number): ExpressionSpecification {
  return [
    'interpolate',
    ['exponential', 1.45],
    ['zoom'],
    ...WIDTH_STOPS.flatMap(([zoom, width]) => [zoom, width * factor]),
  ] as ExpressionSpecification;
}

/**
 * Lateral shift, in the same units, multiplied per feature by its `offset` lane index.
 * The data expression sits in the interpolate's output, which is allowed; only the
 * zoom input has to stay at the top.
 */
function offsetAt(factor: number): ExpressionSpecification {
  return [
    'interpolate',
    ['exponential', 1.45],
    ['zoom'],
    ...WIDTH_STOPS.flatMap(([zoom, width]) => [
      zoom,
      ['*', ['coalesce', ['get', 'offset'], 0], width * factor],
    ]),
  ] as ExpressionSpecification;
}

/** The first symbol layer, so extrusions slide under the basemap's labels. */
function firstSymbolLayer(map: MapLibreMap): string | undefined {
  return map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
}

export function addBuildings(map: MapLibreMap) {
  // Positron ships a flat 2D building fill that would z-fight with the extrusion, and
  // its vector `building` layer only exists at z13-14 — which is exactly why the city
  // used to pop into being mid-zoom. Both go; the baked corridor replaces them.
  if (map.getLayer('building')) map.removeLayer('building');

  map.addSource('corridor-buildings', {
    type: 'geojson',
    data: '/data/corridor-buildings.geojson',
  });

  map.addLayer(
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'corridor-buildings',
      // No minzoom and no tile floor: the massing is extruded at every scale, so the
      // model is solid the moment it loads and stays solid all the way in.
      paint: {
        'fill-extrusion-color': [
          'interpolate',
          ['linear'],
          HEIGHT,
          0, BUILDING_LOW,
          20, BUILDING_MID,
          60, BUILDING_HIGH,
          140, '#b4b9c1',
        ],
        'fill-extrusion-height': HEIGHT,
        'fill-extrusion-base': 0,
        'fill-extrusion-opacity': 0.95,
        'fill-extrusion-vertical-gradient': true,
      },
    },
    firstSymbolLayer(map),
  );
}

/** Flat icons drawn at runtime, so the app needs no sprite sheet. */
function registerIcons(map: MapLibreMap) {
  const dpr = 2;

  const bus = document.createElement('canvas');
  bus.width = bus.height = 18 * dpr;
  const bctx = bus.getContext('2d');
  if (bctx) {
    bctx.scale(dpr, dpr);
    bctx.fillStyle = '#2b3a55';
    bctx.beginPath();
    bctx.roundRect(2, 1.5, 14, 15, 4);
    bctx.fill();
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(4.5, 4.5, 9, 5);
    bctx.fillRect(5, 11, 2.2, 2.2);
    bctx.fillRect(10.8, 11, 2.2, 2.2);
    map.addImage('bus-pin', bctx.getImageData(0, 0, 18 * dpr, 18 * dpr), { pixelRatio: dpr });
  }

  const acc = document.createElement('canvas');
  acc.width = acc.height = 16 * dpr;
  const actx = acc.getContext('2d');
  if (actx) {
    actx.scale(dpr, dpr);
    actx.fillStyle = '#0a66c2';
    actx.beginPath();
    actx.arc(8, 8, 7, 0, Math.PI * 2);
    actx.fill();
    actx.fillStyle = '#ffffff';
    actx.beginPath();
    actx.arc(8, 4.6, 1.5, 0, Math.PI * 2);
    actx.fill();
    actx.lineWidth = 1.5;
    actx.strokeStyle = '#ffffff';
    actx.beginPath();
    actx.arc(8, 9.6, 3.4, -0.3, Math.PI * 1.15);
    actx.stroke();
    map.addImage('access-pin', actx.getImageData(0, 0, 16 * dpr, 16 * dpr), { pixelRatio: dpr });
  }
}

export function addTransit(map: MapLibreMap) {
  registerIcons(map);

  map.addSource('mbta-lines', { type: 'geojson', data: '/data/mbta-lines.geojson' });
  map.addSource('mbta-stations', { type: 'geojson', data: '/data/mbta-stations.geojson' });
  map.addSource('mbta-bus', { type: 'geojson', data: '/data/mbta-bus.geojson' });
  map.addSource('mbta-bus-stops', { type: 'geojson', data: '/data/mbta-bus-stops.geojson' });

  /* --- bus: the quiet texture under the rapid transit --- */

  map.addLayer({
    id: 'bus-line',
    type: 'line',
    source: 'mbta-bus',
    minzoom: 11,
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#4b9f6e',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1.3, 18, 2.2],
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.25, 14, 0.5],
    },
  });

  /* --- the tracks themselves, under the route ribbons --- */

  // The real rail alignment, drawn dark and narrow. Where ribbons fan apart for
  // legibility this stays put, so the map still shows where the steel actually runs.
  map.addLayer({
    id: 'mbta-track',
    type: 'line',
    source: 'mbta-lines',
    minzoom: 11,
    layout: { 'line-join': 'round', 'line-cap': 'butt' },
    paint: {
      'line-color': '#3a3f47',
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 13, 1.1, 16, 1.8, 19, 3],
      // Present at the opening view, not ramping in above it.
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 13, 0.5, 15, 0.55],
      // Sleeper rhythm, so it reads as track rather than one more route line.
      'line-dasharray': [2, 1.6],
    },
  });

  /* --- route ribbons, fanned apart on shared trunks --- */

  const offset = offsetAt(1.05);

  // A white casing under every branch is what keeps the four Green Line shapes legible
  // where they share the Boylston Street subway.
  map.addLayer({
    id: 'mbta-line-casing',
    type: 'line',
    source: 'mbta-lines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#ffffff',
      'line-width': widthAt(1.8),
      'line-offset': offset,
      'line-opacity': 0.92,
    },
  });

  map.addLayer({
    id: 'mbta-line',
    type: 'line',
    source: 'mbta-lines',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': widthAt(1),
      'line-offset': offset,
    },
  });

  /* --- stops --- */

  map.addLayer({
    id: 'bus-stop',
    type: 'symbol',
    source: 'mbta-bus-stops',
    minzoom: 14.5,
    layout: {
      'icon-image': 'bus-pin',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 14.5, 0.5, 17, 0.8],
      'icon-allow-overlap': false,
      'icon-padding': 3,
    },
    paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.2, 0.9] },
  });

  // The station's own mark on the ground plane. Bullets ride above it as DOM markers.
  map.addLayer({
    id: 'mbta-station',
    type: 'circle',
    source: 'mbta-stations',
    paint: {
      'circle-color': ['case', ['get', 'interchange'], '#ffffff', ['get', 'color']],
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        11, ['case', ['get', 'interchange'], 3.2, 2],
        14, ['case', ['get', 'interchange'], 5.5, 3.6],
        17, ['case', ['get', 'interchange'], 8, 5.5],
      ],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 15, 2.2],
      'circle-stroke-color': ['case', ['get', 'interchange'], '#1d1f24', '#ffffff'],
      'circle-pitch-alignment': 'map',
    },
  });

  map.addLayer({
    id: 'mbta-station-access',
    type: 'symbol',
    source: 'mbta-stations',
    minzoom: 15,
    filter: ['==', ['get', 'accessible'], true],
    layout: {
      'icon-image': 'access-pin',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 15, 0.55, 18, 0.85],
      'icon-offset': [14, -12],
      'icon-allow-overlap': true,
    },
  });

  map.addLayer({
    id: 'mbta-station-label',
    type: 'symbol',
    source: 'mbta-stations',
    minzoom: 12.5,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Bold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12.5, 10.5, 16, 14],
      'text-offset': [0, 1.2],
      'text-anchor': 'top',
      'text-optional': true,
      'text-padding': 4,
      // Interchanges win the label race when markers collide.
      'symbol-sort-key': ['case', ['get', 'interchange'], 0, 1],
    },
    paint: {
      'text-color': '#1d1f24',
      'text-halo-color': '#ffffff',
      'text-halo-width': 1.8,
    },
  });
}
