# TwinTO

TwinTO is a simulated Toronto transit digital twin. A 2D MapLibre map of
downtown Toronto shows Line 1, the 501 Queen streetcar, and a feeder bus;
census-weighted synthetic citizen cohorts react to candidate schedule
changes; and a virtual Backboard planning department (exactly 16 consolidated
assistants) proposes, simulates, stress-tests, and recommends interventions
before a human planner ever sees them. Intent bundles activate only the
specialists needed for each question.

The flagship demo scenario is the `departure-406-412` 4:06/4:12 PM load
imbalance at Union station: see `docs/twinto-implementation.md` for the full
product and engineering specification, and `AGENTS.md` for the research
invariants this build must never violate.

Nothing here is live TTC data or real public consultation. Every scenario,
network fixture, cohort, and citizen reaction is explicitly labeled
`synthetic-fixture` or "simulated" in the UI; see
`src/lib/backboard/mock-adapter.ts` and `src/lib/citizen-reaction/mock-provider.ts`
for the offline-first mock providers that make the whole product runnable
with zero external credentials.

## Features

- 2D MapLibre Toronto map (no 3D, no globe, no Cesium): transit routes and
  stations, a citizen-density layer, a station crowding heatmap, and an
  event/incident overlay.
- City Copilot chat docked to the bottom of the map, with dynamic activation
  of the consolidated 16-assistant roster (not all 16 on every message).
- A virtual Backboard planning department that frames the problem,
  establishes a baseline, proposes candidates, runs a deterministic transit
  simulator, predicts simulated citizen-cohort reactions, stress-tests the
  leading candidate, and reaches a final recommendation over SSE.
- A deterministic transit simulator and stress-tester that has final
  authority: a Backboard recommendation that fails a hard safety,
  accessibility, or evidence check is always overridden before it reaches
  the UI.
- Local, per-browser run history and an operator follow-up question panel.
- A fully offline mock mode (`BACKBOARD_MOCK_MODE`, unset by default) so the
  entire product runs with no API keys.

## Development commands

```bash
npm install
npm run dev        # start the dev server (http://localhost:3000)
npm run build      # production build
npm run start      # serve the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm run test       # vitest unit tests
npm run test:e2e   # playwright smoke test
npm run check      # lint + typecheck + test + build
```

## Backboard setup

1. Copy the example env file:
   ```bash
   cp .env.example .env.local
   ```
2. By default, no setup is required: with `BACKBOARD_API_KEY` unset, TwinTO
   runs its entire planning department offline against a deterministic mock
   adapter (`BACKBOARD_MOCK_MODE` defaults to on whenever no key is
   configured).
3. To use a real Backboard account, set in `.env.local`:
   ```
   BACKBOARD_API_KEY=your_backboard_api_key
   BACKBOARD_API_BASE_URL=https://app.backboard.io/api
   BACKBOARD_MOCK_MODE=false
   ```
4. Check the resolved setup any time, without printing any secret:
   ```bash
   npm run backboard:status
   ```
5. (Live mode only, once) seed the consolidated 16-assistant roster and its
   knowledge documents:
   ```bash
   npm run backboard:bootstrap
   ```
6. (Live mode only, optional) run a real smoke test:
   ```bash
   npm run backboard:smoke
   ```
7. After bootstrap + smoke, dry-run then confirm cleanup of obsolete 54-agent
   TwinTO specialists and any leftover GridTwin assistants:
   ```bash
   npm run backboard:consolidate-roster
   npm run backboard:consolidate-roster -- --confirm
   ```

## Architecture

```
src/
  app/                    Next.js App Router entry (layout, page, error, globals)
  components/
    map/                  MapLibre Toronto map + layers (TransitLayers, CitizenDensityLayer, CrowdHeatmapLayer, EventLayer, MapLegend)
    twinto/                Product UI: scenario/policy panels, Backboard council, charts
    chat/                  City Copilot bottom dock
    navigation/, mobile/, feedback/, primitives/   Shared UI patterns
  data/transit/           Synthetic fixture network, scenarios, cohorts, events (never live GTFS)
  lib/
    transit/               Deterministic transit simulator, metrics, candidate ranker, stress tests
    citizen-reaction/       Population-simulator provider boundary (mock today)
    backboard/              Backboard adapter, assistants, orchestrator, tools, SSE
    twinto/                  Frontend-safe run types, run-history, useBackboardRun hook
  store/                   Zustand UI stores (map layers/selection, TwinTO panel focus)
tests/                     Vitest unit tests
e2e/                       Playwright smoke test
docs/
  twinto-implementation.md  Full product and engineering specification
  archive/gridtwin/         Archived prior GridTwin (battery control room) design docs
```

See `AGENTS.md` for the broader ToronTwin research program this demo sits
next to, and the invariants (acceptance vs. consequence, distribution vs.
oracle, opinion as mediator) that any future population-simulator work here
must respect.
