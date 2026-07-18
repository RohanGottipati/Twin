# AGENTS.md

Working context and conventions for any agent (or human) building **ToronTwin**.
`ToronTwin` is a placeholder codename: a population of individual voices producing a
collective sound, where you can still hear each voice. Rename freely; it is not
load-bearing.

Read this file fully before writing code. It encodes decisions that were argued
through deliberately. Do not silently re-litigate them; if you think one is
wrong, say so explicitly and wait.

---

## 1. What this project is

ToronTwin is a decision-support tool for Toronto city planners. A planner works in
a Cities-Skylines-style web view of the city and, through a chat agent, requests
arbitrary changes ("add a tram from A to B, and raise parking tax 5% citywide to
pay for it"). The system predicts **how residents would react**, returns a
legible written opinion per affected resident, and aggregates those into a
neighborhood sentiment map and a citywide distribution.

The contribution, stated as one sentence we are willing to defend:

> A census-weighted population of language-model personas, conditioned on
> physically-real effect features computed from a city digital twin, produces a
> calibrated day-one **acceptance** map for arbitrary policy changes, with a
> human-legible reason attached to every prediction, and we can retrodict past
> Toronto changes to prove it.

Everything else in the system is scaffolding around that sentence.

## 2. What this project is NOT (read this twice)

These framings are not modesty; they are correctness. Violating them in code,
copy, or demo is a bug.

- **It predicts acceptance, not consequences.** The model tells you how people
  *feel* about a change on day one. It does NOT predict ridership, induced
  demand, land-value shifts, traffic re-routing, or third-year outcomes. Those
  are equilibrium and agent-based-model questions; a different simulator. Never
  present a sentiment output as a forecast of physical or economic outcomes.
- **It is a distribution, not an oracle.** Output is always a distribution over
  a population with uncertainty, never a single confident number.
- **The score is secondary; the opinion is primary.** The written opinion is the
  artifact planners read and audit. The [0,1] opinion_score is a *measurement* taken
  off the opinion, not the point.
- **No ground truth for the future exists.** There is no counterfactual Toronto.
  We validate by retrodiction and mechanism tests, never by claiming access to
  what "will" happen.

If a stakeholder wants consequence prediction, that is a separate system. Say so.

## 3. The intellectual spine (do not break these invariants)

**3.1 The causal chain is: features -> opinion -> score.**
Spatial and policy effects are the real drivers. The opinion is a *mediator*.
The opinion_score is a *readout* of the opinion. This ordering is the whole reason the
system is interpretable. Concretely:
- The opinion_score probe must read the model's internal activations (or the opinion
  text), never the raw profile or policy. If the number can see the inputs
  directly, the opinion is no longer the mediator and the interpretability claim
  collapses.
- Prefer a **frozen linear probe over activations** to a text sentiment model,
  because activations reflect the model's actual state rather than its rhetoric,
  and the probe direction can be causally tested via activation patching.

**3.2 The product opinion_score probe is frozen if used.** When free-text opinions
are turned into a [0,1] readout for maps, that probe is trained once and never
co-adapted with the generator. A generator trained against a moving scorer
learns to hack it. GRPO reward itself does **not** use this probe (see 5.2);
freezing still applies whenever the probe is in the serving path.

**3.3 Every scored artifact is legible text.** Any time we score, we score a
human-readable opinion. This includes the opinion-propagation GNN (see 4.4): if
it mutates opinion *embeddings*, we decode the propagated embedding back to
regenerated opinion text via the LM *before* scoring. We never score a vector
nobody can read. The audit trail is the product.

**3.4 Format and stance hacking.** Student GRPO rewards free-text opinions. Include
a realism / text-alignment term so RL cannot satisfy the frozen MCQ judge with
empty or steganographic stubs (DEBATE-benchmark lesson). The judge call itself
should use structured outputs so option parsing is not the failure mode.

## 4. Architecture: four layers

