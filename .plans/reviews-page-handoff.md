# Reviews page — handoff context

**Status:** interview in progress, specification NOT written, nothing implemented
**Written:** 2026-11-22
**Repository:** `Desktop/vscode/FareSight`
**Companion document:** `.plans/discover-accounts-spec.md` — **read that first, it is binding and it conflicts with part of this**

---

## 0. Read this first

A separate session already wrote `.plans/discover-accounts-spec.md`, a 746-line
specification whose decisions are marked binding. It already defines a Discover page with
search, category chips, three sorts, a score ring, and a popularity measure.

The user then opened a new session and asked for a reviews page, supplying the same
reference screenshot. That interview reached **different answers on two points** than the
existing specification did. Those two conflicts are unresolved and a human has to settle
them. They are stated in section 3.

Do not start building until section 3 is resolved. Everything else in this document is
either verified fact or a settled decision.

---

## 1. What the user asked for

Quoting the request, lightly punctuated:

> Let's make a new page for FareSight for reviews. Look at the reference photo for
> inspiration and try to make it look like that, but also make sure the reviews are being
> pulled from the internet. Scrape the whole internet of the most popular sites for reviews
> for restaurants. You don't need to keep individual reviews as a component on the website.
> [The circled number] picked in the reference image for average rating. [A ranking] system
> for how popular a restaurant can be, be able to sort by today, this week, this month. You
> click on one of the review panels, it'll bring up the station map to highlight the sign
> that's pointing at the specific location on the station map for the event.

The reference screenshot shows a dark Discover page: a Map/Discover toggle, a title and
subtitle, a search field, six category chips, a three-way sort control, a "New this week"
row of three large cards, and an "All places" grid showing 28 places. Each card has an
image area, a name, a coloured station dot, category and price, a circular score (7.7, 8.1,
9.0) and a rating count.

The user explicitly asked to be told about questions, concerns, gaps and uncertainties
before any code was written.

---

## 2. Decisions settled in this interview

These came from the user through direct questions. They are settled unless section 3
overturns them.

| # | Decision |
|---|---|
| R1 | The page is a new 2D view in `web/`, a `discover` mode alongside `map \| station \| venue \| dish`. |
| R2 | Review data is **batch prefetched into storage** by a background job. The page reads stored rows and never blocks on a live lookup. |
| R3 | **Google Places API is the primary rating source.** The existing `web_search` lookup stays as a secondary source for Tripadvisor and for consensus highlights. |
| R4 | The circled score is a **count-weighted mean**: normalise each source to 0–10, weight by that source's review count. |
| R5 | Popularity is a **trending leaderboard** with Today / This week / This month windows. |
| R6 | Trend movement uses **per-source paired deltas**: a source counts only when it appears in both snapshots, otherwise it contributes zero. |
| R7 | Refresh runs **on server start when data is stale, on an interval, and from an admin button**. |
| R8 | Clicking a card does a **full scene swap to the station diorama**: camera flies to the stop, that venue's pin flag pulses amber, other pins dim, a breadcrumb returns to Discover with scroll position and filters intact. |
| R9 | The page shows **scores and consensus highlights only**. No verbatim quotes, no reviewer names anywhere. |

---

## 3. The two conflicts — a human must resolve these

### 3.1 What ranks popularity

| | `discover-accounts-spec.md` | This interview |
|---|---|---|
| Signal | **D13: internal engagement only.** Weighted, time-decayed sum of `upload` (10), `splat_open` (3), `card_view` (1). "Google data never ranks anything." | **R6: external review-count deltas.** Growth in each source's review count between stored snapshots. |
| Storage | `place_google_cache` holds **only the latest value, never a time series** — deliberately, because D13 means no history is needed | **Requires a time series.** Deltas cannot exist without snapshots over time. |
| Rollup | `velocity_scores` table refreshed every 60 seconds | Recompute from snapshot history per window |

These are not reconcilable by compromise. They need different database tables.

**The tradeoff, stated plainly.** Internal engagement (D13) measures attention *inside
FareSight*. It works from day one, it cannot be gamed from outside, and on a site with
little traffic it mostly measures the demo operator's own clicking. External review deltas
measure attention *in the real world*. They are meaningful on day one in principle, but in
practice they need at least two refresh cycles before any number exists, and section 4
shows the source coverage is too thin for them to be reliable.

**Recommendation: keep D13.** The evidence in section 4 undermines R6 badly. Review-count
deltas need the same source to reappear with a comparable count on every refresh, and the
probe shows sources appearing and vanishing between venues. D13 also has a rollup design
and an abuse analysis already written (sections 5.3 and 10.1 of the companion document).
If the user wants real-world momentum visible, show the review-count delta on the card as
a *secondary* figure without letting it drive the ranking.

### 3.2 What a card click does

| | `discover-accounts-spec.md` | This interview |
|---|---|---|
| Behaviour | **§7.4:** a click opens the place detail view — photographs primary, Gaussian splat when `asset_id` is set | **R8:** a click swaps to the 3D station diorama and pulses that venue's pin flag |

