// Finds a photograph for every place on Discover.
//
//   pnpm --filter @faresight/server thumbnails            # only places without one
//   pnpm --filter @faresight/server thumbnails --all      # re-fetch everything
//   pnpm --filter @faresight/server thumbnails --limit 5  # a few, to try it out
//
// Sources are the venue's own og:image and Wikipedia's page image. Both are free, need no key,
// and are published to be used this way. Stock photography is deliberately not used: a generic
// picture on a specific venue's card is a picture of nothing.
//
// Images are downloaded into server/storage/thumbnails and served from /storage/thumbnails,
// rather than hotlinked, so a card never depends on someone else's server staying up.

import type { Place } from '@faresight/shared';
import { getConfig } from '../config.ts';
import { Store } from '../db/database.ts';
import { createPool, migrate } from '../db/pg.ts';
import { fetchThumbnail } from '../services/thumbnails.ts';

const argv = process.argv.slice(2);
const refreshAll = argv.includes('--all');
const limitIndex = argv.indexOf('--limit');
const limit = limitIndex >= 0 ? Number(argv[limitIndex + 1]) : 0;

const config = getConfig();
if (!config.accounts) throw new Error('Set DATABASE_URL first: thumbnails are recorded in Postgres.');

const pool = createPool(config.accounts.databaseUrlDirect);
await migrate(pool);
const store = new Store(config.database);

interface Target {
  id: string;
  name: string;
  category: string;
  website: string | null;
  locality: string | null;
  /** Lets the OpenStreetMap lookup find the venue when the catalogue has no website for it. */
  lat: number | null;
  lon: number | null;
}

const seeded: Target[] = store.all('places').map((place: Place) => ({
  id: place.id,
  name: place.name,
  category: place.category,
  website: place.details?.website ?? null,
  // The address narrows a Wikipedia search far better than "Boston" alone.
  locality: place.details?.address ?? null,
  lat: place.lat,
  lon: place.lon,
}));

const { rows: contributed } = await pool.query<Target>(
  `select id, name, category, null::text as website, address as locality, lat, lon
     from contributed_places where status = 'published'`,
);

const all = [...seeded, ...contributed];
const { rows: existing } = await pool.query<{ place_id: string }>('select place_id from place_thumbnails');
const have = new Set(existing.map((row) => row.place_id));

let targets = refreshAll ? all : all.filter(({ id }) => !have.has(id));
if (limit > 0) targets = targets.slice(0, limit);

console.log(`${all.length} places; ${have.size} already have a picture; ${targets.length} to look for.`);
if (!targets.length) {
  console.log('Nothing to do. Use --all to re-fetch.');
  await pool.end();
  store.sqlite.close();
  process.exit(0);
}

let found = 0;
let missing = 0;
let index = 0;
// Four at a time: enough to finish the catalogue quickly without hammering any one host, and
// each target is a different host anyway.
const CONCURRENCY = 4;

async function handle(target: Target) {
  const position = ++index;
  try {
    const result = await fetchThumbnail(target, config.thumbnails);
    if (!result) {
      missing++;
      console.log(`[${position}/${targets.length}] ${target.name}: no picture found`);
      return;
    }
    await pool.query(
      `insert into place_thumbnails (place_id, url, source, credit, credit_url, fetched_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (place_id) do update
         set url = excluded.url, source = excluded.source, credit = excluded.credit,
             credit_url = excluded.credit_url, fetched_at = now()`,
      [target.id, result.url, result.source, result.credit, result.creditUrl],
    );
    found++;
    console.log(`[${position}/${targets.length}] ${target.name}: ${result.source} (${result.credit})`);
  } catch (error) {
    missing++;
    console.log(`[${position}/${targets.length}] ${target.name}: FAILED - ${(error as Error).message}`);
  }
}

const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) await handle(next);
}));

console.log(`\nFound: ${found}  No picture: ${missing}`);
await pool.end();
store.sqlite.close();
