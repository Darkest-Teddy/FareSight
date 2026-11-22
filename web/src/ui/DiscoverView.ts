import {
  CATEGORY_CHIPS, type DiscoverPlace, type DiscoverSort, type DiscoverWindow,
} from '@faresight/shared';
import { discover } from '../api/discoverClient';
import { button, element, icon } from './dom';

const SORTS: { id: DiscoverSort; label: string }[] = [
  { id: 'new', label: 'New' },
  { id: 'rated', label: 'Top rated' },
  { id: 'popular', label: 'Popular' },
];

const WINDOWS: { id: DiscoverWindow; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurant', study: 'Café', music: 'Live music', activity: 'Activity',
  shop: 'Shop', market: 'Market', outdoor: 'Outdoors', museum: 'Museum',
  event_space: 'Event space', hotel: 'Hotel', stadium: 'Stadium',
};

/** Maps a 0-5 rating onto the 0-10 score the reference design shows. */
const toTen = (rating: number) => Math.round(rating * 20) / 10;

/**
 * A ring that fills in proportion to the score, like a pie chart, in green, amber or red.
 *
 * Drawn as an SVG circle with a dash pattern rather than a conic gradient, because a stroke can
 * be rounded at the cap and animates smoothly, and because the arc then starts at twelve o'clock
 * on every browser without a transform.
 */
function scoreRing(score: number): SVGSVGElement {
  const fraction = Math.max(0, Math.min(1, score / 10));
  // r = 15.9155 makes the circumference 100, so the dash array is the percentage directly.
  const RADIUS = 15.9155;
  const CIRCUMFERENCE = 100;
  const band = score >= 8 ? 'is-high' : score >= 6 ? 'is-mid' : 'is-low';

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 40 40');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('score-ring', band);

  const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  track.setAttribute('class', 'score-ring-track');
  track.setAttribute('cx', '20');
  track.setAttribute('cy', '20');
  track.setAttribute('r', String(RADIUS));

  const fill = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fill.setAttribute('class', 'score-ring-fill');
  fill.setAttribute('cx', '20');
  fill.setAttribute('cy', '20');
  fill.setAttribute('r', String(RADIUS));
  fill.setAttribute('stroke-dasharray', `${(fraction * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE}`);

  svg.append(track, fill);
  return svg;
}

/**
 * The Discover page: every place in one list, searchable, filterable and sortable.
 *
 * It is a plain DOM view rather than a scene in the 3D engine. The canvas is hidden while it is
 * open and the PlayCanvas application is paused rather than destroyed, so returning to the map
 * does not pay to reload the engine and its splats.
 *
 * New places do not insert themselves into the grid while somebody is reading it. That would move
 * cards under the reader's cursor. Arrivals are announced by a toast and the bell instead, and the
 * grid picks them up on the next load or refresh (specification D11).
 */
export class DiscoverView {
  readonly root = element('section', 'discover');

  private readonly grid = element('div', 'discover-grid');
  private readonly featured = element('div', 'discover-featured');
  private readonly featuredSection = element('section', 'discover-section');
  private readonly allSection = element('section', 'discover-section');
  private readonly countLabel = element('span', 'discover-count');
  private readonly statusLine = element('p', 'discover-status');
  private readonly searchInput = element('input', 'discover-search-input');
  private readonly chipRow = element('div', 'discover-chips');
  private readonly sortRow = element('div', 'discover-sort');
  private readonly windowRow = element('div', 'discover-window');
  private readonly moreButton: HTMLButtonElement;
  private readonly sentinel = element('div', 'discover-sentinel');

  private chip = 'all';
  private sort: DiscoverSort = 'new';
  private window: DiscoverWindow = 'today';
  private query = '';
  private cursor: string | null = null;
  private loaded: DiscoverPlace[] = [];
  private request = 0;
  private searchTimer?: number;
  private loadingMore = false;
  private endWatcher?: IntersectionObserver;
  /** Counts card impressions once each, so scrolling past a card twice is not two events. */
  private readonly seen = new Set<string>();
  private observer?: IntersectionObserver;