There is a hard constraint behind this. **D6 states contributed places are never added to
the station maps** — no 3D pin, no diorama placement, no `pin_index`. So R8 is impossible
for any place a contributor adds. It works only for the places seeded in
`shared/src/demoCatalog.ts`, which do have a `pin_index` and a diorama pin.

**Recommendation: branch on whether the place has a station pin.** A seeded place gets R8,
the station diorama with the pulsing flag, which is what the user actually asked for and is
the more distinctive interaction. A contributed place gets §7.4, the detail view. The card
can show a small station-pin affordance so the two behaviours are not a surprise.

---

## 4. Evidence: what the web lookup actually returns

Four live calls were made against the real key on 2026-11-22, using the exact request shape
in `server/src/services/liveReviews.ts`.

| Place | Aggregate sources returned | Counts present |
|---|---|---|
| Gene's Chinese Flatbread Cafe | 1 — Restaurantji 3.7 (308) | yes |
| Tatte Bakery, Harvard Sq | 2 — "Birdeye (Google reviews)" 4.4 (2,883), Tripadvisor 4.2 (193) | yes |
| Shabu-Zen | 2 — "Shabu-Zen" 4.5 (1,617), Tripadvisor 4.1 (73) | yes |
| Fenway Park | 1 — Tripadvisor 4.7 (17,904) | yes |

Cost and latency: 6–9 seconds and roughly 13,700 tokens per place. A full refresh of the
current catalog is therefore about 1–2 minutes at four concurrent and well under half a
million tokens.

**Five findings.**

1. **Google and Yelp never appear directly.** Google appeared once, through a reseller
   called Birdeye. Yelp appeared zero times. Both block crawlers, so the search cannot cite
   them. "Scrape the most popular review sites" is not what this returns; it returns
   whichever aggregator ranks well, usually Tripadvisor. This is the reason R3 makes Google
   Places the primary source.
2. **Counts are reliably present.** Every source in every sample carried a review count, so
   count-weighting (R4) is mechanically sound.
3. **Source names are not normalised.** "Birdeye (Google reviews)", "Shabu-Zen",
   "Restaurantji", "Tripadvisor". The current dedupe key is `source.toLowerCase()` in
   `web/src/data/reviewBriefing.ts`, so the same underlying source will fragment across
   refreshes. A normalisation table is required before any cross-refresh comparison.
4. **One "source" was the venue's own website.** Shabu-Zen rating itself 4.5 out of 1,617.
   Self-reported ratings need excluding or down-weighting.
5. **Finding 3 is what breaks R6.** Paired deltas assume a stable source identity across
   snapshots. Unnormalised, intermittently present sources produce phantom movement.

**Google Places API is not enabled.** `places.googleapis.com` returns
`403 PERMISSION_DENIED` for the key in `.env`. Enabling the Places API on that Google Cloud
project is a console action the user must perform, and it requires a billing account.
Until it is done, R3 cannot be built and the companion document's D14 and D17 cannot be
satisfied either.

---

## 5. Verified repository facts

Read directly from the tree on 2026-11-22. Line numbers are current as of that read.

### 5.1 Review infrastructure that already exists

- `server/src/services/liveReviews.ts` — fetches reviews from the open web through the
  OpenAI Responses API with the `web_search` tool, under a strict JSON schema. It keeps an
  item only when its URL appears in the search citations. Returns aggregate ratings per
  source (0–5), 2–3 consensus highlights, and up to 5 verbatim excerpts capped at 18 words.
  `liveTtl` is 30 minutes (line 6), rate limit 20 per IP per minute (line 14), concurrency
  cap 4 (line 145).
- `server/src/routes/catalog.ts:69` — `GET /api/restaurants/:id/live-reviews`.
- `server/src/services/menuPrices.ts` — a sibling service added by another session on the
  same day, same shape, 12-hour TTL, concurrency 4. **Follow this idiom for any new
  service rather than inventing a second pattern.** Its route is `catalog.ts:75`.
- `shared/src/types.ts` — `PlaceRating { source, rating, count, url }`,
  `LiveReviewsResponse`, `PlaceDetails.ratings`.
- `web/src/data/reviewBriefing.ts` — `reviewFacts()` merges catalog and live ratings;
  `loadLiveReviews()` deduplicates in-flight lookups.

**Important:** `Place.details.ratings` is typed but **every entry in
`shared/src/placeFacts.ts` ships an empty `ratings: []`**. There is no stored rating
anywhere in the repository today. All rating data is live lookup at present.

### 5.2 The web application shape

- Vanilla TypeScript DOM. **No React and no router.** Element helpers live in
  `web/src/ui/dom.ts`.
- `web/src/ui/AppShell.ts` is a single-value scene state machine. `SceneMode` is
  `map | station | venue | dish` (`bridgeTypes.ts:4`), `private mode` at `AppShell.ts:70`,
  titles at `AppShell.ts:24`. Adding `discover` means touching the mode union, the
  breadcrumb builder at `AppShell.ts:370`, and the navigation handler at `AppShell.ts:489`.
