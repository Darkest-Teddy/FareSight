import type { Place } from '@faresight/shared';
import { api } from './api';
import { errorText } from './dom';

/** The places contributors can scan, loaded once from the API and shared by every screen. */
class Catalog {
  places: Place[] = [];
  status: 'loading' | 'ready' | 'error' = 'loading';
  error = '';
  private listeners = new Set<() => void>();
  private loadedAt = 0;
  private request?: Promise<void>;

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
      try {
        this.places = await api.places();
        this.status = 'ready';
        this.error = '';
        this.loadedAt = Date.now();
      } catch (error) {
        // Keep showing the last good list if a refresh fails.
        if (this.status !== 'ready') {
          this.status = 'error';
          this.error = errorText(error);
        }
      } finally {
        this.request = undefined;
        for (const listener of this.listeners) listener();
      }
    })();
    return this.request;
  }
}

export const catalog = new Catalog();
