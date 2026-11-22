import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeTripEstimate, demoPlaces, LIVE_APP_TOOLS, STOPS, type Dish, type Place, type RestaurantManifest,
} from '@faresight/shared';
import { api, type Alert } from '../src/api/client.ts';
import { offlineCatalog, offlineManifest } from '../src/data/fallbackData.ts';
import { LiveController, type AppControlSurface } from '../src/live/LiveController.ts';
import { initialFilters, matchingPlaces } from '../src/ui/state.ts';
import { validToolValue, type RealtimeToolName } from '../src/voice/tools.ts';

const bu = 'place-bucen';
const kenmore = 'place-kencl';
const harvard = 'place-harsq';
const starbucks = 'bu-starbucks-01';
const jefes = 'kenmore-jefes-01';
const cafe = 'harvard-cafe-01';
const latte = 'bu-starbucks-macchiato';
const burrito = 'kenmore-jefes-burrito';
const tiramisu = 'harvard-matcha-tiramisu';
const fridayNight = new Date('2026-07-11T02:30:00Z');

type State = ReturnType<AppControlSurface['getState']>;
type SimulatorLog = {
  focusMenu?: string;
  camera?: string | [number, number, number?];
  pulse?: boolean;
  modal?: string;
  sent?: string;
  xr?: string;
  notes: string[];
};

function harness(places = structuredClone(offlineCatalog.places), manifests: Record<string, RestaurantManifest> = {}) {
  const state: State = {
    mode: 'map', places, stops: STOPS, filtered: matchingPlaces(places, initialFilters), filters: { ...initialFilters },
    compareId: '', inside: false, fit: false, seating: 'seated', rotation: 0, virtualTable: true,
    muted: true, drawerOpen: false, sheetExpanded: false, filterOpen: false, xrMode: 'none',
    highlightedStops: [], highlightedPlaces: [], briefings: [], comparedPlaces: [],
  };
  const log: SimulatorLog = { notes: [] };
  const cards: Parameters<AppControlSurface['showReviewCard']>[0][] = [];
  const app: AppControlSurface = {
    getState: () => state,
    showMap: () => { state.mode = 'map'; },
    showStation: (stop) => {
      Object.assign(state, { mode: 'station', stop, place: undefined, dish: undefined, manifest: undefined, compareId: '' });
    },
    showVenue: async (place, options) => {
      assert.ok(options?.current?.() ?? true);
      Object.assign(state, {
        mode: 'venue', place, stop: STOPS.find(({ stop_id }) => stop_id === place.stop_id),
        inside: options?.inside ?? true, drawerOpen: true, compareId: '', dish: undefined,
        manifest: structuredClone(manifests[place.id] ?? offlineManifest(place)),
      });
    },
    showDish: async (dish, compareId = '', comparePlaceId, current) => {
      assert.ok(current?.() ?? true);
      Object.assign(state, { mode: 'dish', dish, compareId, comparePlaceId });
      return true;
    },
    updateFilters: (patch) => {
      state.filters = { ...state.filters, ...patch };
      state.filtered = matchingPlaces(places, state.filters);
    },
    setHighlightedStops: (ids, pulse) => { state.highlightedStops = ids; log.pulse = pulse; },
    setHighlightedPlaces: (ids) => { state.highlightedPlaces = ids; },
    setHighlightedDish: (id) => { state.highlightedDishId = id; },
    clearHighlights: () => {
      state.highlightedStops = [];
      state.highlightedPlaces = [];
      state.highlightedDishId = undefined;
    },
    focusMenu: (id) => { log.focusMenu = id ?? 'menu'; },
    setFit: async (enabled, seating) => { state.fit = enabled; state.seating = seating; },
    setComparedPlaces: (entries) => { state.comparedPlaces = entries; },
    openRestaurantComparison: async (current) => {
      assert.ok(current?.() ?? true);
      state.briefings.push({ id: 'restaurant-comparison', title: 'Compare venues' });
      return true;
    },
    locateNearestStop: async () => {
      const stop = STOPS[1];
      state.filters.startStopId = stop.stop_id;
      state.origin = { lat: stop.lat, lon: stop.lon };
      return { ok: true, stop, message: 'Starting from your nearest stop.' };
    },
    applyLiveMenuPrices: (placeId, prices) => {
      const dishes = places.find(({ id }) => id === placeId)?.dishes ?? [];
      const active = state.manifest?.restaurant.id === placeId ? state.manifest.menu_items.map(({ dish }) => dish) : [];
      for (const dish of [...dishes, ...active]) {
        dish.price ??= prices.find(({ dish_id }) => dish_id === dish.id)?.price ?? null;
      }
    },
    showReviewCard: (card) => { cards.push(card); state.briefings.push({ id: card.id, title: card.title }); },
    dismissReviewCard: (cardId) => { state.briefings = cardId ? state.briefings.filter(({ id }) => id !== cardId) : []; },
    setDishRotation: (value) => { state.rotation = value; },
    setTableMode: (value) => { state.virtualTable = value; },
    orbitCamera: (...args) => { log.camera = args; },
    focusMapStopCamera: (id) => { log.camera = id; },
    resetCamera: () => { log.camera = 'reset'; },
    setDrawerState: (action) => {
      if (action === 'expand' || action === 'collapse') state.sheetExpanded = action === 'expand';
      if (action !== 'collapse') state.drawerOpen = action !== 'close';
    },
    setFilterOpen: (open) => { state.filterOpen = open; },
    setAudioSfx: (on) => { state.muted = !on; },
    openModal: (modal) => { log.modal = modal; },
    sendToPairedDevice: (kind) => { log.sent = kind; return true; },
    controlXR: async (action) => { log.xr = action; return { ok: true, message: 'Exited XR' }; },
    announce: (note) => { log.notes.push(note); },
  };
  const controller = new LiveController(app);
  const call = (name: RealtimeToolName, args: Record<string, unknown> = {}, current?: () => boolean) =>
    controller.executeRealtime(name, args, current);
  return { app, state, call, controller, log, cards };
}

