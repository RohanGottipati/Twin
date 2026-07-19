# TechTO Backboard tools

Canonical tool names live in `src/lib/backboard/tools.ts`. The dispatcher in
`src/lib/backboard/tool-dispatcher.ts` validates inputs and executes calls
against the configured city, transit, population, and repository services.

Tool categories include:

- City and network reads: typed twin queries, schedules, loads, arrivals,
  crowding, transfers, delays, capacity, fleet, and land use.
- Toronto geography: official neighbourhood screening and map context.
- Population: legible opinion generation, aggregation, and day-one acceptance.
- Evaluation: simulation, reliability, equity, accessibility, lifecycle cost,
  carbon, load, and stress tests.
- Planning: typed scenario proposals, policy comparison, and allowlisted map
  action composition.
- Analysis: read-only scientific Python for selected analytical roles.
- Memory and evidence: document retrieval and approved iteration records.

`query_city_layer` should precede official Toronto location recommendations.
`run_python` uses a read-only MongoDB binding and fails hard on runner errors.
Unknown tool names and invalid inputs are rejected.

Numerical claims must come from tool output or cited data. The feasibility role
may derive ROI, NPV, benefit-cost ratio, or payback only when lifecycle costs,
monetized benefits, time horizon, and discount assumptions are available. A
missing input is reported as a validation need, not replaced with an invented
number.

The PDF exporter is not an agent tool. It formats the already visible response
and citations in the browser, escapes model text, and opens the print dialog.
