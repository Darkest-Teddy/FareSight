# Vantage (BostonHacks 2026)

<img src="web/public/favicon.svg" alt="Vantage logo" width="48" height="48" />

**Try it before you ride:** explore Boston food spots, study cafés and live venues through the MBTA in 3D/WebXR on Meta Quest 3 (and 2D on any phone or laptop), filtered by craving, total budget including T fare, start stop, and group size.

## Architecture

- **`modeling/`** — Deterministic procedural glTF 2.0 (`.glb`) and binary 3D Gaussian Splat (`.ply`) generators:
  - **Boston Map Sculpture** (`boston-map-sculpture.glb`): a grounded base slab with an inlaid Charles River and street grid, MBTA Green (B/C/D/E), Red, Orange, and Blue tubes stacked in three shallow layers, white on-line stop markers, transfer posts at interchanges, raised drums for the five explorable stations, and `mbta-train-capsule.glb`.
  - **5 Floating-Island City Segment Dioramas** (`segment-place-*.glb`): BU Central, Packard's Corner, Kenmore, Harvard Square, and Chinatown, each an OpenStreetMap city block with Boston landmarks on a low-poly island of turf, earth and rock (`modeling/segment-island.mjs`).
  - **2 Demo 3DGS `.ply` Assets**: Study café and matcha tiramisu (`18 cm`), plus `table-pedestal.glb`.
