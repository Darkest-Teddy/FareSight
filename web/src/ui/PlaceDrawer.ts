import {
  buildMbtaTripPlannerUrl, formatDishPrice, MBTA_SUBWAY_FARE, ROUTE_COLORS,
  type Asset, type Dish, type MbtaSource, type Place, type RestaurantManifest, type Stop,
} from '@faresight/shared';
import { api, type Alert, type Prediction, type Trip } from '../api/client';
import { has3DDish, has3DRoom, hasDishPreview, isSplat } from '../data/preview3D';
import { bostonHours, formatHours, liveBriefingReview, loadLiveReviews, reviewFacts, week } from '../data/reviewBriefing';
import { block, button, element, errorText, field, fold, httpUrl, iconButton, link, message, money, option, previewBadge, replacePreservingFocus, section } from './dom';
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

/** Hours, address and contact. Returns the nodes and whether the venue is open right now. */
function visitFacts(place: Place): { nodes: HTMLElement[]; openNow: boolean } {
  const details = place.details;
  const hours = block('Hours');
  const { openNow } = bostonHours(place.hours, new Date());
  hours.append(element('p', openNow ? 'open-now' : 'muted', openNow ? 'Open now' : 'Closed now'));
  const today = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(new Date()).toLowerCase();
  const list = breakdown(week.map(([day, label]) => [label, formatHours(place.hours[day])]));
  list.querySelectorAll('dt').forEach((term, index) => {
    if (week[index][0] !== today) return;
    term.classList.add('today');
    term.nextElementSibling?.classList.add('today');
  });
  hours.append(list);
  if (!details?.hours_verified) hours.append(element('p', 'muted', 'Planning hours. Check with the venue.'));
  if (details?.hours_note) hours.append(element('p', 'muted', details.hours_note));
  const nodes = [hours];
  if (details && (details.address || details.website || details.phone)) {
    const contact = block('Visit');
    if (details.address) contact.append(element('p', '', details.address));
    if (details.phone) {
      const phone = element('a', 'text-link', details.phone);
      phone.href = `tel:${details.phone.replace(/[^\d+]/g, '')}`;
      contact.append(phone);
    }
    if (details.website) contact.append(link('Website', details.website));
    nodes.push(contact);
  }
  return { nodes, openNow };
}

