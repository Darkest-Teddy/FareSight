// Finds a freely licensed photo for each place and writes contribute/src/data/place-photos.json.
// Run: pnpm --filter @faresight/contribute photos [-- --review <dir>] [-- --refresh]
//
// Sources: Wikimedia Commons (by name, and by what was photographed within a short walk of the place) and
// Openverse, which indexes Creative Commons photos from Flickr and others. Every photo keeps its author,
// licence and source page, because those licences require the credit to be shown next to the picture.
//
// Places that already have an entry are left alone, so a hand-picked photo survives a rerun. Pass --refresh
// to search for every place again. With --review the candidates for each place are written to an HTML
// contact sheet, which is how a wrong match gets noticed: a search by name cannot tell two branches of a
// chain apart, or a venue from a band that played there.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoPlaces } from '../../shared/dist/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const outFile = resolve(root, 'src/data/place-photos.json');
const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const reviewDir = args.includes('--review') ? args[args.indexOf('--review') + 1] : undefined;

const AGENT = 'place-photo-finder/1.0';
const THUMB_WIDTH = 960;
const CANDIDATES = 4;
// Words too common in venue names to tell one place from another.
const COMMON = new Set(['the', 'at', 'and', 'of', 'a', 'restaurant', 'cafe', 'coffee', 'house', 'bakery', 'bar', 'kitchen',
  'drinks', 'boston', 'cuisine', 'grill', 'grille', 'pizza', 'seafood', 'foods', 'store', 'cafeteria', 'bistro', 'select']);
const cityOf = (stopId) => ['place-harsq', 'place-cntsq'].includes(stopId) ? 'Cambridge'
  : stopId === 'place-cool' ? 'Brookline' : 'Boston';

const plain = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const words = (text) => plain(text).replace(/['’]s\b/g, 's').split(/[^a-z0-9]+/).filter(Boolean);
const stripTags = (html = '') => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': AGENT }, signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
    if (response?.ok) return response.json();
    await sleep(1500 * (attempt + 1));
  }
  return undefined;
}

function metres(a, b) {
  const y = (a.lat - b.lat) * 110_540;
  const x = (a.lon - b.lon) * 111_320 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(x, y);
}

/** What a place's name must contribute to a photo's caption for the photo to count as being of that place. */
function nameTest(place) {
  const simple = place.name.replace(/\(.*?\)/g, ' ').split(/[–—]/)[0];
  const distinct = words(simple).filter((word) => !COMMON.has(word) && word.length > 1);
  const phrase = words(simple).join(' ');
  return (caption) => {
    const text = ` ${words(caption).join(' ')} `;
    return distinct.length ? distinct.every((word) => text.includes(` ${word} `)) : text.includes(` ${phrase} `);
  };
}

function commonsCandidates(pages, place, matches) {
  return Object.values(pages ?? {}).flatMap((page) => {
    const info = page.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    if (!info?.thumburl || !/^image\/(jpeg|png)$/.test(info.mime) || info.width < 640) return [];
    const title = page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, '').replace(/_/g, ' ');
    const caption = `${title} ${stripTags(meta.ImageDescription?.value)} ${stripTags(meta.Categories?.value)}`;
    if (!matches(caption)) return [];
    const license = meta.LicenseShortName?.value;
    if (!license) return [];
    const at = page.coordinates?.[0];
    const distance = at ? metres(place, { lat: at.lat, lon: at.lon }) : undefined;
    // A geotagged photo taken far from the place is of something else with the same name.
    if (distance !== undefined && distance > 1200) return [];
    return [{
      url: info.thumburl.split('?')[0], width: info.thumbwidth, height: info.thumbheight, title,
      credit: stripTags(meta.Artist?.value) || 'Unknown author', license, license_url: meta.LicenseUrl?.value ?? null,
      page: info.descriptionurl, provider: 'Wikimedia Commons', distance,
    }];
  });
}

const COMMONS = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo%7Ccoordinates'
  + `&iiprop=url%7Csize%7Cmime%7Cextmetadata&iiurlwidth=${THUMB_WIDTH}`;
const searchName = (place) => place.name.replace(/\(.*?\)/g, ' ').split(/[–—]/)[0].trim();
const near = (place, radius) => `${COMMONS}&generator=geosearch&ggsnamespace=6&ggslimit=50&ggsradius=${radius}&ggscoord=${place.lat}%7C${place.lon}`;
// A caption that places a photo in or around Boston.
const LOCAL = /\b(boston|cambridge|brookline|allston|brighton|massachusetts|fenway|back bay|north end|chinatown)\b/;

async function fromCommons(place, matches) {
  const name = searchName(place);
  const city = cityOf(place.stop_id);
  const found = [];
  // The exact name first, then its words in any order, which catches captions that word it differently.
  for (const query of [`"${name}" ${city}`, `${name} ${city}`]) {
    const named = await getJson(`${COMMONS}&generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(query)}`);
    found.push(...commonsCandidates(named?.query?.pages, place, matches));
  }
  found.push(...commonsCandidates((await getJson(near(place, 250)))?.query?.pages, place, matches));
  return found;
}

/**
 * For a place nobody has photographed under a free licence: the street or building it stands on, taken
 * within a short walk. These are marked `nearby`, and the app says so instead of passing them off as the venue.
 */
