import type { Category } from './types.js';

/** A signed-in contributor. Visitors are anonymous, so this only ever describes someone who uploads. */
export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  /** True when the account was created through Google and has no password of its own. */
  google_only: boolean;
  created_at: string;
}

export interface AuthStatus {
  user: AuthUser | null;
  /** Null when GOOGLE_CLIENT_ID is unset, which is the signal to hide the Google button. */
  google_client_id: string | null;
  /** False when DATABASE_URL is unset: accounts cannot work and the app says so instead of failing. */
  enabled: boolean;
}

/**
 * The rating shown on a card: several review sites combined, weighted by how many reviews each
 * carries. Displayed only, never ranked on (spec D13).
 *
 * `attribution` names every site that contributed, which is both a licensing obligation and the
 * honest thing to show -- "4.4 from Google, Tripadvisor" means something that a bare 4.4 does not.
 */
export interface AggregateRating {
  /** Zero to five, as every source reports. The card converts to ten for display. */
  rating: number;
  /** Total reviews across contributing sites. Zero when no site published a count. */
  rating_count: number;
  attribution: string[];
  url: string | null;
}

/** @deprecated Kept so older imports still resolve. Use AggregateRating. */
export type GoogleRating = AggregateRating;

export interface DiscoverPlace {
  id: string;
  name: string;
  category: Category;
  /** Label and filter only. Contributed places are never drawn on a station map (spec D6). */
  station_id: string | null;
  station_name: string | null;
  station_color: string | null;
  /** Shown instead of a station when the place is nowhere near the T. */
  locality: string | null;
  price_typical: number | null;
  note: string | null;
  photo_urls: string[];
  /** Set once the splat pipeline finishes. Null means the place opens to photographs only. */
  asset_id: string | null;
  /** Pipeline stage while a splat is still building, else null. */
  build_stage: string | null;
  /** Absent when the place has no Google match: the card shows no score at all (spec D17). */
  rating: AggregateRating | null;
  /** True for the first seven days after creation. */
  is_new: boolean;
  /** Where the row came from: the seeded catalogue or a contributor's upload. */
  source: 'catalog' | 'contributed';
  contributor: { id: string; display_name: string; avatar_url: string | null } | null;
  created_at: string;
  /** Velocity score for the requested window. Absent unless sorting by popularity. */
  score: number | null;
}

export type DiscoverSort = 'new' | 'rated' | 'popular';
export type DiscoverWindow = 'today' | 'week' | 'month';

export interface DiscoverQuery {
  q?: string;
  /** A chip from CATEGORY_CHIPS, not a raw Category. */
  chip?: string;
  station?: string;
  sort?: DiscoverSort;
  window?: DiscoverWindow;
  cursor?: string;
  limit?: number;
}

export interface DiscoverResponse {
  places: DiscoverPlace[];
  total: number;
  /** Null when there is no further page. */
  next_cursor: string | null;
}

/**
 * The filter chips on the Discover page, and the categories each one selects.
 * `more` exists so museums and hotels are reachable: without it they would only ever appear
 * under All, which was open item 5 in the specification.
 */
export const CATEGORY_CHIPS: { id: string; label: string; categories: Category[] }[] = [
  { id: 'all', label: 'All', categories: [] },
  { id: 'food', label: 'Food', categories: ['restaurant', 'market'] },
  { id: 'cafes', label: 'Cafés', categories: ['study'] },
  { id: 'events', label: 'Events', categories: ['event_space', 'music', 'stadium'] },
  { id: 'outdoors', label: 'Outdoors', categories: ['outdoor'] },
  { id: 'shops', label: 'Shops', categories: ['shop'] },
  { id: 'more', label: 'More', categories: ['museum', 'hotel', 'activity'] },
];

export function chipCategories(chipId: string | undefined): Category[] {
  return CATEGORY_CHIPS.find((chip) => chip.id === chipId)?.categories ?? [];
}

/** Engagement signals that feed the popularity ranking. Nothing from Google feeds it (spec D13). */
export type EngagementKind = 'card_view' | 'splat_open' | 'upload';

/**
 * Weights reflect effort. Photographing a place is the strongest statement someone can make about
 * it; opening the 3D view is deliberate; a card scrolling past is nearly free.
 */
export const ENGAGEMENT_WEIGHTS: Record<EngagementKind, number> = {
  upload: 10,
  splat_open: 3,
  card_view: 1,
};

/**
 * Each window decays at roughly a third of its length, so the ranking answers "what is gaining
 * attention now" rather than being dominated by the oldest events still inside the window.
 */
export const WINDOW_HOURS: Record<DiscoverWindow, { span: number; halflife: number }> = {
  today: { span: 24, halflife: 4 },
  week: { span: 24 * 7, halflife: 36 },
  month: { span: 24 * 30, halflife: 24 * 6 },
};

/** A place counts as new, and carries the New badge, for its first seven days. */
export const NEW_FOR_DAYS = 7;

export interface DiscoverArrival {
  place_id: string;
  name: string;
  station_name: string | null;
  category: Category;
  created_at: string;
}

export interface NotificationFeed {
  new_places: DiscoverArrival[];
  popular_now: { place_id: string; name: string; score: number }[];
  /** Server time, so the client can ask for everything `since` this point after a reconnection. */
  now: string;
  unread: number;
}

export type ReportReason = 'not_a_place' | 'wrong_info' | 'offensive' | 'spam' | 'duplicate';

/** A nearby venue offered to the contributor to confirm, from Google Places (spec D16). */
export interface NearbyCandidate {
  google_place_id: string;
  name: string;
  category: Category;
  address: string | null;
  lat: number;
  lon: number;
  distance_m: number;
  rating: number | null;
  rating_count: number | null;
  /** True when Gemini's reading of the photographs matches this venue, so the app preselects it. */
  suggested: boolean;
}
