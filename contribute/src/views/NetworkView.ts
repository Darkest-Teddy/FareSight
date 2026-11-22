import { latLonToSculpture, type MbtaVehicle } from '@faresight/shared';
import { api } from '../api';
import { catalog } from '../catalog';
import { coverage, networkData, type NetworkStation } from '../data';
import { button, el, haptic, svg } from '../dom';
import { MapCanvas, type Box } from '../MapCanvas';

type FocalStation = NetworkStation & { stopId: string; code: string };

// Model units are thousandths of the sculpture's own units.
const UNIT = 1000;
const DIVE_ZOOM = 3.4;
const TRAIN_POLL_MS = 10_000;
// Map units kept clear on each side of the outermost stops for their name labels.
const LABEL_ROOM = 185;
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
  private readonly focal: FocalStation[];
  private readonly nodes = new Map<string, HTMLButtonElement>();
  private readonly counts = new Map<string, HTMLElement>();
  private readonly trains = new Map<string, SVGGElement>();
  private readonly trainLayer = svg('g', { class: 'net-trains' });
  private readonly live = el('p', 'live-pill');
  private readonly liveCount = el('span');
  private readonly unsubscribe: () => void;
  private trainTimer = 0;
  private leaving = false;
  private alive = true;

  constructor(private readonly actions: { openStop(stopId: string): void }, from?: string) {
    this.focal = networkData.stations
      .filter((station): station is FocalStation => Boolean(station.stopId && station.code))
      .sort((a, b) => a.code.localeCompare(b.code));

    const [x, y, w, h] = networkData.bounds;
    const xs = this.focal.map((station) => station.x);
    const ys = networkData.lines.flatMap((line) => line.points.filter((_, index) => index % 2 === 1));
    // As tall as the tracks, and wide enough for the five stops and their labels. The ground runs on past this box.
    const home: Box = {
      x: Math.min(...xs) - LABEL_ROOM, y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs) + LABEL_ROOM * 2, h: Math.max(...ys) - Math.min(...ys),
    };
    this.map = new MapCanvas({
      bounds: { x, y, w, h }, home, fixed: true, maxZoom: 4.5,
      label: 'Map of the MBTA subway lines through Boston. Five stops are open for contributions.',
    });
    this.draw();
    this.focal.forEach((station, index) => this.addNode(station, index));

    const mapHost = el('div', 'network-map');
    this.live.hidden = true;
    this.live.append(el('i'), this.liveCount);
    mapHost.append(this.map.root, this.live);

    this.root.append(mapHost);

    if (!introPlayed && !from) this.root.classList.add('is-intro');
    introPlayed = true;
    this.unsubscribe = catalog.subscribe(() => this.sync());
    this.sync();

    void this.map.ready.then(() => {
      if (!this.alive) return;
      const station = this.focal.find((entry) => entry.stopId === from);
      if (station) {
        // Coming back from a stop: start where the person was and pull back to the network.
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
    this.map.destroy();
  }

  private draw() {
    const canvas = this.map.svg;
    // The ground the network floats on: one organic shape that follows the lines and fades out at its rim.
    const defs = svg('defs');
    const shape = svg('clipPath', { id: 'net-ground-clip' });
    shape.append(svg('path', { d: networkData.ground }));
    defs.append(shape);
    const ground = svg('g', { class: 'net-ground' });
    ground.append(
      svg('path', { d: networkData.groundRim, class: 'net-ground-rim' }),
      svg('path', { d: networkData.ground }),
      // The river and the harbour stop at the edge of the ground, like everything else on it.
      svg('path', { d: networkData.water, class: 'net-water', 'clip-path': 'url(#net-ground-clip)' }),
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
      // A glint that keeps running down the line. It is ambient light, not a train.
      const flow = svg('path', { d, class: 'line-flow', pathLength: 1 });
      group.append(title, svg('path', { d, class: 'line-casing' }), tube, core, flow);
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

    canvas.append(defs, ground, lines, stations, labels, this.trainLayer);
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

  /** Refreshes the contribution counts on the map labels. */
  private sync() {
    for (const station of this.focal) {
      const places = catalog.at(station.stopId);
      const done = places.filter((place) => coverage(place).room).length;
      const count = this.counts.get(station.stopId);
      const node = this.nodes.get(station.stopId);
      if (!count || !node) continue;
      if (catalog.status === 'ready') {
        count.textContent = `${done}/${places.length} in 3D`;
        node.setAttribute('aria-label', `${station.name}. ${places.length} places, ${places.length - done} need photos.`);
      } else {
        count.textContent = catalog.status === 'error' ? 'Offline' : 'Loading…';
        node.setAttribute('aria-label', station.name);
      }
    }
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
    } catch {
      // Trains are decoration here. The map works without them, but must not claim to be live.
      this.live.hidden = true;
      return;
    }
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
        // Each train pings on its own beat, so the map never pulses in unison.
        train = svg('g', { class: 'net-train', style: `--line:${routes[0].core};--beat:${(-Math.random() * 3).toFixed(2)}s` });
        train.append(
          svg('circle', { r: 6, class: 'train-ping' }),
          svg('circle', { r: 11, class: 'train-glow' }),
          svg('circle', { r: 5.2, class: 'train-dot' }),
        );
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
    this.liveCount.textContent = `${seen.size} ${seen.size === 1 ? 'train' : 'trains'} moving now`;
    this.live.hidden = !seen.size;
  }
}