/** Awards and published ratings. `hint` is the headline rating, when there is one. */
function publishedReviews(place: Place): { nodes: HTMLElement[]; hint: string } {
  const details = place.details;
  const nodes: HTMLElement[] = [];
  if (!details) return { nodes, hint: '' };
  if (details.ratings.length || details.review_highlights.length) {
    const reviews = block('What reviewers say');
    if (details.ratings.length) {
      reviews.append(breakdown(details.ratings.map(({ source, rating, count }) =>
        [source, `${rating.toFixed(1)} / 5${count ? ` · ${ratingCount.format(count)} reviews` : ''}`])));
    }
    if (details.review_highlights.length) {
      const items = element('ul', 'review-highlights');
      for (const text of details.review_highlights) items.append(element('li', '', text));
      reviews.append(items);
    }
    reviews.append(element('p', 'muted', `Summarized from public reviews · checked ${details.checked_on}`));
    nodes.push(reviews);
  }
  if (details.awards.length) {
    const awards = block('Recognition');
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
  const top = details.ratings[0];
  return { nodes, hint: top ? `${top.rating.toFixed(1)} / 5` : details.awards.length ? `${details.awards.length} ${details.awards.length === 1 ? 'award' : 'awards'}` : '' };
}

function assetBadges(asset: Asset) {
  const badges = element('div', 'badges');
  badges.append(element('span', 'badge', asset.provenance_label));
  if (asset.captured_on) badges.append(element('span', 'badge', 'Captured on ' + asset.captured_on.slice(0, 10)));
  badges.append(element('span', 'badge', asset.scale_label || 'Size not verified'));
  return badges;
}

export class PlaceDrawer {
  readonly root = element('aside', 'place-drawer panel');
  private readonly title = element('h2');
  private readonly caption = element('p', 'drawer-caption');
  private readonly meta = element('div', 'drawer-meta');
  private readonly content = element('div', 'drawer-scroll');
  private readonly compareTray = element('div', 'restaurant-compare-tray');
  private readonly venueComparison = element('span');
  private comparedPlaces: readonly Place[] = [];
  private comparisonKey = '';
  private readonly stationList = element('div');
  // The lead of a venue: what it costs and the main 3D action. Everything else folds away below.
  private readonly vibe = element('p', 'venue-vibe');
  private readonly costLead = element('div', 'cost-lead');
  private readonly stage = element('div', 'stage');
  private readonly trains = fold('Next trains');
  private readonly alerts = fold('Service alerts');
  private readonly menu = fold('Menu');
  private readonly fit = fold('Will we fit?');
  private readonly costs = fold('Cost and trip');
  private readonly visit = fold('Hours and contact');
  private readonly reviewsFold = fold('Reviews');
  private readonly notes = fold('Visit notes');
  private readonly tripDetails = element('div');
  private readonly costDetails = element('div');
  private readonly pairingDetails = element('div', 'button-row share-row');
  private readonly grip: HTMLButtonElement;
  private viewKey = '';
  private modelKey = '';
  private modelManifest?: RestaurantManifest;
  private modelPlace?: Place;
  private modelComparison?: DishComparison;
  private modelCatalog?: readonly Place[];
  private reviewsKey = '';

  constructor(private readonly actions: DrawerActions) {
    this.root.setAttribute('aria-labelledby', 'detail-title');
    this.title.id = 'detail-title';
    const heading = element('header', 'drawer-heading');
    const label = element('div');
    label.append(this.caption, this.title, this.meta);
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
    heading.append(label, iconButton('close', 'Close', actions.close, 'quiet'));
    this.pairingDetails.append(button('Send to paired device', actions.sendPlace), button('Send trip', actions.sendTrip, 'quiet'));
    this.costs.body.append(this.costDetails, this.tripDetails);
    this.compareTray.hidden = true;
    this.root.append(this.grip, heading, this.compareTray, this.content);
    this.root.hidden = true;
  }

  mountComparison(board?: HTMLElement): void {
    const host = board ?? this.root;
    if (this.compareTray.parentElement === host) return;
    if (board) board.insertBefore(this.compareTray, board.children[1] ?? null);
    else this.content.before(this.compareTray);
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
    if (focused) (places.length ? (compare.disabled ? clear : compare)
      : this.compareTray.parentElement?.querySelector<HTMLElement>('button:not([disabled], [hidden])'))?.focus({ preventScroll: true });
  }

  private compareButton(place: Place) {
    const selected = this.comparedPlaces.some(({ id }) => id === place.id);
    const toggle = button(selected ? 'Comparing ✓' : '+ Compare', () => this.actions.toggleComparison(place), 'quiet compare-place');
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
    const compareFocus = (document.activeElement as HTMLElement | null)?.dataset.compareVenue;
    const key = 'station:' + stop.stop_id;
    this.root.hidden = false;
    if (this.viewKey !== key) {
      this.viewKey = key;
      this.caption.textContent = stop.area_code;
      this.title.textContent = stop.name;
      this.meta.replaceChildren(lineDots(stop));
      for (const part of [this.trains, this.alerts]) {
        part.body.replaceChildren();
        part.hint.textContent = '';
      }
      this.content.replaceChildren(this.stationList, this.trains.node, this.alerts.node);
      this.content.scrollTop = 0;
    }
    const list = section('Places near the stop');
    if (places.length) list.firstElementChild?.append(element('span', 'count', String(places.length)));
    if (!places.length) {
      list.append(message('No places at this stop match your filters.'), button('Clear filters', this.actions.clearFilters));
    }
    let firstHighlighted: HTMLButtonElement | undefined;
    for (const place of places) {
      const item = button('', () => this.actions.showPlace(place), 'place-row');
      item.dataset.focusKey = place.id;
      if (highlightedPlaces?.has(place.id)) {
        item.dataset.highlighted = 'true';
        if (!firstHighlighted) firstHighlighted = item;
      }
      const label = element('span', '', place.name);
      const room = has3DRoom(place);
      const dishes = has3DDish(place);
      if (room || dishes) label.append(previewBadge());
      const preview = room && dishes ? ' · 3D room & dishes' : room ? ' · 3D room' : dishes ? ' · 3D dishes' : '';
      label.append(element('small', '', `${place.walk_from_stop_m} m from station${preview}`));
      item.append(label, element('strong', 'price', money(oneWayCost(place, filters.startStopId, filters.groupSize))));
      const row = element('div', 'place-compare-row');
      row.append(item, this.compareButton(place));
      list.append(row);
    }
    replacePreservingFocus(this.stationList, this.title, list);
    if (compareFocus) [...list.querySelectorAll<HTMLButtonElement>('.compare-place')]
      .find((toggle) => toggle.dataset.compareVenue === compareFocus)?.focus({ preventScroll: true });
    if (firstHighlighted) firstHighlighted.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (focus) {
      this.title.tabIndex = -1;
      this.title.focus({ preventScroll: true });
    }
  }

  updateStation(stop: Stop, data: StationData, campusMinutes?: number) {
    if (this.viewKey !== 'station:' + stop.stop_id) return;
    const arrivals: HTMLElement[] = [];
    let next = '';
    if (campusMinutes !== undefined) arrivals.push(element('p', 'readout', `${campusMinutes} min from BU Central · estimate`));
    if (data.predictions.data) {
      const { predictions, source } = data.predictions.data;
      const timed = predictions.filter((entry) => entry.arrival_min !== null).sort((a, b) => a.arrival_min! - b.arrival_min!);
      arrivals.push(element('p', 'muted', source === 'live' ? 'Live MBTA predictions' : 'Simulated train times'));
      if (timed.length) {
        arrivals.push(breakdown(timed.slice(0, 5).map((entry) => [
          [entry.route_id, entry.direction].filter((value) => value !== null && value !== undefined).join(' · '),
          entry.arrival_min === 0 ? 'Due' : `${entry.arrival_min} min`,
        ])));
        next = timed[0].arrival_min === 0 ? 'Due now' : `Next in ${timed[0].arrival_min} min`;
      } else {
        arrivals.push(message('No timed arrivals for this stop. Check the MBTA trip planner.'));
        next = 'None timed';
      }
    } else {
      arrivals.push(message(data.predictions.error ?? 'Checking next trains…', Boolean(data.predictions.error)));
      if (data.predictions.error) arrivals.push(button('Retry arrivals', this.actions.retryStation));
      next = data.predictions.error ? 'Unavailable' : 'Checking…';
    }
    replacePreservingFocus(this.trains.body, this.title, ...arrivals);
    this.trains.hint.textContent = next;
    this.trains.hint.dataset.tone = data.predictions.error ? 'problem' : '';

    let flagged = 0;
    if (data.alerts.data) {
      const applicable = data.alerts.data.filter((alert) => alert.stop_ids.includes(stop.stop_id)
        || alert.route_ids.some((route) => stop.lines.includes(route))
        || (!alert.stop_ids.length && !alert.route_ids.length));
      flagged = applicable.length;
      if (flagged) replacePreservingFocus(this.alerts.body, this.title, ...applicable.map((alert) => element('p', '', alert.header)));
      else replacePreservingFocus(this.alerts.body, this.title, message('No active alerts for this stop.'));
      this.alerts.hint.textContent = flagged ? `${flagged} ${flagged === 1 ? 'alert' : 'alerts'}` : 'None';
    } else {
      replacePreservingFocus(this.alerts.body, this.title, message(data.alerts.error ?? 'Checking service alerts…', Boolean(data.alerts.error)));
      this.alerts.hint.textContent = data.alerts.error ? 'Unavailable' : 'Checking…';
    }
    this.alerts.hint.dataset.tone = flagged ? 'flag' : data.alerts.error ? 'problem' : '';
  }

  venue(data: ViewData, focus = false) {
    const { place, stop, dish } = data;
    const key = 'venue:' + place.id;
    this.root.hidden = false;
    if (this.viewKey !== key) {
      this.viewKey = key;
      this.meta.replaceChildren(...(stop ? [lineDots(stop)] : []));
      const quick = element('div', 'button-row quick-actions');
      quick.append(button('Reviews & Briefing', () => this.actions.showBriefing(place), 'briefing-launch'), this.venueComparison);
      this.reviewsKey = '';
      const hours = visitFacts(place);
      this.visit.body.replaceChildren(...hours.nodes);
      this.visit.hint.textContent = hours.openNow ? 'Open now' : 'Closed now';
      const published = publishedReviews(place);
      const live = element('div');
      this.reviewsFold.body.replaceChildren(...published.nodes, live);
      this.reviewsFold.hint.textContent = published.hint;
      this.vibe.textContent = place.vibe.replaceAll('—', '–');
      this.content.replaceChildren(this.vibe, this.costLead, this.stage, quick,
        this.menu.node, this.fit.node, this.costs.node, this.visit.node, this.reviewsFold.node, this.notes.node, this.pairingDetails);
      void this.updateLiveReviews(place, live);
      this.content.scrollTop = 0;
      this.modelKey = '';
    }
    const selected = this.comparedPlaces.some(({ id }) => id === place.id);
    if (this.venueComparison.firstElementChild?.getAttribute('aria-pressed') !== String(selected)
        || (this.venueComparison.firstElementChild as HTMLElement | null)?.dataset.compareVenue !== place.id) {
      const restore = this.venueComparison.contains(document.activeElement);
      const toggle = this.compareButton(place);
      this.venueComparison.replaceChildren(toggle);
      if (restore) toggle.focus({ preventScroll: true });
    }
    this.caption.textContent = dish ? place.name : [stop?.name, stop?.area_code].filter(Boolean).join(' · ');
    // The venue blurb steps aside while one dish is on the table.
    this.vibe.hidden = Boolean(dish);
    this.title.textContent = (dish?.name ?? place.name).replaceAll('—', '–');
    this.updateCost(data);
    this.updateTrip(data);
    this.updateModels(data);
    const reviewsKey = JSON.stringify(place.reviews);
    if (this.reviewsKey !== reviewsKey) {
      this.reviewsKey = reviewsKey;
      replacePreservingFocus(this.notes.body, this.title, ...this.reviews(place));
      this.notes.hint.textContent = place.reviews.length ? `${place.reviews.length} ${place.reviews.length === 1 ? 'note' : 'notes'}` : 'Add yours';
    }
    if (focus) {
      this.title.tabIndex = -1;
      this.title.focus({ preventScroll: true });
    }
  }

  private async updateLiveReviews(place: Place, host: HTMLElement): Promise<void> {
    const node = block('Live web reviews');
    const status = message('Checking public reviews…');
    node.append(status);
    replacePreservingFocus(host, node.querySelector('h3')!, node);
    const result = await loadLiveReviews(place.id).catch(() => undefined);
    if (!host.isConnected) return;
    if (!result?.live) {
      status.textContent = 'Live reviews unavailable. Catalog notes are still available below.';
      node.append(button('Check again', () => { void this.updateLiveReviews(place, host); }, 'quiet'));
      return;
    }
    status.remove();
    const facts = reviewFacts(place.details, result);
    for (const { source, rating, count, url } of facts.ratings) {
      const row = element('p');
      row.append(url ? link(source, url) : source,
        ` · ${rating.toFixed(1)} / 5${count ? ` · ${ratingCount.format(count)} reviews` : ''}`);
      node.append(row);
    }
    if (facts.highlights.length) {
      const highlights = element('ul', 'review-highlights');
      highlights.append(...facts.highlights.map((text) => element('li', '', text)));
      node.append(highlights);
    }
    if (result.reviews?.length) {
      node.append(...result.reviews.slice(0, 3).map((review) => renderBriefingReview(liveBriefingReview(review))));
    } else node.append(element('p', 'muted', 'No attributed customer excerpts found.'));
  }

  private updateCost({ place, filters, trip, dish }: ViewData) {
    const group = filters.groupSize;
    const roomPrice = !dish && place.rooms.find((room) => /hour/i.test(room.price_unit));
    const price = dish?.price ?? place.typical_price;
    const spendLabel = dish && dish.price == null ? 'Typical venue spend (estimate)'
      : dish || place.category === 'restaurant' ? 'Food' : 'Typical venue spend';
    const fare = trip.data?.fare ?? (filters.startStopId === place.stop_id ? 0 : MBTA_SUBWAY_FARE);
    const roundTrip = trip.data?.round_trip_fare ?? fare * 2;
    const food = roomPrice ? roomPrice.price / group : price;
    const total = element('p', 'cost-total', money(food + fare));
    total.append(element('span', 'cost-unit', group > 1 ? 'per person' : 'one way'));
    const parts = `${roomPrice ? 'Room share' : dish || place.category === 'restaurant' ? 'Food' : 'Typical spend'} ${money(food)} + T fare ${money(fare)}`;
    this.costLead.replaceChildren(total, element('p', 'muted', parts));
    const node = block('Total cost');
    node.append(breakdown([
      [roomPrice ? 'Room hire' : spendLabel, roomPrice ? `${money(roomPrice.price)} / hour` : money(price)],
      ['T fare, one way', money(fare)],
      ['T fare, round trip', money(roundTrip)],
      [group > 1 ? 'Round trip per person' : 'Total with round trip', money(food + roundTrip)],
      ...(group > 1 ? [['Group total, one way', money((food + fare) * group)] as [string, string]] : []),
    ]));
    node.append(element('p', 'muted', place.price_checked_on ? `Price checked ${place.price_checked_on}` : 'Planning price estimate. Check with the venue.'));
    this.costDetails.replaceChildren(node);
  }

  private updateTrip({ place, stop, trip, originName }: ViewData) {
    const node = block('Trip estimate');
    if (trip.data) {
      const data = trip.data;
      const live = data.prediction_source === 'live';
      const usesTrain = data.from_stop_id !== data.to_stop_id;
      const source = !usesTrain ? 'Walk from the selected stop' : live ? 'Live MBTA wait' : data.prediction_source === 'simulated' ? 'Simulated train wait' : 'Scheduled planning estimate';
      node.append(element('p', 'muted', [originName ? `From ${originName}` : '', source].filter(Boolean).join(' · ')));
      node.append(breakdown([
        ['Walk to stop', `${data.walk_to_station_min} min`], [live ? 'Next live train' : 'Train wait', `${data.wait_min} min`],
        ['Ride', `${data.ride_min} min`], ['Transfers', `${data.transfer_min} min`], ['Walk to venue', `${data.walk_to_venue_min} min`],
        ['Total', `${data.total_min} min`],
      ]));
      if (trip.offline) node.append(message('Live trip data is unavailable. Showing an offline estimate.'));
      if (place.evening_venue && usesTrain) {
        node.append(element('p', 'badge', data.last_train_time ? `Last train home · ${formatTrainTime(data.last_train_time)}` : 'Last train home · check MBTA schedules'));
      }
    } else node.append(message(trip.error ?? 'Calculating the train and walk time…', Boolean(trip.error)));
    if (trip.error || trip.offline) node.append(button('Refresh trip estimate', this.actions.retryTrip, 'quiet'));
    if (originName && stop) {
      const fallback = buildMbtaTripPlannerUrl(`${originName}, Boston`, { lat: place.lat, lon: place.lon });
      node.append(link('Open full directions on MBTA', httpUrl(trip.data?.planner_url)?.href ?? fallback));
    }
    replacePreservingFocus(this.tripDetails, this.title, node);
    this.costs.hint.textContent = trip.data ? `${Math.max(1, Math.round(trip.data.total_min))} min trip` : '';
  }

  private updateModels(data: ViewData) {
    const { place, manifest, dish, comparison, inside, filters, fit, seating, table, highlightedDishId } = data;
    const key = JSON.stringify([place.id, dish?.id, inside, filters.groupSize, fit, seating, table,
      manifest.error, manifest.offline, highlightedDishId]);
    if (this.modelKey === key && this.modelManifest === manifest.data && this.modelPlace === place
        && this.modelComparison === comparison && this.modelCatalog === data.places) return;
    this.modelKey = key;
    this.modelManifest = manifest.data;
    this.modelPlace = place;
    this.modelComparison = comparison;
    this.modelCatalog = data.places;
    const node = element('div', 'stage-body');
    if (dish) node.append(element('h3', '', 'On the table'));
    if (manifest.offline) node.append(message('Showing bundled demo previews.'));
    if (manifest.error) node.append(message(manifest.error, true), button('Reload previews', this.actions.retryManifest));
    const dataManifest = manifest.data;
    if (!dataManifest && !manifest.error) node.append(message('Loading room and menu previews…'));
    const fitting: HTMLElement[] = [];
    const dishes: HTMLElement[] = [];
    let fitHint = '';
    if (dataManifest) {
      const menu = dataManifest.menu_items;
      if (!dish) {
        if (dataManifest.room_asset) {
          const roomButton = button(inside ? 'Reset room view' : 'Step inside 3D room', this.actions.enterRoom, inside ? 'stage-action' : 'accent stage-action');
          roomButton.dataset.control = 'room';
          node.append(roomButton, assetBadges(dataManifest.room_asset));
        } else node.append(message('The venue has no published room preview. Add one in Upload 3D.'));
      }
      if (dish) {
        const active = menu.find((entry) => entry.dish.id === dish.id)?.dish_asset;
        node.append(element('p', 'price dish-price', formatDishPrice(dish.price)));
        if (dish.portion_note) node.append(element('p', '', dish.portion_note));
        if (active) node.append(assetBadges(active));

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
          node.append(element('p', '', `${comparison.dish.name} · ${comparison.place.name} · ${formatDishPrice(comparison.dish.price)}`));
          node.append(assetBadges(comparison.asset));
          if (comparison.offline) node.append(message('The comparison uses a bundled preview.'));
          if (active?.scale_status !== 'measured' || comparison.asset.scale_status !== 'measured') {
            node.append(message('Relative size is approximate. One or both dishes use an unverified scale.'));
          }
        }
        const slider = element('input');
        slider.type = 'range';
        slider.min = '0';
        slider.max = '360';
        slider.value = String(data.rotation);
        slider.dataset.control = 'rotation';
        const degrees = element('output', 'muted', slider.value + '°');
        degrees.dataset.rotationReadout = '';
        slider.addEventListener('input', () => this.actions.rotate(Number(slider.value)));
        const turntable = field('Turntable rotation', slider);
        turntable.classList.add('turntable');
        turntable.firstElementChild?.append(degrees);
        node.append(turntable);
        const tableMode = element('select');
        tableMode.dataset.control = 'table';
        tableMode.append(option('virtual', 'Virtual table (VR)'), option('passthrough', 'Passthrough (AR)'));
        tableMode.value = table;
        tableMode.addEventListener('change', () => this.actions.table(tableMode.value === 'virtual'));
        node.append(field('Table background', tableMode));
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
        label.append(check, 'Show my group in the room');
        check.addEventListener('change', () => this.actions.changeFit(check.checked, seating));
        fitting.push(label, field('Room layout', layout));
        if (measurable) {
          const spacing = seating === 'seated' ? 0.75 : 0.60;
          const capacity = Math.floor(room.floor_width_m / spacing) * Math.floor(room.floor_depth_m / spacing);
          const fits = Math.min(capacity, room.stated_capacity || capacity) >= filters.groupSize;
          fitting.push(
            element('p', fits ? 'fit-yes' : 'error', fits ? `Fits your group of ${filters.groupSize}` : `Your group of ${filters.groupSize} exceeds the estimate`),
            element('p', 'muted', `Fits about ${capacity} by floor space · Venue says ${room.stated_capacity || 'capacity unlisted'}`),
          );
          fitHint = fits ? `Fits ${filters.groupSize}` : `Too small for ${filters.groupSize}`;
        } else {
          fitting.push(message('Verify the room scale before estimating capacity.'));
          fitHint = 'Scale not verified';
        }
      }

      if (!menu.length) dishes.push(message('No menu previews have been published.'));
      let listed = 0;
      let in3D = 0;
      for (const entry of menu) {
        if (entry.dish.id === dish?.id) continue;
        listed++;
        const row = element('div', 'menu-row');
        row.dataset.dishId = entry.dish.id;
        if (highlightedDishId && entry.dish.id === highlightedDishId) row.dataset.highlighted = 'true';
        const label = element('div');
        const name = element('strong', '', entry.dish.name);
        if (hasDishPreview(entry.dish) || isSplat(entry.dish_asset)) name.append(previewBadge());
        label.append(name, element('p', 'price', formatDishPrice(entry.dish.price)));
        row.append(label);
        if (entry.dish_asset) {
          in3D++;
          const view = button('View in 3D', () => this.actions.openDish(entry.dish));
          view.setAttribute('aria-label', `View ${entry.dish.name} on the table in 3D`);
          view.dataset.focusKey = entry.dish.id;
          row.append(view);
        } else row.append(element('span', 'muted', 'No 3D preview'));
        dishes.push(row);
      }
      this.menu.hint.textContent = listed ? `${listed} ${listed === 1 ? 'dish' : 'dishes'}${in3D ? ` · ${in3D} in 3D` : ''}` : menu.length ? '' : 'None yet';
    } else this.menu.hint.textContent = '';
    this.menu.title.textContent = dish ? 'More dishes' : 'Menu';
    this.menu.node.hidden = !dataManifest || (Boolean(dish) && !dishes.length);
    this.fit.node.hidden = !fitting.length;
    this.fit.hint.textContent = fitHint;
    replacePreservingFocus(this.stage, this.title, node);
    replacePreservingFocus(this.fit.body, this.title, ...fitting);
    replacePreservingFocus(this.menu.body, this.title, ...dishes);
    // A fold that holds the thing being pointed at opens, so a highlight is never hidden.
    if (highlightedDishId && dishes.some((row) => row.dataset.highlighted === 'true')) this.menu.node.open = true;
    if (fit && fitting.length) this.fit.node.open = true;
  }

  setRotation(degrees: number): void {
    const slider = this.stage.querySelector<HTMLInputElement>('[data-control="rotation"]');
    const readout = this.stage.querySelector<HTMLOutputElement>('[data-rotation-readout]');
    if (slider) slider.value = String(degrees);
    if (slider && readout) readout.value = `${slider.value}°`;
  }

  private reviews(place: Place) {
    const node: HTMLElement[] = [];
    if (!place.reviews.length) node.push(message('No approved notes yet. Share a detail from your visit.'));
    for (const review of place.reviews) {
      const item = element('article', 'visit-note');
      item.append(element('strong', '', review.author));
      if (review.sample) item.append(element('span', 'briefing-sample', 'Sample diner note'));
      item.append(element('p', '', review.text));
      node.push(item);
    }
    const form = element('form', 'form-stack');
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
    node.push(form);
    return node;
  }

  focusMenu(dishId?: string) {
    this.menu.node.open = true;
    if (dishId) {
      const match = this.menu.body.querySelector<HTMLElement>(`.menu-row[data-dish-id="${CSS.escape(dishId)}"]`);
      if (match) {
        match.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    this.menu.node.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  hide() { this.root.hidden = true; }
}

function formatTrainTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  });
}
