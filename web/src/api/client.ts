import {
  STOPS, type Asset, type GenerationJob, type IntakeSelectionResult,
  type LiveMenuPricesResponse, type LiveReviewsResponse, type LiveSessionRequest, type LiveSessionResponse, type LiveStatusResponse,
  type MarbleTier, type MbtaAlert, type MbtaPrediction, type MbtaSource, type MbtaVehicle,
  type PairingMessage, type Place, type RestaurantManifest, type Stop, type TripEstimate, type Vector3,
} from '@faresight/shared';

export type Trip = TripEstimate & { last_train_time?: string | null };
export type Prediction = Pick<MbtaPrediction, 'route_id' | 'status'> & {
  arrival_min: number | null;
  direction?: string | number | null;
};
export interface Alert {
  id: string;
  header: string;
  severity: number;
  route_ids: string[];
  stop_ids: string[];
  source?: MbtaSource;
}
export interface Upload {
  id: string;
  filename: string;
  url: string;
  place_id: string;
}
export interface ModerationItem {
  id: string;
  place_id: string;
  author_label?: string;
  text?: string;
  filename?: string;
  url?: string;
  status?: string;
}
export type ModerationKind = 'review' | 'upload';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const apiOrigin = String(import.meta.env?.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
export function assetUrl(path: string): string {
  const url = new URL(path, apiOrigin || window.location.origin);
  if (url.origin === 'http://localhost:3001' || url.origin === 'http://127.0.0.1:3001') {
    return (apiOrigin || window.location.origin) + url.pathname + url.search;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('Invalid asset URL');
  return url.href;
}

async function request<T>(
  path: string, body?: object | FormData, passcode?: string, cancel?: AbortSignal, timeoutMs = body ? 90_000 : 6_000,
): Promise<T> {
  const multipart = body instanceof FormData;
  const headers = new Headers({ accept: 'application/json' });
  if (body && !multipart) headers.set('content-type', 'application/json');
  if (passcode) headers.set('x-admin-passcode', passcode);
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(apiOrigin + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: multipart ? body : body ? JSON.stringify(body) : undefined,
    signal: cancel ? AbortSignal.any([cancel, timeout]) : timeout,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new ApiError(data?.error ?? data?.message ?? `Server returned HTTP ${response.status}.`, response.status);
  }
  return data as T;
}

const pathId = (id: string) => encodeURIComponent(id);
const jobResult = (result: GenerationJob | { job: GenerationJob }) => 'job' in result ? result.job : result;

export const api = {
  async catalog(): Promise<{ stops: Stop[]; places: Place[] }> {
    const result = await request<Place[] | { stops: Stop[]; places: Place[] }>('/restaurants');
    if (!Array.isArray(result)) return result;
    const stops = await request<Stop[]>('/stops').catch(() => STOPS);
    return { stops, places: result };
  },
  manifest: (id: string) => request<RestaurantManifest>(`/restaurants/${pathId(id)}/manifest`),
  place: (id: string) => request<Place>(`/restaurants/${pathId(id)}`),
  liveReviews: (id: string) => request<LiveReviewsResponse>(`/restaurants/${pathId(id)}/live-reviews`, undefined, undefined, undefined, 25_000),
  liveMenuPrices: (id: string) => request<LiveMenuPricesResponse>(`/restaurants/${pathId(id)}/live-prices`, undefined, undefined, undefined, 25_000),
  review: (id: string, data: { author_label: string; text: string; rating?: number }) =>
    request<unknown>(`/restaurants/${pathId(id)}/reviews`, data),
  vehicles: () => request<{ vehicles: MbtaVehicle[]; source: MbtaSource; updated_at: string }>('/mbta/vehicles'),
  async predictions(stop: string) {
    const result = await request<{ predictions: (MbtaPrediction & Partial<Prediction>)[]; source: MbtaSource }>(
      '/mbta/predictions?' + new URLSearchParams({ stop }),
    );
    const predictions: Prediction[] = result.predictions.map((prediction) => {
      const arrival = Date.parse(prediction.arrival_time ?? prediction.departure_time ?? '');
      return {
        route_id: prediction.route_id, status: prediction.status,
        direction: prediction.direction ?? prediction.headsign ?? (prediction.direction_id === 0 ? 'Outbound' : prediction.direction_id === 1 ? 'Inbound' : null),
        arrival_min: prediction.arrival_min ?? (Number.isFinite(arrival) ? Math.max(0, Math.ceil((arrival - Date.now()) / 60_000)) : null),
      };
    });
    return { predictions, source: result.source };
  },
  async alerts(): Promise<Alert[]> {
    const result = await request<MbtaAlert[] | { source?: MbtaSource; alerts: (MbtaAlert & { route_id?: string })[] }>('/mbta/alerts');
    return (Array.isArray(result) ? result : result.alerts).map((alert) => ({
      ...alert,
      source: Array.isArray(result) ? undefined : result.source,
      route_ids: alert.route_ids ?? ('route_id' in alert && typeof alert.route_id === 'string' ? [alert.route_id] : []),
      stop_ids: alert.stop_ids ?? [],
    }));
  },
  async trip(from: string, place: Place, origin?: { lat: number; lon: number }): Promise<Trip> {
    const to = place.stop_id;
    const query = new URLSearchParams({ from, to, walkToVenueM: String(place.walk_from_stop_m), venueLat: String(place.lat), venueLon: String(place.lon) });
    if (origin) {
      query.set('origin_lat', String(origin.lat));
      query.set('origin_lon', String(origin.lon));
    }
    type LegacyTrip = { fare_one_way?: number; fare_round_trip?: number; trip_planner_url?: string; source?: MbtaSource };
    const trip = await request<Trip & LegacyTrip>('/mbta/trip?' + query);
    return {
      ...trip, from_stop_id: trip.from_stop_id ?? from, to_stop_id: trip.to_stop_id ?? to,
      fare: trip.fare ?? trip.fare_one_way ?? 0, round_trip_fare: trip.round_trip_fare ?? trip.fare_round_trip ?? 0,
      planner_url: trip.planner_url ?? trip.trip_planner_url ?? '', prediction_source: trip.prediction_source ?? trip.source,
    };
  },
  async upload(place: string, file: File, passcode: string) {
    const body = new FormData();
    body.set('place_id', place);
    body.set('file', file);
    const result = await request<(Upload | { upload: Upload }) & { deduplicated: boolean }>('/uploads', body, passcode);
    return 'upload' in result ? result.upload : result;
  },
  intake: (place_id: string, upload_ids: string[], passcode: string) =>
    request<IntakeSelectionResult>('/intake', { place_id, upload_ids }, passcode),
  async generate(data: { kind: 'room' | 'dish'; place_id: string; dish_id?: string; dish_name?: string; dish_price?: number; upload_ids: string[]; plate_diameter_m?: number; model_tier?: MarbleTier }, passcode: string) {
    return jobResult(await request<GenerationJob | { job: GenerationJob }>('/jobs', data, passcode));
  },
  async jobs() {
    const result = await request<GenerationJob[] | { jobs: GenerationJob[] }>('/jobs');
    return Array.isArray(result) ? result : result.jobs;
  },
  async job(id: string) {
    return jobResult(await request<GenerationJob | { job: GenerationJob }>(`/jobs/${pathId(id)}`));
  },
  async retry(id: string, passcode: string) {
    return jobResult(await request<GenerationJob | { job: GenerationJob }>(`/jobs/${pathId(id)}/retry`, {}, passcode));
  },
  asset: (id: string) => request<Asset>(`/assets/${pathId(id)}`),
  publish: (id: string, data: { spawn_point?: Vector3; plate_diameter_m?: number; rotation_y?: number; approve: boolean }, passcode: string) =>
    request<Asset | { asset: Asset }>(`/assets/${pathId(id)}/publish`, data, passcode),
  moderation: (passcode: string) =>
    request<{ reviews: ModerationItem[]; uploads: ModerationItem[] }>('/admin/moderation', undefined, passcode),
  moderate: (type: ModerationKind, id: string, action: 'approve' | 'reject', passcode: string) =>
    request<unknown>('/admin/moderation', { type, id, action }, passcode),
  createPair: () => request<{ code: string }>('/pairing/create', {}),
  liveStatus: () => request<LiveStatusResponse>('/live/status'),
  createLiveSession: (data: LiveSessionRequest, signal?: AbortSignal) =>
    request<LiveSessionResponse>('/live/sessions', data, undefined, signal),
  logs: (logs: string[]) => request<unknown>('/debug/logs', { logs }),
};

export type PairMessage = PairingMessage & { peers?: number };
export function connectPair(code: string, onMessage: (message: PairMessage) => void): WebSocket {
  const url = new URL(`/ws/pair/${pathId(code)}`, apiOrigin || window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  socket.addEventListener('message', (event) => {
    try {
      const message: PairMessage = JSON.parse(event.data);
      if (message && typeof message.type === 'string') onMessage(message);
    } catch { /* Ignore invalid peer messages. */ }
  });
  return socket;
}
