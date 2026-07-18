# Overnight build log

## 2026-07-18 -- overnight-builder session 1

**Starting phase:** Phase 0 (repo was essentially empty: only AGENTS.md,
implementation_plan.md, .env, .gitignore, .gitkeep, and
.claude/agents/overnight-builder.md existed, and none of those were tracked
by git in this worktree -- see "Setup note" below).

**Ending phase:** Phase 0, gate cleared and verified by an automated test.
Did not start Phase 1. Remaining time went into hardening Phase 0 (more
invariant coverage, ingestion sanity tests) per the overnight-builder brief.

### Setup note (worth flagging, not a blocker)

This git worktree only had `.gitkeep` committed. `AGENTS.md`,
`implementation_plan.md`, `.env`, and `.claude/agents/overnight-builder.md`
exist in the main repo working directory at `/home/acreo/tw/` but are
git-ignored there (`.gitignore` has `.env` and `*.md`), so `git worktree add`
never copied them into this worktree's working directory (worktrees only
share committed history, not untracked files). I copied all five files from
the main repo into this worktree before starting so I could read them, since
they're described as binding. No content was invented; this was a
copy-only fix to a worktree-provisioning gap. If this recurs, the actual fix
is upstream (either track these files, or provision worktrees with a copy
step), not something to route around in every session.

### What was built

**Project setup**
- `pyproject.toml`: uv-managed project, Python >=3.12. Dependencies:
  `geopandas`, `shapely`, `pyproj`, `pyogrio` (fast vector IO), `pydantic`,
  `requests`, `pandas`, `networkx` (street-graph connectivity check). Dev
  group: `pytest`. `uv sync` verified clean.
- `.gitignore` extended (kept the existing `.env` / `*.md` rules as-is) to
  add `.venv/`, `__pycache__/`, `.pytest_cache/`, and `data/raw/` (citywide
  source downloads -- not the bounded slice, see below).

**Data ingestion** (`data/toronto_ckan.py`, `data/ingest.py`)
- Verified the live CKAN Action API base URL by direct HTTP call:
  `https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/*`. The
  portal's own API docs page 404'd when fetched directly, and the commonly
  cited legacy host `ckan0.cf.opendata.inta.toronto.ca` no longer resolves
  (DNS failure) -- found the current host via web search and confirmed it
  with a real `package_search` call before writing any ingestion code.
- Study area: **Ward 13, "Toronto Centre"** (current 25-ward model),
  buffered 300m. Chosen because it holds the downtown financial district,
  Union Station, and the University-Yonge subway spine plus a dense
  streetcar grid -- the densest, most topologically interesting transit
  network in the city, so later phases (effect-graph commute deltas, mixed
  opinions on a bundled tram+tax policy) have real structure to work with. A
  quiet suburban ward would make Phase 0's own invariant checks pass
  trivially without exercising real complexity.
- Datasets ingested (package ids verified live against the API):
  `3d-massing` (buildings), `toronto-centreline-tcl` (streets),
  `ttc-routes-and-schedules` (GTFS), `zoning-by-law`, `city-wards` (for the
  ward boundary itself), `parks-and-recreation-facilities`.
- All five non-ward layers plus the GTFS feed are citywide at the source
  (Toronto Open Data doesn't expose server-side bbox filtering for most of
  these). Ingestion downloads the citywide file once into `data/raw/`
  (git-ignored, ~250MB total), clips to the buffered ward polygon, reprojects
  to **NAD83 / UTM zone 17N (EPSG:26917)**, and writes the small bounded
  result to `data/processed/` (~16MB total, committed -- that's the actual
  twin input). Re-runs are idempotent (skips downloads if the raw file is
  already on disk; confirmed a re-run completes in ~10s vs. the initial
  ~2 minutes).
- GTFS: parsed `stops.txt`, `routes.txt`, `trips.txt`, `shapes.txt`.
  Deliberately did **not** parse `stop_times.txt` (~200MB uncompressed) --
  nothing in the Phase 0 gate needs per-departure schedule rows, only stop
  geometry and route shapes. Documented in `data/ingest.py` as a follow-up
  for whenever schedule-based features are actually needed (Phase 3+).
