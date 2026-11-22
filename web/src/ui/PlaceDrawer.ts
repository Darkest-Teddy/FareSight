import {
  buildMbtaTripPlannerUrl, formatDishPrice, MBTA_SUBWAY_FARE, ROUTE_COLORS,
  type Asset, type Dish, type MbtaSource, type Place, type RestaurantManifest, type Stop,
} from '@faresight/shared';
import { api, type Alert, type Prediction, type Trip } from '../api/client';
import { has3DDish, has3DRoom, hasDishPreview, isSplat } from '../data/preview3D';
import { bostonHours, formatHours, liveBriefingReview, loadLiveReviews, week } from '../data/reviewBriefing';
import { button, element, errorText, field, link, message, money, option, previewBadge, section } from './dom';
import { renderBriefingReview } from './ReviewBriefingModal';
import { oneWayCost, type Filters } from './state';

export type Seating = 'seated' | 'standing';
type Load<T> = { data?: T; error?: string };
export interface StationData {
  predictions: Load<{ predictions: Prediction[]; source: MbtaSource }>;
  alerts: Load<Alert[]>;
}
export interface DishComparison {
  place: Place;
  dish: Dish;
  asset: Asset;
  offline?: boolean;
}
export interface ViewData {
  place: Place;
  places: readonly Place[];
  stop?: Stop;
  filters: Filters;
  manifest: Load<RestaurantManifest> & { offline?: boolean };
  trip: Load<Trip> & { offline?: boolean };
  originName?: string;
  dish?: Dish;
  comparison?: DishComparison;
  fit: boolean;
  seating: Seating;
  rotation: number;
  table: 'virtual' | 'passthrough';
  inside: boolean;
  highlightedDishId?: string;
}
interface DrawerActions {
  showBriefing(place: Place): void;
  toggleComparison(place: Place): void;
  clearComparison(): void;
  openComparison(): void;
  close(): void;
  toggleSheet(): void;
  showPlace(place: Place): void;
  enterRoom(): void;
  openDish(dish: Dish, compareId?: string, comparePlaceId?: string): void;
  changeFit(enabled: boolean, seating: Seating): void;
  rotate(angle: number): void;
  table(useVirtual: boolean): void;
  sendPlace(): void;
  sendTrip(): void;
  clearFilters(): void;
  retryStation(): void;
  retryTrip(): void;
  retryManifest(): void;
}

export function lineDots(stop: Stop) {
  const node = element('span', 'route-list');
  for (const route of stop.lines) {
    const lamp = element('span', 'route-dot');
    lamp.style.backgroundColor = ROUTE_COLORS[route] ?? stop.primary_color;
    const line = element('span', 'route-pill', route.replace('-', ' '));
    line.prepend(lamp);
    node.append(line);
  }
  return node;
}

function breakdown(rows: [string, string][]) {
  const list = element('dl', 'readout-list');
  for (const [label, value] of rows) list.append(element('dt', '', label), element('dd', '', value));
  return list;
}

const ratingCount = new Intl.NumberFormat('en-US');
const bostonClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
});
const desktop = matchMedia('(min-width: 769px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function formatMinutes(value: number) {
  return value > 0 && value < 1 ? '<1 min' : `${Math.round(value)} min`;
}

function stationCaption(stop: Stop) {
  const branches = stop.lines.filter((line) => line.startsWith('Green-')).map((line) => line.slice(6));
  const lines = stop.lines.filter((line) => !line.startsWith('Green-')).map((line) => `${line} Line`);
  if (branches.length) lines.unshift(`Green Line · ${branches.join(' ')}`);
  return lines.join(' · ');
}

