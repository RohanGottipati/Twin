# Accessibility policy (synthetic fixture, demo hard-check rules)

Status: **synthetic fixture.** Encodes the hard accessibility rules TechTO's
deterministic checker enforces for this demo. Not a restatement of the AODA,
the TTC's actual accessibility plan, or any real regulatory instrument.

## Hard failure conditions

A candidate intervention is an accessibility **hard failure** (not a
trade-off to weigh against other metrics) when any of the following hold:

1. It closes or degrades the only entrance at a station where
   `alternateAccessibleEntrance` is `false`, with no mitigation action in the
   same intervention.
2. It measurably increases required walking distance for a cohort with a
   `mobilityNeeds` entry (`wheelchair`, `step-free-access`, `stroller-access`,
   or `reduced-mobility`) without an equivalent step-free alternative.
3. It reduces vehicle or platform capacity in a way that raises denied
   boardings specifically for accessibility-sensitive cohorts
   (`accessibilitySensitivity >= 0.7`), even if the citywide average load
   factor improves.

## Mitigations that can clear an entrance closure

An `entrance_closure` action is not automatically a hard failure if the same
intervention pairs it with a mitigation: temporary signage plus staff
assistance at the remaining accessible entrance, or a documented
alternate-route action with equivalent step-free access. `calculate_accessibility`
checks for a paired mitigation before flagging closures.

## Reporting requirement

Any agent reporting an accessibility finding must call `get_accessibility_constraints`
or `calculate_accessibility` first and cite the specific station, entrance, or
cohort affected; a general "accessibility looks fine" statement without a
tool citation is not an acceptable finding in this system.