- Provenance: every layer's dataset id, resource id, source URL, license,
  and before/after clip row counts are logged to
  `data/processed/manifest.jsonl`.
- Resulting counts (citywide -> Ward 13 + buffer): streets 64,432 -> 2,577;
  zoning 11,719 -> 708; parks 1,789 -> 74; buildings 428,184 -> 8,374;
  transit stops 9,361 -> 303; transit route shapes 1,472 -> 279.

**Twin compiler** (`twin/schema.py`, `twin/state.py`, `twin/diff.py`,
`twin/invariants.py`)
- `schema.py`: Pydantic models for every layer (`StreetSegment`, `Building`,
  `ZoningParcel`, `Park`, `TransitStop`, `TransitShape`), a GeoJSON-shaped
  `Geometry` model, `PolicyValue` (seed of the policy layer), and `Edit` (one
  atomic add/remove/modify operation). Geometry is kept as typed
  type+coordinates rather than a live shapely object so state stays
  JSON-serializable end to end; `state.py` is the only place that converts to
  shapely, for computation.
- `state.py`: immutable, versioned `TwinState` (frozen dataclass).
  `load_from_processed()` builds version 0 from `data/processed/`.
  `patch(state, edits)` is the single validated mutation path: applies edits
  to a candidate state, runs every check in `invariants.py` against the
  *result*, and either returns a new state with `version = state.version + 1`
  and `parent_version = state.version`, or raises `TwinInvariantError` and
  leaves the caller's original `state` object completely untouched
  (atomic, never partially applied).
- `diff.py`: `diff(a, b)` compares any two `TwinState` snapshots per layer
  (added/removed/modified feature ids, with field-level before/after for
  modifications) plus policy changes. Works on any two versions, not just
  parent/child.
