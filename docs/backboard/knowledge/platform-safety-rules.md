# Platform and vehicle safety rules (synthetic fixture)

Status: **synthetic fixture, demo hard-check rules.** Not a restatement of any
real TTC platform safety procedure or crowd-control standard.

## Platform crowding threshold

The demo simulator tracks a minute-by-minute queue length at the affected
platform or stop (`get_stop_crowding`). A queue length that implies riders
are standing beyond the platform's marked waiting area is treated as a
crowding-safety violation for that minute, regardless of whether the very
next departure clears the backlog. A candidate is not "safe" simply because
the average queue length over the whole window looks acceptable.

## Vehicle load and denied boardings

`get_departure_loads` reports `denied` boardings per departure: riders who
could not board because the vehicle reached capacity. A denied-boardings
count above zero is a warning-severity finding by default; it becomes an
error-severity finding when it recurs across consecutive departures on the
same route within the observation window, since that indicates a structural
capacity problem rather than a one-off surge.

## Safety is an absolute gate

Per AGENTS.md section 2 and the Final Policy Judge's decision rule: a safety
violation is an absolute veto on a candidate's viability. No combination of
good cost, carbon, or citizen-sentiment numbers can offset an unresolved
error-severity safety violation. The Safety Agent and the Adversarial
Stress-Test Agent exist specifically to find these before an operator ever
sees the candidate, including under a scenario's hidden stress overlay, not
just its visible baseline.

## Reporting requirement

Any safety finding must cite the specific tool result (queue length, denied
boardings, or stress-test outcome) it is based on; do not report a safety
concern from general impression alone.
