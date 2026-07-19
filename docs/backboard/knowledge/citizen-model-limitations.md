# Citizen reaction model limitations (read before citing any reaction)

Status: **applies to every reaction produced by `call_citizen_reaction_model`
and every aggregate produced by `aggregate_citizen_reactions`.** This document
exists specifically so no agent or downstream reader mistakes a simulated
reading for real public opinion (AGENTS.md section 2).

## What the citizen reaction model is

A per-cohort language-model persona, conditioned on a cohort's demographics
and the deterministic before/after effect features a candidate intervention
produces, asked to write a legible opinion and produce an acceptance reading
derived from that opinion (AGENTS.md section 3.1). The TechTO product path uses
the live FreeSolo provider; `provider` in every result records the source.

## What it is not

- It is **not** a measurement of real Toronto residents' opinions.
- It is **not** a public consultation, survey, or referendum result.
- It is **not** a forecast of ridership, revenue, or long-run behavioural
  change; it is a same-day acceptance reading only.
- A cohort in this model represents a statistically similar group of riders,
  never an identified individual resident.

## Known model limitations (OpinionQA finding, AGENTS.md section 6)

Out-of-the-box persona alignment with real subgroup opinion is substantially
off, and prompting a model to "act like" a demographic group only helps
modestly. Aggregate outputs tend toward being too centrist, too agreeable,
and too low-variance relative to real survey populations. Treat any single
run's aggregate acceptance number as illustrative of the demo's mechanism,
not as a calibrated prediction, unless the specific model deployment has been
validated against a retrodiction backtest.

## Mandatory labeling

Any time a citizen-reaction reading (single, aggregated, or summarized for a
public-facing document) is surfaced, the surrounding text must state plainly
that it is a simulated reading from a population model, not real public
opinion. This applies to the Citizen Response role and every downstream
summary, report, or map.
