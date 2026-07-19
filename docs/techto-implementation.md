# TechTO implementation

This document describes transit-domain libraries, fixtures, and Backboard tools
that still live in the repository (`src/lib/transit`, `src/lib/techto`, related
APIs). There is no separate `/techto` UI route; the product front door is `/`.
This material is not a substitute for the research calibration and retrodiction
requirements in `AGENTS.md`.

For system invariants, provider rules, model training, and open research
questions, `AGENTS.md` remains authoritative.

## Product boundary

TechTO demonstrates a fictional and clearly labelled Union Station schedule
imbalance: passenger arrivals make the 16:06 departure relatively underused and
the 16:12 departure crowded. A live Backboard planning department can propose
schedule interventions, collect simulated citizen reactions, run deterministic
transit checks, stress-test candidates, and produce a constrained
recommendation.

TechTO may show:

- a synthetic transit scenario and deterministic simulation results;
- weighted synthetic cohort reactions, explicitly labelled as simulated;
- accessibility, equity, reliability, operating, cost, and carbon analyses;
- Backboard roles and tool lifecycle events;
- hard-constraint overrides of an AI recommendation.

TechTO must not describe synthetic reactions as public consultation, claim it
controls TTC operations, provide certified safety advice, or guarantee
ridership, mode shift, emissions, financial returns, or other future outcomes.

## Current technology

- Web: Next.js App Router, React, TypeScript, Tailwind CSS.
- Map: MapLibre GL JS with Toronto transit and neighbourhood context.
- AI infrastructure: live Backboard only, with `BACKBOARD_API_KEY`.
- Citizen reactions: live FreeSolo only.
- Transit repository: labelled local fixtures or MongoDB Atlas.
- Simulation: deterministic TypeScript transit simulator and stress checks.
- State: Zustand in the browser, with run history helpers.
- Testing: Vitest and Playwright.

There is no Cesium dependency, Backboard mock adapter, citizen-reaction mock
provider, or active GridTwin product. GridTwin documentation is archived under
`docs/archive/gridtwin/`.

## Backboard department

The canonical manifest is schema version 4 with `rosterVersion:
principled-11`. The 11 general roles are:

1. City Copilot
2. Planning Orchestrator
3. Geospatial Twin
4. Scenario Designer
5. Citizen Response
6. Equity Impact
7. Feasibility
8. Adversarial Reviewer
9. Evidence Auditor
10. Final Policy Judge
11. Explanation and Map

Exact keys, prompts, tool permissions, memory policies, and model requirements
live in `src/lib/backboard/assistants.ts`. Niche schedule, weather, event, cost,
or export agents are intentionally absent. General roles use tools only when a
turn needs them.

## Staged planning run

The TechTO staged orchestrator in `src/lib/backboard/orchestrator.ts` emits a
frontend-safe lifecycle:

```text
run started
problem and baseline analysis
context collection
candidate generation
citizen reactions
deterministic simulation
impact review
stress testing
adversarial debate
final policy judgment
operator question
run completed
```

The event stream exposes lifecycle markers and grounded summaries, never
private chain-of-thought. Structured model outputs are validated with Zod. The
orchestrator may retry malformed JSON. Failed narrative findings can degrade to
explicit low-confidence local evidence, but deterministic simulation and hard
constraints remain authoritative.

The final result keeps both values:

- `aiRecommendation`: the Final Policy Judge's structured output.
- `effectiveRecommendation`: the result after deterministic hard-constraint
  overrides.

## Chat and selected places

TechTO includes the shared map chat and selected-place mini chat. Simple
questions do not trigger the full staged run. The selected-place chat grounds
answers in the clicked building, station, or neighbourhood and its nearest
Toronto context.

Relevant planning recommendations use readable Markdown sections for the
recommendation, local fit, sustainability mechanisms, screening evidence, ROI
and value case, validation KPIs, and next steps. A simple conversational answer
can remain short.

ROI belongs to the feasibility role. The value case separates measured inputs,
modeled monetized benefits, assumptions, and scenario ranges. ROI, NPV,
benefit-cost ratio, and payback are reported only when lifecycle costs, benefits,
discount rate, and analysis horizon are supported. Missing evidence produces a
validation list, not an invented return.

Users can export an individual answer, the main conversation, a selected-place
answer, or the complete selected-place conversation. Export creates escaped,
print-ready HTML in a new browser window. The browser print dialog provides
Save as PDF. Reports include citations, timestamp, Toronto scope, and a clear
decision-support limitation.

## Data and provider labels

The flagship scenario and local transit cohorts under `src/data/transit/` are
synthetic fixtures. They must remain visibly labelled `synthetic-fixture` in
the interface and reports. They are separate from the census, PUMF, CES, and
consultation data pipeline described in `AGENTS.md`.

`TECHTO_REPOSITORY_PROVIDER=fixture|mongo` selects transit repository reads.
MongoDB credentials are server only. The FreeSolo citizen-reaction path is live
only and requires its server-side credentials.

## Main implementation paths

| Path | Responsibility |
| --- | --- |
| `src/app/page.tsx` | Open-city TechTO dashboard (`/`) |
| `src/lib/backboard/orchestrator.ts` | Staged planning run |
| `src/lib/backboard/assistants.ts` | Principled 11 role roster |
| `src/lib/backboard/tools.ts` | Tool definitions |
| `src/lib/backboard/tool-dispatcher.ts` | Validated tool execution |
| `src/lib/transit/` | Simulation, metrics, ranking, stress tests, repository |
| `src/lib/citizen-reaction/` | Live FreeSolo provider |
| `src/data/transit/` | Labelled synthetic flagship fixtures |
| `src/components/chat/` | Shared chat and PDF controls |
| `src/lib/export/chat-report.ts` | Safe print-ready report generation |

## Environment

Minimum live service configuration:

```text
BACKBOARD_API_KEY=...
TECHTO_CITIZEN_REACTION_PROVIDER=freesolo
FREESOLO_API_KEY=...
FREESOLO_BASE_URL=...
FREESOLO_REACTION_MODEL_ALIAS=...
TECHTO_REPOSITORY_PROVIDER=fixture
```

Set MongoDB variables from `.env.example` when using the Mongo repository.
Never place provider secrets in `NEXT_PUBLIC_` variables.

## Operations and validation

```bash
npm run backboard:bootstrap
npm run backboard:status
npm run backboard:smoke
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Live smoke runs can incur latency and provider cost. Browser tests stub live
planning calls where the UI behavior, rather than provider quality, is under
test.
