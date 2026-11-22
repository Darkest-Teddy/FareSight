import {
  buildMbtaTripPlannerUrl, computeTripEstimate, haversineMeters, ROUTE_COLORS, RIDE_TIMES, type Dish,
  type GenerationJob, type LiveReviewsResponse, type MbtaSource, type Place, type Stop,
} from '@faresight/shared';
import { createFareSightEngine, type FareSightSceneEngine, type SceneMode } from '../xr';
import { SoundEngine } from '../audio/SoundEngine';
import { api, type PairMessage, type Trip } from '../api/client';
import { auth } from '../api/discoverClient';
import { offlineCatalog, offlineManifest } from '../data/fallbackData';
import { countPreviewsByStop, describe3DCount, isSplat } from '../data/preview3D';
import { buildComparisonBriefingCard, buildPlaceBriefingCard, loadLiveReviews, loadPlaceDecision, maxBriefingCards, placeDecision, type BriefingCard, type BriefingMode } from '../data/reviewBriefing';
import { LiveController, type AppControlSurface } from '../live/LiveController';
import { RealtimeVoice } from '../voice/RealtimeVoice';
import { AccountModal } from './AccountModal';
import { AdminModal } from './AdminModal';
import { ArrivalsBell } from './ArrivalsBell';
import { attribution } from './AttributionModal';
import { DiscoverView } from './DiscoverView';
import { button, element, errorText, httpUrl, icon, iconButton, link, message, modal, previewBadge, type IconName } from './dom';
import { FilterBar } from './FilterBar';
import { LiveVoiceDock } from './LiveVoiceDock';
import { ReviewBriefingModal } from './ReviewBriefingModal';
import { PairingModal } from './PairingModal';
import { lineDots, PlaceDrawer, type DishComparison, type Seating, type StationData, type ViewData } from './PlaceDrawer';
import { initialFilters, matchingPlaces, placesAt, type Filters } from './state';
import { UploadPipelineModal } from './UploadPipelineModal';

const sceneTitles: Record<SceneMode, string> = { map: 'Map', station: 'Station', venue: 'Venue', dish: 'Dish' };
const pollInterval = 18_000;
const tabIcons: Record<string, IconName> = { Explore: 'map', Filters: 'sliders', Venue: 'venue', Upload: 'upload', Pair: 'pair' };

export class AppShell {
  private readonly canvas = element('canvas', 'viewport');
  private readonly canvasNotice = element('div', 'canvas-notice');
  private readonly status = element('span', 'service-status');
  private readonly statusText = element('span', 'status-text');
  private readonly menuStatus = element('span', 'service-status');
  private readonly xrStatus = element('span', 'xr-status', 'Starting 3D');
  private readonly notice = element('div', 'notice');
  private readonly breadcrumbs = element('nav', 'breadcrumbs');
  private readonly stationBoard = element('section', 'station-board panel');
  private readonly stopsToggle: HTMLButtonElement;
  private readonly stationList = element('div', 'station-board-list');
  private readonly routeFeedback = element('div');
  private readonly filterBar: FilterBar;
  private readonly drawer: PlaceDrawer;
  private readonly pairing: PairingModal;
  private readonly uploader: UploadPipelineModal;
  private readonly credits: ReturnType<typeof attribution>;
  private readonly liveController: LiveController;
  private readonly liveClient: RealtimeVoice;
  private readonly liveDock: LiveVoiceDock;
  private readonly reviewModal: ReviewBriefingModal;
  private readonly briefings = new Map<string, BriefingCard>();
  private comparedPlaces: Place[] = [];
  private comparisonRun = 0;
  private comparisonLoading = false;
  private readonly debug = modal('Debug');
  private readonly renderStats = element('p', 'readout');
  private readonly debugLogs = element('pre', 'log-view');
  private readonly pairButton: HTMLButtonElement;
  private readonly audioButton: HTMLButtonElement;
  private readonly vrButton: HTMLButtonElement;
  private readonly xrExit: HTMLButtonElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu = element('div', 'command-menu');
  private readonly mobileButtons = new Map<string, HTMLButtonElement>();
  private readonly sound = new SoundEngine();
  private readonly logs: string[] = [];
  private readonly mobile = matchMedia('(max-width: 768px)');
  private readonly discover: DiscoverView;
  private readonly bell: ArrivalsBell;
  private readonly account: AccountModal;
  private readonly accountButton: HTMLButtonElement;
  private readonly viewToggle = element('div', 'view-toggle');
  /**
   * Discover is a flat 2D page, not a scene in the 3D engine, so it is tracked separately from
   * `mode`. Opening it hides the canvas and pauses the engine; closing it resumes exactly the
   * scene that was showing, without reloading the engine or its splats.
   */
  private discoverOpen = false;
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
  private dishRequest = 0;
  private inside = false;
  private fit = false;
  private seating: Seating = 'seated';
  private rotation = 0;
  private virtualTable = true;
  private muted = true;
  private drawerOpen = false;
  private sheetExpanded = false;
  private filterOpen = false;
  private stopsOpen = false;
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
  private highlightedStops: string[] = [];
  private highlightedPlaces: string[] = [];
  private highlightedDishId?: string;

