import {
  computeTripEstimate, haversineMeters, ROUTE_COLORS, RIDE_TIMES, type Dish,
  type GenerationJob, type MbtaSource, type Place, type Stop,
} from '@faresight/shared';
import { createFareSightEngine, type FareSightSceneEngine, type SceneMode } from '../xr';
import { SoundEngine } from '../audio/SoundEngine';
import { api, type PairMessage, type Trip } from '../api/client';
import { offlineCatalog, offlineManifest } from '../data/fallbackData';
import { AdminModal } from './AdminModal';
import { attribution } from './AttributionModal';
import { button, element, errorText, link, message, modal } from './dom';
import { FilterBar } from './FilterBar';
import { PairingModal } from './PairingModal';
import { lineDots, PlaceDrawer, type Seating, type StationData, type ViewData } from './PlaceDrawer';
import { initialFilters, matchingPlaces, placesAt, type Filters } from './state';
import { UploadPipelineModal } from './UploadPipelineModal';

const sceneTitles: Record<SceneMode, string> = { map: 'Map', station: 'Station', venue: 'Venue', dish: 'Dish' };
const pollInterval = 18_000;

export class AppShell {
  private readonly canvas = element('canvas', 'viewport');
  private readonly canvasNotice = element('div', 'canvas-notice');
  private readonly status = element('span', 'service-status');
  private readonly xrStatus = element('span', 'xr-status');
  private readonly notice = element('div', 'notice');
  private readonly breadcrumbs = element('nav', 'breadcrumbs');
  private readonly stationBoard = element('section', 'station-board panel');
  private readonly stationList = element('div', 'station-board-list');
  private readonly routeFeedback = element('div');
  private readonly filterBar: FilterBar;
  private readonly drawer: PlaceDrawer;
  private readonly pairing: PairingModal;
  private readonly uploader: UploadPipelineModal;
  private readonly debug = modal('Debug');
  private readonly renderStats = element('p', 'readout');
  private readonly debugLogs = element('pre', 'log-view');
  private readonly pairButton: HTMLButtonElement;
  private readonly audioButton: HTMLButtonElement;
  private readonly vrButton: HTMLButtonElement;
  private readonly arButton: HTMLButtonElement;
  private readonly xrExit: HTMLButtonElement;
  private readonly mobileButtons = new Map<string, HTMLButtonElement>();
  private readonly sound = new SoundEngine();
  private readonly logs: string[] = [];
  private readonly mobile = matchMedia('(max-width: 768px)');
  private engine?: FareSightSceneEngine;
  private engineReady = false;
  private busyScene = false;
  private sceneVersion = 0;
  private sceneQueue = Promise.resolve();
  private stops = offlineCatalog.stops;
  private places = offlineCatalog.places;
  private filtered = this.places;
  private filters: Filters = { ...initialFilters };
  private mode: SceneMode = 'map';
  private stop?: Stop;
  private place?: Place;
  private dish?: Dish;
  private compareId = '';
  private inside = false;
  private fit = false;
  private seating: Seating = 'seated';
  private rotation = 0;
  private virtualTable = true;
  private muted = true;
  private drawerOpen = false;
  private sheetExpanded = false;
  private filterOpen = false;
  private stationData: StationData = { predictions: {}, alerts: {} };
  private stationRequest = 0;
  private tripRequest = 0;
  private manifestRequest = 0;
  private manifest: ViewData['manifest'] = {};
  private trip: ViewData['trip'] = {};
  private origin?: { lat: number; lon: number };
  private catalogState: 'loading' | 'live' | 'offline' = 'loading';
  private vehicleSource?: MbtaSource | 'unavailable';
  private noticeTimer?: number;
  private syncingTransit = false;
  private xrMode: 'none' | 'vr' | 'ar' = 'none';

