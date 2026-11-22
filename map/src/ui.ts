import type { Map as MapLibreMap } from 'maplibre-gl';
import { HOME, MBTA_COLORS } from './layers';
import { vehicleCount } from './vehicles';

/**
 * The chrome that frames the map: a menu rail top-left, a weather pill top-right, and
 * a route-planner bar along the bottom. Everything floats over the canvas, so the city
 * is never boxed in by UI.
 */

const MENU = [
  ['map', 'Map'],
  ['favorite', 'Saved'],
  ['download', 'Download'],
  ['local_shipping', 'Roadmap'],
  ['bar_chart', 'Analytics'],
  ['public', 'About'],
  ['settings', 'Settings'],
];

/** Boston. Open-Meteo needs no key and answers in a single request. */
const WEATHER = 'https://api.open-meteo.com/v1/forecast?latitude=42.3601&longitude=-71.0589&current=temperature_2m&temperature_unit=fahrenheit';

function el(tag: string, className?: string, html?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** A route bullet: the disc with the line letter, as printed on MBTA signage. */
export function bullet(routeId: string) {
  const label = routeId.startsWith('Green-') ? routeId.slice(6) : routeId[0];
  return `<span class="bullet" style="background:${MBTA_COLORS[routeId] ?? '#555'}">${label}</span>`;
}

export function buildUi(map: MapLibreMap) {
  const ui = document.getElementById('ui');
  if (!ui) return;

  /* --- menu rail --- */

  const rail = el('div', 'rail');
  const burger = el('button', 'rail-btn', '<span class="ico">&#9776;</span>');
  burger.setAttribute('aria-label', 'Menu');
  rail.append(burger);

  const drawer = el('nav', 'drawer');
  drawer.append(el('p', 'drawer-title', 'FareSight Transit'));
  for (const [, label] of MENU) {
    const item = el('button', 'drawer-item', label);
    drawer.append(item);
  }
  drawer.append(el('p', 'drawer-foot', 'Buildings &copy; OpenStreetMap<br>Live data &copy; MBTA'));
  burger.addEventListener('click', () => drawer.classList.toggle('open'));

  /* --- weather + live count --- */

  const weather = el('div', 'pill', '<span class="dot"></span><span id="temp">--&deg;</span>');
  fetch(WEATHER)
    .then((r) => r.json())
    .then((d) => {
      const t = d?.current?.temperature_2m;
      const node = document.getElementById('temp');
      if (node && typeof t === 'number') node.textContent = `${Math.round(t)}°F`;
    })
    .catch(() => {
      /* The pill just stays blank if the forecast is unreachable. */
    });

  const live = el('div', 'pill live', '<span class="pulse"></span><span id="live-count">0 trains</span>');
  setInterval(() => {
    const node = document.getElementById('live-count');
    if (node) node.textContent = `${vehicleCount()} trains`;
  }, 2000);

  const topRight = el('div', 'top-right');
  topRight.append(live, weather);

  /* --- legend --- */

  const legend = el('div', 'legend');
  for (const [id, label] of [
    ['Red', 'Red'],
    ['Orange', 'Orange'],
    ['Blue', 'Blue'],
    ['Green-B', 'Green'],
  ] as const) {
    legend.append(el('span', 'key', `<i style="background:${MBTA_COLORS[id]}"></i>${label}`));
  }

  /* --- route planner --- */

  const planner = el('div', 'planner');
  planner.innerHTML = `
    <div class="field">
      <span class="pin from"></span>
      <input id="from" placeholder="Your location" autocomplete="off" />
    </div>
    <div class="field">
      <span class="pin to"></span>
      <input id="to" placeholder="Destination" autocomplete="off" />
    </div>
    <button id="reset" title="Reset view" aria-label="Reset view">&#8634;</button>
  `;

  ui.append(rail, drawer, topRight, legend, planner);

  document.getElementById('reset')?.addEventListener('click', () => {
    map.easeTo({ ...HOME, duration: 1000 });
  });
}
