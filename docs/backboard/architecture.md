# TechTO Backboard architecture

TechTO uses a live Backboard planning department shared by the open-city
dashboard and the TechTO transit demonstration. The canonical roster is the
principled city-planning set of 11 roles, identified by `rosterVersion:
principled-11` and manifest schema version 4.

The root dashboard and TechTO are related but distinct products:

- `/` is the open-city front door. `POST /api/planner/run` gives the Planning
  Orchestrator a free-form turn with optional tools and specialist calls.
- `/techto` is the transit demonstration. It adds a deterministic local transit
  simulator, a synthetic flagship scenario, and a separate staged planning run.

GridTwin is archived under `docs/archive/gridtwin/`.

## Layers

```text
+-----------------------------------------------------------+
| WEB UI                                                    |
| MapLibre Toronto map, chat, selection, reports            |
+-----------------------------------------------------------+
| LIVE BACKBOARD DEPARTMENT                                 |
| Planning Orchestrator, general specialists, tools         |
+-----------------------------------------------------------+
| CITY TWIN AND POPULATION SERVICES                         |
| typed patches, exact features, acceptance distribution    |
+-----------------------------------------------------------+
| DATA PROVIDERS                                            |
| Toronto files, optional MongoDB, live FreeSolo             |
+-----------------------------------------------------------+
```

## Provider requirements

- Backboard is live only and requires `BACKBOARD_API_KEY`.
- TechTO citizen reactions are live FreeSolo only.
- The open-city `PopulationProvider` supports `synthetic` and `census` modes.
- TechTO repository reads support local labelled fixtures or MongoDB Atlas.
- Deterministic simulator output remains the numerical authority for the
  TechTO operational demonstration.

There is no automatic mock Backboard mode and no mock citizen-reaction
provider. Local fixture data remains allowed where it is visibly labelled
`synthetic-fixture`.

## Output boundary

Recommendations are human-readable Markdown. Relevant project recommendations
separate the recommendation, location evidence, sustainability mechanisms,
screening metrics, ROI and value case, validation KPIs, and next steps. Simple
conversation is not forced into that template.

ROI analysis belongs to the general feasibility specialist. It may compute a
return only from evidenced lifecycle costs and validated monetized benefits.
Unknown inputs remain explicit assumptions and scenario ranges.

The browser exports answers and conversations as escaped, print-ready HTML.
The browser print dialog creates the PDF. Export is a presentation boundary;
it does not alter evidence, run additional agents, or turn modeled claims into
measured facts.

## Key paths

| Path | Role |
| --- | --- |
| `src/lib/planner/orchestrator.ts` | Open-city free-form planning turn |
| `src/lib/backboard/` | Live adapter, principled roster, tools, staged TechTO orchestration |
| `src/lib/population/` | Open-city population provider |
| `src/lib/citizen-reaction/` | Live FreeSolo TechTO citizen reactions |
| `src/lib/transit/` | TechTO simulator, metrics, ranking, repository |
| `src/lib/export/chat-report.ts` | Safe print-ready chat reports |
| `src/components/chat/` | Main and selected-place chat UI |
| `docs/backboard/knowledge/` | Indexed planning knowledge documents |
