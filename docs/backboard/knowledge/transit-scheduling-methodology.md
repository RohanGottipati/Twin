# Transit scheduling methodology (synthetic fixture)

Status: **synthetic fixture.** Describes how TwinTO's deterministic simulator
interprets schedule interventions, not a TTC operating procedure document.

## Intervention action types

Every candidate intervention is a small set of discrete actions drawn from a
fixed vocabulary:

| Action | Effect | Bounds |
| --- | --- | --- |
| `shift_departure_minutes` | Moves one scheduled departure earlier or later | delta in [-30, 30] minutes |
| `add_trip` | Inserts a new trip after an existing departure | offset in [1, 30] minutes |
| `capacity_boost` | Adds capacity to an existing departure | non-negative extra seats |
| `entrance_closure` | Reduces an entrance's throughput | fraction in [0, 1] |
| `hold_departure` | Holds a departure at the platform before dispatch | [0, 10] minutes |
| `retime_feeder` | Shifts a connecting route's timing | delta in [-15, 15] minutes |

## Simulation order of operations

1. Apply scenario baseline (schedule, arrival curve, vehicle capacity).
2. Apply the candidate intervention's actions, in the order given.
3. Apply a stress overlay, if one is being tested (arrival surge, entrance
   closure, departure delay, connecting delay), never during baseline
   validation.
4. Recompute departure loads, the platform queue trace, and every downstream
   metric from that final state.

## Minimum headway and ramp constraints

`shift_departure_minutes` and `hold_departure` must never produce two
departures on the same route closer together than roughly half the route's
nominal headway; a schedule that violates this is flagged as an error-severity
violation, not a soft warning, because it implies an operationally
unrealistic dispatch.

## Bunching risk

A `hold_departure` or `retime_feeder` action that resolves a load imbalance on
one departure can push the following vehicle closer to the one ahead of it.
`calculate_reliability` checks this explicitly; a candidate that fixes one
departure's crowding while introducing meaningful bunching risk on the next
is not a clean win.

## What this methodology does not model

It does not model traffic-signal interactions, real-time operator decisions,
or multi-day schedule change rollout logistics. Those require a separate
traffic-engineering or operations-planning study.
