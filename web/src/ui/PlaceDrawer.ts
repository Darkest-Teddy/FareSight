import {
  buildMbtaTripPlannerUrl, MBTA_SUBWAY_FARE, ROUTE_COLORS,
  type Asset, type Dish, type MbtaSource, type Place, type RestaurantManifest, type Stop,
} from '@faresight/shared';
import { api, type Alert, type Prediction, type Trip } from '../api/client';
import { button, element, errorText, field, link, message, money, option, section } from './dom';
import { oneWayCost, type Filters } from './state';

export type Seating = 'seated' | 'standing';
type Load<T> = { data?: T; error?: string };
export interface StationData {
  predictions: Load<{ predictions: Prediction[]; source: MbtaSource }>;
  alerts: Load<Alert[]>;
}
export interface ViewData {
  place: Place;
  stop?: Stop;
  filters: Filters;
  manifest: Load<RestaurantManifest> & { offline?: boolean };
  trip: Load<Trip> & { offline?: boolean };
  originName?: string;
  dish?: Dish;
  compareId: string;
  fit: boolean;
  seating: Seating;
  rotation: number;
  table: 'virtual' | 'passthrough';
  inside: boolean;
}
interface DrawerActions {
  close(): void;
  toggleSheet(): void;
  showPlace(place: Place): void;
  enterRoom(): void;
  openDish(dish: Dish, compareId?: string): void;
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
    this.root.append(this.grip, heading, this.content);
    this.root.hidden = true;
  }

  expanded(expanded: boolean) {
    this.root.classList.toggle('expanded', expanded);
    this.grip.setAttribute('aria-expanded', String(expanded));
    this.grip.textContent = expanded ? 'Collapse sheet' : 'Expand sheet';
  }

  station(stop: Stop, places: Place[], filters: Filters, focus = false) {
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
    for (const place of places) {
      const item = button('', () => this.actions.showPlace(place), 'place-row');
      const label = element('span', '', place.name);
      label.append(element('small', '', `${place.walk_from_stop_m} m from station`));
      item.append(label, element('strong', 'price', money(oneWayCost(place, filters.startStopId, filters.groupSize))));
      list.append(item);
    }
    this.stationList.replaceChildren(list);
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
    this.stationDetails.replaceChildren(arrivals, alerts);
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
      this.reviewsNode = element('div');
      this.reviewsKey = '';
      this.content.replaceChildren(summary, this.costDetails, this.tripDetails, this.modelDetails, this.pairingDetails, this.reviewsNode);
      this.content.scrollTop = 0;
      this.modelKey = '';
    }
    this.caption.textContent = dish ? place.name : [stop?.name, stop?.area_code].filter(Boolean).join(' · ');
    this.title.textContent = (dish?.name ?? place.name).replaceAll('—', '–');
    this.updateCost(data);
    this.updateTrip(data);
    this.updateModels(data);
    const reviewsKey = JSON.stringify(place.reviews);
    if (this.reviewsKey !== reviewsKey) {
      this.reviewsKey = reviewsKey;
      this.reviewsNode?.replaceChildren(this.reviews(place));
    }
    if (focus) {
      this.title.tabIndex = -1;
      this.title.focus({ preventScroll: true });
    }
  }

  private updateCost({ place, filters, trip, dish }: ViewData) {
    const node = section('Total cost');
    const group = filters.groupSize;
    const roomPrice = !dish && place.rooms.find((room) => /hour/i.test(room.price_unit));
    const price = dish?.price ?? place.typical_price;
    const fare = trip.data?.fare ?? (filters.startStopId === place.stop_id ? 0 : MBTA_SUBWAY_FARE);
    const roundTrip = trip.data?.round_trip_fare ?? fare * 2;
    const food = roomPrice ? roomPrice.price / group : price;
    node.append(element('p', 'cost-total price', `${money(food + fare)} ${group > 1 ? 'per person' : 'one way'}`));
    node.append(breakdown([
      [roomPrice ? 'Room hire' : dish || place.category === 'restaurant' ? 'Food' : 'Typical venue spend', roomPrice ? `${money(roomPrice.price)} / hour` : money(price)],
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
      try { node.append(link('Open full directions on MBTA', trip.data?.planner_url || fallback)); }
      catch { node.append(link('Open full directions on MBTA', fallback)); }
    }
    this.tripDetails.replaceChildren(node);
  }

  private updateModels(data: ViewData) {
    const { place, manifest, dish, compareId, inside, filters, fit, seating, table } = data;
    const key = JSON.stringify([place.id, dish?.id, compareId, inside, filters.groupSize, fit, seating, table, manifest.error, manifest.offline]);
    if (this.modelKey === key && this.modelManifest === manifest.data && this.modelPlace === place) return;
    const previousFocus = this.modelDetails.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.control : undefined;
    this.modelKey = key;
    this.modelManifest = manifest.data;
    this.modelPlace = place;
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
        if (dish.portion_note) node.append(element('p', '', dish.portion_note));

        const compare = element('select');
        compare.dataset.control = 'compare';
        compare.append(option('', 'One dish'));
        for (const entry of menu) {
          if (entry.dish.id !== dish.id && entry.dish_asset) compare.append(option(entry.dish.id, entry.dish.name));
        }
        compare.value = compareId;
        compare.disabled = compare.options.length < 2;
        compare.addEventListener('change', () => this.actions.openDish(dish, compare.value));
        node.append(field('Compare side-by-side', compare));
        if (compare.disabled) node.append(message('This venue has one published dish preview.'));
        const compared = menu.find((entry) => entry.dish.id === compareId);
        if (compared?.dish_asset) {
          node.append(element('p', '', compared.dish.name));
          badgeAsset(compared.dish_asset, node);
          if (active?.scale_status !== 'measured' || compared.dish_asset.scale_status !== 'measured') {
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
        slider.addEventListener('input', () => {
          degrees.value = slider.value + '°';
          this.actions.rotate(Number(slider.value));
        });
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
        const label = element('div');
        label.append(element('strong', '', entry.dish.name), element('p', 'price', money(entry.dish.price)));
        row.append(label);
        if (entry.dish_asset) row.append(button('View dish on table', () => this.actions.openDish(entry.dish)));
        else row.append(element('span', 'muted', 'No 3D preview'));
        node.append(row);
      }
    }
    this.modelDetails.replaceChildren(node);
    if (previousFocus) node.querySelector<HTMLElement>(`[data-control="${previousFocus}"]`)?.focus({ preventScroll: true });
  }

  private reviews(place: Place) {
    const node = section('Visit notes');
    if (!place.reviews.length) node.append(message('No approved notes yet. Share a detail from your visit.'));
    for (const review of place.reviews) {
      const item = element('article', 'visit-note');
      item.append(element('strong', '', review.author), element('p', '', review.text));
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

  hide() { this.root.hidden = true; }
}

function formatTrainTime(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return value;
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleTimeString('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  });
}