```
+-----------------------------------------------------------+
|  WEB UI  (teammate owns; we stub it)                      |
|  city view + chat panel + sentiment heatmap overlay       |
+-----------------------------------------------------------+
|  PLANNER AGENT  (Claude-Code-for-cities)                  |
|  general tools over the twin: query / patch / run / diff  |
+-----------------------------------------------------------+
|  POPULATION SIMULATOR  (our Qwen model + two graphs)      |
|  census-weighted personas -> opinions -> opinion_scores         |
+-----------------------------------------------------------+
|  CITY TWIN  (typed, versioned document + invariants)      |
|  geometry + network + policy layer, from Toronto open data|
+-----------------------------------------------------------+
```

**4.1 City twin.** A structured, mutable, **versioned** representation of
Toronto: buildings (3D Massing), street and transit network (TCL + TTC GTFS),
parcels and zoning, parks, plus a policy layer (taxes, fares, parking rules).
Think versioned document: every planner action produces a new version, so we can
diff before/after and roll back.

The twin needs a **compiler**, i.e. a schema plus an invariant checker plus
auto-recompute of derived quantities. This is non-negotiable and is what lets
the agent tools stay general (see 4.2). Invariants include, at minimum: no
transit geometry off the road/rail network or in water; taxes only on zones that
exist; edits leave the network graph connected and valid; derived quantities
(commute times, accessibility) recompute on every edit. The compiler is the
validator that makes dumb, general tools safe, exactly as a type checker makes a
code editor's generic "edit" safe.

**4.2 Planner Agent.** The Claude Code analogy is exact and deliberate: Claude
Code does not ship `add_react_component()`; it ships general verbs (read, edit,
run) and keeps domain competence in the model. Do the same. The agent gets:
- `query(selector)` : spatial or attribute filter over any layer.
- `patch(edits)` : arbitrary edits across any layer (add/remove/modify buildings,
  lines, stops, zones, policy values).
- `run(analysis)` : recompute derived quantities, run the population simulator,
  fetch aggregates.
- `snapshot()` / `diff(a, b)` : version and compare.

DO NOT add domain-opinionated tools like `add_tram_line`. Any hidden work that
such a tool would have done (connect stops, update the graph, recompute
commutes) lives in the twin compiler (4.1), not in the tool surface. Generality
in the verbs; safety in the schema.

**4.3 Population simulator.** The core research artifact. A census-weighted set
of silico personas (see `/population`), each conditioned on the *changed* twin
and asked for an opinion, which is then scored. Aggregation over the population
(census-weighted) yields the neighborhood heatmap and citywide distribution.

**4.4 The two graphs (distinct jobs; do not blur them).**
- **Effect graph (physical/economic).** Nodes = places (parcels, stops, road
  segments); edges = adjacency + network connectivity; personas attached to home
  nodes. Job: propagate the physical effect of a change to each person and emit
  per-persona spatial features (distance to new stop, commute delta, which tax
  applies). Supervision is clean because the exact computation *is* the label.
  **MVP: compute these features exactly; skip the GNN.** Add the GNN only as a
  fast differentiable surrogate when exact recompute on every agent edit becomes
  the interactive-latency bottleneck. Not before.
- **Opinion graph (social).** Nodes = people; edges = a social-influence theory
  (see warning below). Job: propagate opinion *embeddings* so influence is
  content-specific, then decode back to text (per 3.3) and re-score. This models
  second-order structure: polarization, bandwagons, consensus, minority
  suppression.

> WARNING on the opinion graph. The edge set IS a theory of who influences whom.
> It is a strong, contested empirical claim, not a neutral accelerator. Do not
> draw edges you cannot justify as a mechanism. Build this graph ONLY as an
> **ablation on top of a validated independent-persona base**: does adding it
> improve backtest fit? A negative result here is publishable and honest; a
> confident un-validated diffusion model is architecture astrology. The effect
> graph is load-bearing; the opinion graph is a hypothesis under test.

Division of labor that survives all of the above: graphs own **structure** (who
is affected, how effects reach them, who influences whom) and emit a per-persona
context; the LM owns **generation** (turn context into a legible opinion plus a
probeable opinion_score). The LM cannot see global structure; the graphs cannot write
a reason. Let each do its job.

