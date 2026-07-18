# Equity evaluation methodology (synthetic fixture)

Status: **synthetic fixture.** Describes how TwinTO's equity-gap metric is
constructed for the demo, not a peer-reviewed transportation-equity framework.

## Vulnerable cohort definition

A cohort counts as vulnerable for the equity-gap metric when any of the
following hold:

- it has at least one entry in `mobilityNeeds`, or
- its `accessibilitySensitivity` is 0.7 or higher, or
- its `incomeBand` is `low`.

In the demo fixture set this currently includes accessibility-device users,
low-income transit-dependent riders, seniors, and parents traveling with
strollers.

## Equity gap metric

`calculate_equity` computes the equity gap as the difference in a candidate's
key outcome metrics (denied boardings, wait time, accessibility failures)
between the vulnerable-cohort subgroup and the full modeled population. A
positive gap means vulnerable cohorts fare worse than the population average
under the candidate.

## Reading the metric correctly

- A candidate that improves the citywide average while widening the equity
  gap has shifted harm onto vulnerable cohorts, not solved the underlying
  problem; flag this explicitly rather than reporting only the average.
- The equity gap is a **measurement**, not a threshold with an automatic
  pass/fail line; the Final Policy Judge weighs it alongside safety and
  accessibility hard checks, which do carry an automatic fail condition (see
  `accessibility-policy.md`).

## What this evaluation is not

This is not a census-representative equity audit and does not use real
Statistics Canada dissemination-area data; cohort weights in this demo are
illustrative priors chosen for narrative plausibility, per AGENTS.md section
4.3.
