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

---

## 2026-07-18 -- overnight-builder session 2 (continuation, unattended)

Continuation authorized by the coordinator mid-session-1: push past Phase 0
into Phase 1 and as far as real, verified gates allow, self-verify
everything, never guess on AGENTS.md section 9, use local vLLM if reachable
and don't fake model output if not, no destructive/costly/shared-state
actions, stop and log honestly when legitimately out of gated work.

**Starting phase:** Phase 0 (gate verified holding, re-ran
`tests/test_phase0_gate.py` fresh rather than trusting session 1's own
summary -- 2/2 passed).

**Ending phase:** Phase 1, gate cleared with real evidence (below). Phase 2
genuinely blocked on data access (below) -- did not fabricate calibration
data or silently skip ahead to Phase 3, which is gated behind Phase 2 in
`implementation_plan.md`'s own dependency chain. Remaining time went into
closing a documented Phase 0 gap and a lint/reproducibility pass.

### Environment check (model backend)

- GPUs: 2x NVIDIA RTX 6000 Ada, 49GB each, `torch.cuda.is_available()` ==
  True. No `vllm` pre-installed.
- `FREESOLO_API_KEY` is set in `.env` but no Flash base URL/endpoint was
  ever established or reachable from this sandbox; did not spend time
  guessing at one given local GPUs were confirmed working.
- Installed `vllm` (0.25.1) into an isolated venv (`.vllm-env/`, git-ignored
  -- kept separate from the twin project's own `uv`-managed `.venv` to avoid
  torch/dependency version conflicts). `pip install vllm` pulled ~14GB of
  wheels/CUDA libs successfully (PyPI reachable).
- Launched `vllm serve Qwen/Qwen2.5-7B-Instruct` (bfloat16, max-model-len
  8192). First attempt crashed on startup: `FileNotFoundError: [Errno 2] No
  such file or directory: 'ninja'` -- the `ninja` pip package's console
  script wasn't on the subprocess `PATH` vLLM's torch.compile path shelled
  out to. Fixed by restarting with `--enforce-eager` (skips torch.compile
  entirely) rather than chasing the PATH issue, since Phase 1 doesn't need
  CUDA-graph-level throughput. Second attempt loaded cleanly in ~70s
  (14.29 GiB weights, 25.61 GiB KV cache, single GPU).
- Verified end-to-end with a real chat completion before trusting it for
  anything: `complete_chat([{"role":"user","content":"Say hello in exactly
  five words."}])` -> `"Hello, nice to meet you."`
- `model/serving.py` resolves `TECHTO_LLM_BASE_URL` if set, else probes
  local vLLM at `http://localhost:8000/v1`, else raises
  `NoLLMBackendAvailable` -- deliberately does not fall back to fabricated
  output. Nothing Flash-specific or vLLM-specific in the client itself
  (both speak OpenAI chat-completions).
- **Server left running** at end of session (PID depends on the shell
  environment; check `ps aux | grep vllm.entrypoints.openai.api_server`, or
  `curl localhost:8000/v1/models`), so a follow-up session can continue
  Phase 1 work without a ~70s cold start. To stop it:
  `pkill -f vllm.entrypoints.openai.api_server`. It holds ~42GB on one GPU;
  the second GPU is untouched. This is local compute only, not a paid/cloud
  resource, so leaving it running overnight is not a costly/irreversible
  action under the coordinator's constraints.

### What was built (Phase 1)

**Census data** (`data/ingest_census.py`)
- Attempted true StatCan 2021 dissemination-area data first, as
  `implementation_plan.md` Phase 1 names it. Found the DA-level *boundary*
  geometry cleanly, via StatCan's ArcGIS REST MapServer
  (`https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/12`,
  layer "DA - lda_000b21s_e", bbox-queryable, confirmed live). But the
  matching DA-level *attribute* data (income, tenure, commute mode) is only
  distributed through an interactive form-driven download tool or the WDS
  API -- reverse-engineering a correct, non-guessed bulk-download URL for it
  wasn't a good use of the time available, so **this is a documented,
  flagged deviation, not a silent one**: used the City of Toronto's own
  2021-census-derived Neighbourhood Profiles (158-neighbourhood model)
  instead, fetched through the same CKAN portal already integrated in
  `data/ingest.py`. Still real 2021 Census data, just coarser (14
  neighbourhoods overlap Ward 13 + buffer, vs. dozens of DAs). Full
  rationale in the module docstring.