  constructor(private readonly root: HTMLElement) {
    root.classList.add('app-shell');
    const head = element('header', 'command-bar');
    const brand = button('FareSight', () => this.showMap(), 'wordmark');
    const mark = element('span', 'brand-mark');
    mark.setAttribute('aria-hidden', 'true');
    brand.prepend(mark);
    this.breadcrumbs.setAttribute('aria-label', 'Scene navigation');
    const operations = element('div', 'command-actions');
    this.vrButton = button('Enter VR', () => void this.launchXR('vr'), 'accent');
    this.arButton = button('AR Table', () => void this.launchXR('ar'));
    this.xrExit = button('Exit XR', () => this.engine?.exitXR(), 'accent');
    this.xrExit.hidden = true;
    this.pairButton = button('Pair Quest', () => this.pairing.open(), 'quiet desktop-action');
    this.audioButton = button('Audio off', () => this.toggleAudio(), 'quiet');
    this.audioButton.setAttribute('aria-pressed', 'false');
    const admin = new AdminModal(() => void this.loadCatalog());
    const credits = attribution(() => admin.open());
    operations.append(
      this.vrButton, this.arButton, this.xrExit,
      button('Upload 3D', () => this.uploader.open(this.place?.id), 'quiet desktop-action'),
      this.pairButton, this.audioButton, button('Debug', () => this.openDebug(), 'quiet desktop-debug'),
      button('Info', credits.open, 'quiet'),
    );
    head.append(brand, this.breadcrumbs, operations);

    this.status.setAttribute('role', 'status');
    const indicators = element('div', 'indicators');
    indicators.append(this.status, this.xrStatus);
    this.canvas.setAttribute('aria-label', 'FareSight interactive 3D view');
    this.canvas.tabIndex = 0;
    this.canvasNotice.replaceChildren(message('Loading 3D viewer…'));
    this.canvasNotice.setAttribute('aria-live', 'polite');
    this.notice.hidden = true;
    this.notice.setAttribute('role', 'status');

    const boardHead = element('header', 'station-board-heading');
    boardHead.append(element('p', 'board-kicker', 'BOSTON BY TRAIN'), element('h1', '', 'Explore by stop'));
    this.stationBoard.setAttribute('aria-label', 'Boston stops');
    this.stationBoard.append(boardHead, this.stationList, this.routeFeedback);

    this.filterBar = new FilterBar(this.filters, (patch) => this.updateFilters(patch), () => this.locate(), () => this.setFilterOpen(false));
    this.drawer = new PlaceDrawer({
      close: () => { this.drawerOpen = false; this.renderPanels(); this.mobileButtons.get('Venue')?.focus(); },
      toggleSheet: () => { this.sheetExpanded = !this.sheetExpanded; this.renderPanels(); },
      showPlace: (place) => { void this.showVenue(place); },
      enterRoom: () => void this.enterRoom(),
      openDish: (dish, compareId) => void this.showDish(dish, compareId),
      changeFit: (enabled, seating) => void this.setFit(enabled, seating),
      rotate: (degrees) => { this.rotation = degrees; this.engine?.setDishRotation(degrees * Math.PI / 180); },
      table: (useVirtual) => this.setTable(useVirtual),
      sendPlace: () => this.sendCurrent(),
      sendTrip: () => this.sendTrip(),
      clearFilters: () => this.updateFilters({ craving: 'all', maxBudget: 50, groupSize: 1, familyVisit: false }),
      retryStation: () => void this.refreshStation(),
      retryTrip: () => void this.refreshTrip(),
      retryManifest: () => void this.refreshManifest(),
    });
    this.pairing = new PairingModal((data) => void this.receivePair(data), (paired) => {
      this.pairButton.textContent = paired ? 'Paired' : 'Pair Quest';
      this.mobileButtons.get('Pair')?.setAttribute('aria-label', paired ? 'Paired devices' : 'Pair device');
    });
    this.uploader = new UploadPipelineModal({
      places: () => this.places,
      published: (job, open) => this.handlePublication(job, open),
    });
    const tabs = element('nav', 'phone-tabs');
    tabs.setAttribute('aria-label', 'Phone companion');
    for (const [label, action] of [
      ['Explore', () => this.showMap()],
      ['Filters', () => this.setFilterOpen(!this.filterOpen)],
      ['Venue', () => this.openCompanionVenue()],
      ['Upload', () => this.uploader.open(this.place?.id)],
      ['Pair', () => this.pairing.open()],
    ] as const) {
      const tab = button(label, action, 'phone-tab');
      tabs.append(tab);
      this.mobileButtons.set(label, tab);
    }

    root.replaceChildren(this.canvas, this.canvasNotice, head, indicators, this.stationBoard, this.filterBar.root, this.drawer.root, tabs, this.notice);
    this.debug.body.append(this.renderStats, this.debugLogs,
      button('Reset camera', () => this.engine?.resetCamera()),
      button('Send debug logs', () => void this.sendDebugLogs(), 'quiet'));
    this.mobile.addEventListener('change', () => this.renderPanels());
    this.sound.setMuted(true);
    this.filterBar.setStops(this.stops);
    this.renderBreadcrumbs();
    this.applyFilters();
    this.renderStatus();
    this.renderPanels();
  }

