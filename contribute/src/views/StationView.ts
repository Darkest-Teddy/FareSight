import type { Place, Stop } from '@faresight/shared';
import { catalog } from '../catalog';
import { categoryLabel, coverage, loadArea, projectToArea, servesDishes, type AreaData, type AreaLayer } from '../data';
import { button, el, errorText, haptic, icon, iconButton, svg, type IconName } from '../dom';
import { MapCanvas, type Box } from '../MapCanvas';

type SelectSource = 'pin' | 'card' | 'rail' | 'restore';

const groundLayers: AreaLayer[] = ['water', 'park', 'pitch', 'foot', 'service', 'minor', 'major'];
// Metres of street shown across the map when a place is selected.
const FOCUS_SPAN_M = 210;
// Screen pixels kept between pin heads, and between a pin head and the station roundel.
const PIN_GAP = 31;
const ROUNDEL_GAP = 29;
// A pin's head sits this far above the point its needle marks.
const PIN_HEAD_RISE = 25;

/** One stop's neighborhood: the diorama's footprints seen from above, with a pin for every place. */
export class StationView {
  readonly root = el('section', 'view station-view');
  private readonly mapHost = el('div', 'station-map');
  private readonly rail = el('div', 'place-rail');
  private readonly summary = el('p', 'view-sub');
  private readonly pins = new Map<string, HTMLButtonElement>();
  private readonly cards = new Map<string, { card: HTMLElement; needs: HTMLElement }>();
  private readonly points = new Map<string, [number, number]>();
  private readonly unsubscribe: () => void;
  private map?: MapCanvas;
  private area?: AreaData;
  private places: Place[] = [];
  private selected?: string;
  private railIndex = 0;
  private railTarget?: number;
  private railFrame = 0;
  private alive = true;

  constructor(
    private readonly stop: Stop,
    private readonly actions: { back(): void; openPlace(place: Place): void },
    private readonly restorePlaceId?: string,
  ) {
    const head = el('header', 'view-head');
    const badge = el('span', 'line-badge');
    badge.style.setProperty('--line', stop.primary_color);
    badge.append(el('b', '', stop.area_code.slice(-2)));
    const title = el('div', 'head-title');
    title.append(el('h1', '', stop.name), this.summary);
    head.append(iconButton('back', 'Back to the map', actions.back, 'head-back'), badge, title);

    this.rail.setAttribute('role', 'list');
    this.rail.setAttribute('aria-label', `Places near ${stop.name}`);
    this.rail.addEventListener('scroll', () => {
      if (this.railFrame) return;
      this.railFrame = requestAnimationFrame(() => {
        this.railFrame = 0;
        this.syncRail();
      });
    }, { passive: true });

    this.root.append(head, this.mapHost, this.rail);
    this.unsubscribe = catalog.subscribe(() => this.onCatalog());
    void this.load();
  }

  destroy() {
    this.alive = false;
    this.unsubscribe();
    cancelAnimationFrame(this.railFrame);
    this.map?.destroy();
  }

  private async load() {
    this.summary.textContent = this.stop.lines.map((line) => line.replace('-', ' ')).join(' · ');
    this.mapHost.replaceChildren(el('div', 'board-skeleton'));
    this.rail.replaceChildren(el('div', 'place-card is-skeleton'), el('div', 'place-card is-skeleton'));
    try {
      const [area] = await Promise.all([loadArea(this.stop.stop_id), catalog.load(60_000)]);
      if (!this.alive) return;
      this.area = area;
      this.onCatalog();
    } catch (error) {
      if (this.alive) this.fail(errorText(error));
    }
  }

  private fail(text: string) {
    const notice = el('div', 'empty-state');
    notice.append(icon('alert'), el('h2', '', 'This stop did not load'), el('p', '', text),
      button('Try again', () => void this.load(), 'primary'));
    this.mapHost.replaceChildren(notice);
    this.rail.replaceChildren();
  }