function venueFacts(place: Place): HTMLElement[] {
  const details = place.details;
  const nodes: HTMLElement[] = [];
  const hours = element('details', 'detail-section drawer-disclosure');
  const now = new Date();
  const { openNow, hoursToday } = bostonHours(place.hours, now);
  const parts = bostonClock.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const today = part('weekday').toLowerCase();
  const [opening, closing] = hoursToday.split('–');
  const localMinutes = Number(part('hour')) * 60 + Number(part('minute'));
  const todayHours = place.hours[today];
  const [openHour, openMinute] = todayHours?.[0].split(':').map(Number) ?? [];
  const opensLater = todayHours && localMinutes < openHour * 60 + openMinute;
  const status = openNow ? `Open now · until ${closing}` : opensLater ? `Closed · opens ${opening}` : 'Closed';
  const hoursSummary = element('summary');
  hoursSummary.append(element('span', 'drawer-section-label', 'Hours'), element('span', openNow ? 'open-now' : '', status));
  hours.append(hoursSummary);
  const list = breakdown(week.map(([day, label]) => [label, formatHours(place.hours[day])]));
  list.querySelectorAll('dt').forEach((term, index) => {
    if (week[index][0] !== today) return;
    term.classList.add('today');
    term.nextElementSibling?.classList.add('today');
  });
  hours.append(list);
  if (!details?.hours_verified) hours.append(element('p', 'muted', 'Planning hours. Check with the venue.'));
  if (details?.hours_note) hours.append(element('p', 'muted', details.hours_note));
  nodes.push(hours);
  if (!details) return nodes;

  if (details.ratings.length || details.review_highlights.length) {
    const reviews = section('What reviewers say');
    if (details.ratings.length) {
      reviews.append(breakdown(details.ratings.map(({ source, rating, count }) =>
        [source, `${rating.toFixed(1)} / 5${count ? ` · ${ratingCount.format(count)} reviews` : ''}`])));
    }
    if (details.review_highlights.length) {
      const items = element('ul', 'review-highlights');
      for (const text of details.review_highlights) items.append(element('li', '', text));
      reviews.append(items);
    }
    nodes.push(reviews);
  }

  if (details.awards.length) {
    const awards = section('Recognition');
    const items = element('ul', 'award-list');
    for (const award of details.awards) {
      const item = element('li');
      const title = [award.title, award.year].filter(Boolean).join(', ');
      item.append(award.url ? link(title, award.url) : element('span', '', title), element('small', '', award.org));
      items.append(item);
    }
    awards.append(items);
    nodes.push(awards);
  }

  if (details.address || details.website || details.phone) {
    const contact = section('Visit');
    if (details.address) contact.append(element('p', '', details.address));
    if (details.phone) {
      const phone = element('a', 'text-link', details.phone);
      phone.href = `tel:${details.phone.replace(/[^\d+]/g, '')}`;
      contact.append(phone);
    }
    if (details.website) contact.append(link('Website', details.website));
    nodes.push(contact);
  }
  return nodes;
}

export class PlaceDrawer {
  readonly root = element('aside', 'place-drawer panel');
  private readonly title = element('h2');
  private readonly caption = element('p', 'drawer-caption');
  private readonly content = element('div', 'drawer-scroll');
  private readonly compareTray = element('div', 'restaurant-compare-tray');
  private readonly venueComparison = element('span');
  private readonly venueActions = element('div', 'venue-actions');
  private readonly oneWay = element('dd', 'price');
  private readonly doorToDoor = element('dd');
  private readonly openStatus = element('dd');
  private readonly venueStats = element('dl', 'venue-stats');
  private comparedPlaces: readonly Place[] = [];
  private comparisonKey = '';
  private readonly arrivals = element('div');
  private readonly alerts = element('details', 'detail-section drawer-disclosure station-alerts');
  private readonly alertSummary = element('summary');
  private readonly alertText = element('div', 'station-alert-text');
  private readonly stationList = element('div');
  private readonly tripDetails = element('div');
  private readonly costDetails = element('div');
  private readonly modelDetails = element('div');
  private readonly pairingDetails = element('div', 'button-row detail-section pairing-actions');
  private readonly grip: HTMLButtonElement;
  private viewKey = '';
  private actionKey = '';
  private modelKey = '';
  private modelManifest?: RestaurantManifest;
  private modelPlace?: Place;
  private modelComparison?: DishComparison;
  private modelCatalog?: readonly Place[];
  private reviewsNode?: HTMLElement;
  private reviewsKey = '';
  private facts: HTMLElement[] = [];
  private liveReviews = element('div');
  private detailsPlaceId?: string;

  constructor(private readonly actions: DrawerActions) {
    this.root.setAttribute('aria-labelledby', 'detail-title');
    this.title.id = 'detail-title';
    const heading = element('header', 'drawer-heading');
    const label = element('div');
    label.append(this.caption, this.title);
    this.grip = button('Expand sheet', actions.toggleSheet, 'sheet-grip mobile-only');
    this.grip.setAttribute('aria-controls', 'drawer-content');
    this.content.id = 'drawer-content';
    let touchY: number | undefined;
    this.grip.addEventListener('touchstart', (event) => { touchY = event.touches[0]?.clientY; }, { passive: true });
    this.grip.addEventListener('touchend', (event) => {
      if (touchY !== undefined && Math.abs((event.changedTouches[0]?.clientY ?? touchY) - touchY) > 30) {
        actions.toggleSheet();
        event.preventDefault();
      }
      touchY = undefined;
    });
    heading.append(label, button('Close', actions.close, 'quiet drawer-close'));
    this.alerts.append(this.alertSummary, this.alertText);
    for (const [label, value] of [['One way', this.oneWay], ['Door to door', this.doorToDoor], ['Now', this.openStatus]] as const) {
      const stat = element('div');
      stat.append(element('dt', 'drawer-section-label', label), value);
      this.venueStats.append(stat);
    }
    this.pairingDetails.append(button('Send to paired device', actions.sendPlace), button('Send trip', actions.sendTrip, 'quiet'));
    this.compareTray.hidden = true;
    this.root.append(this.grip, heading, this.compareTray, this.content);
    this.root.hidden = true;
  }

