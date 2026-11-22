# Discover: contributor accounts and user-added places

**Status:** implemented on `feat/accounts-discover`. Sections 1-13 describe the design;
section 14 records how each open item was actually settled and where the implementation
departed from this document.
**Repository:** `github.com/Darkest-Teddy/FareSight`
**Written:** 2026-11-22
**Scope:** demo. The scope was originally "real product, built properly" and was changed by
the user partway through. Section 14 states exactly what that cost: no password reset, and
Google Places optional rather than required.

---

## 1. What this builds

A person photographs a restaurant on their phone. The photographs become a 3D Gaussian
splat through the pipeline that already exists. The restaurant then appears on a new
desktop page called **Discover**, where anyone can search it, filter it by category,
sort it by how fast it is gaining attention, and open its 3D view.

Three things do not exist today and are the substance of this work:

1. **Accounts.** The server has no users. It has two shared passcodes.
2. **Place creation.** The catalog is a fixed list in source code. Nothing can add to it.
3. **Discover.** There is no page that lists places, and no measure of popularity.

---

## 2. What exists today

This section records confirmed behavior, read from the repository on 2026-11-22.

### 2.1 Repository layout

`Desktop/vscode/FareSight` and `Desktop/vscode/FareSight-mobile` are **one repository**.
`FareSight-mobile` is a git worktree on branch `feat/contribute-mobile`, 49 commits behind
that branch's remote tip.

| Package | Purpose |
|---|---|
| `shared/` | Domain types, Boston projection, MBTA fares, ride times |
| `server/` | Fastify, `node:sqlite`, Postgres for captures, resumable job worker |
| `web/` | PlayCanvas v2 + WebXR desktop app. **This is the desktop website.** |
| `contribute/` | Mobile-first photo contribution app, own subdomain, no 3D engine |
| `modeling/` | Procedural `.glb` and `.ply` generators |
| `map/` | MapLibre 2D map. **Untracked.** |
| `mobile/` | Expo app. **Untracked.** |

### 2.2 Branch and pull request state