  async start() {
    void this.loadCatalog();
    void this.refreshTransit();
    window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void this.refreshTransit();
      if (this.stop) void this.refreshStation(false);
      if (this.place) void this.refreshTrip(false);
    }, pollInterval);
    window.addEventListener('online', () => { void this.loadCatalog(); void this.refreshTransit(); });
    window.addEventListener('resize', () => this.engine?.resize());
    window.addEventListener('pagehide', (event) => { if (!event.persisted) this.engine?.destroy(); });
    try {
      this.engine = createFareSightEngine(this.canvas, {
        onSelectStop: (id) => { const stop = this.findStop(id); if (stop) this.showStation(stop); },
        onSelectPlace: (id) => { const place = this.places.find((entry) => entry.id === id); if (place) void this.showVenue(place); },
        onSelectDish: (id) => { const dish = this.manifest.data?.menu_items.find((entry) => entry.dish.id === id)?.dish; if (dish) void this.showDish(dish); },
        onNavigateScene: (mode) => { if (!this.busyScene && mode !== this.mode) this.navigate(mode); },
        onXrStateChange: (state) => {
          this.xrMode = state.activeMode;
          this.root.dataset.xr = this.xrMode;
          this.vrButton.hidden = this.xrMode !== 'none';
          this.xrExit.hidden = this.xrMode === 'none';
          this.arButton.hidden = this.xrMode !== 'none';
          this.vrButton.textContent = state.vrSupported ? 'Enter VR' : 'Desktop 3D';
          this.arButton.title = state.arSupported ? 'Open an immersive AR table' : 'Open the virtual table on this device';
          this.arButton.dataset.supported = String(state.arSupported);
          this.vrButton.dataset.supported = String(state.vrSupported);
          this.xrStatus.textContent = state.activeMode === 'ar' ? 'AR table active'
            : state.activeMode === 'vr' ? 'VR active'
              : /Quest|OculusBrowser/i.test(navigator.userAgent) ? 'Quest browser'
                : state.vrSupported || state.arSupported ? 'WebXR available' : 'Desktop 3D';
        },
        onStatsUpdate: (stats) => {
          this.renderStats.textContent = `${Math.round(stats.fps)} FPS · ${stats.loadedSplats} splats loaded · ${stats.activeAssetLabel}`;
        },
        onDebugLog: (text, level) => this.log(`${level ?? 'info'}: ${text}`),
      });
      await this.engine.init();
      this.engineReady = true;
      this.canvasNotice.hidden = true;
      this.engine.setStops(this.stops);
      this.applyFilters();
      this.renderScene();
      void this.refreshTransit();
    } catch (error) {
      this.engine?.destroy();
      this.engine = undefined;
      this.canvasNotice.replaceChildren(message('3D viewer unavailable. Use the stop list to keep exploring.', true));
      this.log(errorText(error));
      this.vrButton.hidden = this.arButton.hidden = true;
    }
  }

  private findStop(id: string) { return this.stops.find((stop) => stop.stop_id === id); }

  private renderStatus() {
    this.status.textContent = this.catalogState === 'offline' ? 'Offline catalog'
      : this.vehicleSource === 'live' ? 'Live MBTA'
        : this.vehicleSource === 'simulated' ? 'Simulated trains'
          : this.vehicleSource === 'unavailable' ? 'Trains unavailable' : 'Checking MBTA';
    this.status.dataset.source = this.catalogState === 'offline' ? 'offline' : this.vehicleSource ?? 'pending';
  }

  private async loadCatalog() {
    if (this.catalogState === 'loading') this.routeFeedback.replaceChildren(message('Checking the catalog…'));
    try {
      const catalog = await api.catalog();
      this.stops = catalog.stops;
      this.places = catalog.places;
      this.catalogState = 'live';
      if (this.place) this.place = this.places.find((entry) => entry.id === this.place?.id) ?? this.place;
      if (this.stop) this.stop = this.findStop(this.stop.stop_id) ?? this.stop;
      if (!this.findStop(this.filters.startStopId) && this.stops[0]) this.filters.startStopId = this.stops[0].stop_id;
      this.routeFeedback.replaceChildren();
    } catch (error) {
      this.catalogState = 'offline';
      this.log('Catalog: ' + errorText(error));
      this.routeFeedback.replaceChildren(message('Using the offline catalog.'), button('Retry connection', () => void this.loadCatalog(), 'quiet'));
    }
    if (!this.stops.length) this.routeFeedback.replaceChildren(message('The catalog has no stops.'), button('Reload stops', () => void this.loadCatalog(), 'quiet'));
    this.renderStatus();
    this.filterBar.setStops(this.stops);
    if (this.engineReady) this.engine?.setStops(this.stops);
    this.applyFilters();
    this.renderBreadcrumbs();
  }

  private async refreshTransit() {
    if (this.syncingTransit) return;
    this.syncingTransit = true;
    try {
      const { vehicles, source } = await api.vehicles();
      this.vehicleSource = source;
      if (this.engineReady) this.engine?.setLiveVehicles(vehicles.map((vehicle) => ({
        id: vehicle.id, route_id: vehicle.route_id, lat: vehicle.lat, lon: vehicle.lon, bearing: vehicle.bearing ?? undefined,
        line_color: ROUTE_COLORS[vehicle.route_id] ?? '#A8B3CF', label: vehicle.route_id,
      })));
    } catch {
      this.vehicleSource = 'unavailable';
      if (this.engineReady) this.engine?.setLiveVehicles([]);
    } finally {
      this.syncingTransit = false;
      this.renderStatus();
    }
  }

  private renderBreadcrumbs() {
    const names = [sceneTitles.map, this.stop?.name ?? sceneTitles.station, this.place?.name ?? sceneTitles.venue, this.dish?.name ?? sceneTitles.dish];
    const nodes = (Object.keys(sceneTitles) as SceneMode[]).map((mode, index) => {
      const label = names[index];
      const available = mode === 'map' || (mode === 'station' && this.stop) || (mode === 'venue' && this.place) || (mode === 'dish' && this.dish);
      const node = available ? button(label, () => this.navigate(mode), 'crumb') : element('span', 'crumb unavailable', label);
      if (mode === this.mode) node.setAttribute('aria-current', 'page');
      return node;
    });
    this.breadcrumbs.replaceChildren(...nodes);
  }

  private renderStationBoard() {
    const key = JSON.stringify([this.filters.familyVisit, ...this.stops.map((stop) => [
      stop.stop_id, this.filtered.filter((place) => place.stop_id === stop.stop_id).length,
    ])]);
    if (this.stationList.dataset.summary === key) return;
    this.stationList.dataset.summary = key;
    this.stationList.replaceChildren();
    for (const stop of this.stops) {
      const count = this.filtered.filter((place) => place.stop_id === stop.stop_id).length;
      if (this.filters.familyVisit && count === 0) continue;
      const row = button('', () => this.showStation(stop), 'station-row');
      row.append(lineDots(stop), element('strong', '', stop.name), element('span', 'station-count', String(count)));
      row.setAttribute('aria-label', `${stop.name}, ${count} matching ${count === 1 ? 'place' : 'places'}`);
      this.stationList.append(row);
    }
    if (this.filters.familyVisit && !this.stationList.children.length) {
      this.stationList.append(message('No stops match the family visit filters.'));
    }
  }

  private renderPanels() {
    this.root.dataset.filterOpen = String(this.filterOpen);
    this.root.dataset.scene = this.mode;
    this.stationBoard.hidden = this.mode !== 'map';
    const shown = this.drawerOpen && this.mode !== 'map' && !(this.mobile.matches && this.filterOpen);
    this.root.dataset.drawer = String(shown);
    if (shown) this.renderDrawer();
    else this.drawer.hide();
    this.drawer.expanded(this.sheetExpanded);
    this.mobileButtons.get('Explore')?.setAttribute('aria-pressed', String(!this.filterOpen && this.mode === 'map'));
    this.mobileButtons.get('Filters')?.setAttribute('aria-pressed', String(this.filterOpen));
    this.mobileButtons.get('Venue')?.setAttribute('aria-pressed', String(shown));
  }

  private renderDrawer(focus = false) {
    if (!this.drawerOpen || (this.mobile.matches && this.filterOpen)) return;
    if (this.mode === 'station' && this.stop) {
      this.drawer.station(this.stop, placesAt(this.filtered, this.stop, this.filters), this.filters, focus);
      this.updateStationDrawer();
    }
    if ((this.mode === 'venue' || this.mode === 'dish') && this.place) {
      this.drawer.venue({
        place: this.place, stop: this.stop, filters: this.filters, manifest: this.manifest, trip: this.trip, dish: this.dish,
        compareId: this.compareId, fit: this.fit, seating: this.seating, rotation: this.rotation, inside: this.inside,
        table: this.virtualTable ? 'virtual' : 'passthrough', originName: this.findStop(this.filters.startStopId)?.name,
      }, focus);
    }
  }

  private setFilterOpen(open: boolean) {
    this.filterOpen = open;
    this.renderPanels();
    if (!open) this.mobileButtons.get('Filters')?.focus();
  }

  private updateFilters(patch: Partial<Filters>) {
    const originChanged = patch.startStopId !== undefined && (patch.startStopId !== this.filters.startStopId || this.origin !== undefined);
    if (patch.startStopId !== undefined) this.origin = undefined;
    this.filters = { ...this.filters, ...patch };
    this.applyFilters();
    if (originChanged) void this.refreshTrip();
  }

  private applyFilters() {
    this.filtered = matchingPlaces(this.places, this.filters);
    this.filterBar.render(this.filters, this.filtered.length);
    this.renderStationBoard();
    this.renderDrawer();
    if (!this.engineReady) return;
    this.engine?.setFilters(this.filters);
    this.engine?.setPlaces(this.places, new Set(this.filtered.map((place) => place.id)));
    if (this.fit && this.inside) this.engine?.setWillWeFit(true, this.filters.groupSize, this.seating);
    this.updateTelemetry();
  }

  private locate() {
    if (!navigator.geolocation) { this.notify('GPS is unavailable in this browser. Choose your start stop.'); return; }
    this.notify('Finding the nearest demo stop…');
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      const distance = (stop: Stop) => haversineMeters(coords.latitude, coords.longitude, stop.lat, stop.lon);
      const nearest = [...this.stops].sort((a, b) => distance(a) - distance(b))[0];
      if (!nearest) { this.notify('No stops are available.'); return; }
      this.filters = { ...this.filters, startStopId: nearest.stop_id };
      this.origin = { lat: coords.latitude, lon: coords.longitude };
      this.applyFilters();
      void this.refreshTrip();
      this.notify(`Starting from ${nearest.name}, your nearest demo stop.`);
    }, () => this.notify('Could not read your location. Choose a start stop from the list.'), { timeout: 10_000, maximumAge: 60_000 });
  }

  private navigate(mode: SceneMode) {
    if (mode === 'map') this.showMap();
    if (mode === 'station' && this.stop) this.showStation(this.stop);
    if (mode === 'venue' && this.place) void this.showVenue(this.place);
    if (mode === 'dish' && this.dish) void this.showDish(this.dish, this.compareId);
  }

  private showMap() {
    if (this.mode !== 'map') this.sound.playBack();
    this.mode = 'map';
    this.filterOpen = false;
    this.drawerOpen = false;
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderScene();
  }

  private showStation(stop: Stop) {
    const changed = this.stop?.stop_id !== stop.stop_id || this.mode !== 'station';
    this.stop = stop;
    this.place = undefined;
    this.dish = undefined;
    this.inside = this.fit = false;
    this.mode = 'station';
    this.filterOpen = false;
    this.drawerOpen = true;
    this.sheetExpanded = false;
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderDrawer(changed);
    if (changed) {
      this.sound.playSelect();
      this.sound.playPinsRise();
      this.stationData = { predictions: {}, alerts: {} };
      this.updateStationDrawer();
      void this.refreshStation();
      this.renderScene();
    }
  }

  private updateStationDrawer() {
    if (!this.stop) return;
    const campus = RIDE_TIMES[initialFilters.startStopId]?.[this.stop.stop_id]?.minutes;
    this.drawer.updateStation(this.stop, this.stationData, this.filters.familyVisit ? campus : undefined);
  }

  private updateTelemetry() {
    if (!this.stop || !this.engineReady) return;
    const arrivals = this.stationData.predictions.data?.predictions.flatMap((entry) => entry.arrival_min === null ? [] : [entry.arrival_min]) ?? [];
    const count = this.filtered.filter((place) => place.stop_id === this.stop?.stop_id).length;
    this.engine?.setStationTelemetry(this.stop.stop_id, arrivals.length ? Math.min(...arrivals) : null, count);
  }

  private async refreshStation(reset = true) {
    if (!this.stop || this.mode !== 'station') return;
    const stop = this.stop;
    const id = ++this.stationRequest;
    if (reset) {
      this.stationData = { predictions: {}, alerts: {} };
      this.updateStationDrawer();
    }
    const [predictions, alerts] = await Promise.allSettled([api.predictions(stop.stop_id), api.alerts()]);
    if (id !== this.stationRequest || this.stop?.stop_id !== stop.stop_id || this.mode !== 'station') return;
    this.stationData = {
      predictions: predictions.status === 'fulfilled' ? { data: predictions.value } : { error: 'Train predictions are unavailable. Try refreshing.' },
      alerts: alerts.status === 'fulfilled' ? { data: alerts.value } : { error: 'Unable to check alerts. Check MBTA for current service.' },
    };
    this.updateStationDrawer();
    this.updateTelemetry();
    if (reset && predictions.status === 'fulfilled' && predictions.value.predictions.some((entry) => entry.arrival_min !== null)) this.sound.playTrainChime();
  }

  private openCompanionVenue() {
    if (this.mode !== 'map') {
      this.filterOpen = false;
      this.drawerOpen = true;
      this.sheetExpanded = true;
      this.renderPanels();
    } else {
      const stop = this.findStop(this.filters.startStopId) ?? this.stops[0];
      if (stop) this.showStation(stop);
      else this.notify('No venues are available. Reload the stop list.');
    }
  }

  private async showVenue(place: Place) {
    const changed = this.place?.id !== place.id;
    const cameFromDish = this.mode === 'dish';
    if (changed) {
      this.manifest = {};
      this.trip = {};
      this.inside = true;
      this.fit = false;
      this.seating = 'seated';
    }
    this.place = place;
    this.stop = this.findStop(place.stop_id);
    this.dish = undefined;
    this.compareId = '';
    this.mode = 'venue';
    this.filterOpen = false;
    this.drawerOpen = true;
    this.sheetExpanded = false;
    if (changed || cameFromDish) this.sound.playSelect();
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderDrawer(true);
    this.renderScene();
    void this.refreshTrip();
    if (changed || !this.manifest.data) await this.refreshManifest();
  }

  private async refreshManifest() {
    if (!this.place) return;
    const place = this.place;
    const request = ++this.manifestRequest;
    let manifest: ViewData['manifest'];
    try { manifest = { data: await api.manifest(place.id) }; }
    catch (error) {
      const offline = offlineManifest(place);
      manifest = offline ? { data: offline, offline: true, error: 'Live previews are unavailable.' } : { error: errorText(error) };
    }
    if (request !== this.manifestRequest || this.place?.id !== place.id) return;
    this.manifest = manifest;
    this.renderDrawer();
    if (this.mode === 'venue' || this.mode === 'dish') this.renderScene();
  }

  private async refreshTrip(reset = true) {
    if (!this.place || (this.mode !== 'venue' && this.mode !== 'dish')) return;
    const place = this.place;
    const from = this.filters.startStopId;
    const origin = this.origin;
    const id = ++this.tripRequest;
    if (reset) {
      this.trip = {};
      this.renderDrawer();
    }
    let state: ViewData['trip'];
    try {
      state = { data: await api.trip(from, place, origin) };
    } catch {
      try {
        state = { data: computeTripEstimate({ from_stop_id: from, to_stop_id: place.stop_id, origin, venue: place, walk_from_stop_m: place.walk_from_stop_m }), offline: true };
      } catch { state = { error: 'The route estimate is unavailable. Open the MBTA trip planner.' }; }
    }
    if (id !== this.tripRequest || this.place?.id !== place.id) return;
    this.trip = state;
    this.renderDrawer();
  }

  private async enterRoom() {
    if (!this.place || !this.manifest.data?.room_asset) return;
    if (this.inside) {
      this.engine?.resetCamera();
      return;
    }
    this.inside = true;
    this.sound.playSelect();
    this.renderDrawer();
    this.renderScene();
  }

  private async showDish(dish: Dish, compareId = '') {
    if (!this.place || !this.manifest.data?.menu_items.find((entry) => entry.dish.id === dish.id)?.dish_asset) {
      this.notify('This dish does not have a published 3D preview.');
      return;
    }
    const previous = this.dish?.id;
    this.mode = 'dish';
    this.dish = dish;
    this.compareId = compareId;
    if (previous !== dish.id) this.rotation = 0;
    this.drawerOpen = true;
    this.filterOpen = false;
    this.sound.playSelect();
    this.renderBreadcrumbs();
    this.renderPanels();
    if (previous !== dish.id) this.renderDrawer(true);
    this.renderScene();
  }

  private async setFit(enabled: boolean, seating: Seating) {
    this.fit = enabled;
    this.seating = seating;
    this.renderDrawer();
    if (enabled && !this.inside) await this.enterRoom();
    else this.engine?.setWillWeFit(enabled, this.filters.groupSize, seating);
  }

  private setTable(useVirtual: boolean, announce = true) {
    this.virtualTable = useVirtual;
    this.engine?.setPassthroughFallback(useVirtual);
    if (announce && !useVirtual && this.xrMode !== 'ar') this.notify('Passthrough takes effect in an immersive AR session.');
    this.renderDrawer();
  }

  private renderScene() {
    if (!this.engineReady) return;
    const version = ++this.sceneVersion;
    const { mode, stop, place, dish, compareId, inside } = this;
    const manifest = this.manifest.data;
    this.sceneQueue = this.sceneQueue.then(async () => {
      const engine = this.engine;
      if (!engine || version !== this.sceneVersion) return;
      this.busyScene = true;
      try {
        if (mode === 'station' && stop) await engine.focusStop(stop.stop_id);
        else if (mode === 'venue' && place) {
          const preview = manifest && !inside ? { ...manifest, room_asset: null, rooms: [] } : manifest;
          const previewPlace = inside ? place : { ...place, rooms: [] };
          await engine.openVenue(previewPlace, preview ?? null);
          engine.setWillWeFit(this.fit && inside, this.filters.groupSize, this.seating);
        } else if (mode === 'dish' && place && dish && manifest) {
          const comparison = manifest.menu_items.find(({ dish }) => dish.id === compareId)?.dish;
          await engine.openDish(place, dish, comparison, manifest);
          engine.setDishRotation(this.rotation * Math.PI / 180);
          engine.setPassthroughFallback(this.virtualTable);
        } else await engine.setScene(mode);
      } catch (error) {
        if (version === this.sceneVersion) this.notify('Could not display this 3D view. The details are still available.');
        this.log(errorText(error));
      } finally { this.busyScene = false; }
    });
  }

  private async launchXR(kind: 'vr' | 'ar') {
    const engine = this.engine;
    if (!engine || !this.engineReady) { this.notify('The 3D viewer is still starting.'); return; }
    const supported = (kind === 'vr' ? this.vrButton : this.arButton).dataset.supported === 'true';
    if (!supported && kind === 'vr') {
      engine.resetCamera();
      this.notify('Desktop 3D view reset.');
      return;
    }
    if (!supported) {
      this.setTable(true);
      const active = this.dish ?? this.manifest.data?.menu_items.find(({ dish_asset }) => dish_asset)?.dish;
      if (active) await this.showDish(active);
      else this.notify('Open a venue with a published dish to use the virtual table.');
      return;
    }
    try {
      if (kind === 'ar') {
        this.setTable(false, false);
        const dish = this.dish ?? this.manifest.data?.menu_items.find(({ dish_asset }) => dish_asset)?.dish;
        if (dish && !this.dish) void this.showDish(dish);
        await engine.enterAR();
      }
      else await engine.enterVR();
    } catch (error) {
      if (kind === 'ar') this.setTable(true);
      this.notify('Could not start the XR session. ' + errorText(error));
    }
  }

  private toggleAudio() {
    this.muted = !this.muted;
    this.sound.setMuted(this.muted);
    this.sound.toggleAmbientHum(!this.muted);
    if (!this.muted) void this.sound.unlock().then(() => this.sound.playSelect()).catch((error) => this.log(errorText(error)));
    this.audioButton.textContent = this.muted ? 'Audio off' : 'Audio on';
    this.audioButton.setAttribute('aria-pressed', String(!this.muted));
  }

  private sendCurrent() {
    if (!this.place) return;
    const sent = this.pairing.send(this.dish ? { type: 'open_dish', place_id: this.place.id, dish_id: this.dish.id }
      : { type: 'open_place', place_id: this.place.id });
    if (sent) this.notify('Sent to the paired device.');
  }

  private sendTrip() {
    if (!this.trip.data) { this.notify('Wait for the trip estimate before sending.'); return; }
    if (this.pairing.send({ type: 'send_trip', trip: this.trip.data })) this.notify('Trip sent to the paired device.');
  }

  private async receivePair(message: PairMessage) {
    if (message.type === 'open_place' || message.type === 'open_dish') {
      const place = this.places.find((entry) => entry.id === message.place_id);
      if (!place) { this.notify('The paired venue is missing from this catalog.'); return; }
      await this.showVenue(place);
      if (message.type === 'open_dish') {
        const dish = this.manifest.data?.menu_items.find((entry) => entry.dish.id === message.dish_id)?.dish;
        if (dish) await this.showDish(dish);
      }
      this.notify('Opened a view from your paired device.');
    }
    if (message.type === 'send_trip') this.showReceivedTrip(message.trip);
  }

  private readonly incomingTrip = modal('Trip from paired device');

  private showReceivedTrip(trip: Trip) {
    if (!trip || !Number.isFinite(trip.total_min)) return;
    const stop = this.findStop(trip.to_stop_id);
    const body = this.incomingTrip.body;
    body.replaceChildren(
      element('p', 'readout', `${trip.total_min} min${stop ? ` to ${stop.name}` : ''}`),
      element('p', '', `Walk ${trip.walk_to_station_min + trip.walk_to_venue_min} min · Wait ${trip.wait_min} min · Ride ${trip.ride_min} min · Transfers ${trip.transfer_min} min`),
    );
    try { if (trip.planner_url) body.append(link('Open full directions on MBTA', trip.planner_url)); }
    catch { body.append(message('This trip has no valid directions link.')); }
    this.incomingTrip.open();
  }

  private async handlePublication(job: GenerationJob, open: boolean) {
    await this.loadCatalog();
    const place = this.places.find((entry) => entry.id === job.place_id);
    if (!place) throw new Error('The published venue is missing from the catalog.');
    if (!open) {
      await api.manifest(job.place_id);
      if (this.place?.id === job.place_id) await this.refreshManifest();
      return;
    }
    await this.showVenue(place);
    await this.refreshManifest();
    if (job.kind === 'room' && this.manifest.data?.room_asset?.id === job.asset_id) {
      this.inside = false;
      await this.enterRoom();
    }
    else {
      const match = this.manifest.data?.menu_items.find((entry) => entry.dish_asset?.id === job.asset_id);
      if (match) await this.showDish(match.dish);
      else throw new Error('The published preview is not available yet. Refresh and try again.');
    }
  }

  private openDebug() {
    this.debugLogs.textContent = this.logs.join('\n') || 'No debug logs yet.';
    this.debug.open();
  }

  private log(text: string) {
    this.logs.push(`${new Date().toLocaleTimeString()} ${text.replaceAll('—', '–')}`);
    if (this.logs.length > 80) this.logs.shift();
    if (this.debug.dialog.open) this.debugLogs.textContent = this.logs.join('\n');
  }

  private async sendDebugLogs() {
    try { await api.logs(this.logs); this.log('Debug logs sent.'); }
    catch (error) { this.log('Could not send debug logs. ' + errorText(error)); }
  }

  private notify(text: string) {
    this.notice.textContent = text;
    this.notice.hidden = false;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.notice.hidden = true; }, 6500);
  }
}
