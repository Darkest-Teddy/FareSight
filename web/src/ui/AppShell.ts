import {
  buildMbtaTripPlannerUrl, computeTripEstimate, haversineMeters, ROUTE_COLORS, type Dish,
  type GenerationJob, type MbtaSource, type Place, type RestaurantManifest, type Stop,
} from '@faresight/shared';
import { createFareSightEngine, type FareSightSceneEngine, type SceneMode } from '../xr';
import { SoundEngine } from '../audio/SoundEngine';
import { api, type PairMessage, type Trip } from '../api/client';
import { offlineCatalog, offlineManifest } from '../data/fallbackData';
import { countPreviewsByStop, isSplat } from '../data/preview3D';
import { buildComparisonBriefingCard, loadPlaceDecision, maxBriefingCards, type BriefingCard, type BriefingMode } from '../data/reviewBriefing';
import { LiveController, type AppControlSurface } from '../live/LiveController';
import { RealtimeVoice } from '../voice/RealtimeVoice';
import { AdminModal } from './AdminModal';
import { attribution } from './AttributionModal';
import { CornerMenu } from './CornerMenu';
import { button, element, errorText, httpUrl, icon, link, message, modal, navItem, navTool, setNavItem } from './dom';
import { FilterControls } from './FilterControls';
import { LiveVoiceDock } from './LiveVoiceDock';
import { lineDots } from './lineDots';
import { PairingModal } from './PairingModal';
import type { DishComparison, Load, Seating } from './viewState';
import { filtersNarrowed, initialFilters, matchingPlaces, type Filters } from './state';
import { UploadPipelineModal } from './UploadPipelineModal';

const pollInterval = 18_000;

export class AppShell {
  private readonly canvas = element('canvas', 'viewport');
  private readonly canvasNotice = element('div', 'canvas-notice');
  private readonly status = element('span', 'service-status');
  private readonly statusText = element('span');
  private readonly xrStatus = element('span', 'xr-status', 'Starting 3D');
  private readonly notice = element('div', 'notice');
  private readonly brand = element('h1', 'brand');
  private readonly backNav = element('nav', 'scene-nav');
  private readonly backButton: HTMLButtonElement;
  private readonly backLabel = element('span', 'back-label');
  private readonly stationBoard = element('section', 'station-board');
  private readonly menu: CornerMenu;
  private readonly stationList = element('div', 'station-board-list');
  private readonly routeFeedback = element('div');
  private readonly filterControls: FilterControls;
  private readonly pairing: PairingModal;
  private readonly uploader: UploadPipelineModal;
  private readonly credits: ReturnType<typeof attribution>;
  private readonly liveController: LiveController;
  private readonly liveClient: RealtimeVoice;
  private readonly liveDock: LiveVoiceDock;
  private readonly briefings = new Map<string, BriefingCard>();
  private readonly debug = modal('Debug');
  private readonly renderStats = element('p', 'readout');
  private readonly debugLogs = element('pre', 'log-view');
  private readonly pairButton: HTMLButtonElement;
  private readonly audioButton: HTMLButtonElement;
  private readonly vrButton: HTMLButtonElement;
  private readonly xrExit: HTMLButtonElement;
  private readonly sound = new SoundEngine();
  private readonly logs: string[] = [];
  private readonly mobile = matchMedia('(max-width: 768px)');
  private engine?: FareSightSceneEngine;
  private engineReady = false;
  private sceneVersion = 0;
  private navigation = 0;
  private gpsRequest = 0;
  private stops = offlineCatalog.stops;
  private places = offlineCatalog.places;
  private filtered = this.places;
  private filters: Filters = { ...initialFilters };
  private mode: SceneMode = 'map';
  private stop?: Stop;
  private place?: Place;
  private dish?: Dish;
  private comparison?: DishComparison;
  private comparedPlaces: Place[] = [];
  private comparisonRun = 0;
  private comparisonLoading = false;
  private dishRequest = 0;
  private inside = false;
  private fit = false;
  private seating: Seating = 'seated';
  private rotation = 0;
  private virtualTable = true;
  private muted = true;
  private filterOpen = false;
  private stopsOpen = false;
  private chimeRequest = 0;
  private tripRequest = 0;
  private manifestRequest = 0;
  private manifest: Load<RestaurantManifest> = {};
  private trip: Load<Trip> = {};
  private origin?: { lat: number; lon: number };
  private catalogState: 'loading' | 'live' | 'offline' = 'loading';
  private vehicleSource?: MbtaSource | 'unavailable';
  private noticeTimer?: number;
  private syncingTransit = false;
  private transitFailures = 0;
  private xrMode: 'none' | 'vr' | 'ar' = 'none';
  private highlightedStops: string[] = [];
  private highlightedPlaces: string[] = [];
  private highlightedDishId?: string;