const schemas = {
  list_places: [{ stopId: bu, maxBudget: 12, query: 'coffee', openNow: true, groupSize: 2 }, { groupSize: 0 }],
  recommend_places: [{ line: 'Green-C', openAt: { day: 'fri', time: '22:30' }, stopIds: [kenmore], limit: 12 }, { openAt: { day: 'fri', time: '25:00' } }],
  search_dishes: [{ maxPrice: 10, sortBy: '3d_first' }, { limit: 16 }],
  get_station_overview: [{}, { fromStopId: 'park-street' }],
  set_filters: [{ reset: true, familyVisit: false }, { reset: 'yes' }],
  highlight_map_stops: [{ stopIds: [], returnToMap: false }, {}],
  focus_stop: [{ stopId: harvard, highlightPlaceIds: [] }, { stopId: 'Harvard' }],
  highlight_station_places: [{ placeIds: [] }, { placeIds: [4] }],
  open_venue: [{ placeId: jefes, stepInside: false }, { placeId: jefes, highlightDishId: null }],
  show_menu: [{}, { placeId: null }],
  open_dish: [{ placeId: jefes, dishId: burrito, rotationDeg: 360, tableMode: 'virtual', clearComparison: true }, { dishId: burrito }],
  rotate_dish: [{ deltaDegrees: -360 }, { degrees: -1 }],
  navigate_scene: [{ scene: 'dish' }, { scene: 'room' }],
  get_next_trains: [{ stopId: bu }, {}],
  get_transit_info: [{ fromStopId: bu, toPlaceId: jefes, includeVehicles: true }, { includeVehicles: 1 }],
  set_will_we_fit: [{ enabled: true, seating: 'standing', placeId: jefes }, { seating: 'standing' }],
  get_place_details: [{ placeId: jefes }, { placeId: 1 }],
  get_live_reviews: [{ placeId: jefes }, {}],
  get_live_menu_prices: [{ placeId: jefes }, {}],
  compare_places: [{ placeIds: [jefes, cafe], highlight: true, syncTray: true }, { placeIds: [jefes, jefes] }],
  manage_comparison_tray: [{ action: 'set', placeIds: [jefes, cafe] }, { action: 'replace' }],
  show_review_card: [{
    title: 'Dinner', sections: [{ type: 'text', body: 'Dinner near Kenmore' }],
    dishActions: [{ placeId: jefes, dishId: burrito }],
    compareDishAction: { placeId: jefes, dishId: burrito, comparePlaceId: cafe, compareDishId: tiramisu },
  }, { title: 'Dinner', sections: [{ type: 'text', body: 'Dinner' }], dishActions: [{ dishId: burrito }] }],
  dismiss_review_card: [{}, { cardId: null }],
  get_current_view: [{}, { detail: true }],
  control_camera: [{ action: 'orbit', yawDeltaDeg: -180, pitchDeltaDeg: 90, zoomFactor: 4 }, { action: 'zoom', zoomFactor: 0 }],
  control_ui: [{ xrAction: 'exit_xr', locateNearestStop: true }, { xrAction: 'enter_ar' }],
  submit_visit_note: [{ placeId: jefes, authorLabel: 'Pat', text: 'Good tacos', rating: 5 }, { placeId: jefes, authorLabel: 'Pat', text: 'Good tacos', rating: 0 }],
} satisfies Record<RealtimeToolName, unknown[]>;

test('all 27 Realtime schemas validate required fields, types and constraints', () => {
  assert.equal(LIVE_APP_TOOLS.length, 27);
  assert.equal(new Set(LIVE_APP_TOOLS.map(({ name }) => name)).size, 27);
  for (const tool of LIVE_APP_TOOLS) {
    const [valid, invalid] = schemas[tool.name];
    assert.ok(validToolValue(valid, tool.parameters), tool.name);
    assert.equal(validToolValue(invalid, tool.parameters), false, tool.name);
    assert.equal(validToolValue({ ...valid, unknown: 1 }, tool.parameters), false, tool.name);
    assert.equal('strict' in tool, Object.keys(tool.parameters.properties).length > tool.parameters.required.length, tool.name);
    if ('strict' in tool) assert.equal(tool.strict, false);
  }
  const recommendation = LIVE_APP_TOOLS.find(({ name }) => name === 'recommend_places')!;
  for (const openAt of [{ day: 'x', time: '22:30' }, { day: 'fri' }, { day: 'fri', time: '22:60' }, { day: 'fri', time: '2:30' }]) {
    assert.equal(validToolValue({ openAt }, recommendation.parameters), false);
  }
});