  constructor(private readonly root: HTMLElement) {
    root.classList.add('app-shell');
    // The map is the hero: a brand pill and one action float over it, everything else opens on demand.
    const head = element('header', 'top-bar');
    const brand = button('FareSight', () => this.showMap(), 'wordmark');
    brand.title = 'Back to the map';
    const mark = element('span', 'brand-mark');
    mark.setAttribute('aria-hidden', 'true');
    brand.prepend(mark);
    const name = element('h1', 'brand');
    name.append(brand);
    this.breadcrumbs.setAttribute('aria-label', 'Scene navigation');
    // The dot carries the MBTA state. Its wording shows on hover or focus, and stays visible when something is wrong.
    this.status.tabIndex = 0;
    this.statusText.setAttribute('role', 'status');
    this.status.append(element('span', 'status-dot'), this.statusText);
    const pill = element('div', 'brand-pill');
    pill.append(name, this.status, this.breadcrumbs);
    this.stopsToggle = button('Stops', () => this.setStopsOpen(!this.stopsOpen, true), 'stops-toggle');
    this.stopsToggle.prepend(icon('list'));
    this.stopsToggle.append(icon('chevron'));
    this.stopsToggle.setAttribute('aria-controls', 'stop-list');
    this.stopsToggle.setAttribute('aria-expanded', 'false');
    const lead = element('div', 'top-left');
    lead.append(pill, this.stopsToggle);
    const operations = element('div', 'top-actions');
    this.vrButton = button('Enter VR', () => void this.launchVR(), 'accent');
    // Shown once the viewer reports what this device supports, so the label never flips on screen.
    this.vrButton.hidden = true;
    this.xrExit = button('Exit XR', () => this.engine?.exitXR(), 'accent');
    this.xrExit.hidden = true;
    this.pairButton = button('Pair Quest', () => this.pairing.open(), 'quiet desktop-action');
    this.audioButton = button('Sound effects', () => this.toggleAudio(), 'quiet switch');
    this.audioButton.setAttribute('aria-pressed', 'false');
    const admin = new AdminModal(() => void this.loadCatalog());
    this.credits = attribution(() => admin.open());
    this.reviewModal = new ReviewBriefingModal({
      dismiss: (cardId) => this.dismissReviewCard(cardId),
      openVenue: (id) => { void this.openBriefingVenue(id); },
      openDish: (id, dishId) => { void this.openBriefingVenue(id, dishId); },
      compareDishes: (id, dishId, comparePlaceId, compareDishId) => { void this.openBriefingVenue(id, dishId, compareDishId, comparePlaceId); },
      viewOnMap: (stopId) => {
        this.showMap();
        this.engine?.focusMapStopCamera(stopId);
      },
    });
    this.liveController = new LiveController(this.createControlSurface());
    this.liveClient = new RealtimeVoice({
      onState: (state, detail) => {
        this.liveDock.setState(state, detail);
        this.engine?.setVoiceState(state);
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
    });
    // Secondary tools live in one menu so the map keeps a single clear call to action.
    this.moreMenu.id = 'command-menu';
    this.moreMenu.hidden = true;
    const menuFoot = element('p', 'menu-status');
    menuFoot.append(this.menuStatus, this.xrStatus);
    this.moreMenu.append(
      this.pairButton,
      button('Upload 3D', () => this.uploader.open(this.place?.id), 'quiet desktop-action'),
      this.audioButton, button('Debug', () => this.openDebug(), 'quiet desktop-debug'),
      button('Credits', this.credits.open, 'quiet'),
      menuFoot,
    );
    this.moreButton = iconButton('more', 'More', () => this.setMenuOpen(this.moreMenu.hidden), 'menu-toggle');
    this.moreButton.setAttribute('aria-controls', this.moreMenu.id);
    this.moreButton.setAttribute('aria-expanded', 'false');
    const more = element('div', 'command-more');
    more.append(this.moreButton, this.moreMenu);
    this.moreMenu.addEventListener('click', (event) => {
      if (event.target instanceof HTMLButtonElement && event.target !== this.audioButton) this.setMenuOpen(false);
    });
    document.addEventListener('pointerdown', (event) => {
      if (!this.moreMenu.hidden && !more.contains(event.target as Node)) this.setMenuOpen(false);
    });
    more.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.moreMenu.hidden) return;
      event.preventDefault();
      this.setMenuOpen(false);
      this.moreButton.focus();
    });
    this.account = new AccountModal((user) => {
      this.accountButton.textContent = user.display_name;
      this.notify(`Signed in as ${user.display_name}.`);
    });
    this.accountButton = button('Sign in', () => void this.openAccount(), 'quiet account-button');

    this.discover = new DiscoverView((place) => void this.openDiscoverPlace(place));
    this.discover.root.hidden = true;
    this.bell = new ArrivalsBell(() => this.setDiscoverOpen(true));

    // The Map / Discover control, as in the reference design. Discover is a sibling of the whole
    // 3D experience rather than a step inside it, so it sits here and not in the breadcrumbs.
    this.viewToggle.setAttribute('role', 'tablist');
    this.viewToggle.setAttribute('aria-label', 'View');
    for (const [label, wantsDiscover] of [['Map', false], ['Discover', true]] as const) {
      const tab = button(label, () => this.setDiscoverOpen(wantsDiscover), 'view-toggle-option');
      tab.setAttribute('role', 'tab');
      // Deliberately not `data-view`: the shell element already carries that for the view it is
      // currently showing, so reusing it here made `[data-view="discover"]` match two different
      // elements meaning two different things.
      tab.dataset.viewTarget = wantsDiscover ? 'discover' : 'map';
      this.viewToggle.append(tab);
    }

    operations.append(this.accountButton, this.bell.root, this.vrButton, this.xrExit, this.liveDock.trigger, more);
    // Between the two groups, so it reads as centred.
    head.append(lead, this.viewToggle, operations);

    this.canvas.setAttribute('aria-label', 'FareSight interactive 3D view');
    this.canvas.tabIndex = 0;
    this.canvasNotice.replaceChildren(message('Loading 3D viewer…'));
    this.canvasNotice.setAttribute('aria-live', 'polite');
    this.notice.hidden = true;
    this.notice.setAttribute('role', 'status');

    const boardHead = element('header', 'station-board-heading');
    boardHead.append(element('h2', '', 'Explore by stop'), element('p', 'muted', 'Pick a stop to see what is nearby.'));
    this.stationBoard.id = 'stop-list';
    this.stationBoard.setAttribute('aria-label', 'Boston stops');
    this.stationBoard.append(boardHead, this.stationList, this.routeFeedback);
    this.stationBoard.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.mobile.matches || !this.stopsOpen) return;
      event.preventDefault();
      this.setStopsOpen(false);
      this.stopsToggle.focus();
    });

    this.filterBar = new FilterBar(this.filters, (patch) => this.updateFilters(patch),
      () => void this.locate(), (open) => this.setFilterOpen(open));
    this.drawer = new PlaceDrawer({
      showBriefing: (place) => this.showPlaceBriefing(place),
      toggleComparison: (place) => {
        if (this.comparedPlaces.some(({ id }) => id === place.id)) this.setComparedPlaces(this.comparedPlaces.filter(({ id }) => id !== place.id));
        else if (this.comparedPlaces.length < 3) this.setComparedPlaces([...this.comparedPlaces, place]);
        else this.notify('Compare up to three restaurants. Remove one to add another.');
      },
      clearComparison: () => this.setComparedPlaces([]),
      openComparison: () => void this.openRestaurantComparison(),
      close: () => {
        this.drawerOpen = false;
        this.renderPanels();
        // The current step of the trail reopens the card, so that is where focus lands on larger screens.
        (this.mobile.matches ? this.mobileButtons.get('Venue') : this.breadcrumbs.querySelector<HTMLElement>('[aria-current]'))?.focus();
      },
      toggleSheet: () => { this.sheetExpanded = !this.sheetExpanded; this.renderPanels(); },
      showPlace: (place) => { void this.showVenue(place); },
      enterRoom: () => void this.enterRoom(),
      openDish: (dish, compareId, comparePlaceId) => void this.showDish(dish, compareId, comparePlaceId),
      changeFit: (enabled, seating) => void this.setFit(enabled, seating),
      rotate: (degrees) => this.setDishRotation(degrees),
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
      published: (job, open, current) => this.handlePublication(job, open, current),
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
      tab.prepend(icon(tabIcons[label]));
      tabs.append(tab);
      this.mobileButtons.set(label, tab);
    }

    root.replaceChildren(this.canvas, this.canvasNotice, head, this.stationBoard, this.filterBar.root, this.drawer.root,
      this.discover.root, this.reviewModal.root, this.liveDock.root, tabs, this.notice, this.account.root);
    document.addEventListener('keydown', (event) => {
      if (!(event.target instanceof Element && event.target.closest('dialog[open]'))) this.reviewModal.dismissOnEscape(event);
    });
    this.debug.body.append(this.renderStats, this.debugLogs,
      button('Reset camera', () => this.engine?.resetCamera()),
      button('Send debug logs', () => void this.sendDebugLogs(), 'quiet'));
    this.mobile.addEventListener('change', () => this.renderPanels());
    this.sound.setMuted(true);
    this.sound.onStateChange = () => this.renderAudioState();
    this.filterBar.setStops(this.stops);
    this.syncViewToggle();
    this.renderBreadcrumbs();
    this.applyFilters();
    this.renderStatus();
    this.renderPanels();
  }

  async start() {
    void this.loadCatalog();
    void this.refreshTransit();
    // The bell watches for arrivals on every view, not just Discover, so somebody exploring the
    // 3D map still learns that a place was added.
    this.bell.start();
    void this.restoreSession();
    window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void this.refreshTransit();
      if (this.stop) void this.refreshStation(false);
      if (this.place) void this.refreshTrip(false);
    }, pollInterval);
    window.addEventListener('online', () => {
      void this.loadCatalog();
      void this.refreshTransit();
      if ((this.mode === 'venue' || this.mode === 'dish') && this.manifest.offline) void this.refreshManifest();
    });
    window.addEventListener('resize', () => this.engine?.resize());
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
          this.vrButton.textContent = state.vrSupported ? 'Enter VR' : 'Reset view';
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
      this.canvasNotice.replaceChildren(message('3D viewer unavailable. Use the stop list to keep exploring.', true));
      this.log(errorText(error));
      this.vrButton.hidden = true;
      this.xrStatus.textContent = '3D viewer unavailable';
      this.root.dataset.viewer = 'failed';
      // Without the map there is nothing to click, so the list becomes the way in.
      this.setStopsOpen(true);
    }
  }

  private setMenuOpen(open: boolean) {
    this.moreMenu.hidden = !open;
    this.moreButton.setAttribute('aria-expanded', String(open));
  }

  private findStop(id: string) { return this.stops.find((stop) => stop.stop_id === id); }

  private renderStatus() {
    const text = this.catalogState === 'offline' ? 'Offline catalog'
      : this.vehicleSource === 'live' ? 'Live MBTA'
        : this.vehicleSource === 'simulated' ? 'Simulated trains'
          : this.vehicleSource === 'unavailable' ? 'Trains unavailable' : 'Checking MBTA';
    const source = this.catalogState === 'offline' ? 'offline' : this.vehicleSource ?? 'pending';
    if (this.statusText.textContent !== text) this.statusText.textContent = this.menuStatus.textContent = text;
    this.status.dataset.source = this.menuStatus.dataset.source = source;
    // Only a problem earns words on the pill. Everything else is a dot with a tooltip.
    this.status.dataset.alert = String(source === 'offline' || source === 'unavailable');
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
    // The trail lists only places you can go back to. On a fresh map there is nothing to show.
    const nodes = (Object.keys(sceneTitles) as SceneMode[]).flatMap((mode, index) => {
      const available = mode === 'map' || (mode === 'station' && this.stop) || (mode === 'venue' && this.place) || (mode === 'dish' && this.dish);
      if (!available) return [];
      const node = button(names[index], () => this.navigate(mode), 'crumb');
      node.title = names[index];
      if (mode === this.mode) node.setAttribute('aria-current', 'page');
      if (!index) return [node];
      const divider = element('span', 'crumb-divider');
      divider.setAttribute('aria-hidden', 'true');
      return [divider, node];
    });
    this.breadcrumbs.replaceChildren(...nodes);
    this.breadcrumbs.hidden = nodes.length < 2;
    // On phones the trail scrolls sideways; keep its newest step in view.
    this.breadcrumbs.scrollLeft = this.breadcrumbs.scrollWidth;
  }

  private renderStationBoard(matched: ReadonlySet<string>) {
    const counts = countPreviewsByStop(this.places, matched);
    const key = JSON.stringify([this.filters.familyVisit, this.highlightedStops, ...this.stops.map((stop) => [stop.stop_id, counts.get(stop.stop_id)])]);
    if (this.stationList.dataset.summary === key) return;
    this.stationList.dataset.summary = key;
    this.stationList.replaceChildren();
    const highlighted = new Set(this.highlightedStops);
    for (const stop of this.stops) {
      const previews = counts.get(stop.stop_id);
      const count = previews?.matching ?? 0;
      if (this.filters.familyVisit && count === 0) continue;
      const row = button('', () => this.showStation(stop), 'station-row');
      const name = element('strong');
      name.append(element('span', 'station-name', stop.name));
      if (previews?.published3D) name.append(previewBadge());
      row.append(lineDots(stop), name, element('span', 'station-count', String(count)));
      row.setAttribute('aria-label', `${stop.name}, ${count} matching ${count === 1 ? 'place' : 'places'}${describe3DCount(previews)}`);
      row.dataset.stop = stop.stop_id;
      row.dataset.highlighted = String(highlighted.has(stop.stop_id));
      // Mirror list focus on the 3D map so the two read as one control.
      for (const type of ['pointerenter', 'focus']) row.addEventListener(type, () => this.engine?.setHoveredStop(stop.stop_id));
      for (const type of ['pointerleave', 'blur']) row.addEventListener(type, () => this.engine?.setHoveredStop(undefined));
      this.stationList.append(row);
    }
    if (this.filters.familyVisit && !this.stationList.children.length) {
      this.stationList.append(message('No stops match the family visit filters.'));
    }
  }

  private renderPanels() {
    this.root.dataset.filterOpen = String(this.filterOpen);
    this.root.dataset.scene = this.mode;
    // Phones keep the list as the Explore sheet. Larger screens open it from the Stops toggle.
    this.stationBoard.hidden = this.mode !== 'map' || !(this.stopsOpen || this.mobile.matches);
    this.stopsToggle.hidden = this.mode !== 'map';
    this.stopsToggle.setAttribute('aria-expanded', String(this.stopsOpen));
    this.filterBar.setOpen(this.filterOpen);
    const shown = this.drawerOpen && this.mode !== 'map' && !(this.mobile.matches && this.filterOpen);
    this.root.dataset.drawer = String(shown);
    this.drawer.mountComparison(shown ? undefined : this.stationBoard);
    if (shown) this.renderDrawer();
    else this.drawer.hide();
    this.drawer.expanded(this.sheetExpanded);
    this.mobileButtons.get('Explore')?.setAttribute('aria-pressed', String(!this.filterOpen && this.mode === 'map'));
    this.mobileButtons.get('Filters')?.setAttribute('aria-pressed', String(this.filterOpen));
    this.mobileButtons.get('Venue')?.setAttribute('aria-pressed', String(shown));
  }

  private renderDrawer(focus = false) {
    this.drawer.setComparison(this.comparedPlaces, this.comparisonLoading);
    focus &&= !this.liveDock.root.contains(document.activeElement);
    if (!this.drawerOpen || (this.mobile.matches && this.filterOpen)) return;
    if (this.mode === 'station' && this.stop) {
      const highlights = new Set(this.highlightedPlaces);
      const places = placesAt(this.filtered, this.stop, this.filters);
      const shown = new Set(places.map(({ id }) => id));
      if (this.xrMode === 'none' && !this.mobile.matches) {
        places.push(...this.places.filter(({ id, stop_id }) => stop_id === this.stop?.stop_id && highlights.has(id) && !shown.has(id)));
      }
      this.drawer.station(this.stop, places, this.filters, focus, highlights);
      this.updateStationDrawer();
    }
    if ((this.mode === 'venue' || this.mode === 'dish') && this.place) {
      this.drawer.venue({
        place: this.place, stop: this.stop, filters: this.filters, manifest: this.manifest, trip: this.trip, dish: this.dish,
        places: this.places, comparison: this.comparison, fit: this.fit, seating: this.seating, rotation: this.rotation, inside: this.inside,
        table: this.virtualTable ? 'virtual' : 'passthrough', originName: this.findStop(this.filters.startStopId)?.name,
        highlightedDishId: this.highlightedDishId,
      }, focus);
    }
  }

  private setFilterOpen(open: boolean) {
    const refocus = !open && this.filterBar.holdsFocus();
    this.filterOpen = open;
    this.renderPanels();
    if (open) this.settleOverlays('filters');
    else if (this.mobile.matches) this.mobileButtons.get('Filters')?.focus();
    else if (refocus) this.filterBar.focusSummary();
  }

  private setStopsOpen(open: boolean, focus = false) {
    this.stopsOpen = open;
    this.renderPanels();
    if (!open) return;
    this.settleOverlays('stops');
    if (focus) this.stationList.querySelector<HTMLElement>('.station-row')?.focus({ preventScroll: true });
  }

  /** Floating panels never stack: opening one closes any other it would cover. */
  private settleOverlays(opened: 'stops' | 'filters' | 'voice') {
    if (this.mobile.matches) return;
    const panels = { stops: this.stationBoard, filters: this.filterBar.panel, voice: this.liveDock.root };
    const box = panels[opened].getBoundingClientRect();
    if (!box.width) return;
    const gap = 8;
    let changed = false;
    for (const name of ['stops', 'filters', 'voice'] as const) {
      if (name === opened) continue;
      const other = panels[name].getBoundingClientRect();
      if (!other.width || box.right + gap < other.left || box.left - gap > other.right
        || box.bottom + gap < other.top || box.top - gap > other.bottom) continue;
      if (name === 'stops') this.stopsOpen = false;
      else if (name === 'filters') this.filterOpen = false;
      else this.liveDock.setOpen(false);
      changed = true;
    }
    if (changed) this.renderPanels();
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
    this.filterBar.render(this.filters, this.filtered.length);
    this.renderStationBoard(matched);
    this.renderDrawer();
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
    if (mode === 'station' && this.stop) this.showStation(this.stop);
    if (mode === 'venue' && this.place) void this.showVenue(this.place);
    if (mode === 'dish' && this.dish) void this.showDish(this.dish, this.comparison?.dish.id, this.comparison?.place.id);
  }

  /**
   * Switches between the 3D experience and the Discover page.
   *
   * The engine is paused rather than destroyed. Re-creating it would mean reloading the map
   * sculpture and every splat on each switch, which is far too slow for a control someone is
   * expected to flick back and forth.
   */
  private setDiscoverOpen(open: boolean) {
    if (this.discoverOpen === open) return;
    this.discoverOpen = open;
    this.discover.root.hidden = !open;
    this.canvas.hidden = open;
    this.canvasNotice.hidden = open;
    this.syncViewToggle();
    if (open) {
      this.setFilterOpen(false);
      this.engine?.setPaused(true);
      void this.discover.activate();
    } else {
      this.discover.deactivate();
      this.engine?.setPaused(false);
      this.engine?.resize();
    }
    this.renderPanels();
  }

  /**
   * Opens a place chosen on Discover.
   *
   * A seeded place has a pin on its station diorama, so it can fly the camera there and pulse the
   * flag. A contributed place deliberately has no pin at all (specification D6), so there is
   * nowhere to fly to and it opens its own detail view instead. The card shows which it is, so
   * the two behaviours are not a surprise.
   */
  private async openDiscoverPlace(entry: { id: string; source: 'catalog' | 'contributed'; station_id: string | null }) {
    if (entry.source === 'catalog') {
      const place = this.places.find(({ id }) => id === entry.id);
      if (place) {
        this.setDiscoverOpen(false);
        await this.showVenue(place);
        return;
      }
    }
    // Contributed places live only on Discover. Until their detail view exists, say so plainly
    // rather than navigating somewhere that cannot show them.
    this.notify('This place was added from the phone app. Its 3D view opens here once the scan finishes.');
  }

  /**
   * Shows who is signed in, if anyone.
   *
   * Also redeems the handoff token the Expo app injects before the page loads, which is how a
   * native sign-in becomes a web session without the long-lived token entering the WebView.
   */
  private async restoreSession() {
    // Same global the Expo app injects and the contribute app reads, so one convention covers
    // all three clients.
    const native = window as unknown as { __FARESIGHT_HANDOFF__?: string };
    const handoff = native.__FARESIGHT_HANDOFF__;
    if (handoff) {
      delete native.__FARESIGHT_HANDOFF__;
      try {
        const user = await auth.exchange(handoff);
        this.accountButton.textContent = user.display_name;
        return;
      } catch { /* Fall through and show the signed-out state. */ }
    }
    try {
      const status = await auth.status();
      if (status.user) this.accountButton.textContent = status.user.display_name;
      // Nothing to sign into, so do not offer it.
      this.accountButton.hidden = !status.enabled;
    } catch { /* Offline or no server: leave the button as it is. */ }
  }

  private async openAccount() {
    const status = await auth.status().catch(() => undefined);
    if (status?.user) {
      await auth.logout();
      this.accountButton.textContent = 'Sign in';
      this.notify('Signed out.');
      return;
    }
    await this.account.open();
  }

  private syncViewToggle() {
    const view = this.discoverOpen ? 'discover' : 'map';
    this.root.dataset.view = view;
    for (const tab of this.viewToggle.children) {
      const selected = (tab as HTMLElement).dataset.viewTarget === view;
      tab.classList.toggle('is-selected', selected);
      tab.setAttribute('aria-selected', String(selected));
    }
  }

  private showMap() {
    ++this.navigation;
    if (this.discoverOpen) this.setDiscoverOpen(false);
    if (this.mode !== 'map') this.sound.playBack();
    this.mode = 'map';
    this.filterOpen = false;
    this.drawerOpen = false;
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderScene();
  }

  private showStation(stop: Stop) {
    ++this.navigation;
    const changed = this.stop?.stop_id !== stop.stop_id || this.mode !== 'station';
    const sheet = this.mobile.matches;
    const arriving = sheet && this.mode === 'map';
    this.drawer.root.classList.toggle('arriving', arriving);
    if (arriving) this.drawer.root.addEventListener('animationend', () => this.drawer.root.classList.remove('arriving'), { once: true });
    this.stop = stop;
    this.place = undefined;
    this.dish = undefined;
    this.comparison = undefined;
    this.highlightedDishId = undefined;
    this.inside = this.fit = false;
    this.mode = 'station';
    this.filterOpen = false;
    this.drawerOpen = sheet || (this.xrMode === 'none' && this.comparedPlaces.length > 0);
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

  private async showVenue(place: Place, options?: { inside?: boolean; current?: () => boolean }) {
    const current = options?.current ?? (() => true);
    if (!current()) return;
    const changed = this.place?.id !== place.id;
    let prepared: ViewData['manifest'] | undefined;
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
    this.drawerOpen = true;
    this.sheetExpanded = false;
    if (changed || cameFromDish) this.sound.playSelect();
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderDrawer(true);
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
    this.renderDrawer();
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
    this.renderDrawer();
    if (this.mode === 'venue' || this.mode === 'dish') this.renderScene();
  }

  private async loadManifest(place: Place): Promise<ViewData['manifest']> {
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
    ++this.navigation;
    this.inside = true;
    this.sound.playSelect();
    this.renderDrawer();
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
        const select = this.drawer.root.querySelector<HTMLSelectElement>('select[data-control="compare"]');
        if (select) select.value = this.comparison?.dish.id ?? '';
        return false;
      }
      comparison = { place: venue, dish: item.dish, asset: item.dish_asset, offline: manifest?.offline };
    }
    const previous = this.dish?.id;
    this.mode = 'dish';
    this.dish = dish;
    this.comparison = comparison;
    if (previous !== dish.id) this.rotation = 0;
    this.drawerOpen = true;
    this.filterOpen = false;
    this.sound.playSelect();
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderDrawer(previous !== dish.id);
    this.renderScene();
    return true;
  }

  private async setFit(enabled: boolean, seating: Seating) {
    this.fit = enabled;
    this.seating = seating;
    this.renderDrawer();
    if (enabled && !this.inside) await this.enterRoom();
    else this.engine?.setWillWeFit(enabled, this.filters.groupSize, seating);
  }

  private setComparedPlaces(places: Place[]): void {
    this.comparisonRun++;
    this.comparisonLoading = false;
    this.comparedPlaces = places;
    this.renderDrawer();
    if (places.length && this.mode === 'map' && !this.mobile.matches && !this.stopsOpen) this.setStopsOpen(true);
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
    this.drawer.setComparison(this.comparedPlaces, true);
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
      if (request === this.comparisonRun) {
        this.comparisonLoading = false;
        this.drawer.setComparison(this.comparedPlaces, false);
      }
    }
  }

  private showPlaceBriefing(place: Place): void {
    const stop = this.findStop(place.stop_id);
    if (!stop) return;
    const filters = this.filters;
    const navigation = this.navigation;
    let details = placeDecision(place, stop, filters);
    let web: LiveReviewsResponse | undefined;
    let card = buildPlaceBriefingCard(details);
    this.showReviewCard(card);
    const update = () => {
      if (!this.isCurrentVenue(navigation, place.id) || this.briefings.get(card.id) !== card) return;
      card = buildPlaceBriefingCard(details, web);
      this.briefings.set(card.id, card);
      this.renderReviewCards();
    };
    void loadPlaceDecision(place, stop, filters).then((fresh) => { details = fresh; update(); }).catch(() => {});
    void loadLiveReviews(place.id).then((fresh) => {
      web = fresh;
      update();
    }).catch(() => {});
  }

  private showReviewCard(card: BriefingCard, mode: BriefingMode = 'add'): void {
    if (mode === 'replace') this.briefings.clear();
    if (!this.briefings.has(card.id) && this.briefings.size === maxBriefingCards) {
      const oldest = this.briefings.keys().next();
      if (!oldest.done) this.briefings.delete(oldest.value);
    }
    this.briefings.set(card.id, card);
    this.renderReviewCards(card.id);
  }

  private renderReviewCards(activeId?: string): void {
    const cards = [...this.briefings.values()];
    if (this.xrMode === 'none') this.reviewModal.show(cards, activeId);
    else this.reviewModal.hide();
    this.engine?.setReviewCards(cards);
  }

  private dismissReviewCard(cardId?: string): void {
    if (cardId === undefined) this.briefings.clear();
    else this.briefings.delete(cardId);
    this.renderReviewCards();
  }

  private async openBriefingVenue(placeId: string, dishId?: string, compareDishId?: string, comparePlaceId?: string): Promise<void> {
    const place = this.places.find(({ id }) => id === placeId);
    if (!place) return;
    const opening = this.showVenue(place, { inside: true });
    const navigation = this.navigation;
    await opening;
    if (!dishId || !this.isCurrentVenue(navigation, placeId)) return;
    const dish = this.manifest.data?.menu_items.find((item) => item.dish.id === dishId && item.dish_asset)?.dish;
    if (dish) await this.showDish(dish, compareDishId, comparePlaceId);
    else this.notify('This dish does not have a published 3D preview.');
  }

  private isCurrentVenue(navigation: number, placeId: string): boolean {
    return this.navigation === navigation && this.place?.id === placeId && (this.mode === 'venue' || this.mode === 'dish');
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
        if (version === this.sceneVersion) this.notify('Could not display this 3D view. The details are still available.');
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
    // The switch keeps its label; only its pressed state says whether sound is actually playing.
    this.audioButton.setAttribute('aria-pressed', String(!this.muted && this.sound.running));
  }

  private setDishRotation(degrees: number): void {
    this.rotation = degrees;
    this.engine?.setDishRotation(degrees * Math.PI / 180);
    this.drawer.setRotation(degrees);
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
        seating: this.seating,
        rotation: this.rotation,
        virtualTable: this.virtualTable,
        muted: this.muted || !this.sound.running,
        drawerOpen: this.drawerOpen,
        sheetExpanded: this.sheetExpanded,
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
      setComparedPlaces: (places) => {
        if (places.length && !this.drawerOpen && this.mode !== 'map' && this.xrMode === 'none' && !this.mobile.matches) {
          this.drawerOpen = true;
          this.renderPanels();
        }
        this.setComparedPlaces(places);
      },
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
        if (placeIds.length && this.mode === 'station' && this.xrMode === 'none' && !this.mobile.matches && !this.drawerOpen) {
          this.drawerOpen = true;
          this.renderPanels();
        } else {
          this.renderDrawer();
        }
      },
      setHighlightedDish: (dishId) => {
        this.highlightedDishId = dishId;
        this.engine?.setHighlightedDish(dishId);
        this.renderDrawer();
      },
      clearHighlights: () => {
        this.highlightedStops = [];
        this.highlightedPlaces = [];
        this.highlightedDishId = undefined;
        this.engine?.setHighlightedStops([], false);
        this.engine?.setHighlightedPlaces([]);
        this.engine?.setHighlightedDish(undefined);
        this.renderStationBoard(new Set(this.filtered.map((p) => p.id)));
        this.renderDrawer();
      },
      focusMenu: (dishId) => {
        if (this.mobile.matches) this.sheetExpanded = true;
        this.drawerOpen = true;
        this.renderPanels();
        this.drawer.focusMenu(dishId);
      },
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
      setDrawerState: (action) => {
        if (action === 'close') this.drawerOpen = false;
        else if (action === 'open') this.drawerOpen = true;
        else if (action === 'expand') { this.drawerOpen = true; this.sheetExpanded = true; }
        else if (action === 'collapse') { this.sheetExpanded = false; }
        this.renderPanels();
      },
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
