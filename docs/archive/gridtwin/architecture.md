# GridTwin / Backboard Architecture

GridTwin is a self-contained subsystem inside this repository: a simulated
grid-battery control room that uses [Backboard](https://backboard.io) as its
only AI infrastructure provider. It has no relationship to MongoDB, FreeSolo,
or the broader TechTO population-simulator design described elsewhere in
this repo's planning documents; see the note at the top of `AGENTS.md`.

## Layers

```
+-----------------------------------------------------------+
| src/components/grid/*, src/lib/gridtwin/*                  |
| Control-room UI components (scenario selector, run          |
| timeline, candidate comparison, executive summary, final    |
| recommendation, operator Q&A, previous runs, status panel,  |
| charts) and client-side run/history plumbing. Built against |
| an expected page + API contract; see "UI status" below.     |
+-----------------------------------------------------------+
| src/app/api/backboard/*                                   |
| capabilities (read-only introspection) + memory CRUD       |
| routes only, today. See "UI status" below for what is      |
| still missing before the control room is actually usable.  |
+-----------------------------------------------------------+
| src/lib/backboard/orchestrator.ts                          |
| runGridTwinOrchestration: drives the 5-role pipeline for   |
| one asset/scenario run, emits a GridRunEvent stream, and   |
| applies the deterministic safety override.                 |
+-----------------------------------------------------------+
| src/lib/backboard/{assistant-manifest, model-router,       |
| run-tool-loop, tool-dispatcher, tools, assistants}.ts       |
| Resolves assistants by name, picks a model per role,        |
| drives the tool-call loop, executes tool calls against the |
| deterministic grid domain.                                  |
+-----------------------------------------------------------+
| src/lib/backboard/{client, adapter, wire-types,             |
| mock-adapter, env}.ts                                       |
| BackboardAdapter interface with two implementations:         |
| RestBackboardAdapter (live HTTP+SSE) and                    |
| MockBackboardAdapter (deterministic, offline, scripted).     |
+-----------------------------------------------------------+
| src/lib/grid/*                                              |
| The deterministic "twin": fixtures, scenario resolution,    |
| the physical validator, the financial simulator, metrics,   |
| and the candidate ranker. Never calls Backboard.             |
+-----------------------------------------------------------+
| src/data/grid/*.json                                        |
| Static fixture data: one asset, one baseline day, seven     |
| scenarios, six similar-scenario records.                     |
+-----------------------------------------------------------+
```

Everything below `src/lib/grid` is pure, synchronous, and has no dependency on
Backboard at all; everything in `src/lib/backboard` depends on `src/lib/grid`
for ground truth but never the other way around. This is deliberate: the
deterministic domain must remain independently testable and independently
correct, whether or not any assistant ever runs.

## Request flow for one orchestration run

`runGridTwinOrchestration(input)` in `src/lib/backboard/orchestrator.ts`:

1. Looks up the asset and scenario from `src/lib/grid/fixtures.ts`, and
   resolves the scenario's visible/actual hourly conditions via
   `src/lib/grid/scenarios.ts`.
2. Runs the Market Analyst and Renewable Analyst in parallel
   (`Promise.all`), each a structured turn against its own resolved
   assistant, returning a strict-JSON `AnalystFinding`.
3. Runs the Dispatch Planner once, given both findings, producing 2-3
   candidate dispatch plans as strict JSON, validated against a
   dynamically-built Zod schema that enforces the exact asset id, scenario
   id, interval count, and timestamps for this run.
4. Runs the Risk & Compliance Reviewer once. It calls
   `validate_dispatch_plan`, `simulate_dispatch_plan`, and
   `stress_test_dispatch_plan` for every candidate (tool calls execute
   against the deterministic simulator, cached per-run in a `RunContext`),
   then `rank_dispatch_candidates`, then returns one structured risk review
   per candidate.
5. The orchestrator re-runs `simulateDispatchPlan` locally for any candidate
   the reviewer forgot to simulate or stress-test, so every candidate always
   has real evidence (see "Evidence sourcing" below), then computes the
   deterministic ranking itself via `rankCandidates` (never trusting a
   ranking an assistant merely repeats back).
6. Runs the Chief Dispatch Officer once, given both findings, every
   candidate's simulation summary, the risk reviews, and the deterministic
   ranking, producing one `FinalRecommendation`.
7. Applies `applySafetyOverride`: if the Chief's chosen candidate was never
   ranked or was disqualified by validation, the effective recommendation is
   forced to `hold_for_operator`, with a stated reason and (when one exists)
   a fallback to the top valid deterministically-ranked candidate. This is
   the one piece of the pipeline that no assistant, and no knowledge
   document, can override.

Every stage emits typed `GridRunEvent`s (`run.created`, `agent.started`,
`tool.requested`, `candidate.simulated`, `recommendation.ready`, `run.completed`,
etc.) through an `onEvent` callback, deliberately coarser than Backboard's raw
token stream: only agent/tool lifecycle and grid-domain evidence cross that
boundary, never raw reasoning text.

## Evidence sourcing (`agent` vs `local_fallback`)

Every `CandidateOutcome` records whether its visible simulation and its
stress simulation came from a tool call the assistant actually made
(`"agent"`) or from a local fallback the orchestrator ran itself because the
assistant never called the tool for that candidate (`"local_fallback"`).
Both sources run the identical deterministic function
(`simulateDispatchPlan`); the distinction exists purely so a demo, a test, or
an operator can see whether the Risk & Compliance Reviewer actually did its
job for every candidate. See `tests/backboard-orchestrator.test.ts` for the
fallback case exercised directly.

## Structured output and retries

`runStructuredTurn` (inside `orchestrator.ts`) sends one message expecting
strict JSON matching a Zod schema. If parsing or validation fails, it feeds
the exact issue list back on the same thread and retries once by default
before giving up with an `OrchestrationError`. This is the only retry policy
in the pipeline; tool-call rounds within one turn are bounded separately by
`maxRounds` in `runToolLoop`.

## UI status

This section is unusually likely to go stale: the control-room UI landed in
this repository over the course of the same work session that produced this
documentation pass, so treat the file list below as a snapshot, not a
promise, and re-verify against `src/app/control/`,
`src/app/api/backboard/`, and `src/components/grid/` before trusting it.

As of this writing, the control room is substantially wired up:

- **`/control/[assetId]`** (`src/app/control/[assetId]/page.tsx`) renders
  `GridControlRoom` (`src/components/grid/GridControlRoom.tsx`), which
  assembles every grid component into one page: asset location + Backboard
  status on the left, SOC/price/renewable charts + constraint status in the
  center, scenario selection + run controls + the live agent timeline on the
  right, and a bottom tab strip (Operator Q&A, Executive Summary, Evidence,
  Previous Runs, Memory).
- **`POST /api/backboard/run`** (`src/app/api/backboard/run/route.ts`) is a
  real, working route: it validates the request, rate-limits by client,
  then streams `runGridTwinOrchestration`'s `GridRunEvent`s as SSE frames
  (via `src/lib/backboard/sse.ts`'s `createSseStream`/`toGridRunEventEnvelope`)
  matching the `BackboardRunEventEnvelope` contract in `src/lib/grid/schemas.ts`.
  `src/lib/gridtwin/use-backboard-run.ts` (the client hook `GridControlRoom`
  uses) and `src/lib/backboard/stream-parser.ts` (a shared client/server-safe
  SSE frame parser) both consume this contract.
- **`POST /api/backboard/operator-question`**
  (`src/app/api/backboard/operator-question/route.ts`) is also real and
  working: it streams `src/lib/backboard/operator.ts`'s
  `askOperatorQuestion` result as SSE (`operator.delta` / `operator.completed`
  / `operator.failed` events).
- **A known, current gap**: `OperatorQuestionPanel.tsx` (the component that
  renders the "Operator Q&A" tab) still calls `POST /api/backboard/ask`, an
  older placeholder path from before `/api/backboard/operator-question`
  existed. That endpoint does not exist, so the panel currently falls back
  to its "not available yet" inline error path even though the real route
  it should call is now implemented. If you touch this area, point that
  `fetch` call at `/api/backboard/operator-question` (and its
  request/response shape) instead of leaving it stale.
- `src/lib/backboard/executive.ts` and `src/lib/backboard/operator.ts` back
  the Executive Summary tab and Operator Q&A respectively; see
  `assistants.md`'s honest note for exactly how they reuse the Chief
  Dispatch Officer's resolved assistant rather than adding new roster
  entries.
- The memory CRUD routes under `src/app/api/backboard/memories/` back the
  "Memory" tab (`ApprovedMemoryPanel.tsx`), unchanged from
  `rag-and-memory.md`.
- `AssetDrawer` remains the entry point from the Skyline globe
  (`WorldAppShell.tsx` renders it on marker selection); its "Open Control
  Room" link goes to `/control/[assetId]`.

## Server-only boundary

Every module in `src/lib/backboard` is server-only. `assertServerOnly()` in
`env.ts` throws if any of them is ever evaluated in a browser context, as a
defense-in-depth check alongside Next.js's own server/client module
boundary. No Backboard credential, and no Backboard module, should ever be
reachable from client-side code; a future UI must talk to
`src/app/api/backboard/*` routes, never to `src/lib/backboard/*` directly.

## Related documents

- `assistants.md`: the actual 5-role roster, and an honest note on which
  informal role names map onto which real roles or orchestrator stages.
- `tools.md`: every tool definition and its dispatcher implementation.
- `rag-and-memory.md`: knowledge documents versus assistant memory.
- `model-routing.md`: how a model is chosen per role.
- `testing.md`: how this is tested, offline and (optionally) live.
- `demo-script.md`: how to actually run and narrate a demo today.