function recommendationFixture() {
  const base = structuredClone(offlineCatalog.places.find(({ id }) => id === jefes)!);
  const late: Place = {
    ...base, id: 'late', name: 'Night Noodles', category: 'restaurant', cravings: ['ramen'], walk_from_stop_m: 110,
    evening_venue: true, family_friendly: false, stated_capacity: 4, typical_price: 18,
    hours: { fri: ['18:00', '02:00'] },
    dishes: [{ ...base.dishes[0], id: 'hand-pulled', place_id: 'late', name: 'Hand-pulled noodles', price: 12, portion_note: 'Serves two', plate_diameter_m: 0.24 }],
    details: { ...base.details!, review_highlights: ['Quiet booths'], awards: [{ title: 'Noodle Prize', org: 'Local Guide', year: 2025, url: null }],
      ratings: [{ source: 'Local Guide', rating: 4.8, count: 10, url: null }] },
  };
  const room: Place = {
    ...base, id: 'room', name: 'Study Rooms', stop_id: bu, category: 'study', cravings: ['study'], typical_price: 25,
    walk_from_stop_m: 250, stated_capacity: undefined, dishes: [], room_asset_id: null, evening_venue: false, family_friendly: true,
    hours: { fri: ['10:00', '20:00'] },
    rooms: [{ id: 'study-room', place_id: 'room', name: 'Study room', room_type: 'study', stated_capacity: 8, floor_width_m: 3,
      floor_depth_m: 2, seating: 'seated', price: 48, price_unit: 'per hour' }],
    details: { ...base.details!, ratings: [], awards: [], review_highlights: [] },
  };
  const early: Place = {
    ...late, id: 'early', name: 'Noodles and Tea', stop_id: harvard, walk_from_stop_m: 60, typical_price: 10, rooms: [],
    room_asset_id: null, stated_capacity: 20, hours: { fri: ['10:00', '18:00'] },
    dishes: [
      { ...late.dishes[0], id: 'early-ramen', place_id: 'early', name: 'Tea ramen', price: 8, asset_id: null, asset: null },
      { ...late.dishes[0], id: 'tea', place_id: 'early', name: 'Tea flight', price: null, asset_id: null, asset: null },
    ],
    details: { ...late.details!, awards: [], ratings: [{ source: 'Local Guide', rating: 4.3, count: null, url: null }] },
  };
  return [late, room, early];
}

const routeAlert: Alert = { id: 'green', header: 'Green Line B delays', route_ids: ['Green-B'], stop_ids: [], severity: 5 };
const stopAlert: Alert = { id: 'kenmore', header: 'Kenmore access', route_ids: [], stop_ids: [kenmore], severity: 3 };
const systemAlert: Alert = { id: 'all', header: 'System notice', route_ids: [], stop_ids: [], severity: 1 };

test('recommendations combine keywords, local travel, hours, budget, capacity, ratings, awards and route alerts', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: fridayNight });
  const alerts = t.mock.method(api, 'alerts', async () => [routeAlert, stopAlert, systemAlert]);
  const trip = t.mock.method(api, 'trip', async () => { throw new Error('Recommendations must use the local estimator'); });
  const { call } = harness(recommendationFixture());
  const response = await call('recommend_places', {
    query: 'hand-pulled', fromStopId: bu, line: 'Green-B', category: 'restaurant', craving: 'ramen',
    maxBudget: 20.4, maxTotalMinutes: 13, maxWalkMeters: 110, groupSize: 5,
    openNow: true, openAt: { day: 'sat', time: '01:59' }, eveningOnly: true, familyFriendly: false,
    has3DRoom: true, has3DDish: true, only3D: true, minRating: 4.8, hasAwards: true,
  });
  const places = response.result.places as Record<string, any>[];
  assert.equal(response.result.ok, true);
  assert.equal(alerts.mock.callCount(), 1);
  assert.equal(trip.mock.callCount(), 0);
  assert.deepEqual(places.map(({ id }) => id), ['late']);
  const [option] = places;
  assert.equal(option.oneWayTotal, 20.4);
  assert.equal(option.roundTripTotal, 22.8);
  assert.equal(option.directLine, true);
  assert.equal(option.transferMinutes, 0);
  assert.equal(option.fitsGroup, false);
  assert.equal(option.statedCapacity, 4);
  assert.equal(option.totalMinutes, computeTripEstimate({ from_stop_id: bu, to_stop_id: kenmore, walk_from_stop_m: 110 }).total_min);
  assert.deepEqual(option.openAt, { day: 'sat', time: '01:59', open: true });
  assert.deepEqual(option.activeAlerts.map(({ id }) => id), ['green', 'kenmore']);
  assert.equal(option.matchingDishes[0].name, 'Hand-pulled noodles');
  assert.ok(option.matchReasons.includes('Direct train'));

  for (const filters of [
    { maxBudget: 20.39 }, { maxTotalMinutes: 11 }, { maxWalkMeters: 109 }, { line: 'Orange' },
    { minRating: 4.9 }, { hasAwards: false }, { excludePlaceIds: ['late'] },
    { openAt: { day: 'sat', time: '02:00' } }, { stopIds: [harvard] },
  ]) {
    const { result } = await call('recommend_places', { query: 'Quiet booths Noodle Prize', includeAlerts: false, ...filters });
    assert.equal(result.count, 0, JSON.stringify(filters));
  }
  const byAward = await call('recommend_places', { query: 'noodle prize', includeAlerts: false });
  assert.equal((byAward.result.places as Place[])[0]?.id, 'late');
  const open = await call('recommend_places', { openNow: true, includeAlerts: false });
  assert.deepEqual((open.result.places as Place[]).map(({ id }) => id), ['late']);
  const rental = await call('recommend_places', { craving: 'study', groupSize: 4, maxBudget: 12, includeAlerts: false });
  const [study] = rental.result.places as Record<string, unknown>[];
  assert.equal(study.oneWayTotal, 12);
  assert.equal(study.roomCapacity, 8);
  assert.equal(study.fitsGroup, true);
  assert.equal(alerts.mock.callCount(), 1);
});

