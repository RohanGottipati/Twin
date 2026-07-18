# ToronTwin Implementation Plan

Read AGENTS.md first. This plan is ordered to **de-risk the hard, unfalsifiable
parts first** and to keep the least risky layer (the agent + UI) for last. Each
phase has a single goal, concrete deliverables, and a **gate**: a measurable
condition that must hold before the next phase starts. Do not skip gates.

Guiding principle: the agent and the pretty UI are the easy 80%. The population
simulator and its validation are the actual thesis. Build the thesis first.

---

## Phase 0 — Twin skeleton + one readout

**Goal.** Stand up the versioned city twin and a single end-to-end path, with no
model and no agent yet.

**Do.**
- Ingest a bounded slice of Toronto (start with one ward or the downtown core):
  3D Massing buildings, TCL streets, TTC GTFS, zoning, parks.
- Implement `twin/schema.py`, `state.py`, `diff.py`, and a first pass of
  `invariants.py`. Reproject everything to NAD83 / UTM zone 17N.
- Implement `patch()` and `diff()` directly (no agent). Make one manual edit
  (add a stop) and confirm the diff and invariant checks fire correctly.

**Gate.** A manual `patch` that adds a transit stop off the network is rejected
by invariants; a valid one applies, versions, and produces a correct diff.

---

## Phase 1 — Population + independent-persona simulator + heatmap

**Goal.** Prove the core loop end to end with the simplest possible model, and
surface the representativeness problem early.

**Do.**
- `population/sampler.py`: census-weighted personas by dissemination area (age,
  income, tenure, commute mode, home location). Start coarse.
- Wire personas to the twin: each persona sits at a home node.
- Simplest simulator: prompt an off-the-shelf Qwen (via the Flash endpoint) with
  persona + a hand-written policy context; get an opinion; score with a
  placeholder sentiment probe.
- Aggregate census-weighted valences into a neighborhood heatmap. Render to a
  static file (no live UI needed).

**Gate.** For one hand-authored policy, the pipeline produces a heatmap where
directly-affected areas differ visibly from unaffected ones. Eyeball sanity only;
calibration comes next.

---

## Phase 2 — Make the base population honest (calibration + retrodiction)

**Goal.** Turn "it produces a map" into "the map is not obviously wrong." This is
where the OpinionQA misalignment problem gets confronted head-on.

**Do.**
- `eval/calibration.py`: run the population against OpinionQA; measure
  distributional alignment per subgroup. Expect it to be off out of the box.
- `eval/retrodiction.py`: condition personas on real ANES/CES respondents;
  measure individual-level accuracy (JS distance for distributions, F1 for
  prediction). Stand up a random-forest baseline as the fair thing to beat.
- Iterate on persona conditioning (prompt structure, few-shot group
  distributions) to close the gap as far as prompting can.

**Gate.** Population reproduces known subgroup splits within an agreed tolerance
on a held-out OpinionQA slice, and beats (or matches with legible reasons) the
RF baseline on ANES individual retrodiction. If prompting alone cannot get here,
that is the signal that SFT (Phase 4) is required, not optional.

---

## Phase 3 — Effect graph (exact features first)

**Goal.** Give personas the spatial context that makes the same citywide change
produce different opinions across the map. No GNN yet.

**Do.**
- `twin/features/`: exact computation of per-persona features from the *changed*
  twin: distance to new/removed stops, commute-time delta (recompute shortest
  paths on the network), which tax/fare deltas apply to this persona, whether the
  persona's corridor intersects the change.
