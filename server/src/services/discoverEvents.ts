import type { DiscoverArrival } from '@faresight/shared';
import { listen } from '../db/pg.ts';
import type { Accounts } from './accounts.ts';

type Subscriber = (arrival: DiscoverArrival) => void;

export const ARRIVALS_CHANNEL = 'discover_arrivals';

/**
 * One LISTEN connection for the whole API process, fanned out to every browser watching Discover.
 *
 * This is the same shape as `createCaptureEvents`, with one difference: a capture feed is scoped to
 * the one phone that started it, whereas this is site-wide, so there is a single subscriber set
 * rather than one per identifier.
 */
export function createDiscoverEvents(accounts: Accounts, onError: (error: unknown) => void) {
  const subscribers = new Set<Subscriber>();
  const listener = listen(accounts.settings.databaseUrlDirect, [ARRIVALS_CHANNEL], (_channel, payload) => {
    try {
      const arrival = JSON.parse(payload) as DiscoverArrival;
      for (const subscriber of subscribers) subscriber(arrival);
    } catch (error) {
      onError(error);
    }
  }, onError);

  return {
    subscribe(subscriber: Subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    /**
     * Announces a new place to every connected browser, including those served by other API
     * processes, because the notification goes through Postgres rather than this process's memory.
     */
    async publish(arrival: DiscoverArrival) {
      await accounts.pool.query('select pg_notify($1, $2)', [ARRIVALS_CHANNEL, JSON.stringify(arrival)]);
    },
    close: () => listener.close(),
  };
}

export type DiscoverEvents = ReturnType<typeof createDiscoverEvents>;