  constructor(private readonly root: HTMLElement) {
    root.classList.add('app-shell');
    // The map is the hero. The chrome keeps to the corners: the brand, or a back button once you are
    // deeper than the map, top-left; one menu bottom-right that opens on demand.
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.classList.add('brand-mark');
    mark.setAttribute('viewBox', '0 0 96 96');
    mark.setAttribute('aria-hidden', 'true');
    mark.setAttribute('fill', 'currentColor');
    mark.innerHTML = `
      <path d="M9 78V50C9 32 18 23 35 16L56 8 82 18 61 27C46 33 38 42 38 57V67Z"/>
      <path d="M48 55C48 45 53 39 63 35L85 26V65L48 87Z"/>
    `;
    this.brand.append(mark, 'Vantage');
    this.backNav.setAttribute('aria-label', 'Scene navigation');
    this.backButton = button('', () => this.stepBack(), 'scene-back');
    this.backButton.append(icon('back'), this.backLabel);
    this.backNav.append(this.backButton);
    // The MBTA state is the last line of the menu. A problem also marks the closed menu button.
    this.statusText.setAttribute('role', 'status');
    this.status.append(element('span', 'status-dot'), this.statusText);
    this.vrButton = navItem('vr', 'Enter VR', () => void this.launchVR());
    // Shown once the viewer reports what this device supports, so the label never flips on screen.
    this.vrButton.hidden = true;
    this.xrExit = navItem('exit', 'Exit XR', () => this.engine?.exitXR(), 'accent');
    this.xrExit.hidden = true;
    this.pairButton = navTool('pair', 'Pair', () => this.pairing.open());
    this.pairButton.title = 'Pair a Quest headset';
    this.audioButton = navTool('mute', 'Sound', () => this.toggleAudio());
    this.audioButton.setAttribute('aria-pressed', 'false');
    // Toggling sound leaves the menu open, so the change can be seen.
    this.audioButton.dataset.stay = 'true';
    const admin = new AdminModal(() => void this.loadCatalog());
    this.credits = attribution(() => admin.open());
    this.liveController = new LiveController(this.createControlSurface());
    this.liveClient = new RealtimeVoice({
      onState: (state, detail) => {
        this.liveDock.setState(state, detail);
        this.engine?.setVoiceState(state);
        this.renderMenuBadge();
      },
      onNotice: (detail) => this.liveDock.setNotice(detail),
      onMicrophone: (hasMic, muted, requesting) => this.liveDock.setMicrophone(hasMic, muted, requesting),
      onAudioBlocked: (blocked) => this.liveDock.setAudioBlocked(blocked),
      onPaused: (paused) => this.liveDock.setPaused(paused),
      onUnsentText: (text) => this.liveDock.restoreDraft(text),
      onTranscript: (entry) => this.liveDock.appendTranscript(entry),
      onModel: (model) => this.liveDock.setModel(model),
      onTool: (name, args, current) => this.liveController.executeRealtime(name, args, current),
      getContext: () => this.liveController.describeContext(),
    });
    this.liveDock = new LiveVoiceDock({
      startVoice: () => void this.liveClient.start(),
      enableAudio: () => this.liveClient.enableAudio(),
      stop: () => this.liveClient.stop(),
      toggleMute: () => this.liveClient.setMuted(!this.liveClient.isMuted),
      sendText: (text) => this.liveClient.sendText(text),
      opened: () => this.settleOverlays('voice'),
      returnFocus: () => this.menu.focusTrigger(),
    });
    this.canvas.setAttribute('aria-label', 'Vantage interactive 3D view');
    this.canvas.tabIndex = 0;
    this.canvasNotice.replaceChildren(message('Loading 3D viewer…'));
    this.canvasNotice.setAttribute('aria-live', 'polite');
    this.notice.hidden = true;
    this.notice.setAttribute('role', 'status');

    this.stationBoard.id = 'stop-list';
    this.stationBoard.setAttribute('aria-label', 'Boston stops');
    this.stationBoard.append(this.stationList, this.routeFeedback);

    this.filterControls = new FilterControls(this.filters, (patch) => this.updateFilters(patch), () => void this.locate());
    this.pairing = new PairingModal((data) => void this.receivePair(data), (paired) => {
      setNavItem(this.pairButton, paired ? 'Paired' : 'Pair');
    });
    this.uploader = new UploadPipelineModal({
      places: () => this.places,
      published: (job, open, current) => this.handlePublication(job, open, current),
    });
    this.menu = new CornerMenu({
      filters: this.filterControls.root,
      stops: this.stationBoard,
      primary: [this.liveDock.trigger, this.vrButton, this.xrExit],
      tools: [
        this.pairButton,
        navTool('upload', 'Upload', () => this.uploader.open(this.place?.id)),
        this.audioButton,
        navTool('info', 'Credits', this.credits.open),
        navTool('bug', 'Debug', () => this.openDebug()),
      ],
      status: this.status,
      setOpen: (open) => this.setFilterOpen(open, false),
      showStops: (open) => (open ? this.setStopsOpen(true, true) : this.setFilterOpen(true, false)),
    });
    this.liveDock.trigger.classList.add('menu-item');

    // The chrome comes first in the document, so Tab reaches Back and the menu before the map's labels.
    root.replaceChildren(this.brand, this.backNav, this.menu.root, this.liveDock.root, this.canvas, this.canvasNotice, this.notice);
    this.debug.body.append(this.renderStats, this.xrStatus, this.debugLogs,
      button('Reset camera', () => this.engine?.resetCamera()),
      button('Send debug logs', () => void this.sendDebugLogs(), 'quiet'));
    this.mobile.addEventListener('change', () => this.renderPanels());
    this.sound.setMuted(true);
    this.sound.onStateChange = () => this.renderAudioState();
    this.filterControls.setStops(this.stops);
    this.renderBack();
    this.applyFilters();
    this.renderStatus();
    this.renderPanels();
  }

