# TechTO orchestration

## Open-city planning turn

The root dashboard sends a free-form question to `POST /api/planner/run`. The
live Planning Orchestrator decides whether to answer directly, read city data,
compose map actions, propose typed patches, score a population, invoke one or
more specialists, or combine those actions. Tools are optional. The system
does not create placeholder scenarios or rankings to satisfy a fixed pipeline.

Location recommendations query Toronto layers before choosing an official
neighbourhood. Map recommendations use allowlisted actions so the interface can
focus, highlight, or draw the relevant Toronto area.

For a material capital or operating recommendation, the orchestrator may invoke
the feasibility specialist for cost and value evidence. An ROI section must
separate measured inputs, modeled monetized benefits, assumptions, and scenario
ranges. It states that no return is claimed when the evidence is incomplete.

## Selected-place chat

The building, station, and neighbourhood mini chat classifies intent and selects
one appropriate general specialist. The answer is grounded in the selected map
context and recent conversation. It uses the same recommendation and ROI
evidence rules without triggering a full department run for a simple question.

## TechTO staged run

TechTO retains a staged schedule and stress-test workflow for its labelled
synthetic flagship scenario. Its Backboard department proposes and critiques
interventions, while deterministic simulation and hard constraints remain the
operational numerical authority. Simulated reactions are never described as
real consultation.

## Response and report contract

Agent prose is Markdown and must lead with the answer. Structured sections are
used only when they improve a recommendation. Map actions are parsed against an
allowlist. PDF export happens entirely in the browser from the visible answer or
conversation, with citations, timestamp, Toronto scope, and limitations.
