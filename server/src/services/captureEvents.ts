import { listen } from '../db/pg.ts';
import type { CaptureEventType, Captures } from './captures.ts';

type Subscriber = (type: CaptureEventType) => void;

/** One LISTEN connection for the whole API process, fanned out to the browsers watching each capture. */
export function createCaptureEvents(captures: Captures, onError: (error: unknown) => void) {
  const subscribers = new Map<string, Set<Subscriber>>();
  const listener = listen(captures.settings.databaseUrlDirect, ['capture_events'], (_channel, payload) => {
    try {
      const { capture_id, type } = JSON.parse(payload) as { capture_id: string; type: CaptureEventType };
      for (const subscriber of subscribers.get(capture_id) ?? []) subscriber(type);
    } catch (error) {
      onError(error);
    }
  }, onError, () => {
    // Events sent while the connection was down are gone, so every watcher re-reads its capture.
    for (const group of subscribers.values()) for (const subscriber of group) subscriber('status');
  });
  return {
    subscribe(captureId: string, subscriber: Subscriber) {
      const group = subscribers.get(captureId) ?? new Set();
      subscribers.set(captureId, group.add(subscriber));
      return () => {
        group.delete(subscriber);
        if (!group.size) subscribers.delete(captureId);
      };
    },
    close: () => listener.close(),
  };
}

export type CaptureEvents = ReturnType<typeof createCaptureEvents>;
