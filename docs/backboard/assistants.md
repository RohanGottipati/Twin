# TechTO assistants

TechTO uses exactly 11 named Backboard roles under `rosterVersion:
principled-11` and manifest schema version 4. The design keeps competence in
general city tools and avoids one-use-case specialists.

## Canonical roles

1. `city-copilot`: conversation and intent-aware handoff.
2. `planning-orchestrator`: free-form planning, tools, and delegation.
3. `geospatial-twin`: Toronto place and network context.
4. `scenario-designer`: typed city intervention alternatives.
5. `citizen-response`: legible simulated day-one opinions and distributions.
6. `equity-impact`: distributional and accessibility analysis.
7. `feasibility`: lifecycle cost, infrastructure, operations, safety, carbon,
   and evidence-based ROI or value case.
8. `adversarial-reviewer`: failure modes and stress tests.
9. `evidence-auditor`: provenance, missing evidence, and claim limits.
10. `final-policy-judge`: constrained comparison and decision status.
11. `explanation-map`: concise explanation and allowlisted map actions.

The exact keys and prompts live in `src/lib/backboard/assistants.ts`.

## Dynamic activation

The open-city Planning Orchestrator can answer directly or invoke only the roles
needed for the turn. Simple navigation uses a small bundle. A full intervention
can use the principled city bundle. The TechTO flagship scenario can use all 11
roles, but no role is activated merely to make a run appear more elaborate.

ROI does not require another assistant. The feasibility role already owns cost,
infrastructure, carbon, safety, operational constraints, and value analysis.
Its prompt forbids an ROI figure unless lifecycle costs and monetized benefits
are evidenced.

## Bootstrap and reconciliation

```bash
npm run backboard:bootstrap
npm run backboard:status
npm run backboard:smoke
npm run backboard:consolidate-roster
npm run backboard:consolidate-roster -- --confirm
```

The consolidation command is retained as the controlled migration utility.
Run it without `--confirm` first. Unknown remote assistants are never deleted.