  setComparison(places: readonly Place[], loading: boolean) {
    this.comparedPlaces = places;
    const key = JSON.stringify([places.map(({ id, name }) => [id, name]), loading]);
    if (key === this.comparisonKey) return;
    this.comparisonKey = key;
    const focused = this.compareTray.contains(document.activeElement);
    const chips = element('div', 'restaurant-compare-chips');
    for (const place of places) {
      const remove = button(`${place.name} ×`, () => this.actions.toggleComparison(place), 'quiet');
      remove.setAttribute('aria-label', `Remove ${place.name} from comparison`);
      chips.append(remove);
    }
    const compare = button(loading ? 'Comparing…' : `Compare (${places.length})`, this.actions.openComparison, 'accent');
    compare.disabled = places.length < 2 || loading;
    const clear = button('Clear', this.actions.clearComparison, 'quiet');
    this.compareTray.replaceChildren(chips, compare, clear);
    this.compareTray.hidden = !places.length;
    if (focused) (places.length ? (compare.disabled ? clear : compare) : this.title).focus({ preventScroll: true });
  }

  private compareButton(place: Place, compact = false) {
    const selected = this.comparedPlaces.some(({ id }) => id === place.id);
    const symbol = selected ? '✓' : '+';
    const label = selected ? 'Comparing' : 'Compare';
    const toggle = button('', () => this.actions.toggleComparison(place), 'quiet compare-place');
    toggle.append(element('span', 'compare-symbol', symbol), element('span', 'compare-label', label));
    if (compact) toggle.classList.add('compare-compact');
    toggle.dataset.compareVenue = place.id;
    toggle.setAttribute('aria-label', `${selected ? 'Remove from comparison' : 'Compare'} ${place.name}`);
    toggle.setAttribute('aria-pressed', String(selected));
    return toggle;
  }

  expanded(expanded: boolean) {
    this.root.classList.toggle('expanded', expanded);
    this.grip.setAttribute('aria-expanded', String(expanded));
    this.grip.textContent = expanded ? 'Collapse sheet' : 'Expand sheet';
  }

  station(stop: Stop, places: Place[], filters: Filters, focus = false, highlightedPlaces?: ReadonlySet<string>) {
    const active = document.activeElement as HTMLElement | null;
    const focusedPlace = this.stationList.contains(active) ? active?.dataset.place : undefined;
    const compareFocus = this.stationList.contains(active) ? active?.dataset.compareVenue : undefined;
    const key = 'station:' + stop.stop_id;
    const isNewView = this.viewKey !== key;
    this.root.hidden = false;
    if (isNewView) {
      this.viewKey = key;
      this.caption.textContent = stationCaption(stop);
      this.title.textContent = stop.name;
      this.arrivals.replaceChildren();
      this.alerts.open = false;
      this.alertSummary.textContent = 'Checking service alerts…';
      this.alertText.replaceChildren();
      this.content.replaceChildren(this.stationList, this.arrivals, this.alerts);
      this.content.scrollTop = 0;
    }
    const list = section('Places near the stop');
    list.classList.add('station-places');
    if (!places.length) {
      list.append(message('No places at this stop match your filters.'), button('Clear filters', this.actions.clearFilters));
    }
    let firstHighlighted: HTMLButtonElement | undefined;
    for (const place of places) {
      const item = button('', () => this.actions.showPlace(place), 'place-row');
      item.dataset.place = place.id;
      if (highlightedPlaces?.has(place.id)) {
        item.dataset.highlighted = 'true';
        if (!firstHighlighted) firstHighlighted = item;
      }
      const label = element('span', 'place-label');
      const name = element('span', 'place-name', place.name);
      const room = has3DRoom(place);
      const dishes = has3DDish(place);
      if (room || dishes) name.append(previewBadge());
      const preview = room && dishes ? ' · 3D room & dishes' : room ? ' · 3D room' : dishes ? ' · 3D dishes' : '';
      const walk = Math.max(1, Math.round(place.walk_from_stop_m / 80));
      label.append(name, element('small', '', `${walk} min walk${preview}`));
      item.append(label, element('strong', 'price', money(oneWayCost(place, filters.startStopId, filters.groupSize))));
      const row = element('div', 'place-compare-row');
      row.append(item, this.compareButton(place, true));
      list.append(row);
    }
    this.stationList.replaceChildren(list);
    if (compareFocus || focusedPlace) {
      [...list.querySelectorAll<HTMLButtonElement>('.place-row, .compare-place')].find((item) =>
        (compareFocus && item.dataset.compareVenue === compareFocus) || (focusedPlace && item.dataset.place === focusedPlace),
      )?.focus({ preventScroll: true });
    }
    if (firstHighlighted) firstHighlighted.scrollIntoView({ block: 'nearest', behavior: reducedMotion.matches ? 'instant' : 'smooth' });
    if (isNewView) this.animateView('.station-places > .place-compare-row, .station-places > .message, .station-arrivals, .station-alerts');
    if (focus) {
      this.title.tabIndex = -1;
      this.title.focus({ preventScroll: true });
    }
  }

