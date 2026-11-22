# FareSight (BostonHacks 2026)

**Try it before you ride:** explore Boston food spots, study cafés, karaoke suites, and live venues through the MBTA in 3D/WebXR on Meta Quest 3 (and 2D on any phone or laptop), filtered by craving, total budget including T fare, start stop, and group size.

## Architecture

- **`modeling/`** — Deterministic procedural glTF 2.0 (`.glb`) and binary 3D Gaussian Splat (`.ply`) generators (`node modeling/generate_all.mjs && node modeling/validate_assets.mjs`):
  - **Boston Map Sculpture** (`boston-map-sculpture.glb`): a grounded base slab with an inlaid Charles River and street grid, MBTA Green (B/C/D/E), Red, Orange, and Blue tubes stacked in three shallow layers, white on-line stop markers, transfer posts at interchanges, raised drums for the five explorable stations, and `mbta-train-capsule.glb`.
  - **5 Floating-Island City Segment Dioramas** (`segment-place-*.glb`): BU Central, Packard's Corner, Kenmore, Harvard Square, and Chinatown, each an OpenStreetMap city block with Boston landmarks on a low-poly island of turf, earth and rock (`modeling/segment-island.mjs`).
  - **6 Demo 3DGS `.ply` Assets**: Ramen house, karaoke suite, study café, tonkotsu ramen (`24 cm`), katsu curry (`26 cm`), and matcha tiramisu (`18 cm`), plus `table-pedestal.glb`.
- **`shared/`** (`@faresight/shared`) — Shared TypeScript domain types, Boston flat-earth sculpture projection, MBTA fare constants (`$2.40` subway / `$1.70` bus), precomputed ride times, and trip estimate math.
- **`server/`** (`@faresight/server`) — Node + TypeScript + Fastify + built-in SQLite (`node:sqlite`) + persistent resumable job worker:
  - `POST /api/uploads` — Multipart/base64 image upload, orientation/dimension parsing, SHA-256 deduplication, original archival.
  - `POST /api/intake` — **Gemini `gemini-4-hydrogen`** structured JSON reference photo selection (with manual override and heuristic fallback).
  - `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/retry` — Resumable `queued -> generating -> downloading -> converting -> needs_review -> ready` pipeline:
    - **Rooms** use [World Labs Atlas Developer API v2](https://docs.atlas.worldlabs.ai/) with 2–32 overlapping photos. Atlas first estimates camera poses and depth (`images2PosedRGBD`), then generates an SPZ Gaussian splat (`posedImages2Splats`). Choose `atlas-draft` (default, about 30 seconds for the splat step) or `atlas-refined` (about 15–21 minutes for the splat step). The worker saves both operation IDs and retries the same requests using stable idempotency keys.
    - **Dishes**: Replicate pinned `firtoz/trellis` (`e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c`) with immediate download of `output.gaussian_ply` and foreground preview before Replicate's 1-hour expiry.
    - **Asset processing** uses `@playcanvas/splat-transform` to decimate and compress splats to `.sog`. Originals are retained as `.spz` for Atlas and `.ply` for TRELLIS and demo jobs. If conversion is unavailable, Atlas serves the original SPZ and PLY jobs serve the normalized PLY. Dish scaling uses the 5th–95th percentile of the splat bounds.
  - `POST /api/assets/:id/publish`, `GET /api/restaurants`, `GET /api/restaurants/:id/manifest`
  - `POST /api/restaurants/:id/reviews`, `GET/POST /api/admin/moderation`, `POST/GET /api/debug/logs`
  - `GET /api/mbta/{vehicles,predictions,alerts,schedules,trip}` — Cached MBTA V3 proxy (10s / 60s / 1h TTL) with realistic Boston simulation fallback.
  - `GET /api/live/status` & `POST /api/live/sessions` — OpenAI **`gpt-live-1.1`** full-duplex WebRTC voice broker with `responses` delegation (`gpt-6-luna`) and 16 tools giving the assistant control over map highlights, station dioramas, 3D venue rooms, physical menu books, 3D dish tabletop previews/comparisons, filters, live MBTA queries, camera controls, modals, audio, and Quest pairing.
  - `POST /api/realtime/session` — Mints a short-lived `gpt-realtime` credential for the app’s GPT Live button, XR Voice key, and Quest A/X shortcut. The server loads `OPENAI_API_KEY` from the environment, and the browser connects over WebRTC using the `ash` voice.
  - `POST /api/pairing/create` & `WS /ws/pair/:code` — 4-digit Phone ↔ Quest headset handoff.
- **`web/`** (`@faresight/web`) — PlayCanvas v2 + WebXR (`immersive-vr` & `immersive-ar` passthrough) 4-scene app with an animated map-to-station dive, 3D canvas panels, Web Audio synthesizer, responsive 2D Phone Companion, Upload & Pipeline Studio, Pairing, Moderation, and offline cache-first Service Worker (`/sw.js`).

## Quick Start

```bash
pnpm install
cp .env.example .env      # Optional: add OPENAI_API_KEY, GEMINI_API_KEY, WLT_API_KEY, REPLICATE_API_TOKEN, MBTA_API_KEY
pnpm assets:sync          # Sync modeling/output/* into web/public/assets-demo/
pnpm dev                  # Starts Fastify server (:3001) + Vite web app (:5173)
```

- Open `http://localhost:5173` on desktop/mobile (or deploy over HTTPS for Meta Quest 3 WebXR).
- An Atlas project API key needs `tasks.create`, `operations.read`, `assets.create`, and `assets.read`. Set `WLT_API_KEY` or leave it unset and use `WORLDLABS_API_KEY`. Override `WLT_API_BASE_URL` to use a different Atlas v2 endpoint.
- Install a current `@playcanvas/splat-transform` CLI on the server's PATH to keep Atlas room previews within the 100,000-Gaussian conversion target. Large original SPZs can exceed the viewer's existing Gaussian safety limit.
- Without API keys (`PIPELINE_MODE=auto`), the Upload 3D studio runs a labeled demo simulation through all pipeline stages (`Queued -> Generating -> Downloading -> Converting -> Needs review -> Ready`) and publishes into the live manifest.
- Default moderation passcode when `ADMIN_PASSCODE` is unset: `bostonhacks2026`.

## Build & Verify

```bash
node modeling/generate_all.mjs && node modeling/validate_assets.mjs
pnpm typecheck
pnpm build
pnpm --filter @faresight/server test
node scripts/first_milestone_test.mjs --demo
node scripts/verify_e2e.mjs
```

## Credits & Attribution

- OpenStreetMap contributors (ODbL)
- MBTA V3 API & GTFS
- PlayCanvas Engine & `@playcanvas/splat-transform`
- [World Labs Atlas](https://docs.atlas.worldlabs.ai/)
- Replicate `firtoz/trellis`
- Google Gemini (`gemini-4-hydrogen`)
- Inter typeface
