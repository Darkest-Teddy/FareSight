import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/**
 * Where the API and the Contribute web app live.
 *
 * Expo already knows the LAN address it loaded this bundle from, so both hosts are derived from
 * it rather than hardcoded. That keeps working when the development machine changes network,
 * which a hardcoded IP does not.
 */
const API_PORT = 3001;
const CONTRIBUTE_PORT = 5180;

function packagerHost() {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    Constants.expoGoConfig?.debuggerHost ??
    Constants.manifest2?.extra?.expoGo?.developer?.host;
  return hostUri?.split(':')[0];
}

export function apiOrigin() {
  const override = Constants.expoConfig?.extra?.apiUrl;
  if (override) return override.replace(/\/$/, '');
  const host = packagerHost();
  return host ? `http://${host}:${API_PORT}` : `http://localhost:${API_PORT}`;
}

export function contributeOrigin() {
  const override = Constants.expoConfig?.extra?.contributeUrl;
  if (override) return override.replace(/\/$/, '');
  const host = packagerHost();
  return host ? `http://${host}:${CONTRIBUTE_PORT}` : `http://localhost:${CONTRIBUTE_PORT}`;
}

/**
 * The session token lives in the platform keychain through expo-secure-store, not in
 * AsyncStorage. It is a long-lived credential, and it never enters the WebView: the WebView gets
 * a separate 60-second handoff token instead.
 */
const TOKEN_KEY = 'faresight.session';

export async function storedToken() {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function storeToken(token) {
  try {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // A device with no keychain available still works for the length of this launch.
  }
}

async function request(path, { method = 'GET', body, token } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(apiOrigin() + '/api' + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (response.status === 204) return undefined;
    const data = await response.json().catch(() => undefined);
    if (!response.ok || data === undefined) {
      const error = new Error(data?.error ?? `Server returned HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('The server did not respond.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export const api = {
  status: () => request('/auth/status'),

  async register(email, password, displayName) {
    const result = await request('/auth/register', {
      method: 'POST',
      body: { email, password, display_name: displayName },
    });
    await storeToken(result.token);
    return result.user;
  },

  async login(email, password) {
    const result = await request('/auth/login', { method: 'POST', body: { email, password } });
    await storeToken(result.token);
    return result.user;
  },

  /** Exchanges a Google ID token for a FareSight session. The server verifies it with Google. */
  async google(idToken) {
    const result = await request('/auth/google', { method: 'POST', body: { id_token: idToken } });
    await storeToken(result.token);
    return result.user;
  },

  /** Confirms a stored token still works. Returns null when it has expired or been revoked. */
  async me() {
    const token = await storedToken();
    if (!token) return null;
    try {
      const { user } = await request('/auth/me', { token });
      return user;
    } catch (error) {
      // 401 means the token is dead, so drop it rather than retrying it on every launch.
      if (error.status === 401) await storeToken(null);
      return null;
    }
  },

  async logout() {
    const token = await storedToken();
    if (token) await request('/auth/logout', { method: 'POST', token }).catch(() => undefined);
    await storeToken(null);
  },

  /**
   * Mints the single-use, 60-second token that hands this native session to the WebView.
   *
   * The WebView never sees the long-lived token. If the page inside it were ever navigated
   * somewhere hostile, the worst it could leak is a handoff token that has already been spent.
   */
  async handoff() {
    const token = await storedToken();
    if (!token) return null;
    const { handoff_token: handoff } = await request('/auth/handoff', { method: 'POST', token });
    return handoff;
  },
};