test('recommendations sort deterministically and retain a count across all 58 places', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: fridayNight });
  const { call } = harness(recommendationFixture());
  const expected = {
    best_match: 'late', fastest: 'room', cheapest: 'early', highest_rated: 'late', closest_walk: 'early', most_3d: 'late',
  };
  for (const [sortBy, top] of Object.entries(expected)) {
    const query = sortBy === 'best_match' ? { query: 'noodles' } : {};
    const { result } = await call('recommend_places', { sortBy, ...query, includeAlerts: false, limit: 1 });
    assert.deepEqual((result.places as Place[]).map(({ id }) => id), [top], sortBy);
    assert.equal(result.count, sortBy === 'best_match' ? 2 : 3);
  }
  const group = await call('recommend_places', { query: 'noodles', groupSize: 8, includeAlerts: false, limit: 1 });
  assert.equal((group.result.places as Place[])[0]?.id, 'early');
  const catalog = harness();
  catalog.state.filters.maxBudget = 1;
  const full = await catalog.call('recommend_places', { includeAlerts: false });
  assert.equal(full.result.count, demoPlaces.length);
  assert.equal(full.result.count, 58);
  assert.equal((full.result.places as Place[]).length, 6);

  const narrow = await call('list_places', { query: 'noodles', openNow: true, has3DRoom: true, has3DDish: true,
    only3D: true, eveningOnly: true, familyFriendly: false, groupSize: 5, maxBudget: 30 });
  assert.deepEqual((narrow.result.places as Place[]).map(({ id }) => id), ['late']);
});

test('dish search handles names, portion notes, limits, missing prices and all sorting modes', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: fridayNight });
  const { call } = harness(recommendationFixture());
  for (const [sortBy, top] of Object.entries({ best_match: 'early-ramen', fastest: 'hand-pulled', cheapest: 'early-ramen', '3d_first': 'hand-pulled' })) {
    const query = sortBy === 'best_match' ? 'Tea' : 'Serves two';
    const { result } = await call('search_dishes', { query, sortBy, limit: 1 });
    assert.equal((result.dishes as Record<string, unknown>[])[0]?.dishId, top);
  }
  const open = await call('search_dishes', { query: 'hand pulled', maxPrice: 12, maxOneWayTotal: 14.4, only3D: true, openNow: true });
  const [dish] = open.result.dishes as Record<string, unknown>[];
  assert.equal(dish.dishId, 'hand-pulled');
  assert.equal(dish.oneWayDishPlusFare, 14.4);
  assert.equal(dish.plateDiameterCm, 24);
  assert.equal(dish.has3D, true);
  assert.equal((await call('search_dishes', { maxOneWayTotal: 14.39, only3D: true })).result.count, 0);
  const cheap = await call('search_dishes', { placeId: 'early', maxPrice: 10, sortBy: 'cheapest' });
  assert.deepEqual((cheap.result.dishes as Record<string, unknown>[]).map(({ dishId }) => dishId), ['early-ramen']);
  assert.equal((await call('search_dishes', { placeId: 'missing' })).result.ok, false);
});

test('station overview summarizes all stations or just the selected stop with local counts and one alert lookup', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: fridayNight });
  const alerts = t.mock.method(api, 'alerts', async () => [routeAlert, stopAlert, systemAlert]);
  const { call } = harness(recommendationFixture());
  const all = await call('get_station_overview', { fromStopId: bu, craving: 'ramen', maxBudget: 25 });
  const stations = all.result.stations as Record<string, any>[];
  assert.equal(stations.length, 10);
  assert.equal(stations.find(({ stopId }) => stopId === harvard)?.directLine, false);
  assert.equal(stations.find(({ stopId }) => stopId === kenmore)?.directLine, true);
  const one = await call('get_station_overview', { stopId: kenmore, openNow: true, includeAlerts: false });
  const [station] = one.result.stations as Record<string, any>[];
  assert.equal((one.result.stations as unknown[]).length, 1);
  assert.equal(station.stopId, kenmore);
  assert.equal(station.matchingPlaces, 1);
  assert.equal(station.openNowCount, 1);
  assert.equal(station.minOneWayCost, 20.4);
  assert.equal(station.avgOneWayCost, 20.4);
  assert.equal(station.placesWith3DRoom, 1);
  assert.equal(station.placesWith3DDish, 1);
  assert.deepEqual(station.categories, { restaurant: 1 });
  assert.equal(station.topRated[0].id, 'late');
  assert.equal(alerts.mock.callCount(), 1);
});