  constructor(private readonly onOpen: (place: DiscoverPlace) => void) {
    const header = element('header', 'discover-header');
    const heading = element('div', 'discover-heading');
    heading.append(
      element('h1', '', 'Discover'),
      element('p', 'discover-subtitle', 'New spots near the T, rated by people who rode there.'),
    );

    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search places, dishes or stops';
    this.searchInput.setAttribute('aria-label', 'Search places, dishes or stops');
    this.searchInput.addEventListener('input', () => {
      // Waiting a beat after typing stops a request going out for every keystroke.
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => {
        this.query = this.searchInput.value.trim();
        void this.reload();
      }, 250);
    });
    const search = element('div', 'discover-search');
    search.append(icon('search'), this.searchInput);
    header.append(heading, search);

    for (const { id, label } of CATEGORY_CHIPS) {
      this.chipRow.append(button(label, () => {
        this.chip = id;
        void this.reload();
      }, 'discover-chip'));
    }

    for (const { id, label } of SORTS) {
      this.sortRow.append(button(label, () => {
        this.sort = id;
        void this.reload();
      }, 'discover-sort-option'));
    }

    for (const { id, label } of WINDOWS) {
      this.windowRow.append(button(label, () => {
        this.window = id;
        void this.reload();
      }, 'discover-window-option'));
    }

    const controls = element('div', 'discover-controls');
    const rightControls = element('div', 'discover-controls-right');
    rightControls.append(this.sortRow, this.windowRow);
    controls.append(this.chipRow, rightControls);

    this.featuredSection.append(element('h2', 'discover-section-title', 'New this week'), this.featured);
    const allHeader = element('div', 'discover-section-header');
    allHeader.append(element('h2', 'discover-section-title', 'All places'), this.countLabel);
    this.moreButton = button('Show more', () => void this.loadMore(), 'discover-more');
    this.allSection.append(allHeader, this.grid, this.sentinel, this.moreButton);

