# MongoDB Atlas (TechTO)

Operational data plane for TechTO. Credentials are server-only (`MONGODB_URI`);
never expose them to the browser.

## Setup

1. Set `MONGODB_URI` and `MONGODB_DATABASE=techto` in `.env`.
2. Run `npm run mongo:bootstrap` (creates collections/indexes and seeds demo fixtures).
3. Set `TECHTO_REPOSITORY_PROVIDER=mongo` so Backboard tools read from Atlas.
4. Verify with `npm run mongo:status`.

Offline/CI: leave `TECHTO_REPOSITORY_PROVIDER=fixture` (default in tests).

## What agents read

`MongoTransitRepository` warms from Atlas collections:

- `places`, `transit_routes`, `transit_stops`
- `neighbourhoods`, `citizen_cohorts`, `social_contexts`
- `transit_scenarios`, `stress_overlays`
- `events`, `incidents`, `similar_interventions`
- `latest_route_state`, `latest_city_state`

Tool outputs include `storageLayer: "mongodb"` when this provider is active.

## What agents write

On planning tool calls, the dispatcher persists:

- `simulation_runs`, `interventions`, `latest_stop_state` (`run_transit_simulation`)
- `policy_iterations`, `audit_events` (`save_policy_iteration`)
- `citizen_reactions` (`call_citizen_reaction_model`)
- `training_examples` (`create_training_examples`)
- `backboard_tool_calls` (every tool dispatch)

Planning SSE runs also append:

- `backboard_events` (each streamed lifecycle event)
- `backboard_threads` (run shell + final result)
- `policy_evaluations` (recommendation snapshot)

Operator Q&A turns append messages on `backboard_threads` (`kind: operator-qa`).

## Accept policy (§14.9)

`POST /api/backboard/policy/accept` runs an atomic accept bundle (transaction
when the cluster supports it; sequential fallback otherwise):

- `policy_iterations` status accepted
- `policy_evaluations` status accepted
- `model_versions` touch
- `audit_events` (`policy_accepted`)
- optional `training_examples` (`eligible`)

## Change streams / search / ingest

| Endpoint / command | Purpose |
| --- | --- |
| `GET /api/mongo/runs/{runId}` | Persisted run + event timeline |
| `GET /api/mongo/search?q=` | Atlas Search or regex fallback |
| `GET /api/mongo/stream?collection=` | SSE change-stream proxy |
| `npm run mongo:ingest` | Offline §8.3 ingest pipeline |

Atlas Search / Vector index definitions: `atlas/search-indexes.json`
(create in Atlas UI; app falls back to regex if the search index is absent).

## Collection catalog

Canonical collection names live in `src/lib/mongodb/collections.ts`. Schema and
persistence behavior live beside their consumers under `src/lib/mongodb/`.
The core demonstration can use normal collections plus labelled seeded
fixtures; Atlas Search falls back to regex when its index is unavailable.