  private onCatalog() {
    if (!this.area || !this.alive) return;
    if (catalog.status === 'error') {
      this.fail(catalog.error);
      return;
    }
    if (catalog.status !== 'ready') return;
    const places = catalog.at(this.stop.stop_id);
    const unchanged = this.map && places.length === this.places.length
      && places.every((place, index) => place.id === this.places[index].id);
    this.places = places;
    if (unchanged) this.syncNeeds();
    else this.build(this.area);
  }

  private build(area: AreaData) {
    this.map?.destroy();
    this.pins.clear();
    this.cards.clear();
    this.points.clear();
    const q = area.unitsPerMeter;
    const half = area.spanMeters * q / 2;
    const board: Box = { x: -half, y: -half, w: half * 2, h: half * 2 };
    const map = new MapCanvas({
      bounds: board, home: board, padding: 14, maxZoom: area.spanMeters / 70,
      label: `Street map around ${this.stop.name} with ${this.places.length} places marked.`,
    });
    this.map = map;
    this.draw(map, area, half);

    const [sx, sy] = area.station;
    const roundel = el('div');
    const mark = el('span', 't-marker', 'T');
    mark.style.setProperty('--line', this.stop.primary_color);
    mark.setAttribute('aria-hidden', 'true');
    roundel.append(mark);
    map.addMarker(roundel, sx, sy);

    this.rail.replaceChildren();
    if (!this.places.length) {
      const empty = el('div', 'place-card is-empty');
      empty.append(el('p', '', 'No places are listed at this stop yet.'));
      this.rail.append(empty);
    }
    this.places.forEach((place, index) => {
      const limit = half * 0.95;
      const [px, py] = projectToArea(area, place.lat, place.lon);
      const point: [number, number] = [Math.max(-limit, Math.min(limit, px)), Math.max(-limit, Math.min(limit, py))];
      this.points.set(place.id, point);

      const pin = button('', () => this.tapPin(place), 'pin');
      pin.style.setProperty('--i', String(index));
      pin.append(el('span', 'pin-name', place.name), el('span', 'pin-head', String(place.pin_index + 1)));
      this.pins.set(place.id, pin);
      const anchor = el('div');
      anchor.append(pin);
      map.addMarker(anchor, point[0], point[1]);
      this.rail.append(this.card(place, index));
    });

    const recenter = iconButton('locate', 'Show the whole neighborhood', () => this.clearSelection(), 'map-control');
    map.onView = (zoom) => {
      this.root.classList.toggle('is-zoomed', zoom > 1.45);
      recenter.classList.toggle('is-visible', zoom > 1.08);
      this.declutter(map.current.scale, area.station);
    };
    this.mapHost.replaceChildren(map.root, recenter, el('p', 'map-credit', `© ${area.attribution.replace(' (ODbL)', '')}`));
    this.syncNeeds();

    const restore = this.places.find((place) => place.id === this.restorePlaceId);
    if (restore) void map.ready.then(() => { if (this.alive && this.map === map) this.select(restore, 'restore'); });
  }

  private draw(map: MapCanvas, area: AreaData, half: number) {
    const q = area.unitsPerMeter;
    const clipId = `board-clip-${area.stopId}`;
    const size = half * 2;
    const corner = 12 * q;
    const lip = 7 * q;
    const defs = svg('defs');
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('rect', { x: -half, y: -half, width: size, height: size, rx: corner }));
    defs.append(clip);

    const deck = svg('g', { 'clip-path': `url(#${clipId})`, class: 'board' });
    deck.append(svg('rect', { x: -half, y: -half, width: size, height: size, class: 'board-deck' }));
    for (const name of groundLayers) {
      if (area.layers[name]) deck.append(svg('path', { d: area.layers[name], class: `layer layer-${name}` }));
    }
    // The offset copy underneath reads as the shadow of a raised block.
    deck.append(
      svg('path', { d: area.layers.building, class: 'layer layer-shadow', transform: `translate(${1.1 * q} ${1.7 * q})` }),
      svg('path', { d: area.layers.building, class: 'layer layer-building' }),
    );
    const labels = svg('g', { class: 'layer layer-labels' });
    for (const { name, x, y } of area.labels) {
      const label = svg('text', { x, y, 'text-anchor': 'middle' });
      label.textContent = name.length > 28 ? name.slice(0, 27) + '…' : name;
      labels.append(label);
    }
    deck.append(labels);