  updateStation(stop: Stop, data: StationData, campusMinutes?: number) {
    if (this.viewKey !== 'station:' + stop.stop_id) return;
    const arrivals = element('section', 'detail-section station-arrivals');
    const heading = element('header', 'station-arrivals-heading');
    heading.append(element('h3', '', 'Next trains'));
    arrivals.append(heading);
    if (campusMinutes !== undefined) arrivals.append(element('p', 'muted', `${formatMinutes(campusMinutes)} from BU Central · estimate`));
    if (data.predictions.data) {
      const { predictions, source } = data.predictions.data;
      const timed = predictions.filter((entry): entry is Prediction & { arrival_min: number } => entry.arrival_min !== null)
        .sort((a, b) => a.arrival_min - b.arrival_min).slice(0, 4);
      if (source === 'simulated') heading.append(element('small', '', 'Simulated'));
      const list = element('ul', 'arrival-list');
      for (const train of timed) {
        const row = element('li', 'arrival-row');
        const dot = element('span', 'route-dot');
        dot.style.backgroundColor = ROUTE_COLORS[train.route_id] ?? stop.primary_color;
        const route = element('strong', 'arrival-route', train.route_id.replace('-', ' '));
        const headsign = element('span', 'arrival-headsign', String(train.direction ?? ''));
        const value = element('span', 'arrival-value');
        if (train.arrival_min === 0) value.textContent = 'Due';
        else {
          const [minutes, unit] = formatMinutes(train.arrival_min).split(' ');
          value.append(minutes, ' ', element('small', '', unit));
        }
        row.append(dot, route, headsign, value);
        list.append(row);
      }
      arrivals.append(timed.length ? list : message('No timed arrivals for this stop. Check the MBTA trip planner.'));
    } else {
      arrivals.append(message(data.predictions.error ?? 'Checking next trains…', Boolean(data.predictions.error)));
      if (data.predictions.error) arrivals.append(button('Retry arrivals', this.actions.retryStation));
    }

    if (data.alerts.data) {
      const applicable = data.alerts.data.filter((alert) => alert.stop_ids.includes(stop.stop_id)
        || alert.route_ids.some((route) => stop.lines.includes(route))
        || (!alert.stop_ids.length && !alert.route_ids.length));
      this.alertSummary.textContent = applicable.length ? `${applicable.length} service ${applicable.length === 1 ? 'alert' : 'alerts'}` : 'No alerts for this stop';
      this.alertText.replaceChildren(...applicable.map((alert) => element('p', '', alert.header)));
    } else {
      this.alertSummary.textContent = data.alerts.error ? 'Service alerts unavailable' : 'Checking service alerts…';
      this.alertText.replaceChildren(message(data.alerts.error ?? 'Checking service alerts…', Boolean(data.alerts.error)));
    }
    const restoreRetry = this.arrivals.contains(document.activeElement) && document.activeElement?.tagName === 'BUTTON';
    this.arrivals.replaceChildren(arrivals);
    if (restoreRetry) arrivals.querySelector('button')?.focus({ preventScroll: true });
  }