## 5. The model: SFT then GRPO

Served via Freesolo Flash (managed LoRA on Qwen), OpenAI-compatible endpoint.

**5.1 SFT teaches free-text opinions.** Gold = real human opinion text (Toronto
consultation open-ends, ANES likes/dislikes open-ends). Rows are
`input`/`output`: input = persona + policy + optional spatial features, output =
the human opinion. Teaches voice, plausibility, and the product output contract
(legible first-person text). SFT does **not** use `structured_outputs` (Flash
rejects that key for SFT; SFT never samples).

**5.2 GRPO calibrates free-text opinions so a frozen judge recovers the survey
choice.** SFT alone does not fix persona misalignment on multiple-choice surveys
(OpinionQA finding). GRPO trains on rows where a real respondent with a known
profile both (a) can be prompted for an open opinion and (b) has a gold MCQ
option.

Two different models, do not conflate them:

1. **Student (trained).** Flash GRPO samples free-text opinion rollouts from the
   LoRA we are updating (warm-started from SFT). The student writes a first-person
   opinion conditioned on persona + question/policy context. Student rollouts are
   **not** forced into A/B/C/D; the product artifact stays legible prose.
2. **Judge (frozen, not trained).** Inside `score_response`, call a **separate**
   model that is not in `[train]`: given the student's opinion text plus the MCQ
   stem and options, infer which option that opinion corresponds to
   (`A`/`B`/`C`/`D`/`none`). Prefer Flash/OpenAI **structured outputs** (or an
   equivalent constrained decode) on this judge call so parsing is reliable:
   https://freesolo.co/docs/guides/structured-outputs
   `none` = opinion does not entail any option (or is too vague to map).

Reward is binary on the judge's output:

- judge parse failure / truncation → 0;
- reward **1** if `judge_choice == metadata.gold_choice`, else **0**.

Optional: add a light realism term on the student text (3.4) so GRPO cannot
satisfy the judge with steganographic stubs. The judge never receives gradients;
only the student does (via GRPO on the sampled opinions).

Anything the reward needs beyond `input`/`output` lives under `metadata`; Flash
silently drops other top-level keys. Put at least `gold_choice`, question id,
and option texts in `metadata`. Document the judge model id/revision in the env.

This is possible because Flash GRPO only requires that `score_response` return a
scalar: it may call external APIs, load a frozen sidecar, etc. Cost and latency
of the judge call are part of the GRPO spend; preview with `--cost` and keep the
judge small/cheap when possible.

Planner-facing free-text opinions are exactly what the student learns to write.
Novel twin edits still have no MCQ gold; they are evaluated by mechanism tests
and transfer, not by inventing letters.

**5.3 Hard constraint on RL scope.** MCQ reward needs a real chosen option, which
only exists for past survey items (OpinionQA, ANES/CES closed items, similar).
Novel planner hypotheticals have no gold letter. Therefore GRPO trains only on
the survey-MCQ set; novel-policy free-text behavior is measured indirectly
(mechanism tests, calibration transfer, retrodiction on open-ends), never
reward-trained with fake MCQ labels. Hold out entire *questions* / *policies*
(not rows) for eval, or the label leaks and the result is void.

**5.4 Non-negotiable training hygiene.**
- Warm-start GRPO from the SFT adapter. Cold RL on free-text opinions is noise.
- Do **not** put `structured_outputs` on the student GRPO config unless you
  intentionally constrain student prose; structured outputs belong on the
  **judge** call inside `score_response`.
- The judge is frozen (fixed weights / fixed API model). Never co-train it with
  the student. Product opinion_score probe (3.1), if used at serving, is also
  frozen and is separate from the judge.
- Before any GRPO spend: (1) smoke the judge alone on gold human opinions →
  choice accuracy floor; (2) sample student groups and check text diversity
  (near-zero variance → no gradient). A weak judge caps the whole run.

## 6. Data sources and what each one is FOR

Do not treat these as interchangeable. Each validates a different layer.

