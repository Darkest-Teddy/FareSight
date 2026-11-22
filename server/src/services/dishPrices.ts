import type pg from 'pg';
import type { LiveDishPrice } from '@faresight/shared';

/**
 * Menu prices held in Tiger Data, keyed by catalogue dish id.
 *
 * The prices compiled into `shared/src/restaurantDishes.ts` stay the floor: they ship with the
 * client and work with no database at all. This table is the layer above it, holding every price
 * found after that file was last written, so a lookup done once is visible to everyone and
 * survives a restart instead of living in one process's memory.
 *
 * Reads are served from a small cache because the whole table is a few dozen rows and every
 * catalogue response needs it. Writes refresh that cache immediately, so a backfill run shows up
 * on the next request rather than at the next expiry.
 */

export interface StoredDishPrice {
  price: number;
  source: string;
  url: string | null;
  thirdParty: boolean;
  fetchedAt: string;
}

interface Row {
  dish_id: string;
  price: string;
  source: string;
  url: string | null;
  third_party: boolean;
  fetched_at: Date;
}

/** Long enough that a burst of requests costs one query, short enough that a backfill lands fast. */
const cacheTtl = 60_000;

let cache: Map<string, StoredDishPrice> | undefined;
let expires = 0;
let inFlight: Promise<Map<string, StoredDishPrice>> | undefined;

function toMap(rows: Row[]): Map<string, StoredDishPrice> {
  return new Map(rows.map((row) => [row.dish_id, {
    // `numeric` arrives as a string so no amount is silently rounded in transit; the column is
    // already at cent precision, so parsing here is exact.
    price: Number(row.price),
    source: row.source,
    url: row.url,
    thirdParty: row.third_party,
    fetchedAt: row.fetched_at.toISOString(),
  }]));
}

/**
 * Every stored price, cached. Returns an empty map if the table cannot be read, so a database
 * that is down degrades the catalogue to its compiled-in prices rather than failing the request.
 */
export async function loadDishPrices(pool: pg.Pool): Promise<Map<string, StoredDishPrice>> {
  if (cache && expires > Date.now()) return cache;
  // A second caller arriving mid-query waits for that query rather than starting another.
  inFlight ??= pool.query<Row>('select dish_id, price, source, url, third_party, fetched_at from dish_prices')
    .then(({ rows }) => {
      cache = toMap(rows);
      expires = Date.now() + cacheTtl;
      return cache;
    })
    .catch(() => cache ?? new Map<string, StoredDishPrice>())
    .finally(() => { inFlight = undefined; });
  return inFlight;
}

/**
 * Records prices found for one place. Re-finding a dish overwrites the row, because the newer
 * lookup read a newer menu; a dish absent from `prices` is left alone rather than deleted, so a
 * partial run never clears a price an earlier run established.
 */
export async function saveDishPrices(
  pool: pg.Pool, placeId: string, prices: readonly LiveDishPrice[], thirdParty = false,
): Promise<number> {
  if (!prices.length) return 0;
  const { rowCount } = await pool.query(
    `insert into dish_prices (dish_id, place_id, price, source, url, third_party)
     select * from unnest($1::text[], $2::text[], $3::numeric[], $4::text[], $5::text[], $6::boolean[])
     on conflict (dish_id) do update set
       place_id = excluded.place_id, price = excluded.price, source = excluded.source,
       url = excluded.url, third_party = excluded.third_party, fetched_at = now()`,
    [
      prices.map(({ dish_id }) => dish_id),
      prices.map(() => placeId),
      prices.map(({ price }) => price),
      prices.map(({ source }) => source),
      prices.map(({ url }) => url ?? null),
      prices.map(() => thirdParty),
    ],
  );
  // The next read must see what was just written, not the map this write was computed against.
  expires = 0;
  return rowCount ?? 0;
}

/** Drops the cache. For tests and for a process that has just migrated. */
export function resetDishPriceCache(): void {
  cache = undefined;
  expires = 0;
}
