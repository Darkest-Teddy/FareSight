-- Contributor accounts and the Discover catalogue.
--
-- Accounts exist only for people who add places (see .plans/discover-accounts-spec.md, D3).
-- Visitors stay anonymous, so engagement is keyed by a rotating session hash rather than a user.
--
-- Contributed places are never drawn on the station maps (D6). `station_id` is a label and a
-- filter, nothing more, and it is null for a place that is not near a station.

create table users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  -- Null for an account that only ever signs in with Google.
  password_hash  text,
  display_name   text not null,
  avatar_url     text,
  google_sub     text unique,
  status         text not null default 'active'
                 check (status in ('active', 'suspended', 'deleted')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
-- Case-insensitive uniqueness without requiring the citext extension.
create unique index users_email_key on users (lower(email));

create table sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  bytea not null unique,
  user_agent  text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index sessions_user_idx on sessions (user_id, created_at desc);
create index sessions_expiry_idx on sessions (expires_at) where revoked_at is null;

-- Single-use, 60-second tokens that hand a native sign-in over to the WebView (D5).
create table auth_handoffs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  bytea not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table contributed_places (
  id               uuid primary key default gen_random_uuid(),
  created_by       uuid not null references users(id),
  name             text not null,
  category         text not null,
  -- Label and filter only. Null when the place is not near a station.
  station_id       text,
  lat              double precision,
  lon              double precision,
  price_typical    numeric(8,2),
  note             text,
  address          text,
  status           text not null default 'published'
                   check (status in ('published', 'hidden', 'removed')),
  capture_id       uuid references captures(id) on delete set null,
  asset_id         text,
  photo_urls       jsonb not null default '[]',
  google_place_id  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index contributed_places_new_idx on contributed_places (created_at desc) where status = 'published';
create index contributed_places_station_idx on contributed_places (station_id, created_at desc);
create index contributed_places_category_idx on contributed_places (category, created_at desc);
create index contributed_places_owner_idx on contributed_places (created_by, created_at desc);

alter table contributed_places add column search tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(note, '')), 'B')
  ) stored;
create index contributed_places_search_idx on contributed_places using gin (search);

-- Latest Google Places values only, never a time series: Google data is displayed but never ranks
-- anything (D13), so no history is needed and none is kept.
create table place_google_cache (
  google_place_id  text primary key,
  rating           real,
  rating_count     int,
  address          text,
  website          text,
  phone            text,
  attribution      jsonb not null default '[]',
  fetched_at       timestamptz not null default now()
);

-- `place_id` is either a seeded catalogue id ('bu-nudpob-01') or a contributed_places uuid, so it
-- is text and carries no foreign key.
create table engagement_events (
  id            bigserial primary key,
  place_id      text not null,
  kind          text not null check (kind in ('card_view', 'splat_open', 'upload')),
  session_hash  bytea not null,
  created_at    timestamptz not null default now()
);
create index engagement_recent_idx on engagement_events (place_id, created_at desc);
create index engagement_window_idx on engagement_events (created_at desc);
create index engagement_dedupe_idx on engagement_events (place_id, kind, session_hash, created_at desc);

create table place_reports (
  id            uuid primary key default gen_random_uuid(),
  place_id      text not null,
  reason        text not null
                check (reason in ('not_a_place', 'wrong_info', 'offensive', 'spam', 'duplicate')),
  detail        text,
  session_hash  bytea not null,
  created_at    timestamptz not null default now()
);
create index place_reports_place_idx on place_reports (place_id, created_at desc);
-- One report per place per session, so the auto-hide threshold counts distinct people.
create unique index place_reports_once_idx on place_reports (place_id, session_hash);

create table notification_reads (
  user_id  uuid primary key references users(id) on delete cascade,
  read_at  timestamptz not null default now()
);
