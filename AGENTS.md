# AGENTS.md

Working context and conventions for any agent (or human) building **TechTO**.
`TechTO` is a placeholder codename: a population of individual voices producing a
collective sound, where you can still hear each voice. Rename freely; it is not
load-bearing.

Read this file fully before writing code. It encodes decisions that were argued
through deliberately. Do not silently re-litigate them; if you think one is
wrong, say so explicitly and wait.

**Product surface.** The MapLibre dashboard at `/` is the only app front door.
Chat there runs the **Planning Orchestrator** (`src/lib/planner/orchestrator.ts`,
`POST /api/planner/run` or `/api/planner/stream`): a free-form Backboard agent
with twin tools, not a scripted scenario pipeline. The shared Backboard roster
is the **principled city-planning set** (`rosterVersion: principled-11` in
`src/lib/backboard/manifest-schema.ts` and `src/lib/backboard/assistants.ts`):
city-copilot, planning-orchestrator, geospatial-twin, scenario-designer,
citizen-response, equity-impact, feasibility, adversarial-reviewer,
evidence-auditor, final-policy-judge, explanation-map. Niche one-use-case
specialists are forbidden; competence lives in general tools plus the twin.
Supporting transit libs and docs (`src/lib/transit`, `src/lib/techto`,
`docs/techto-implementation.md`) remain for tools and tests; there is no
separate `/techto` UI route. GridTwin is archived under `docs/archive/gridtwin/`.

**Live Backboard only.** There is no `MockBackboardAdapter`, no
`BACKBOARD_MOCK_MODE`, and no planner mock path. `BACKBOARD_API_KEY` is
required. Citizen reactions use live FreeSolo
(`TECHTO_CITIZEN_REACTION_PROVIDER=freesolo`); there is no mock citizen
provider. Open-city population scoring uses a pluggable
`PopulationProvider` (`TECHTO_POPULATION_PROVIDER=synthetic|census`).

**Geographic scope (hard):** City of Toronto only. Fixtures, map actions,
chat assumptions, and every Backboard agent suggestion must stay inside
Toronto (`src/lib/techto/toronto-scope.ts`). Never propose locations,
routes, or policies for other cities or regions.

---

## 1. What this project is

TechTO is a decision-support tool for Toronto city planners. A planner works in
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

**Product shape today (open-city chat).** The Planning Orchestrator is a real
agent with free will over the turn: prose reply, tool calls, `invoke_assistant`,
or any mix. Tools are optional. Do **not** force ScenarioPatches, population
scores, or ranking JSON on every message. Inventing fallback patches like
`Explore: <user text>` to fill a pipeline is a bug. Rankings and acceptance
disclaimers appear only when the agent actually proposed and scored options.
Day-one acceptance remains simulated feel, never ridership (see §2).

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

Training and student serving run on **FreeSolo Flash** (managed LoRA on Qwen).
GRPO **reward judge** calls run on **OpenRouter** (small frozen LM), not on the
student endpoint. Both use the OpenAI-compatible chat API shape.

### 5.0 Live student endpoint (colleagues: start here)

**What this model is for.** The deployed adapter is the **population opinion
writer**: given a persona description plus a policy / survey question (and later
spatial features), it returns a **first-person free-text opinion**. That text is
the planner-facing artifact. It predicts **day-one acceptance / stance voice**,
not ridership, mode choice, or other behavioral consequences (see §2).

**Current SFT deploy (final adapter after ~3 epochs on Qwen3.5-9B):**

| Field | Value |
| --- | --- |
| Flash run id | `flash-1784401342-0d51be72` |
| OpenAI `model` string | `flash-1784401342-0d51be72` |
| Base URL | `https://clado-ai--freesolo-lora-serving.modal.run/v1` |
| Auth | `Authorization: Bearer $FREESOLO_API_KEY` |
| Base weights | `Qwen/Qwen3.5-9B` + our SFT LoRA |
| Train data | ~32k human open-ends (ANES + Toronto Core Service Review 2011 + Polis); see `model/sft/` |

Prompt contract (keep this shape so serving matches training):

```text
PERSONA:
<short first-person background>

QUESTION:
<policy or survey stem>

Write your opinion on this question in first person, in your own voice.
Be concrete. Do not pick a letter A/B/C/D; write prose only.
```

(GRPO student prompts in `model/grpo/prompt.py` use the same idea; SFT used
`model/sft/prompt.py` / persona + policy fields.)

**curl**

