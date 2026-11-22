import {
  computeTripEstimate, haversineMeters, ROUTE_COLORS, RIDE_TIMES, type Dish,
  type GenerationJob, type LiveReviewsResponse, type MbtaSource, type Place, type Stop,
} from '@faresight/shared';
import { createFareSightEngine, type FareSightSceneEngine, type SceneMode } from '../xr';
import { SoundEngine } from '../audio/SoundEngine';
import { api, type PairMessage, type Trip } from '../api/client';
import { offlineCatalog, offlineManifest } from '../data/fallbackData';
import { countPreviewsByStop, describe3DCount, isSplat } from '../data/preview3D';
import { buildComparisonBriefingCard, buildPlaceBriefingCard, loadLiveReviews, loadPlaceDecision, maxBriefingCards, placeDecision, type BriefingCard, type BriefingMode } from '../data/reviewBriefing';
import { LiveController, type AppControlSurface } from '../live/LiveController';
import { RealtimeVoice } from '../voice/RealtimeVoice';
import { AdminModal } from './AdminModal';
import { attribution } from './AttributionModal';
import { button, element, errorText, icon, link, message, modal } from './dom';
import { FilterBar } from './FilterBar';
import { LiveVoiceDock } from './LiveVoiceDock';
import { ReviewBriefingModal } from './ReviewBriefingModal';
import { PairingModal } from './PairingModal';
import { lineDots, PlaceDrawer, type DishComparison, type Seating, type StationData, type ViewData } from './PlaceDrawer';
import { initialFilters, matchingPlaces, placesAt, type Filters } from './state';
import { UploadPipelineModal } from './UploadPipelineModal';

const sceneTitles: Record<SceneMode, string> = { map: 'Map', station: 'Station', venue: 'Venue', dish: 'Dish' };
const sceneDepth: Record<SceneMode, number> = { map: 0, station: 1, venue: 2, dish: 3 };
const pollInterval = 18_000;

