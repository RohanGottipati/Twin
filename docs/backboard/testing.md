# TechTO testing

## Unit and static checks

```bash
npm run lint
npm run typecheck
npm test
npm run test:backboard
```

The suite covers the principled 11 role roster, tool allowlists, Toronto scope,
intent selection, simulation, population providers, candidate ranking, SSE
parsing, run history, manifest schema version 4, map actions, neighbourhood
screening, evidence-safe ROI language, and safe print-report generation.

Unit tests use injected adapters and repositories where isolation is required.
They do not silently enable a product mock mode and do not call live Backboard.

## Browser tests

```bash
npm run test:e2e
npm run test:e2e:techto
```

Playwright checks the open-city map, chat behavior, map actions, TechTO shell,
scenario playback, and visible provider labels. Network routes are stubbed only
where the test is validating browser behavior instead of live model quality.
The `.next-playwright` build directory is isolated from a running development
server cache.

PDF content is tested as escaped print-ready HTML. Browser automation verifies
export controls without opening the operating system print dialog.

## Live smoke

```bash
npm run backboard:smoke
```

This requires `BACKBOARD_API_KEY`. It checks live model capabilities, a
principled roster assistant, indexed knowledge retrieval, a harmless tool call,
and read-only memory behavior. It can incur provider latency and cost.