```bash
curl -s https://clado-ai--freesolo-lora-serving.modal.run/v1/chat/completions \
  -H "Authorization: Bearer $FREESOLO_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "flash-1784401342-0d51be72",
    "messages": [{"role":"user","content":"PERSONA:\nI am a 65-year-old renter who relies on the TTC.\n\nQUESTION:\nShould the city add a tram on King St and raise parking tax 5% to pay for it?\n\nWrite your opinion in first person. Prose only, no letter choices."}],
    "temperature": 0.7,
    "max_tokens": 256
  }'
```

**Python**

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://clado-ai--freesolo-lora-serving.modal.run/v1",
    api_key=os.environ["FREESOLO_API_KEY"],
)
r = client.chat.completions.create(
    model="flash-1784401342-0d51be72",
    messages=[{"role": "user", "content": "...persona + question..."}],
    temperature=0.7,
    max_tokens=256,
)
print(r.choices[0].message.content)
```

**Ops**

- Deploy final adapter: `flash deploy flash-1784401342-0d51be72`
- Deploy a mid-run checkpoint: `flash deploy flash-1784401342-0d51be72/step-N`
- Status: `flash deployments` / smoke: `flash chat flash-1784401342-0d51be72 -m "..."`
- Tear down when unused: `flash undeploy flash-1784401342-0d51be72` (serving is
  billed per token while the adapter is registered)
- Export to HF if you need a durable copy outside Flash GC:
  `flash export flash-1784401342-0d51be72` (managed checkpoints can be GC'd ~7
  days after last activity if never deployed/exported)

Local client helper: `model/serving.py` (points at `TECHTO_LLM_*` env vars).
Keys live in `.env` / `.env.example`: `FREESOLO_API_KEY`, plus
`OPENROUTER_API_KEY` for the GRPO judge, `WANDB_API_KEY` for Flash `[wandb]`.

**5.1 SFT teaches free-text opinions.** Gold = real human opinion text (Toronto
consultation open-ends, ANES likes/dislikes open-ends). Rows are
`input`/`output`: input = persona + policy + optional spatial features, output =
the human opinion. Teaches voice, plausibility, and the product output contract
(legible first-person text). SFT does **not** use `structured_outputs` (Flash
rejects that key for SFT; SFT never samples). Config: `model/sft/config.toml`;
env id `acmc/persona-env`.

**5.2 GRPO calibrates free-text opinions so a frozen judge recovers the survey
choice.** SFT alone does not fix persona misalignment on multiple-choice surveys
(OpinionQA finding). GRPO trains on rows where a real respondent with a known
profile both (a) can be prompted for an open opinion and (b) has a gold MCQ
option. Config: `model/grpo/config.toml`; env id `acmc/mcq-judge-env`; dataset
`model/grpo/dataset/train.jsonl` (OpinionQA W92, question-holdouts in
`holdout_questions.json`). A/B/C/D are **question-specific option labels**, not
a fixed Likert scale. W&B project: `torontwin-grpo` (metrics include `success`,
`judge_ok`, `empty_or_bad`). Warm-start: `init_from_adapter =
"flash-1784401342-0d51be72"`.

Two different models, do not conflate them:

1. **Student (trained).** Flash GRPO samples free-text opinion rollouts from the
   LoRA we are updating (warm-started from SFT). The student writes a first-person
   opinion conditioned on persona + question/policy context. Student rollouts are
   **not** forced into A/B/C/D; the product artifact stays legible prose.
2. **Judge (frozen, not trained).** Inside `score_response`, call a **separate**
   model that is not in `[train]`: given the student's opinion text plus the MCQ
   stem and options, infer which option that opinion corresponds to
   (`A`/`B`/`C`/`D`/`none`). Prefer **structured outputs** /
   `response_format` on this judge call so parsing is reliable:
   https://freesolo.co/docs/guides/structured-outputs
   `none` = opinion does not entail any option (or is too vague to map).

   **Judge serving (OpenRouter only, not FreeSolo):** reward inference in
   `score_response` uses the same OpenAI-compatible client against
   `https://openrouter.ai/api/v1`. Auth with `OPENROUTER_API_KEY` (declare
   `secrets = ["OPENROUTER_API_KEY"]` so Flash injects it on the worker).
   Pin a **small** instruct model to keep GRPO reward cost low (code default
   `qwen/qwen-2.5-7b-instruct` in `model/grpo/judge.py`, with exponential
   backoff + ignore DeepInfra); never the student LoRA or FreeSolo student
   serving. Prefer `batch_size` × `group_size` that keeps judge QPS sane
   (e.g. 16 prompts × 8 rollouts).

   ```python
   from openai import OpenAI
   client = OpenAI(
       base_url="https://openrouter.ai/api/v1",
       api_key=os.environ["OPENROUTER_API_KEY"],
   )
   r = client.chat.completions.create(
       model="qwen/qwen-2.5-7b-instruct",
       messages=[...],  # opinion + MCQ -> choose A|B|C|D|none
       temperature=0.0,
   )
   ```

