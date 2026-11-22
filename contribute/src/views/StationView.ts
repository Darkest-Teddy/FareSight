import type { Place, Stop } from '@faresight/shared';
import { catalog } from '../catalog';
import { categoryLabel, coverage, loadArea, projectToArea, reviewSummary, servesDishes, type AreaData, type AreaLayer } from '../data';
import { button, el, errorText, haptic, icon, iconButton, svg, type IconName } from '../dom';
import { MapCanvas, type Box } from '../MapCanvas';
import { reviewSheet } from '../ui/ReviewSheet';

type SelectSource = 'pin' | 'restore';

// Metres of street shown across the map when a place is selected.
const FOCUS_SPAN_M = 210;
/** Everything the map shows of each place. When any of it changes the pins are drawn again. */
const drawn = (places: Place[]) => JSON.stringify(places.map((place) => [
  place.id, place.name, place.lat, place.lon, place.pin_index, place.category, place.cravings,
]));
const groundLayers: AreaLayer[] = ['water', 'park', 'pitch', 'foot', 'service', 'minor', 'major'];
// Screen pixels kept between pin heads, and between a pin head and the station roundel.
const PIN_GAP = 31;
const ROUNDEL_GAP = 29;
// A pin's head sits this far above the point its needle marks.
const PIN_HEAD_RISE = 25;
// Half a pin head, and the height of the name tag beside it, in screen pixels.
const PIN_HEAD = 15;
const TAG_HEIGHT = 18;
type Rect = [x: number, y: number, width: number, height: number];
const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]))
  * Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));

/** One stop's neighborhood: the diorama's footprints seen from above, with a pin for every place. */
export class StationView {
  readonly root = el('section', 'view station-view');
  private readonly mapHost = el('div', 'station-map');
  private readonly summary = el('p', 'view-sub');
  private readonly pins = new Map<string, HTMLButtonElement>();
  /** The short card about the selected place, over the bottom of the map. */
  private readonly overview = el('aside', 'place-overview');
  private readonly tagWidths = new Map<string, number>();
  private readonly points = new Map<string, [number, number]>();
  private readonly unsubscribe: () => void;
  private map?: MapCanvas;
  private area?: AreaData;
  private places: Place[] = [];
  private selected?: string;
  private built = false;
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