- **Merged and complete:** `feat/capture-splat-pipeline` (#10), `feat/landing-zoom` (#4),
  `intro-fixes` (#6-9), `model-fixes` (#2), `osm-model-refactor` (#3),
  `background-experiments` (#5).
- **Unmerged, no pull request:** `feat/contribute-mobile` (7 commits, Jose220) and
  `t3/desktop-liquid-glass-redesign` (8 commits, Liem Luttrell).
- **Open:** pull request #1, a draft marketing landing page.

`feat/contribute-mobile` contains no Expo code despite its name. It holds contribute-app
work: island maps, a 360-degree scan level line, star-rating reviews, and a live catalog.

### 2.3 The untracked work is at risk

`mobile/` and `map/` appear in no commit on any branch, local or remote. They exist only
as uncommitted files in a worktree that is 49 commits behind. A `git clean` destroys them.
**Committing them is the first task in the build order.**

`mobile/App.js` is a single file. It is a `react-native-webview` that reads the Expo
packager's LAN host, swaps the port to 5180, and loads the contribute dev server. It
declares camera and photo-library permissions but performs no capture itself. It hardcodes
`http://` and has `extra.contributeUrl: null`. It is a development shell, not a client.

### 2.4 Authentication today

`server/src/services/passcodes.ts` compares SHA-256 digests of two shared secrets,
`ADMIN_PASSCODE` and `CONTRIBUTOR_PASSCODE`, using `timingSafeEqual`. Failures are rate
limited per IP address at 12 per minute. The contribute app stores the passcode on the
device. **No record exists of who uploaded anything.**

Only `ADMIN_PASSCODE` is set in `.env`. `CONTRIBUTOR_PASSCODE` is absent, so
`guard('contributor')` currently falls through to the demo path.

### 2.5 Places today

`shared/src/demoCatalog.ts` hardcodes every place. Each carries a `stop_id` and a
`pin_index`. `server/src/db/database.ts` seeds these into a SQLite table whose rows are
JSON blobs. A contributor selects an **existing** place, uploads photos, the worker runs
Atlas or TRELLIS, and an administrator publishes the resulting asset onto that place.
There is no code path that creates a place.

Exactly five stations exist, each with a 3D diorama: BU Central, Packard's Corner,
Kenmore, Harvard, and Chinatown.

### 2.6 Capture storage and live events

When `DATABASE_URL` and the `VULTR_S3_*` variables are set, photographs bypass the API.
Both are set in `.env` today, pointing at Tiger Data (Postgres) and Vultr Object Storage.

`server/migrations/001_captures.up.sql` defines `captures`, `frames`, `jobs`, and
`splat_assets`. `server/src/db/pg.ts` provides `createPool`, a `migrate` function guarded
by a Postgres advisory lock, and a `listen` helper that holds a reconnecting `NOTIFY`
subscription. `GET /api/captures/:id/events` relays those notifications to one phone as
server-sent events.

That feed is scoped to a single capture. **No site-wide or station-wide feed exists, and
no popularity counter exists anywhere.**

### 2.7 The Discover page does not exist

The reference screenshot supplied for this work matches nothing in the repository. The
string "Discover" appears only in `shared/src/live.ts`, unrelated. "Top rated" appears in
no source file. The screenshot is a design target, not code to extend.

---

## 3. Decisions

Each decision below was made explicitly during specification. They are binding.

| # | Decision |
|---|---|
| D1 | Commit `mobile/` and `map/` to the repository, then build on them. |
| D2 | The desktop website is `web/` as it stands on `main`. |
| D3 | Accounts exist only for people who upload photographs. Visitors stay anonymous. |
| D4 | Sign-in uses email and password. |
| D5 | The Expo app gets **native sign-in screens**. Everything else stays web. |
| D6 | **Contributed places are never added to the station maps.** No 3D pin, no diorama placement, no map-sculpture pin, no `segment-anchors` projection, no distance geofence. |
| D7 | A new top-level tab beside Map, called **Discover**. |
| D8 | Discover merges places and reviews into one page: search, category filter, and sorting by New, Top rated, and Popular across today, week, and month. |
| D9 | A station is **label and filter metadata only**. |
| D10 | A card click opens the place. Photographs are the permanent content; the Gaussian splat is an additional view when it exists. |
| D11 | A new place does **not** insert itself into the grid. The grid updates on page load. Arrival is announced by a toast and by a bell notification. |
| D12 | Popularity is **velocity**: what is gaining fastest inside the selected window. |
| D13 | Velocity is computed from **internal engagement only** — splat opens, card views, and uploads. Google data never ranks anything. |
| D14 | Displayed ratings come from the Google Places API. |
| D15 | Gemini reads the venue name and category from the photographs; the contributor confirms. |
| D16 | The Google Places link is made by a **nearby search**; the contributor picks the right venue. |
| D17 | A place with no Google match shows **no score** and carries a **New** badge. |
| D18 | Places publish immediately. Bad entries are removed after a report. |
| D19 | All new tables live in **Tiger Data (Postgres)**, reached through the existing `DATABASE_URL`. |

### 3.1 Consequences of D6

Decision D6 removes a large amount of work that earlier drafts assumed:

- No geofence. Nothing is placed on a map, so nothing can be too far from a station.
- No `segment-anchors.json` runtime projection for contributed places.
- No diorama regeneration, and no `pin_index` allocation.
- The seeded catalog keeps its existing 3D station pins. Contributed places never get one.

### 3.2 Explicitly cut

- **"Friends' picks."** The reference design shows this control. It requires a social
  graph, which requires viewer accounts, which contradicts D3. It is removed.
- **Events as an entity.** Events are not a dated record with a venue and a start time.
  The Events filter chip selects places in the `event_space`, `music`, and `stadium`
  categories, which the `Category` type already defines.
- **Google data in the ranking.** Follows from D13.

---

## 4. Data model

One new migration, `server/migrations/002_accounts_discover.up.sql`, with a matching
`.down.sql`. It follows the conventions already set by `001_captures`: UUID primary keys
from `gen_random_uuid()`, `timestamptz` columns defaulting to `now()`, `check` constraints
on status strings, and descending indexes on `created_at`.

### 4.1 Accounts

```sql
create table users (
  id             uuid primary key default gen_random_uuid(),
  email          citext not null unique,
  password_hash  text not null,
  display_name   text not null,
  status         text not null default 'active'
                 check (status in ('active', 'suspended', 'deleted')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

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

create table password_resets (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id) on delete cascade,
  token_hash  bytea not null unique,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
```

`citext` requires `create extension if not exists citext`. It makes email comparison
case-insensitive, which prevents one person registering twice with different casing.

**Password hashing.** Use Argon2id. Node's built-in `node:crypto` does not provide it, so
this adds one dependency. If adding a native dependency is unacceptable, use the built-in
`scrypt` with `N = 2^17`, `r = 8`, `p = 1`, a 16-byte random salt, and a 32-byte output,
stored in the modular-crypt format so the parameters can change later without breaking
existing hashes. Argon2id is the recommendation; scrypt is the fallback.

**Session tokens.** 32 random bytes from `randomBytes`, base64url encoded. The server
stores only `sha256(token)` in `token_hash`, so a database disclosure does not yield usable
sessions. Default lifetime 30 days, sliding on use.

### 4.2 Contributed places

```sql
create table contributed_places (
  id              uuid primary key default gen_random_uuid(),
  created_by      uuid not null references users(id),
  name            text not null,
  category        text not null,
  station_id      text,                      -- label and filter only (D9); may be null
  lat             double precision,
  lon             double precision,
  price_typical   numeric(8,2),
  note            text,
  status          text not null default 'published'
                  check (status in ('published', 'hidden', 'removed')),
  capture_id      uuid references captures(id) on delete set null,
  asset_id        text,                      -- splat asset once the pipeline finishes
  google_place_id text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index contributed_places_new_idx on contributed_places (created_at desc)
  where status = 'published';
create index contributed_places_station_idx on contributed_places (station_id, created_at desc);
create index contributed_places_category_idx on contributed_places (category, created_at desc);
```

`category` reuses the existing `Category` union from `shared/src/types.ts`. It is not
constrained in SQL, because that union changes in TypeScript and a `check` constraint would
silently drift. Validation happens at the API boundary with the shared type.

`station_id` is nullable by design. A place genuinely far from the T has no station, and
its card shows a neighborhood or address instead of a false station label.

**Full-text search.** Add a generated column and a GIN index so search does not scan:

```sql
alter table contributed_places add column search tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(note, '')), 'B')
  ) stored;
create index contributed_places_search_idx on contributed_places using gin (search);
```

### 4.3 Google Places cache

```sql
create table place_google_cache (
  google_place_id  text primary key,
  rating           real,
  rating_count     int,
  address          text,
  website          text,
  phone            text,
  hours            jsonb,
  attribution      jsonb not null default '[]',
  fetched_at       timestamptz not null default now()
);
```

This holds **only the latest value**, never a time series. That is a deliberate consequence
of D13: because Google data never ranks anything, no history is needed, and the retention
problem described in section 10.2 does not arise.

### 4.4 Engagement

```sql
create table engagement_events (
  id            bigserial primary key,
  place_id      text not null,               -- seeded place id or contributed_places.id
  kind          text not null check (kind in ('card_view', 'splat_open', 'upload')),
  session_hash  bytea not null,              -- sha256(salt || ip || user agent), rotated daily
  created_at    timestamptz not null default now()
);
create index engagement_recent_idx on engagement_events (place_id, created_at desc);
create index engagement_window_idx on engagement_events (created_at desc);
```

`session_hash` identifies a visitor well enough to deduplicate without storing an IP
address. The salt rotates daily, so the hash cannot be used to track someone across days.

**Deduplication.** The server rejects a repeat event rather than storing it:

- one `card_view` per `session_hash` per place per hour;
- one `splat_open` per `session_hash` per place per ten minutes;
- `upload` is emitted once by the server when a place is created, never by a client.

**Retention.** Raw events older than 35 days are deleted by a scheduled job. The month
window needs 30 days; 35 gives margin. Rolled-up daily totals are kept indefinitely:

```sql
create table engagement_daily (
  place_id  text not null,
  day       date not null,
  kind      text not null,
  count     int not null,
  primary key (place_id, day, kind)
);
```

### 4.5 Reports and notifications

```sql
create table place_reports (
  id            uuid primary key default gen_random_uuid(),
  place_id      text not null,
  reason        text not null check (reason in ('not_a_place', 'wrong_info', 'offensive', 'spam', 'duplicate')),
  detail        text,
  session_hash  bytea not null,
  created_at    timestamptz not null default now()
);
create index place_reports_place_idx on place_reports (place_id, created_at desc);

create table notification_reads (
  user_id  uuid primary key references users(id) on delete cascade,
  read_at  timestamptz not null default now()
);
```

The bell feed is **computed**, not stored. It is a query over `contributed_places` and the
velocity rollup. `notification_reads` stores only the point each signed-in person last
opened the dropdown, which is what drives the unread count. An anonymous visitor's read
marker lives in `localStorage`.

---

## 5. Popularity: the velocity measure

### 5.1 Definition

Velocity answers "what is gaining attention fastest right now", not "what is best". It is
a weighted, time-decayed sum of engagement events inside the selected window.

For a place `p` and window `W` in {today, week, month}:

```
score(p, W) = Σ  weight(kind(e)) × 2 ^ ( −age_hours(e) / halflife(W) )
             e ∈ events(p, W)
```

**Weights.** An upload is the strongest signal because it costs real effort. Opening the
3D view is a deliberate act. Viewing a card is nearly free.

| Event | Weight | Reason |
|---|---|---|
| `upload` | 10 | Someone physically went and photographed the place |
| `splat_open` | 3 | A deliberate click into the 3D view |
| `card_view` | 1 | The card entered the viewport |

**Half-lives.** Each window decays at roughly one third of its length, so the ranking
responds inside the window rather than being dominated by its oldest edge.

| Window | Span | Half-life |
|---|---|---|
| Today | 24 hours | 4 hours |
| Week | 7 days | 36 hours |
| Month | 30 days | 6 days |

### 5.2 Why a new place can win

A place created an hour ago with one upload and twenty splat opens scores
`10 + 20×3 ≈ 70` undecayed. An established place with two hundred card views spread over
the week scores far less under the week half-life. This is the intended behavior: the sort
is called Popular, and it surfaces momentum.

### 5.3 Computation

Computing this per request across thirty days of events will not stay fast. Maintain a
rollup table refreshed by the worker every 60 seconds:

```sql
create table velocity_scores (
  place_id    text not null,
  window_key  text not null check (window_key in ('today', 'week', 'month')),
  score       double precision not null,
  computed_at timestamptz not null default now(),
  primary key (place_id, window_key)
);
create index velocity_rank_idx on velocity_scores (window_key, score desc);
```

A 60-second refresh means the Popular sort is at most one minute stale. That is acceptable
and does not need to be surfaced in the interface.

### 5.4 The other two sorts

- **New** orders by `created_at` descending. The **New** badge applies for 7 days, which
  matches the reference design's "New this week" row.
- **Top rated** orders by Google rating descending, with a volume floor so a single
  five-star rating does not outrank a well-reviewed place. Use the Bayesian average:
  `(v × R + m × C) / (v + m)` where `v` is the rating count, `R` the rating, `C` the mean
  rating across all places, and `m = 20`. Places with no Google match are excluded from
  this sort entirely — they have no rating to sort by (D17).

---

## 6. Creating a place

### 6.1 The sequence

1. The contributor signs in. Native screens in the Expo app; a web form in `contribute/`.
2. They photograph the venue: 2 to 32 overlapping photographs for a space, or one for a dish.
   This flow already exists and does not change.
3. The app requests location permission and runs a **Google Places nearby search** at the
   device coordinates (D16).
4. In parallel, the existing Gemini intake call is extended to read a venue name and
   category from signage and menus in the photographs (D15).
5. The app shows the nearby list with Gemini's reading pre-selected. **The contributor
   picks.** They may also choose "Not listed" and type a name and category themselves.
6. The app `POST`s to `/api/places`. The server creates the row with
   `status = 'published'` (D18), records an `upload` engagement event, and issues a
   `NOTIFY` on the arrivals channel.
7. The capture and splat pipeline proceeds exactly as it does today.
8. When the pipeline finishes, the worker sets `asset_id` on the row.

### 6.2 What happens when steps fail

| Failure | Behavior |
|---|---|
| Location permission denied | Skip the nearby search. The contributor types name and category. `station_id`, `lat`, `lon`, and `google_place_id` are null. |
| Gemini finds no name | The nearby list still shows, with nothing pre-selected. |
| No Google match and nothing typed | Reject the submission. A place must have a name. |
| Splat pipeline fails | The place stays published with its photographs (D10). `asset_id` stays null. The card opens to photographs. |

### 6.3 Deriving the station label

If `lat` and `lon` are known, the server sets `station_id` to the nearest of the five
stations **when that station is within 800 metres**, otherwise null. This is a label only
(D9). It never places anything on a map. The 800-metre figure matches the existing
diorama span and the seeded catalog, whose furthest place walks 660 metres.

---

## 7. The Discover page

### 7.1 Placement

A top-level tab beside Map in `web/`, rendered by `web/src/ui/AppShell.ts` (D7). Selecting
Discover hides the PlayCanvas canvas and shows the Discover view. Selecting Map restores it.
The PlayCanvas application is **paused, not destroyed**, when Discover is active, because
re-initializing the engine and reloading splats on every tab switch would be slow.

### 7.2 Layout

Following the reference design:

- Title, with the subtitle "New spots near the T, rated by people who rode there."
- A search field on the right: "Search places, dishes or stops."
- Category chips: All, Food, Cafés, Events, Outdoors, Shops. These map onto the existing
  `Category` union — Food covers `restaurant` and `market`; Cafés covers `study`; Events
  covers `event_space`, `music`, and `stadium`; Outdoors covers `outdoor`; Shops covers
  `shop`. Museums and hotels fall under All only, which is a gap worth naming.
- Sort control on the right: **New**, **Top rated**, **Popular**. Choosing Popular reveals
  the window control: Today, Week, Month.
- A "New this week" row of larger cards, shown only when the New sort is active and at
  least one place is younger than seven days.
- An "All places" grid with a count.

### 7.3 The card

Each card shows a photograph, the venue name, a station dot in the line colour, the
category, the typical price, a score ring, and a rating count. A place created within
seven days carries a **New** badge.

A place with no Google match shows **no score ring and no rating count** (D17). It is not a
zero and not a placeholder; the element is absent, and the New badge occupies the attention
the score would have taken.

### 7.4 Opening a place

A click opens the place detail view. Photographs are the permanent content (D10). When
`asset_id` is set, the Gaussian splat loads as the primary view with photographs beneath.
When it is not, the view shows photographs and, if a job is still running, its pipeline
stage. Either way the page is never a dead end.

Opening the splat emits a `splat_open` engagement event. A card entering the viewport
emits `card_view`, debounced as described in section 4.4.

---

## 8. Live arrival: toast and bell

### 8.1 What is live and what is not

Decision D11 draws the line precisely:

- **The grid does not change** while a person is looking at it. New places enter on the
  next page load.
- **A toast appears** when a place is created, naming the place and its station.
- **A bell icon** in the header carries an unread count and opens a dropdown.

This is a deliberate choice. Inserting cards into a grid someone is reading moves content
under their cursor. The toast announces the arrival without disturbing the page.

### 8.2 Transport

The pattern already exists in `server/src/services/captureEvents.ts` and
`server/src/db/pg.ts`. Reuse it:

1. On place creation the API issues `NOTIFY discover_arrivals, '<json>'`.
2. The server holds one `listen` subscription for the whole process, not one per client.
3. `GET /api/discover/events` streams server-sent events to every connected browser.
4. The browser shows a toast and increments the bell count.

The payload is small and carries only a name, a station, and an identifier. The client
fetches the full record if the person clicks.

**Reconnection.** The `listen` helper already reconnects and exposes `onReconnect`. On
reconnect the browser requests `GET /api/notifications?since=<timestamp>` so nothing that
arrived during the gap is lost.

### 8.3 The bell dropdown

The dropdown shows two sections:

- **New places** — most recent contributed places, newest first.
- **Popular now** — top places by the today-window velocity score.

The unread count is the number of places created since `notification_reads.read_at` for a
signed-in person, or since the `localStorage` marker for an anonymous visitor. Opening the
dropdown updates the marker.

---

## 9. The mobile application

### 9.1 Current state

One file, a WebView, a LAN IP guess, `http://` hardcoded, no production URL.

### 9.2 Required changes (D5)

1. **Commit it.** `mobile/` and `map/` go onto a branch and get pushed before anything else.
2. **Native sign-in.** Registration and login become React Native screens. They call
   `/api/auth/*` directly. Credentials never enter the WebView. This is the security reason
   for D5: a WebView can be navigated, and a password form inside one is harder to trust.
3. **Secure token storage.** The session token goes in `expo-secure-store`, which uses the
   iOS Keychain and Android Keystore.
4. **Token handoff.** The native layer passes a short-lived, single-use handoff token into
   the WebView through `injectedJavaScriptBeforeContentLoaded`. The web application
   exchanges it at `POST /api/auth/exchange` for a normal session cookie. The handoff token
   expires in 60 seconds and cannot be replayed. The long-lived session token never enters
   the WebView.
5. **Real URL.** `extra.contributeUrl` is set per build environment. The LAN guess remains
   only as a development fallback, and `usesCleartextTraffic` is removed from the production
   Android configuration.

Browsing, scanning, and uploading stay web, inside the WebView (D5).

---

## 10. Security, abuse, and legal constraints

### 10.1 Abuse of the velocity ranking

Velocity ranks on engagement, and engagement is anonymous, so it is forgeable. Defences:

- Per-session deduplication as described in section 4.4.
- Per-IP rate limiting on `POST /api/engagement`, reusing `ipRateLimit` from
  `server/src/services/requestLimits.ts`.
- `card_view` is weighted 1 against `upload` at 10, so inflating the cheapest signal moves
  the ranking least.
- A place whose events come from a single `session_hash` is excluded from the Popular sort.
  One person cannot promote a place alone.

### 10.2 Google Places terms

Decision D13 removes the hardest problem here: because Google data never ranks anything, the
system never needs a history of rating counts, and so stores none.

What remains:

- Cache only the latest values, in `place_google_cache`, and refresh on read when
  `fetched_at` is older than the cache window.
- Display Google attribution wherever a Google rating is shown. The existing `PlaceRating`
  type already carries `source`, `count`, and `url`, so the display contract exists.
- `google_place_id` may be retained indefinitely. Other Places content may not.

**This requires verification against the current Google Maps Platform terms before launch.**
This document describes the shape of the constraint; it does not certify compliance. The
terms change, and the specific retention window must be read from the live policy.

### 10.3 Authentication

- Argon2id, or scrypt with the parameters in section 4.1.
- Session tokens stored as SHA-256 digests, never in plain text.
- Cookies on web: `httpOnly`, `Secure`, `SameSite=Lax`.
- Login rate limited per IP and per email address, so neither a single address nor a single
  account can be attacked at speed.
- Registration requires a password of at least 12 characters, checked against a list of the
  most common passwords. No composition rules, which push people toward predictable patterns.

### 10.4 Reports

Any visitor may report a place. Reports are rate limited per session. **Three distinct
sessions reporting the same place sets `status = 'hidden'` automatically**, pending
administrator review in the existing moderation panel. This bounds the damage window that
D18's publish-immediately rule opens.

### 10.5 Content from contributors is untrusted

A venue name and note are written by a member of the public. Render them as text, never as
markup. Photographs are already handled by the existing upload path, which parses
orientation and dimensions and deduplicates by SHA-256.

---

## 11. API surface

| Method and path | Auth | Purpose |
|---|---|---|
| `POST /api/auth/register` | none | Create an account |
| `POST /api/auth/login` | none | Start a session |
| `POST /api/auth/logout` | session | End the current session |
| `GET /api/auth/me` | session | Current account |
| `POST /api/auth/exchange` | handoff token | Native-to-WebView session handoff |
| `POST /api/auth/password-reset/request` | none | Begin a reset (**needs an email provider**) |
| `POST /api/auth/password-reset/confirm` | reset token | Complete a reset |
| `POST /api/places` | session | Create a contributed place |
| `PATCH /api/places/:id` | session, owner | Correct name, category, price, note |
| `GET /api/discover` | none | Search, filter, sort, paginate |
| `GET /api/discover/events` | none | Server-sent arrival stream |
| `GET /api/notifications` | optional | Bell feed, with `since` |
| `POST /api/notifications/read` | optional | Update the read marker |
| `POST /api/engagement` | none | Record `card_view` or `splat_open` |
| `POST /api/places/:id/report` | none | Report a place |
| `GET /api/admin/reports` | admin | Review reported places |

`GET /api/discover` takes `q`, `category`, `station`, `sort` (`new`, `rated`, `popular`),
`window` (`today`, `week`, `month`), `cursor`, and `limit`. It paginates by keyset, not
offset, so the list stays stable while new places arrive.

The existing passcode guards stay in place for administrator routes. `CONTRIBUTOR_PASSCODE`
is retired once accounts land, and the contribute app's invite-code screen becomes a sign-in
screen.

---

## 12. Build order

Each phase ends in a state that runs. Phases 1 and 2 are prerequisites for everything else.

**Phase 1 — rescue the untracked work.**
Commit `mobile/` and `map/` on a branch and push. Nothing else starts until this is done,
because a stale worktree is one command away from losing both.

**Phase 2 — accounts.**
Migration `002`. Password hashing, sessions, the `/api/auth/*` routes, and the web sign-in
form in `contribute/`. Retire `CONTRIBUTOR_PASSCODE`.

**Phase 3 — place creation.**
`POST /api/places`, the Gemini category and name extension, the Google Places nearby search,
the contributor confirmation step, and station-label derivation.

**Phase 4 — Discover, static.**
The tab in `AppShell`, the card grid, search, category chips, and the New and Top rated
sorts. No live behavior yet. The page is useful at the end of this phase.

**Phase 5 — engagement and velocity.**
The engagement endpoint, deduplication, the rollup worker, the `velocity_scores` table, and
the Popular sort with its three windows.

**Phase 6 — live arrivals.**
`NOTIFY` on creation, the server-sent event route, the toast, and the bell dropdown.

**Phase 7 — native sign-in.**
Expo screens, `expo-secure-store`, the handoff token, and a real production URL.

**Phase 8 — abuse and moderation.**
Reports, the automatic hide threshold, rate limits across every public write endpoint, and
the raw-event retention job.

---

## 13. Verification

Extend the existing commands rather than adding a new test system. The repository already
runs `pnpm typecheck`, `pnpm build`, `pnpm --filter @faresight/server test`, and
`node scripts/verify_e2e.mjs`.

- **Migration.** `002` applies and reverts cleanly against the Tiger Data instance.
  `server/test/captures.test.mjs` already proves the Docker Postgres path works locally.
- **Accounts.** Registration, login, wrong password, rate-limit lockout, session expiry,
  and the handoff token's single use and 60-second expiry.
- **Velocity.** Given a fixed event set and a fixed clock, the score matches a
  hand-computed value. This is why the formula in section 5.1 is written explicitly.
- **Deduplication.** A repeated `card_view` from one session inside an hour does not
  increase the score.
- **Live arrivals.** Creating a place delivers an event to a connected client, and a client
  that reconnects after a dropped connection recovers the missed arrival through `since`.
- **End to end.** Sign in, create a place, confirm it appears in `GET /api/discover`,
  confirm the toast fired, open it before the splat exists and get photographs, then confirm
  the splat view appears once `asset_id` is set.

---

## 14. Open items, and how each was resolved

The scope was later changed from "real product" to **demo**, and every item below was settled
during implementation rather than left open.

| # | Item | Resolution |
|---|---|---|
| 1 | **Google Places API key** | **Made optional, not required.** `.env` has no Google credential, and the handoff document records `places.googleapis.com` answering `403 PERMISSION_DENIED` for the project behind the existing key: Places is not enabled and enabling it needs a console action and billing. The whole module therefore degrades: with no key the nearby search returns an empty list, contributors type a name, and cards carry no score. `/api/health` reports `places: false`. Nothing blocks on it. |
| 2 | **Email provider for password reset** | **Reset is not built, and Google is the recovery path.** The repository has no outbound email and a demo does not justify adding one. Someone who signs in with Google can always get back in. An account created with a password and then forgotten is unrecoverable, which is stated here rather than discovered later. `password_resets` exists in the migration so adding the flow later needs no schema change. |
| 3 | **Google Places retention terms** | **Sidestepped by D13.** Because Google data ranks nothing, no history of review counts is needed. `place_google_cache` holds only the latest value per place, refreshed after a day. `google_place_id` is retained; nothing else is. The terms still need reading before any public launch. |
| 4 | **Argon2id dependency** | **Used the scrypt fallback.** `node:crypto` provides scrypt, so no native module is added. Parameters are `N = 2^16, r = 8, p = 1`, about 100 ms per hash, stored with the hash so they can be raised later without invalidating existing passwords. |
| 5 | **Museums and hotels** | **Added a More chip** covering `museum`, `hotel` and `activity`, which the reference chips leave reachable only under All. |
| 6 | **The two unmerged branches** | **Not merged; flagged.** This work is built on `main` in `feat/accounts-discover`. `t3/desktop-liquid-glass-redesign` (8 commits) rewrites `web/src/ui/AppShell.ts`, the same file the Map/Discover switch is added to, so merging it afterwards will conflict there. That is a decision for whoever owns both branches. |

### 14.1 Changes to the specification found during implementation

- **Ten stations, not five.** `main` gained Haymarket, Copley, Aquarium, Central and Coolidge
  Corner while this was being written. Because D6 keeps contributed places off the station maps,
  this only widens the set of candidate station *labels*.
- **Velocity needed correcting.** The first version gated a place's whole score on more than one
  distinct session having engaged with it. Since the `upload` event carries the contributor's own
  session, a newly added place scored zero until a stranger found it: reachable under New, never
  under Popular, which defeats the sort. An upload costs a real account and real photographs, so
  it is now trusted on its own and the multi-session guard applies only to the cheap anonymous
  signals.
- **Discover is not a `SceneMode`.** Section 7.1 implied adding it to the engine's scene machine.
  It is a flat page instead, overlaid while the canvas is hidden and the renderer paused through
  a new `setPaused`. Every engine switch would otherwise have to handle a mode with no 3D scene.
- **Sessions use bearer tokens, not cookies.** Section 10.3 specified `httpOnly` cookies. The API
  is a different origin from both front ends and its CORS is `*`, which a cookie cannot accompany.
  The token is in `localStorage` on web and the platform keychain on the phone. The trade is that
  a script on the page can read the web token; it is revocable and expiring, and the native app
  never exposes its own token to the WebView.

## 15. Superseded open items

Kept verbatim as they were written, so the resolutions in section 14 can be read against the
original wording. **This list is historical. Do not act on it; see section 14.**

1. **Google Places API key.** `.env` has no Google credential. `GOOGLE_PLACES_API_KEY` must
   be provisioned, with billing and a quota, before Phase 3. Nearby search and place details
   are both billable.
2. **Email provider.** Password reset in section 11 cannot work without outbound email. The
   repository has no provider. Either add one, or ship Phase 2 without reset and accept that
   a forgotten password means a lost account until it exists. **This must be decided before
   Phase 2 ships, not after.**
3. **Google Places retention terms.** Section 10.2 describes the constraint's shape. The
   current policy must be read and the cache window set from it.
4. **Argon2id dependency.** Adding it means a native module. Confirm that is acceptable, or
   accept the scrypt fallback.
5. **Museums and hotels.** The reference category chips do not cover the `museum` or `hotel`
   categories. They appear only under All. Either add a chip or accept the gap.
6. **The two unmerged branches.** `feat/contribute-mobile` (7 commits) and
   `t3/desktop-liquid-glass-redesign` (8 commits) both touch files this work touches —
   `web/src/ui/AppShell.ts` most of all, where the Discover tab goes. Decide whether they
   merge before Phase 4 or are abandoned. Building the Discover tab on `main` and then
   merging an 8-commit `AppShell` redesign afterwards will conflict.

---

## 16. Assumptions

Stated so they can be corrected rather than discovered later.

- The reference screenshot is a design target. It matches no code in the repository.
- The seeded catalog from `shared/src/demoCatalog.ts` also appears on Discover, alongside
  contributed places. It is the only reason the page has content before anyone uploads.
- Engagement is recorded for seeded places too, so the Popular sort is meaningful on day one.
- "Reviews" on the merged page means the Google-sourced ratings and review highlights the
  `liveReviews` service already fetches, plus the star ratings added on
  `feat/contribute-mobile`. FareSight does not collect its own written reviews, because D13
  gives ratings no role in ranking and D3 gives visitors no account to write one with.
