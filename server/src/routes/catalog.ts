import { closeSync, openSync, readSync } from 'node:fs';
import type { Asset, Place, RestaurantManifest } from '@faresight/shared';
import { STOPS } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { PendingReview, Store } from '../db/database.ts';
import { findDemoAsset } from '../services/demoAssets.ts';
import { fetchLiveReviews } from '../services/liveReviews.ts';

export function registerCatalog(app: FastifyInstance, store: Store, config: Config) {
  const demoCounts = new Map<string, number>();
  function getAsset(id: string | null | undefined): Asset | null {
    if (!id) return null;
    const asset = store.get('assets', id);
    if (asset?.status !== 'ready') return null;
    if (asset.backend !== 'prebuilt-demo') return asset;
    const file = findDemoAsset(config, asset.url.slice('/assets-demo/'.length));
    if (!file?.endsWith('.ply')) return asset;
    let count = demoCounts.get(file);
    if (count === undefined) {
      const descriptor = openSync(file, 'r');
      try {
        const header = Buffer.alloc(4096);
        readSync(descriptor, header);
        count = Number(header.toString('ascii').match(/^element vertex (\d+)\r?$/m)?.[1] ?? asset.gaussian_count);
        demoCounts.set(file, count);
      } finally {
        closeSync(descriptor);
      }
    }
    return { ...asset, gaussian_count: count };
  }

  function hydrate(place: Place, storedReviews = store.all('reviews')): Place {
    const reviews = new Map(place.reviews.map((review) => [review.id, review]));
    for (const review of storedReviews) {
      if (review.place_id !== place.id) continue;
      if (review.status !== 'approved') reviews.delete(review.id);
      else reviews.set(review.id, {
        id: review.id, author: review.author_label, text: review.text, created_at: review.created_at,
        rating: reviews.get(review.id)?.rating ?? (review.sample ? 0 : 5), sample: review.sample,
      });
    }
    return {
      ...place,
      reviews: [...reviews.values()],
      dishes: place.dishes.map((dish) => ({ ...dish, asset: getAsset(dish.asset_id) })),
      rooms: place.rooms.map((room) => ({ ...room, asset: getAsset(room.asset_id) })),
    };
  }

  app.get('/api/stops', async () => STOPS);
  app.get<{ Querystring: { stop?: string; category?: string } }>('/api/restaurants', async ({ query }) => {
    const reviews: PendingReview[] = store.all('reviews');
    return store.all('places').filter((place) => (!query.stop || query.stop === place.stop_id)
      && (!query.category || query.category === place.category)).map((place) => hydrate(place, reviews));
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id', async ({ params }, reply) => {
    const place = store.get('places', params.id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    return hydrate(place);
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id/live-reviews', async ({ params }, reply) => {
    const place = store.get('places', params.id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    reply.header('Cache-Control', 'no-store');
    return fetchLiveReviews(place, config);
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id/manifest', async ({ params }, reply) => {
    const stored = store.get('places', params.id);
    if (!stored) return reply.code(404).send({ error: 'Place not found' });
    const place = hydrate(stored);
    const { id, name, stop_id, vibe, typical_price, price_checked_on } = place;
    const room_asset = getAsset(place.room_asset_id);
    const menu_items = place.dishes.map((dish) => ({ dish, dish_asset: dish.asset ?? null }));
    const ready = [room_asset, ...menu_items.map(({ dish_asset }) => dish_asset)].filter((asset) => asset !== null);
    const latest = ready.map((asset) => store.get('jobs', asset.id)?.updated_at ?? asset.captured_on).sort().at(-1);
    const manifest: RestaurantManifest = {
      restaurant: { id, name, stop_id, vibe, typical_price, price_checked_on },
      room_asset, spawn_point: room_asset?.spawn_point ?? [0, 1.55, 2],
      menu_items, rooms: place.rooms,
      source_photos: [...new Set([...place.photos, ...ready.flatMap((asset) => asset.source_photos)])],
      generation_label: room_asset?.provenance_label ?? (ready[0]?.provenance_label ?? 'No published spatial preview'),
      scale_label: room_asset?.scale_label ?? (ready[0]?.scale_label ?? 'Unknown scale'),
      updated_at: latest ?? price_checked_on,
    };
    return manifest;
  });
}