    this.root.append(head, this.mapHost);
    this.unsubscribe = catalog.subscribe(() => this.onCatalog());
    void this.load();
  }

  destroy() {
    this.alive = false;
    this.unsubscribe();
    this.map?.destroy();
  }

  private async load() {
    this.summary.textContent = this.stop.lines.map((line) => line.replace('-', ' ')).join(' · ');
    this.mapHost.replaceChildren(el('div', 'board-skeleton'));
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
  }

  private onCatalog() {
    if (!this.area || !this.alive) return;
    if (catalog.status === 'error') {
      this.fail(catalog.error);
      return;
    }
    if (catalog.status !== 'ready') return;
    const places = catalog.at(this.stop.stop_id);
    const unchanged = this.map && drawn(places) === drawn(this.places);
    this.places = places;
    if (unchanged) this.syncNeeds();
    else this.build(this.area);
  }

  private build(area: AreaData) {
    this.map?.destroy();
    this.pins.clear();
    this.overview.hidden = true;
    this.tagWidths.clear();
    this.points.clear();
    const [bx, by, bw, bh] = area.bounds;
    const board: Box = { x: bx, y: by, w: bw, h: bh };
    const map = new MapCanvas({
      bounds: board, home: board, padding: 6, fixed: true, maxZoom: area.spanMeters / 70,
      label: `Street map around ${this.stop.name} with ${this.places.length} places marked.`,
    });
    this.map = map;
    this.draw(map, area);

    const [sx, sy] = area.station;
    const roundel = el('div');
    const mark = el('span', 't-marker', 'T');
    mark.style.setProperty('--line', this.stop.primary_color);
    mark.setAttribute('aria-hidden', 'true');
    roundel.append(mark);
    map.addMarker(roundel, sx, sy);

    this.places.forEach((place, index) => {
      const [px, py] = projectToArea(area, place.lat, place.lon);
      // A place just off the island still gets a pin, at the edge of the map.
      const point: [number, number] = [Math.max(bx, Math.min(bx + bw, px)), Math.max(by, Math.min(by + bh, py))];
      this.points.set(place.id, point);

      const pin = button('', () => this.tapPin(place), 'pin');
      pin.style.setProperty('--i', String(index));
      // Every pin carries its place's name. Tapping one opens the short overview of the place;
      // tapping it again goes straight to adding photos.
      pin.append(el('span', 'pin-tag', place.name), el('span', 'pin-head', String(place.pin_index + 1)));
      this.pins.set(place.id, pin);
      const anchor = el('div');
      anchor.append(pin);
      map.addMarker(anchor, point[0], point[1]);
    });

    const recenter = iconButton('locate', 'Show the whole neighborhood', () => this.clearSelection(), 'map-control');
    map.onView = (zoom) => {
      this.root.classList.toggle('is-zoomed', zoom > 1.45);
      recenter.classList.toggle('is-visible', zoom > 1.08);
      this.declutter(map.current.scale, area.station);
    };
    this.mapHost.replaceChildren(map.root, recenter, el('p', 'map-credit', `© ${area.attribution.replace(' (ODbL)', '')}`), this.overview);
    this.syncNeeds();

    // The first time, pick up the place the person came back from. When the list changes under an open
    // screen, keep whatever they had selected.
    const keep = this.built ? this.selected : this.restorePlaceId;
    this.built = true;
    const restore = this.places.find((place) => place.id === keep);
    if (!restore) this.selected = undefined;
    if (restore) void map.ready.then(() => { if (this.alive && this.map === map) this.select(restore, 'restore'); });
  }

  private draw(map: MapCanvas, area: AreaData) {
    const q = area.unitsPerMeter;
    const clipId = `board-clip-${area.stopId}`;
    // The city is cropped to the same shoreline as the diorama's island, with a margin of turf around it.
    const shore = 'M' + area.outline.reduce<string[]>((pairs, value, index) => {
      if (index % 2 === 0) pairs.push(`${value} ${area.outline[index + 1]}`);
      return pairs;
    }, []).join('L') + 'Z';
    const defs = svg('defs');
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('path', { d: shore }));
    defs.append(clip);

    const deck = svg('g', { 'clip-path': `url(#${clipId})`, class: 'board' });
    deck.append(svg('path', { d: shore, class: 'board-deck' }));
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

    map.svg.append(defs, svg('path', { d: shore, class: 'board-turf', 'stroke-width': area.turf * 2 }), deck);
  }

  /** Shows what each place still needs, on its pin. */
  private syncNeeds() {
    let waiting = 0;
    for (const place of this.places) {
      const done = coverage(place).room;
      if (!done) waiting++;
      const pin = this.pins.get(place.id);
      pin?.classList.toggle('is-done', done);
      pin?.setAttribute('aria-label', `${place.pin_index + 1}. ${place.name}. ${done ? 'The space is in 3D.' : 'The space needs photos.'}`);
    }
    const lines = this.stop.lines.map((line) => line.replace('-', ' ')).join(' · ');
    this.summary.textContent = this.places.length
      ? `${lines} · ${this.places.length} places, ${waiting} need photos`
      : `${lines} · No places listed yet`;
    this.renderOverview();
  }

  /**
   * The overview of the selected place, kept to what someone needs before deciding to go in:
   * what it is, whether its space and its menu are in 3D yet, and one line of what people say.
   */
  private renderOverview() {
    const place = this.places.find((entry) => entry.id === this.selected);
    this.overview.hidden = !place;
    if (!place) return;
    const status = coverage(place);
    const head = el('header', 'overview-head');
    const title = el('div', 'overview-title');
    title.append(el('h2', '', place.name), el('p', '', `${categoryLabel(place)} · ${place.walk_from_stop_m} m from the stop`));
    head.append(el('span', 'card-number', String(place.pin_index + 1)), title,
      iconButton('close', 'Close the overview', () => this.clearSelection(), 'overview-close'));

    const facts = el('ul', 'facts');
    facts.append(this.fact('room', '3D space', status.room ? 'In 3D' : 'Needs photos', status.room));
    if (servesDishes(place)) {
      facts.append(this.fact('dish', 'Menu', status.dishes ? `${status.dishesDone} of ${status.dishes} dishes in 3D` : 'No dishes yet',
        status.dishes > 0 && status.dishesDone === status.dishes));
    }
    const review = reviewSummary(place);
    const reviews = button('', () => reviewSheet.open(place), 'fact fact-reviews');
    const words = el('span', 'fact-text');
    words.append(
      el('strong', '', review.rating ? `${review.rating.toFixed(1)} ★ on ${review.source}` : 'Reviews'),
      el('small', '', review.quote ?? 'No reviews yet. Be the first.'),
    );
    reviews.append(icon('star'), words, icon('next'));
    const row = el('li');
    row.append(reviews);
    facts.append(row);

    const cta = button('Add photos', () => this.actions.openPlace(place), 'primary overview-cta');
    cta.append(icon('next'));
    this.overview.replaceChildren(head, el('p', 'overview-about', place.vibe), facts, cta);
  }

  private fact(symbol: IconName, label: string, value: string, done: boolean) {
    const row = el('li', done ? 'fact is-done' : 'fact');
    const mark = el('i', 'fact-mark');
    mark.append(icon(done ? 'check' : 'camera'));
    row.append(icon(symbol), el('span', 'fact-label', label), el('b', '', value), mark);
    return row;
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
    this.placeTags(pins.map(({ id, x, y, dx, dy }) => ({ id, x: x + dx, y: y + dy })), roundel);
  }

  /**
   * Puts each pin's name where it gets in the way least: beside, under or over its pin. Covering another
   * pin or another name counts most, the station a little less. Near the edge of the map a name is
   * shortened or slid sideways rather than cut off. `heads` are pin head centres in map units times the zoom.
   */
  private placeTags(heads: { id: string; x: number; y: number }[], roundel: { x: number; y: number }) {
    if (!this.map) return;
    const { cx, cy, scale } = this.map.current;
    const { width: mapWidth, height: mapHeight } = this.map.size;
    const EDGE = 4;
    // From zoomed map units to pixels on the map.
    const left = mapWidth / 2 - cx * scale;
    const top = mapHeight / 2 - cy * scale;
    const station: Rect = [roundel.x + left - 13, roundel.y + top - 13, 26, 26];
    const pinsAt = heads.map(({ x, y }): Rect => [x + left - PIN_HEAD, y + top - PIN_HEAD, PIN_HEAD * 2, PIN_HEAD + PIN_HEAD_RISE]);
    const names: (Rect | undefined)[] = heads.map(() => undefined);
    const place = (head: { id: string; x: number; y: number }, index: number) => {
      const tag = this.pins.get(head.id)?.querySelector<HTMLElement>('.pin-tag');
      if (!tag) return;
      const full = this.tagWidths.get(head.id) || tag.offsetWidth;
      if (!full) return;
      this.tagWidths.set(head.id, full);
      const x = head.x + left, y = head.y + top;
      // Beside the pin, level with its head or a step above or below it.
      const beside = (side: -1 | 1, lift: number) => {
        const room = side > 0 ? mapWidth - EDGE - (x + PIN_HEAD + 4) : x - PIN_HEAD - 4 - EDGE;
        const width = Math.max(0, Math.min(full, room));
        return { width, extra: Math.abs(lift) * 2, rect: [side > 0 ? x + PIN_HEAD + 4 : x - PIN_HEAD - 4 - width, y - TAG_HEIGHT / 2 + lift, width, TAG_HEIGHT] as Rect };
      };
      // Under or over the pin, slid sideways if that keeps it on the map. `row` 1 is a second row further out.
      const across = (side: -1 | 1, row: number) => {
        const width = Math.min(full, mapWidth - EDGE * 2);
        const start = Math.max(EDGE, Math.min(mapWidth - EDGE - width, x - width / 2));
        const step = row * (TAG_HEIGHT + 2);
        return { width, extra: row * 60, rect: [start, side > 0 ? y + PIN_HEAD_RISE + 3 + step : y - PIN_HEAD - 4 - TAG_HEIGHT - step, width, TAG_HEIGHT] as Rect };
      };
      const others = names.filter((rect, other): rect is Rect => Boolean(rect) && other !== index);
      // In order of preference: the plain positions first, then the nudged ones for crowded corners.
      const options = [
        beside(1, 0), beside(-1, 0), across(1, 0), across(-1, 0),
        beside(1, -14), beside(1, 14), beside(-1, -14), beside(-1, 14), across(1, 1), across(-1, 1),
      ];
      let best = options[0];
      let least = Infinity;
      for (const option of options) {
        const { rect, width, extra } = option;
        const covered = (rects: Rect[]) => rects.reduce((sum, other) => sum + overlap(rect, other), 0);
        const offMap = rect[2] * rect[3] - overlap(rect, [0, 0, mapWidth, mapHeight]);
        const cost = extra + (full - width) * TAG_HEIGHT + offMap * 6 + covered(pinsAt) * 6 + covered(others) * 6 + overlap(rect, station) * 3;
        if (cost < least) [best, least] = [option, cost];
      }
      tag.style.maxWidth = best.width < full ? `${best.width.toFixed(0)}px` : '';
      // The tag is positioned from the centre of its own pin head.
      tag.style.setProperty('--tx', `${(best.rect[0] - x).toFixed(1)}px`);
      tag.style.setProperty('--ty', `${(best.rect[1] - y).toFixed(1)}px`);
      names[index] = best.rect;
    };
    // The first pass places each name knowing only the ones before it. Two more let every name
    // reconsider with all the others in place, which untangles tight clusters.
    for (let pass = 0; pass < 3; pass++) heads.forEach(place);
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
    this.renderOverview();

    const { width, height } = map.size;
    const scale = Math.min(width, height) / (FOCUS_SPAN_M * area.unitsPerMeter);
    // The overview covers the bottom of the map, so the pin goes to the middle of what is left above it.
    const view = { cx: point[0], cy: point[1] + (this.overview.offsetHeight / 2 - 10) / scale, scale };
    if (source === 'restore') map.set(view);
    else void map.fly(view, 520);

    if (source !== 'restore') haptic(6);
  }

  private clearSelection() {
    this.selected = undefined;
    this.root.classList.remove('has-selection');
    this.renderOverview();
    for (const pin of this.pins.values()) {
      pin.classList.remove('is-selected');
      pin.parentElement?.classList.remove('is-raised');
    }
    if (this.map) void this.map.fly(this.map.homeView(), 480);
  }
}