- Inject these as a structured `SPATIAL:` block into the prompt.
- Re-run Phase 1's loop; confirm bundled policies (tram + parking tax) now
  produce mixed, spatially-sensible opinions ("great, a stop near me, but parking
  downtown costs more").

**Gate.** Counterfactual test: for a persona the change does not touch, the
opinion and valence are near-neutral; move that persona next to the change and
the valence shifts in the correct direction and magnitude. If it does not, the
feature injection is broken; fix before proceeding.

---

## Phase 4 — SFT on real opinions

**Goal.** Teach the model to write real-sounding opinions in the right format,
conditioned on persona + policy + spatial features.

**Do.**
- Build SFT rows from Toronto consultation open-ends and ANES likes/dislikes:
  `input` = persona + policy + features, `output` = the human opinion. Put
  derived valence + provenance in `metadata`.
- Validate rows locally (think-tag check if using a thinking model).
- `flash train sft.toml`; preview with `--cost` first. Deploy, sample, eyeball.
- Train the **frozen valence probe** on human opinion -> valence, and the
  **realism discriminator** on real vs generated opinions. Package both as
  sidecars in `/model/scorer`.

**Gate.** SFT model's opinions are, on a blind check, hard to distinguish from
real consultation text (discriminator near chance on held-out human text), and
the probe's valence readout correlates with held-out human valence.

---

## Phase 5 — GRPO for distributional calibration

**Goal.** Fix the aggregate defect SFT cannot reach: push sampled populations to
match real subgroup distributions.

**Do.**
- `model/grpo/environment.py`: `score_response` blends valence match + realism +
  the group-level JS-divergence term (see AGENTS.md 5.2). Load probe and
  discriminator frozen.
- GRPO dataset rows carry `target_valence`, `subgroup`, `real_subgroup_dist` in
  `metadata`. `output` optional (rollouts are sampled).
- Preflight: sampler variance check (`pred_std`); no variance means no gradient.
- Warm-start from the Phase 4 SFT adapter. `flash train grpo.toml`.
- Hold out entire **policies** for eval.

**Gate.** On held-out past policies, JS divergence between the silico population
and the real subgroup distribution drops measurably vs the SFT-only model, with
no realism regression (discriminator does not suddenly catch the RL model). If
realism drops, the reward is being hacked; rebalance and retrain.

---

## Phase 6 — Backtest on a real Toronto change (GO / NO-GO)

**Goal.** The credibility gate for the entire tool. Retrodict something that
already happened.

**Do.**
- Pick one real past Toronto change with usable before/after opinion data (chosen
  in AGENTS.md open question 4).
- Reconstruct the pre-change twin, apply the change via `patch`, run the full
  pipeline (features -> population -> opinions -> distribution).
- Compare the predicted reaction distribution to what residents actually said in
  the real consultation.

**Gate (hard).** The system retrodicts the real change within an agreed error
band, by neighborhood where data allows. If it cannot retrodict a change that
already happened, the tool is not yet trustworthy: **do not proceed to agent/UI
wrapping.** Return to Phases 2 to 5. This gate protects the project from shipping
a confident, wrong demo.

---

## Phase 7 — Opinion-propagation GNN (ablation only)

**Goal.** Test, do not assume, that social influence improves prediction.

**Do.**
- Pin the edge set with the humans first (AGENTS.md open question 1). No edges
  without a stated mechanism.
- `graphs/opinion_gnn.py`: init node states from LM opinion embeddings; message-
  pass a few rounds; **decode back to regenerated opinion text**; re-score.
- Evaluate on DEBATE (before/after opinion text) using text-alignment, not stance
  bins alone. Then re-run the Phase 6 backtest with the GNN on.

**Gate.** Report the ablation honestly: does the GNN improve backtest fit and
DEBATE text-alignment over the independent-persona base? Ship it only if yes. A
clean negative result ("social propagation does not improve city-scale policy-
reaction prediction") is a valid, publishable outcome and ships as a finding, not
as a silent removal.

---

## Phase 8 — Wrap the Planner Agent + hand off UI

**Goal.** Put the general-tool agent on top of the now-credible simulator.

**Do.**
- `agent/tools.py`: `query`, `patch`, `run`, `snapshot`, `diff` over the twin.
  General verbs only (AGENTS.md 4.2). Confirm side effects; surface diffs.
- `agent/loop.py`: planner types a request; agent plans, calls tools, twin
  updates, population re-runs, aggregates return.
- Freeze a clean API contract for `/web`; hand the UI to the teammate.

**Gate.** A planner-style natural-language request ("add a tram from A to B and
raise parking tax 5%") flows through the agent to a correct twin diff and a
sensible sentiment map, with every affected persona's opinion inspectable.

---

## Optional Phase 9 — Effect-graph GNN as accelerator

Only if interactive latency demands it. Replace exact per-persona feature
recompute with a GNN surrogate trained to approximate the exact computation
(supervision is exact, since the computation is the label). Purely a speed play;
skip unless recompute-on-edit is the measured bottleneck.

---

## Dependency and risk summary

```
Phase 0 twin ---> 1 loop ---> 2 honest base ---> 3 features ---> 4 SFT ---> 5 GRPO ---> 6 BACKTEST(gate)
                                                                                            |
                                                                        +-------------------+
                                                                        v
                                                              7 opinion GNN (ablation)
                                                                        |
                                                                        v
                                                              8 agent + UI handoff
                                                                        |
                                                                        v
                                                              9 effect GNN (speed, optional)
```

- **Highest risk, front-loaded:** Phases 2 and 6 (calibration and backtest).
  These decide whether the thesis is true. They come early on purpose.
- **Lowest risk, deferred:** Phases 8 and 9 (agent, UI, speed). Do not let their
  visible shininess pull them forward past the Phase 6 gate.
- **Genuinely optional:** Phase 7 is a hypothesis test, not a requirement; Phase
  9 is an optimization. The defensible core (AGENTS.md 1) is done at Phase 6.