    map.svg.append(
      defs,
      svg('rect', { x: -half - lip, y: -half - lip, width: size + lip * 2, height: size + lip * 2, rx: corner + lip, class: 'board-plinth' }),
      deck,
      svg('rect', { x: -half, y: -half, width: size, height: size, rx: corner, class: 'board-trim' }),
    );
  }

  private card(place: Place, index: number) {
    const card = el('article', 'place-card');
    card.setAttribute('role', 'listitem');
    card.style.setProperty('--i', String(index));
    const head = el('header', 'place-card-head');
    const title = el('div', 'place-card-title');
    title.append(
      el('h2', '', place.name),
      el('p', '', `${categoryLabel(place)} · ${place.walk_from_stop_m} m from the stop`),
    );
    head.append(el('span', 'card-number', String(place.pin_index + 1)), title);
    const needs = el('ul', 'needs');
    const cta = button('Add photos', () => this.actions.openPlace(place), 'primary cta');
    cta.append(icon('next'));
    card.append(head, el('p', 'place-vibe', place.vibe), needs, cta);
    card.addEventListener('click', (event) => {
      if ((event.target as Element).closest('.cta') || this.selected === place.id) return;
      this.select(place, 'card');
    });
    this.cards.set(place.id, { card, needs });
    return card;
  }

  /** Shows what each place still needs, on its card and on its pin. */
  private syncNeeds() {
    let waiting = 0;
    for (const place of this.places) {
      const status = coverage(place);
      if (!status.room) waiting++;
      const rows: [IconName, string, string, boolean][] = [
        ['room', 'The space', status.room ? 'In 3D' : 'Needs photos', status.room],
      ];
      if (servesDishes(place)) {
        const complete = status.dishes > 0 && status.dishesDone === status.dishes;
        rows.push(['dish', 'Dishes', status.dishes ? `${status.dishesDone} of ${status.dishes} in 3D` : 'None yet', complete]);
      }
      const entry = this.cards.get(place.id);
      entry?.needs.replaceChildren(...rows.map(([symbol, label, value, done]) => {
        const row = el('li', done ? 'need is-done' : 'need');
        row.append(icon(done ? 'check' : symbol), el('span', '', label), el('b', '', value));
        return row;
      }));
      const pin = this.pins.get(place.id);
      pin?.classList.toggle('is-done', status.room);
      pin?.setAttribute('aria-label', `${place.pin_index + 1}. ${place.name}. ${status.room ? 'The space is in 3D.' : 'The space needs photos.'}`);
    }
    const lines = this.stop.lines.map((line) => line.replace('-', ' ')).join(' · ');
    this.summary.textContent = `${lines} · ${this.places.length} places, ${waiting} need photos`;
  }

  /**
   * Places that share a block would stack their pins. Nudge the pins apart on screen at the
   * current zoom; the nudge shrinks to nothing as the map zooms in and the pins separate by themselves.
   */
  private declutter(scale: number, station: number[]) {
    const pins = [...this.points].map(([id, [x, y]]) => ({ id, x: x * scale, y: y * scale - PIN_HEAD_RISE, dx: 0, dy: 0 }));
    const roundel = { x: station[0] * scale, y: station[1] * scale };
    for (let pass = 0; pass < 8; pass++) {
      for (const [i, a] of pins.entries()) {
        for (const b of pins.slice(i + 1)) {
          const gapX = b.x + b.dx - a.x - a.dx;
          const gapY = b.y + b.dy - a.y - a.dy;
          const distance = Math.hypot(gapX, gapY);
          if (distance >= PIN_GAP) continue;
          // Pins on the very same spot have no direction to part in, so fan them out by index.
          const ux = distance > 0.01 ? gapX / distance : Math.cos(i * 2.4);
          const uy = distance > 0.01 ? gapY / distance : Math.sin(i * 2.4);
          const push = (PIN_GAP - distance) / 2;
          a.dx -= ux * push;
          a.dy -= uy * push;
          b.dx += ux * push;
          b.dy += uy * push;
        }
        const gapX = a.x + a.dx - roundel.x;
        const gapY = a.y + a.dy - roundel.y;
        const distance = Math.hypot(gapX, gapY);
        if (distance >= ROUNDEL_GAP) continue;
        a.dx += (distance > 0.01 ? gapX / distance : 0) * (ROUNDEL_GAP - distance);
        a.dy += (distance > 0.01 ? gapY / distance : -1) * (ROUNDEL_GAP - distance);
      }
    }
    for (const { id, dx, dy } of pins) {
      const pin = this.pins.get(id);
      pin?.style.setProperty('--dx', `${dx.toFixed(1)}px`);
      pin?.style.setProperty('--dy', `${dy.toFixed(1)}px`);
    }
  }

  private tapPin(place: Place) {
    if (this.selected === place.id) this.actions.openPlace(place);
    else this.select(place, 'pin');
  }

  private select(place: Place, source: SelectSource) {
    const { map, area } = this;
    const point = this.points.get(place.id);
    if (!map || !area || !point) return;
    this.selected = place.id;
    this.root.classList.add('has-selection');
    for (const [id, pin] of this.pins) {
      pin.classList.toggle('is-selected', id === place.id);
      pin.parentElement?.classList.toggle('is-raised', id === place.id);
    }
    for (const [id, { card }] of this.cards) card.classList.toggle('is-selected', id === place.id);

    const { width, height } = map.size;
    const scale = Math.min(width, height) / (FOCUS_SPAN_M * area.unitsPerMeter);
    // Sit the pin a little below centre so its name label has room above it.
    const view = { cx: point[0], cy: point[1] - 16 / scale, scale };
    if (source === 'restore') map.set(view);
    else void map.fly(view, 520);

    const index = this.places.indexOf(place);
    if (source !== 'rail') this.centerCard(index, source === 'restore' ? 'instant' : 'smooth');
    if (source !== 'restore') haptic(6);
  }

  private clearSelection() {
    this.selected = undefined;
    this.root.classList.remove('has-selection');
    for (const pin of this.pins.values()) {
      pin.classList.remove('is-selected');
      pin.parentElement?.classList.remove('is-raised');
    }
    for (const { card } of this.cards.values()) card.classList.remove('is-selected');
    if (this.map) void this.map.fly(this.map.homeView(), 480);
  }

  private centerCard(index: number, behavior: ScrollBehavior) {
    const card = this.cards.get(this.places[index]?.id)?.card;
    if (!card) return;
    const left = card.offsetLeft - (this.rail.clientWidth - card.offsetWidth) / 2;
    if (Math.abs(left - this.rail.scrollLeft) < 2) {
      this.railIndex = index;
      return;
    }
    // Ignore the cards that pass through the middle while the rail scrolls to its target.
    this.railTarget = index;
    this.rail.scrollTo({ left, behavior });
    window.setTimeout(() => { if (this.railTarget === index) this.railTarget = undefined; }, 900);
  }

  /** Swiping the cards selects the place in the middle and moves the map to its pin. */
  private syncRail() {
    const middle = this.rail.scrollLeft + this.rail.clientWidth / 2;
    let nearest = 0;
    let distance = Infinity;
    this.places.forEach((place, index) => {
      const card = this.cards.get(place.id)?.card;
      if (!card) return;
      const offset = Math.abs(card.offsetLeft + card.offsetWidth / 2 - middle);
      if (offset < distance) {
        distance = offset;
        nearest = index;
      }
    });
    if (this.railTarget !== undefined) {
      if (nearest !== this.railTarget) return;
      this.railTarget = undefined;
      this.railIndex = nearest;
      return;
    }
    if (nearest === this.railIndex) return;
    this.railIndex = nearest;
    const place = this.places[nearest];
    if (place && place.id !== this.selected) this.select(place, 'rail');
  }
}
