import { STOPS, type Place } from '@faresight/shared';
import { catalogReviewSnapshots, type BriefingAction, type BriefingCard, type BriefingFact, type BriefingReview, type BriefingSection, type ReviewSnapshot } from './reviewBriefing';
type Fields = Record<string, unknown>;

function fields(value: unknown): Fields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a briefing object.');
  return value as Fields;
}

function optionalText(value: unknown, limit = 180): string | undefined {
  return typeof value === 'string' ? value.trim().slice(0, limit) || undefined : undefined;
}

function requiredText(value: unknown, name: string, limit = 180): string {
  const text = optionalText(value, limit);
  if (!text) throw new Error(`Provide ${name} for the briefing.`);
  return text;
}

function items(value: unknown, label: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`Provide ${min}–${max} ${label}.`);
  return value;
}

function facts(value: unknown, maximum: number): BriefingFact[] | undefined {
  if (value === undefined) return undefined;
  return items(value, 'key-value facts', 0, maximum).map((entry) => {
    const { label, value } = fields(entry);
    return { label: requiredText(label, 'a fact label', 55), value: requiredText(value, 'a fact value', 100) };
  });
}

export function composeBriefingCard(id: string, args: Fields, places: readonly Place[], snapshots: ReadonlyMap<string, ReviewSnapshot[]>): BriefingCard {
  const catalog = new Map(places.map((place) => [place.id, place]));
  const reviews = places.flatMap((place) => {
    const published = snapshots.get(place.id) ?? catalogReviewSnapshots(place);
    return published.map((review) => ({ ...review, placeId: place.id, placeName: place.name }));
  });

  function resolveReview(entry: unknown): BriefingReview[] {
    const input = fields(entry);
    const placeId = optionalText(input.placeId);
    const place = placeId ? catalog.get(placeId) : undefined;
    if (placeId && !place) throw new Error('A review references an unknown venue ID.');
    const source = place ? reviews.filter((review) => review.placeId === place.id) : reviews;
    const fromCatalog = (review: typeof reviews[number], text = review.text): BriefingReview => ({
      placeId: review.placeId, placeName: review.placeName, author: review.author_label, text, sample: review.sample,
      live: review.live, source: review.source, rating: review.rating, date_label: review.date_label, url: review.url, unverified: false,
    });
    const reviewId = optionalText(input.reviewId);
    if (reviewId) {
      const review = source.find(({ id }) => id === reviewId);
      if (!review) throw new Error('Review ID is unavailable for that venue. Look up the venue details again.');
      return [fromCatalog(review)];
    }
    const excerpt = optionalText(input.text, 1000);
    const author = optionalText(input.author, 80);
    const placeName = place?.name ?? optionalText(input.placeName, 120);
    if (excerpt) {
      const candidates = source.filter((review) => review.text.includes(excerpt));
      const attributed = candidates.filter((review) => (!author || review.author_label === author) && (!placeName || review.placeName === placeName));
      const match = attributed.length === 1 ? attributed[0] : candidates.length === 1 ? candidates[0] : undefined;
      if (match) return [fromCatalog(match, excerpt)];
      if (!author || !placeName) throw new Error('Provide an author and venue for an excerpt, or use a catalog review ID.');
      const rating = typeof input.rating === 'number' && input.rating >= 0 && input.rating <= 5 ? input.rating : undefined;
      return [{ placeId, placeName, author, text: excerpt, source: optionalText(input.source, 60), rating, unverified: true }];
    }
    if (!place) throw new Error('Choose a review ID, an attributed excerpt, or a venue.');
    if (!source.length) throw new Error(`${place.name} has no published reviews.`);
    return [...source].sort((a, b) => Number(!!b.live) - Number(!!a.live) || Number(a.sample) - Number(b.sample) || b.created_at.localeCompare(a.created_at))
      .slice(0, 2).map((review) => fromCatalog(review));
  }

  const title = requiredText(args.title, 'a title', 110);
  const sections = items(args.sections, 'sections', 1, 6).map((entry): BriefingSection => {
    const section = fields(entry);
    const heading = optionalText(section.heading, 80);
    switch (section.type) {
      case 'text': return { kind: 'text', heading, body: requiredText(section.body, 'section text', 900) };
      case 'reviews': return { kind: 'reviews', heading, items: items(section.items, 'review selections', 1, 6).flatMap(resolveReview) };
      case 'list': return { kind: 'list', heading, items: items(section.items, 'list items', 1, 10).map((entry) => {
        const item = fields(entry);
        return { label: requiredText(item.label, 'a list item label'), detail: optionalText(item.detail, 320), badge: optionalText(item.badge, 30) };
      }) };
      case 'comparison': return { kind: 'comparison', heading, items: items(section.items, 'comparison venues', 2, 3).map((entry) => {
        const item = fields(entry);
        const placeId = optionalText(item.placeId);
        const place = placeId ? catalog.get(placeId) : undefined;
        if (placeId && !place) throw new Error('A comparison references an unknown venue ID.');
        if (!Array.isArray(item.metrics)) throw new Error('Provide metrics for each comparison venue.');
        return { placeId, name: place?.name ?? requiredText(item.name, 'a comparison name', 100),
          subtitle: optionalText(item.subtitle, 120), metrics: facts(item.metrics, 6) ?? [], note: optionalText(item.note, 260) };
      }) };
      default: throw new Error('Use a text, reviews, list, or comparison section.');
    }
  });

  const actions: BriefingAction[] = [];
  if (args.placeIds !== undefined) {
    const selected = new Set(items(args.placeIds, 'venue IDs for quick actions', 1, 3));
    const stops = new Map<string, BriefingAction>();
    for (const id of selected) {
      const place = typeof id === 'string' ? catalog.get(id) : undefined;
      if (!place) throw new Error('Quick actions require valid catalog venue IDs.');
      actions.push({ kind: 'venue', label: `Step inside ${place.name}`, placeId: place.id });
      const stop = STOPS.find(({ stop_id }) => stop_id === place.stop_id);
      if (stop) stops.set(stop.stop_id, { kind: 'map', label: `View ${stop.name} on map`, stopId: stop.stop_id });
    }
    actions.push(...stops.values());
  }
  return { id, title, kicker: optionalText(args.kicker, 48), subtitle: optionalText(args.subtitle, 180),
    facts: facts(args.facts, 4), sections, actions };
}
