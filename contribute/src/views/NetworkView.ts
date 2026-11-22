import { latLonToSculpture, STOPS, type MbtaVehicle } from '@faresight/shared';
import { api } from '../api';
import { catalog } from '../catalog';
import { coverage, networkData, type NetworkStation } from '../data';
import { button, el, haptic, icon, iconButton, svg } from '../dom';
import { MapCanvas, type Box } from '../MapCanvas';

type FocalStation = NetworkStation & { stopId: string; code: string };

// Model units are thousandths of the sculpture's own units.
const UNIT = 1000;
const DIVE_ZOOM = 3.4;
const TRAIN_POLL_MS = 10_000;
// Map units kept clear on each side of the outermost stops for their name labels.
const LABEL_ROOM = 185;
const NEEDS_SHOWN = 3;
// Hand-placed so the five labels never sit on a line or on each other.
const labelSide: Record<string, 'top' | 'bottom' | 'left' | 'right'> = {
  'place-brico': 'top', 'place-bucen': 'bottom', 'place-kencl': 'top', 'place-harsq': 'right', 'place-chncl': 'bottom',
};
// A few well-known stations label the rest of the network for orientation.
const landmarks: Record<string, 'above' | 'below'> = { 'Park Street': 'above', 'North Station': 'above', Central: 'above' };
let introPlayed = false;

function nearestOnLine(points: number[], x: number, y: number) {
  let best = { x, y, error: Infinity };
  for (let i = 2; i < points.length; i += 2) {
    const ax = points[i - 2];
    const ay = points[i - 1];
    const dx = points[i] - ax;
    const dy = points[i + 1] - ay;
    const length = dx * dx + dy * dy;
    if (!length) continue;
    const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / length));
    const px = ax + dx * t;
    const py = ay + dy * t;
    const error = (x - px) ** 2 + (y - py) ** 2;
    if (error < best.error) best = { x: px, y: py, error };
  }
  return best;
}

/** The subway sculpture seen from above: tap a stop to open its neighborhood. */
export class NetworkView {
  readonly root = el('section', 'view network-view');
  private readonly map: MapCanvas;
  private readonly rail = el('div', 'stop-rail');
  private readonly focal: FocalStation[];
  private readonly nodes = new Map<string, HTMLButtonElement>();
  private readonly cards = new Map<string, { card: HTMLButtonElement; fill: HTMLElement; info: HTMLElement; needs: HTMLElement }>();
  private readonly counts = new Map<string, HTMLElement>();
  private readonly trains = new Map<string, SVGCircleElement>();
  private readonly trainLayer = svg('g', { class: 'net-trains' });
  private readonly unsubscribe: () => void;
  private trainTimer = 0;
  private railIndex = 0;
  private railFrame = 0;
  private leaving = false;
  private alive = true;

