# TwinTO orchestration

Chat-first flow:

1. City Copilot classifies intent (deterministic classifier + specialist handoff).
2. Planning Orchestrator decomposes complex requests and selects the bundle.
3. Specialists run in parallel where independent (demand, network, geospatial,
   equity, cost, carbon).
4. Citizen Response Agent calls the citizen-reaction provider (mock or FreeSolo).
5. Simulation and Optimization Agent runs the deterministic simulator.
6. Reliability/Safety and Adversarial Reviewer apply hard checks and stress.
7. Evidence Auditor verifies provenance.
8. Final Policy Judge ranks under constraints.
9. Explanation and Map Action Agent streams the answer and allowlisted map actions.

Maximum eight chained tool rounds per specialist turn. Numerical authority is
always the deterministic simulator and hard constraint checks.
