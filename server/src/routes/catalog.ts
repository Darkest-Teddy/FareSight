import { closeSync, openSync, readSync } from 'node:fs';
import type { Asset, Place, RestaurantManifest } from '@faresight/shared';
import { STOPS } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { PendingReview, Store } from '../db/database.ts';
import type { Accounts } from '../services/accounts.ts';
import { findDemoAsset } from '../services/demoAssets.ts';
import { loadDishPrices, saveDishPrices, type StoredDishPrice } from '../services/dishPrices.ts';
import { fetchLiveReviews } from '../services/liveReviews.ts';
import { fetchMenuPrices } from '../services/menuPrices.ts';

export function registerCatalog(app: FastifyInstance, store: Store, config: Config, accounts?: Accounts) {
  const demoCounts = new Map<string, number>();

  /**
   * Prices recorded in Tiger Data since `shared/src/restaurantDishes.ts` was last written. Empty
   * when the server runs without a database, which is why the compiled-in prices stay the floor.
   */
  const storedPrices = async (): Promise<Map<string, StoredDishPrice>> =>
    accounts ? loadDishPrices(accounts.pool) : new Map();
  function getAsset(id: string | null | undefined): Asset | null {
    if (!id) return null;
    const asset = store.get('assets', id);
    if (asset?.status !== 'ready') return null;
    if (asset.backend !== 'prebuilt-demo') return asset;
    const file = findDemoAsset(config, asset.url.slice('/assets-demo/'.length));
    if (!file) return null;
    if (!asset.url.endsWith('.ply')) return asset;
    let count = demoCounts.get(file);
    if (count === undefined) {
      try {
        const descriptor = openSync(file, 'r');
        try {
          const header = Buffer.alloc(4096);
          readSync(descriptor, header);
          count = Number(header.toString('ascii').match(/^element vertex (\d+)\r?$/m)?.[1] ?? asset.gaussian_count);
          demoCounts.set(file, count);
        } finally {
          closeSync(descriptor);
        }
      } catch {
        return null;
      }
    }
    return { ...asset, gaussian_count: count };
  }

  function hydrate(
    place: Place, storedReviews = store.all('reviews'), prices?: Map<string, StoredDishPrice>,
  ): Place {
    const reviews = new Map(place.reviews.map((review) => [review.id, review]));
    for (const review of storedReviews) {
      if (review.place_id !== place.id) continue;
      if (review.status !== 'approved') reviews.delete(review.id);
      else reviews.set(review.id, {
        id: review.id, author: review.author_label, text: review.text, created_at: review.created_at,
        rating: review.rating ?? reviews.get(review.id)?.rating ?? 0, sample: review.sample,
      });
    }
    return {
      ...place,
      reviews: [...reviews.values()],
      // A stored price fills a dish the catalogue has no price for. It does not overwrite one
      // that is already set: the compiled-in amounts were each read off a cited menu, and the
      // backfill writes both places at once, so there is nothing here for a stale row to correct.
      dishes: place.dishes.map((dish) => ({
        ...dish,
        price: dish.price ?? prices?.get(dish.id)?.price ?? null,
        asset: getAsset(dish.asset_id),
      })),
      rooms: place.rooms.map((room) => ({ ...room, asset: getAsset(room.asset_id) })),
    };
  }

  app.get('/api/stops', async () => STOPS);
  app.get<{ Querystring: { stop?: string; category?: string } }>('/api/restaurants', async ({ query }) => {
    const reviews: PendingReview[] = store.all('reviews');
    const prices = await storedPrices();
    return store.all('places').filter((place) => (!query.stop || query.stop === place.stop_id)
      && (!query.category || query.category === place.category)).map((place) => hydrate(place, reviews, prices));
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id', async ({ params }, reply) => {
    const place = store.get('places', params.id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    return hydrate(place, undefined, await storedPrices());
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id/live-reviews', async ({ params, ip }, reply) => {
    const place = store.get('places', params.id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    reply.header('Cache-Control', 'no-store');
    return fetchLiveReviews(place, config, ip);
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id/live-prices', async ({ params, ip }, reply) => {
    const place = store.get('places', params.id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    reply.header('Cache-Control', 'no-store');
    const found = await fetchMenuPrices(hydrate(place, undefined, await storedPrices()), config, ip);
    // Keep what the lookup found. Without this the answer lives only in that process's cache, so
    // the next restart asks again and no other reader ever sees it.
    if (accounts && found.live && found.prices.length) {
      await saveDishPrices(accounts.pool, place.id, found.prices)
        .catch((error: unknown) => app.log.warn({ error }, 'could not store menu prices'));
    }
    return found;
  });
  app.get<{ Params: { id: string } }>('/api/restaurants/:id/manifest', async ({ params }, reply) => {
    const stored = store.get('places', params.id);
    if (!stored) return reply.code(404).send({ error: 'Place not found' });
    const place = hydrate(stored, undefined, await storedPrices());
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
