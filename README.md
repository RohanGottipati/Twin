# TechTO: Toronto planning decision support

TechTO is a Next.js and MapLibre decision-support application for City of
Toronto planning. The map and chat let a planner ask free-form questions,
inspect an area, compare options, request map changes, and examine a simulated
distribution of day-one acceptance.

The product front door is `/`: the open-city TechTO dashboard. Chat runs the
live Backboard Planning Orchestrator with optional twin tools and specialist
calls.

The system predicts acceptance, not physical or economic consequences. It does
not treat simulated reactions as consultation, and it does not claim ridership,
emissions, congestion, or financial returns without separate validated models
and evidence.

## Chat answers and reports

Planning recommendations use concise Markdown sections when relevant:

1. Recommendation
2. Why this area
3. Sustainability potential
4. Screening metrics
5. ROI and value case
6. Success KPIs to validate
7. What to validate next

ROI is an evidence contract, not a required headline number. The feasibility
specialist separates measured inputs, modeled monetized benefits, unvalidated
assumptions, and scenario ranges. It calculates
`(validated monetized benefits - lifecycle costs) / lifecycle costs` only when
both sides are supported. Otherwise the answer says which demand, cost, and
benefit assumptions must be validated. NPV, benefit-cost ratio, payback period,
discount rate, analysis horizon, and sensitivity are included when available.

Every assistant answer has an **Export PDF** control. The main transcript and
selected-place chat also export complete conversations. Export opens a clean,
print-ready report containing the question, response, citations, Toronto
context, timestamp, and decision-support disclaimer. Choose **Save as PDF** in
the browser print dialog.

## Local setup

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and configure the server-only services used
by the surface you are running:

- `BACKBOARD_API_KEY` is required for live Backboard chat. There is no mock
  Backboard adapter.
- `TECHTO_POPULATION_PROVIDER=synthetic|census` selects the open-city
  population provider.
- `TECHTO_CITIZEN_REACTION_PROVIDER=freesolo` and the FreeSolo variables are
  required for TechTO citizen reactions. There is no mock reaction provider.
- `TECHTO_REPOSITORY_PROVIDER=fixture|mongo` selects local transit fixtures or
  MongoDB Atlas for TechTO repository reads.
- `NEXT_PUBLIC_MAP_STYLE_URL` optionally overrides the MapLibre base style.

Never expose Backboard, FreeSolo, or MongoDB credentials through a
`NEXT_PUBLIC_` variable.

## Map data

- Basemap: OpenFreeMap by default, with a configurable MapLibre style.
- Neighbourhoods: City of Toronto 158-neighbourhood boundaries joined with
  2021 Census profile indicators.
- Transit: TTC subway, LRT, and streetcar geometry derived from official GTFS.
- Residents: a synthetic visualization weighted to neighbourhood population.

Generated web map inputs live under `public/data/`. Data preparation and the
research population pipeline live under `scripts/data/`, `data/`, and
`population/`. See `AGENTS.md` for provenance, calibration requirements, and
the distinction between the research population files and TechTO fixtures.

## Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run backboard:bootstrap
npm run backboard:status
npm run backboard:smoke
```

Backboard commands require live credentials. Playwright smoke tests stub costly
live planning turns where appropriate.

## Stack

Next.js App Router, React, TypeScript strict mode, Tailwind CSS, MapLibre GL JS,
Zustand, Backboard, FreeSolo, optional MongoDB Atlas, Vitest, and Playwright.
