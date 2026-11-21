# FareSight (BostonHacks 2026)

**Try it before you ride:** explore Boston food spots, study cafés, karaoke suites, and live venues through the MBTA in 3D/WebXR on Meta Quest 3 (and 2D on any phone or laptop), filtered by craving, total budget including T fare, start stop, and group size.

## Architecture

- **`modeling/`** — Deterministic procedural glTF 2.0 (`.glb`) and binary 3D Gaussian Splat (`.ply`) generators (`node modeling/generate_all.mjs && node modeling/validate_assets.mjs`):
  - **Boston Map Sculpture** (`boston-map-sculpture.glb`): museum-grade acrylic vitrine with multi-depth translucent MBTA Green (B/C/D/E), Red, Orange, and Blue tubes, frosted Charles River ribbon, vertical metallic station risers, and `mbta-train-capsule.glb`.
  - **5 Retro-Synth City Segment Dioramas** (`segment-place-*.glb`): BU Central, Packard's Corner, Kenmore, Harvard Square, and Chinatown, each with named `LCD_Screen` (live station telemetry texture) and `Rotary_Dial` (budget slider rotation) nodes and Boston landmarks.
  - **6 Demo 3DGS `.ply` Assets**: Ramen house, karaoke suite, study café, tonkotsu ramen (`24 cm`), katsu curry (`26 cm`), and matcha tiramisu (`18 cm`), plus `table-pedestal.glb`.
- **`shared/`** (`@faresight/shared`) — Shared TypeScript domain types, Boston flat-earth sculpture projection, MBTA fare constants (`$2.40` subway / `$1.70` bus), precomputed ride times, and trip estimate math.
- **`server/`** (`@faresight/server`) — Node + TypeScript + Fastify + built-in SQLite (`node:sqlite`) + persistent resumable job worker:
  - `POST /api/uploads` — Multipart/base64 image upload, orientation/dimension parsing, SHA-256 deduplication, original archival.
  - `POST /api/intake` — **Gemini `gemini-4-hydrogen`** structured JSON reference photo selection (with manual override and heuristic fallback).
  - `POST /api/jobs`, `GET /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/retry` — Resumable `queued -> generating -> downloading -> converting -> needs_review -> ready` pipeline:
    - **Rooms**: World Labs **Marble 1.1** multi-image reconstruction (`reconstruct_images: true`, up to 8 images) + free synchronous `100k` Gaussian PLY export.
    - **Dishes**: Replicate pinned `firtoz/trellis` (`e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c`) with immediate download of `output.gaussian_ply` and foreground preview before Replicate's 1-hour expiry.
    - **Asset processing**: `@playcanvas/splat-transform` simplification & `.sog` compression (retaining original PLY) + 5th–95th percentile automatic dish scaling.
  - `POST /api/assets/:id/publish`, `GET /api/restaurants`, `GET /api/restaurants/:id/manifest`
  - `POST /api/restaurants/:id/reviews`, `GET/POST /api/admin/moderation`, `POST/GET /api/debug/logs`
  - `GET /api/mbta/{vehicles,predictions,alerts,schedules,trip}` — Cached MBTA V3 proxy (10s / 60s / 1h TTL) with realistic Boston simulation fallback.
  - `POST /api/pairing/create` & `WS /ws/pair/:code` — 4-digit Phone ↔ Quest headset handoff.
- **`web/`** (`@faresight/web`) — PlayCanvas v2 + WebXR (`immersive-vr` & `immersive-ar` passthrough) 4-scene app, 3D canvas panels, Web Audio synthesizer, responsive 2D Phone Companion, Upload & Pipeline Studio, Pairing, Moderation, and offline cache-first Service Worker (`/sw.js`).

## Quick Start

```bash
pnpm install
cp .env.example .env      # Optional: add GEMINI_API_KEY, WORLDLABS_API_KEY, REPLICATE_API_TOKEN, MBTA_API_KEY
pnpm assets:sync          # Sync modeling/output/* into web/public/assets-demo/
pnpm dev                  # Starts Fastify server (:3001) + Vite web app (:5173)
```

- Open `http://localhost:5173` on desktop/mobile (or deploy over HTTPS for Meta Quest 3 WebXR).
- Without API keys (`PIPELINE_MODE=auto`), the Upload 3D studio runs a labeled demo simulation through all pipeline stages (`Queued -> Generating -> Downloading -> Converting -> Needs review -> Ready`) and publishes into the live manifest.
- Default moderation passcode when `ADMIN_PASSCODE` is unset: `bostonhacks2026`.

## Build & Verify

```bash
node modeling/generate_all.mjs && node modeling/validate_assets.mjs
pnpm typecheck
pnpm build
pnpm --filter @faresight/server test
```

## Credits & Attribution

- OpenStreetMap contributors (ODbL)
- MBTA V3 API & GTFS
- PlayCanvas Engine & `@playcanvas/splat-transform`
- World Labs Marble 1.1
- Replicate `firtoz/trellis`
- Google Gemini (`gemini-4-hydrogen`)
- Inter typeface