- `invariants.py`, first pass, four checks:
  1. `check_transit_stops_on_network` -- the actual Phase 0 gate invariant:
     every transit stop must be within 35m of a street or transit-shape
     geometry (35m tolerance covers GPS slop and underground-station
     offset from the street centreline above it).
  2. `check_policy_zone_references` -- a `PolicyValue` with a `zone_id` set
     must reference a zoning parcel that exists ("taxes only on zones that
     exist").
  3. `check_geometry_validity` -- every feature's geometry must be
     structurally valid (shapely `.is_valid`) and of the geometry type its
     layer expects (e.g. a transit stop must be a Point).
  4. `check_street_network_edits_connect` -- a street segment added or
     modified by the current edit set must share an endpoint (1m snap
     tolerance) with some other street segment in the resulting network;
     guards against splicing in a disconnected fragment.
  - **Documented gap, not silently skipped**: no before/after
    connected-component comparison to catch a `remove` that severs
    previously-joined parts of the network -- that needs the parent
    `TwinState` threaded into the check, which `patch()` doesn't do yet.
    This is an engineering gap, not one of the AGENTS.md section 9 open
    questions, so it's safe for a future session to pick up without
    sign-off. Queued below.
  - Confirmed the *real* base state (12,315 features loaded from the Ward 13
    slice) passes `check_all` with **zero violations** out of the box --
    i.e. the invariants aren't spuriously firing on real data, and the real
    GTFS stops genuinely sit on the real street/transit network.

### Gate verification (actual pytest output, not assumed)

The Phase 0 gate from `implementation_plan.md`:

> A manual `patch` that adds a transit stop off the network is rejected by
> invariants; a valid one applies, versions, and produces a correct diff.

is implemented as an automated, re-runnable test in
`tests/test_phase0_gate.py`, run in isolation:

```
$ uv run pytest tests/test_phase0_gate.py -v
tests/test_phase0_gate.py::test_off_network_stop_is_rejected PASSED      [ 50%]
tests/test_phase0_gate.py::test_valid_stop_applies_versions_and_diffs PASSED [100%]
============================== 2 passed in 5.55s ===============================
```

`test_off_network_stop_is_rejected` adds a transit stop 5km from a real
street coordinate, confirms `patch()` raises `TwinInvariantError` naming the
offending stop, and confirms the caller's original state is untouched.
`test_valid_stop_applies_versions_and_diffs` adds a stop 5m from a real
street coordinate, confirms it applies, `version` increments by 1 with the
correct `parent_version`, the original state is still untouched (immutable
snapshots), and `diff(old, new)` reports exactly one addition under
`layers["transit_stops"].added` and nothing else changed.

**Gate status: cleared.**

Full test suite (36 tests: the gate, ingestion sanity/CRS/bounded-slice
checks, per-invariant unit tests on synthetic states, diff unit tests,
state-load sanity):

```
$ uv run pytest -q
....................................                                     [100%]
36 passed in 6.27s
```

### Key decisions and why

- **Study area**: Ward 13 "Toronto Centre" -- see rationale above. Recorded
  here and in `data/ingest.py`'s module docstring so it isn't re-litigated
  silently later.
- **Library choices**: `geopandas`/`shapely`/`pyproj`/`pyogrio` for
  geospatial IO (pyogrio is the fast GDAL-backed engine, avoids the slower
  fiona default); plain `pandas` + `zipfile` for GTFS (added `gtfs-kit` to
  the candidate list but skipped it -- Phase 0 only needs
  stops/routes/trips/shapes, not full feed validation, so a heavier
  dependency wasn't worth it tonight); `pydantic` for the typed schema per
  the task brief; `networkx` added specifically for the street-connectivity
  invariant (small, standard, no realistic alternative for graph component
  checks).
- **Raw vs. processed data boundary**: citywide raw downloads live in
  `data/raw/` and are git-ignored; only the clipped-and-reprojected
  `data/processed/` slice (~16MB) is committed. This keeps "ingestion of a
  bounded slice" true of what's actually in the repo, while being honest
  that the *source* files aren't bbox-filterable server-side.
- **`stop_times.txt` skipped**: 200MB uncompressed, not needed for anything
  in the Phase 0 gate. Documented as a named follow-up, not a silent gap.
- **Geometry stored as typed GeoJSON-shape, not live shapely, in the
  schema**: keeps `TwinState` trivially JSON-serializable (matters once
  snapshots need to be persisted/transmitted in later phases), with
  `state.py` as the single conversion boundary to shapely for computation.
- **Provider-agnostic note from the coordinator** (2 local GPUs available
  for vLLM in addition to Freesolo Flash, for later-phase model inference):
  noted for later phases; nothing in tonight's Phase 0 work touches model
  serving or training config, so there was no Flash-only assumption to avoid
  hardcoding. Flagging here so a future session doesn't have to rediscover
  this constraint from scratch.

### Blockers

None that stopped work. One documented, non-blocking gap (see above):
`check_street_network_edits_connect` doesn't yet catch a `remove` that
disconnects previously-joined network parts, because that check needs the
parent `TwinState`, not just the candidate. Not tied to any AGENTS.md
section 9 open question -- purely an engineering follow-up, safe to pick up
without human sign-off.

### Suggested next queue

Still within "harden Phase 0" (do NOT start Phase 1 population/model work
without picking this back up first, per the phase-gate rule):
1. Thread the parent `TwinState` into `patch()`'s invariant call so
   `check_street_network_edits_connect` (or a new
   `check_street_network_remove_preserves_components`) can compare
   connected-component counts before/after a `remove`, closing the
   documented gap above.
2. Add a policy-layer edit path test end-to-end (`patch()` adding a
   `PolicyValue` with a `zone_id`, both valid and dangling) -- current
   coverage of `check_policy_zone_references` is synthetic-state-only, not
   yet exercised through `patch()` against the real loaded state the way
   the transit-stop gate is.
3. Consider a `parent_state` inspection helper /snapshot store, since
   Phase 8's `snapshot()`/rollback verb will need to look up arbitrary past
   versions, not just the immediate parent -- worth deciding the storage
   shape now while the schema is still small, without over-building it
   before it's needed.

When ready to actually start Phase 1 ("Population + independent-persona
simulator + heatmap"): `population/sampler.py` (census-weighted personas by
dissemination area), wiring personas to home nodes in the Ward 13 twin, and
the simplest end-to-end LM-opinion loop. Per the coordinator's note, Phase 1
sampling is a good candidate for local vLLM rather than Flash (cheaper for a
sampling loop), while Flash is likely still the right tool for the later
SFT/GRPO training runs (Phase 4/5) -- keep any model-serving config
provider-agnostic when that work starts, rather than hardcoding either.
