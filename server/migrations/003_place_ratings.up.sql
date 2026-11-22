-- Ratings and awards gathered from the open web, for any place: a seeded catalogue id or a
-- contributed_places uuid. This generalises place_google_cache, which could only hold one Google
-- row per place and so could not represent a venue rated by Tripadvisor and OpenTable at once.
--
-- Google and Yelp are not represented here directly and cannot be: both prohibit scraping and
-- block crawlers, so a web search cannot cite them. What lands here is whatever the search can
-- actually source and link to -- Tripadvisor, OpenTable, Restaurantji and similar -- plus
-- anything already researched by hand in shared/src/placeFacts.ts.

create table place_ratings (
  place_id      text not null,
  -- Normalised by normaliseSource(): "Birdeye (Google reviews)" and "google.com" both become
  -- "Google". Without that the same site fragments across refreshes and a place appears to be
  -- rated by four sources when it is rated by two.
  source        text not null,
  rating        real not null check (rating >= 0 and rating <= 5),
  rating_count  int check (rating_count is null or rating_count >= 0),
  url           text,
  -- True when the figure came from the venue's own site. Kept for transparency but excluded from
  -- the headline score, because a venue rating itself is not independent.
  self_reported boolean not null default false,
  fetched_at    timestamptz not null default now(),
  primary key (place_id, source)
);
create index place_ratings_place_idx on place_ratings (place_id);

create table place_awards (
  place_id   text not null,
  title      text not null,
  org        text not null,
  year       int,
  url        text,
  fetched_at timestamptz not null default now(),
  primary key (place_id, org, title)
);
create index place_awards_place_idx on place_awards (place_id);

-- One row per place: what the consensus of the reviews says, and when it was last looked up.
create table place_review_summary (
  place_id   text primary key,
  highlights jsonb not null default '[]',
  sources    jsonb not null default '[]',
  -- 'ok' when the lookup returned something, 'empty' when it found nothing worth keeping, and
  -- 'failed' when it errored. Stored so a backfill can retry only what did not work.
  status     text not null default 'ok' check (status in ('ok', 'empty', 'failed')),
  fetched_at timestamptz not null default now()
);
