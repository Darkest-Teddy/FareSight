import type { AuthStatus, AuthUser } from '@faresight/shared';

/**
 * The signed-in contributor.
 *
 * This replaces the shared upload passcode as the way the server learns who is uploading. The
 * passcode still works, so a server configured the old way is not broken by this, but a place can
 * only be created by an account: a shared secret cannot say who added something.
 *
 * Two ways a session appears here:
 *
 * 1. Someone signs in on this device, and the token is kept in localStorage.
 * 2. The Expo app signs in natively and injects a one-minute handoff token before this page's
 *    scripts run. That token is exchanged for a session of this page's own, so the app's
 *    long-lived token never enters the WebView.
 */

const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');
const TOKEN_KEY = 'faresight.contribute.session';

declare global {
  interface Window {
    __FARESIGHT_HANDOFF__?: string;
    __FARESIGHT_NATIVE__?: boolean;
  }
}

function read(): string {
  try { return localStorage.getItem(TOKEN_KEY) ?? ''; } catch { return ''; }
}

function write(token: string) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* Private mode keeps the session for this page only. */ }
}

async function call<T>(path: string, body?: object, token?: string): Promise<T> {
  const headers = new Headers({ accept: 'application/json' });
  if (body) headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(apiOrigin + '/api' + path, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new Error(data?.error ?? `Server returned HTTP ${response.status}.`);
  }
  return data as T;
}

class Session {
  private token = read();
  private listeners = new Set<() => void>();
  user: AuthUser | null = null;
  /** Null until the first status call answers. Null means "not known yet", not "unavailable". */
  enabled: boolean | null = null;
  googleClientId: string | null = null;
  /** True when this page is running inside the Expo app's WebView. */
  readonly native = Boolean(window.__FARESIGHT_NATIVE__);

  get bearer() { return this.token; }
  get signedIn() { return Boolean(this.user); }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private announce() {
    for (const listener of this.listeners) listener();
  }

  private adopt(result: { user: AuthUser; token: string }) {
    this.token = result.token;
    write(result.token);
    this.user = result.user;
    this.announce();
    return result.user;
  }

  /**
   * Resolves who is signed in, redeeming a native handoff token first when one is present.
   *
   * The handoff is consumed before anything else so a contributor who signed in on the phone is
   * already signed in by the time the first screen renders.
   */
  async restore(): Promise<void> {
    const handoff = window.__FARESIGHT_HANDOFF__;
    if (handoff) {
      // Clear it immediately: it works once, and leaving it on `window` only invites a replay.
      delete window.__FARESIGHT_HANDOFF__;
      try {
        this.adopt(await call('/auth/exchange', { handoff_token: handoff }));
      } catch { /* Expired or already spent. Fall through to whatever this device has. */ }
    }
    try {
      const status = await call<AuthStatus>('/auth/status', undefined, this.token);
      this.enabled = status.enabled;
      this.googleClientId = status.google_client_id;
      this.user = status.user;
      // A token the server no longer honours is dead weight on every later request.
      if (!status.user && this.token) { this.token = ''; write(''); }
    } catch {
      this.enabled = null;
    }
    this.announce();
  }

  async login(email: string, password: string) {
    return this.adopt(await call('/auth/login', { email, password }));
  }

  async register(email: string, password: string, displayName?: string) {
    return this.adopt(await call('/auth/register', { email, password, display_name: displayName }));
  }

  async google(idToken: string) {
    return this.adopt(await call('/auth/google', { id_token: idToken }));
  }

  async logout() {
    if (this.token) await call('/auth/logout', {}, this.token).catch(() => undefined);
    this.token = '';
    write('');
    this.user = null;
    this.announce();
  }
}

export const session = new Session();
