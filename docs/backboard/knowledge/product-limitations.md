# Product limitations (read before writing any final recommendation)

Status: **applies to every agent, especially the Final Policy Judge and City
Planning Orchestrator.** Restates AGENTS.md section 2's non-negotiable
framing so it is available as a retrievable document, not only a build-time
rule.

## What TechTO predicts

TechTO predicts simulated day-one **acceptance**: how a modeled population of
personas reacts to a policy change on the day it takes effect, conditioned on
deterministic, physically-computed effect features. Every output is a
distribution over a population with uncertainty attached, never a single
confident number and never a claim about one specific real person.

## What TechTO does not predict

- **Not** ridership, revenue, or long-run demand forecasts.
- **Not** land-value shifts, induced demand, or traffic re-routing equilibria.
- **Not** third-year, or even third-month, outcomes of any kind.
- **Not** a forecast of what "will" happen; there is no counterfactual
  Toronto to validate against directly. Validation is by retrodiction
  (matching a real past change) and mechanism testing, never by claiming
  access to the actual future.

## The score is secondary

The written opinion or rationale attached to a finding is the artifact a
planner should read and audit. Any numeric score (acceptance, valence,
confidence) is a *readout* of that text, not the point in itself. If a
finding's number and its stated rationale disagree, the rationale is the
one to trust and the disagreement itself should be flagged.

## Simulated is not real

Every citizen reaction, sentiment aggregate, and public-consultation-style
summary produced by this system is simulated. It must never be presented,
worded, or formatted in a way that could be mistaken for a real survey,
consultation, or measured public-opinion result. See
`citizen-model-limitations.md` for the model-specific caveats this implies.

## Deterministic simulation and hard checks are the actual arbiter

No language-model agent's judgment overrides the deterministic simulator's
validity flag, a hard safety violation, or a hard accessibility failure. An
agent may argue, analyze, and recommend; whether a candidate is *viable* is
decided by tool-backed, deterministic checks, not by how persuasive an
agent's writeup is.
