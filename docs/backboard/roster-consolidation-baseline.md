# TechTO Backboard roster consolidation baseline

> Historical audit only. The current product uses the principled 11 role roster,
> manifest schema version 4, and live providers as documented in `AGENTS.md` and
> `docs/backboard/assistants.md`.

Recorded before consolidating the active roster from 54 specialists to 16
consolidated assistants. Branch: `backboard`. Main is untouched.

## Git state

- Branch: `backboard`
- Recent commits include the TechTO migration (MapLibre, transit fixtures,
  54-assistant council, orchestration, citizen-reaction provider, UI, tests).
- Working tree clean at audit time (prior uncommitted TechTO UI/tests were
  committed first so nothing was lost).

## Baseline checks (all passed)

```text
npm install          # up to date
npm run lint         # pass
npm run typecheck    # pass
npm run test         # 17 files, 163 tests pass
npm run check        # lint + typecheck + test + build pass
```

`npm run test:e2e:techto` was not required to block this audit commit; it
will be re-run after the consolidated chat-first UI lands.

## Active roster (pre-consolidation)

| Metric | Value |
| --- | --- |
| Assistant definitions | 54 unique keys / 54 unique names |
| Prefix | `TechTO —` |
| Scenario bundles | `CORE_SCHEDULE_BUNDLE` (19), `CONCERT_BUNDLE` (5), `WEATHER_BUNDLE` (5) |
| Flagship activation | `selectAssistantBundle("departure-406-412")` ≈ 24 roles |
| Manifest schema | v2, product `techto` |
| Tools | 33 transit-oriented tools in `tools.ts` |
| Knowledge docs | 12 under `docs/backboard/knowledge/` |
| Citizen reactions | `MockCitizenReactionProvider` (labelled mock) |
| Repository | `FixtureTransitRepository` |
| Map | MapLibre 2D (no Cesium) |

## Gaps relative to the consolidation target

1. No bottom City Copilot chat dock (`src/components/chat/` missing).
2. Activation is scenario-driven, not intent-driven (no
   SIMPLE_MAP_NAVIGATION / NEW_STATION_LOCATION / etc.).
3. No allowlisted map-action schema or frontend executor.
4. No geospatial neighbourhood/station candidate tools yet.
5. Manifest is schemaVersion 2 without `rosterVersion: consolidated-16`.
6. Cleanup script only targets GridTwin names; no dry-run for obsolete
   TechTO-54 specialists.
7. Agent Council UI enumerates the large specialist set.

## Consolidation plan (summary)

Replace the 54-key roster with exactly 16 stable keys (City Copilot through
Explanation and Map Action Agent). Responsibilities are merged, not dropped.
Dynamic request bundles activate only the specialists needed. Bootstrap
moves to manifest schemaVersion 3. A new
`backboard:consolidate-roster` script dry-runs then confirms remote cleanup.

## Files that own the roster today

- `src/lib/backboard/assistants.ts` (definitions + bundles)
- `src/lib/backboard/tools.ts` / `tool-dispatcher.ts`
- `src/lib/backboard/orchestrator.ts` / `mock-demo-run.ts`
- `src/lib/backboard/manifest-schema.ts` / `assistant-manifest.ts`
- `scripts/backboard-bootstrap.ts` / `status` / `smoke` / `cleanup-gridtwin`
- `src/components/techto/AgentCouncil.tsx` / `TechTOAppShell.tsx`
- `tests/backboard/assistants.test.ts` / `bundles.test.ts` / `orchestrator.test.ts`
