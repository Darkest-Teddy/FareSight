import type { Category, NearbyCandidate } from '@faresight/shared';
import type { Accounts } from './accounts.ts';
import { distanceMetres } from './discover.ts';

/**
 * Google Places, used for two things and only two things:
 *
 * 1. Offering the contributor a list of nearby venues to pick from, so a place gets a real name
 *    and address instead of a typed guess (specification D16).
 * 2. Showing a rating on a card (D14).
 *
 * It never ranks anything (D13). That is what lets this module cache only the latest values and
 * keep no history: a velocity measure would need a time series of review counts, and storing that
 * would run into the retention limits in Google's terms. Ranking on internal engagement sidesteps
 * the problem rather than working around it.
 *
 * The whole module is optional. With no GOOGLE_PLACES_API_KEY the nearby search returns nothing,
 * contributors type a name themselves, and cards simply carry no score.
 */

const SEARCH_RADIUS_M = 200;
const CACHE_TTL_MS = 24 * 60 * 60_000;
const ENDPOINT = 'https://places.googleapis.com/v1/places:searchNearby';

/** Google's primary type for a venue, mapped onto the categories this app already models. */
const TYPE_TO_CATEGORY: [RegExp, Category][] = [
  [/^(cafe|coffee_shop|bakery|tea_house)$/, 'study'],
  [/^(restaurant|.*_restaurant|meal_takeaway|meal_delivery|food_court|fast_food.*)$/, 'restaurant'],
  [/^(grocery_store|supermarket|market|convenience_store)$/, 'market'],
  [/^(bar|night_club|concert_hall|performing_arts_theater)$/, 'music'],
  [/^(stadium|arena|sports_complex)$/, 'stadium'],
  [/^(museum|art_gallery)$/, 'museum'],
  [/^(hotel|lodging|motel)$/, 'hotel'],
  [/^(park|hiking_area|dog_park|plaza)$/, 'outdoor'],
  [/^(event_venue|banquet_hall|wedding_venue)$/, 'event_space'],
  [/^(store|shopping_mall|clothing_store|book_store|.*_store)$/, 'shop'],
];

function toCategory(types: string[] | undefined): Category {
  for (const type of types ?? []) {
    for (const [pattern, category] of TYPE_TO_CATEGORY) if (pattern.test(type)) return category;
  }
  return 'restaurant';
}

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  rating?: number;
  userRatingCount?: number;
  primaryType?: string;
  types?: string[];
  googleMapsUri?: string;
}

export function createGooglePlaces(accounts: Accounts, onError: (error: unknown) => void) {
  const key = accounts.settings.googlePlacesKey;

  /**
   * Lists venues near a coordinate, nearest first, flagging any whose name matches what Gemini
   * read off the photographs so the app can preselect it.
   *
   * Returns an empty list rather than throwing when Places is unconfigured or unreachable: the
   * contributor can always type a name instead, so a failure here must not block an upload.
   */
  async function nearby(
    lat: number, lon: number, suggestedName: string | undefined,
  ): Promise<NearbyCandidate[]> {
    if (!key) return [];
    let places: GooglePlace[];
    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': [
            'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
            'places.rating', 'places.userRatingCount', 'places.primaryType', 'places.types',
          ].join(','),
        },
        body: JSON.stringify({
          maxResultCount: 15,
          rankPreference: 'DISTANCE',
          locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: SEARCH_RADIUS_M } },
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) {
        onError(new Error(`Places nearby search failed: ${response.status}`));
        return [];
      }
      places = ((await response.json()) as { places?: GooglePlace[] }).places ?? [];
    } catch (error) {
      onError(error);
      return [];
    }

    const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const target = suggestedName ? normalise(suggestedName) : '';
    return places
      .filter((place) => place.location && place.displayName?.text)
      .map((place): NearbyCandidate => {
        const name = place.displayName!.text!;
        const normalised = normalise(name);
        return {
          google_place_id: place.id,
          name,
          category: toCategory([place.primaryType, ...(place.types ?? [])].filter(Boolean) as string[]),
          address: place.formattedAddress ?? null,
          lat: place.location!.latitude,
          lon: place.location!.longitude,
          distance_m: Math.round(distanceMetres(lat, lon, place.location!.latitude, place.location!.longitude)),
          rating: place.rating ?? null,
          rating_count: place.userRatingCount ?? null,
          // A substring match either way, so "Nud Pob" matches "Nud Pob Thai Cuisine".
          suggested: Boolean(target && normalised && (normalised.includes(target) || target.includes(normalised))),
        };
      })
      .sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.distance_m - b.distance_m);
  }

  /**
   * Stores the latest rating for a place, and only the latest. Re-fetching is left to `refresh`,
   * which runs when a cached row is older than a day.
   */
  async function cache(
    googlePlaceId: string,
    values: { rating: number | null; ratingCount: number | null; address: string | null },
  ) {
    await accounts.pool.query(
      `insert into place_google_cache (google_place_id, rating, rating_count, address, attribution, fetched_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (google_place_id) do update
         set rating = excluded.rating, rating_count = excluded.rating_count,
             address = excluded.address, fetched_at = now()`,
      [googlePlaceId, values.rating, values.ratingCount, values.address, JSON.stringify(['Google'])],
    );
  }

  /** True when the cached row is missing or older than the cache window. */
  async function isStale(googlePlaceId: string): Promise<boolean> {
    const { rows } = await accounts.pool.query<{ stale: boolean }>(
      'select fetched_at < now() - make_interval(secs => $2) as stale from place_google_cache where google_place_id = $1',
      [googlePlaceId, CACHE_TTL_MS / 1000],
    );
    return rows[0]?.stale ?? true;
  }

  return { enabled: Boolean(key), nearby, cache, isStale };
}

export type GooglePlaces = ReturnType<typeof createGooglePlaces>;
