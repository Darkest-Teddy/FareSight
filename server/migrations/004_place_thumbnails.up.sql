-- One stored photograph per place, for the Discover card.
--
-- `place_id` is either a seeded catalogue id or a contributed_places uuid, so it is text and
-- carries no foreign key, matching place_ratings.
--
-- The credit columns are not decoration: a picture taken from a venue's own site or from
-- Wikipedia is shown on the card with its source named.
create table place_thumbnails (
  place_id   text primary key,
  url        text not null,
  source     text not null check (source in ('website', 'wikipedia', 'upload')),
  credit     text not null,
  credit_url text,
  fetched_at timestamptz not null default now()
);
