# Baseline report

Recorded before any GridTwin/Backboard code was added, on the `backboard` branch
created from `main` at commit `4a43c5c` ("Update implementation documentation").

## Environment

- Node / npm as configured in this workspace.
- `.env` present with `NEXT_PUBLIC_CESIUM_ION_TOKEN` and `BACKBOARD_API_KEY` (both
  populated; values are never printed or committed).
- `.env` is already covered by `.gitignore`.

## `npm run check` (lint + typecheck + test + build)

Result: **pass**, unmodified.

```
lint        -> eslint .                 pass, no errors
typecheck   -> tsc --noEmit             pass, no errors
test        -> vitest run               3 files, 15 tests, all passed
build       -> next build               compiled successfully, 2 static routes
```

No changes were made to produce this result.

## `npm run test:e2e` (Playwright world UI smoke test)

Initial run **failed for environmental reasons unrelated to the repository**:

1. First failure: `browserType.launch: Executable doesn't exist at
   .../chromium-1134/...`. The Playwright *package* version in this repo expects
   browser build `1134`, but only an unrelated `chromium-1228` cache existed on
   this machine. Fixed by running `npx playwright install chromium`, which is a
   standard local environment setup step (downloads a browser binary into the
   Playwright cache directory; it does not touch the repository).

2. Second failure, after the browser was available: the app served a `500` from
   `next start`, caused by a **stale/corrupted `.next` build directory**
   (`Cannot find module './vendor-chunks/lucide-react.js'` inside
   `.next/server/webpack-runtime.js`). `.next/` is a gitignored, regenerated
   build artifact (see `.gitignore`), so this was resolved with `rm -rf .next &&
   npm run build`, i.e. a clean rebuild. No source files were touched.

   As part of diagnosing this, headless Chromium in this environment was
   confirmed to support WebGL (`canvas.getContext("webgl2")` returns a context),
   so the failure was never a Cesium/WebGL capability problem.

After both environmental fixes, the existing test passes unmodified:

```
1 passed - world-ui.spec.ts: world exploration and city flow
```

## Conclusion

The pre-existing application (lint, typecheck, unit tests, production build, and
the Playwright smoke test) is healthy on `main`. The two issues encountered were
local-environment artifacts (missing browser binary, stale build cache), not
defects introduced by or attributable to this implementation. No application
source file was modified to establish this baseline.
