# Demo scenario catalog (synthetic fixture)

Status: **synthetic fixture.** Catalogs the scenarios and stress overlays
available in the current TwinTO demo build. Illustrative precedent records
referenced by `find_similar_interventions` are demo fixtures, not a real TTC
service-change archive; see AGENTS.md section 2.

## Flagship scenario: `departure-406-412`

"4:06 / 4:12 Load Imbalance." Union station, Line 1 southbound platform, a
45-minute window (15:45-16:30). A dense pre-departure arrival surge (Phase B)
overloads the 16:06 departure, denying boardings, while the following 16:12
departure runs comparatively underused. Baseline departures: 16:06, 16:12.
This scenario always pairs with the concert-surge stress overlay
(`concert-surge-scotiabank`) in the demo's core run.

## Secondary scenario: `streetcar-midday-queen`

"Queen Street Midday Bunching." Osgoode / Queen & University stop, 501 Queen
streetcar, a 30-minute midday window. A modest post-work ridership bump ahead
of the first scheduled car, deliberately milder than the flagship's overload,
used to exercise the ranker and repository across a second mode.

## Stress overlay: `concert-surge-scotiabank`

Layers a 25% citywide arrival-surge multiplier, a closed Union entrance
(30% capacity reduction), a 3-minute delay on the 16:12 departure, and a
4-minute delay on the connecting 501 Queen streetcar, applied on top of a
candidate intervention, never on its own.

## Illustrative past-intervention precedents

The `find_similar_interventions` tool returns five illustrative precedent
records (peak departure retiming, streetcar retiming near a subway
interchange, post-event supplemental service, an entrance-closure
accessibility mitigation, and a snow-day capacity/headway trade-off). Each is
labeled `synthetic-fixture` and written for this demo; do not present any of
them as a documented real-world TTC service change.
