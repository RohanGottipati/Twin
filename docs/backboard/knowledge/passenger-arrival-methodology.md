# Passenger arrival methodology (synthetic fixture)

Status: **synthetic fixture.** Describes how TechTO's arrival curves and
origin-destination flows are constructed, not a measured ridership study.

## Arrival curves

Each scenario defines a minute-by-minute arrival count at a single platform
or stop over a fixed observation window (typically 30-45 minutes). Curves are
hand-authored to exhibit a labeled phase structure, for example the flagship
scenario's four phases:

- **Phase A**: a low, gently ramping off-peak trickle.
- **Phase B**: a dense pre-departure surge, sized to exceed vehicle capacity.
- **Phase C**: a lighter wave immediately after, causing a load imbalance
  between two consecutive departures.
- **Phase D**: a steady light trickle for the remainder of the window.

These phases are illustrative constructions for the demo, not a fit to
measured turnstile or APC (automatic passenger counter) data.

## Origin-destination flows

`get_origin_destination_flows` reports which home zones feed which
destination zones through the affected station, derived from the cohort
fixtures' `homeZoneId` and `primaryDestinationZoneId` fields weighted by
cohort `weight`. This is a coarse, zone-level approximation, not a
trip-diary-level OD matrix.

## Schedule flexibility

Each cohort carries a `scheduleFlexibility` value in [0, 1]: how much a
cohort's departure-time choice can shift before their trip is materially
disrupted. Shift workers and standard 9-to-5 commuters have low flexibility;
students, retirees, and tourists have higher flexibility. Aggregate wait or
retiming metrics can look acceptable on average while still being severe for
a low-flexibility cohort; always check per-cohort figures before concluding a
change is broadly acceptable.

## Latent demand

Latent demand (riders who would use transit if service were better) is never
directly measured in this fixture set; any latent-demand figure is an
inference from OD flows, demographics, and precedent, and must be reported as
an uncertain range, not a single confident number.