test('transit tools combine timed arrivals, scoped alerts, GPS trip, last train and vehicle source', async (t) => {
  const fixtures = [
    { route_id: 'Green-B', status: null, arrival_min: 7, direction: 'Westbound' },
    { route_id: 'Green-B', status: null, arrival_min: null },
    { route_id: 'Green-C', status: null, arrival_min: 2, direction: 'Eastbound' },
  ];
  const predictions = t.mock.method(api, 'predictions', async () => ({ predictions: fixtures, source: 'live' }));
  const alerts = t.mock.method(api, 'alerts', async () => [routeAlert, stopAlert, systemAlert]);
  const last = '2026-07-11T05:05:00Z';
  const trip = t.mock.method(api, 'trip', async (from: string, place: Place, origin: { lat: number; lon: number }) => ({
    ...computeTripEstimate({ from_stop_id: from, to_stop_id: place.stop_id, origin, walk_from_stop_m: place.walk_from_stop_m, wait_min: 3 }),
    last_train_time: last, prediction_source: 'live', schedule_source: 'live',
  }));
  const vehicles = t.mock.method(api, 'vehicles', async () => ({
    vehicles: [{ route_id: 'Green-B' }, { route_id: 'Green-B' }, { route_id: 'Red' }], source: 'live', updated_at: last,
  }));
  const { call, state } = harness();
  state.origin = { lat: 42.35, lon: -71.109 };
  const { result } = await call('get_transit_info', { toPlaceId: jefes, includeSystemAlerts: true, includeVehicles: true });
  assert.equal(result.ok, true);
  assert.deepEqual(predictions.mock.calls[0].arguments, [kenmore]);
  assert.equal(alerts.mock.callCount(), 1);
  assert.deepEqual(trip.mock.calls[0].arguments, [bu, state.places.find(({ id }) => id === jefes), state.origin]);
  assert.deepEqual((result.next_trains as { arrival_min: number }[]).map(({ arrival_min }) => arrival_min), [2, 7]);
  assert.deepEqual(result.alerts, [routeAlert.header, stopAlert.header]);
  assert.deepEqual(result.systemAlerts, [systemAlert]);
  const details = result.trip as Record<string, unknown>;
  assert.equal(details.lastTrainTime, last);
  assert.equal(details.waitMinutes, 3);
  assert.equal(details.rideMinutes, 4);
  assert.equal(details.transferMinutes, 0);
  assert.ok(Number(details.walkToStationMinutes) > 0);
  assert.equal(details.oneWayFare, 2.4);
  assert.equal(details.roundTripFare, 4.8);
  assert.match(String(details.plannerUrl), /^https:\/\/www.mbta.com\/trip-planner\?/);
  const fleet = result.vehicles as { byRoute: Record<string, number>; source: string; total: number };
  assert.equal(fleet.source, 'live');
  assert.equal(fleet.byRoute['Green-B'], 2);
  assert.equal(fleet.total, 3);
  assert.equal(vehicles.mock.callCount(), 1);

  const stopOnly = await call('get_transit_info', { stopId: bu });
  assert.equal(stopOnly.result.trip, null);
  assert.equal(stopOnly.result.systemAlerts, undefined);
  assert.equal(vehicles.mock.callCount(), 1);

  const arrivals = await call('get_next_trains', { stopId: kenmore });
  assert.equal(arrivals.result.source, 'live');
  assert.deepEqual((arrivals.result.arrivals as { arrival_min: number }[]).map(({ arrival_min }) => arrival_min), [2, 7]);

  trip.mock.mockImplementation(async () => { throw new Error('Offline'); });
  const offline = await call('get_transit_info', { toPlaceId: cafe });
  const fallback = offline.result.trip as Record<string, unknown>;
  assert.equal(fallback.predictionSource, 'estimate');
  assert.equal(fallback.lastTrainTime, null);
  assert.ok(Number(fallback.transferMinutes) > 0);
});

test('venue details add contacts, live trip breakdown and measured floor dimensions', async (t) => {
  const manifest = structuredClone(offlineManifest(offlineCatalog.places.find(({ id }) => id === jefes)!)!);
  const place = structuredClone(offlineCatalog.places.find(({ id }) => id === jefes)!);
  const roomAsset = { ...manifest.room_asset!, scale_status: 'measured' as const };
  place.rooms = [{ id: 'room', place_id: jefes, name: 'Side room', room_type: 'dining', stated_capacity: 14,
    floor_width_m: 3, floor_depth_m: 3, seating: 'seated', price: 0, price_unit: 'per visit', asset: roomAsset }];
  t.mock.method(api, 'place', async () => place);
  t.mock.method(api, 'predictions', async () => ({ predictions: [], source: 'live' }));
  t.mock.method(api, 'alerts', async () => []);
  t.mock.method(api, 'trip', async () => ({
    ...computeTripEstimate({ from_stop_id: bu, to_stop_id: kenmore, wait_min: 2 }), last_train_time: '2026-07-11T05:30:00Z',
  }));
  const { result } = await harness([place]).call('get_place_details', { placeId: jefes });
  const details = result.details as Record<string, any>;
  assert.equal(details.address, place.details?.address ?? null);
  assert.equal(details.phone, place.details?.phone ?? null);
  assert.equal(details.website, place.details?.website ?? null);
  assert.equal(details.hoursNote, place.details?.hours_note ?? null);
  assert.equal(details.lastTrainTime, '2026-07-11T05:30:00Z');
  assert.equal(details.trip.waitMinutes, 2);
  assert.equal(details.trip.totalMinutes, 6);
  assert.equal(details.trip.transferMinutes, 0);
  assert.match(details.trip.plannerUrl, /mbta\.com/);
  assert.equal(details.rooms[0].floorWidthM, 3);
  assert.equal(details.rooms[0].floorDepthM, 3);
  assert.equal(details.rooms[0].measured, true);
});

test('live price lookup applies updates for the selected venue and preserves sources', async (t) => {
  const { call, app, state } = harness();
  await call('open_venue', { placeId: starbucks });
  const dish = state.place!.dishes.find(({ id }) => id === latte)!;
  dish.price = null;
  const available = state.manifest!.menu_items.find(({ dish }) => dish.id === latte)!.dish;
  available.price = null;
  const apply = t.mock.method(app, 'applyLiveMenuPrices');
  const fetched_at = '2026-07-11T05:30:00Z';
  const prices = [{ dish_id: latte, price: 6.25, source: 'Menu', url: 'https://example.com/menu' }];
  const unpriced = [{ dish_id: 'unknown-price', reason: 'Not listed' }];
  t.mock.method(api, 'liveMenuPrices', async () => ({ live: true, fetched_at, prices, unpriced }));
  const { result, actionLabel } = await call('get_live_menu_prices', { placeId: starbucks });
  assert.equal(result.live, true);
  assert.equal(result.fetched_at, fetched_at);
  assert.equal(apply.mock.callCount(), 1);
  assert.equal(dish.price, 6.25);
  assert.equal(available.price, 6.25);
  assert.deepEqual(result.prices, [{ ...prices[0], dish_name: dish.name, price_label: '$6.25' }]);
  assert.deepEqual(result.unpriced, unpriced);
  assert.match(actionLabel!, /menu prices/);
});

