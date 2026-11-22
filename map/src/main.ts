import {
  GeolocateControl,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  type MapLayerMouseEvent,
} from 'maplibre-gl';
import type { Point } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/app.css';
import { addBuildings, addTransit, BOUNDS, HOME, MIN_ZOOM } from './layers';
import { addVehicles } from './vehicles';
import { bullet, buildUi } from './ui';

// OpenFreeMap serves OpenStreetMap vector tiles with no key and no rate limit. Positron
// is already a desaturated basemap, which is most of the way to the look we want.
const BASEMAP = 'https://tiles.openfreemap.org/styles/positron';

const map = new MapLibreMap({
  container: 'map',
  style: BASEMAP,
  center: HOME.center,
  zoom: HOME.zoom,
  pitch: HOME.pitch,
  bearing: HOME.bearing,
  maxPitch: 70,
  minZoom: MIN_ZOOM,
  maxBounds: BOUNDS,
  attributionControl: { compact: true },
  // Rotating by drag is how you read a 3D city; keep it on for touch too.
  dragRotate: true,
  pitchWithRotate: true,
});

map.addControl(new NavigationControl({ visualizePitch: true }), 'bottom-right');
map.addControl(
  new GeolocateControl({ trackUserLocation: true, positionOptions: { enableHighAccuracy: true } }),
  'bottom-right',
);

map.on('load', () => {
  addBuildings(map);
  addTransit(map);
  addVehicles(map);
  buildUi(map);
  document.body.classList.add('ready');
});

map.on('error', (e) => {
  // A tile 404 shouldn't look like a dead app; surface it instead of failing silently.
  console.error('[map]', e.error?.message ?? e);
});

/* --- station interaction ------------------------------------------------- */

const popup = new Popup({ closeButton: false, offset: 16, maxWidth: '280px' });

for (const layer of ['mbta-station', 'vehicle']) {
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
  });
}

map.on('click', 'mbta-station', (event: MapLayerMouseEvent) => {
  const feature = event.features?.[0];
  if (!feature) return;

  const { name, routes, accessible } = feature.properties as {
    name: string;
    routes: string | string[];
    accessible: boolean;
  };
  // GeoJSON properties arrive as JSON strings once they cross the tile boundary.
  const list: string[] = Array.isArray(routes) ? routes : JSON.parse(routes);

  const access = accessible
    ? '<p class="pop-access">Step-free access</p>'
    : '<p class="pop-access muted">No step-free access</p>';

  popup
    .setLngLat((feature.geometry as Point).coordinates as [number, number])
    .setHTML(
      `<p class="pop-name">${name}</p>
       <p class="pop-routes">${list.map(bullet).join('')}</p>
       ${access}`,
    )
    .addTo(map);
});

map.on('click', 'vehicle', (event: MapLayerMouseEvent) => {
  const feature = event.features?.[0];
  if (!feature) return;
  const { routeId, status } = feature.properties as { routeId: string; status: string };
  const phrase =
    status === 'STOPPED_AT' ? 'Stopped at a station' : status === 'INCOMING_AT' ? 'Arriving' : 'In motion';

  popup
    .setLngLat((feature.geometry as Point).coordinates as [number, number])
    .setHTML(`<p class="pop-routes">${bullet(routeId)}</p><p class="pop-name">${phrase}</p>`)
    .addTo(map);
});
