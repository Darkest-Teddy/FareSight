import type { PlaceRating } from '@faresight/shared';

/**
 * Normalises the review sources a web search returns.
 *
 * This exists because the search names the same site differently every time: one lookup returned
 * "Birdeye (Google reviews)", another "Restaurantji", another the venue's own name. Left as-is,
 * the same site fragments across refreshes, a place looks rated by four sources when it is rated
 * by two, and any comparison between two lookups is meaningless.
 *
 * Google and Yelp cannot be gathered directly: both prohibit scraping and block crawlers, so a
 * search cannot cite them. They appear here only when a licensed reseller republishes them with a
 * citable URL, which is why "Birdeye (Google reviews)" maps to Google rather than to Birdeye --
 * the underlying ratings are Google's.
 */

/** Matched against the source name and its URL host, in order. First hit wins. */
const CANONICAL: { name: string; patterns: RegExp[] }[] = [
  { name: 'Google', patterns: [/\bgoogle\b/i, /\bbirdeye\b/i] },
  { name: 'Yelp', patterns: [/\byelp\b/i] },
  { name: 'Tripadvisor', patterns: [/\btrip\s*advisor\b/i] },
  { name: 'OpenTable', patterns: [/\bopen\s*table\b/i] },
  { name: 'Restaurantji', patterns: [/\brestaurantji\b/i] },
  { name: 'Resy', patterns: [/\bresy\b/i] },
  { name: 'Uber Eats', patterns: [/\buber\s*eats\b/i] },
  { name: 'DoorDash', patterns: [/\bdoordash\b/i] },
  { name: 'Grubhub', patterns: [/\bgrubhub\b/i] },
  { name: 'Facebook', patterns: [/\bfacebook\b/i, /\bmeta\b/i] },
  { name: 'Zomato', patterns: [/\bzomato\b/i] },
  { name: 'Foursquare', patterns: [/\bfoursquare\b/i] },
  { name: 'The Infatuation', patterns: [/\binfatuation\b/i] },
  { name: 'Eater', patterns: [/\beater\b/i] },
  { name: 'Boston Magazine', patterns: [/\bboston\s*magazine\b/i] },
  { name: 'Michelin Guide', patterns: [/\bmichelin\b/i] },
  { name: 'James Beard Foundation', patterns: [/\bjames\s*beard\b/i] },
];

/** Sites that confer recognition rather than a star rating. Their mentions become awards. */
const AWARD_ORGS = new Set(['Michelin Guide', 'James Beard Foundation', 'Eater', 'Boston Magazine', 'The Infatuation']);

function host(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Maps a raw source label and its URL onto a canonical name.
 *
 * Returns undefined when neither the label nor the host matches anything known, which is the
 * signal to drop the rating rather than invent a source for it. A venue's own name arriving as a
 * "source" is exactly that case.
 */
export function normaliseSource(raw: string, url?: string | null): string | undefined {
  const haystack = `${raw} ${host(url)}`;
  for (const { name, patterns } of CANONICAL) {
    if (patterns.some((pattern) => pattern.test(haystack))) return name;
  }
  return undefined;
}

/**
 * True when the "source" is the venue itself.
 *
 * A live lookup once returned Shabu-Zen rating Shabu-Zen 4.5 out of 1,617. A venue's own figure is
 * not independent evidence, so it is stored but kept out of the headline score.
 */
export function isSelfReported(raw: string, placeName: string, url?: string | null): boolean {
  const simplify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const source = simplify(raw);
  const place = simplify(placeName);
  if (source && place && (source.includes(place) || place.includes(source))) return true;
  // The venue's own domain usually contains most of its name.
  const domain = simplify(host(url).replace(/^www\./, '').split('.')[0] ?? '');
  return Boolean(domain && place && domain.length > 3 && place.includes(domain));
}

export interface CleanRating {
  source: string;
  rating: number;
  count: number | null;
  url: string | null;
  selfReported: boolean;
}

/**
 * Cleans a batch of ratings: canonicalises names, drops unrecognisable ones, flags self-reported
 * figures, and keeps the best entry per source.
 *
 * "Best" means the one with a review count over one without, then the larger count, because a
 * rating without a count cannot be weighed against anything.
 */
export function cleanRatings(raw: PlaceRating[], placeName: string): CleanRating[] {
  const bySource = new Map<string, CleanRating>();
  for (const entry of raw) {
    if (typeof entry?.rating !== 'number' || !Number.isFinite(entry.rating)) continue;
    // Everything here is on a five-point scale, where the lowest a real review can score is one.
    // A literal 0 is how "no rating published" comes back misparsed, and letting it through drags
    // the weighted average down: one such entry moved a cafe from 4.45 to 3.97.
    if (entry.rating < 1 || entry.rating > 5) continue;
    const source = normaliseSource(entry.source ?? '', entry.url);
    if (!source) continue;
    const candidate: CleanRating = {
      source,
      rating: Math.round(entry.rating * 10) / 10,
      count: typeof entry.count === 'number' && entry.count >= 0 ? entry.count : null,
      url: entry.url ?? null,
      selfReported: isSelfReported(entry.source ?? '', placeName, entry.url),
    };
    const existing = bySource.get(source);
    if (!existing) { bySource.set(source, candidate); continue; }
    const better = (candidate.count ?? -1) > (existing.count ?? -1);
    if (better) bySource.set(source, candidate);
  }
  return [...bySource.values()];
}

/** True when a canonical source is a guide or award body rather than a star-rating site. */
export function isAwardOrg(source: string): boolean {
  return AWARD_ORGS.has(source);
}

/**
 * Combines several sources into one rating, on the same five-point scale the inputs use.
 *
 * It stays on five points rather than converting to the ten the card shows, because the card does
 * that conversion itself. Returning ten here would double it.
 *
 * Weighted by review count, so a site with two thousand ratings outweighs one with twelve, and
 * self-reported figures are excluded entirely. A source with no count still contributes, at the
 * weight of a small sample, because dropping it would discard the only evidence for some places.
 */
export function combinedScore(ratings: CleanRating[]): { score: number; count: number } | undefined {
  const usable = ratings.filter((entry) => !entry.selfReported && !isAwardOrg(entry.source));
  if (!usable.length) return undefined;
  const ASSUMED_COUNT = 25;
  let weighted = 0;
  let weight = 0;
  let total = 0;
  for (const entry of usable) {
    const n = entry.count ?? ASSUMED_COUNT;
    weighted += entry.rating * n;
    weight += n;
    total += entry.count ?? 0;
  }
  if (!weight) return undefined;
  return { score: Math.round((weighted / weight) * 100) / 100, count: total };
}
