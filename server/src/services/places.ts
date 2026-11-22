import type { Place } from '@faresight/shared';
import type { Store } from '../db/database.ts';
import type { Accounts } from './accounts.ts';

/**
 * Whether a place id names something real, in either store.
 *
 * There are two kinds of place and they live in different databases. The seeded catalogue is a
 * SQLite table; a place somebody added from the phone is a `contributed_places` row in Postgres
 * and is deliberately kept out of SQLite, because everything that reads the SQLite catalogue also
 * draws the station maps, and contributed places must never appear there (specification D6).
 *
 * Every upload route checked only SQLite, so a place added through "Somewhere else" was created
 * successfully and then rejected with "Place not found" the moment its first photograph was
 * sent: the button worked and the feature behind it could not.
 *
 * Returns the catalogue record when there is one, since callers need it for dish lookups. A
 * contributed place resolves with no record, which is correct: it has no dishes.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePlace(
  store: Store, accounts: Accounts | undefined, placeId: string,
): Promise<{ exists: boolean; place?: Place }> {
  const place = store.get('places', placeId) as Place | undefined;
  if (place) return { exists: true, place };
  // `contributed_places.id` is a uuid column, so anything else makes Postgres raise rather than
  // return no rows. A seeded id like "bu-starbucks-01" would have matched SQLite already.
  if (!accounts || !UUID.test(placeId)) return { exists: false };
  // Hidden and removed places are not somewhere to send more photographs.
  const { rowCount } = await accounts.pool.query(
    "select 1 from contributed_places where id = $1 and status = 'published'",
    [placeId],
  );
  return { exists: (rowCount ?? 0) > 0 };
}
