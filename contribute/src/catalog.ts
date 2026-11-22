import type { Place } from '@faresight/shared';
import { api } from './api';
import { errorText } from './dom';

/** How often the list is checked against the server while the app is on screen. */
const REFRESH_MS = 10_000;

/** The places contributors can scan, kept in step with the API and shared by every screen. */
class Catalog {
  places: Place[] = [];
  status: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  private listeners = new Set<() => void>();
  private loadedAt = 0;
  private request?: Promise<void>;
  /** The list as the server last sent it, to tell a real change from a refresh that found nothing new. */
  private received = '';

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  at(stopId: string) {
    return this.places.filter((place) => place.stop_id === stopId).sort((a, b) => a.pin_index - b.pin_index);
  }

  find(placeId: string) {
    return this.places.find((place) => place.id === placeId);
  }

  /** Reloads when the copy is older than `maxAge` milliseconds. */
  load(maxAge = 0): Promise<void> {
    if (this.request) return this.request;
    if (this.status === 'ready' && Date.now() - this.loadedAt < maxAge) return Promise.resolve();
    this.request = (async () => {
      let changed = false;
      try {
        const places = await api.places();
        const received = JSON.stringify(places);
        changed = this.status !== 'ready' || received !== this.received;
        if (changed) {
          this.places = places;
          this.received = received;
        }
        this.status = 'ready';
        this.error = '';
        this.loadedAt = Date.now();
      } catch (error) {
        // Keep showing the last good list if a refresh fails.
        if (this.status !== 'ready') {
          changed = true;
          this.status = 'error';
          this.error = errorText(error);
        }
      } finally {
        this.request = undefined;
        // Screens redraw on this, so a refresh that found nothing new stays silent.
        if (changed) for (const listener of this.listeners) listener();
      }
    })();
    return this.request;
  }

  /**
   * Keeps the list in step with the server for as long as the app is open, so a place that is added,
   * moved, renamed or removed on the site shows up here within seconds.
   */
  watch() {
    const refresh = () => { if (document.visibilityState === 'visible') void this.load(); };
    window.setInterval(refresh, REFRESH_MS);
    // Coming back to the app should not wait for the next tick.
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
  }
}

export const catalog = new Catalog();