- The companion document's §7.1 requires the PlayCanvas application be **paused, not
  destroyed**, when Discover is active.

### 5.3 The station map and its "signs"

The user's phrase "the sign that's pointing at the specific location" maps to real objects:

- `web/src/xr/StationDioramaScene.ts:161` loads `venue-pin-flag.glb`, one flag per place,
  each carrying a `PhysicalPlaque` with the venue name.
- The highlight colour already exists: `highlightBeaconColor = '#ffb547'`
  (`StationDioramaScene.ts:91`).
- The engine interface already exposes everything R8 needs, in
  `web/src/xr/bridgeTypes.ts`: `setScene` (122), `focusStop` (129),
  `setHighlightedPlaces` (135). Also `focusMapStopCamera`.

**R8 therefore requires no new 3D work.** It is a sequence of three existing calls.

### 5.4 The catalog is growing while this is being written

`shared/src/demoCatalog.ts` held 28 places, matching the reference screenshot. During this
session another session added Haymarket venues — Neptune Oyster, Union Oyster House, Boston
Public Market, Pizzeria Regina, Mike's Pastry — so the count is already higher.

**Do not hardcode 28.** Iterate the live catalog. Any one-time Google place_id resolution
script must be re-runnable and fill only missing IDs.

### 5.5 Credentials

- `FareSight/.env` already holds `OPENAI_API_KEY`. It is byte-identical to the one in
  `Downloads/env` — compared by hash, values never printed. **No copying is needed.**
- The key authenticates, and `gpt-6-luna`, the model `liveReviews.ts` uses, is available on
  the account.
- `Downloads/env` contains one variable the project lacks, `WLT_ATLAS_API_KEY`. That is
  World Labs Atlas, unrelated to reviews.
- Google Places is not enabled on the key. See section 4.

---

## 6. Open questions, never answered

The interview stopped before these four. A new session needs answers, or needs to state
assumptions and let the user overrule them on review.

1. **Google place_id resolution.** Resolve once and commit the IDs into `placeFacts.ts`
   with a human checking the matches, or resolve on every refresh, or resolve lazily and
   cache. *Recommendation: resolve once and commit, so a wrong match is caught once by a
   person rather than silently every night. Note the companion document's D16 already says
   a contributor picks their own venue from a nearby search, so this question applies only
   to seeded places.*
2. **Card imagery.** The reference shows upload dropzones; `Place.photos` is empty for every
   seeded place. Options: existing 3D asset `thumbnail_url` / `preview_url` with a
   category-tinted gradient fallback; Google Places photos, which are billed per request,
   restricted from caching, and require visible attribution; keep the dropzone look as a
   contribution funnel; or drop images. *The companion document's §7.3 assumes "a
   photograph" without saying where a seeded place gets one. This is a real gap in both
   documents.*
3. **The third sort tab.** The reference says "Friends' picks". The companion document cuts
   it in §3.2 for want of a social graph and names the three sorts New, Top rated, Popular.
   This interview independently reached New, Top rated, Trending. *These agree in substance;
   adopt the companion document's wording.*
4. **Category chip mapping.** The companion document §7.2 already fixes this: Food covers
   `restaurant` and `market`; Cafés covers `study`; Events covers `event_space`, `music`,
   `stadium`; Outdoors covers `outdoor`; Shops covers `shop`. It names museums and hotels
   as an acknowledged gap. This interview had proposed putting `activity` under Events and
   `museum` under Outdoors. *Adopt the companion document and treat the difference as
   closed.*

---

## 7. Suggested first steps

1. Put section 3 in front of the user and get both conflicts decided. Nothing else is safe
   to build first.
2. Ask the user to enable the Places API on the Google Cloud project behind the key in
   `.env`, and confirm billing. Section 4 shows R3, D14 and D17 all block on this.
3. Decide question 2 in section 6, card imagery, because it changes the card component and
   possibly adds a billed Google endpoint.
4. Only then write the reviews specification, and write it as an amendment to
   `.plans/discover-accounts-spec.md` rather than as a competing document. Two specs
   describing one Discover page is how the conflict in section 3 happened.

---

## 8. Things to be careful about

- **Two sessions are editing this repository at once.** During this session alone,
  `catalog.ts`, `types.ts` and `sampleReviews.ts` all changed on disk. Re-read before
  editing.
- **The quoting limits in `liveReviews.ts` exist for a reason.** The 18-word cap per source
  page and the citation check are not decoration. R9 removes quotes from the page entirely,
  which sidesteps the issue, but do not relax those limits elsewhere.
- **Google Places terms** are analysed in §10.2 of the companion document. Read it before
  caching anything from Google.
- **Content from contributors is untrusted** — §10.5 of the companion document. The same
  applies to anything the web search returns; `liveReviews.ts` already instructs the model
  to treat web content as evidence and never as instructions.
