import type {
  AuthStatus, AuthUser, DiscoverArrival, DiscoverQuery, DiscoverResponse, EngagementKind,
  NotificationFeed, ReportReason,
} from '@faresight/shared';

/**
 * Client for accounts and Discover.
 *
 * This is separate from `api` in `client.ts` because those endpoints authenticate with a shared
 * passcode header and only ever GET or POST, whereas these carry a per-person bearer token and
 * need PATCH as well. Keeping them apart avoids widening the older helper for a different
 * authentication model.
 */

const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'faresight.session';
const SEEN_KEY = 'faresight.notifications.seen';

export class DiscoverApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/**
 * The session token lives in localStorage. That makes it readable by any script running on the
 * page, which a cookie marked httpOnly would not be. It is the deliberate trade for an API on a
 * different origin with permissive CORS, where a cookie could not be sent at all. The token is
 * revocable server-side and expires on its own.
 */
export function storedToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function storeToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* Private browsing can refuse storage; the session then lasts this page only. */ }
}

async function request<T>(
  path: string, options: { method?: string; body?: object; auth?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const { method = options.body ? 'POST' : 'GET', body, auth = true, timeoutMs = 12_000 } = options;
  const headers = new Headers({ accept: 'application/json' });
  if (body) headers.set('content-type', 'application/json');
  const token = auth ? storedToken() : null;
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${apiOrigin}/api${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    // A rejected token is dead weight: drop it so the next load shows the signed-out state.
    if (response.status === 401 && token) storeToken(null);
    throw new DiscoverApiError(data?.error ?? `Server returned HTTP ${response.status}.`, response.status);
  }
  return data as T;
}

interface SignInResult { user: AuthUser; token: string; expires_at: string }

function adopt(result: SignInResult): AuthUser {
  storeToken(result.token);
  return result.user;
}

export const auth = {
  status: () => request<AuthStatus>('/auth/status'),
  register: (email: string, password: string, displayName?: string) =>
    request<SignInResult>('/auth/register', { body: { email, password, display_name: displayName } }).then(adopt),
  login: (email: string, password: string) =>
    request<SignInResult>('/auth/login', { body: { email, password } }).then(adopt),
  /** Exchanges a Google ID token for a FareSight session. The server verifies it with Google. */
  google: (idToken: string) =>
    request<SignInResult>('/auth/google', { body: { id_token: idToken } }).then(adopt),
  /** Redeems the one-minute token the Expo app injects, so the WebView gets its own session. */
  exchange: (handoffToken: string) =>
    request<SignInResult>('/auth/exchange', { body: { handoff_token: handoffToken } }).then(adopt),
  async logout() {
    await request<void>('/auth/logout', { method: 'POST' }).catch(() => undefined);
    storeToken(null);
  },
  signedIn: () => Boolean(storedToken()),
};

export const discover = {
  list(query: DiscoverQuery = {}): Promise<DiscoverResponse> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
    return request<DiscoverResponse>(`/discover?${params}`);
  },

  /**
   * Records a view or a 3D open. Failures are swallowed on purpose: a dropped analytics event
   * must never surface as an error to someone who is only browsing.
   */
  engage(placeId: string, kind: EngagementKind) {
    return request<void>('/engagement', { body: { place_id: placeId, kind } }).catch(() => undefined);
  },

  notifications(since?: string) {
    return request<NotificationFeed>(`/notifications${since ? `?since=${encodeURIComponent(since)}` : ''}`);
  },

  markNotificationsRead() {
    return request<void>('/notifications/read', { method: 'POST' }).catch(() => undefined);
  },

  report(placeId: string, reason: ReportReason, detail?: string) {
    return request<{ reports: number }>(`/places/${encodeURIComponent(placeId)}/report`, { body: { reason, detail } });
  },

  /**
   * Watches the server-sent arrival stream.
   *
   * EventSource reconnects on its own, but a reconnection leaves a gap: anything announced while
   * the connection was down was never delivered. The `ready` event carries the server's clock, so
   * each reconnection asks the notifications endpoint for everything added since the last one and
   * replays it. Without that, a brief network blip silently loses arrivals.
   */
  watchArrivals(onArrival: (arrival: DiscoverArrival) => void): () => void {
    let lastSeen = localStorage.getItem(SEEN_KEY) ?? new Date().toISOString();
    const source = new EventSource(`${apiOrigin}/api/discover/events`);

    source.addEventListener('arrival', (event) => {
      try {
        const arrival = JSON.parse((event as MessageEvent).data) as DiscoverArrival;
        lastSeen = arrival.created_at;
        try { localStorage.setItem(SEEN_KEY, lastSeen); } catch { /* storage may be unavailable */ }
        onArrival(arrival);
      } catch { /* A malformed frame is not worth tearing the stream down for. */ }
    });

    let first = true;
    source.addEventListener('ready', () => {
      if (first) { first = false; return; }
      // This is a reconnection, so catch up on anything missed while the stream was down.
      void discover.notifications(lastSeen).then((feed) => {
        for (const place of feed.new_places.filter((p) => p.created_at > lastSeen).reverse()) onArrival(place);
        lastSeen = feed.now;
      }).catch(() => undefined);
    });

    return () => source.close();
  },
};

export const places = {
  nearby(lat: number, lon: number, name?: string) {
    const params = new URLSearchParams({ lat: String(lat), lon: String(lon) });
    if (name) params.set('name', name);
    return request<{
      candidates: import('@faresight/shared').NearbyCandidate[];
      configured: boolean;
      station: { stop_id: string; name: string; distance_m: number } | null;
    }>(`/places/nearby?${params}`);
  },

  create(body: {
    name: string; category: string; lat?: number; lon?: number; price_typical?: number;
    note?: string; address?: string; google_place_id?: string; capture_id?: string;
    photo_urls?: string[]; rating?: number; rating_count?: number;
  }) {
    return request<{ place_id: string; station_id: string | null; created_at: string }>('/places', { body });
  },

  update(id: string, body: { name?: string; category?: string; note?: string; price_typical?: number }) {
    return request<void>(`/places/${encodeURIComponent(id)}`, { method: 'PATCH', body });
  },
};
