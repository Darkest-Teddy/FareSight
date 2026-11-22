import {
  buildMbtaTripPlannerUrl, formatDishPrice, MBTA_SUBWAY_FARE, ROUTE_COLORS,
  type Asset, type Dish, type MbtaSource, type Place, type RestaurantManifest, type Stop,
} from '@faresight/shared';
import { api, type Alert, type Prediction, type Trip } from '../api/client';
import { has3DDish, has3DRoom, hasDishPreview, isSplat } from '../data/preview3D';
import { bostonHours, formatHours, liveBriefingReview, loadLiveReviews, reviewFacts, week } from '../data/reviewBriefing';
import { button, element, errorText, field, httpUrl, link, message, money, option, previewBadge, replacePreservingFocus, section } from './dom';
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

function venueFacts(place: Place): HTMLElement[] {
  const details = place.details;
  const nodes: HTMLElement[] = [];
  const hours = section('Hours');
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
  nodes.push(hours);
  if (!details) return nodes;

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
    reviews.append(element('p', 'muted', `Summarized from public reviews · checked ${details.checked_on}`));
    nodes.push(reviews);
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

function badgeAsset(asset: Asset, node: HTMLElement) {
  const badges = element('div', 'badges');
  badges.append(element('span', 'badge', asset.provenance_label));
  if (asset.captured_on) badges.append(element('span', 'badge', 'Captured on ' + asset.captured_on.slice(0, 10)));
  badges.append(element('span', 'badge', asset.scale_label || 'Size not verified'));
  node.append(badges);
}

export class PlaceDrawer {
  readonly root = element('aside', 'place-drawer panel');
  private readonly title = element('h2');
  private readonly caption = element('p', 'drawer-caption');
  private readonly content = element('div', 'drawer-scroll');
  private readonly compareTray = element('div', 'restaurant-compare-tray');
  private readonly venueComparison = element('span');
  private comparedPlaces: readonly Place[] = [];
  private comparisonKey = '';
  private readonly stationDetails = element('div');
  private readonly stationList = element('div');
  private readonly tripDetails = element('div');
  private readonly costDetails = element('div');
  private readonly modelDetails = element('div');
  private readonly pairingDetails = element('div', 'button-row detail-section');
  private readonly grip: HTMLButtonElement;
  private viewKey = '';
  private modelKey = '';
  private modelManifest?: RestaurantManifest;
  private modelPlace?: Place;
  private modelComparison?: DishComparison;
  private modelCatalog?: readonly Place[];
  private reviewsNode?: HTMLElement;
  private reviewsKey = '';

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
    heading.append(label, button('Close', actions.close, 'quiet'));
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
      this.stationDetails.replaceChildren();
      this.content.replaceChildren(lineDots(stop), this.stationDetails, this.stationList);
      this.content.scrollTop = 0;
    }
    const list = section('Places near the stop');
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
    const arrivals = section('Next trains');
    if (campusMinutes !== undefined) arrivals.append(element('p', 'readout', `${campusMinutes} min from BU Central · estimate`));
    if (data.predictions.data) {
      const { predictions, source } = data.predictions.data;
      const timed = predictions.filter((entry) => entry.arrival_min !== null).sort((a, b) => a.arrival_min! - b.arrival_min!);
      arrivals.append(element('p', 'muted', source === 'live' ? 'Live MBTA predictions' : 'Simulated train times'));
      if (timed.length) {
        arrivals.append(breakdown(timed.slice(0, 5).map((entry) => [
          [entry.route_id, entry.direction].filter((value) => value !== null && value !== undefined).join(' · '),
          entry.arrival_min === 0 ? 'Due' : `${entry.arrival_min} min`,
        ])));
      } else arrivals.append(message('No timed arrivals for this stop. Check the MBTA trip planner.'));
    } else {
      arrivals.append(message(data.predictions.error ?? 'Checking next trains…', Boolean(data.predictions.error)));
      if (data.predictions.error) arrivals.append(button('Retry arrivals', this.actions.retryStation));
    }

    const alerts = section('Service alerts');
    if (data.alerts.data) {
      const applicable = data.alerts.data.filter((alert) => alert.stop_ids.includes(stop.stop_id)
        || alert.route_ids.some((route) => stop.lines.includes(route))
        || (!alert.stop_ids.length && !alert.route_ids.length));
      if (applicable.length) alerts.append(...applicable.map((alert) => element('p', '', alert.header)));
      else alerts.append(message('No active alerts for this stop.'));
    } else alerts.append(message(data.alerts.error ?? 'Checking service alerts…', Boolean(data.alerts.error)));
    replacePreservingFocus(this.stationDetails, this.title, arrivals, alerts);
  }

  venue(data: ViewData, focus = false) {
    const { place, stop, dish } = data;
    const key = 'venue:' + place.id;
    this.root.hidden = false;
    if (this.viewKey !== key) {
      this.viewKey = key;
      const summary = element('div', 'venue-intro');
      summary.append(element('p', '', place.vibe));
      if (stop) summary.append(lineDots(stop));
      summary.append(button('Reviews & Briefing', () => this.actions.showBriefing(place), 'quiet briefing-launch'));
      summary.append(this.venueComparison);
      this.reviewsNode = element('div');
      this.reviewsKey = '';
      const live = element('div');
      this.content.replaceChildren(summary, ...venueFacts(place), live, this.costDetails, this.tripDetails, this.modelDetails, this.pairingDetails, this.reviewsNode);
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
    this.title.textContent = (dish?.name ?? place.name).replaceAll('—', '–');
    this.updateCost(data);
    this.updateTrip(data);
    this.updateModels(data);
    const reviewsKey = JSON.stringify(place.reviews);
    if (this.reviewsKey !== reviewsKey) {
      this.reviewsKey = reviewsKey;
      if (this.reviewsNode) replacePreservingFocus(this.reviewsNode, this.title, this.reviews(place));
    }
    if (focus) {
      this.title.tabIndex = -1;
      this.title.focus({ preventScroll: true });
    }
  }

  private async updateLiveReviews(place: Place, host: HTMLElement): Promise<void> {
    const node = section('Live web reviews');
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
    const node = section('Total cost');
    const group = filters.groupSize;
    const roomPrice = !dish && place.rooms.find((room) => /hour/i.test(room.price_unit));
    const price = dish?.price ?? place.typical_price;
    const spendLabel = dish && dish.price == null ? 'Typical venue spend (estimate)'
      : dish || place.category === 'restaurant' ? 'Food' : 'Typical venue spend';
    const fare = trip.data?.fare ?? (filters.startStopId === place.stop_id ? 0 : MBTA_SUBWAY_FARE);
    const roundTrip = trip.data?.round_trip_fare ?? fare * 2;
    const food = roomPrice ? roomPrice.price / group : price;
    node.append(element('p', 'cost-total price', `${money(food + fare)} ${group > 1 ? 'per person' : 'one way'}`));
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
    const node = section('Trip estimate');
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
    const node = section(dish ? 'On the table' : '3D previews');
    if (manifest.offline) node.append(message('Showing bundled demo previews.'));
    if (manifest.error) node.append(message(manifest.error, true), button('Reload previews', this.actions.retryManifest));
    const dataManifest = manifest.data;
    if (!dataManifest && !manifest.error) node.append(message('Loading room and menu previews…'));
    if (dataManifest) {
      const menu = dataManifest.menu_items;
      if (!dish) {
        if (dataManifest.room_asset) {
          badgeAsset(dataManifest.room_asset, node);
          const roomButton = button(inside ? 'Reset room view' : 'Step inside 3D room', this.actions.enterRoom, 'accent');
          roomButton.dataset.control = 'room';
          node.append(roomButton);
        } else node.append(message('The venue has no published room preview. Add one in Upload 3D.'));
      }
      if (dish) {
        const active = menu.find((entry) => entry.dish.id === dish.id)?.dish_asset;
        if (active) badgeAsset(active, node);
        node.append(element('p', 'price', formatDishPrice(dish.price)));
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
          node.append(element('p', '', `${comparison.dish.name} · ${comparison.place.name} · ${formatDishPrice(comparison.dish.price)}`));
          badgeAsset(comparison.asset, node);
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
        node.append(field('Turntable rotation', slider), degrees);
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
      for (const entry of menu) {
        if (entry.dish.id === dish?.id) continue;
        const row = element('div', 'menu-row');
        row.dataset.dishId = entry.dish.id;
        if (highlightedDishId && entry.dish.id === highlightedDishId) row.dataset.highlighted = 'true';
        const label = element('div');
        const name = element('strong', '', entry.dish.name);
        if (hasDishPreview(entry.dish) || isSplat(entry.dish_asset)) name.append(previewBadge());
        label.append(name, element('p', 'price', formatDishPrice(entry.dish.price)));
        row.append(label);
        if (entry.dish_asset) {
          const open = button('View dish on table', () => this.actions.openDish(entry.dish));
          open.setAttribute('aria-label', `View ${entry.dish.name} on the table`);
          open.dataset.focusKey = entry.dish.id;
          row.append(open);
        }
        else row.append(element('span', 'muted', 'No 3D preview'));
        node.append(row);
      }
    }
    replacePreservingFocus(this.modelDetails, this.title, node);
  }

  setRotation(degrees: number): void {
    const slider = this.modelDetails.querySelector<HTMLInputElement>('[data-control="rotation"]');
    const readout = this.modelDetails.querySelector<HTMLOutputElement>('[data-rotation-readout]');
    if (slider) slider.value = String(degrees);
    if (slider && readout) readout.value = `${slider.value}°`;
  }

  private reviews(place: Place) {
    const node = section('Visit notes');
    if (!place.reviews.length) node.append(message('No approved notes yet. Share a detail from your visit.'));
    for (const review of place.reviews) {
      const item = element('article', 'visit-note');
      item.append(element('strong', '', review.author));
      if (review.sample) item.append(element('span', 'briefing-sample', 'Sample diner note'));
      item.append(element('p', '', review.text));
      node.append(item);
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
    node.append(form);
    return node;
  }

  focusMenu(dishId?: string) {
    if (dishId) {
      const match = this.modelDetails.querySelector<HTMLElement>(`.menu-row[data-dish-id="${CSS.escape(dishId)}"]`);
      if (match) {
        match.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    }
    this.modelDetails.scrollIntoView({ block: 'start', behavior: 'smooth' });
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