Reward is binary on the judge's output:

- judge parse failure / truncation → 0;
- reward **1** if `judge_choice == metadata.gold_choice`, else **0**.

Optional: add a light realism term on the student text (3.4) so GRPO cannot
satisfy the judge with steganographic stubs. The judge never receives gradients;
only the student does (via GRPO on the sampled opinions).

Anything the reward needs beyond `input`/`output` lives under `metadata`; Flash
silently drops other top-level keys. Put at least `gold_choice`, question id,
and option texts in `metadata`.

Flash documents reward-time egress (judge via OpenAI-compatible client +
`secrets`) in the env packaging guide:
https://freesolo.co/docs/guides/environments/package.md
Judge token cost is extra on top of student GRPO Flash GPU time; preview Flash
with `--cost` and keep the judge small (~3–4B class). Flash `--cost` does **not**
include OpenRouter spend.

Offline eval (not inside the Flash train loop): `eval/calibration.py`,
`eval/retrodiction.py`, holdout MCQ questions after deploy. Train-time signal is
reward + W&B only.

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
| City of Toronto Neighbourhood Profiles (StatCan 2021 census, 158-neighbourhood aggregation) | Neighbourhood-level marginal control totals for persona fitting |
| StatCan 2021 Census Individuals PUMF (165,509 real Toronto-CMA individuals) | Individual-level seed with real joint attribute correlations, reweighted per neighbourhood via IPF/raking |
| 2021 Canadian Election Study (CES, Ontario respondents) | Real party ID / left-right ideology, demographically matched onto personas |
| Wikipedia (per-neighbourhood articles, best-effort ~73% coverage) | Light background narrative color for the verbalizer prompt only -- never a new attribute bin |
| Toronto Core Service Review 2011 (13k open-ended participants, by topic incl. transit) | **Backtest**: retrodict a real local change |
| Have Your Say Toronto (ongoing + archived consultations) | Additional local backtest material |
| OpinionQA (Santurkar 2023; 1506 Qs, 80k Pew respondents, 60 groups) | **GRPO MCQ** train/eval: profile → choice; also subgroup calibration benchmark |
| ANES (individual demographics + closed items) | **GRPO MCQ** gold choices; open-ends also feed SFT; RF baseline for retrodiction |
| GlobalOpinionQA | Cross-national calibration (optional breadth) |
| DEBATE benchmark (opinion dynamics, before/after opinion text) | **Validate the opinion-propagation GNN** specifically |

Note the OpinionQA finding as a design assumption, not a surprise later:
out-of-the-box persona alignment is substantially off, and prompting a model to
"act like" a group helps only modestly. Calibration is real work, not a prompt.

### 6.1 Where the citizen/persona data actually lives (2026-07-18)

**Current state of record: flat files under `data/processed/`, not a database.**
The Python population pipeline (`population/sampler.py`, `population/ipf_fit.py`,
`population/persona_text.py`) reads and writes:

- `data/processed/census_profile.csv` -- 158 neighbourhoods, real StatCan
  marginals (age, tenure, income deciles, education, immigration/generation
  status, visible minority, mother tongue, dwelling type, household type).
- `data/processed/pumf_toronto.csv` -- 165,509 real Toronto-CMA individuals
  (StatCan 2021 Census Individuals PUMF), decoded, the joint-correlation seed.
- `data/processed/ces_ontario.csv` -- 7,309 Ontario CES respondents (party
  ID, left-right ideology, demographics), matched onto personas by age/gender.
- `data/processed/neighbourhood_narratives.json` -- best-effort Wikipedia
  extract per neighbourhood code (116/158 matched), context only.
- Generated personas themselves (`population.sampler.Persona` +
  `population.persona_text.render_persona_from_sampler` text) are not yet
  persisted anywhere as a full dataset -- each run regenerates them.