test('existing live review lookup supplies attributed excerpts for a briefing', async (t) => {
  const { call, cards } = harness();
  const review = { id: 'live-review', author: 'Sam', source: 'Local Guide', text: 'The booths were quiet.', url: 'https://example.com/review' };
  t.mock.method(api, 'liveReviews', async () => ({ place_id: jefes, live: true, fetched_at: '2026-07-11T05:30:00Z',
    ratings: [], highlights: ['Quiet booths'], reviews: [review] }));
  assert.equal((await call('get_live_reviews', { placeId: jefes })).result.live, true);
  const { result } = await call('show_review_card', { title: 'What diners say',
    sections: [{ type: 'reviews', items: [{ placeId: jefes, reviewId: review.id }] }] });
  assert.equal(result.ok, true);
  const [section] = cards[0].sections;
  assert.equal(section.kind, 'reviews');
  if (section.kind !== 'reviews') throw new Error('Expected an attributed review section');
  assert.equal(section.items[0].author, 'Sam');
  assert.equal(section.items[0].url, review.url);
  assert.equal(section.items[0].live, true);
});

test('navigation, highlights and camera use the existing map and station controls', async () => {
  const { call, controller, state, log } = harness();
  assert.equal((await call('focus_stop', { stopId: kenmore, highlightPlaceIds: [jefes] })).result.ok, true);
  assert.deepEqual(state.highlightedPlaces, [jefes]);
  await call('highlight_map_stops', { stopIds: [bu], focusCamera: true, note: 'Meet here' });
  assert.equal(state.mode, 'map');
  assert.deepEqual(state.highlightedStops, [bu]);
  assert.equal(log.pulse, true);
  assert.equal(log.camera, bu);
  assert.deepEqual(log.notes, ['Meet here']);
  await call('highlight_station_places', { placeIds: [cafe], note: 'Look here' });
  assert.equal(state.mode, 'station');
  assert.equal(state.stop?.stop_id, harvard);
  assert.deepEqual(state.highlightedPlaces, [cafe]);
  await call('highlight_map_stops', { stopIds: [kenmore], returnToMap: false, pulse: false });
  assert.equal(state.mode, 'station');
  assert.equal(log.pulse, false);
  await call('highlight_map_stops', { stopIds: [] });
  await call('highlight_station_places', { placeIds: [] });
  assert.deepEqual(state.highlightedStops, []);
  assert.deepEqual(state.highlightedPlaces, []);
  assert.equal((await call('highlight_station_places', { placeIds: [cafe, jefes] })).result.ok, false);
  await call('control_camera', { action: 'orbit', yawDeltaDeg: -50, pitchDeltaDeg: 30, zoomFactor: 1.25 });
  assert.deepEqual(log.camera, [-50, 30, 1.25]);
  await call('control_camera', { action: 'zoom', zoomFactor: 0.5 });
  assert.deepEqual(log.camera, [0, 0, 0.5]);
  await call('control_camera', { action: 'reset' });
  assert.equal(log.camera, 'reset');
  await call('control_camera', { action: 'focus_stop', stopId: kenmore });
  assert.equal(state.mode, 'map');
  assert.equal(log.camera, kenmore);
  assert.equal((await call('navigate_scene', { scene: 'station' })).result.scene, 'station');
  for (const [alias, id] of [['Faneuil Hall', 'place-haecl'], ['Newbury', 'place-coecl'], ['Long Wharf', 'place-aqucl'],
    ['MIT', 'place-cntsq'], ['Brookline', 'place-cool']]) {
    assert.equal((await controller.execute('open_station', { stop: alias })).result.ok, true);
    assert.equal(state.stop?.stop_id, id);
  }
});

test('venue, menu and dish tools support highlights, cross-venue comparison, rotation and table mode', async () => {
  const { call, state, log } = harness();
  const venue = await call('open_venue', { placeId: jefes, stepInside: false, highlightDishId: burrito });
  assert.equal(venue.result.ok, true);
  assert.equal(state.inside, false);
  assert.equal(log.focusMenu, burrito);
  const menu = await call('show_menu', { placeId: cafe, highlightDishId: tiramisu });
  assert.equal(state.place?.id, cafe);
  assert.equal(state.drawerOpen, true);
  assert.equal(state.highlightedDishId, tiramisu);
  assert.equal(log.focusMenu, tiramisu);
  const [item] = menu.result.menu_items as Record<string, unknown>[];
  assert.equal(item.id, tiramisu);
  assert.equal(item.has_3d_preview, true);
  assert.ok(item.portion_note);
  assert.ok(item.plate_diameter_cm);
  assert.equal((await call('show_menu')).result.ok, true);
  assert.equal((await call('show_menu', { highlightDishId: burrito })).result.ok, false);

  const open = await call('open_dish', { placeId: jefes, dishId: burrito, compareDishId: latte, comparePlaceId: starbucks,
    rotationDeg: 123, tableMode: 'passthrough' });
  assert.equal(open.result.ok, true);
  assert.equal(state.dish?.id, burrito);
  assert.equal(state.compareId, latte);
  assert.equal(state.comparePlaceId, starbucks);
  assert.equal(state.rotation, 123);
  assert.equal(state.virtualTable, false);
  await call('rotate_dish', { deltaDegrees: -130 });
  assert.equal(state.rotation, 353);
  await call('rotate_dish', { degrees: 360 });
  assert.equal(state.rotation, 0);
  const cleared = await call('open_dish', { placeId: jefes, clearComparison: true });
  assert.equal(cleared.result.ok, true);
  assert.equal(state.dish?.id, burrito);
  assert.equal(state.compareId, '');
  assert.equal(cleared.result.comparing_with, null);
  await call('show_menu', { highlightDishId: burrito });
  assert.equal(state.mode, 'venue');
  assert.equal(log.focusMenu, burrito);
});

