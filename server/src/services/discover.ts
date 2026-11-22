import type {
  Category, DiscoverPlace, DiscoverQuery, DiscoverResponse, DiscoverWindow, EngagementKind, GoogleRating, Place,
} from '@faresight/shared';
import { ENGAGEMENT_WEIGHTS, NEW_FOR_DAYS, STOPS, WINDOW_HOURS, chipCategories } from '@faresight/shared';
import type { Store } from '../db/database.ts';
import type { Accounts } from './accounts.ts';

/** How long a station may be from a place and still be used as its label. */
const STATION_LABEL_METRES = 800;
/** Velocity is recomputed at most this often. The ranking is therefore at most a minute stale. */
const SCORE_TTL_MS = 60_000;

export interface ContributedRow {
  id: string;
  created_by: string;
  name: string;
  category: Category;
  station_id: string | null;
  lat: number | null;
  lon: number | null;
  price_typical: string | null;
  note: string | null;
  address: string | null;
  status: 'published' | 'hidden' | 'removed';
  capture_id: string | null;
  asset_id: string | null;
  photo_urls: string[];
  google_place_id: string | null;
  created_at: Date;
  display_name: string;
  avatar_url: string | null;
  rating: number | null;
  rating_count: number | null;
  attribution: string[] | null;
  build_stage: string | null;
}

/** Great-circle distance in metres. Accurate enough at city scale to pick the nearest station. */
export function distanceMetres(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Picks the station a place is labelled with. This is a label and a filter only: a contributed
 * place is never drawn on a station map, so being far from every station is not an error, it
 * simply means the card shows an address instead (specification D6 and D9).
 */
export function nearestStation(lat: number | null, lon: number | null) {
  if (lat === null || lon === null) return undefined;
  let best: { stop_id: string; name: string; primary_color: string; distance: number } | undefined;
  for (const stop of STOPS) {
    const distance = distanceMetres(lat, lon, stop.lat, stop.lon);
    if (distance > STATION_LABEL_METRES) continue;
    if (!best || distance < best.distance) {
      best = { stop_id: stop.stop_id, name: stop.name, primary_color: stop.primary_color, distance };
    }
  }
  return best;
}

const stopsById = new Map(STOPS.map((stop) => [stop.stop_id, stop]));

function isNew(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() < NEW_FOR_DAYS * 86_400_000;
}

/** Best available rating for a seeded place, taken from the researched facts already in the catalogue. */
function catalogRating(place: Place): GoogleRating | null {
  const ratings = place.details?.ratings ?? [];
  const google = ratings.find(({ source }) => /google/i.test(source)) ?? ratings[0];
  if (!google || google.count === null || google.count === undefined) return null;
  return {
    rating: google.rating,
    rating_count: google.count,
    attribution: [google.source],
    url: google.url,
  };
}

function fromCatalog(place: Place, createdAt: Date): DiscoverPlace {
  const stop = stopsById.get(place.stop_id);
  return {
    id: place.id,
    name: place.name,
    category: place.category,
    station_id: place.stop_id,
    station_name: stop?.name ?? null,
    station_color: stop?.primary_color ?? null,
    locality: null,
    price_typical: place.typical_price,
    note: place.vibe,
    photo_urls: place.photos ?? [],
    asset_id: place.room_asset_id ?? place.rooms[0]?.asset_id ?? null,
    build_stage: null,
    rating: catalogRating(place),
    // Seeded places are part of the original catalogue, so they never wear the New badge.
    is_new: false,
    source: 'catalog',
    contributor: null,
    created_at: createdAt.toISOString(),
    score: null,
  };
}

function fromContributed(row: ContributedRow): DiscoverPlace {
  const stop = row.station_id ? stopsById.get(row.station_id) : undefined;
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    station_id: row.station_id,
    station_name: stop?.name ?? null,
    station_color: stop?.primary_color ?? null,
    locality: stop ? null : row.address,
    price_typical: row.price_typical === null ? null : Number(row.price_typical),
    note: row.note,
    photo_urls: row.photo_urls ?? [],
    asset_id: row.asset_id,
    build_stage: row.asset_id ? null : row.build_stage,
    // No Google match means no score at all: the card omits the ring rather than showing a zero
    // (specification D17).
    rating: row.rating === null || row.rating_count === null ? null : {
      rating: row.rating,
      rating_count: row.rating_count,
      attribution: row.attribution ?? ['Google'],
      url: row.google_place_id
        ? `https://www.google.com/maps/place/?q=place_id:${row.google_place_id}` : null,
    },
    is_new: isNew(row.created_at),
    source: 'contributed',
    contributor: { id: row.created_by, display_name: row.display_name, avatar_url: row.avatar_url },
    created_at: row.created_at.toISOString(),
    score: null,
  };
}