    this.root.append(header, controls, this.statusLine, this.featuredSection, this.allSection);
    this.syncControls();
  }

  /** Called when the tab opens. Reloads so arrivals announced since last time are picked up. */
  async activate(): Promise<void> {
    this.observe();
    this.watchEnd();
    await this.reload();
  }

  deactivate(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.endWatcher?.disconnect();
    this.endWatcher = undefined;
  }

  /**
   * Loads the next page as the reader approaches the end of the list.
   *
   * The Show more button stays as the fallback: it is what works without IntersectionObserver,
   * and it is the only affordance a keyboard user can reach, since tabbing never scrolls far
   * enough to trip the sentinel.
   */
  private watchEnd() {
    if (this.endWatcher || typeof IntersectionObserver === 'undefined') return;
    // `root` must be the page element, not the viewport: .discover is itself the scrolling box,
    // so against the default root the sentinel never enters view and nothing ever loads.
    this.endWatcher = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void this.loadMore();
    }, { root: this.root, rootMargin: '600px' });
    this.endWatcher.observe(this.sentinel);
  }

  private syncControls() {
    const mark = (row: HTMLElement, selected: string, values: string[]) => {
      [...row.children].forEach((node, index) => {
        node.classList.toggle('is-selected', values[index] === selected);
        node.setAttribute('aria-pressed', String(values[index] === selected));
      });
    };
    mark(this.chipRow, this.chip, CATEGORY_CHIPS.map(({ id }) => id));
    mark(this.sortRow, this.sort, SORTS.map(({ id }) => id));
    mark(this.windowRow, this.window, WINDOWS.map(({ id }) => id));
    // The time window only means something for the popularity sort, so it is hidden otherwise
    // rather than sitting there inert.
    this.windowRow.hidden = this.sort !== 'popular';
  }

  private async reload() {
    this.cursor = null;
    this.loaded = [];
    this.syncControls();
    await this.fetch(true);
  }

  private async loadMore() {
    if (!this.cursor || this.loadingMore) return;
    this.loadingMore = true;
    try {
      await this.fetch(false);
    } finally {
      this.loadingMore = false;
      // An IntersectionObserver reports changes, not states. On a short window the sentinel never
      // leaves view, so it is reported once and never again, and paging stops after one page.
      // Re-observing asks for a fresh report, which continues until the sentinel is pushed off
      // screen or there is nothing left to load.
      this.rearmEndWatcher();
    }
  }

  private rearmEndWatcher() {
    if (!this.endWatcher || !this.cursor) return;
    this.endWatcher.unobserve(this.sentinel);
    this.endWatcher.observe(this.sentinel);
  }

  private async fetch(replace: boolean) {
    const run = ++this.request;
    this.statusLine.textContent = replace ? 'Loading places…' : '';
    this.statusLine.hidden = !replace;
    try {
      const response = await discover.list({
        q: this.query || undefined,
        chip: this.chip === 'all' ? undefined : this.chip,
        sort: this.sort,
        window: this.window,
        cursor: replace ? undefined : this.cursor ?? undefined,
        // The whole catalogue fits in one request at this size, so every place is on the page
        // immediately rather than appearing only once somebody scrolls. The paging below still
        // works and takes over if the catalogue ever outgrows a single page.
        limit: 120,
      });
      // A slower earlier request must not overwrite a newer one's results.
      if (run !== this.request) return;
      this.loaded = replace ? response.places : [...this.loaded, ...response.places];
      this.cursor = response.next_cursor;
      this.render(response.total);
      this.statusLine.hidden = true;
      if (replace) this.rearmEndWatcher();
    } catch (error) {
      if (run !== this.request) return;
      this.statusLine.hidden = false;
      this.statusLine.textContent = error instanceof Error
        ? `Could not load places: ${error.message}` : 'Could not load places.';
    }
  }

  private render(total: number) {
    this.countLabel.textContent = `${total} ${total === 1 ? 'place' : 'places'}`;
    this.moreButton.hidden = !this.cursor;

    // The featured row belongs to the New ordering. Under another sort the same cards would
    // appear twice in different positions, which reads as a bug, so the row is dropped entirely
    // rather than merely hidden: building cards into a hidden container wastes the work and
    // leaves the same place in the document twice.
    const fresh = this.sort === 'new' ? this.loaded.filter((place) => place.is_new).slice(0, 3) : [];
    this.featured.replaceChildren(...fresh.map((place) => this.card(place, true)));
    // With nothing new, the heading would sit above an empty row.
    this.featuredSection.hidden = fresh.length === 0;

    const featuredIds = new Set(fresh.map(({ id }) => id));
    const rest = featuredIds.size ? this.loaded.filter(({ id }) => !featuredIds.has(id)) : this.loaded;
    if (rest.length === 0) {
      const empty = element('p', 'discover-empty', this.query
        ? `Nothing matches “${this.query}”.`
        : 'No places here yet. Add one from the phone app.');
      this.grid.replaceChildren(empty);
      return;
    }
    this.grid.replaceChildren(...rest.map((place) => this.card(place, false)));
    for (const node of this.grid.children) this.observer?.observe(node);
    for (const node of this.featured.children) this.observer?.observe(node);
  }

  private card(place: DiscoverPlace, large: boolean): HTMLElement {
    const card = element('article', `discover-card${large ? ' is-large' : ''}`);
    card.dataset.placeId = place.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${place.name}, ${CATEGORY_LABELS[place.category] ?? place.category}`);

    const media = element('div', 'discover-card-media');
    // A gathered photograph first, then anything a contributor uploaded.
    const photo = place.photo?.url ?? place.photo_urls[0];
    if (photo) {
      const image = element('img', 'discover-card-image');
      image.src = photo;
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      // A broken photo would otherwise leave a torn icon and alt text where the picture was.
      image.addEventListener('error', () => {
        image.remove();
        media.querySelector('.discover-credit')?.remove();
        media.classList.add('is-empty');
        media.dataset.category = place.category;
        media.append(element('span', 'discover-card-glyph', (place.name[0] ?? '?').toUpperCase()));
      });
      media.append(image);
      // The picture belongs to the venue or to Wikipedia, so the card says whose it is.
      if (place.photo) {
        const credit = element('span', 'discover-credit', place.photo.credit);
        credit.title = `Photograph from ${place.photo.credit}`;
        media.append(credit);
      }
    } else {
      // Seeded places ship no photographs, so the tile is tinted by category rather than left
      // blank. This is the gap both specifications noted and neither closed.
      media.classList.add('is-empty');
      media.dataset.category = place.category;
      media.append(element('span', 'discover-card-glyph', (place.name[0] ?? '?').toUpperCase()));
    }
    if (place.is_new) media.append(element('span', 'discover-badge', 'New'));
    if (place.build_stage && !place.asset_id) {
      media.append(element('span', 'discover-building', 'Building 3D…'));
    } else if (place.asset_id) {
      media.append(element('span', 'discover-3d', '3D'));
    }
    card.append(media);

    const body = element('div', 'discover-card-body');
    const text = element('div', 'discover-card-text');
    text.append(element('h3', 'discover-card-name', place.name));

    const meta = element('p', 'discover-card-meta');
    if (place.station_name) {
      const dot = element('span', 'discover-dot');
      if (place.station_color) dot.style.background = place.station_color;
      meta.append(dot, element('span', '', place.station_name));
    } else if (place.locality) {
      meta.append(element('span', 'discover-pin', '◉'), element('span', '', place.locality));
    }
    meta.append(element('span', 'discover-sep', '·'));
    meta.append(element('span', '', CATEGORY_LABELS[place.category] ?? place.category));
    if (place.price_typical !== null && place.price_typical > 0) {
      meta.append(element('span', 'discover-sep', '·'));
      meta.append(element('span', '', `$${place.price_typical % 1 === 0 ? place.price_typical : place.price_typical.toFixed(2)}`));
    }
    text.append(meta);
    body.append(text);

    // A place with no Google match gets no score element at all, rather than a zero or a dash: an
    // absent rating is not a bad one (specification D17).
    if (place.rating) {
      const score = toTen(place.rating.rating);
      const ring = element('div', 'discover-score');
      ring.append(scoreRing(score), element('span', 'discover-score-value', score.toFixed(1)));
      const wrap = element('div', 'discover-score-wrap');
      const count = place.rating.rating_count;
      wrap.append(ring, element('span', 'discover-score-count',
        count > 0 ? `${count.toLocaleString()} ratings` : `${place.rating.attribution.length} sources`));
      wrap.title = `${place.rating.rating_count.toLocaleString()} reviews from ${place.rating.attribution.join(', ')}`;
      body.append(wrap);
    } else if (this.sort === 'popular' && place.score !== null) {
      const wrap = element('div', 'discover-score-wrap');
      wrap.append(element('span', 'discover-trend', `▲ ${Math.round(place.score)}`));
      wrap.title = 'How fast this place is gaining attention on FareSight';
      body.append(wrap);
    }

    card.append(body);
    const open = () => {
      void discover.engage(place.id, 'splat_open');
      this.onOpen(place);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
    });
    return card;
  }

  /**
   * Counts a card as viewed once it is actually on screen, not merely rendered. Without this a
   * single page load would register every place in the catalogue as viewed and the popularity
   * ranking would measure nothing.
   */
  private observe() {
    if (this.observer || typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.placeId;
        if (!id || this.seen.has(id)) continue;
        this.seen.add(id);
        void discover.engage(id, 'card_view');
        this.observer?.unobserve(entry.target);
      }
    }, { root: this.root, threshold: 0.5 });
  }
}