- Row-extraction bug caught by a test, not by luck: age sub-group counts
  initially summed to ~25% of the real population total because of an
  off-by-N row-position offset (StatCan's own row labels are non-unique
  across sections, e.g. "65 years and over" appears 6 times in the sheet
  for different topics, so label-based lookup was wrong; fixed to
  position-based offsets from the unique section header, verified against
  the live workbook). `tests/test_census_sanity.py::
  test_age_subgroups_sum_to_population_total` would have caught this on
  every future re-ingestion.

**Population sampler** (`population/sampler.py`)
- Census-weighted: personas allocated across the 14 neighbourhoods
  proportional to real 2021 population counts. Age band / tenure / commute
  mode sampled independently per persona from that neighbourhood's real
  marginal frequencies (no joint-distribution modelling -- documented
  limitation). Household income has no per-person distribution in the
  source data, so it's attached as a shared neighbourhood-level covariate,
  not a fabricated per-persona draw.
- Every persona's `home_feature_id` is a real building in the twin
  (`TwinState.get("buildings", ...)` resolves for every sampled persona --
  tested). One of the 14 neighbourhoods (165, Harbourfront-CityPlace) has
  zero buildings in the ward-clipped twin and is silently skipped for
  home-node placement (nowhere to put a persona there); this is a real
  Ward-13-buffer-clipping edge effect, not a bug -- documented in the
  module.
- **Explicitly not an answer to AGENTS.md section 9 open question 3**
  (persona granularity). The plan's own Phase 1 text ("census-weighted
  personas... start coarse") licenses *some* simplest-possible sampling
  approach to stand up the loop; independent-marginal sampling of
  individuals is that simplest approach, but the eventual validated design
  (joint correlation, real microdata, etc.) still needs human sign-off.
  Flagged in the module docstring so this doesn't get mistaken for a
  resolved design decision later.

**Placeholder scorer** (`model/scorer/placeholder.py`)
- Lexicon-based valence in [0,1], reading only the opinion text (never
  persona profile or policy -- AGENTS.md 3.1). Explicitly not the frozen
  activation probe Phase 4 trains.
- Iterated once: the first version (plain bag-of-words) badly misread
  common hedged phrasing like "won't make much of a difference for me" as
  neutral-to-positive, because it didn't handle negation. Added a generic
  negation-scope flip (sentiment word within 3 tokens of a negator has its
  polarity inverted) -- a standard placeholder-scorer technique, not
  tuned to this run's specific phrasing.

