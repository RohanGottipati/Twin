# TTC network primer (synthetic fixture)

Status: **synthetic fixture, demo scope only.** Station names, route names, and
approximate downtown positions are drawn from real TTC geography for narrative
plausibility. Every operational figure below (capacity, headway, entrance
flags) is a synthetic assumption chosen for the TechTO demo, not a live GTFS
feed or a measured TTC capacity table.

## Scope

The demo network covers a downtown segment only:

- **Line 1 (subway)**: Union to St George, 8 stations, 800-seat trains,
  6-minute nominal peak headway.
- **501 Queen (streetcar)**: Queen & Yonge to Queen & Bathurst, 130-seat cars,
  8-minute nominal headway.
- **6A Union Station Connector (bus)**: CityPlace Park to Union Station Bus
  Terminal, 60-seat buses, 10-minute nominal headway.

## Stations and accessibility flags

Each station fixture carries two accessibility-relevant flags used by hard
safety/accessibility checks:

- `hasElevator`: whether the station has at least one elevator to the
  platform.
- `alternateAccessibleEntrance`: whether a second, independently operable
  accessible entrance exists. Only Union and St George currently have one in
  the fixture; every other station's single accessible entrance is a single
  point of failure for wheelchair and mobility-device riders.

## Transfers

Union station is the primary interchange in this fixture: Line 1, 501 Queen
(via Osgoode), and the 6A bus terminal all converge there. Transfer-demand
figures reported by `get_transfer_demand` are synthetic estimates of riders
moving between these routes at Union, not a measured fare-card transfer
count.

## What this primer is not

This is not a live network state, not a full-city network, and not a
substitute for TTC's actual service standards. Use it only to interpret
`get_network_snapshot`, `get_route_schedule`, and `get_vehicle_capacity`
results inside the TechTO demo.
