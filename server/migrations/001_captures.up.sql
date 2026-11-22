-- Capture-to-splat records. Postgres only tracks the files: every image and splat lives in object
-- storage and is referenced here by its object key.
create table captures (
  id           uuid primary key default gen_random_uuid(),
  place_id     text not null,
  mode         text not null check (mode in ('room', 'object')),
  status       text not null default 'created'
               check (status in ('created', 'uploading', 'uploaded', 'processing', 'ready', 'failed')),
  device_info  jsonb not null default '{}',
  frame_count  int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index captures_place_idx on captures (place_id, created_at desc);

create table frames (
  id              bigserial primary key,
  capture_id      uuid not null references captures(id) on delete cascade,
  seq             int not null,
  object_key      text not null,
  t_ms            bigint not null default 0,
  orientation     real[],
  pose            real[],
  blur_score      real,
  parallax_score  real,
  width           int,
  height          int,
  uploaded_at     timestamptz not null default now(),
  unique (capture_id, seq)
);

-- Stages mirror the generation pipeline's (shared JobStage), plus `claimed` while a worker fetches the photos.
create table jobs (
  id              uuid primary key default gen_random_uuid(),
  capture_id      uuid not null references captures(id) on delete cascade,
  status          text not null default 'queued'
                  check (status in ('queued', 'claimed', 'generating', 'downloading', 'converting',
                                    'needs_review', 'ready', 'failed')),
  progress        int not null default 0,
  status_message  text not null default 'Queued',
  attempts        int not null default 0,
  max_attempts    int not null default 3,
  worker_id       text,
  claimed_at      timestamptz,
  heartbeat_at    timestamptz,
  failure_code    text,
  failure_detail  text,
  params          jsonb not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index jobs_queued_idx on jobs (created_at) where status = 'queued';
create index jobs_capture_idx on jobs (capture_id, created_at desc);

create table splat_assets (
  id           uuid primary key default gen_random_uuid(),
  capture_id   uuid not null references captures(id) on delete cascade,
  job_id       uuid not null references jobs(id) on delete cascade,
  quality      text not null check (quality in ('preview', 'full')),
  format       text not null check (format in ('ply', 'sog', 'spz')),
  object_key   text not null,
  bytes        bigint,
  splat_count  int,
  created_at   timestamptz not null default now(),
  unique (job_id, quality, format)
);