**A MongoDB Atlas structure already exists, but it is a separate, coarser
system, not currently populated with this data.** `citizen_cohorts`
(`src/lib/mongodb/collections.ts`, schema in
`src/lib/citizen-reaction/schemas.ts`) backs the TechTO web app's citizen-
reaction demo. As of this writing it holds 11 hand-authored **synthetic
fixture** cohorts (`src/data/transit/cohorts.ts`, explicitly
`dataMode: "synthetic-fixture"`, its own docstring: "weights are
illustrative, not a Statistics Canada extract") at the aggregate-cohort
level (`ageBand: youth|adult|senior`, `incomeBand: low|middle|high`, a
handful of sensitivity priors) -- not individual-level records, and not
sourced from the census/PUMF/CES pipeline above. Writing the real persona
data into MongoDB means either (a) a new collection for individual persona
records (the two schemas are not compatible -- overwriting `citizen_cohorts`
in place would break its existing consumers, including
`src/lib/backboard/orchestrator.ts` and the FreeSolo citizen-reaction path),
or (b) a lossy aggregation of the individual personas up into the existing
coarse `CitizenCohortDemographics` shape. This is a real open decision, not
yet made -- log it here rather than silently pick one.

## 7. Repo layout

```
/data        ingestion of Toronto open data + census; canonical twin inputs
/twin        schema.py, state.py, diff.py, invariants.py  (the compiler)
  /features  exact spatial feature extraction (effect-graph inputs)
/population  sampler.py (census-weighted), persona records
/model
  /sft       SFT env + dataset + config (persona free-text opinions)
  /grpo      GRPO env: student free-text + OpenRouter MCQ judge reward
             judge.py, prompt.py, dataset/train.jsonl, holdout_questions.json
  /scorer    frozen opinion_score probe for free-text serving readout (not GRPO reward)
  serving.py OpenAI-compatible client helper for FreeSolo / overrides
/graphs      effect_gnn.py (later), opinion_gnn.py (ablation only)
/agent       tools.py (query/patch/run/snapshot/diff), loop.py
/eval        calibration.py, retrodiction.py, smokes; post-hoc holdout MCQ later
/src
  /app       Next.js routes (incl. POST /api/planner/run)
  /components/dashboard  Coolness open-city UI at /
  /components/techto     Shared transit UI pieces (e.g. simulation history views)
  /lib/backboard         live Backboard adapter, principled-11 roster, tools
  /lib/planner           open-city orchestrator, ScenarioPatch twin state
  /lib/population        PopulationProvider (synthetic | census)
  /lib/citizen-reaction  FreeSolo citizen-reaction provider (live only)
```

Flash env publish: `flash env push --name <slug> model/sft` or `model/grpo`
(ids become `acmc/<slug>` for this org).

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
- **Free-form agent turns.** The open-city chat agent answers like Claude Code:
  it may talk, tool-call, or orchestrate. Do not reintroduce forced scenario
  scripts, mock adapters, or per-keyword special cases for phrases like "help".
- **Code analysis tool.** `run_python` (planning-orchestrator, feasibility,
  evidence-auditor, equity-impact) runs short Python via `analysis/agent_exec.py`
  with pandas/numpy/scipy/statsmodels/sklearn and a **read-only** Mongo binding
  (`MONGODB_URI_READONLY` or `MONGODB_URI`). No writes. Fail hard if the runner
  errors.
- **Live providers only.** Do not add Backboard or citizen-reaction mock
  adapters. Fail hard when `BACKBOARD_API_KEY` or FreeSolo credentials are
  missing for paths that need them.
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
2. Persona granularity: one persona per census cell, or sampled individuals?
   Drives both realism and compute.
3. Which single real Toronto change is the Phase 6 backtest target? Pick one with
   usable before/after opinion data before starting.
4. Behavior / consequences readout (commute mode, stated intent vs ridership):
   product wants feel **and** do; AGENTS §2 still forbids presenting LM output as
   equilibrium outcomes. Get sign-off on a parallel behavior-now (census/PUMF)
   and/or twin-feature intent head before training it into the student.

**Resolved (do not re-open without cause):**
- GRPO judge = OpenRouter small LM (`qwen/qwen-2.5-7b-instruct` default in
  `model/grpo/judge.py`), not FreeSolo student serving; student stays free-text;
  MCQ letters are per-question options, not a global Likert.
- Backboard orchestration is live-only; no mock adapter path.
- Open-city roster is principled-11 (not consolidated-16 niche specialists).
- Planning Orchestrator is free-form; no forced ScenarioPatch/score pipeline per turn.

## 10. Style

Prose in docs and comments: clear, direct, no dashes as punctuation; use commas,
colons, semicolons; straight quotes. Keep it tight.