  constructor(private readonly actions: { openStop(stopId: string): void }, from?: string) {
    this.focal = networkData.stations
      .filter((station): station is FocalStation => Boolean(station.stopId && station.code))
      .sort((a, b) => a.code.localeCompare(b.code));

    const [x, y, w, h] = networkData.bounds;
    const xs = this.focal.map((station) => station.x);
    // Full height of the sculpture, and wide enough for the five stops and their labels.
    const home: Box = { x: Math.min(...xs) - LABEL_ROOM, y, w: Math.max(...xs) - Math.min(...xs) + LABEL_ROOM * 2, h };
    this.map = new MapCanvas({
      bounds: { x, y, w, h }, home, maxZoom: 4.5,
      label: 'Map of the MBTA subway lines through Boston. Five stops are open for contributions.',
    });
    this.draw();
    this.focal.forEach((station, index) => this.addNode(station, index));

    const recenter = iconButton('locate', 'Show the whole map', () => void this.map.fly(this.map.homeView(), 480), 'map-control');
    this.map.onView = (zoom) => recenter.classList.toggle('is-visible', Math.abs(zoom - 1) > 0.08);
    const mapHost = el('div', 'network-map');
    mapHost.style.aspectRatio = `${home.w} / ${home.h}`;
    mapHost.append(this.map.root, recenter);

    const sheet = el('div', 'sheet');
    const heading = el('div', 'sheet-heading');
    heading.append(
      el('p', 'kicker', 'Boston by train'),
      el('h1', '', 'Pick a stop to scan'),
      el('p', 'lede', 'Your photos become the 3D rooms and dishes riders preview before they travel.'),
    );
    this.rail.setAttribute('role', 'group');
    this.rail.setAttribute('aria-label', 'Stops open for contributions');
    this.focal.forEach((station, index) => this.addCard(station, index));
    this.rail.addEventListener('scroll', () => {
      if (this.railFrame) return;
      this.railFrame = requestAnimationFrame(() => {
        this.railFrame = 0;
        this.syncRail();
      });
    }, { passive: true });
    sheet.append(heading, this.rail);
    this.root.append(mapHost, sheet);

    if (!introPlayed && !from) this.root.classList.add('is-intro');
    introPlayed = true;
    this.unsubscribe = catalog.subscribe(() => this.sync());
    this.sync();

    void this.map.ready.then(() => {
      if (!this.alive) return;
      const origin = this.focal.findIndex((station) => station.stopId === from);
      if (origin >= 0) {
        // Coming back from a stop: start where the person was and pull back to the network.
        const station = this.focal[origin];
        this.railIndex = origin;
        this.centerCard(origin, 'instant');
        this.map.set({ cx: station.x, cy: station.y, scale: this.map.homeView().scale * DIVE_ZOOM });
        void this.map.fly(this.map.homeView(), 640);
      }
      void this.refreshTrains();
      this.trainTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void this.refreshTrains();
      }, TRAIN_POLL_MS);
    });
  }

  destroy() {
    this.alive = false;
    this.unsubscribe();
    window.clearInterval(this.trainTimer);
    cancelAnimationFrame(this.railFrame);
    this.map.destroy();
  }

  private draw() {
    const [x, y, w, h] = networkData.bounds;
    const canvas = this.map.svg;
    const defs = svg('defs');
    // The street grid inlaid in the sculpture's deck: a line every 0.05 units, heavier every fifth.
    const grid = svg('pattern', { id: 'net-grid', width: 50, height: 50, patternUnits: 'userSpaceOnUse' });
    grid.append(svg('path', { d: 'M0 50V0H50', class: 'net-grid-line' }));
    const blocks = svg('pattern', { id: 'net-grid-major', width: 250, height: 250, patternUnits: 'userSpaceOnUse' });
    blocks.append(svg('path', { d: 'M0 250V0H250', class: 'net-grid-line is-major' }));
    const clip = svg('clipPath', { id: 'net-plate-clip' });
    clip.append(svg('rect', { x, y, width: w, height: h, rx: 30 }));
    defs.append(grid, blocks, clip);

    const plate = svg('g', { 'clip-path': 'url(#net-plate-clip)' });
    plate.append(
      svg('rect', { x, y, width: w, height: h, class: 'net-plate' }),
      svg('rect', { x, y, width: w, height: h, fill: 'url(#net-grid)' }),
      svg('rect', { x, y, width: w, height: h, fill: 'url(#net-grid-major)' }),
      svg('path', { d: networkData.river, class: 'net-river' }),
    );

    const lines = svg('g', { class: 'net-lines' });
    networkData.lines.forEach((line, index) => {
      const d = 'M' + line.points.reduce<string[]>((pairs, value, i) => {
        if (i % 2 === 0) pairs.push(`${value} ${line.points[i + 1]}`);
        return pairs;
      }, []).join('L');
      const group = svg('g', { class: 'net-line', style: `--i:${index}` });
      const tube = svg('path', { d, class: 'line-tube', stroke: line.tube, pathLength: 1 });
      const core = svg('path', { d, class: 'line-core', stroke: line.core, pathLength: 1 });
      const title = svg('title');
      title.textContent = line.name;
      group.append(title, svg('path', { d, class: 'line-casing' }), tube, core);
      lines.append(group);
    });

    const stations = svg('g', { class: 'net-stations' });
    const labels = svg('g', { class: 'net-labels' });
    [...networkData.stations].sort((a, b) => a.x - b.x).forEach((station, index) => {
      if (station.stopId) return;
      const interchange = station.colors.length > 1;
      const dot = svg('circle', {
        cx: station.x, cy: station.y, r: interchange ? 8 : 5.2,
        class: interchange ? 'net-station is-interchange' : 'net-station', style: `--i:${index}`,
      });
      const title = svg('title');
      title.textContent = station.name;
      dot.append(title);
      stations.append(dot);
      const side = landmarks[station.name];
      if (!side) return;
      const label = svg('text', { x: station.x, y: station.y + (side === 'above' ? -17 : 30), class: 'net-label', 'text-anchor': 'middle' });
      label.textContent = station.name;
      labels.append(label);
    });

    canvas.append(defs, plate, lines, stations, labels, this.trainLayer,
      svg('rect', { x, y, width: w, height: h, rx: 30, class: 'net-plate-edge' }));
  }

  private addNode(station: FocalStation, index: number) {
    const node = button('', () => void this.dive(station), 'stop-node');
    node.dataset.side = labelSide[station.stopId] ?? 'top';
    node.style.setProperty('--line', station.colors[0]);
    node.style.setProperty('--i', String(index));
    const ring = el('span', 'stop-ring');
    ring.append(el('span', 'stop-code', station.code.slice(-2)));
    const tag = el('span', 'stop-tag');
    const count = el('small');
    tag.append(el('strong', '', station.name), count);
    node.append(el('span', 'stop-halo'), ring, tag);
    this.nodes.set(station.stopId, node);
    this.counts.set(station.stopId, count);
    const anchor = el('div');
    anchor.append(node);
    this.map.addMarker(anchor, station.x, station.y);
  }

  private addCard(station: FocalStation, index: number) {
    const stop = STOPS.find((entry) => entry.stop_id === station.stopId);
    const card = button('', () => void this.dive(station), 'stop-card');
    card.style.setProperty('--line', station.colors[0]);
    card.style.setProperty('--i', String(index));
    const badge = el('span', 'line-badge');
    badge.append(el('b', '', station.code.slice(-2)));
    const title = el('span', 'stop-card-title');
    title.append(
      el('strong', '', station.name),
      el('span', 'stop-lines', (stop?.lines ?? station.routes).map((line) => line.replace('-', ' ')).join(' · ')),
    );
    const meter = el('span', 'meter');
    const fill = el('i');
    meter.append(fill);
    const info = el('small', 'stop-card-info');
    const progress = el('span', 'stop-card-progress');
    progress.append(meter, info);
    const needs = el('span', 'stop-needs');
    const open = el('span', 'stop-card-go', 'See the places');
    open.append(icon('next'));
    card.append(badge, title, progress, needs, open);
    this.cards.set(station.stopId, { card, fill, info, needs });
    this.rail.append(card);
  }

  /** Refreshes the contribution counts on the map labels and the stop cards. */
  private sync() {
    for (const station of this.focal) {
      const places = catalog.at(station.stopId);
      const done = places.filter((place) => coverage(place).room).length;
      const card = this.cards.get(station.stopId);
      const count = this.counts.get(station.stopId);
      const node = this.nodes.get(station.stopId);
      if (!card || !count || !node) continue;
      if (catalog.status === 'ready') {
        const waiting = places.length - done;
        count.textContent = `${done}/${places.length} in 3D`;
        card.info.textContent = waiting
          ? `${waiting} of ${places.length} places need photos`
          : `All ${places.length} places are in 3D`;
        card.fill.style.width = `${places.length ? Math.max(4, done / places.length * 100) : 0}%`;
        const open = places.filter((place) => !coverage(place).room);
        card.needs.replaceChildren(...open.slice(0, NEEDS_SHOWN).map((place) => el('span', '', place.name)));
        if (open.length > NEEDS_SHOWN) card.needs.append(el('span', 'more', `and ${open.length - NEEDS_SHOWN} more`));
        node.setAttribute('aria-label', `${station.name}. ${places.length} places, ${waiting} need photos.`);
      } else {
        count.textContent = catalog.status === 'error' ? 'Offline' : 'Loading…';
        card.info.textContent = catalog.status === 'error' ? 'Places are unavailable right now' : 'Loading places…';
        card.fill.style.width = '0%';
        card.needs.replaceChildren();
        node.setAttribute('aria-label', station.name);
      }
    }
  }

  private centerCard(index: number, behavior: ScrollBehavior) {
    const card = this.cards.get(this.focal[index].stopId)?.card;
    if (card) this.rail.scrollTo({ left: card.offsetLeft - (this.rail.clientWidth - card.offsetWidth) / 2, behavior });
  }

  /** Scrolling the stop cards moves the map to the stop in the middle. */
  private syncRail() {
    const middle = this.rail.scrollLeft + this.rail.clientWidth / 2;
    let nearest = 0;
    let distance = Infinity;
    this.focal.forEach((station, index) => {
      const card = this.cards.get(station.stopId)?.card;
      if (!card) return;
      const offset = Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle);
      if (offset < distance) {
        distance = offset;
        nearest = index;
      }
    });
    if (nearest === this.railIndex || this.leaving) return;
    this.railIndex = nearest;
    const station = this.focal[nearest];
    for (const [id, node] of this.nodes) node.classList.toggle('is-focused', id === station.stopId);
    for (const [id, { card }] of this.cards) card.classList.toggle('is-focused', id === station.stopId);
    haptic(4);
    void this.map.fly({ cx: station.x, cy: station.y, scale: this.map.homeView().scale * 1.45 }, 520);
  }

  /** Zooms into the tapped stop, then hands over to its neighborhood view. */
  private async dive(station: FocalStation) {
    if (this.leaving) return;
    this.leaving = true;
    haptic(10);
    this.nodes.get(station.stopId)?.classList.add('is-diving');
    this.root.classList.add('is-diving');
    await this.map.fly({ cx: station.x, cy: station.y, scale: this.map.homeView().scale * DIVE_ZOOM }, 480);
    if (this.alive) this.actions.openStop(station.stopId);
  }

  private async refreshTrains() {
    let vehicles: MbtaVehicle[];
    try {
      ({ vehicles } = await api.vehicles());
    } catch { return; /* Trains are decoration here. The map works without them. */ }
    if (!this.alive) return;
    const seen = new Set<string>();
    for (const vehicle of vehicles) {
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
      const [mx, mz] = latLonToSculpture(vehicle.lat, vehicle.lon);
      if (Math.abs(mx) > 0.74 || Math.abs(mz) > 0.51) continue;
      const routes = networkData.lines.filter((line) => line.routeId === vehicle.route_id);
      if (!routes.length) continue;
      const spot = routes.map((line) => nearestOnLine(line.points, mx * UNIT, mz * UNIT))
        .reduce((best, candidate) => candidate.error < best.error ? candidate : best);
      seen.add(vehicle.id);
      let train = this.trains.get(vehicle.id);
      if (!train) {
        train = svg('circle', { r: 5, class: 'net-train', stroke: routes[0].core });
        this.trains.set(vehicle.id, train);
        this.trainLayer.append(train);
      }
      // The CSS transition glides each train to its new position until the next poll.
      train.style.transform = `translate(${spot.x.toFixed(1)}px, ${spot.y.toFixed(1)}px)`;
    }
    for (const [id, train] of this.trains) {
      if (seen.has(id)) continue;
      train.remove();
      this.trains.delete(id);
    }
  }
}