  async start() {
    void this.loadCatalog();
    void this.refreshTransit();
    // Trains are polled on their own, faster timer: MBTA refreshes positions every few seconds,
    // and the map glides each train from one fix to the next, so fresher fixes mean truer motion.
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void this.refreshTransit();
    }, 6_000);
    window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (this.place) void this.refreshTrip(false);
    }, pollInterval);
    window.addEventListener('online', () => {
      void this.loadCatalog();
      void this.refreshTransit();
      if ((this.mode === 'venue' || this.mode === 'dish') && this.manifest.offline) void this.refreshManifest();
    });
    window.addEventListener('resize', () => this.engine?.resize());
    // Escape steps back one level. It only acts while the 3D view or the back button has the keyboard,
    // so a menu, panel, field or dialog that closes on Escape keeps the key to itself.
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || this.mode === 'map' || document.querySelector('dialog[open]')) return;
      const focus = document.activeElement;
      if (focus && focus !== document.body && focus !== this.canvas && focus !== this.backButton) return;
      this.stepBack();
    });
    window.addEventListener('pagehide', (event) => {
      this.liveClient.destroy();
      if (!event.persisted) {
        this.sound.destroy();
        this.engine?.destroy();
      }
    });
    try {
      this.engine = createFareSightEngine(this.canvas, {
        onSelectStop: (id) => { const stop = this.findStop(id); if (stop) this.showStation(stop); },
        onHoverStop: (id) => {
          for (const row of this.stationList.querySelectorAll<HTMLElement>('.station-row')) {
            row.dataset.hover = String(row.dataset.stop === id);
          }
        },
        onSelectPlace: (id) => { const place = this.places.find((entry) => entry.id === id); if (place) void this.showVenue(place); },
        onSelectDish: (id) => { const dish = this.manifest.data?.menu_items.find((entry) => entry.dish.id === id)?.dish; if (dish) void this.showDish(dish); },
        onCompareDish: (id, placeId) => {
          if (this.mode === 'dish' && this.dish) void this.showDish(this.dish, this.comparison?.dish.id === id ? '' : id, placeId);
        },
        onNavigateScene: (mode) => { if (mode !== this.mode) this.navigate(mode); },
        onToggleVoice: () => this.liveClient.toggle(),
        onDismissReviewCard: (cardId) => this.dismissReviewCard(cardId),
        onXrStateChange: (state) => {
          const changed = this.xrMode !== state.activeMode;
          this.xrMode = state.activeMode;
          this.root.dataset.xr = this.xrMode;
          this.vrButton.hidden = this.xrMode !== 'none';
          this.xrExit.hidden = this.xrMode === 'none';
          setNavItem(this.vrButton, state.vrSupported ? 'Enter VR' : 'Reset view', state.vrSupported ? 'vr' : 'reset');
          this.vrButton.classList.toggle('accent', state.vrSupported);
          this.vrButton.dataset.supported = String(state.vrSupported);
          this.xrStatus.textContent = state.activeMode === 'ar' ? 'AR table active'
            : state.activeMode === 'vr' ? 'VR active'
              : /Quest|OculusBrowser/i.test(navigator.userAgent) ? 'Quest browser'
                : state.vrSupported || state.arSupported ? 'WebXR available' : 'Desktop 3D';
          if (changed) this.renderReviewCards();
        },
        onStatsUpdate: (stats) => {
          this.renderStats.textContent = `${Math.round(stats.fps)} FPS · ${stats.loadedSplats} splats loaded · ${stats.activeAssetLabel}`;
        },
        onDebugLog: (text, level) => this.log(`${level ?? 'info'}: ${text}`),
      });
      await this.engine.init();
      this.engineReady = true;
      this.engine.setVoiceState(this.liveClient.state);
      this.canvasNotice.hidden = true;
      this.engine.setStops(this.stops);
      if (this.highlightedStops.length) this.engine.setHighlightedStops(this.highlightedStops, false);
      if (this.highlightedPlaces.length) this.engine.setHighlightedPlaces(this.highlightedPlaces);
      if (this.highlightedDishId) this.engine.setHighlightedDish(this.highlightedDishId);
      this.applyFilters();
      this.renderScene();
      void this.refreshTransit();
    } catch (error) {
      this.engine?.destroy();
      this.engine = undefined;
      // Stations, venues and dishes are 3D scenes, so without the viewer only the stop list remains.
      this.canvasNotice.replaceChildren(message('3D viewer unavailable on this device, so stations and menus cannot open.', true));
      this.log(errorText(error));
      this.vrButton.hidden = true;
      this.xrStatus.textContent = '3D viewer unavailable';
      this.root.dataset.viewer = 'failed';
      // The stop list still shows how many places match at each stop.
      this.setStopsOpen(true);
    }
  }

  private findStop(id: string) { return this.stops.find((stop) => stop.stop_id === id); }

  private renderStatus() {
    const text = this.catalogState === 'offline' ? 'Offline catalog'
      : this.vehicleSource === 'live' ? 'Live MBTA'
        : this.vehicleSource === 'simulated' ? 'Simulated trains'
          : this.vehicleSource === 'unavailable' ? 'Trains unavailable' : 'Checking MBTA';
    const source = this.catalogState === 'offline' ? 'offline' : this.vehicleSource ?? 'pending';
    if (this.statusText.textContent !== text) this.statusText.textContent = text;
    this.status.dataset.source = source;
    // A problem turns the dot red and ringed, and marks the closed menu button too.
    this.status.dataset.alert = String(source === 'offline' || source === 'unavailable');
    this.renderMenuBadge();
  }

  /** Red for an MBTA problem; sunflower while a voice session runs or the budget is narrowed. */
  private renderMenuBadge() {
    const voice = this.liveClient.state;
    const active = filtersNarrowed(this.filters) || voice === 'listening' || voice === 'thinking' || voice === 'speaking' || voice === 'connecting';
    this.menu.setBadge(this.status.dataset.alert === 'true' ? 'alert' : active ? 'active' : 'none');
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
      this.routeFeedback.replaceChildren(button('Retry connection', () => void this.loadCatalog(), 'quiet'));
    }
    if (!this.stops.length) this.routeFeedback.replaceChildren(message('The catalog has no stops.'), button('Reload stops', () => void this.loadCatalog(), 'quiet'));
    this.renderStatus();
    this.filterControls.setStops(this.stops);
    if (this.engineReady) this.engine?.setStops(this.stops);
    this.applyFilters();
    this.renderBack();
  }

  private async refreshTransit() {
    if (this.syncingTransit) return;
    this.syncingTransit = true;
    try {
      const { vehicles, source } = await api.vehicles();
      this.vehicleSource = source;
      this.transitFailures = 0;
      if (this.engineReady) this.engine?.setLiveVehicles(vehicles.map((vehicle) => ({
        id: vehicle.id, route_id: vehicle.route_id, lat: vehicle.lat, lon: vehicle.lon, bearing: vehicle.bearing ?? undefined,
        line_color: ROUTE_COLORS[vehicle.route_id] ?? '#A8B3CF', label: vehicle.route_id,
      })));
    } catch {
      // One dropped request leaves the trains where they are; only a run of failures clears them.
      if (++this.transitFailures < 3) return;
      this.vehicleSource = 'unavailable';
      if (this.engineReady) this.engine?.setLiveVehicles([]);
    } finally {
      this.syncingTransit = false;
      this.renderStatus();
    }
  }

  /** The back button names where one step back goes: the map, the station, the restaurant. */
  private renderBack() {
    const target = this.mode === 'dish' ? this.place?.name ?? 'Restaurant'
      : this.mode === 'venue' ? this.stop?.name ?? 'Station'
        : this.mode === 'station' ? 'Map' : undefined;
    const held = document.activeElement === this.backButton;
    this.backNav.hidden = !target;
    this.brand.hidden = !!target;
    if (target) {
      this.backLabel.textContent = target;
      this.backButton.setAttribute('aria-label', `Back to ${target}`);
      this.backButton.title = `Back to ${target} (Esc)`;
    } else if (held) {
      // Back on the map the button is gone, so the keyboard lands on the map itself.
      this.canvas.focus({ preventScroll: true });
    }
  }

  private renderStationBoard(matched: ReadonlySet<string>) {
    const counts = countPreviewsByStop(this.places, matched);
    const key = JSON.stringify([this.highlightedStops, ...this.stops.map((stop) => [stop.stop_id, counts.get(stop.stop_id)])]);
    if (this.stationList.dataset.summary === key) return;
    this.stationList.dataset.summary = key;
    this.stationList.replaceChildren();
    const highlighted = new Set(this.highlightedStops);
    for (const stop of this.stops) {
      const previews = counts.get(stop.stop_id);
      const count = previews?.matching ?? 0;
      // Picking a stop takes you into its scene, which closes the menu. Without the 3D viewer
      // there is no scene to open, so the list stays up.
      const row = button('', () => {
        this.showStation(stop);
        if (!this.engineReady) this.setStopsOpen(true);
      }, 'station-row');
      row.dataset.stay = 'true';
      const name = element('strong');
      name.append(element('span', 'station-name', stop.name));
      row.append(lineDots(stop), name, element('span', 'station-count', String(count)));
      row.setAttribute('aria-label', `${stop.name}, ${count} matching ${count === 1 ? 'place' : 'places'}`);
      row.dataset.stop = stop.stop_id;
      row.dataset.highlighted = String(highlighted.has(stop.stop_id));
      // Mirror list focus on the 3D map so the two read as one control.
      for (const type of ['pointerenter', 'focus']) row.addEventListener(type, () => this.engine?.setHoveredStop(stop.stop_id));
      for (const type of ['pointerleave', 'blur']) row.addEventListener(type, () => this.engine?.setHoveredStop(undefined));
      this.stationList.append(row);
    }
  }

  /** The menu is open while it shows the filters (its main level) or the stop list. */
  private renderPanels() {
    this.root.dataset.scene = this.mode;
    this.menu.render(this.filterOpen || this.stopsOpen, this.stopsOpen);
  }

  /** Opens or closes the menu on its main level, where the filters are. */
  private setFilterOpen(open: boolean, focus = true) {
    const opening = open && !this.menu.isOpen;
    this.filterOpen = open;
    this.stopsOpen = false;
    this.renderPanels();
    if (opening) this.settleOverlays('menu');
    if (open && focus) this.filterControls.focusFirst();
  }

  /** The stop list is the menu's second level, so showing it opens the menu too. */
  private setStopsOpen(open: boolean, focus = false) {
    this.stopsOpen = open;
    this.filterOpen = false;
    this.renderPanels();
    if (open) this.settleOverlays('menu');
    if (open && focus) this.stationList.querySelector<HTMLElement>('.station-row')?.focus({ preventScroll: true });
  }

  /** A phone has room for one opened thing in the bottom corner: the menu or the voice transcript. */
  private settleOverlays(opened: 'menu' | 'voice') {
    if (!this.mobile.matches) return;
    if (opened === 'menu') this.liveDock.setOpen(false);
    else if (this.filterOpen || this.stopsOpen) {
      this.filterOpen = this.stopsOpen = false;
      this.renderPanels();
    }
  }

  private updateFilters(patch: Partial<Filters>) {
    const originChanged = patch.startStopId !== undefined && (patch.startStopId !== this.filters.startStopId || this.origin !== undefined);
    if (patch.startStopId !== undefined) {
      ++this.gpsRequest;
      this.origin = undefined;
    }
    this.filters = { ...this.filters, ...patch };
    this.applyFilters();
    if (originChanged) void this.refreshTrip();
  }

  private applyFilters() {
    this.filtered = matchingPlaces(this.places, this.filters);
    const matched = new Set(this.filtered.map((place) => place.id));
    this.filterControls.render(this.filters, this.filtered.length);
    this.renderMenuBadge();
    this.renderStationBoard(matched);
    if (!this.engineReady) return;
    this.engine?.setFilters(this.filters);
    this.engine?.setPlaces(this.places, matched);
    if (this.fit && this.inside) this.engine?.setWillWeFit(true, this.filters.groupSize, this.seating);
  }

  private async locate(current = () => true): Promise<{ ok: boolean; stop?: Stop; message: string }> {
    const fail = (message: string) => {
      if (current()) this.notify(message);
      return { ok: false, message };
    };
    if (!current()) return { ok: false, message: 'Location request cancelled.' };
    if (!navigator.geolocation) return fail('GPS is unavailable in this browser. Choose your start stop.');
    const request = ++this.gpsRequest;
    this.notify('Finding the nearest demo stop…');
    const position = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10_000, maximumAge: 60_000 }),
    ).catch(() => undefined);
    if (request !== this.gpsRequest || !current()) return { ok: false, message: 'Location request cancelled.' };
    if (!position) return fail('Could not read your location. Choose a start stop from the list.');
    const { latitude, longitude } = position.coords;
    const distance = (stop: Stop) => haversineMeters(latitude, longitude, stop.lat, stop.lon);
    const nearest = [...this.stops].sort((a, b) => distance(a) - distance(b))[0];
    if (!nearest) return fail('No stops are available.');
    this.filters = { ...this.filters, startStopId: nearest.stop_id };
    this.origin = { lat: latitude, lon: longitude };
    this.applyFilters();
    void this.refreshTrip();
    const message = `Starting from ${nearest.name}, your nearest demo stop.`;
    this.notify(message);
    return { ok: true, stop: nearest, message };
  }

  private navigate(mode: SceneMode) {
    if (mode === 'map') this.showMap();
    if (mode === 'station') {
      // The map keeps no selection, so a headset's Station button on the map opens the start stop.
      const stop = this.stop ?? this.findStop(this.filters.startStopId) ?? this.stops[0];
      if (stop) this.showStation(stop);
    }
    if (mode === 'venue' && this.place) void this.showVenue(this.place);
    if (mode === 'dish' && this.dish) void this.showDish(this.dish, this.comparison?.dish.id, this.comparison?.place.id);
  }

  /** One step back towards the map: dish, venue, station, map. */
  private stepBack() {
    if (this.mode === 'dish') this.navigate('venue');
    else if (this.mode === 'venue') this.navigate('station');
    else if (this.mode === 'station') this.showMap();
  }

  /**
   * The map is a clean slate. Every way home ends here (the back button, Escape, a headset's
   * own buttons, the voice assistant), so this is where the selection is dropped: no stop, venue
   * or dish stays chosen, and no panel stays open.
   */
  private showMap() {
    ++this.navigation;
    if (this.mode !== 'map') this.sound.playBack();
    this.mode = 'map';
    this.stop = undefined;
    this.place = undefined;
    this.dish = undefined;
    this.comparison = undefined;
    this.highlightedDishId = undefined;
    this.manifest = {};
    this.trip = {};
    this.inside = this.fit = false;
    ++this.dishRequest;
    ++this.tripRequest;
    ++this.manifestRequest;
    ++this.chimeRequest;
    this.filterOpen = false;
    // Without the 3D map the stop list is the only way in, so it is the one thing left open.
    this.stopsOpen = this.root.dataset.viewer === 'failed';
    this.renderBack();
    this.renderPanels();
    this.renderScene();
  }

  private showStation(stop: Stop) {
    ++this.navigation;
    const changed = this.stop?.stop_id !== stop.stop_id || this.mode !== 'station';
    // Places are picked from the pins in the 3D neighbourhood; nothing slides in over it.
    this.stop = stop;
    this.place = undefined;
    this.dish = undefined;
    this.comparison = undefined;
    this.highlightedDishId = undefined;
    this.inside = this.fit = false;
    this.mode = 'station';
    this.filterOpen = false;
    this.stopsOpen = false;
    this.renderBack();
    this.renderPanels();
    if (changed) {
      this.sound.playSelect();
      this.sound.playPinsRise();
      void this.chimeForArrivals(stop);
      this.renderScene();
    }
  }

  /** Arriving at a station with a timed train on its way rings the train chime. */
  private async chimeForArrivals(stop: Stop) {
    const request = ++this.chimeRequest;
    if (this.muted) return;
    const arrivals = await api.predictions(stop.stop_id).catch(() => undefined);
    if (request !== this.chimeRequest || this.mode !== 'station' || this.stop?.stop_id !== stop.stop_id) return;
    if (arrivals?.predictions.some((entry) => entry.arrival_min !== null)) this.sound.playTrainChime();
  }

  private async showVenue(place: Place, options?: { inside?: boolean; current?: () => boolean }) {
    const current = options?.current ?? (() => true);
    if (!current()) return;
    const changed = this.place?.id !== place.id;
    let prepared: Load<RestaurantManifest> | undefined;
    if (options?.current && (changed || !this.manifest.data)) {
      const requestedFrom = this.navigation;
      prepared = await this.loadManifest(place);
      if (!current() || requestedFrom !== this.navigation) return;
    }
    ++this.navigation;
    const cameFromDish = this.mode === 'dish';
    if (changed) {
      this.manifest = {};
      this.trip = {};
      this.inside = options?.inside ?? true;
      this.fit = false;
      this.seating = 'seated';
      this.highlightedDishId = undefined;
    } else if (options?.inside !== undefined) {
      this.inside = options.inside;
    }
    if (prepared) this.manifest = prepared;
    this.place = place;
    this.stop = this.findStop(place.stop_id);
    this.dish = undefined;
    this.comparison = undefined;
    this.dishRequest++;
    this.mode = 'venue';
    this.filterOpen = false;
    this.stopsOpen = false;
    if (changed || cameFromDish) this.sound.playSelect();
    this.renderBack();
    this.renderPanels();
    this.renderScene();
    void this.refreshTrip();
    const navigation = this.navigation;
    if (!prepared && (changed || !this.manifest.data)) await this.refreshManifest();
    if (current() && this.isCurrentVenue(navigation, place.id)) void this.refreshMenuPrices(place);
  }

  /**
   * Fills any dish the catalog has no price for from the price agent, so the menu book and the
   * dish caption show a figure instead of "Not listed". Catalog prices always win.
   */
  private async refreshMenuPrices(place: Place) {
    if (!place.dishes.some((dish) => dish.price == null)) return;
    const navigation = this.navigation;
    const result = await api.liveMenuPrices(place.id).catch(() => undefined);
    if (!result?.prices.length || !this.isCurrentVenue(navigation, place.id)) return;
    this.applyLiveMenuPrices(place.id, result.prices);
  }

  private applyLiveMenuPrices(placeId: string, updates: { dish_id: string; price: number }[]) {
    const prices = new Map(updates.map(({ dish_id, price }) => [dish_id, price]));
    const apply = (dish: Dish) => {
      const price = prices.get(dish.id);
      if (price !== undefined && dish.price == null) dish.price = price;
    };
    this.places.find(({ id }) => id === placeId)?.dishes.forEach(apply);
    if (this.comparison?.place.id === placeId) {
      apply(this.comparison.dish);
      this.comparison = { ...this.comparison };
    }
    if (this.place?.id === placeId) {
      this.place.dishes.forEach(apply);
      const manifest = this.manifest.data;
      if (manifest) {
        manifest.menu_items.forEach(({ dish }) => apply(dish));
        this.manifest = { ...this.manifest, data: { ...manifest } };
      }
      if (this.dish) apply(this.dish);
    } else if (this.comparison?.place.id !== placeId) return;
    if (this.mode === 'venue' || this.mode === 'dish') this.renderScene();
  }

  private async refreshManifest() {
    if (!this.place) return;
    const place = this.place;
    const navigation = this.navigation;
    const request = ++this.manifestRequest;
    const manifest = await this.loadManifest(place);
    if (request !== this.manifestRequest || !this.isCurrentVenue(navigation, place.id)) return;
    this.manifest = manifest;
    if (this.mode === 'venue' || this.mode === 'dish') this.renderScene();
  }

  private async loadManifest(place: Place): Promise<Load<RestaurantManifest>> {
    try {
      const data = await api.manifest(place.id);
      for (const { dish } of data.menu_items) {
        dish.price ??= place.dishes.find(({ id }) => id === dish.id)?.price ?? null;
      }
      return { data };
    }
    catch (error) {
      const offline = offlineManifest(place);
      return offline ? { data: offline, offline: true, error: 'Live previews are unavailable.' } : { error: errorText(error) };
    }
  }

  private async refreshTrip(reset = true) {
    if (!this.place || (this.mode !== 'venue' && this.mode !== 'dish')) return;
    const place = this.place;
    const from = this.filters.startStopId;
    const origin = this.origin;
    const id = ++this.tripRequest;
    if (reset) this.trip = {};
    let state: Load<Trip>;
    try {
      state = { data: await api.trip(from, place, origin) };
    } catch {
      try {
        state = { data: computeTripEstimate({ from_stop_id: from, to_stop_id: place.stop_id, origin, venue: place, walk_from_stop_m: place.walk_from_stop_m }), offline: true };
      } catch { state = { error: 'The route estimate is unavailable. Open the MBTA trip planner.' }; }
    }
    if (id !== this.tripRequest || this.place?.id !== place.id) return;
    this.trip = state;
  }

  private async enterRoom() {
    if (!this.place || !this.manifest.data?.room_asset) return;
    if (this.inside) {
      this.engine?.resetCamera();
      return;
    }
    ++this.navigation;
    this.inside = true;
    this.sound.playSelect();
    this.renderScene();
  }

  private async showDish(dish: Dish, compareId = '', comparePlaceId?: string, current = () => true): Promise<boolean> {
    if (!current()) return false;
    const request = ++this.dishRequest;
    const place = this.place;
    const mode = this.mode;
    if (!place || !isSplat(this.manifest.data?.menu_items.find((entry) => entry.dish.id === dish.id)?.dish_asset)) {
      this.notify('This dish does not have a published 3D preview.');
      return false;
    }
    const navigation = ++this.navigation;
    let comparison: DishComparison | undefined;
    if (compareId && compareId !== dish.id) {
      const inCurrentMenu = this.manifest.data?.menu_items.some((entry) => entry.dish.id === compareId);
      const venue = comparePlaceId
        ? this.places.find((entry) => entry.id === comparePlaceId)
        : inCurrentMenu ? place : this.places.find((entry) => entry.dishes.some((item) => item.id === compareId));
      const manifest = !venue ? undefined : venue.id === place.id ? this.manifest : await this.loadManifest(venue);
      if (!current() || request !== this.dishRequest || !this.isCurrentVenue(navigation, place.id) || this.mode !== mode) return false;
      const item = manifest?.data?.menu_items.find((entry) => entry.dish.id === compareId);
      if (!venue || !item || !isSplat(item.dish_asset)) {
        this.notify('The comparison dish does not have a published 3D preview.');
        return false;
      }
      comparison = { place: venue, dish: item.dish, asset: item.dish_asset, offline: manifest?.offline };
    }
    const previous = this.dish?.id;
    this.mode = 'dish';
    this.dish = dish;
    this.comparison = comparison;
    if (previous !== dish.id) this.rotation = 0;
    this.filterOpen = false;
    this.stopsOpen = false;
    this.sound.playSelect();
    this.renderBack();
    this.renderPanels();
    this.renderScene();
    return true;
  }

  private async setFit(enabled: boolean, seating: Seating) {
    this.fit = enabled;
    this.seating = seating;
    if (enabled && !this.inside) await this.enterRoom();
    else this.engine?.setWillWeFit(enabled, this.filters.groupSize, seating);
  }

  /** The venues the voice assistant is comparing. There is no tray on screen; the result is a briefing. */
  private setComparedPlaces(places: Place[]): void {
    this.comparisonRun++;
    this.comparisonLoading = false;
    this.comparedPlaces = places;
  }

  private async openRestaurantComparison(current = () => true): Promise<boolean> {
    if (!current() || this.comparedPlaces.length < 2 || this.comparisonLoading) return false;
    const pairs = this.comparedPlaces.flatMap((place) => {
      const stop = this.findStop(place.stop_id);
      return stop ? [{ place, stop }] : [];
    });
    if (pairs.length !== this.comparedPlaces.length) return false;
    const filters = this.filters;
    const navigation = this.navigation;
    const request = ++this.comparisonRun;
    this.comparisonLoading = true;
    try {
      const decisions = await Promise.all(pairs.map(({ place, stop }) => loadPlaceDecision(place, stop, filters)));
      if (!current() || request !== this.comparisonRun || navigation !== this.navigation) return false;
      const controls = this.createControlSurface();
      controls.setHighlightedStops([...new Set(pairs.map(({ stop }) => stop.stop_id))]);
      controls.setHighlightedPlaces(pairs.map(({ place }) => place.id));
      this.showReviewCard(buildComparisonBriefingCard(decisions, this.findStop(filters.startStopId)?.name ?? 'your start stop'));
      return true;
    } catch (error) {
      if (current() && request === this.comparisonRun && navigation === this.navigation) this.notify(errorText(error));
      return false;
    } finally {
      if (request === this.comparisonRun) this.comparisonLoading = false;
    }
  }

  private showReviewCard(card: BriefingCard, mode: BriefingMode = 'add'): void {
    if (mode === 'replace') this.briefings.clear();
    if (!this.briefings.has(card.id) && this.briefings.size === maxBriefingCards) {
      const oldest = this.briefings.keys().next();
      if (!oldest.done) this.briefings.delete(oldest.value);
    }
    this.briefings.set(card.id, card);
    this.renderReviewCards();
  }

  /** Briefings are clipboards around the viewer in a headset. A flat screen keeps them for VR but shows none. */
  private renderReviewCards(): void {
    this.engine?.setReviewCards([...this.briefings.values()]);
  }

  private dismissReviewCard(cardId?: string): void {
    if (cardId === undefined) this.briefings.clear();
    else this.briefings.delete(cardId);
    this.renderReviewCards();
  }

  private isCurrentVenue(navigation: number, placeId: string): boolean {
    return this.navigation === navigation && this.place?.id === placeId && (this.mode === 'venue' || this.mode === 'dish');
  }

  private setTable(useVirtual: boolean, announce = true) {
    this.virtualTable = useVirtual;
    this.engine?.setPassthroughFallback(useVirtual);
    if (announce && !useVirtual && this.xrMode !== 'ar') this.notify('Passthrough takes effect in an immersive AR session.');
  }

  private renderScene() {
    if (!this.engineReady) return;
    const version = ++this.sceneVersion;
    const { mode, stop, place, dish, comparison, inside } = this;
    const manifest = this.manifest.data;
    void (async () => {
      const engine = this.engine;
      if (!engine || version !== this.sceneVersion) return;
      try {
        if (mode === 'station' && stop) await engine.focusStop(stop.stop_id);
        else if (mode === 'venue' && place) {
          const preview = manifest && !inside ? { ...manifest, room_asset: null, rooms: [] } : manifest;
          const previewPlace = inside ? place : { ...place, rooms: [] };
          const opened = engine.openVenue(previewPlace, preview ?? null);
          engine.setWillWeFit(this.fit && inside, this.filters.groupSize, this.seating);
          await opened;
        } else if (mode === 'dish' && place && dish && manifest) {
          const otherDish = comparison ? { ...comparison.dish, asset: comparison.asset } : null;
          const opened = engine.openDish(place, dish, otherDish, manifest, comparison?.place.name);
          engine.setDishRotation(this.rotation * Math.PI / 180);
          engine.setPassthroughFallback(this.virtualTable);
          await opened;
        } else await engine.setScene(mode);
      } catch (error) {
        if (version === this.sceneVersion) this.notify('Could not display this 3D view.');
        this.log(errorText(error));
      }
    })();
  }

  private async launchVR(current = () => true): Promise<boolean> {
    const engine = this.engine;
    if (!engine || !this.engineReady) { this.notify('The 3D viewer is still starting.'); return false; }
    if (this.vrButton.dataset.supported !== 'true') {
      engine.resetCamera();
      return false;
    }
    try {
      await engine.enterVR();
      return true;
    } catch (error) {
      if (current()) this.notify('Could not start the XR session. ' + errorText(error));
      return false;
    }
  }

  private toggleAudio() {
    this.setAudio(this.muted || !this.sound.running);
  }

  private setAudio(enabled: boolean) {
    this.muted = !enabled;
    this.sound.setMuted(this.muted);
    this.sound.toggleAmbientHum(!this.muted);
    if (!this.muted) void this.sound.unlock().then(() => this.sound.playSelect()).catch((error) => this.log(errorText(error)));
    this.renderAudioState();
  }

  private renderAudioState(): void {
    // The entry keeps its label. Its icon and pressed state say whether sound is actually playing.
    const playing = !this.muted && this.sound.running;
    this.audioButton.setAttribute('aria-pressed', String(playing));
    setNavItem(this.audioButton, 'Sound', playing ? 'sound' : 'mute');
  }

  private setDishRotation(degrees: number): void {
    this.rotation = degrees;
    this.engine?.setDishRotation(degrees * Math.PI / 180);
  }

  private async receivePair(message: PairMessage) {
    if (message.type === 'open_place' || message.type === 'open_dish') {
      const place = this.places.find((entry) => entry.id === message.place_id);
      if (!place) { this.notify('The paired venue is missing from this catalog.'); return; }
      const opening = this.showVenue(place);
      const navigation = this.navigation;
      await opening;
      if (!this.isCurrentVenue(navigation, place.id)) return;
      if (message.type === 'open_dish') {
        const dish = this.manifest.data?.menu_items.find((entry) => entry.dish.id === message.dish_id)?.dish;
        if (dish) {
          const openingDish = this.showDish(dish);
          const dishNavigation = this.navigation;
          if (!await openingDish || !this.isCurrentVenue(dishNavigation, place.id)) return;
        }
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
    const supplied = typeof trip.planner_url === 'string' ? httpUrl(trip.planner_url) : undefined;
    const from = this.findStop(trip.from_stop_id);
    const planner = supplied?.origin === 'https://www.mbta.com' && supplied.pathname === '/trip-planner' &&
      !supplied.username && !supplied.password ? supplied.href : from && stop ? buildMbtaTripPlannerUrl(from, stop) : undefined;
    if (planner) body.append(link('Open full directions on MBTA', planner));
    this.incomingTrip.open();
  }

  private async handlePublication(job: GenerationJob, open: boolean, current: () => boolean) {
    const requestedFrom = this.navigation;
    await this.loadCatalog();
    if (!current() || requestedFrom !== this.navigation) return;
    const place = this.places.find((entry) => entry.id === job.place_id);
    if (!place) throw new Error('The published venue is missing from the catalog.');
    if (!open) {
      await api.manifest(job.place_id);
      if (current() && this.isCurrentVenue(requestedFrom, place.id)) await this.refreshManifest();
      return;
    }
    const opening = this.showVenue(place);
    const navigation = this.navigation;
    await opening;
    if (!current() || !this.isCurrentVenue(navigation, place.id)) return;
    await this.refreshManifest();
    if (!current() || !this.isCurrentVenue(navigation, place.id)) return;
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

  private createControlSurface(): AppControlSurface {
    return {
      getState: () => ({
        mode: this.mode,
        stops: this.stops,
        places: this.places,
        filtered: this.filtered,
        filters: this.filters,
        stop: this.stop,
        place: this.place,
        dish: this.dish,
        compareId: this.comparison?.dish.id ?? '',
        comparePlaceId: this.comparison?.place.id,
        inside: this.inside,
        fit: this.fit,
        // The drawer is gone; the assistant's view of it stays closed.
        drawerOpen: false,
        sheetExpanded: false,
        seating: this.seating,
        rotation: this.rotation,
        virtualTable: this.virtualTable,
        muted: this.muted || !this.sound.running,
        filterOpen: this.filterOpen,
        xrMode: this.xrMode,
        manifest: this.manifest.data,
        trip: this.trip.data,
        origin: this.origin,
        comparedPlaces: [...this.comparedPlaces],
        highlightedStops: [...this.highlightedStops],
        highlightedPlaces: [...this.highlightedPlaces],
        highlightedDishId: this.highlightedDishId,
        briefings: [...this.briefings.values()].map(({ id, title }) => ({ id, title })),
      }),
      showMap: () => this.showMap(),
      showStation: (stop) => this.showStation(stop),
      showVenue: (place, options) => this.showVenue(place, options),
      showDish: (dish, compareId, comparePlaceId, current) => this.showDish(dish, compareId, comparePlaceId, current),
      setComparedPlaces: (places) => this.setComparedPlaces(places),
      openRestaurantComparison: (current) => this.openRestaurantComparison(current),
      locateNearestStop: (current) => this.locate(current),
      applyLiveMenuPrices: (placeId, prices) => this.applyLiveMenuPrices(placeId, prices),
      updateFilters: (patch) => this.updateFilters(patch),
      setHighlightedStops: (stopIds, pulse = true) => {
        this.highlightedStops = [...stopIds];
        this.renderStationBoard(new Set(this.filtered.map((p) => p.id)));
        this.engine?.setHighlightedStops(this.highlightedStops, pulse);
      },
      setHighlightedPlaces: (placeIds) => {
        this.highlightedPlaces = [...placeIds];
        this.engine?.setHighlightedPlaces(this.highlightedPlaces);
      },
      setHighlightedDish: (dishId) => {
        this.highlightedDishId = dishId;
        this.engine?.setHighlightedDish(dishId);
      },
      clearHighlights: () => {
        this.highlightedStops = [];
        this.highlightedPlaces = [];
        this.highlightedDishId = undefined;
        this.engine?.setHighlightedStops([], false);
        this.engine?.setHighlightedPlaces([]);
        this.engine?.setHighlightedDish(undefined);
        this.renderStationBoard(new Set(this.filtered.map((p) => p.id)));
      },
      // Dishes are picked from the menu book in the scene; there is no menu panel to focus or drawer to move.
      focusMenu: () => {},
      setDrawerState: () => {},
      setFit: (enabled, seating) => this.setFit(enabled, seating),
      showReviewCard: (card, mode) => this.showReviewCard(card, mode),
      dismissReviewCard: (cardId) => this.dismissReviewCard(cardId),
      setDishRotation: (degrees) => this.setDishRotation(degrees),
      setTableMode: (useVirtual) => this.setTable(useVirtual),
      orbitCamera: (yawDeltaDeg, pitchDeltaDeg, zoomFactor) => {
        this.engine?.orbitCamera(yawDeltaDeg * Math.PI / 180, pitchDeltaDeg * Math.PI / 180, zoomFactor);
      },
      focusMapStopCamera: (stopId) => this.engine?.focusMapStopCamera(stopId),
      resetCamera: () => this.engine?.resetCamera(),
      setFilterOpen: (open) => this.setFilterOpen(open),
      setAudioSfx: (enabled) => {
        this.setAudio(enabled);
      },
      openModal: (name) => {
        this.uploader.close();
        this.pairing.close();
        if (this.debug.dialog.open) this.debug.dialog.close();
        if (this.credits.dialog.open) this.credits.dialog.close();
        if (this.incomingTrip.dialog.open) this.incomingTrip.dialog.close();
        if (name === 'upload') this.uploader.open(this.place?.id);
        else if (name === 'pair') this.pairing.open();
        else if (name === 'credits') this.credits.open();
        else if (name === 'debug') this.openDebug();
      },
      sendToPairedDevice: (kind) => {
        if (kind === 'current') {
          if (!this.place) return false;
          const sent = this.pairing.send(this.dish
            ? { type: 'open_dish', place_id: this.place.id, dish_id: this.dish.id }
            : { type: 'open_place', place_id: this.place.id });
          if (sent) this.notify('Sent to the paired device.');
          return sent;
        }
        if (!this.trip.data) return false;
        const sent = this.pairing.send({ type: 'send_trip', trip: this.trip.data });
        if (sent) this.notify('Trip sent to the paired device.');
        return sent;
      },
      controlXR: async (action, current) => {
        if (action === 'exit_xr') {
          this.engine?.exitXR();
          return { ok: true, message: 'Exited XR session' };
        }
        // The AR table has no entry point in the app any more, so only VR can be launched by voice.
        if (action !== 'enter_vr') return { ok: false, message: 'The AR table is not available' };
        const ok = await this.launchVR(current);
        return { ok, message: ok ? 'Launched VR' : 'Could not start VR. Use the Enter VR button on a supported device.' };
      },
      announce: (text) => this.notify(text),
    };
  }

  private notify(text: string) {
    this.notice.textContent = text;
    this.notice.hidden = false;
    window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => { this.notice.hidden = true; }, 6500);
  }
}
