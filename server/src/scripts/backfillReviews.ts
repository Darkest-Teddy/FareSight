// Gathers ratings and awards for every place on the site, from the open web.
//
//   pnpm --filter @faresight/server reviews            # only places never looked up
//   pnpm --filter @faresight/server reviews --all      # every place, ignoring what is stored
//   pnpm --filter @faresight/server reviews --stale 7  # anything not refreshed in 7 days
//   pnpm --filter @faresight/server reviews --limit 5  # a few, to try it out
//
// Sources are whatever a web search can actually cite: Tripadvisor, OpenTable, Restaurantji and
// similar. Google and Yelp cannot be gathered directly -- both prohibit scraping and block
// crawlers -- so they appear only where a licensed reseller republishes them with a citable URL.
//
// Results go to Postgres, so this needs DATABASE_URL. Seeded places keep whatever is already
// researched by hand in shared/src/placeFacts.ts; anything found here is stored alongside it.

import type { Place } from '@faresight/shared';
import { getConfig } from '../config.ts';
import { Store } from '../db/database.ts';
import { createPool, migrate } from '../db/pg.ts';
import { fetchLiveReviews } from '../services/liveReviews.ts';
import { cleanRatings, isAwardOrg } from '../services/reviewSources.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
};

const config = getConfig();
if (!config.accounts) throw new Error('Set DATABASE_URL first: results are stored in Postgres.');
if (!config.openaiKey) throw new Error('Set OPENAI_API_KEY first: the lookup uses the web search tool.');

const refreshAll = flag('all');
const staleDays = Number(value('stale') ?? 0);
const limit = Number(value('limit') ?? 0);
// The live service caps itself at four concurrent lookups; matching it here keeps this script
// from queueing work that only waits.
const CONCURRENCY = 4;

const pool = createPool(config.accounts.databaseUrlDirect);
await migrate(pool);
const store = new Store(config.database);

interface Target { id: string; name: string; place?: Place }

const seeded: Target[] = store.all('places').map((place: Place) => ({ id: place.id, name: place.name, place }));
const { rows: contributed } = await pool.query<{ id: string; name: string; category: string }>(
  "select id, name, category from contributed_places where status = 'published'",
);

/**
 * A contributed place has no Place record, so one is faked with just the fields the lookup reads:
 * the name and roughly where it is. Everything else the prompt uses is optional.
 */
const contributedTargets: Target[] = contributed.map((row) => ({
  id: row.id,
  name: row.name,
  place: {
    id: row.id, name: row.name, category: row.category, vibe: '',
    details: { address: null },
  } as unknown as Place,
}));

const all = [...seeded, ...contributedTargets];

const { rows: done } = await pool.query<{ place_id: string; fetched_at: Date; status: string }>(
  'select place_id, fetched_at, status from place_review_summary',
);
const seen = new Map(done.map((row) => [row.place_id, row]));

const cutoff = staleDays > 0 ? Date.now() - staleDays * 86_400_000 : undefined;
let targets = all.filter(({ id }) => {
  if (refreshAll) return true;
  const record = seen.get(id);
  if (!record) return true;
  // A failure is always worth retrying; an empty result usually means there is nothing to find.
  if (record.status === 'failed') return true;
  return cutoff !== undefined && record.fetched_at.getTime() < cutoff;
});
if (limit > 0) targets = targets.slice(0, limit);

console.log(`${all.length} places on the site; ${targets.length} to look up.`);
if (!targets.length) {
  console.log('Nothing to do. Use --all to refresh everything, or --stale <days>.');
  await pool.end();
  store.sqlite.close();
  process.exit(0);
}

let found = 0;
let empty = 0;
let failed = 0;
let awards = 0;
let index = 0;

async function handle(target: Target) {
  const position = ++index;
  try {
    // The per-IP limiter inside the service keys on this string; a constant marks it as internal.
    const result = await fetchLiveReviews(target.place!, config, 'backfill');
    const cleaned = cleanRatings(result.ratings ?? [], target.name);
    const stars = cleaned.filter((entry) => !isAwardOrg(entry.source));
    const guides = cleaned.filter((entry) => isAwardOrg(entry.source));

    await pool.query('begin');
    try {
      for (const entry of stars) {
        await pool.query(
          `insert into place_ratings (place_id, source, rating, rating_count, url, self_reported, fetched_at)
           values ($1, $2, $3, $4, $5, $6, now())
           on conflict (place_id, source) do update
             set rating = excluded.rating, rating_count = excluded.rating_count,
                 url = excluded.url, self_reported = excluded.self_reported, fetched_at = now()`,
          [target.id, entry.source, entry.rating, entry.count, entry.url, entry.selfReported],
        );
      }
      // A guide naming a venue is recognition, not a star rating, so it is recorded as an award.
      for (const guide of guides) {
        await pool.query(
          `insert into place_awards (place_id, title, org, year, url, fetched_at)
           values ($1, $2, $3, null, $4, now())
           on conflict (place_id, org, title) do update set url = excluded.url, fetched_at = now()`,
          [target.id, 'Listed', guide.source, guide.url],
        );
        awards++;
      }
      const status = stars.length || guides.length ? 'ok' : 'empty';
      await pool.query(
        `insert into place_review_summary (place_id, highlights, sources, status, fetched_at)
         values ($1, $2, $3, $4, now())
         on conflict (place_id) do update
           set highlights = excluded.highlights, sources = excluded.sources,
               status = excluded.status, fetched_at = now()`,
        [
          target.id,
          JSON.stringify((result.highlights ?? []).slice(0, 3)),
          JSON.stringify(cleaned.map((entry) => entry.source)),
          status,
        ],
      );
      await pool.query('commit');
      if (status === 'ok') found++; else empty++;
      const label = stars.map((entry) => `${entry.source} ${entry.rating}${entry.count ? ` (${entry.count})` : ''}`).join(', ');
      console.log(`[${position}/${targets.length}] ${target.name}: ${label || 'nothing citable'}`);
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }
  } catch (error) {
    failed++;
    await pool.query(
      `insert into place_review_summary (place_id, status, fetched_at) values ($1, 'failed', now())
       on conflict (place_id) do update set status = 'failed', fetched_at = now()`,
      [target.id],
    ).catch(() => undefined);
    console.log(`[${position}/${targets.length}] ${target.name}: FAILED - ${(error as Error).message}`);
  }
}

// A simple worker pool: each worker takes the next target until the queue is empty, so a slow
// lookup does not hold up the rest the way a fixed batch would.
const queue = [...targets];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  for (let next = queue.shift(); next; next = queue.shift()) await handle(next);
}));

console.log(`\nRated: ${found}  Nothing found: ${empty}  Failed: ${failed}  Awards: ${awards}`);
await pool.end();
store.sqlite.close();