  venue(data: ViewData, focus = false) {
    const { place, stop, dish } = data;
    const key = dish ? `dish:${place.id}:${dish.id}` : `venue:${place.id}`;
    const isNewView = this.viewKey !== key;
    this.root.hidden = false;
    if (isNewView) {
      const fromStation = this.viewKey.startsWith('station:');
      this.viewKey = key;
      const summary = element('div', 'venue-intro');
      summary.append(element('p', '', place.vibe));
      if (!dish) summary.append(this.venueStats);
      if (!this.reviewsNode || fromStation || this.detailsPlaceId !== place.id) {
        this.detailsPlaceId = place.id;
        this.facts = venueFacts(place);
        this.reviewsNode = element('div');
        this.reviewsKey = '';
        this.liveReviews = element('div');
        void this.updateLiveReviews(place, this.liveReviews);
      }
      summary.append(this.venueActions);
      this.actionKey = '';
      this.content.replaceChildren(summary, this.modelDetails, this.tripDetails, this.costDetails,
        ...this.facts, this.liveReviews, this.pairingDetails, this.reviewsNode);
      this.content.scrollTop = 0;
      this.modelKey = '';
    }
    this.updateVenueActions(data);
    const selected = this.comparedPlaces.some(({ id }) => id === place.id);
    if (this.venueComparison.firstElementChild?.getAttribute('aria-pressed') !== String(selected)
        || (this.venueComparison.firstElementChild as HTMLElement | null)?.dataset.compareVenue !== place.id) {
      const restore = this.venueComparison.contains(document.activeElement);
      const toggle = this.compareButton(place);
      this.venueComparison.replaceChildren(toggle);
      if (restore) toggle.focus({ preventScroll: true });
    }
    this.caption.textContent = dish ? place.name : [stop?.name, place.category.replaceAll('_', ' ')].filter(Boolean).join(' · ');
    this.title.textContent = (dish?.name ?? place.name).replaceAll('—', '–');
    const { openNow } = bostonHours(place.hours, new Date());
    this.openStatus.textContent = openNow ? 'Open' : 'Closed';
    this.openStatus.classList.toggle('open-now', openNow);
    this.updateCost(data);
    this.updateTrip(data);
    this.updateModels(data);
    const reviewsKey = JSON.stringify(place.reviews);
    if (this.reviewsKey !== reviewsKey) {
      this.reviewsKey = reviewsKey;
      this.reviewsNode?.replaceChildren(this.reviews(place));
    }
    if (isNewView) this.animateView('.venue-intro, .detail-section');
    if (focus) {
      this.title.tabIndex = -1;
      this.title.focus({ preventScroll: true });
    }
  }

  private updateVenueActions({ place, dish, manifest, inside }: ViewData) {
    const canEnterRoom = !dish && !inside && Boolean(manifest.data?.room_asset);
    const hasDishes = !dish && manifest.data?.menu_items.some(({ dish_asset }) => isSplat(dish_asset));
    const action = canEnterRoom ? 'Step inside 3D room' : hasDishes ? 'View dishes in 3D' : 'Reviews & briefing';
    if (action === this.actionKey) return;
    this.actionKey = action;
    const focused = this.venueActions.contains(document.activeElement);
    const focusedBriefing = (document.activeElement as HTMLElement | null)?.classList.contains('briefing-launch');
    const focusedCompare = this.venueComparison.contains(document.activeElement);
    const briefing = button('Reviews & briefing', () => this.actions.showBriefing(place), 'quiet briefing-launch');
    const primary = canEnterRoom ? button(action, this.actions.enterRoom, 'accent')
      : hasDishes ? button(action, () => this.focusMenu(), 'accent') : briefing;
    if (canEnterRoom) primary.dataset.control = 'room';
    if (primary === briefing && !dish) primary.classList.replace('quiet', 'accent');
    this.venueActions.replaceChildren(primary, ...(primary === briefing ? [] : [briefing]), this.venueComparison);
    if (focused) {
      const target = focusedCompare ? this.venueComparison.querySelector('button') : focusedBriefing ? briefing : primary;
      target?.focus({ preventScroll: true });
    }
  }