export function createDiscover(accounts: Accounts, store: Store) {
  // Seeded places have no creation date, so they share one: the catalogue's own epoch. It only has
  // to sort below anything a person adds, which it does.
  const catalogEpoch = new Date('2026-11-01T00:00:00Z');
  const scoreCache = new Map<DiscoverWindow, { at: number; scores: Map<string, number> }>();

  /**
   * Velocity: a weighted, time-decayed count of engagement inside the window.
   *
   * The decay is computed in SQL as 2 ^ (-age_hours / halflife), so a burst of attention an hour
   * ago outranks the same attention a week ago. Google ratings deliberately play no part: they
   * measure quality, not momentum (specification D13).
   */
  async function velocity(window: DiscoverWindow): Promise<Map<string, number>> {
    const cached = scoreCache.get(window);
    if (cached && Date.now() - cached.at < SCORE_TTL_MS) return cached.scores;
    const { span, halflife } = WINDOW_HOURS[window];
    const { rows } = await accounts.pool.query<{ place_id: string; score: string }>(
      // An upload always counts: it cost a real account and real photographs, so it cannot be
      // manufactured cheaply, and a place must be able to enter the ranking the moment it exists.
      //
      // The anonymous signals are the forgeable ones, so they only count once more than one
      // visitor has sent them. That stops a single person inflating a place by reloading it,
      // without punishing a place for being new.
      `select place_id,
              coalesce(sum($1::float * decay) filter (where kind = 'upload'), 0)
              + case when count(distinct session_hash) filter (where kind <> 'upload') > 1
                     then coalesce(sum(
                            case kind when 'splat_open' then $2::float else $3::float end * decay
                          ) filter (where kind <> 'upload'), 0)
                     else 0 end as score
         from (
           select place_id, kind, session_hash,
                  power(2, -extract(epoch from (now() - created_at)) / 3600.0 / $4::float) as decay
             from engagement_events
            where created_at > now() - make_interval(hours => $5)
         ) windowed
        group by place_id`,
      [ENGAGEMENT_WEIGHTS.upload, ENGAGEMENT_WEIGHTS.splat_open, ENGAGEMENT_WEIGHTS.card_view, halflife, span],
    );
    const scores = new Map(rows.map(({ place_id, score }) => [place_id, Number(score)]));
    scoreCache.set(window, { at: Date.now(), scores });
    return scores;
  }

  async function contributed(): Promise<DiscoverPlace[]> {
    const { rows } = await accounts.pool.query<ContributedRow>(
      `select p.*, u.display_name, u.avatar_url,
              g.rating, g.rating_count, g.attribution,
              j.status as build_stage
         from contributed_places p
         join users u on u.id = p.created_by
         left join place_google_cache g on g.google_place_id = p.google_place_id
         left join lateral (
           select status from jobs where jobs.capture_id = p.capture_id
            order by created_at desc limit 1
         ) j on true
        where p.status = 'published'
        order by p.created_at desc
        limit 500`,
    );
    return rows.map(fromContributed);
  }

  /**
   * Merges the seeded catalogue with contributed places, then filters, sorts and pages in memory.
   *
   * This loads every place on each request. At the scale this runs at — tens of seeded places and
   * a few hundred contributed ones — that is faster than two paginated queries stitched together,
   * and it keeps one ordering rather than two. It would need replacing before the contributed
   * table reaches thousands of rows.
   */
  async function list(query: DiscoverQuery): Promise<DiscoverResponse> {
    const sort = query.sort ?? 'new';
    const window = query.window ?? 'today';
    const limit = Math.min(60, Math.max(1, query.limit ?? 24));
    const offset = Math.max(0, Number(query.cursor ?? 0) || 0);

    const places = [
      ...store.all('places').map((place: Place) => fromCatalog(place, catalogEpoch)),
      ...await contributed(),
    ];

    const categories = new Set(chipCategories(query.chip));
    const needle = query.q?.trim().toLowerCase();
    let filtered = places.filter((place) => {
      if (categories.size && !categories.has(place.category)) return false;
      if (query.station && place.station_id !== query.station) return false;
      if (needle) {
        const haystack = `${place.name} ${place.note ?? ''} ${place.station_name ?? ''} ${place.category}`;
        if (!haystack.toLowerCase().includes(needle)) return false;
      }
      return true;
    });

    if (sort === 'popular') {
      const scores = await velocity(window);
      filtered = filtered
        .map((place) => ({ ...place, score: scores.get(place.id) ?? 0 }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0)
          || Date.parse(b.created_at) - Date.parse(a.created_at));
    } else if (sort === 'rated') {
      // A place with no Google match has nothing to sort by, so it is left out of this sort
      // entirely rather than being ranked as if it scored zero.
      filtered = filtered.filter((place) => place.rating).sort((a, b) => bayesian(b) - bayesian(a));
    } else {
      filtered.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    }

    const page = filtered.slice(offset, offset + limit);
    return {
      places: page,
      total: filtered.length,
      next_cursor: offset + limit < filtered.length ? String(offset + limit) : null,
    };
  }

  /**
   * Bayesian average, so one five-star rating cannot outrank a place with two hundred. `m` is the
   * weight given to the overall mean; a place needs roughly that many ratings before its own
   * average dominates.
   */
  const PRIOR_WEIGHT = 20;
  const PRIOR_MEAN = 4.2;
  function bayesian(place: DiscoverPlace): number {
    if (!place.rating) return 0;
    const { rating, rating_count: count } = place.rating;
    return (count * rating + PRIOR_WEIGHT * PRIOR_MEAN) / (count + PRIOR_WEIGHT);
  }

  /**
   * Records one engagement event, unless the same visitor already sent it recently.
   *
   * Deduplication happens here rather than in the ranking query so a single person cannot inflate
   * a place by reloading: one card view per place per hour, one splat open per ten minutes.
   */
  async function record(placeId: string, kind: EngagementKind, session: Buffer): Promise<boolean> {
    const cooldownMinutes = kind === 'card_view' ? 60 : 10;
    const { rowCount } = await accounts.pool.query(
      `insert into engagement_events (place_id, kind, session_hash)
       select $1, $2, $3
        where not exists (
          select 1 from engagement_events
           where place_id = $1 and kind = $2 and session_hash = $3
             and created_at > now() - make_interval(mins => $4)
        )`,
      [placeId, kind, session, cooldownMinutes],
    );
    return (rowCount ?? 0) > 0;
  }

  /** Clears the cached ranking so a brand-new place can appear in the popular sort immediately. */
  function invalidateScores() {
    scoreCache.clear();
  }

  return { list, velocity, record, invalidateScores, fromContributed };
}

export type Discover = ReturnType<typeof createDiscover>;