test('group fit can open a measured room and reset filters before applying overrides', async () => {
  const manifest = structuredClone(offlineManifest(offlineCatalog.places.find(({ id }) => id === jefes)!)!);
  manifest.room_asset = { ...manifest.room_asset!, scale_status: 'measured' };
  manifest.rooms = [{ id: 'room', place_id: jefes, name: 'Side room', room_type: 'dining', stated_capacity: 10,
    floor_width_m: 3, floor_depth_m: 3, seating: 'standing', price: 0, price_unit: 'per visit', asset_id: manifest.room_asset.id }];
  const { call, state } = harness(undefined, { [jefes]: manifest });
  const fit = await call('set_will_we_fit', { placeId: jefes, enabled: true, groupSize: 12, seating: 'standing' });
  assert.equal(fit.result.ok, true);
  assert.equal(state.mode, 'venue');
  assert.equal(state.fit, true);
  assert.equal(state.seating, 'standing');
  assert.equal(state.filters.groupSize, 12);
  assert.equal(fit.result.floor_space_capacity, 25);
  assert.equal(fit.result.fits, false);
  await call('set_will_we_fit', { enabled: false });
  assert.equal(state.fit, false);
  assert.equal((await call('set_will_we_fit', { placeId: cafe, enabled: true })).result.ok, false);
  await call('set_filters', { maxBudget: 14, familyVisit: true, startStopId: kenmore, craving: 'cheap' });
  await call('set_filters', { reset: true, groupSize: 3 });
  assert.deepEqual(state.filters, { ...initialFilters, groupSize: 3 });
});

test('comparison tray mirrors add, open, remove, set and clear without exceeding three', async (t) => {
  const { call, state, app } = harness();
  const openCard = t.mock.method(app, 'openRestaurantComparison');
  assert.equal((await call('manage_comparison_tray', { action: 'open' })).result.ok, false);
  assert.equal((await call('manage_comparison_tray', { action: 'add', placeIds: [jefes] })).result.opened, false);
  assert.equal((await call('manage_comparison_tray', { action: 'add', placeIds: [cafe] })).result.opened, true);
  assert.equal((await call('manage_comparison_tray', { action: 'open' })).result.opened, true);
  assert.equal(openCard.mock.callCount(), 2);
  const fourth = state.places.find(({ id }) => ![jefes, cafe, starbucks].includes(id))!;
  assert.equal((await call('manage_comparison_tray', { action: 'add', placeIds: [starbucks, fourth.id] })).result.ok, false);
  assert.deepEqual(state.comparedPlaces.map(({ id }) => id), [jefes, cafe]);
  await call('manage_comparison_tray', { action: 'remove', placeIds: [jefes] });
  assert.deepEqual(state.comparedPlaces.map(({ id }) => id), [cafe]);
  await call('manage_comparison_tray', { action: 'set', placeIds: [starbucks, jefes, cafe] });
  assert.equal(openCard.mock.callCount(), 3);
  await call('manage_comparison_tray', { action: 'clear' });
  assert.equal(state.comparedPlaces.length, 0);
  t.mock.method(api, 'place', async (id: string) => state.places.find((place) => place.id === id));
  t.mock.method(api, 'predictions', async () => ({ predictions: [], source: 'simulated' }));
  t.mock.method(api, 'alerts', async () => []);
  await call('compare_places', { placeIds: [cafe, jefes], syncTray: true });
  assert.deepEqual(state.comparedPlaces.map(({ id }) => id), [cafe, jefes]);
  assert.deepEqual(state.highlightedStops, [harvard, kenmore]);
  assert.deepEqual(state.highlightedPlaces, [cafe, jefes]);
});

test('control_ui updates panels, SFX, modal, tabletop, pairing, XR and GPS with structured results', async (t) => {
  const { call, log, state, app } = harness();
  state.highlightedStops = [bu];
  const { result } = await call('control_ui', { filterPanel: 'open', audioSfx: 'on', modal: 'credits',
    tableMode: 'passthrough', sendToPairedDevice: 'trip', xrAction: 'exit_xr', clearHighlights: true, locateNearestStop: true, announce: 'Ready' });
  assert.equal(result.ok, true);
  assert.equal(state.filterOpen, true);
  assert.equal(state.muted, false);
  assert.equal(log.modal, 'credits');
  assert.equal(log.xr, 'exit_xr');
  assert.equal(log.sent, 'trip');
  assert.equal(result.sent, true);
  assert.equal(state.virtualTable, false);
  assert.deepEqual(state.highlightedStops, []);
  assert.equal(state.filters.startStopId, STOPS[1].stop_id);
  assert.deepEqual(log.notes, ['Ready']);
  assert.deepEqual(result.location, { ok: true, stop: STOPS[1], message: 'Starting from your nearest stop.' });
  t.mock.method(app, 'locateNearestStop', async () => ({ ok: false, message: 'GPS denied' }));
  assert.equal((await call('control_ui', { locateNearestStop: true })).result.error, 'GPS denied');
});