  private animateView(selector: string) {
    const key = this.viewKey;
    requestAnimationFrame(() => {
      if (!desktop.matches || this.root.hidden || this.viewKey !== key) return;
      const noMotion = reducedMotion.matches;
      const easing = getComputedStyle(this.root).getPropertyValue('--ease-out').trim() || 'cubic-bezier(.2,.8,.2,1)';
      const frames = noMotion ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }];
      [...this.content.querySelectorAll<HTMLElement>(selector)].filter((item) => item.offsetHeight).slice(0, 8)
        .forEach((item, index) => item.animate(frames, {
          easing, duration: noMotion ? 120 : 220, delay: noMotion ? 0 : index * 24, fill: 'backwards',
        }));
    });
  }

  /** Live web ratings appear only when the lookup succeeds; a failed lookup leaves no placeholder behind. */
  private async updateLiveReviews(place: Place, host: HTMLElement): Promise<void> {
    host.replaceChildren();
    const result = await loadLiveReviews(place.id).catch(() => undefined);
    if (!host.isConnected || !result?.live) return;
    const node = section('Live web reviews');
    for (const { source, rating, count, url } of result.ratings) {
      const row = element('p');
      row.append(url ? link(source, url) : source,
        ` · ${rating.toFixed(1)} / 5${count ? ` · ${ratingCount.format(count)} reviews` : ''}`);
      node.append(row);
    }
    if (result.highlights.length) {
      const highlights = element('ul', 'review-highlights');
      highlights.append(...result.highlights.map((text) => element('li', '', text)));
      node.append(highlights);
    }
    node.append(...result.reviews.slice(0, 3).map((review) => renderBriefingReview(liveBriefingReview(review))));
    host.replaceChildren(node);
  }

  private updateCost({ place, filters, trip, dish }: ViewData) {
    const node = section('Cost breakdown');
    const group = filters.groupSize;
    const roomPrice = !dish && place.rooms.find((room) => /hour/i.test(room.price_unit));
    const dishPrice = dish && Number.isFinite(dish.price) ? dish.price : undefined;
    const price = dishPrice ?? place.typical_price;
    const fare = trip.data?.fare ?? (filters.startStopId === place.stop_id ? 0 : MBTA_SUBWAY_FARE);
    const roundTrip = trip.data?.round_trip_fare ?? fare * 2;
    const food = roomPrice ? roomPrice.price / group : price;
    const total = money(food + fare);
    const pending = !trip.data && !trip.error;
    this.oneWay.toggleAttribute('data-loading', pending);
    this.oneWay.textContent = pending ? 'Calculating' : total;
    const rows: [string, string][] = [
      [roomPrice ? 'Room hire' : dish && dishPrice === undefined ? 'Typical venue spend (estimate)'
        : dishPrice !== undefined || place.category === 'restaurant' ? 'Food' : 'Typical venue spend',
        roomPrice ? `${money(roomPrice.price)} / hour` : money(price)],
      ['T fare, one way', money(fare)],
      ['T fare, round trip', money(roundTrip)],
      [group > 1 ? 'Round trip per person' : 'Total with round trip', money(food + roundTrip)],
      ...(group > 1 ? [['Group total, one way', money((food + fare) * group)] as [string, string]] : []),
    ];
    if (dish || !desktop.matches) rows.unshift([group > 1 ? 'One way per person' : 'Total one way', total]);
    node.append(breakdown(rows));
    this.costDetails.replaceChildren(node);
  }

  private updateTrip({ place, stop, trip, originName }: ViewData) {
    const node = section('Trip breakdown');
    this.doorToDoor.toggleAttribute('data-loading', !trip.data && !trip.error);
    this.doorToDoor.toggleAttribute('data-unavailable', !trip.data && Boolean(trip.error));
    this.doorToDoor.textContent = trip.data ? formatMinutes(trip.data.total_min) : trip.error ? 'Unavailable' : 'Calculating';
    if (trip.data) {
      const data = trip.data;
      const live = data.prediction_source === 'live';
      const usesTrain = data.from_stop_id !== data.to_stop_id;
      const rows: [string, number][] = [
        ['Walk to stop', data.walk_to_station_min], [live ? 'Next live train' : 'Train wait', data.wait_min],
        ['Ride', data.ride_min], ['Transfers', data.transfer_min], ['Walk to venue', data.walk_to_venue_min],
        ['Total', data.total_min],
      ];
      node.append(breakdown(rows.filter(([, minutes]) => minutes > 0).map(([label, minutes]) => [label, formatMinutes(minutes)])));
      if (trip.offline) node.append(message('Live trip data is unavailable. Showing an offline estimate.'));
      if (place.evening_venue && usesTrain) {
        node.append(element('p', 'badge', data.last_train_time ? `Last train home · ${formatTrainTime(data.last_train_time)}` : 'Last train home · check MBTA schedules'));
      }
    } else node.append(message(trip.error ?? 'Calculating the train and walk time…', Boolean(trip.error)));
    if (trip.error || trip.offline) node.append(button('Refresh trip estimate', this.actions.retryTrip, 'quiet'));
    if (originName && stop) {
      const fallback = buildMbtaTripPlannerUrl(`${originName}, Boston`, { lat: place.lat, lon: place.lon });
      try { node.append(link('Open full directions on MBTA', trip.data?.planner_url || fallback)); }
      catch { node.append(link('Open full directions on MBTA', fallback)); }
    }
    this.tripDetails.replaceChildren(node);
  }

  private updateModels(data: ViewData) {
    const { place, manifest, dish, comparison, filters, fit, seating, table, highlightedDishId } = data;
    const key = JSON.stringify([place.id, dish?.id, filters.groupSize, fit, seating, table, data.rotation,
      manifest.error, manifest.offline, highlightedDishId]);
    if (this.modelKey === key && this.modelManifest === manifest.data && this.modelPlace === place
        && this.modelComparison === comparison && this.modelCatalog === data.places) return;
    const previousFocus = this.modelDetails.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.control : undefined;
    this.modelKey = key;
    this.modelManifest = manifest.data;
    this.modelPlace = place;
    this.modelComparison = comparison;
    this.modelCatalog = data.places;
    const dataManifest = manifest.data;
    const hasDishes = dataManifest?.menu_items.some(({ dish_asset }) => isSplat(dish_asset));
    const node = section(dish ? 'On the table' : hasDishes ? 'Menu in 3D' : '3D previews');
    if (manifest.offline) node.append(message('Showing bundled demo previews.'));
    if (manifest.error) node.append(message(manifest.error, true), button('Reload previews', this.actions.retryManifest));
    if (!dataManifest && !manifest.error) node.append(message('Loading room and menu previews…'));
    if (dataManifest) {
      const menu = dataManifest.menu_items;
      if (dish) {
        if (dish.price != null) node.append(element('p', 'price', formatDishPrice(dish.price)));
        if (dish.portion_note) node.append(element('p', '', dish.portion_note));

        const compare = element('select');
        compare.dataset.control = 'compare';
        compare.append(option('', 'One dish'));
        const addVenue = (venue: Place, dishes: readonly Dish[]) => {
          if (!dishes.length) return;
          const group = element('optgroup');
          group.label = venue.name;
          for (const entry of dishes) {
            const choice = option(entry.id, entry.name);
            choice.dataset.placeId = venue.id;
            group.append(choice);
          }
          compare.append(group);
        };
        addVenue(place, menu.filter((entry) => entry.dish.id !== dish.id && isSplat(entry.dish_asset)).map((entry) => entry.dish));
        for (const venue of data.places) {
          if (venue.id === place.id) continue;
          addVenue(venue, venue.dishes.filter(hasDishPreview));
        }
        compare.value = comparison?.dish.id ?? '';
        compare.disabled = compare.options.length < 2;
        compare.addEventListener('change', () => this.actions.openDish(dish, compare.value, compare.selectedOptions[0]?.dataset.placeId));
        node.append(field('Compare side-by-side', compare));
        if (compare.disabled) node.append(message('No other published 3D dish previews are available.'));
        if (comparison) {
          const listed = comparison.dish.price != null ? ` · ${formatDishPrice(comparison.dish.price)}` : '';
          node.append(element('p', '', `${comparison.dish.name} · ${comparison.place.name}${listed}`));
        }
        const slider = element('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '360';
        slider.value = String(data.rotation);
        slider.dataset.control = 'rotation';
        const degrees = element('output', 'muted', slider.value + '°');
        const updateRotation = () => {
          degrees.value = slider.value + '°';
          slider.style.setProperty('--fill', `${slider.valueAsNumber / Number(slider.max) * 100}%`);
        };
        updateRotation();
        slider.addEventListener('input', () => {
          updateRotation();
          this.actions.rotate(Number(slider.value));
        });
        const rotation = field('Turntable rotation', slider);
        rotation.classList.add('rotation-field');
        slider.id = 'dish-turntable';
        rotation.htmlFor = slider.id;
        rotation.firstElementChild?.append(degrees);
        node.append(rotation);
        const tableMode = element('select');
        tableMode.dataset.control = 'table';
        tableMode.append(option('virtual', 'Virtual table (VR)'), option('passthrough', 'Passthrough (AR)'));
        tableMode.value = table;
        tableMode.addEventListener('change', () => this.actions.table(tableMode.value === 'virtual'));
        const tableField = field('Table background', tableMode);
        tableField.classList.add('table-background-field');
        node.append(tableField);
      }

      if (!dish && dataManifest.rooms.length) {
        const room = dataManifest.rooms.find((entry) => entry.seating === seating) ?? dataManifest.rooms[0];
        const roomScale = room.asset?.scale_status ?? dataManifest.room_asset?.scale_status;
        const measurable = roomScale === 'measured' && room.floor_width_m > 0 && room.floor_depth_m > 0;
        const layout = element('select');
        layout.dataset.control = 'seating';
        layout.append(option('seated', 'Seated (0.75 m)'), option('standing', 'Standing (0.60 m)'));
        layout.value = seating;
        layout.disabled = !measurable;
        layout.addEventListener('change', () => this.actions.changeFit(fit, layout.value as Seating));
        const check = element('input');
        check.type = 'checkbox';
        check.dataset.control = 'fit';
        check.disabled = !measurable;
        check.checked = measurable && fit;
        const label = element('label', 'check');
        label.append(check, 'Will we fit?');
        check.addEventListener('change', () => this.actions.changeFit(check.checked, seating));
        node.append(label, field('Room layout', layout));
        if (measurable) {
          const spacing = seating === 'seated' ? 0.75 : 0.60;
          const capacity = Math.floor(room.floor_width_m / spacing) * Math.floor(room.floor_depth_m / spacing);
          const fits = Math.min(capacity, room.stated_capacity || capacity) >= filters.groupSize;
          node.append(
            element('p', fits ? 'price' : 'error', fits ? `Fits your group of ${filters.groupSize}` : `Your group of ${filters.groupSize} exceeds the estimate`),
            element('p', 'muted', `Fits about ${capacity} by floor space · Venue says ${room.stated_capacity || 'capacity unlisted'}`),
          );
        } else node.append(message('Verify the room scale before estimating capacity.'));
      }

      if (!menu.length) node.append(message('No menu previews have been published.'));
      const menuRows = element('div', 'venue-menu');
      for (const entry of menu) {
        if (entry.dish.id === dish?.id) continue;
        const row = element('div', 'menu-row');
        row.dataset.dishId = entry.dish.id;
        if (highlightedDishId && entry.dish.id === highlightedDishId) row.dataset.highlighted = 'true';
        const label = element('div');
        const name = element('strong', '', entry.dish.name);
        const hasPreview = isSplat(entry.dish_asset);
        if (hasPreview) name.append(previewBadge());
        const price = entry.dish.price;
        label.append(name);
        if (price != null) label.append(element('p', 'price', formatDishPrice(price)));
        row.append(label);
        if (hasPreview) {
          const view = button('View on table', () => this.actions.openDish(entry.dish), 'quiet menu-preview');
          view.setAttribute('aria-label', `View dish on table: ${entry.dish.name}`);
          row.append(view);
        }
        menuRows.append(row);
      }
      if (menuRows.children.length) node.append(menuRows);
    }
    this.modelDetails.replaceChildren(node);
    if (previousFocus) node.querySelector<HTMLElement>(`[data-control="${previousFocus}"]`)?.focus({ preventScroll: true });
  }

  private reviews(place: Place) {
    const node = section('Visit notes');
    if (!place.reviews.length) node.append(message('No approved notes yet. Share a detail from your visit.'));
    for (const review of place.reviews) {
      const item = element('article', 'visit-note');
      item.append(element('strong', '', review.author));
      item.append(element('p', '', review.text));
      node.append(item);
    }
    const form = element('form', 'form-stack');
    form.id = 'visit-note-form';
    form.hidden = true;
    const name = element('input');
    name.required = true;
    name.maxLength = 80;
    name.setAttribute('autocomplete', 'nickname');
    const text = element('textarea');
    text.required = true;
    text.maxLength = 1000;
    text.rows = 2;
    const submit = element('button', '', 'Add visit note');
    const feedback = message('A moderator reviews your note before publication.');
    form.append(field('Name shown publicly', name), field('Visit note', text), submit, feedback);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!name.value.trim() || !text.value.trim() || submit.disabled) return;
      submit.disabled = true;
      feedback.textContent = 'Submitting note…';
      feedback.classList.remove('error');
      try {
        await api.review(place.id, { author_label: name.value.trim(), text: text.value.trim() });
        form.reset();
        feedback.textContent = 'Note submitted and pending moderation.';
      } catch (error) {
        feedback.textContent = 'Could not submit the note. ' + errorText(error);
        feedback.classList.add('error');
      } finally { submit.disabled = false; }
    });
    const add = button('Add a visit note', () => {
      add.hidden = true;
      form.hidden = false;
      name.focus();
    }, 'quiet');
    add.setAttribute('aria-controls', form.id);
    node.append(add, form);
    return node;
  }

  focusMenu(dishId?: string) {
    const behavior = reducedMotion.matches ? 'instant' : 'smooth';
    if (dishId) {
      const match = this.modelDetails.querySelector<HTMLElement>(`.menu-row[data-dish-id="${CSS.escape(dishId)}"]`);
      if (match) {
        match.scrollIntoView({ block: 'center', behavior });
        return;
      }
    }
    (this.modelDetails.querySelector('.venue-menu') ?? this.modelDetails).scrollIntoView({ block: 'start', behavior });
  }

  /** Shows the send-to-device actions only while a headset or phone is paired. */
  setPaired(paired: boolean) { this.root.dataset.paired = String(paired); }

  /** Hides headset-only controls (passthrough table) on devices without WebXR. */
  setXrCapable(capable: boolean) { this.root.dataset.xrCapable = String(capable); }

  hide() {
    this.root.hidden = true;
    if (desktop.matches) this.viewKey = '';
  }
}

function formatTrainTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  });
}
