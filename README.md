# Skyline — World Explorer

Skyline is a reusable, full-screen 3D world and city exploration interface built
with [CesiumJS](https://cesium.com/), Next.js (App Router), and TypeScript. It
opens on an interactive globe, lets you fly into configured cities, and inspect
OpenStreetMap 3D buildings — all through a clean, city-agnostic architecture.

Toronto is the only configured and enabled city today, but the app is
architected so that additional cities can be added purely through configuration.

## Features

- Full-screen interactive 3D globe with Cesium World Terrain.
- World exploration mode with a slow, subtle globe auto-rotation.
- Configurable city registry (Toronto is the first enabled city).
- Smooth world-to-city and city-to-world camera transitions.
- Toronto globe marker plus a searchable city explorer.
- OpenStreetMap 3D Buildings with clickable, highlightable buildings.
- Generic selected-building information drawer (no external enrichment).
- Layer controls (terrain, buildings, markers, labels, atmosphere, lighting,
  auto-rotate) and a custom camera control rail.
- Loading, error, and empty states with a WebGL capability check.
- Responsive desktop, tablet, and mobile layouts, keyboard shortcuts,
  reduced-motion support, and accessible controls.

## Technology stack

- Next.js (App Router) + React + TypeScript (strict mode)
- Tailwind CSS
- CesiumJS (installed via npm — no CDN)
- Zustand (UI state)
- Framer Motion (interface transitions)
- Lucide React (icons)
- Vitest + React Testing Library (unit tests)
- Playwright (browser smoke test)

## Cesium ion token setup

Skyline reads a Cesium ion access token from the environment. Never commit a
real token.

1. Copy the example env file:
   ```bash
   cp .env.example .env.local
   ```
2. Set your token in `.env.local`:
   ```
   NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_ion_token
   ```
3. Get a token at <https://ion.cesium.com/tokens>.

If the token is missing, the app renders a polished configuration-error overlay
with instructions instead of crashing Cesium.

## Installation

```bash
npm install
```

`npm install` runs a `postinstall` hook that copies Cesium's static assets
(`Workers`, `ThirdParty`, `Assets`, `Widgets`) into `public/cesium` so they are
served locally (no CDN). The same copy runs automatically before `dev` and
`build`.

## Development commands

```bash
npm run dev        # start the dev server (http://localhost:3000)
npm run build      # production build
npm run start      # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test       # vitest unit tests
npm run test:e2e   # playwright smoke test
npm run check      # lint + typecheck + test + build
npm run cesium:copy # manually copy Cesium static assets
```

## Production build

```bash
npm run build
npm run start
```

## Architecture

```
src/
  app/            # Next.js App Router entry (layout, page, error, globals)
  components/     # UI: world scene, navigation, panels, feedback, mobile, primitives
  config/cities/  # City config type, Toronto config, and registry
  hooks/          # keyboard shortcuts, media queries, reduced motion
  lib/cesium/     # reusable Cesium utilities (viewer, markers, buildings, camera, selection, cleanup)
  lib/utils/      # cn + formatting helpers
  store/          # Zustand UI store (serializable state only)
  types/          # global type declarations
tests/            # Vitest unit tests
e2e/              # Playwright smoke test
scripts/          # copy-cesium-assets.mjs
public/cesium/    # copied Cesium static assets (generated)
```

Key design rules:

- Cesium renders client-side only (`WorldScene` is dynamically imported with
  `ssr: false`). `window.CESIUM_BASE_URL` is set before importing the Cesium
  runtime, and only type-only imports of Cesium appear at module scope.
- The Zustand store holds serializable UI state only — never the Viewer,
  tilesets, handlers, or Cesium feature objects.
- Reusable Cesium utilities contain no city-specific logic; all city
  coordinates and camera presets come from `CityConfig`.

## Adding a new city

No renderer modification is required. To add a city:

1. Create a `CityConfig` (e.g. `src/config/cities/vancouver.ts`) with
   coordinates, `bounds`, and the three camera presets (`overview`, `city`,
   `close`).
2. Add it to `cityRegistry` in `src/config/cities/registry.ts`.
3. Set `enabled: true`.

The globe marker, city explorer entry, preview card, and camera flights are all
driven by the registry.

## Layer extension points

The Layer panel includes a disabled "Custom data layers" section
(`No additional data layers are connected.`) as an extension point. Real data
layers can be added later without changing the core renderer — the Cesium
utilities and store are intentionally generic.

## Cesium attribution requirement

Cesium's credit/attribution display is intentionally kept visible at all times
(bottom of the globe). Do not hide or cover it — it is required by Cesium ion's
terms of use.

## Troubleshooting

### Cesium static asset 404s (Workers / Assets / Widgets / ThirdParty)

These assets are copied into `public/cesium` by `scripts/copy-cesium-assets.mjs`.
If you see 404s:

```bash
npm run cesium:copy
```

Ensure `window.CESIUM_BASE_URL` is `"/cesium/"` (set in `WorldScene`) and that
`public/cesium` exists after install/build.

### WebGL unavailable

Skyline requires WebGL. If the app shows *"Skyline requires WebGL to display
the 3D world"*, enable hardware acceleration in your browser or try a different
browser/device.

## Testing commands

```bash
npm run test       # unit tests (Vitest + jsdom)
npm run test:e2e   # Playwright smoke test (requires NEXT_PUBLIC_CESIUM_ION_TOKEN)
```

The Playwright smoke test opens the app, confirms Skyline branding and the
Toronto city entry, selects Toronto, opens the preview card, explores the city,
toggles a layer, and returns to world view. It does not depend on clicking a
specific external 3D building tile.
