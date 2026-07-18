# Event, weather, and incident response playbook (synthetic fixture)

Status: **synthetic fixture.** Describes how the demo's event, weather, and
incident overlays interact with candidate interventions. Not a live events
feed, live forecast, or real TTC incident log.

## Concert / event surge

The flagship extenuating-circumstances stress test is a sold-out evening
concert at Scotiabank Arena releasing a large crowd toward Union station. It
is modeled as a combined stress overlay:

- a citywide arrival-surge multiplier (currently 1.25x) applied over a
  defined time window,
- one closed station entrance with a partial capacity reduction,
- a short departure delay on the primary route,
- a short delay on a connecting streetcar route.

This overlay is applied on top of a candidate intervention by
`stress_test_intervention`, never evaluated on its own; the question it
answers is always "does this candidate still hold up once the surge hits,"
not "how bad is the surge in isolation."

## Weather

Weather changes two rider-behaviour multipliers rather than the schedule
itself: a `walkingToleranceMultiplier` (riders are less willing to walk to an
alternate entrance or stop in bad weather) and a `waitToleranceMultiplier`
(riders are more willing to wait under shelter than walk in bad weather).
Any candidate that assumes riders will freely walk to an alternate entrance
should be re-checked under an active adverse-weather overlay.

## Service incidents

Incidents (signal problems, mechanical failures, medical emergencies, power
outages) carry a route, a delay in minutes, and a list of affected stations.
They are independent of any candidate intervention: a candidate's timing
assumptions should be re-validated against an active incident's delay before
being treated as reliable for that window.

## Emergency rerouting principle

A fallback plan proposed under an active incident or surge should be simple
and fast to execute. This is a contingency measure, not an opportunity to
redesign the full schedule; keep the action count low and the rationale
tightly scoped to restoring service, not optimizing it further.
