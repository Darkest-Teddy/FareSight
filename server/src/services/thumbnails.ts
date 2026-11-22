import { createHash } from 'node:crypto';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Finds a photograph to represent a place on its Discover card.
 *
 * Two sources, both free and both intended for this:
 *
 * 1. The venue's own `og:image`. That tag exists precisely so a link to the page shows a picture
 *    the venue chose, so using it is the intended behaviour rather than a workaround. It is also
 *    the most honest option available: it is the venue's own photograph of itself.
 * 2. Wikipedia's page image, through the public REST summary endpoint. No key, generous limits,
 *    and it covers the landmarks a venue site cannot -- Fenway Park, Harvard Art Museums, the
 *    Charles River Esplanade.
 *
 * Deliberately not used: stock photography. A generic bowl of ramen on a specific ramen shop's
 * card would be a picture of nothing, and the request was for pictures that represent the places.
 * A place with no photograph keeps its tinted initial instead.
 *
 * Images are downloaded and stored rather than linked. Hotlinking spends someone else's bandwidth
 * on every card impression, and a remote image that disappears leaves a broken card.
 */

const MAX_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;
const USER_AGENT = 'FareSight/0.1 (BostonHacks 2026 project; venue thumbnails)';

/** Overpass mirrors, in order. The main endpoint does not resolve on every network. */
const OVERPASS_MIRRORS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];

const TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/avif': '.avif',
};

export interface ThumbnailResult {
  /** Path under /storage/thumbnails, ready to serve. */
  url: string;
  source: 'website' | 'wikipedia';
  /** Where the picture came from, for the credit shown on the card. */
  credit: string;
  creditUrl: string | null;
}

function timeout() {
  return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

/** Reads a page and returns the first og:image (or twitter:image) it declares. */
async function openGraphImage(website: string): Promise<{ image: string; page: string } | undefined> {
  let response: Response;
  try {
    response = await fetch(website, {
      headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      redirect: 'follow',
      signal: timeout(),
    });
  } catch {
    return undefined;
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) return undefined;

  // Only the head matters, and some restaurant sites are enormous single-page bundles.
  const html = (await response.text().catch(() => '')).slice(0, 400_000);
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const found = pattern.exec(html)?.[1];
    if (!found) continue;
    try {
      // Resolve against the page's final URL, since og:image is often a relative path.
      return { image: new URL(found, response.url).href, page: response.url };
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Words too common to identify a venue, so a match on them alone means nothing. */
const WEAK = new Set([
  'the', 'a', 'of', 'and', 'at', 'in', 'on', 'boston', 'cambridge', 'restaurant', 'cafe', 'café',
  'bar', 'grill', 'kitchen', 'house', 'shop', 'store', 'market', 'company', 'co', 'inc',
]);

/**
 * True when an article title plausibly names the same venue.
 *
 * Requires every distinctive word of the venue's name to appear in the title. That is strict on
 * purpose: a card showing the wrong building is worse than a card showing none.
 */
function titlesAgree(venue: string, title: string): boolean {
  const words = (value: string) => value.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1 && !WEAK.has(word));
  const wanted = words(venue);
  if (!wanted.length) return false;
  const have = new Set(words(title));
  return wanted.every((word) => have.has(word));
}

/** Wikipedia's own page image for a title, used for landmarks a venue site cannot cover. */
async function wikipediaImage(name: string, hint: string): Promise<{ image: string; page: string; title: string } | undefined> {
  const search = new URL('https://en.wikipedia.org/w/api.php');
  search.search = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search',
    gsrsearch: `${name} ${hint}`.trim(), gsrlimit: '1',
    prop: 'pageimages', piprop: 'original', pilicense: 'any',
  }).toString();
  try {
    const response = await fetch(search, { headers: { 'user-agent': USER_AGENT }, signal: timeout() });
    if (!response.ok) return undefined;
    const data = await response.json() as {
      query?: { pages?: Record<string, { title?: string; original?: { source?: string } }> };
    };
    const page = Object.values(data.query?.pages ?? {})[0];
    const image = page?.original?.source;
    if (!image || !page?.title) return undefined;
    // Wikipedia's search returns its best effort for any query, so an unrelated article comes
    // back rather than nothing: "Groovy Thrifty" matched an article called "Druware". Requiring
    // the article title to share the venue's distinctive words keeps those off the cards.
    if (!titlesAgree(name, page.title)) return undefined;
    return {
      image,
      page: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
      title: page.title,
    };
  } catch {
    return undefined;
  }
}

