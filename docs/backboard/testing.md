# TwinTO testing

## Unit

```bash
npm run test
npm run test:backboard
```

Covers: exactly 16 assistant keys, no GridTwin or old 54-agent keys in the
active roster, no battery tools, intent bundles, mock citizen reaction,
queue/boarding, departure load imbalance, wait metrics, event surge,
accessibility, ranker, SSE parser, run history, manifest schema v3,
map-action allowlist, security (server-only key, unknown tools, body
limits, knowledge path allowlist), mock orchestration, API routes.

Default tests never call live Backboard.

## E2E

```bash
npm run test:e2e:twinto
```

Forces `BACKBOARD_MOCK_MODE=true`. Exercises map load, scenario select,
baseline playback, full mock planning run, stress panel, recommendation,
operator question, previous runs, and asserts no battery/Cesium/GridTwin
copy.

## Live smoke

```bash
npm run backboard:smoke
```

Requires `BACKBOARD_API_KEY` and live mode. Lists models, verifies a TwinTO
assistant, retrieves an indexed transit document, calls one harmless tool,
checks read-only memory, reports tokens.