async function nearbyCommons(place) {
  const pages = (await getJson(near(place, 180)))?.query?.pages;
  const skip = /portrait|map|plan|logo|plaque|sign|interior|inside|train|trolley|station|bus|crash|protest|parade|marathon|people|selfie|graffiti|detail|mural|statue|\b(19|18)\d\d\b/;
  return commonsCandidates(pages, place, () => true)
    .filter((candidate) => candidate.width > candidate.height * 1.2 && !skip.test(plain(candidate.title)))
    .sort((a, b) => (a.distance ?? 999) - (b.distance ?? 999))
    .map((candidate) => ({ ...candidate, nearby: true }));
}

async function fromOpenverse(place, matches) {
  const name = searchName(place);
  const city = cityOf(place.stop_id);
  const results = [];
  for (const query of [`"${name}" ${city}`, `${name} ${city}`, `"${name}"`]) {
    const found = await getJson(`https://api.openverse.org/v1/images/?page_size=20&q=${encodeURIComponent(query)}`);
    results.push(...(found?.results ?? []));
  }
  return results.flatMap((image) => {
    const caption = `${image.title ?? ''} ${(image.tags ?? []).map((tag) => tag.name).join(' ')}`;
    // Without a local word in the caption, a matching name is most likely another city's branch.
    if (!LOCAL.test(plain(caption))) return [];
    if (!image.url || (image.width ?? 0) < 640 || !matches(caption) || image.source === 'wikimedia') return [];
    const license = image.license === 'cc0' ? 'CC0' : image.license === 'pdm' ? 'Public domain'
      : `CC ${image.license.toUpperCase()} ${image.license_version ?? ''}`.trim();
    return [{
      url: image.url, width: image.width, height: image.height, title: image.title ?? name,
      credit: image.creator ?? 'Unknown author', license, license_url: image.license_url ?? null,
      page: image.foreign_landing_url, provider: image.source === 'flickr' ? 'Flickr' : image.source,
    }];
  });
}

/** Photos that show the place itself rank above photos that only mention it. */
function score(candidate) {
  const title = plain(candidate.title);
  let points = candidate.provider === 'Wikimedia Commons' ? 2 : 0;
  if (candidate.width > candidate.height * 1.15) points += 2;
  if (candidate.distance !== undefined && candidate.distance < 250) points += 3;
  if (/exterior|interior|storefront|facade|entrance|outside|inside|building|dining room/.test(title)) points += 2;
  if (/menu|logo|map|poster|ticket|sign only|receipt|portrait/.test(title)) points -= 3;
  if (/\bnd\b/i.test(candidate.license)) points -= 1;
  return points;
}

const saved = refresh ? {} : JSON.parse((() => { try { return readFileSync(outFile, 'utf8'); } catch { return '{}'; } })());
const review = [];
for (const place of demoPlaces) {
  if (saved[place.id]) {
    review.push({ place, candidates: [saved[place.id]], kept: true });
    continue;
  }
  const matches = nameTest(place);
  const seen = new Set();
  const exact = [...await fromCommons(place, matches), ...await fromOpenverse(place, matches)]
    .filter((candidate) => !seen.has(candidate.url) && seen.add(candidate.url))
    .sort((a, b) => score(b) - score(a));
  const candidates = (exact.length ? exact : await nearbyCommons(place)).slice(0, CANDIDATES);
  review.push({ place, candidates });
  if (candidates[0]) {
    const { distance, title, ...photo } = candidates[0];
    saved[place.id] = photo;
  }
  console.log(`${place.id.padEnd(28)} ${candidates.length ? `${candidates.length} found · ${candidates[0].provider}${candidates[0].nearby ? ' · nearby' : ''}` : 'none'}`);
  await sleep(250);
}

writeFileSync(outFile, JSON.stringify(Object.fromEntries(demoPlaces.filter(({ id }) => saved[id]).map(({ id }) => [id, saved[id]])), null, 2) + '\n');
console.log(`${Object.keys(saved).length} of ${demoPlaces.length} places have a photo → ${outFile}`);

if (reviewDir) {
  mkdirSync(reviewDir, { recursive: true });
  const escape = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const rows = review.map(({ place, candidates, kept }, index) => `<section><h2>${index + 1}. ${escape(place.name)} <small>${place.id}${kept ? ' · kept' : ''}</small></h2><div>${
    candidates.map((candidate, pick) => `<figure><img loading="eager" src="${escape(candidate.url)}"><figcaption>${pick}: ${escape((candidate.title ?? '').slice(0, 60))}<br>${escape(candidate.provider)} · ${escape(candidate.license)}</figcaption></figure>`).join('') || '<p>No candidates</p>'
  }</div></section>`).join('\n');
  writeFileSync(resolve(reviewDir, 'candidates.json'), JSON.stringify(review.map(({ place, candidates }) => ({ id: place.id, name: place.name, candidates })), null, 2));
  writeFileSync(resolve(reviewDir, 'review.html'), `<!doctype html><meta charset="utf-8"><style>
    body { margin: 8px; font: 12px/1.3 sans-serif; } section { break-inside: avoid; margin-bottom: 6px; } h2 { margin: 0 0 2px; font-size: 13px; }
    small { color: #777; font-weight: 400; } div { display: flex; gap: 6px; } figure { margin: 0; width: 230px; }
    img { display: block; width: 230px; height: 130px; object-fit: cover; background: #ddd; } figcaption { font-size: 10px; color: #444; }
  </style>${rows}`);
  console.log(`Review sheet → ${resolve(reviewDir, 'review.html')}`);
}
