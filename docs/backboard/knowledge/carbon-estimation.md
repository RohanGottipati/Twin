# Carbon estimation methodology (synthetic fixture)

Status: **synthetic fixture.** Describes how `calculate_carbon` derives an
estimate for the demo, not a certified emissions inventory.

## What the estimate is built from

`calculate_carbon` combines two synthetic-fixture inputs:

1. **Estimated car-trip mode shift**: the number of car trips avoided (or
   induced) by a candidate, taken from `estimatedCarTrips` in the transit
   metrics bundle, itself derived from citizen-reaction mode-shift
   probabilities.
2. **Added service carbon cost**: the marginal emissions from any added
   vehicle-trip (`add_trip`) or capacity (`capacity_boost`) action, using a
   flat per-vehicle-hour factor for the demo's three modes (subway,
   streetcar, bus).

The reported `estimatedCarbonKg` metric is `avoided minus added`; a negative
value means the candidate's added service cost outweighs the car trips it
avoided.

## Interpretation limits

- This is an estimate built on top of an estimate (mode shift is itself a
  simulated citizen-reaction reading); report it with the same
  simulated-data caveat as the underlying mode-shift number.
- It does not account for vehicle manufacturing, grid electricity mix
  changes, or induced demand effects over time; it is a same-day, first-order
  estimate only, consistent with AGENTS.md section 2's "day-one acceptance,
  not consequence" framing.
- Never present a carbon figure from this tool as a verified environmental
  impact assessment.