function brandMark() {
  const mark = element('span', 'brand-mark');
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function labelAndIcon(control: HTMLButtonElement, label: string, name: Parameters<typeof icon>[0]) {
  control.replaceChildren(icon(name), element('span', '', label));
  return control;
}

export class AppShell {
  private readonly canvas = element('canvas', 'viewport');
  private readonly canvasNotice = element('div', 'canvas-notice');
  private serviceNotice?: string;
  private readonly notice = element('div', 'notice surface');
  private readonly breadcrumbs = element('nav', 'breadcrumbs');
  private readonly sidebarHead = element('header', 'sidebar-head');
  private readonly sidebarBrand = element('div', 'sidebar-brand');
  private readonly sidebarBack = button('', () => this.goBack(), 'quiet sidebar-back');
  private readonly sidebarBackLabel = element('span');
  private readonly sidebarHome = button('', () => this.showMap(), 'quiet icon-button sidebar-home');
  private readonly sidebar = element('aside', 'sidebar surface');
  private readonly sidebarHide = button('', () => this.setSidebarHidden(true), 'quiet icon-button sidebar-hide');
  private readonly sidebarShow = button('', () => this.setSidebarHidden(false), 'icon-button sidebar-show surface-quiet');
  private sidebarHidden = false;
  private readonly stationBoard = element('section', 'station-board panel');
  private readonly stationSummary = element('p', 'station-summary');
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
  private readonly arButton: HTMLButtonElement;
  private readonly xrExit: HTMLButtonElement;
  private readonly moreButton: HTMLButtonElement;
  private readonly moreMenu = element('div', 'command-menu surface');
  private readonly mobileButtons = new Map<string, HTMLButtonElement>();
  private readonly sound = new SoundEngine();
  private readonly logs: string[] = [];
  private readonly mobile = matchMedia('(max-width: 768px)');
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private renderedMode?: SceneMode;
  private panelAnimations: Animation[] = [];
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
  private mapScroll = 0;
  private stationReturn?: { stopId: string; placeId: string; scrollTop: number };
  private venueReturn?: { placeId: string; dishId: string; scrollTop: number };
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
    const head = element('header', 'command-bar surface-quiet');
    const brand = button('FareSight', () => this.showMap(), 'wordmark');
    brand.prepend(brandMark());
    this.breadcrumbs.setAttribute('aria-label', 'Scene navigation');
    const operations = element('div', 'command-actions');
    this.vrButton = button('Enter VR', () => void this.launchXR('vr'), 'accent xr-entry');
    this.arButton = button('AR Table', () => void this.launchXR('ar'), 'xr-entry');
    this.vrButton.dataset.supported = this.arButton.dataset.supported = 'false';
    this.xrExit = button('Exit XR', () => this.engine?.exitXR(), 'accent');
    this.xrExit.hidden = true;
    this.pairButton = labelAndIcon(button('', () => this.pairing.open(), 'quiet desktop-action'), 'Pair a headset', 'headset');
    this.audioButton = labelAndIcon(button('', () => this.toggleAudio(), 'quiet'), 'Sound', 'sound-off');
    this.audioButton.setAttribute('role', 'menuitemcheckbox');
    this.audioButton.setAttribute('aria-checked', 'false');
    const admin = new AdminModal(() => void this.loadCatalog());
    this.credits = attribution(() => admin.open());
    this.reviewModal = new ReviewBriefingModal({
      dismiss: (cardId) => this.dismissReviewCard(cardId),
      openVenue: (id) => { void this.openBriefingVenue(id); },
      openDish: (id, dishId) => { void this.openBriefingVenue(id, dishId); },
      compareDishes: (id, dishId, comparePlaceId, compareDishId) => { void this.openBriefingVenue(id, dishId, compareDishId, comparePlaceId); },
      viewOnMap: (stopId) => {
        this.dismissReviewCard();
        this.showMap();
        void this.sceneQueue.then(() => { if (this.mode === 'map') this.engine?.focusMapStopCamera(stopId); });
      },
    });
    this.liveController = new LiveController(this.createControlSurface());
    this.liveClient = new RealtimeVoice({
      onState: (state, detail) => {
        this.liveDock.setState(state, detail);
        this.engine?.setVoiceState(state);
      },
      onTranscript: (entry) => this.liveDock.appendTranscript(entry),
      onModel: () => {},
      onTool: (name, args) => this.liveController.executeRealtime(name, args),
      getContext: () => this.liveController.describeContext(),
    });
    this.liveDock = new LiveVoiceDock({
      toggle: () => this.liveClient.toggle(),
      stop: () => this.liveClient.stop(),
      toggleMute: () => {
        const next = !this.liveClient.isMuted;
        this.liveClient.setMuted(next);
        this.liveDock.setMuted(next);
      },
      sendText: (text) => this.liveClient.sendText(text),
      onOpen: () => this.setMenuOpen(false),
    }, this.mobile);
    this.moreMenu.id = 'command-menu';
    this.moreMenu.hidden = true;
    this.moreMenu.setAttribute('role', 'menu');
    this.moreMenu.setAttribute('aria-label', 'More');
    this.moreMenu.append(
      labelAndIcon(button('', () => this.uploader.open(this.place?.id), 'quiet desktop-action'), 'Upload 3D capture', 'upload'),
      this.pairButton, this.audioButton,
      labelAndIcon(button('', this.credits.open, 'quiet'), 'Credits', 'info'),
    );
    for (const item of this.moreMenu.querySelectorAll('button')) {
      if (item !== this.audioButton) item.setAttribute('role', 'menuitem');
      item.tabIndex = -1;
    }
    this.moreButton = button('', () => this.setMenuOpen(this.moreMenu.hidden), 'quiet icon-button menu-toggle');
    this.moreButton.append(icon('more'));
    this.moreButton.setAttribute('aria-label', 'More');
    this.moreButton.setAttribute('aria-controls', this.moreMenu.id);
    this.moreButton.setAttribute('aria-expanded', 'false');
    this.moreButton.setAttribute('aria-haspopup', 'menu');
    this.moreMenu.addEventListener('keydown', (event) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = this.visibleMenuItems();
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const direction = event.key === 'ArrowUp' ? -1 : 1;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
        : (current + direction + items.length) % items.length;
      event.preventDefault();
      items[next]?.focus();
    });
    this.moreMenu.addEventListener('focusout', (event) => {
      if (event.relatedTarget === this.moreButton || this.moreMenu.contains(event.relatedTarget as Node | null)) return;
      this.setMenuOpen(false);
    });
    this.moreMenu.addEventListener('click', (event) => {
      const item = (event.target as Element).closest('button');
      if (item && item !== this.audioButton) {
        this.setMenuOpen(false);
        this.moreButton.focus();
      }
    }, { capture: true });
    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      if (!this.moreMenu.hidden && !this.moreButton.contains(target) && !this.moreMenu.contains(target)) this.setMenuOpen(false);
    });
    operations.append(this.liveDock.trigger, this.vrButton, this.arButton, this.xrExit, this.moreButton);
    head.append(brand, this.breadcrumbs, operations);

    const indicators = element('div', 'indicators');
    const reset = button('', () => this.engine?.resetCamera(), 'quiet icon-button map-reset surface-quiet');
    reset.append(icon('reset'));
    reset.setAttribute('aria-label', 'Reset view');
    reset.title = 'Reset view';
    const mapControls = element('div', 'map-controls');
    mapControls.append(reset);
    indicators.append(mapControls);
    this.canvas.setAttribute('aria-label', 'FareSight interactive 3D view');
    this.canvas.tabIndex = 0;
    this.canvasNotice.replaceChildren(message('Loading 3D viewer…'));
    this.canvasNotice.setAttribute('aria-live', 'polite');
    this.notice.hidden = true;
    this.notice.setAttribute('role', 'status');

    const boardHead = element('header', 'station-board-heading');
    boardHead.append(element('h1', '', 'Explore by stop'), this.stationSummary);
    this.stationBoard.setAttribute('aria-label', 'Boston stops');
    this.stationBoard.append(boardHead, this.stationList, this.routeFeedback);

    this.filterBar = new FilterBar(this.filters, (patch) => this.updateFilters(patch), () => this.locate(), () => this.setFilterOpen(false));
    this.drawer = new PlaceDrawer({
      showBriefing: (place) => this.showPlaceBriefing(place),
      toggleComparison: (place) => {
        if (this.comparedPlaces.some(({ id }) => id === place.id)) this.setComparedPlaces(this.comparedPlaces.filter(({ id }) => id !== place.id));
        else if (this.comparedPlaces.length < 3) this.setComparedPlaces([...this.comparedPlaces, place]);
        else this.notify('Compare up to three restaurants. Remove one to add another.');
      },
      clearComparison: () => this.setComparedPlaces([]),
      openComparison: () => void this.openRestaurantComparison(),
      close: () => { this.drawerOpen = false; this.renderPanels(); this.mobileButtons.get('Venue')?.focus(); },
      toggleSheet: () => { this.sheetExpanded = !this.sheetExpanded; this.renderPanels(); },
      showPlace: (place) => { void this.showVenue(place); },
      enterRoom: () => void this.enterRoom(),
      openDish: (dish, compareId, comparePlaceId) => void this.showDish(dish, compareId, comparePlaceId),
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
    this.drawer.setXrCapable(false);
    this.pairing = new PairingModal((data) => void this.receivePair(data), (paired) => {
      labelAndIcon(this.pairButton, paired ? 'Paired' : 'Pair a headset', 'headset');
      this.mobileButtons.get('Pair')?.setAttribute('aria-label', paired ? 'Paired devices' : 'Pair device');
      this.drawer.setPaired(paired);
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

    const sidebar = this.sidebar;
    sidebar.id = 'explore-sidebar';
    sidebar.setAttribute('aria-label', 'Explore FareSight');
    for (const [control, label] of [[this.sidebarHide, 'Hide sidebar'], [this.sidebarShow, 'Show sidebar']] as const) {
      control.append(icon('sidebar'));
      control.setAttribute('aria-label', label);
      control.setAttribute('aria-controls', sidebar.id);
      control.title = label;
    }
    this.sidebarHide.setAttribute('aria-expanded', 'true');
    this.sidebarShow.setAttribute('aria-expanded', 'false');
    this.sidebarShow.hidden = true;
    const headActions = element('div', 'sidebar-actions');
    headActions.append(this.sidebarHome, this.sidebarHide);
    this.sidebarBrand.append(brandMark(), element('span', 'sidebar-name', 'FareSight'));
    this.sidebarBack.append(icon('back'), this.sidebarBackLabel);
    this.sidebarHome.append(brandMark());
    this.sidebarHome.setAttribute('aria-label', 'Return to the map');
    this.sidebarHome.title = 'Return to the map';
    this.sidebarHead.append(this.sidebarBrand, this.sidebarBack, headActions);
    sidebar.append(this.sidebarHead, this.filterBar.root, this.stationBoard, this.drawer.root);
    root.replaceChildren(this.canvas, this.canvasNotice, head, this.moreMenu, this.liveDock.root, indicators, sidebar, this.sidebarShow, tabs, this.notice);
    this.debug.body.append(this.renderStats, this.debugLogs,
      button('Reset camera', () => this.engine?.resetCamera()),
      button('Send debug logs', () => void this.sendDebugLogs(), 'quiet'));
    this.mobile.addEventListener('change', () => this.renderPanels());
    document.addEventListener('keydown', (event) => {
      if (event.defaultPrevented) return;
      if (!this.mobile.matches && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'd') {
        if (event.target instanceof Element && event.target.closest('input, select, textarea, [contenteditable]')) return;
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat && !document.querySelector('dialog[open]')) this.openDebug();
        return;
      }
      if (event.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      if (event.repeat) return;
      if (!this.liveDock.root.hidden) {
        event.preventDefault();
        this.liveDock.dismiss();
        return;
      }
      if (!this.moreMenu.hidden) {
        event.preventDefault();
        this.setMenuOpen(false);
        this.moreButton.focus();
        return;
      }
      if (this.mobile.matches || this.mode === 'map') return;
      if (event.target instanceof Element && event.target.closest('input, select, textarea, dialog, [contenteditable]')) return;
      this.goBack();
    });
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
    window.addEventListener('pagehide', (event) => {
      this.liveClient.destroy();
      if (!event.persisted) this.engine?.destroy();
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
        onNavigateScene: (mode) => { if (!this.busyScene && mode !== this.mode) this.navigate(mode); },
        onToggleVoice: () => this.liveClient.toggle(),
        onDismissReviewCard: (cardId) => this.dismissReviewCard(cardId),
        onXrStateChange: (state) => {
          const changed = this.xrMode !== state.activeMode;
          this.xrMode = state.activeMode;
          this.root.dataset.xr = this.xrMode;
          this.vrButton.hidden = this.xrMode !== 'none';
          this.xrExit.hidden = this.xrMode === 'none';
          this.arButton.hidden = this.xrMode !== 'none';
          this.vrButton.textContent = state.vrSupported ? 'Enter VR' : 'Reset view';
          this.vrButton.classList.toggle('accent', state.vrSupported);
          this.arButton.title = state.arSupported ? 'Open an immersive AR table' : 'Open the virtual table on this device';
          this.arButton.dataset.supported = String(state.arSupported);
          this.vrButton.dataset.supported = String(state.vrSupported);
          const xrCapable = state.vrSupported || state.arSupported;
          this.drawer.setXrCapable(xrCapable);
          if (changed) this.renderReviewCards();
        },
        onStatsUpdate: (stats) => {
          this.renderStats.textContent = `${Math.round(stats.fps)} FPS · ${stats.loadedSplats} splats loaded · ${stats.activeAssetLabel}`;
        },
        onDebugLog: (text, level) => this.log(`${level ?? 'info'}: ${text}`),
      });
      await this.engine.init();
      this.engineReady = true;
      // On desktop the 3D view centres in the space right of the floating sidebar.
      new ResizeObserver(() => this.syncViewportInset()).observe(this.sidebar);
      this.mobile.addEventListener('change', () => {
        // Phones lay the sidebar's panels out on their own; never leave them inert there.
        if (this.mobile.matches) this.setSidebarHidden(false, false);
        this.syncViewportInset();
      });
      this.syncViewportInset();
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
      this.vrButton.hidden = this.arButton.hidden = true;
    }
  }

  /** Layout box, not the transformed one, so the inset is right even while the sidebar slides. */
  private syncViewportInset() {
    const covered = !this.mobile.matches && !this.sidebarHidden;
    this.engine?.setViewportInset(covered ? this.sidebar.offsetLeft + this.sidebar.offsetWidth : 0);
  }

  private setSidebarHidden(hidden: boolean, moveFocus = true) {
    if (hidden === this.sidebarHidden) return;
    this.sidebarHidden = hidden;
    this.root.dataset.sidebar = hidden ? 'hidden' : 'shown';
    this.sidebar.inert = hidden;
    this.sidebarHide.setAttribute('aria-expanded', String(!hidden));
    this.sidebarShow.setAttribute('aria-expanded', String(!hidden));
    this.sidebarShow.hidden = !hidden;
    if (moveFocus) (hidden ? this.sidebarShow : this.sidebarHide).focus({ preventScroll: true });
    this.syncViewportInset();
  }

  private setMenuOpen(open: boolean) {
    if (open) this.liveDock.setOpen(false);
    this.moreMenu.hidden = !open;
    this.moreButton.setAttribute('aria-expanded', String(open));
    if (open) this.visibleMenuItems()[0]?.focus();
  }

  private visibleMenuItems() {
    return Array.from(this.moreMenu.querySelectorAll('button')).filter((item) => item.offsetWidth > 0);
  }

  private findStop(id: string) { return this.stops.find((stop) => stop.stop_id === id); }

  /** Live data is the normal case and says nothing; a degraded source is announced once, as a toast, when it starts. */
  private renderStatus() {
    const text = this.catalogState === 'offline' ? 'Showing the offline catalog. Live prices and trains are unavailable.'
      : this.vehicleSource === 'simulated' ? 'Live train positions are unavailable. Showing simulated trains.'
        : this.vehicleSource === 'unavailable' ? 'Train positions are unavailable right now.' : undefined;
    if (text && text !== this.serviceNotice) this.notify(text);
    this.serviceNotice = text;
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
    const nodes = (Object.keys(sceneTitles) as SceneMode[]).map((mode, index) => {
      const label = names[index];
      const available = mode === 'map' || (mode === 'station' && this.stop) || (mode === 'venue' && this.place) || (mode === 'dish' && this.dish);
      const node = available ? button(label, () => this.navigate(mode), 'crumb') : element('span', 'crumb unavailable', label);
      if (mode === this.mode) node.setAttribute('aria-current', 'page');
      return node;
    });
    this.breadcrumbs.replaceChildren(...nodes);
    const atMap = this.mode === 'map';
    this.sidebarBrand.hidden = !atMap;
    this.sidebarBack.hidden = atMap;
    this.sidebarHome.hidden = atMap || this.mode === 'station';
    if (!atMap) {
      const parent = this.mode === 'station' ? 'Stops' : names[sceneDepth[this.mode] - 1];
      this.sidebarBackLabel.textContent = parent;
      this.sidebarBack.setAttribute('aria-label', `Back to ${parent}`);
    }
  }

  private renderStationBoard(matched: ReadonlySet<string>) {
    const counts = countPreviewsByStop(this.places, matched);
    const key = JSON.stringify([this.filters.familyVisit, this.highlightedStops, ...this.stops.map((stop) => [stop.stop_id, stop.name, stop.lines, stop.primary_color, counts.get(stop.stop_id)])]);
    if (this.stationList.dataset.summary === key) return;
    this.stationList.dataset.summary = key;
    this.stationList.replaceChildren();
    const highlighted = new Set(this.highlightedStops);
    let totalPlaces = 0;
    let totalStops = 0;
    for (const stop of this.stops) {
      const previews = counts.get(stop.stop_id);
      const count = previews?.matching ?? 0;
      if (this.filters.familyVisit && count === 0) continue;
      totalPlaces += count;
      totalStops++;
      const row = button('', () => this.showStation(stop), 'station-row');
      const name = element('strong', '', stop.name);
      const chevron = icon('chevron-right');
      chevron.classList.add('station-chevron');
      const countText = element('span', 'station-count', String(count));
      countText.append(element('span', 'station-count-unit', count === 1 ? ' place' : ' places'));
      row.append(lineDots(stop), name, countText, chevron);
      row.setAttribute('aria-label', `${stop.name}, ${count} matching ${count === 1 ? 'place' : 'places'}${describe3DCount(previews)}`);
      row.dataset.stop = stop.stop_id;
      row.dataset.highlighted = String(highlighted.has(stop.stop_id));
      // Mirror list focus on the 3D map so the two read as one control.
      for (const type of ['pointerenter', 'focus']) row.addEventListener(type, () => this.engine?.setHoveredStop(stop.stop_id));
      for (const type of ['pointerleave', 'blur']) row.addEventListener(type, () => this.engine?.setHoveredStop(undefined));
      this.stationList.append(row);
    }
    this.stationSummary.textContent = `${totalPlaces} ${totalPlaces === 1 ? 'place' : 'places'} across ${totalStops} ${totalStops === 1 ? 'stop' : 'stops'}`;
    if (this.filters.familyVisit && !this.stationList.children.length) {
      this.stationList.append(message('No stops match the family visit filters.'));
    }
  }

  private renderPanels() {
    const previous = this.renderedMode;
    if (previous === 'map' && this.mode !== 'map') this.mapScroll = this.stationBoard.scrollTop;
    this.renderedMode = this.mode;
    this.root.dataset.filterOpen = String(this.filterOpen);
    this.root.dataset.scene = this.mode;
    this.stationBoard.hidden = this.mode !== 'map';
    this.filterBar.setCompact(!this.mobile.matches && this.mode !== 'map');
    const shown = this.isDrawerOpen() && !(this.mobile.matches && this.filterOpen);
    this.root.dataset.drawer = String(shown);
    if (shown) this.renderDrawer();
    else this.drawer.hide();
    this.drawer.expanded(this.sheetExpanded);
    this.mobileButtons.get('Explore')?.setAttribute('aria-pressed', String(!this.filterOpen && this.mode === 'map'));
    this.mobileButtons.get('Filters')?.setAttribute('aria-pressed', String(this.filterOpen));
    this.mobileButtons.get('Venue')?.setAttribute('aria-pressed', String(shown));
    if (!this.mobile.matches && previous !== this.mode) this.animatePanel(previous);
  }

  private animatePanel(previous?: SceneMode) {
    for (const animation of this.panelAnimations) animation.cancel();
    this.panelAnimations = [];
    const reduced = this.reducedMotion.matches;
    const easing = getComputedStyle(this.sidebarHead).getPropertyValue('--ease-out').trim();
    if (previous) {
      const forward = sceneDepth[this.mode] > sceneDepth[previous];
      const panel = this.mode === 'map' ? this.stationBoard : this.drawer.root;
      const from = reduced ? { opacity: 0 } : { opacity: 0, transform: `translateX(${forward ? 24 : -24}px)` };
      this.panelAnimations.push(panel.animate([from, { opacity: 1 }], { duration: reduced ? 120 : 220, easing }));
      if (!reduced) {
        const heading = this.mode === 'map' ? this.sidebarBrand : this.sidebarBackLabel;
        this.panelAnimations.push(heading.animate([{ opacity: .4 }, { opacity: 1 }], { duration: 120, easing }));
      }
    }
  }

  private isDrawerOpen() {
    return this.mode !== 'map' && (!this.mobile.matches || this.drawerOpen);
  }

  private renderDrawer(focus = false) {
    this.drawer.setComparison(this.comparedPlaces, this.comparisonLoading);
    if (!this.isDrawerOpen() || (this.mobile.matches && this.filterOpen)) return;
    if (this.mode === 'station' && this.stop) {
      this.drawer.station(this.stop, placesAt(this.filtered, this.stop, this.filters), this.filters, focus, new Set(this.highlightedPlaces));
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
    const matched = new Set(this.filtered.map((place) => place.id));
    this.filterBar.render(this.filters);
    this.renderStationBoard(matched);
    this.renderDrawer();
    if (!this.engineReady) return;
    this.engine?.setFilters(this.filters);
    this.engine?.setPlaces(this.places, matched);
    if (this.fit && this.inside) this.engine?.setWillWeFit(true, this.filters.groupSize, this.seating);
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
    if (mode === 'dish' && this.dish) void this.showDish(this.dish, this.comparison?.dish.id, this.comparison?.place.id);
  }

  private goBack() {
    if (this.mode === 'station') {
      this.showMap(true);
    } else if (this.mode === 'venue' && this.stop) {
      const previous = this.stationReturn;
      const restore = previous?.stopId === this.stop.stop_id ? previous : undefined;
      const placeId = restore?.placeId ?? this.place?.id;
      this.showStation(this.stop, Boolean(restore));
      if (placeId) this.drawer.restorePosition(restore?.scrollTop, `[data-place="${CSS.escape(placeId)}"]`);
    } else if (this.mode === 'dish' && this.place) {
      const previous = this.venueReturn;
      const restore = previous?.placeId === this.place.id ? previous : undefined;
      const dishId = restore?.dishId ?? this.dish?.id;
      void this.showVenue(this.place);
      if (dishId) {
        this.drawer.restorePosition(restore?.scrollTop, `[data-dish-id="${CSS.escape(dishId)}"] .menu-preview`);
      }
    }
  }

  private showMap(back = false) {
    const restoreFocus = !this.mobile.matches && this.mode !== 'map'
      && (back || this.sidebarHead.parentElement?.contains(document.activeElement));
    if (this.mode !== 'map') this.sound.playBack();
    this.stationReturn = this.venueReturn = undefined;
    this.mode = 'map';
    this.filterOpen = false;
    this.drawerOpen = false;
    this.renderBreadcrumbs();
    this.renderPanels();
    if (back) this.stationBoard.scrollTop = this.mapScroll;
    if (restoreFocus) {
      const row = [...this.stationList.querySelectorAll<HTMLButtonElement>('.station-row')].find((entry) => entry.dataset.stop === this.stop?.stop_id);
      const heading = this.stationBoard.querySelector('h1');
      if (heading) heading.tabIndex = -1;
      (row ?? heading)?.focus({ preventScroll: true });
    }
    this.renderScene();
  }

  private showStation(stop: Stop, keepArrivals = false) {
    const changed = this.stop?.stop_id !== stop.stop_id || this.mode !== 'station';
    const arriving = this.mobile.matches && this.mode === 'map';
    this.stationReturn = this.venueReturn = undefined;
    if (changed && !keepArrivals) this.stationData = { predictions: {}, alerts: {} };
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
    this.drawerOpen = true;
    this.sheetExpanded = false;
    this.renderBreadcrumbs();
    this.renderPanels();
    this.renderDrawer(changed);
    if (changed) {
      this.sound.playSelect();
      this.sound.playPinsRise();
      void this.refreshStation(!keepArrivals);
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

  private async showVenue(place: Place, options?: { inside?: boolean }) {
    const changed = this.place?.id !== place.id;
    const cameFromDish = this.mode === 'dish';
    if (this.stop?.stop_id !== place.stop_id) this.stationReturn = undefined;
    else if (this.mode === 'station') this.stationReturn = { stopId: place.stop_id, placeId: place.id, scrollTop: this.drawer.scrollTop };
    this.venueReturn = undefined;
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
    void this.refreshTrip(changed || !cameFromDish);
    if (changed || !this.manifest.data) await this.refreshManifest();
  }

  private async refreshManifest() {
    if (!this.place) return;
    const place = this.place;
    const request = ++this.manifestRequest;
    const manifest = await this.loadManifest(place);
    if (request !== this.manifestRequest || this.place?.id !== place.id) return;
    this.manifest = manifest;
    this.renderDrawer();
    if (this.mode === 'venue' || this.mode === 'dish') this.renderScene();
  }

  private async loadManifest(place: Place): Promise<ViewData['manifest']> {
    try { return { data: await api.manifest(place.id) }; }
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
    this.inside = true;
    this.sound.playSelect();
    this.renderDrawer();
    this.renderScene();
  }

  private async showDish(dish: Dish, compareId = '', comparePlaceId?: string): Promise<boolean> {
    const request = ++this.dishRequest;
    const place = this.place;
    const mode = this.mode;
    if (!place || !isSplat(this.manifest.data?.menu_items.find((entry) => entry.dish.id === dish.id)?.dish_asset)) {
      this.notify('This dish does not have a published 3D preview.');
      return false;
    }
    let comparison: DishComparison | undefined;
    if (compareId && compareId !== dish.id) {
      const inCurrentMenu = this.manifest.data?.menu_items.some((entry) => entry.dish.id === compareId);
      const venue = comparePlaceId
        ? this.places.find((entry) => entry.id === comparePlaceId)
        : inCurrentMenu ? place : this.places.find((entry) => entry.dishes.some((item) => item.id === compareId));
      const manifest = !venue ? undefined : venue.id === place.id ? this.manifest : await this.loadManifest(venue);
      if (request !== this.dishRequest || this.place?.id !== place.id || this.mode !== mode) return false;
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
    if (this.mode === 'venue') this.venueReturn = { placeId: place.id, dishId: dish.id, scrollTop: this.drawer.scrollTop };
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
  }

  private async openRestaurantComparison(): Promise<void> {
    if (this.comparedPlaces.length < 2 || this.comparisonLoading) return;
    const pairs = this.comparedPlaces.flatMap((place) => {
      const stop = this.findStop(place.stop_id);
      return stop ? [{ place, stop }] : [];
    });
    if (pairs.length !== this.comparedPlaces.length) return;
    const filters = this.filters;
    const request = ++this.comparisonRun;
    this.comparisonLoading = true;
    this.drawer.setComparison(this.comparedPlaces, true);
    try {
      const decisions = await Promise.all(pairs.map(({ place, stop }) => loadPlaceDecision(place, stop, filters)));
      if (request !== this.comparisonRun) return;
      const controls = this.createControlSurface();
      controls.setHighlightedStops([...new Set(pairs.map(({ stop }) => stop.stop_id))]);
      controls.setHighlightedPlaces(pairs.map(({ place }) => place.id));
      this.showReviewCard(buildComparisonBriefingCard(decisions, this.findStop(filters.startStopId)?.name ?? 'your start stop'));
    } catch (error) {
      if (request === this.comparisonRun) this.notify(errorText(error));
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
    let details = placeDecision(place, stop, filters);
    let web: LiveReviewsResponse | undefined;
    let card = buildPlaceBriefingCard(details);
    this.showReviewCard(card);
    const update = () => {
      if (this.briefings.get(card.id) !== card) return;
      card = buildPlaceBriefingCard(details, web);
      this.briefings.set(card.id, card);
      this.renderReviewCards();
    };
    void loadPlaceDecision(place, stop, filters).then((fresh) => { details = fresh; update(); }).catch(() => {});
    void loadLiveReviews(place.id).then((fresh) => {
      if (fresh.live) { web = fresh; update(); }
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
    this.dismissReviewCard();
    await this.showVenue(place, { inside: true });
    if (!dishId || this.place?.id !== placeId) return;
    const dish = this.manifest.data?.menu_items.find((item) => item.dish.id === dishId && item.dish_asset)?.dish;
    if (dish) await this.showDish(dish, compareDishId, comparePlaceId);
    else this.notify('This dish does not have a published 3D preview.');
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
          const otherDish = comparison ? { ...comparison.dish, asset: comparison.asset } : null;
          await engine.openDish(place, dish, otherDish, manifest, comparison?.place.name);
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
    labelAndIcon(this.audioButton, 'Sound', this.muted ? 'sound-off' : 'sound');
    this.audioButton.setAttribute('aria-checked', String(!this.muted));
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
        muted: this.muted,
        drawerOpen: this.isDrawerOpen(),
        sheetExpanded: this.sheetExpanded,
        filterOpen: this.filterOpen,
        xrMode: this.xrMode,
        manifest: this.manifest.data,
        trip: this.trip.data,
        highlightedStops: [...this.highlightedStops],
        highlightedPlaces: [...this.highlightedPlaces],
        highlightedDishId: this.highlightedDishId,
        briefings: [...this.briefings.values()].map(({ id, title }) => ({ id, title })),
      }),
      showMap: () => this.showMap(),
      showStation: (stop) => this.showStation(stop),
      showVenue: (place, options) => this.showVenue(place, options),
      showDish: (dish, compareId, comparePlaceId) => this.showDish(dish, compareId, comparePlaceId),
      updateFilters: (patch) => this.updateFilters(patch),
      setHighlightedStops: (stopIds, pulse = true) => {
        this.highlightedStops = [...stopIds];
        this.renderStationBoard(new Set(this.filtered.map((p) => p.id)));
        this.engine?.setHighlightedStops(this.highlightedStops, pulse);
      },
      setHighlightedPlaces: (placeIds) => {
        this.highlightedPlaces = [...placeIds];
        this.engine?.setHighlightedPlaces(this.highlightedPlaces);
        this.renderDrawer();
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
      setDishRotation: (degrees) => {
        this.rotation = degrees;
        this.engine?.setDishRotation(degrees * Math.PI / 180);
        this.renderDrawer();
      },
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
        if (enabled === this.muted) this.toggleAudio();
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
      controlXR: async (action) => {
        if (action === 'exit_xr') {
          this.engine?.exitXR();
          return 'Exited XR session';
        }
        try {
          await this.launchXR(action === 'enter_vr' ? 'vr' : 'ar');
          return action === 'enter_vr' ? 'Launched VR' : 'Launched AR table';
        } catch (error) {
          return `XR requires a direct button tap in the browser (${errorText(error)})`;
        }
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