| Source | Role in the system |
| --- | --- |
| Toronto 3D Massing, TCL, TTC GTFS, zoning, parks (open.toronto.ca) | Twin geometry and network |
| StatCan census (dissemination areas) | Population weighting / persona sampling |
| Toronto Core Service Review 2011 (13k open-ended participants, by topic incl. transit) | **Backtest**: retrodict a real local change |
| Have Your Say Toronto (ongoing + archived consultations) | Additional local backtest material |
| OpinionQA (Santurkar 2023; 1506 Qs, 80k Pew respondents, 60 groups) | **GRPO MCQ** train/eval: profile → choice; also subgroup calibration benchmark |
| ANES / CES (individual demographics + closed items) | **GRPO MCQ** gold choices; open-ends also feed SFT; RF baseline for retrodiction |
| GlobalOpinionQA | Cross-national calibration (optional breadth) |
| DEBATE benchmark (opinion dynamics, before/after opinion text) | **Validate the opinion-propagation GNN** specifically |

Note the OpinionQA finding as a design assumption, not a surprise later:
out-of-the-box persona alignment is substantially off, and prompting a model to
"act like" a group helps only modestly. Calibration is real work, not a prompt.

## 7. Repo layout

```
/data        ingestion of Toronto open data + census; canonical twin inputs
/twin        schema.py, state.py, diff.py, invariants.py  (the compiler)
  /features  exact spatial feature extraction (effect-graph inputs)
/population  sampler.py (census-weighted), persona records
/model
  /sft       SFT dataset builders + configs
  /grpo      environment.py (Flash env: student free-text + frozen MCQ judge reward)
  /scorer    frozen opinion_score probe for free-text serving readout (not GRPO reward)
  serving.py OpenAI-compatible client for the Flash endpoint
/graphs      effect_gnn.py (later), opinion_gnn.py (ablation only)
/agent       tools.py (query/patch/run/snapshot/diff), loop.py
/eval        calibration.py, retrodiction.py, backtest.py, diffusion.py
/web         STUB; teammate owns the UI
```

## 8. Working conventions for the build agent

- **Validation gates are real.** The implementation plan (see
  IMPLEMENTATION_PLAN.md) has go/no-go gates. Do not build layer N+1 before layer
  N passes its gate. Especially: do not wrap the agent/UI before the simulation
  underneath retrodicts a real change (Phase 6 gate).
- **Confirm before side effects.** The Planner Agent's `patch`/`run` mutate
  state; in any live/shared context, surface the diff and confirm irreversible or
  costly actions rather than firing them blind.
- **Never hard-code opinionated city tools.** If you feel the urge, the logic
  belongs in the twin compiler.
- **Keep the product audit trail legible.** Planner-facing outputs are human-
  readable opinions (plus a probe readout). GRPO MCQ choices are a training
  signal, not a substitute for that audit trail at serving.
- **Feature extraction before graphs.** Exact compute first; GNN only when
  latency demands it (effect) or as a validated ablation (opinion).
- **Cite dataset provenance in code comments.** Which dataset, which split, what
  it validates. Splits by *question* / *policy* for MCQ GRPO eval.
- **Cost awareness.** Preview Flash runs with `--cost`; deploy or export runs you
  want to keep (managed checkpoints get garbage-collected ~7 days after last
  activity if never deployed).

## 9. Open questions to resolve with the humans (do not guess)

1. Opinion-graph edge set: spatial adjacency, shared demographics, homophily, or
   learned? This choice IS the social theory; get sign-off before drawing it.
2. GRPO judge: which frozen model (size, API vs local), and when is gold `none`
   vs forcing A–D? Smoke judge accuracy on human gold opinions before spend.
3. Persona granularity: one persona per census cell, or sampled individuals?
   Drives both realism and compute.
4. Which single real Toronto change is the Phase 6 backtest target? Pick one with
   usable before/after opinion data before starting.

## 10. Style

Prose in docs and comments: clear, direct, no dashes as punctuation; use commas,
colons, semicolons; straight quotes. Keep it tight.