test('briefing actions validate exact venue and 3D dish pairs and get_current_view returns structured state', async () => {
  const { call, cards, state } = harness();
  await call('open_dish', { placeId: jefes, dishId: burrito, compareDishId: tiramisu, comparePlaceId: cafe, rotationDeg: 90 });
  await call('manage_comparison_tray', { action: 'add', placeIds: [jefes] });
  const card = await call('show_review_card', { ...schemas.show_review_card[0], cardId: 'dinner' });
  assert.equal(card.result.ok, true);
  assert.deepEqual(cards[0].actions, [
    { kind: 'compare-dishes', label: 'Compare 3D dishes on table', placeId: jefes, dishId: burrito,
      comparePlaceId: cafe, compareDishId: tiramisu },
    { kind: 'dish', label: 'View Carnitas Burrito in 3D', placeId: jefes, dishId: burrito },
  ]);
  const sections = [{ type: 'text', body: 'Dinner' }];
  for (const dishActions of [[{ placeId: jefes, dishId: tiramisu }], [{ placeId: 'missing', dishId: burrito }]]) {
    assert.equal((await call('show_review_card', { title: 'Dinner', sections, dishActions })).result.ok, false);
  }
  assert.equal((await call('show_review_card', { title: 'Dinner', sections,
    compareDishAction: { placeId: jefes, dishId: burrito, comparePlaceId: jefes, compareDishId: burrito } })).result.ok, false);
  state.trip = computeTripEstimate({ from_stop_id: bu, to_stop_id: kenmore });
  const { result } = await call('get_current_view');
  assert.equal(result.scene, 'dish');
  assert.deepEqual(result.stop, { id: kenmore, name: 'Kenmore' });
  assert.equal((result.place as Place).id, jefes);
  assert.equal((result.dish as Dish).id, burrito);
  assert.equal(result.compareDishId, tiramisu);
  assert.equal(result.comparePlaceId, cafe);
  assert.equal(result.inside, true);
  assert.equal(result.fit, false);
  assert.equal(result.seating, 'seated');
  assert.equal(result.rotationDeg, 90);
  assert.equal(result.tableMode, 'virtual');
  assert.deepEqual(result.filters, initialFilters);
  assert.equal(result.matchingPlacesCount, state.filtered.length);
  assert.deepEqual(result.comparedPlaceIds, [jefes]);
  assert.deepEqual(result.highlightedStops, []);
  assert.deepEqual(result.highlightedPlaces, []);
  assert.equal(result.highlightedDishId, burrito);
  assert.equal(result.drawerOpen, true);
  assert.equal(result.sheetExpanded, false);
  assert.equal(result.filterOpen, false);
  assert.equal(result.audioSfxOn, false);
  assert.equal(result.xrMode, 'none');
  assert.deepEqual(result.briefings, [{ id: 'dinner', title: 'Dinner' }]);
  assert.equal((result.trip as Record<string, unknown>).rideMinutes, 4);
  assert.equal((result.bostonTime as Record<string, unknown>).timeZone, 'America/New_York');
  assert.match(String(result.currentView), /Scene: dish/);
  await call('dismiss_review_card', { cardId: 'dinner' });
  assert.deepEqual(state.briefings, []);
});

test('visit note submission trims data, rejects invalid inputs and reports moderation status', async (t) => {
  const { call } = harness();
  const submit = t.mock.method(api, 'review', async () => ({ status: 'pending_review' }));
  for (const patch of [{ placeId: 'unknown' }, { authorLabel: '  ' }, { text: '' }, { authorLabel: 'a'.repeat(81) },
    { text: 'a'.repeat(1001) }, { rating: 1.5 }]) {
    assert.equal((await call('submit_visit_note', { placeId: jefes, authorLabel: 'Pat', text: 'Loved it', ...patch })).result.ok, false);
  }
  assert.equal(submit.mock.callCount(), 0);
  const { result } = await call('submit_visit_note', { placeId: jefes, authorLabel: ' Pat ', text: ' Loved it! ', rating: 5 });
  assert.equal(result.status, 'pending_review');
  assert.deepEqual(submit.mock.calls[0].arguments, [jefes, { author_label: 'Pat', text: 'Loved it!', rating: 5 }]);
  await call('submit_visit_note', { placeId: jefes, authorLabel: 'Pat', text: 'Loved it again.' });
  assert.deepEqual(submit.mock.calls[1].arguments, [jefes, { author_label: 'Pat', text: 'Loved it again.' }]);
});

test('cancelled voice operations cannot apply late highlights, prices or notices', async (t) => {
  const { call, app, state, log } = harness();
  let active = true;
  let resolvePrice!: (value: { live: boolean; prices: { dish_id: string; price: number }[] }) => void;
  t.mock.method(api, 'liveMenuPrices', () => new Promise((resolve) => { resolvePrice = resolve; }));
  const apply = t.mock.method(app, 'applyLiveMenuPrices');
  const menu = call('get_live_menu_prices', { placeId: starbucks }, () => active);
  active = false;
  resolvePrice({ live: true, prices: [{ dish_id: latte, price: 5 }] });
  assert.equal((await menu).result.ok, false);
  assert.equal(apply.mock.callCount(), 0);

  active = true;
  let release!: () => void;
  const showVenue = app.showVenue;
  app.showVenue = async (place, options) => {
    await new Promise<void>((resolve) => { release = resolve; });
    if (options?.current?.()) await showVenue(place, options);
  };
  const open = call('show_menu', { placeId: jefes, highlightDishId: burrito }, () => active);
  active = false;
  release();
  assert.equal((await open).result.ok, false);
  assert.equal(state.mode, 'map');
  assert.equal(log.focusMenu, undefined);

  active = true;
  app.locateNearestStop = async () => {
    await new Promise<void>((resolve) => { release = resolve; });
    return { ok: false, message: 'Location request cancelled' };
  };
  const locate = call('control_ui', { locateNearestStop: true, announce: 'Stale announcement' }, () => active);
  active = false;
  release();
  assert.equal((await locate).result.ok, false);
  assert.deepEqual(log.notes, []);
});

test('station highlights and comparison updates preserve the open desktop briefing', async () => {
  const { call, state, cards } = harness();
  const opened = await call('show_review_card', {
    cardId: 'desktop', title: 'Where to eat', sections: [{ type: 'text', body: 'Pick a stop and compare nearby venues.' }],
  });
  assert.equal(opened.result.ok, true);
  await call('highlight_station_places', { placeIds: [jefes] });
  await call('manage_comparison_tray', { action: 'add', placeIds: [jefes] });
  assert.equal(state.mode, 'station');
  assert.equal(state.stop?.stop_id, kenmore);
  assert.deepEqual(state.highlightedPlaces, [jefes]);
  assert.deepEqual(state.comparedPlaces.map(({ id }) => id), [jefes]);
  assert.deepEqual(cards.map(({ id }) => id), ['desktop']);
});
