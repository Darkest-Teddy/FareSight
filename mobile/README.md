# FareSight Contribute — Expo shell

An Expo app that hosts the `contribute/` mobile web app in a native WebView, so it can
be opened from Expo Go on a real phone.

This is a **shell, not a port**. The screens, map, and photo flow are still the
TypeScript in `contribute/src`. Edit those files and the phone reloads through Vite's
HMR — there is one codebase, not two.

## Running it

Three processes, from the repo root:

```bash
pnpm dev:server       # Fastify API on :3001
pnpm dev:contribute   # Vite dev server on :5180
pnpm dev:mobile       # Expo / Metro on :8081
```

Then scan the Expo QR code with Expo Go (Android) or the Camera app (iOS).

The phone must be on the same Wi-Fi as this machine, and port **5180** has to be open
through the firewall — Metro's own port 8081 being reachable is not enough, because the
WebView fetches the page separately.

## How it finds the dev server

`App.js` never hardcodes an IP. Expo Go reports the LAN address it loaded the bundle
from as `Constants.expoConfig.hostUri` (e.g. `10.239.6.31:8081`); the app keeps the host
and swaps the port to 5180. Move to another network and it still resolves.

To point it somewhere else, set `expo.extra.contributeUrl` in `app.json`.

## Why a WebView

`contribute/` is ~2,400 lines of direct-DOM TypeScript: an SVG `viewBox` map driven by
pointer events, `<input type="file" capture="environment">` for the camera, and
`localStorage` for scan state. All three work as-is inside a WebView. A native port
would mean rewriting the map against `react-native-svg` and `react-native-gesture-handler`
and keeping two implementations in step — see the note in the root README before
choosing that.

## What the native shell adds

- Expo Go's QR workflow and the device's real viewport, safe areas, and touch handling
- Camera and photo library permissions declared in `app.json` for both platforms
- A reachable failure screen when the Vite server is down, instead of a blank page
- Somewhere to add native capability later (background upload, push, file system)