- **`shared/`** (`@faresight/shared`) — Shared TypeScript domain types, Boston flat-earth sculpture projection, MBTA fare constants (`$2.40` subway / `$1.70` bus), precomputed ride times, and trip estimate math.
- **`server/`** (`@faresight/server`) — Node + TypeScript + Fastify + built-in SQLite (`node:sqlite`) + persistent resumable job worker:
  - `POST /api/uploads` — Multipart/base64 image upload, orientation/dimension parsing, SHA-256 deduplication, original archival.
  - `POST /api/intake` — **Gemini `gemini-4-hydrogen`** structured JSON reference photo selection (with manual override and heuristic fallback).
  - `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/retry` — Resumable `queued -> generating -> downloading -> converting -> needs_review -> ready` pipeline:
    - **Rooms** use [World Labs Atlas Developer API v2](https://docs.atlas.worldlabs.ai/) with 2–32 overlapping photos. Atlas first estimates camera poses and depth (`images2PosedRGBD`), then generates an SPZ Gaussian splat (`posedImages2Splats`). Choose `atlas-draft` (default, about 30 seconds for the splat step) or `atlas-refined` (about 15–21 minutes for the splat step). The worker saves both operation IDs and retries the same requests using stable idempotency keys.
    - **Dishes**: Replicate pinned `firtoz/trellis` (`e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c`) with immediate download of `output.gaussian_ply` and foreground preview before Replicate's 1-hour expiry.
    - **Asset processing** uses `@playcanvas/splat-transform` to decimate and compress splats to `.sog`. Originals are retained as `.spz` for Atlas and `.ply` for TRELLIS and demo jobs. If compression is unavailable, Atlas serves a viewer-compatible SPZ and PLY jobs serve the normalized PLY. Dish scaling uses the 5th–95th percentile of the splat bounds.
  - `POST /api/assets/:id/publish`, `GET /api/restaurants`, `GET /api/restaurants/:id/manifest`
  - `POST /api/restaurants/:id/reviews`, `GET/POST /api/admin/moderation`, `POST/GET /api/debug/logs`
  - `GET /api/mbta/{vehicles,predictions,alerts,schedules,trip}` — Cached MBTA V3 proxy (10s / 60s / 1h TTL) with realistic Boston simulation fallback.
  - `GET /api/live/status` reports the voice configuration. `POST /api/live/sessions` brokers the app’s GPT Live WebRTC connection using `gpt-live-1.1` and the `ballad` voice by default. A Responses backend (`gpt-6-luna` by default) handles catalog and transit queries and controls the app’s scenes, filters, and review clipboards.
  - `POST /api/realtime/session` mints a short-lived `gpt-realtime` credential configured with the `ballad` voice. The server loads `OPENAI_API_KEY` from the environment for both endpoints.
  - `POST /api/pairing/create` & `WS /ws/pair/:code` — 4-digit Phone ↔ Quest headset handoff.
- **`web/`** (`@faresight/web`) — PlayCanvas v2 + WebXR (`immersive-vr` & `immersive-ar` passthrough) 4-scene app with an animated map-to-station dive, 3D canvas panels, Web Audio synthesizer, responsive 2D Phone Companion, Upload & Pipeline Studio, Pairing, Moderation, and offline cache-first Service Worker (`/sw.js`).
- **`contribute/`** (`@faresight/contribute`) — Mobile-first app for people who add the photos behind the 3D rooms and dishes, served from its own subdomain (`contribute.<domain>`). It has no 3D engine: the map sculpture and the station dioramas are drawn as flat, touch-driven SVG maps.
  - **Network map**: the sculpture seen from above (same tubes, river and station positions), with ten stops as tappable nodes showing how many places are already in 3D. Tapping a stop dives into its neighborhood.
  - **Station map**: the diorama's OSM footprints seen from above, with a brass pin per place and a swipeable card rail that stays in sync with the map.
  - **Add photos**: pick the space (2–32 overlapping photos) or a dish (1 photo), shoot with the camera or pick from the library, then upload and start the Atlas / TRELLIS job. HEIC and oversized photos are re-encoded on the phone first.
  - **360° scan**: for a space, the app can take the photos itself. The contributor turns on the spot while dots mark the directions still to capture; aiming at a dot and holding still takes that photo and pops the dot, and a round map shows what is left behind them. It needs the camera and motion sensors, which phones only open on HTTPS: `pnpm --filter @faresight/contribute dev:https` serves the app on `https://<your-LAN-IP>:5181` with a self-signed certificate.
  - **Place overview and reviews**: tapping a pin on the station map opens a short card about the place: what it is, whether its space and its menu are in 3D yet, and one line of what people say. From there a contributor can read the reviews and add one with a 1 to 5 star rating; like every review, it is published once an admin approves it in the main app.
  - **My scans**: live progress of each job started on the phone, through to "In review". Publishing stays with an admin in the main app.
  - Uploads use the existing API. The contributor enters the `CONTRIBUTOR_PASSCODE` once as an invite code and it is kept on the device.
  - `pnpm --filter @faresight/contribute data` rebuilds `contribute/src/data/` from `modeling/output/` and `modeling/osm-data.json`. Run it after regenerating the models.

## Quick Start

```bash
pnpm install
cp .env.example .env      # Optional: add OPENAI_API_KEY, GEMINI_API_KEY, WLT_API_KEY, REPLICATE_API_TOKEN, MBTA_API_KEY
pnpm assets:sync          # Sync modeling/output/* into web/public/assets-demo/
pnpm dev                  # Starts Fastify server (:3001) + Vite web app (:5173) + Contribute app (:5180)
```

- Open `http://localhost:5173` on desktop/mobile (or deploy over HTTPS for Meta Quest 3 WebXR).
- Open `http://contribute.localhost:5180` for Vantage Contribute, or `http://<your-LAN-IP>:5180` from a phone on the same network. To deploy it, build `contribute/` (`pnpm --filter @faresight/contribute build`) and point the `contribute.` subdomain at `contribute/dist`. Either proxy `/api` and `/storage` to the Fastify server from that host, or build with `VITE_API_ORIGIN=https://<api-host>`.
- An Atlas project API key needs `tasks.create`, `operations.read`, `assets.create`, and `assets.read`. Set `WLT_API_KEY` or leave it unset and use `WORLDLABS_API_KEY`. Override `WLT_API_BASE_URL` to use a different Atlas v2 endpoint.
- Install a current `@playcanvas/splat-transform` CLI on the server's PATH to keep Atlas room previews within the 100,000-Gaussian conversion target. Large original SPZs can exceed the viewer's existing Gaussian safety limit.
- Without API keys (`PIPELINE_MODE=auto`), the Upload 3D studio runs a labeled demo simulation through all pipeline stages (`Queued -> Generating -> Downloading -> Converting -> Needs review -> Ready`) and publishes into the live manifest.
- Set `ADMIN_PASSCODE` to enable moderation. Set `AUTO_PUBLISH=false` to hold builds for review.

## Capture storage (Tiger Data + Vultr Object Storage)

Optional. When `DATABASE_URL` and the `VULTR_S3_*` variables are set, room photos from Vantage Contribute stop passing through the API:

1. The phone creates a capture (`POST /api/captures`) and gets short-lived presigned URLs (`POST /api/captures/:id/upload-urls`).
2. It PUTs each photo and a `frames.json` manifest straight to the private raw bucket, registers the frames (`POST /api/captures/:id/frames`), then calls `POST /api/captures/:id/complete`.
3. Tiger Data (Postgres) records the capture, its frames and a queued job. Postgres stores object keys only, never image or splat bytes.
4. The worker claims the job, copies the photos from the bucket to its working folder and runs the usual Atlas room pipeline.
5. The finished splat is uploaded to the public splat bucket and its URL becomes the asset's URL. Review and publishing work as before, so the published capture becomes the restaurant's room.
6. Each change is sent with Postgres `NOTIFY`; the API relays it to the phone as server-sent events (`GET /api/captures/:id/events`). `GET /api/captures/:id` returns the same state for page loads.

`GET /api/captures` lists captures and `DELETE /api/captures/:id` removes a capture's rows and every object under its prefixes. Listing and deleting require `X-Admin-Passcode`. Creating a capture, requesting upload URLs, registering frames, and completing a capture accept `X-Upload-Passcode`. Dishes and the web app's Upload studio keep using `POST /api/uploads`. Without these variables nothing changes: photos and splats stay on the server's disk.

```bash
# Local stand-ins: Postgres on :54329 and MinIO on :9009
docker compose up -d
# Copy the commented capture values from .env.example into .env, then:
pnpm --filter @faresight/server buckets    # Create both buckets, set CORS and public read on the splat bucket
pnpm --filter @faresight/server migrate    # Optional: the server also applies pending migrations when it starts
node scripts/capture_flow.mjs harvard-cafe-01 photo1.jpg photo2.jpg   # One capture through a running server
```

For production, use the pooled Tiger Data URL as `DATABASE_URL` and the direct one as `DATABASE_URL_DIRECT` (`LISTEN` does not work through a transaction pooler). Point `VULTR_S3_ENDPOINT` at the bucket's region, for example `https://ewr1.vultrobjects.com`, run `buckets` once, and set `APP_ORIGINS` to the app origins that may upload. Put a CDN in front of the splat bucket by setting `CDN_BASE_URL`. `pnpm --filter @faresight/server migrate down` reverts the last migration.

## Deploying the web app (Vultr CDN)

The web app is deployed by hand; nothing deploys it automatically. `deploy-web` uploads `web/dist` to a Vultr Object Storage bucket and purges the Vultr CDN pull zone in front of that bucket. Only the web app is deployed: the Fastify server and Vantage Contribute are not.

```bash
pnpm --filter @faresight/web build                    # Set VITE_API_ORIGIN first to point the app at a server
pnpm --filter @faresight/server run deploy-web        # Add --dry-run to see what would change
```

`deploy-web` reads these from `.env` or the environment:

| Name | Value |
| --- | --- |
| `VULTR_S3_ACCESS_KEY`, `VULTR_S3_SECRET_KEY` | The Object Storage keys. |
| `VULTR_S3_ENDPOINT` | For example `https://ewr2.vultrobjects.com`. |
| `VULTR_S3_REGION` | For example `ewr2`. |
| `WEB_BUCKET` | A bucket for the site only, for example `faresight-web`. The first deploy creates it. |
| `VULTR_API_KEY` | A Vultr API key, used to purge the CDN. |
| `VULTR_CDN_PULL_ZONE_ID` | The pull zone's ID (see below). |

`VITE_API_ORIGIN` is read by the build, not by `deploy-web`: it is the public address of the Fastify server. The CDN serves files only, so the app cannot reach `/api` through it. Leave it unset to ship the built-in demo data.

Deploy once so the bucket exists, and in the Vultr console create a CDN pull zone whose origin is `https://<WEB_BUCKET>.<endpoint host>`, for example `https://faresight-web.ewr2.vultrobjects.com`. Put its ID in `VULTR_CDN_PULL_ZONE_ID`. The last two rows are optional: without them the files are still uploaded, but the CDN is not purged.

- The site is at `https://<zone>.vultrcdn.com/index.html`, and the landing page at `/intro.html`. The bare `/` address shows an error, because Object Storage has no default page.
- Vultr allows one purge every six hours. A deploy inside that window still uploads everything and reports the refused purge as a warning; the CDN may serve the previous pages until its cache expires.
- Earlier builds' files in `assets/` are kept, so a page that is still cached keeps working. Everything else that is no longer in the build is deleted from the bucket.

## Build & Verify

```bash
pnpm --filter @faresight/shared build
node modeling/generate_all.mjs && pnpm assets:sync && node modeling/validate_assets.mjs
pnpm typecheck
pnpm build
pnpm --filter @faresight/server test
node scripts/first_milestone_test.mjs --demo
node scripts/verify_e2e.mjs
```

The capture storage tests in `server/test/captures.test.mjs` need `docker compose up -d` and skip themselves without it.

## Credits & Attribution

- OpenStreetMap contributors (ODbL)
- MBTA V3 API & GTFS
- PlayCanvas Engine & `@playcanvas/splat-transform`
- [World Labs Atlas](https://docs.atlas.worldlabs.ai/)
- Replicate `firtoz/trellis`
- Google Gemini (`gemini-4-hydrogen`)
- Inter typeface