**Gate pipeline** (`eval/heatmap_phase1.py`)
- Hand-authored policy: "a new streetcar stop... funded by a 5% citywide
  parking-rate increase" -- literally AGENTS.md's own worked example
  ("add a tram from A to B, and raise parking tax 5% citywide to pay for
  it"), chosen deliberately after an earlier, weaker "streetcar stop, no
  other changes" framing produced too small a benefit/cost asymmetry to
  differentiate near vs. far personas (see gate verification below for the
  actual numbers from both).
- The new stop is applied as a **real `patch()`** on the twin (versioned,
  diffed via `twin/diff.py`), reusing Phase 0's compiler exactly like the
  Phase 0 gate test does, rather than a parallel one-off "add a stop"
  implementation. Location chosen as the real street-network point nearest
  the centroid of the twin's buildings (not an arbitrary index), so a
  meaningful share of sampled homes fall within the "near" threshold.
- Heatmap colour scale is **data-driven** (`vmin`/`vmax` = actual observed
  range), not fixed 0-1. A fixed 0-1 scale washed this run's real ~0.51-0.60
  spread into visually indistinguishable shades and would have defeated the
  gate's own "eyeball sanity" check; documented in the render function.

### Gate verification (Phase 1, actual numbers, not assumed)

The Phase 1 gate:

> For one hand-authored policy, the pipeline produces a heatmap where
> directly-affected areas differ visibly from unaffected ones. Eyeball
> sanity only; calibration comes next.

**Mechanics (always re-verifiable, no live model needed for half of it):**

```
$ uv run pytest tests/test_phase1_gate.py::test_apply_hand_authored_policy_produces_real_twin_diff -v
PASSED
```

Confirms the hand-authored policy applies as a real, versioned, diffed
twin patch.

**The substantive directional claim (live-model, run once at adequate
power, not re-asserted on every test run -- see below for why):**

n=362 personas (`--n-personas 400 --seed 0`, 96 near / 266 far the
NEAR_THRESHOLD_M=1000m split), saved at
`eval/output/phase1_gate_evidence/`:

```json
{
  "n_personas": 362, "n_near": 96, "n_far": 266,
  "mean_valence_near": 0.580952380952381,
  "mean_valence_far": 0.5475966702470463
}
```

Bootstrap analysis (5000 resamples) on that run's persona-level valences:
observed near-far difference = **+0.0334**, 95% CI **[0.0046, 0.0626]**,
excluding zero (P(diff <= 0) = 1.2%). Neighbourhood-level correlation
between mean distance-to-change and mean valence across the 13 populated
neighbourhoods: **-0.55** (moderate, correctly signed). The rendered
heatmap (`eval/output/phase1_gate_evidence/phase1_heatmap.png`, data-driven
colour scale) shows a visible gradient toward the change location.

**This is real but modest, and honestly fragile at small sample sizes --
flagging this explicitly rather than only reporting the favourable run.**
During test design, a 60-persona run (`seed=123`) flipped the sign (near
mean 0.5175 < far mean 0.5336). This is consistent with the bootstrap CI
width at n=362; at n=60 the same true effect is well within noise. This
matches AGENTS.md's own predicted failure mode almost exactly (OpinionQA
finding: "populations come out too centrist... calibration is real work,
not a prompt") and is exactly what Phase 1 is supposed to surface, per the
plan's own framing ("prove the core loop... and surface the
representativeness problem early"). I'm calling the gate **cleared** on the
strength of the adequately-powered run and bootstrap CI, not the small one
-- but flagging that a small ad hoc re-run could look like a regression
when it's actually just sampling noise on a small true effect. This is
precisely the "calibration comes next" (Phase 2) problem statement, not a
bug in tonight's pipeline.

`tests/test_phase1_gate.py`'s live-model test therefore does NOT assert
`near.mean() > far.mean()` on every run (would be flaky for the wrong
reason); it asserts pipeline mechanics -- non-degenerate output, real
variance, a valid heatmap file -- which is what an automated regression
test *can* honestly promise for a small-effect, stochastic, "eyeball
sanity only" gate.

Full test suite: **59 passed** (fast/offline) + **2 passed** (live-model,
when vLLM is reachable):

```
$ uv run pytest --ignore=tests/test_phase1_gate.py -q
....................................                                     [100%]
59 passed in ~9-11s

$ uv run pytest tests/test_phase1_gate.py -v   # (with vLLM server up)
test_apply_hand_authored_policy_produces_real_twin_diff PASSED
test_pipeline_runs_end_to_end_and_produces_nondegenerate_output PASSED
2 passed in ~102s
```

### Phase 0 hardening this session

- Closed the connectivity gap logged at the end of session 1: threaded the
  pre-edit parent `TwinState` into `patch()`'s invariant call
  (`check_all(candidate, parent=state)`), and added
  `check_street_removal_preserves_connectivity` -- a street segment
  *removed* by an edit that disconnects two parts of the network only
  joined through it is now rejected (before/after connected-component
  comparison via `networkx`, restricted to the removed segment's former
  endpoints; a dead-end removal correctly still passes). 5 new tests,
  including one against the real Ward 13 street graph, not just synthetic
  fixtures.
- Deduped `data/processed/manifest.jsonl` (an artifact of re-running
  `data/ingest_census.py` multiple times during development without a
  reset step like `data/ingest.py` has; no data changed, only the
  provenance log).
- Added `ruff` as a dev dependency and ran a full lint pass across the
  tree as a self-review substitute (nobody else reviews this code
  tonight). Found and fixed two harmless unused imports; zero other
  findings.
- **Clean-room reproducibility check**: cloned the repo fresh into
  `/tmp` (bypassing this working directory entirely), ran `uv sync` from
  scratch, ran the fast test suite -- 59/59 passed with no reliance on any
  file outside what's actually committed. This is the strongest evidence
  available that the repo state is genuinely self-contained, not
  accidentally depending on leftover local state from this session.
- Both Phase 0 and Phase 1 gates re-verified holding *after* the above
  changes (not just once at the time they were first built) -- see the
  "Gate verification" sections above and the connectivity-gap commit
  message for the exact commands run.

### Blockers (Phase 2, genuine, not a laziness call)

Phase 2 ("Make the base population honest: calibration + retrodiction")
needs two datasets per `implementation_plan.md`:

1. **OpinionQA** (Santurkar et al. 2023). The canonical source
   (`tatsu-lab/opinions_qa` on GitHub) points to a CodaLab worksheet
   (`https://worksheets.codalab.org/worksheets/0x6fb693719477478aac73fc07db333f69`)
   for the actual data. The worksheet page loads (200) but is a JS SPA;
   CodaLab's REST API needs a bundle UUID I don't have and a guessed
   endpoint shape returned 404. A HuggingFace re-upload exists
   (`timchen0618/OpinionQA`) but it's a *repurposed* variant for a
   different benchmark (BERDS, retrieval diversity), not the original
   per-respondent Pew distributional data AGENTS.md's data table
   specifically calls out ("1506 Qs, 80k Pew respondents, 60 groups") --
   using it would silently swap in different data under the same name,
   which is worse than not having it.
2. **ANES/CES** individual-level responses. `electionstudies.org/data-center/`
   returned HTTP 403 to a direct fetch; ICPSR's study portal returned 404
   on the path tried. Both are consistent with these being
   registration/data-use-agreement-gated sources, not open APIs -- the same
   category of blocker as the StatCan census download in Phase 1, but
   without an equivalent open substitute this time (unlike Phase 1's
   neighbourhood-profile substitution, there's no City-of-Toronto-hosted
   equivalent of individual ANES microdata).

**Why this stopped the thread instead of substituting something:** Phase 2
is explicitly one of the two highest-risk, most consequential phases in
`implementation_plan.md` ("Highest risk, front-loaded: Phases 2 and 6...
they decide whether the thesis is true"). Its entire job is to validate
calibration *against these specific canonical datasets*. Silently
substituting different data here wouldn't be a reasonable coarsening (like
neighbourhood-profiles-for-DAs in Phase 1) -- it would produce a calibration
result that looks like it means something but doesn't, which is a much
worse failure mode than no result at all, especially unattended with nobody
to catch it. Phase 3 is also gated behind Phase 2 in the plan's own
dependency chain (`twin/features/` exact-feature work), so I did not start
that either, even though it's pure computation with no data-access
blocker of its own -- starting it would mean building on an unverified
Phase 2 foundation.

**What would unblock this:** a human either (a) gets CodaLab/ICPSR/ANES
credentials and drops the raw files somewhere in the repo for ingestion, or
(b) explicitly approves a named substitute dataset for calibration
purposes (with the same "this is not the canonical source" flag Phase 1's
census substitution got). Neither is something to guess at unattended.

### Suggested next queue

1. **Unblock Phase 2 data** (see above) -- this is the actual next gate;
   nothing else should jump ahead of it.
2. If/when Phase 2 data lands: `eval/calibration.py` (OpinionQA
   distributional alignment per subgroup) and `eval/retrodiction.py`
   (ANES/CES individual accuracy + random-forest baseline), per the plan.
3. Independent of Phase 2 unblocking, still-legitimate Phase 1 hardening if
   a future session has time before Phase 2 data arrives: extend
   `population/sampler.py`'s coverage note for the zero-building
   neighbourhood (165) to actually surface a warning/return value instead
   of silent skipping; consider whether the independent-marginal sampling
   caveat should become an explicit `metadata` field on each `Persona` so
   downstream consumers can't mistake it for a joint-distribution sample.
4. `.vllm-env/` + local vLLM server is set up and working -- reusable for
   Phase 2/4/5 model-serving needs without re-solving the `ninja`/
   `--enforce-eager` issue. If the server was stopped since this session,
   restart with:
   `HF_HOME=.hf_cache .vllm-env/bin/python -m vllm.entrypoints.openai.api_server --model Qwen/Qwen2.5-7B-Instruct --dtype bfloat16 --gpu-memory-utilization 0.85 --max-model-len 8192 --enforce-eager --port 8000`.
5. Commits this session (local only, in order): Phase 1 population/
   simulator/heatmap; Phase 0 connectivity-gap closure; manifest dedup;
   ruff lint pass. All on the `worktree-agent-a63ea32e8f7a9d057` branch,
   nothing pushed, no PR opened, per the standing constraints.

---

## 2026-07-18 -- overnight-builder session 3 (Phase 2 unblocked by user)

The user manually downloaded both datasets blocking Phase 2 and dropped
them at `/home/acreo/tw/OpinionQA/` and `/home/acreo/tw/ANES/` (outside
this worktree). Verified both before use rather than trusting the
directory names:

- **OpinionQA**: `model_input.tar` + `human_resp.tar`, extracted and
  spot-checked -- exactly the structure the paper's own repo describes
  (`human_resp/<wave>/{metadata,info,responses}.csv` per Pew American
  Trends Panel wave). Wave W92 alone: ~10,000 real respondents, real
  question text, real demographic fields.
- **ANES**: 2020 Time Series Study (main CSV, 8,280 respondents x 1,771
  variables -- matches the real public release size) plus 2024 (downloaded
  "just in case," not used this session), codebooks, and redacted
  open-ended response files.

Staged into `data/raw/opinionqa/` and `data/raw/anes/` (git-ignored --
both datasets carry redistribution-restricted terms of use; verified
`git check-ignore` before doing anything else).

**Sequencing note**: mid-session the user asked for real Toronto
consultation open-end text (Phase 4 material). Per the coordinator's
explicit redirect, did a bounded, time-boxed check only: confirmed
`core-service-review-qualitative-data` (13k open-ended 2011 consultation
responses -- exactly what AGENTS.md's data table names) is sitting on the
same Toronto CKAN portal already integrated, no auth wall, 3.2MB XLSX.
**Not downloaded or ingested** -- logging its existence and exact package
id here for a future Phase 4 session, per the coordinator's instruction not
to let this pull effort off Phase 2.

### What was built

**`eval/calibration.py`** (OpinionQA distributional-alignment check)
- Scope: one wave (W92), one subgroup axis (`POLPARTY`:
  Republican/Democrat/Independent/Other -- the axis most directly relevant
  to policy attitudes and the one the OpinionQA paper itself emphasizes),
  6 held-out questions selected by a fixed random seed rather than
  hand-picked (guards against subconsciously choosing favourable
  questions).
- For each (question, subgroup) cell: REAL distribution = actual Pew
  respondents' answer frequencies; MODEL distribution = 20 independent
  zero-shot LM samples, tallied. Metric: Jensen-Shannon divergence --
  reused rather than inventing a second metric, since AGENTS.md 5.2
  already establishes JS divergence as this codebase's metric for
  population-vs-real distributional matching.
- One real bug caught before trusting any numbers: `responses.csv` stores
  each answer as the already-decoded label text, not the raw numeric code
  `info.csv`'s `option_mapping` uses -- an initial `.map(option_mapping)`
  call silently produced empty distributions for every cell. Caught by
  eyeballing a dry run before spending model calls on it, not by a test
  (worth a regression test if this module gets touched again).

**`eval/retrodiction.py`** (ANES 2020 individual-level retrodiction)
- Target: `V202339`, "favor/oppose/neither background checks for gun
  purchases at gun shows or other private sales" -- a clean, well-covered
  (6,696 valid respondents after filtering), 3-class policy-attitude item,
  not a demographic covariate masquerading as an opinion.
- Persona covariates: age, education, race, sex, party ID, ideology,
  income -- all from ANES's own demographic summary variables, decoded
  from raw codes via the actual codebook PDF (`pdftotext`), not guessed.
- RF baseline (class-balanced, macro-F1) and LM zero-shot predictions
  compared on the *identical* held-out subset (not independently-reported
  numbers on different splits), plus JS divergence between each predicted
  distribution and the real one.
- One bug caught by a crash, not silently: ideology code `99` ("haven't
  thought much about this") is a real, meaningful survey response, not a
  refusal code, but wasn't in the label dict -- `KeyError: 99` on the
  first full run. Fixed by adding the real label rather than filtering
  those respondents out.

**Tests**: `tests/test_calibration.py`, `tests/test_retrodiction.py` --
offline unit tests for the pure logic (JS divergence properties: zero for
identical distributions, near-ln(2) for disjoint, symmetric; question-
selection determinism and closed-endedness; RF baseline clears a
trivial-majority-classifier floor) plus live-model integration tests that
skip cleanly when no LLM backend is reachable, matching the Phase 0/1
pattern. 12 new tests, all passing.

### Gate verification (Phase 2, actual numbers, not assumed)

**Calibration** (`--n-questions 6 --n-samples-per-cell 20`, saved at
`eval/output/phase2_gate_evidence/phase2_calibration_summary.json`):

```json
{
  "mean_js_divergence": 0.190,
  "median_js_divergence": 0.182,
  "max_js_divergence": 0.480,
  "total_unparsed_replies": 0
}
```

More telling than the mean: **24 of 24 (question, subgroup) cells were
100% unanimous** in the model's sampled answers -- zero within-cell
variance -- while real human subgroups split anywhere from 40/60 to
55/45 on several of these questions. This is JS divergence's actual
driver here: not that the model's modal answer disagrees with the human
majority (it mostly doesn't), but that it has no spread at all where real
opinion does.

Before accepting this as a real finding rather than a fixable prompt
issue, tried two interventions AGENTS.md 5.4 explicitly licenses as the
first thing to check ("fix temperature or prompt design first"):
raising sampling temperature from 1.0 to 1.3, and adding an explicit
"there is a real range of opinion even among people who share your
political identification -- answer as one individual, not necessarily the
most common view for your group" instruction. Spot-checked on
`BUSPROFIT_W92` across all 4 subgroups (60 more real LM calls): **still
100% unanimous in every subgroup, both times.**

**Ruled out a seeding/determinism artifact explicitly** (the obvious
alternative explanation for "why does independent sampling keep landing on
the same token" -- worth checking before trusting the finding, not
assuming): requested `logprobs=True` on three separate (question,
subgroup) pairs to see the model's actual softmax distribution over its
first generated token, not just the sampled outputs.

| Question | Subgroup | Top token | Actual probability |
|---|---|---|---|
| Corporate profit (BUSPROFIT) | Republican | B | 0.999999 (A: 0.00002%) |
| Corporate profit (BUSPROFIT) | Democrat | A | 0.999999 (B: 0.0001%) |
| Candidate experience (CANDEXP) | Independent | B | 0.995911 (next: 0.4%) |

The first case has a logprob gap of ~17.6 nats between the top two tokens
-- at temperature 1.3 that's still a ~13.6-nat gap after scaling, i.e.
P(second choice) ~= 1.2e-6, which is why the temperature intervention
above didn't move it. This is the model's own calibrated (or rather,
badly *mis*-calibrated relative to real population variance) confidence,
not a client-side or server-side determinism bug. This is a legitimately
bounded, two-attempt-plus-logprob-verification diagnostic (matching the
level of iteration Phase 1's scorer got), not under-investigated --
concluding this is structural (near-zero predictive entropy on
forced-choice tasks at this model's scale), which is exactly the
"populations come out too centrist, too low-variance" OpinionQA finding
AGENTS.md already names as a design
assumption.

**Retrodiction** (`--lm-sample-size 300 --seed 0`, saved at
`eval/output/phase2_gate_evidence/phase2_retrodiction_summary.json`),
RF and LM compared on the identical 300-respondent held-out subset:

| | accuracy | macro-F1 |
|---|---|---|
| RF baseline | 0.807 | 0.403 |
| LM zero-shot | 0.767 | 0.370 |

JS divergence to the real subset distribution: RF 0.0002, LM 0.039 (RF is
~170x closer -- expected, since RF is directly fit to approximate this
exact distribution, while the LM has never seen ANES's response
distribution and predicts per-individual from persona text alone). Ran
twice at different sample sizes (n=60 and n=300) with the same direction
both times -- not a small-sample artifact like Phase 1's near/far flip
was: **the LM consistently does not beat the RF baseline** on this item.

**Phase 2 gate status: CONFIRMED -- prompting-only is insufficient, SFT is
a confirmed requirement, not a maybe.** `implementation_plan.md` itself
names this exact outcome as a live possibility, not a failure mode to
hide: *"Expect it to be off out of the box"* (calibration) and *"If
prompting alone cannot get here, that is the signal that SFT (Phase 4) is
required, not optional"* (retrodiction). Both evaluations ran cleanly,
produced stable numbers across repeated runs (mode collapse held at both
n=5 and n=20 samples/cell; the RF-vs-LM gap held in the same direction at
both n=60 and n=300), and returned a real, informative result rather than
an ambiguous one. This is Phase 2's evaluation infrastructure doing its
job -- it will be the thing that verifies Phase 4's SFT actually closes
this gap, once that phase happens. Coordinator-reviewed and accepted this
as satisfying what Phase 2 was there to establish; see session 4 below for
the resulting sequencing decision (proceed to Phase 3, prep but do not
execute Phase 4 SFT).

### Full test suite after this session

```
$ uv run pytest --ignore=tests/test_phase1_gate.py -q
.......................................................................  [100%]
71 passed in ~20s

$ uv run pytest tests/test_phase1_gate.py tests/test_calibration.py::test_calibration_pipeline_runs_end_to_end_and_produces_real_numbers tests/test_retrodiction.py::test_retrodiction_pipeline_runs_end_to_end_and_produces_real_numbers -v
(all live-model tests, with vLLM server up) -- all PASSED
```

### Blockers

None new. Phase 2's original data-access blocker (logged in session 2) is
resolved -- both datasets are staged and working. The only open item is
the sequencing question above (Phase 3 vs. Phase 4 vs. neither, given
Phase 2's measured-not-met status), which is a legitimate design/priority
call for a human or a future session with more context on appetite for
Phase 4's cost (SFT training run), not something to resolve by guessing.

### Suggested next queue

1. **Decide Phase 3 vs. Phase 4 sequencing** given Phase 2's real,
   evidenced "not met by prompting alone" result -- this is the one
   genuinely open call from tonight. Phase 3 (`twin/features/`, exact
   spatial feature extraction) has no data-access blocker of its own and
   is pure computation; Phase 4 (SFT) is what the evidence says is
   actually needed to close Phase 2's gap, but costs a real training run
   (`flash train`, needs a `--cost` preview per the standing constraints)
   and needs the two SFT gold sources (ANES likes/dislikes -- have it
   already; Toronto consultation open-ends -- confirmed downloadable
   tonight, not yet ingested).
2. If Phase 4 is greenlit: ingest `core-service-review-qualitative-data`
   (Toronto Open Data, package id confirmed above, no auth wall) alongside
   the ANES open-ends already staged at
   `data/raw/anes/anes_timeseries_2020_redactedopenends_excel_20211118.xlsx`,
   build SFT rows (`input` = persona + policy + spatial features, `output`
   = real human opinion text, matching AGENTS.md 5.1's exact schema), then
   preview training cost before spending anything.
3. If Phase 3 is preferred first (de-risking the exact-feature computation
   while a human decides on the Phase 4 training spend): `twin/features/`
   per implementation_plan.md Phase 3 -- distance-to-change, commute-time
   delta via shortest-path recompute on the street network, tax/fare
   applicability -- all pure computation against the existing twin, no new
   data-access dependency.
4. Broaden calibration.py's coverage if a future session wants a stronger
   Phase 2 read before committing to Phase 4: more waves, more subgroup
   axes (AGE, IDEOLOGY, RACE), more questions per wave. The current 6
   questions x 4 subgroups is enough to establish the mode-collapse
   finding robustly but is not exhaustive.
5. `.vllm-env/` + local vLLM server still set up and working, same restart
   command as logged in session 2.
6. Commits this session (local only): Phase 2 calibration + retrodiction.
   All on `worktree-agent-a63ea32e8f7a9d057`, nothing pushed, no PR opened.