/**
 * Asks OpenStreetMap what it knows about a venue at a coordinate.
 *
 * Only 19 of the 60 seeded places carry a website in placeFacts, which caps how many can have an
 * og:image. OSM often has one for the rest, and sometimes an `image` tag pointing straight at a
 * photograph. Overpass is already a dependency of this project for building footprints.
 */
async function openStreetMapTags(
  name: string, lat: number, lon: number,
): Promise<{ website?: string; image?: string } | undefined> {
  // The first distinctive word is enough to match and survives the punctuation and suffixes that
  // differ between our catalogue and OSM ("El Jefe's Taqueria" against "El Jefe's").
  const [token] = name.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
  if (!token) return undefined;
  const filter = `["name"~"${token}",i](around:220,${lat},${lon})`;
  const query = `[out:json][timeout:20];(node${filter};way${filter};);out tags 3;`;
  // Several mirrors, tried in turn: the main endpoint is unreachable from some networks, and a
  // single hard-coded host makes this look like "OSM has nothing" when it is really a DNS failure.
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!response.ok) continue;
      const data = await response.json() as { elements?: { tags?: Record<string, string> }[] };
      for (const element of data.elements ?? []) {
        const tags = element.tags ?? {};
        const website = tags.website ?? tags['contact:website'] ?? tags.url;
        const image = tags.image;
        if (website || image) return { website, image };
      }
      // A clean answer with nothing useful means OSM genuinely has nothing; stop asking mirrors.
      return undefined;
    } catch {
      continue;
    }
  }
  return undefined;
}

/** Downloads an image and writes it under `directory`, named by the hash of its URL. */
async function store(imageUrl: string, directory: string): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(imageUrl, { headers: { 'user-agent': USER_AGENT }, signal: timeout() });
  } catch {
    return undefined;
  }
  if (!response.ok) return undefined;
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  const extension = TYPES[type];
  if (!extension) return undefined;
  // Trust the declared length when it is present, and check the real size after reading anyway:
  // a wrong or absent header should not let an unbounded download through.
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return undefined;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) return undefined;

  const name = createHash('sha256').update(imageUrl).digest('hex').slice(0, 32) + extension;
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, name), bytes);
  return `/storage/thumbnails/${name}`;
}

/**
 * Finds and stores one thumbnail for a place.
 *
 * The venue's own site is tried first, because its own photograph beats an encyclopaedia's. For a
 * landmark, a stadium or a park, Wikipedia is usually the only source and is tried either way.
 */
export async function fetchThumbnail(
  place: {
    name: string; category: string;
    website?: string | null; locality?: string | null;
    lat?: number | null; lon?: number | null;
  },
  directory: string,
): Promise<ThumbnailResult | undefined> {
  const fromSite = async (website: string): Promise<ThumbnailResult | undefined> => {
    const found = await openGraphImage(website);
    if (!found) return undefined;
    const url = await store(found.image, directory);
    if (!url) return undefined;
    let host = website;
    try { host = new URL(found.page).hostname.replace(/^www\./, ''); } catch { /* keep as given */ }
    return { url, source: 'website', credit: host, creditUrl: found.page };
  };

  if (place.website) {
    const result = await fromSite(place.website);
    if (result) return result;
  }

  // Most places carry no website in the catalogue, so ask OpenStreetMap for one before giving up.
  if (!place.website && typeof place.lat === 'number' && typeof place.lon === 'number') {
    const tags = await openStreetMapTags(place.name, place.lat, place.lon);
    if (tags?.image) {
      const url = await store(tags.image, directory);
      if (url) return { url, source: 'wikipedia', credit: 'OpenStreetMap contributors', creditUrl: 'https://www.openstreetmap.org/copyright' };
    }
    if (tags?.website) {
      const result = await fromSite(tags.website);
      if (result) return result;
    }
  }

  // Categories where an encyclopaedia entry is likely, and a venue website often is not.
  const encyclopaedic = ['stadium', 'museum', 'outdoor', 'music', 'hotel', 'event_space'];
  const worthTrying = encyclopaedic.includes(place.category) || !place.website;
  if (worthTrying) {
    const found = await wikipediaImage(place.name, place.locality ?? 'Boston');
    if (found) {
      const url = await store(found.image, directory);
      if (url) return { url, source: 'wikipedia', credit: `Wikipedia: ${found.title}`, creditUrl: found.page };
    }
  }
  return undefined;
}

/** Thumbnails already on disk, so a re-run skips what it has. */
export async function storedThumbnails(directory: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(directory));
  } catch {
    return new Set();
  }
}
