# GridTwin Implementation Specification

> **Repository:** `https://github.com/RohanGottipati/Twin`  
> **Implementation target:** the current `main` branch  
> **Primary demo region:** Ontario, with a simulated grid-scale battery near Toronto  
> **Product category:** AI-optimized grid-scale battery operations and clean-energy decision support  
> **Primary sponsor track:** Deloitte Green AI / AI for Green  
> **Additional sponsor integrations:** FreeSolo, Backboard.io, MongoDB Atlas  
> **Document purpose:** this is the authoritative implementation plan for an AI coding agent or engineering team. It is not a product brainstorm. Follow the phases and gates in order, preserve the current working world UI, and do not declare completion while required tests or acceptance checks are failing.

---

## 0. Mandatory instructions for the implementation agent

Before writing code:

1. Clone or open the current repository.
2. Read the existing `README.md`, `AGENTS.md`, `implementation_plan.md`, `package.json`, `src/components/world/WorldScene.tsx`, `src/components/world/WorldAppShell.tsx`, `src/store/useWorldStore.ts`, `src/lib/cesium/*`, tests, and Playwright configuration.
3. Run the existing baseline:
   ```bash
   npm install
   npm run check
   ```
4. Record the baseline result before changing anything.
5. Preserve all working generic Cesium functionality unless this specification explicitly replaces it.
6. Archive the obsolete ToronTwin population-sentiment documents before replacing them:
   ```text
   docs/archive/torontwin/AGENTS.md
   docs/archive/torontwin/implementation_plan.md
   ```
7. Replace the root `AGENTS.md` with project-specific engineering rules derived from this document.
8. Add this file as the new root `implementation.md`.
9. Do not copy private Atmeto code, models, data, or undisclosed algorithms. This project independently implements the publicly described problem of using machine learning and reinforcement learning to improve grid-battery charge, discharge, and market decisions.
10. Do not connect to a physical battery, submit real electricity-market bids, or represent simulated results as production-grade financial or electrical-engineering claims.
11. All battery actions must remain simulated.
12. LLM or agent output is never the final safety authority. A deterministic validator must reject invalid schedules.
13. Never expose Cesium, MongoDB, Backboard, FreeSolo, or other server credentials in browser code.
14. Never place Cesium objects, database clients, Backboard clients, or FreeSolo clients in Zustand.
15. Use measurable phase gates. Do not build the final agent spectacle before the deterministic simulator and baseline optimizer are correct.

---

# 1. Existing repository assessment

The current repository is already a functioning reusable 3D world explorer built with:

- Next.js App Router
- React 18
- TypeScript
- CesiumJS installed through npm
- Cesium World Terrain
- OpenStreetMap 3D Buildings
- Zustand
- Framer Motion
- Lucide React
- Vitest
- Playwright

The current implementation already includes:

- a client-only Cesium viewer;
- proper local hosting of Cesium workers and assets;
- a global globe view;
- Toronto as the first configured city;
- world-to-city camera transitions;
- city markers;
- 3D building loading and selection;
- responsive overlays;
- layer controls;
- keyboard shortcuts;
- loading and error handling;
- unit tests and an end-to-end smoke test.

This is a strong foundation. **Do not rebuild the world renderer.** Extend it.

The current root package remains the frontend application. Add a separate Python service for simulation, data ingestion, model orchestration, and sponsor integrations.

---

# 2. Product definition

## 2.1 Working name

Use **GridTwin** as the working product name throughout code and UI.

The repository name may remain `Twin`.

## 2.2 One-sentence product definition

GridTwin is a digital control room for grid-scale batteries that simulates, evaluates, and explains when batteries should charge, discharge, reserve capacity, or respond to changing electricity-market and renewable-generation conditions.

## 2.3 Core problem

Wind and solar generation are variable. Grid batteries can shift energy through time, but their value depends on deciding:

- when to charge;
- how much to charge;
- when to discharge;
- how much power to reserve;
- when cycling creates more degradation cost than value;
- how to react to forecast errors;
- how to balance revenue, reliability, and emissions.

Static thresholds and simple schedules do not adapt well to changing prices, demand, renewable output, battery health, or grid events.

GridTwin provides:

1. a deterministic battery digital twin;
2. rule-based and mathematical optimization baselines;
3. a FreeSolo-trained dispatch policy;
4. a Backboard multi-agent grid operations team;
5. a MongoDB Atlas real-time data and memory layer;
6. a Cesium-based global fleet and Ontario control-room interface.

## 2.4 Primary users

- Grid-scale battery asset owners
- Battery asset managers
- Utilities
- Renewable-energy operators
- Energy traders
- Grid operations analysts
- Sustainability and finance leaders
- Researchers evaluating battery-control policies

## 2.5 Hackathon claims that are allowed

The project may claim that it:

- simulates a grid battery;
- tests alternative dispatch schedules;
- uses public Ontario electricity data where available;
- trains a specialized dispatch model;
- evaluates renewable capture, estimated carbon impact, revenue, degradation proxy, and safety constraints;
- coordinates multiple AI agents;
- demonstrates Green AI through model specialization and routing.

## 2.6 Claims that are prohibited

Do not claim that it:

- controls a real battery;
- submits real IESO bids;
- guarantees grid stability;
- produces bankable revenue forecasts;
- computes exact marginal emissions without an approved marginal-emissions dataset;
- models electrochemistry at engineering certification quality;
- is approved for utility operations;
- reproduces Atmeto’s private implementation.

---

# 3. Success criteria

The final demo must show a complete, reproducible flow:

1. The user opens the existing 3D world.
2. The user zooms into Ontario and selects a simulated battery asset.
3. The control room shows:
   - state of charge;
   - current power;
   - market price;
   - demand;
   - wind and solar conditions;
   - active limits;
   - baseline dispatch.
4. The user starts a scenario such as:
   - overnight wind surplus;
   - evening demand peak;
   - 12 percent forecast error;
   - battery power derating.
5. MongoDB stores and streams the new events.
6. A Backboard orchestration run starts.
7. Specialized agents retrieve data and documents, call tools, and challenge the proposed plan.
8. The Dispatch Agent calls the deployed FreeSolo model.
9. The FreeSolo model returns a strict structured schedule.
10. The deterministic validator rejects unsafe or malformed schedules.
11. The battery simulator evaluates valid schedules.
12. The adversarial agent introduces a stress case.
13. The final plan is selected and shown in the UI.
14. The UI compares:
    - rule-based baseline;
    - optimization baseline;
    - base model;
    - FreeSolo SFT;
    - FreeSolo SFT plus GRPO.
15. The final plan has zero hard safety violations.
16. The UI explains the revenue, degradation, clean-energy, and risk trade-offs.
17. The trajectory is saved as a candidate training example.
18. All displayed metrics come from the actual simulator.

---

# 4. System architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend                          │
│                                                                  │
│  Cesium world      Ontario map      Asset control room           │
│  Scenario lab      Agent timeline   Model comparison              │
│  Dispatch charts   Approval panel   Explanation interface         │
└─────────────────────────────┬────────────────────────────────────┘
                              │ HTTPS + SSE
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    FastAPI Grid Core Service                     │
│                                                                  │
│  Asset API          Scenario API       Streaming API              │
│  IESO ingestion     Battery simulator  Safety validator           │
│  Baseline optimizer Backboard runtime FreeSolo client             │
│  Evaluation         Audit service      Training curator           │
└──────────────┬──────────────────┬───────────────────┬─────────────┘
               │                  │                   │
               ▼                  ▼                   ▼
┌────────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│   MongoDB Atlas    │  │   Backboard.io  │  │     FreeSolo      │
│                    │  │                  │  │                   │
│ Documents          │  │ Assistants       │  │ SFT               │
│ Time series        │  │ Threads          │  │ OPD optional      │
│ Vector Search      │  │ Memory           │  │ GRPO              │
│ Atlas Search       │  │ RAG              │  │ Deployment        │
│ Stream Processing  │  │ Tools            │  │ Structured JSON   │
│ Change Streams     │  │ Model routing    │  │ Specialist model  │
│ Triggers           │  │ Streaming        │  │                   │
│ Charts             │  │ Reasoning        │  │                   │
│ Archive/Federation │  │                  │  │                   │
└────────────────────┘  └──────────────────┘  └───────────────────┘
```

---

# 5. Repository layout

Preserve the current frontend and add the following structure.

```text
/
├── AGENTS.md
├── implementation.md
├── README.md
├── package.json
├── package-lock.json
├── next.config.mjs
├── docker-compose.yml
├── Makefile
├── .env.example
├── .gitignore
│
├── docs/
│   ├── architecture/
│   │   ├── system-overview.md
│   │   ├── battery-model.md
│   │   ├── backboard-agents.md
│   │   ├── freesolo-training.md
│   │   ├── mongodb-atlas.md
│   │   └── safety-model.md
│   ├── demo/
│   │   ├── demo-script.md
│   │   └── fallback-plan.md
│   └── archive/
│       └── torontwin/
│           ├── AGENTS.md
│           └── implementation_plan.md
│
├── src/
│   ├── app/
│   │   ├── page.tsx
│   │   ├── control/[assetId]/page.tsx
│   │   ├── lab/page.tsx
│   │   ├── models/page.tsx
│   │   ├── layout.tsx
│   │   ├── error.tsx
│   │   └── globals.css
│   │
│   ├── components/
│   │   ├── world/                         # preserve current components
│   │   ├── navigation/                    # preserve and extend
│   │   ├── panels/                        # preserve and extend
│   │   ├── primitives/                    # preserve
│   │   ├── feedback/                      # preserve
│   │   ├── mobile/                        # preserve
│   │   │
│   │   ├── grid/
│   │   │   ├── GridAppShell.tsx
│   │   │   ├── AssetMarkerLayer.tsx
│   │   │   ├── AssetMarkerOverlay.tsx
│   │   │   ├── AssetDrawer.tsx
│   │   │   ├── AssetStatusHeader.tsx
│   │   │   ├── EnergyFlowPanel.tsx
│   │   │   ├── DispatchTimeline.tsx
│   │   │   ├── StateOfChargeChart.tsx
│   │   │   ├── PriceDispatchChart.tsx
│   │   │   ├── RenewableMixChart.tsx
│   │   │   ├── CarbonImpactCard.tsx
│   │   │   ├── DegradationCard.tsx
│   │   │   ├── ConstraintStatus.tsx
│   │   │   └── LiveTelemetryBar.tsx
│   │   │
│   │   ├── scenarios/
│   │   │   ├── ScenarioLab.tsx
│   │   │   ├── ScenarioTemplateCard.tsx
│   │   │   ├── ScenarioEditor.tsx
│   │   │   ├── ShockControls.tsx
│   │   │   └── ScenarioResults.tsx
│   │   │
│   │   ├── agents/
│   │   │   ├── AgentControlRoom.tsx
│   │   │   ├── AgentRunTimeline.tsx
│   │   │   ├── AgentCard.tsx
│   │   │   ├── ToolCallCard.tsx
│   │   │   ├── ReasoningSummary.tsx
│   │   │   ├── DispatchCandidateCard.tsx
│   │   │   └── OperatorQuestionBox.tsx
│   │   │
│   │   ├── models/
│   │   │   ├── ModelComparisonTable.tsx
│   │   │   ├── RewardBreakdown.tsx
│   │   │   ├── TrainingRunCard.tsx
│   │   │   ├── EvaluationChart.tsx
│   │   │   └── GreenAiMetrics.tsx
│   │   │
│   │   └── approvals/
│   │       ├── DispatchApprovalPanel.tsx
│   │       ├── ApprovalSummary.tsx
│   │       └── SafetyAttestation.tsx
│   │
│   ├── config/
│   │   ├── cities/                        # preserve current registry
│   │   ├── grid/
│   │   │   ├── defaults.ts
│   │   │   ├── metrics.ts
│   │   │   └── scenarios.ts
│   │   └── theme.ts
│   │
│   ├── hooks/
│   │   ├── useGridApi.ts
│   │   ├── useRunEventStream.ts
│   │   ├── useAssetTelemetry.ts
│   │   └── existing hooks
│   │
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts
│   │   │   ├── schemas.ts
│   │   │   └── errors.ts
│   │   ├── cesium/
│   │   │   ├── existing utilities
│   │   │   ├── createBatteryAssetLayer.ts
│   │   │   ├── batteryAssetSelection.ts
│   │   │   └── gridLayerTypes.ts
│   │   ├── charts/
│   │   │   ├── formatters.ts
│   │   │   └── chartTheme.ts
│   │   └── utils/
│   │
│   ├── store/
│   │   ├── useWorldStore.ts               # preserve world-only state
│   │   └── useGridStore.ts                # new operational state
│   │
│   └── types/
│       ├── api.ts
│       ├── grid.ts
│       └── global.d.ts
│
├── services/
│   └── grid-core/
│       ├── pyproject.toml
│       ├── uv.lock or requirements.lock
│       ├── Dockerfile
│       ├── README.md
│       ├── app/
│       │   ├── main.py
│       │   ├── config.py
│       │   ├── logging.py
│       │   ├── dependencies.py
│       │   │
│       │   ├── api/
│       │   │   ├── router.py
│       │   │   ├── health.py
│       │   │   ├── assets.py
│       │   │   ├── market.py
│       │   │   ├── telemetry.py
│       │   │   ├── scenarios.py
│       │   │   ├── dispatch.py
│       │   │   ├── runs.py
│       │   │   ├── models.py
│       │   │   └── admin.py
│       │   │
│       │   ├── schemas/
│       │   │   ├── common.py
│       │   │   ├── assets.py
│       │   │   ├── telemetry.py
│       │   │   ├── market.py
│       │   │   ├── scenarios.py
│       │   │   ├── dispatch.py
│       │   │   ├── runs.py
│       │   │   └── models.py
│       │   │
│       │   ├── db/
│       │   │   ├── client.py
│       │   │   ├── collections.py
│       │   │   ├── repositories/
│       │   │   ├── indexes.py
│       │   │   ├── bootstrap.py
│       │   │   └── migrations.py
│       │   │
│       │   ├── ingestion/
│       │   │   ├── ieso/
│       │   │   │   ├── client.py
│       │   │   │   ├── parsers.py
│       │   │   │   ├── reports.py
│       │   │   │   ├── normalize.py
│       │   │   │   └── fixtures.py
│       │   │   ├── telemetry_generator.py
│       │   │   └── stream_events.py
│       │   │
│       │   ├── simulation/
│       │   │   ├── battery.py
│       │   │   ├── state.py
│       │   │   ├── constraints.py
│       │   │   ├── degradation.py
│       │   │   ├── carbon.py
│       │   │   ├── market.py
│       │   │   ├── engine.py
│       │   │   ├── metrics.py
│       │   │   └── scenarios.py
│       │   │
│       │   ├── optimization/
│       │   │   ├── idle.py
│       │   │   ├── threshold.py
│       │   │   ├── linear_optimizer.py
│       │   │   └── candidate_ranker.py
│       │   │
│       │   ├── safety/
│       │   │   ├── validator.py
│       │   │   ├── policy.py
│       │   │   ├── audit.py
│       │   │   └── exceptions.py
│       │   │
│       │   ├── backboard/
│       │   │   ├── client.py
│       │   │   ├── bootstrap.py
│       │   │   ├── assistants.py
│       │   │   ├── orchestrator.py
│       │   │   ├── tools.py
│       │   │   ├── tool_executor.py
│       │   │   ├── prompts.py
│       │   │   ├── events.py
│       │   │   └── documents.py
│       │   │
│       │   ├── freesolo/
│       │   │   ├── client.py
│       │   │   ├── schemas.py
│       │   │   ├── circuit_breaker.py
│       │   │   └── model_registry.py
│       │   │
│       │   ├── orchestration/
│       │   │   ├── run_manager.py
│       │   │   ├── state_machine.py
│       │   │   ├── candidate_pipeline.py
│       │   │   └── event_bus.py
│       │   │
│       │   ├── evaluation/
│       │   │   ├── benchmark.py
│       │   │   ├── metrics.py
│       │   │   ├── leakage.py
│       │   │   └── reports.py
│       │   │
│       │   └── training/
│       │       ├── curator.py
│       │       ├── dataset_builder.py
│       │       └── provenance.py
│       │
│       ├── scripts/
│       │   ├── bootstrap_atlas.py
│       │   ├── seed_demo.py
│       │   ├── ingest_ieso.py
│       │   ├── create_backboard_assistants.py
│       │   ├── upload_backboard_documents.py
│       │   ├── build_training_dataset.py
│       │   ├── run_benchmark.py
│       │   └── export_demo_snapshot.py
│       │
│       └── tests/
│           ├── unit/
│           ├── integration/
│           ├── contract/
│           └── fixtures/
│
├── training/
│   └── freesolo/
│       ├── README.md
│       ├── environment.py
│       ├── schemas.py
│       ├── simulator_client.py
│       ├── reward.py
│       ├── datasets/
│       │   ├── sft/
│       │   ├── grpo/
│       │   └── evaluation/
│       ├── configs/
│       │   ├── sft.toml
│       │   ├── opd.toml
│       │   └── grpo.toml
│       ├── scripts/
│       │   ├── validate_rows.py
│       │   ├── preview_samples.py
│       │   ├── compare_models.py
│       │   └── deploy_model.py
│       └── tests/
│
├── data/
│   ├── README.md
│   ├── raw/                               # gitignored
│   ├── cache/                             # gitignored
│   ├── normalized/                        # gitignored except demo fixtures
│   └── fixtures/
│       ├── ieso_demo_7d.json
│       ├── battery_demo.json
│       └── scenario_demo.json
│
├── scripts/
│   ├── copy-cesium-assets.mjs             # preserve
│   └── dev-all.mjs
│
├── tests/
│   ├── existing frontend unit tests
│   └── grid frontend unit tests
│
└── e2e/
    ├── world-ui.spec.ts                   # preserve
    └── grid-control-room.spec.ts
```

---

# 6. Technology decisions

## 6.1 Frontend

Keep the current versions unless upgrading is required by a confirmed security issue.

Add:

```bash
npm install @tanstack/react-query zod recharts eventsource-parser
npm install -D concurrently
```

Use:

- TanStack Query for server state;
- Zustand only for transient UI state;
- Zod for runtime validation of API responses;
- Recharts for charts;
- native `EventSource` or `fetch` streaming for SSE.

Do not use Zustand as an API cache.

## 6.2 Backend

Use Python 3.12 and FastAPI.

Recommended `pyproject.toml` dependencies:

```toml
[project]
name = "grid-core"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.116,<1",
  "uvicorn[standard]>=0.35,<1",
  "pydantic>=2.11,<3",
  "pydantic-settings>=2.10,<3",
  "pymongo>=4.13,<5",
  "motor>=3.7,<4",
  "httpx>=0.28,<1",
  "numpy>=2.2,<3",
  "pandas>=2.3,<3",
  "scipy>=1.16,<2",
  "cvxpy>=1.7,<2",
  "openai>=1.90,<2",
  "python-dateutil>=2.9,<3",
  "orjson>=3.10,<4",
  "sse-starlette>=2.3,<3",
  "tenacity>=9,<10",
  "structlog>=25,<26",
]

[project.optional-dependencies]
dev = [
  "pytest>=8.4,<9",
  "pytest-asyncio>=1.0,<2",
  "pytest-cov>=6.2,<7",
  "hypothesis>=6.135,<7",
  "ruff>=0.12,<1",
  "mypy>=1.16,<2",
  "types-python-dateutil>=2.9,<3",
]
```

Lock dependencies after installation.

## 6.3 Why a Python service

Python is appropriate for:

- numerical simulation;
- optimization;
- dataset generation;
- FreeSolo environment reuse;
- data processing;
- scientific tests.

The Next.js frontend remains focused on visualization and user interaction.

---

# 7. Environment variables

Update `.env.example`.

```env
# Frontend
NEXT_PUBLIC_CESIUM_ION_TOKEN=
NEXT_PUBLIC_GRID_API_BASE_URL=http://localhost:8000

# Backend
GRID_ENV=development
GRID_LOG_LEVEL=INFO
GRID_ALLOWED_ORIGINS=http://localhost:3000
GRID_DEMO_MODE=true
GRID_USE_SEEDED_DATA=true

# MongoDB Atlas
MONGODB_URI=
MONGODB_DATABASE=gridtwin
MONGODB_VECTOR_INDEX=operational_memory_vector
MONGODB_SEARCH_INDEX=operational_search
MONGODB_STREAM_WORKSPACE=
MONGODB_STREAM_PROCESSOR=

# Backboard
BACKBOARD_API_KEY=
BACKBOARD_API_BASE_URL=https://app.backboard.io/api
BACKBOARD_ORCHESTRATOR_ASSISTANT_ID=
BACKBOARD_OPERATOR_ASSISTANT_ID=
BACKBOARD_EXECUTIVE_ASSISTANT_ID=
BACKBOARD_TRAINING_ASSISTANT_ID=

# FreeSolo
FREESOLO_API_KEY=
FREESOLO_BASE_URL=
FREESOLO_MODEL_ALIAS=gridtwin-dispatch
FREESOLO_MODEL_REVISION=
FREESOLO_TIMEOUT_SECONDS=30

# Optional data configuration
IESO_DATA_CACHE_DIR=../../data/cache/ieso
IESO_ALLOW_NETWORK_FETCH=false

# Demo behavior
DEMO_ASSET_ID=ontario-bess-01
DEMO_SEED=20260718
DEMO_INTERVAL_MINUTES=60
DEMO_HORIZON_INTERVALS=24
```

Rules:

- Never prefix backend secrets with `NEXT_PUBLIC_`.
- Fail fast in non-demo production mode when required secrets are missing.
- In demo mode, allow mock Backboard and mock FreeSolo providers only when explicitly selected.
- Display a visible “Mock orchestration” or “Mock model” label if a sponsor integration is not live.

---

# 8. Domain model

## 8.1 Simulated battery asset

Seed one transparent demo asset:

```json
{
  "asset_id": "ontario-bess-01",
  "name": "Ontario Grid Battery 01",
  "status": "available",
  "location": {
    "type": "Point",
    "coordinates": [-79.55, 43.69]
  },
  "market": "IESO",
  "rated_power_mw": 100,
  "energy_capacity_mwh": 400,
  "minimum_soc": 0.10,
  "maximum_soc": 0.90,
  "initial_soc": 0.50,
  "charge_efficiency": 0.948683298,
  "discharge_efficiency": 0.948683298,
  "maximum_ramp_mw_per_interval": 50,
  "minimum_temperature_c": -20,
  "maximum_temperature_c": 45,
  "warning_temperature_c": 34,
  "reserve_requirement_mw": 20,
  "demo_only": true
}
```

The split efficiencies multiply to approximately 90 percent round-trip efficiency.

All UI labels must say **Simulated Asset**.

## 8.2 Dispatch interval

```python
from datetime import datetime
from pydantic import BaseModel, Field, model_validator

class DispatchInterval(BaseModel):
    timestamp: datetime
    charge_mw: float = Field(ge=0)
    discharge_mw: float = Field(ge=0)
    reserve_mw: float = Field(ge=0)
    rationale: str = Field(min_length=1, max_length=500)
    confidence: float = Field(ge=0, le=1)

    @model_validator(mode="after")
    def cannot_charge_and_discharge(self):
        if self.charge_mw > 1e-9 and self.discharge_mw > 1e-9:
            raise ValueError("An interval cannot charge and discharge simultaneously")
        return self
```

## 8.3 Dispatch plan

```python
class DispatchPlan(BaseModel):
    schema_version: str = "1.0"
    asset_id: str
    horizon_start: datetime
    interval_minutes: int = Field(gt=0)
    intervals: list[DispatchInterval]
    strategy: str
    model_id: str | None = None
    model_revision: str | None = None
    assumptions: list[str] = []
    warnings: list[str] = []
```

## 8.4 Simulation result

```python
class ConstraintViolation(BaseModel):
    code: str
    interval_index: int | None
    message: str
    severity: str

class SimulationMetrics(BaseModel):
    gross_revenue_cad: float
    energy_purchase_cost_cad: float
    energy_sale_revenue_cad: float
    reserve_revenue_cad: float
    degradation_cost_cad: float
    net_value_cad: float
    renewable_energy_captured_mwh: float
    estimated_carbon_avoided_kg: float
    total_charge_mwh: float
    total_discharge_mwh: float
    equivalent_full_cycles: float
    peak_discharge_mw: float
    ending_soc: float
    missed_commitments: int
    safety_violation_count: int

class SimulationResult(BaseModel):
    valid: bool
    state_series: list[dict]
    metrics: SimulationMetrics
    violations: list[ConstraintViolation]
    reward_components: dict[str, float]
    total_reward: float
```

---

# 9. Battery digital twin

## 9.1 Time resolution

For the hackathon path:

- default interval: 60 minutes;
- default horizon: 24 intervals;
- support 5, 15, 30, and 60 minute intervals in schemas;
- only optimize 60-minute demo data until tests pass.

Do not overstate hourly simulation as market-settlement fidelity.

## 9.2 State transition

For an interval of duration `dt_hours`:

```python
charged_mwh = charge_mw * dt_hours * charge_efficiency
discharged_from_pack_mwh = (
    discharge_mw * dt_hours / discharge_efficiency
)

next_energy_mwh = (
    current_energy_mwh
    + charged_mwh
    - discharged_from_pack_mwh
)

next_soc = next_energy_mwh / energy_capacity_mwh
```

## 9.3 Required constraints

Reject a plan if any interval violates:

- simultaneous charge and discharge;
- charge power limit;
- discharge power limit;
- minimum SOC;
- maximum SOC;
- reserve headroom;
- temperature-adjusted power;
- ramp limit;
- interval count;
- duplicated or unsorted timestamps;
- horizon mismatch;
- NaN or infinite values;
- unsupported negative reserve;
- malformed rationale;
- unavailable asset status.

## 9.4 Temperature derating

Use a clear demo approximation:

```python
def power_derating_factor(
    temperature_c: float,
    warning_temperature_c: float,
    maximum_temperature_c: float,
) -> float:
    if temperature_c <= warning_temperature_c:
        return 1.0
    if temperature_c >= maximum_temperature_c:
        return 0.0

    span = maximum_temperature_c - warning_temperature_c
    return 1.0 - (
        (temperature_c - warning_temperature_c) / span
    )
```

Label this as a simplified thermal constraint, not an electrochemical model.

## 9.5 Reserve headroom

For upward reserve:

```python
available_discharge_headroom_mw = (
    derated_discharge_limit_mw - discharge_mw
)
```

Require:

```python
reserve_mw <= available_discharge_headroom_mw
```

Also require enough stored energy to sustain the configured reserve duration.

## 9.6 Degradation proxy

Implement an explainable demo proxy:

```text
degradation cost =
  energy throughput cost
+ high-SOC dwell penalty
+ low-SOC dwell penalty
+ temperature penalty
+ aggressive ramp penalty
```

Configuration:

```python
class DegradationConfig(BaseModel):
    throughput_cost_cad_per_mwh: float = 4.0
    high_soc_threshold: float = 0.85
    high_soc_cost_cad_per_mwh_hour: float = 0.5
    low_soc_threshold: float = 0.15
    low_soc_cost_cad_per_mwh_hour: float = 0.5
    hot_temperature_threshold_c: float = 34
    hot_temperature_cost_cad_per_degree_hour: float = 10
    ramp_cost_cad_per_mw_change: float = 0.02
```

Store the degradation method and coefficients in each simulation result.

## 9.7 Revenue proxy

```python
energy_purchase_cost = sum(
    charge_mw * dt_hours * price_cad_per_mwh
)

energy_sale_revenue = sum(
    discharge_mw * dt_hours * price_cad_per_mwh
)

reserve_revenue = sum(
    reserve_mw * dt_hours * reserve_price_cad_per_mw_h
)

gross_revenue = energy_sale_revenue + reserve_revenue
net_value = gross_revenue - energy_purchase_cost - degradation_cost
```

## 9.8 Renewable capture

For each interval:

```python
capturable_surplus_mwh = max(
    renewable_available_mwh - renewable_consumed_mwh,
    0,
)

renewable_energy_captured_mwh += min(
    grid_charge_mwh,
    capturable_surplus_mwh,
)
```

If real curtailment data is unavailable, use a synthetic renewable-surplus field and label it.

## 9.9 Estimated carbon impact

Use a configurable `marginal_emissions_kg_per_mwh` series.

```python
charge_emissions = charge_mwh * emissions_intensity
avoided_discharge_emissions = (
    discharge_mwh * displaced_emissions_intensity
)

estimated_carbon_avoided = (
    avoided_discharge_emissions - charge_emissions
)
```

The UI must say **Estimated carbon impact**.

---

# 10. Baseline strategies

Every trained model must be compared against deterministic baselines.

## 10.1 Idle baseline

- no charging;
- no discharging;
- preserve the initial SOC.

## 10.2 Threshold baseline

Configuration:

```python
class ThresholdStrategyConfig(BaseModel):
    charge_price_quantile: float = 0.25
    discharge_price_quantile: float = 0.75
    target_charge_mw: float = 50
    target_discharge_mw: float = 75
    reserve_mw: float = 20
```

Rules:

- charge when price is below the lower quantile and renewable surplus is positive;
- discharge when price is above the upper quantile;
- preserve reserve;
- safety validator remains active.

## 10.3 Linear optimization baseline

Use CVXPY to optimize the same horizon.

Objective:

```text
maximize:
  energy sale revenue
+ reserve revenue
+ renewable capture value
+ estimated carbon value
- charging cost
- degradation throughput proxy
```

Subject to:

- SOC transition;
- SOC bounds;
- power bounds;
- reserve headroom;
- energy requirement for reserve;
- ramp constraints.

A mixed-integer formulation is optional. For the initial baseline, use one signed power variable or separate charge/discharge variables with a small simultaneous-flow penalty, then verify no simultaneous charging/discharging in the result. If simultaneous behavior remains, add a binary mode variable and use an available mixed-integer solver.

This optimizer acts as:

- a baseline;
- a teacher for SFT data;
- a debugging oracle for toy scenarios;
- not the production truth.

## 10.4 Evaluation order

Every scenario report must include:

1. idle;
2. threshold;
3. linear optimizer;
4. untrained or base LLM;
5. FreeSolo SFT;
6. FreeSolo SFT plus GRPO;
7. OPD model only if completed and valid.

---

# 11. Scenario engine

Create reusable scenario templates.

## 11.1 Normal day

- ordinary demand curve;
- ordinary price curve;
- moderate renewable output;
- nominal battery temperature.

## 11.2 Overnight wind surplus

- high wind output from 01:00 to 05:00;
- low or negative prices;
- evening peak.

## 11.3 Forecast error

- planned demand is increased by 12 percent after schedule generation;
- rerun stress evaluation without giving the original model future truth.

## 11.4 Battery derating

- reduce discharge capability by 30 percent during the peak;
- preserve valid operation.

## 11.5 Price spike

- introduce one extreme peak interval;
- test whether model overcycles or breaks reserve.

## 11.6 Renewable forecast miss

- predicted wind surplus is only 50 percent realized.

## 11.7 Combined adversarial scenario

- wind miss;
- peak demand increase;
- 30 percent power derating.

The adversarial scenario should be the final demo stress test.

---

# 12. Ontario and IESO data ingestion

## 12.1 Data sources

Use official public reports where practical, including:

- Ontario demand;
- market demand;
- day-ahead Ontario zonal price;
- generator output and capability;
- variable-generation forecasts;
- operating-reserve requirements;
- market price reports.

## 12.2 Reproducibility rule

Live public endpoints can change or fail. Therefore:

- cache every downloaded raw file;
- store retrieval timestamp and source URL;
- include a committed seven-day normalized demo fixture;
- use the fixture by default;
- allow live ingestion through an explicit admin command;
- never make the judged demo depend on a live external data endpoint.

## 12.3 Ingestion stages

```text
download
→ checksum
→ persist raw metadata
→ parse
→ normalize timestamps
→ validate units
→ deduplicate
→ store raw event
→ stream into Atlas
→ materialize latest market state
```

## 12.4 Normalized market interval

```python
class MarketInterval(BaseModel):
    timestamp: datetime
    market: str = "IESO"
    price_cad_per_mwh: float
    demand_mw: float
    wind_output_mw: float
    solar_output_mw: float
    wind_forecast_mw: float | None
    solar_forecast_mw: float | None
    reserve_requirement_mw: float | None
    reserve_price_cad_per_mw_h: float = 0
    marginal_emissions_kg_per_mwh: float | None
    synthetic_fields: list[str] = []
    source_refs: list[str]
```

## 12.5 Parser tests

Create fixtures for:

- valid CSV;
- valid XML;
- missing values;
- duplicated timestamps;
- changed column order;
- daylight-saving transition;
- malformed report;
- unexpected units.

---

# 13. MongoDB Atlas architecture

MongoDB Atlas is not an accessory. It is the operational and historical data plane.

## 13.1 Database

Default database:

```text
gridtwin
```

## 13.2 Collections

### Operational collections

```text
organizations
users
battery_assets
market_locations
latest_asset_state
latest_market_state
dispatch_plans
dispatch_executions
market_bids
scenarios
scenario_runs
simulation_runs
agent_runs
agent_events
tool_calls
incidents
training_examples
model_versions
evaluations
documents
document_chunks
audit_events
raw_ingest_events
stream_dead_letters
```

### Time-series collections

```text
telemetry_ts
market_ticks_ts
forecasts_ts
simulation_state_ts
```

## 13.3 Time-series setup

```python
database.create_collection(
    "telemetry_ts",
    timeseries={
        "timeField": "timestamp",
        "metaField": "metadata",
        "granularity": "seconds",
    },
)

database.create_collection(
    "market_ticks_ts",
    timeseries={
        "timeField": "timestamp",
        "metaField": "metadata",
        "granularity": "minutes",
    },
)

database.create_collection(
    "forecasts_ts",
    timeseries={
        "timeField": "timestamp",
        "metaField": "metadata",
        "granularity": "hours",
    },
)
```

The bootstrap script must check for existing collections before creation.

## 13.4 Geospatial indexes

```python
await db.battery_assets.create_index(
    [("location", "2dsphere")]
)

await db.market_locations.create_index(
    [("location", "2dsphere")]
)
```

## 13.5 Operational indexes

Create:

```text
battery_assets:
  unique asset_id
  organization_id + status
  location 2dsphere

latest_asset_state:
  unique asset_id
  updated_at descending

dispatch_plans:
  plan_id unique
  asset_id + created_at descending
  run_id
  status + created_at descending
  model_version_id

scenario_runs:
  run_id unique
  asset_id + created_at descending
  status + updated_at descending

agent_events:
  run_id + sequence unique
  run_id + created_at

training_examples:
  example_id unique
  split + scenario_type
  source_run_id
  eligible_for_training + created_at

model_versions:
  model_version_id unique
  alias + active
  training_method + created_at

audit_events:
  event_id unique
  entity_type + entity_id + created_at
```

## 13.6 TTL indexes

Use TTL only for ephemeral records:

- temporary approval tokens;
- agent scratch state;
- transient cached forecasts;
- unused draft plans;
- development stream events.

Do not apply TTL to:

- final dispatch plans;
- incidents;
- audit events;
- model versions;
- evaluations;
- approved training examples.

## 13.7 Atlas Search

Create a search index over:

- incidents;
- audit summaries;
- operator notes;
- document chunks;
- agent event summaries.

Fields:

```text
title
summary
description
alarm_codes
asset_id
market
model_alias
policy_tags
source_name
```

## 13.8 Vector Search

Embed and index:

- historical market-state summaries;
- dispatch-plan summaries;
- incident summaries;
- operator notes;
- successful trajectories;
- failed trajectories;
- market-rule chunks;
- battery manuals.

Vector document:

```json
{
  "memory_id": "memory-...",
  "kind": "dispatch_trajectory",
  "asset_id": "ontario-bess-01",
  "text": "High wind, low price, evening peak...",
  "embedding": [0.01, -0.02],
  "metadata": {
    "scenario_type": "overnight_wind",
    "outcome": "safe",
    "model_version_id": "..."
  }
}
```

Filter retrieval by:

- organization;
- asset;
- market;
- memory kind;
- approved status.

## 13.9 Atlas Stream Processing

### Development source

Write incoming synthetic and ingested events to:

```text
raw_ingest_events
```

Configure Atlas Stream Processing to read the collection change stream.

### Processing pipeline

```text
$source
→ validate required fields
→ normalize timestamps and numeric values
→ enrich with asset metadata
→ branch by event type
→ write telemetry to telemetry_ts
→ write market values to market_ticks_ts
→ update latest_asset_state/latest_market_state
→ write invalid records to stream_dead_letters
```

Use checkpoints and monitor processor state.

### Important rule

Do not use database triggers on time-series collections. Important state changes must be materialized into normal collections such as:

- `latest_asset_state`;
- `latest_market_state`;
- `incidents`;
- `dispatch_plans`.

Change Streams and Triggers operate on those normal collections.

## 13.10 Change Streams

Backend watchers:

```text
latest_asset_state change
→ push UI state update

latest_market_state change
→ push UI state update

scenario_runs insert
→ start orchestration when requested

dispatch_plans approved
→ create simulated execution

incidents insert
→ start incident-response workflow

model_versions active flag change
→ refresh model registry
```

## 13.11 Transactions

Dispatch approval transaction:

1. verify plan is still valid and pending;
2. update plan to approved;
3. create simulated execution order;
4. create audit event;
5. append approval event;
6. commit.

If any operation fails, abort.

## 13.12 Atlas Triggers

Use scheduled or database triggers for:

- expired draft cleanup;
- daily evaluation summaries;
- training-example eligibility checks;
- stale forecast detection;
- archive eligibility;
- demo snapshot refresh.

## 13.13 Atlas Charts

Create charts for:

- SOC over time;
- price versus charge/discharge;
- renewable energy captured;
- net value;
- estimated carbon impact;
- model safety violations;
- model reward;
- agent latency;
- scenario outcome comparison.

Embed only the charts that improve the product. Custom frontend charts remain primary.

## 13.14 Data Federation and Online Archive

Stretch but planned:

- archive old raw market ticks;
- archive full agent traces;
- archive model rollouts;
- query operational and archived data through Data Federation;
- export evaluation snapshots to object storage.

## 13.15 Seed and verification

`bootstrap_atlas.py` must:

1. connect;
2. create collections;
3. create indexes;
4. insert version record;
5. run test writes;
6. verify search/vector index configuration where API access permits;
7. print actionable manual setup steps for UI-only Atlas features.

---

# 14. Backboard architecture

Backboard is the intelligent control-room layer.

It does not replace the numerical simulator or safety validator.

## 14.1 Backboard responsibilities

Use Backboard for:

- assistant profiles;
- persistent threads;
- multi-agent workflow state;
- RAG over stable documents;
- persistent asset knowledge;
- model routing;
- parallel tool calls;
- chained tool calls;
- reasoning for unusual conditions;
- streaming agent progress;
- operator explanations;
- training curation.

## 14.2 Assistant roster

### A. Grid Orchestrator

Owns the run.

Responsibilities:

- gather scenario objective;
- request parallel analyses;
- call dispatch specialist;
- request simulation;
- request adversarial stress test;
- compare candidates;
- produce final recommendation.

### B. Market Price Analyst

Analyzes:

- current and forecast prices;
- unusual price intervals;
- uncertainty;
- arbitrage opportunity.

### C. Demand Forecast Analyst

Analyzes:

- system demand;
- peak timing;
- forecast changes;
- uncertainty.

### D. Renewable Forecast Analyst

Analyzes:

- wind and solar output;
- renewable surplus;
- forecast error.

### E. Battery State Analyst

Analyzes:

- SOC;
- available energy;
- power capability;
- temperature;
- health;
- telemetry quality.

### F. Degradation Analyst

Estimates:

- throughput cost;
- high/low SOC dwell cost;
- thermal stress;
- aggressive ramps.

### G. Grid Services Analyst

Evaluates:

- reserve;
- regulation;
- energy market opportunity;
- capacity preservation.

### H. Carbon Analyst

Evaluates:

- renewable capture;
- estimated charge emissions;
- estimated displaced emissions;
- carbon trade-off.

### I. Market Rules Analyst

Uses RAG over:

- market rules;
- battery specifications;
- operating procedures;
- warranty constraints.

### J. Dispatch Specialist

Calls the FreeSolo `DispatchLM` tool.

Does not directly approve its output.

### K. Deterministic Constraint Reviewer

Calls the hard validator.

Returns machine evidence, not opinion.

### L. Risk Analyst

Evaluates:

- forecast uncertainty;
- downside;
- incomplete telemetry;
- missed commitment risk.

### M. Scenario Generator

Creates controlled scenario variations.

### N. Adversarial Stress Tester

Injects:

- forecast miss;
- price shock;
- derating;
- delayed telemetry;
- unexpected demand.

### O. Portfolio Coordinator

Optional for one-asset demo, but implement assistant definition and disabled UI state for future multi-asset coordination.

### P. Incident Response Agent

Handles:

- invalid telemetry;
- plan execution mismatch;
- thermal alarm;
- model failure;
- constraint violation.

### Q. Operator Explanation Agent

Explains decisions to technical operators with citations to:

- telemetry;
- simulation;
- rules;
- asset memory.

### R. Executive Summary Agent

Explains:

- expected value;
- sustainability benefit;
- risk;
- model comparison.

### S. Training Curator Agent

Classifies completed trajectories as:

- accepted;
- rejected;
- adversarial;
- ambiguous;
- eligible for SFT;
- eligible for GRPO;
- evaluation-only.

## 14.3 Assistant grouping

Do not force every specialist to have a separate user-visible chat.

Use:

- one Grid Orchestrator assistant;
- one Operator Explanation assistant;
- one Executive assistant;
- one Training Curator assistant;
- specialist roles implemented through orchestrator instructions and tool-mediated sub-runs where practical.

If separate assistant profiles improve Backboard judging visibility, create them, but avoid unnecessary latency.

## 14.4 Thread model

Create:

```text
one orchestration thread per scenario run
one incident thread per incident
one operator thread per asset
one executive thread per asset portfolio
one training-curation thread per dataset batch
```

Store Backboard IDs in MongoDB.

## 14.5 Memory policy

Operational safety rule:

- Use read-only or disabled automatic memory during live dispatch generation.
- Add durable memory only after curation.
- Never allow an unverified model statement to become permanent asset memory automatically.

Examples of approved memory:

- asset has a thermal warning threshold of 34°C;
- owner requires 20 MW reserve;
- warranty limits SOC to 10–90 percent;
- a previous scenario failed because of forecast overconfidence.

## 14.6 RAG documents

Upload:

- demo battery specification;
- demo operating policy;
- demo warranty constraints;
- IESO public market guides relevant to the demo;
- system safety policy;
- simulation methodology;
- scenario definitions.

Backboard RAG is for stable reference documents.

MongoDB Vector Search is for dynamic operational history.

## 14.7 Tool definitions

Implement OpenAI-style tools.

### `get_asset_state`

```json
{
  "type": "function",
  "function": {
    "name": "get_asset_state",
    "description": "Return validated current state for a simulated battery asset.",
    "parameters": {
      "type": "object",
      "properties": {
        "asset_id": {"type": "string"}
      },
      "required": ["asset_id"],
      "additionalProperties": false
    }
  }
}
```

### `get_market_window`

Parameters:

- market;
- horizon start;
- interval count;
- interval minutes;
- scenario run ID.

### `get_renewable_forecast`

Return wind and solar forecast with provenance and synthetic flags.

### `get_similar_operating_history`

Use MongoDB Vector Search.

### `get_market_rules`

Use Backboard RAG and return citations.

### `calculate_degradation`

Call deterministic degradation service.

### `calculate_carbon_impact`

Call deterministic carbon service.

### `call_freesolo_dispatch`

Call FreeSolo specialist through backend.

### `validate_dispatch_plan`

Call deterministic validator.

### `simulate_dispatch_plan`

Run digital twin.

### `stress_test_plan`

Run configured adversarial scenarios.

### `compare_candidates`

Return normalized metrics and dominance comparison.

### `persist_candidate`

Persist model and simulation provenance.

### `approve_simulated_plan`

Create simulated approval only.

### `create_training_example`

Create pending training record.

## 14.8 Parallel tool execution

When Backboard requests independent tools in one turn, execute them concurrently:

- market data;
- demand forecast;
- renewable forecast;
- battery state;
- rules;
- historical analogs.

Then submit all tool results.

## 14.9 Chained calls

Continue the Backboard loop until:

- final structured response;
- explicit failure;
- maximum tool rounds reached;
- cancellation requested.

Default maximum rounds:

```text
8
```

## 14.10 Backboard state machine

```text
CREATED
→ GATHERING_CONTEXT
→ SPECIALIST_ANALYSIS
→ DISPATCH_GENERATION
→ HARD_VALIDATION
→ SIMULATION
→ ADVERSARIAL_REVIEW
→ CANDIDATE_SELECTION
→ EXPLANATION
→ AWAITING_APPROVAL
→ APPROVED_SIMULATION
→ COMPLETED

Failure branches:
→ BLOCKED
→ FAILED
→ CANCELLED
```

## 14.11 Backboard output contract

Final orchestration response:

```json
{
  "run_id": "run-...",
  "recommended_plan_id": "plan-...",
  "decision": "recommend_for_simulated_approval",
  "summary": "Charge during wind surplus and preserve 20 MW...",
  "key_reasons": [],
  "key_risks": [],
  "rejected_candidate_ids": [],
  "required_operator_actions": [],
  "confidence": 0.88
}
```

## 14.12 Streaming

Convert Backboard and internal events into frontend-safe events:

```text
run.created
agent.started
agent.completed
tool.requested
tool.completed
candidate.created
candidate.rejected
simulation.completed
stress_test.completed
recommendation.ready
approval.required
run.completed
run.failed
```

Never stream private chain-of-thought. Stream concise reasoning summaries, evidence, and actions.

---

# 15. FreeSolo architecture

FreeSolo is the post-training and deployment layer for the specialized dispatch model.

## 15.1 Flagship model

Name:

```text
DispatchLM
```

Input:

- asset state;
- market window;
- renewable forecast;
- demand forecast;
- reserve requirements;
- constraints;
- similar historical scenarios;
- objective weights.

Output:

- strict `DispatchPlan`.

## 15.2 Why an LLM specialist is used

The trained model is not replacing physics or optimization.

It learns to:

- interpret heterogeneous operational context;
- choose tool calls;
- generalize across unusual combinations;
- generate candidate schedules;
- explain trade-offs;
- propose robust alternatives.

All candidates remain validated and simulated.

## 15.3 Structured output schema

FreeSolo serving must require JSON schema output equivalent to `DispatchPlan`.

Reject:

- prose outside JSON;
- missing intervals;
- unknown fields;
- invalid timestamp count;
- non-finite values;
- simultaneous charge/discharge.

## 15.4 SFT dataset

Generate examples from:

- linear optimizer solutions;
- threshold strategy for simple cases;
- manually reviewed scenarios;
- successful historical synthetic trajectories;
- teacher-model tool-use traces.

Each row must include provenance.

Example conceptual row:

```json
{
  "input": {
    "messages": [
      {
        "role": "system",
        "content": "You are DispatchLM..."
      },
      {
        "role": "user",
        "content": "{...validated scenario JSON...}"
      }
    ]
  },
  "output": {
    "messages": [
      {
        "role": "assistant",
        "content": "{...validated DispatchPlan JSON...}"
      }
    ]
  },
  "metadata": {
    "scenario_id": "scenario-...",
    "teacher": "cvxpy-linear-optimizer",
    "split": "train",
    "simulator_version": "1.0.0",
    "safety_validated": true
  }
}
```

Adapt exact row shape to the current FreeSolo environment API and validate locally.

## 15.5 Train/evaluation split

Prevent leakage:

- split by contiguous dates;
- hold out entire scenario seeds;
- hold out combined adversarial templates;
- do not randomly split intervals from the same day across train and test.

Suggested:

```text
70 percent training dates
15 percent validation dates
15 percent held-out dates

plus a separately held-out adversarial suite
```

## 15.6 SFT target

SFT must achieve:

- at least 99 percent valid JSON;
- zero schema violations after retry wrapper;
- at least 95 percent hard-valid plans on simple held-out scenarios;
- better reward than idle baseline;
- no worse than threshold baseline on most simple scenarios.

These are project gates, not universal model claims.

## 15.7 OPD

Optional but encouraged:

- warm-start from SFT;
- use a stronger teacher on difficult scenarios;
- focus on:
  - uncertainty;
  - tool selection;
  - reserve trade-offs;
  - derating;
  - conflicting objectives.

Do not delay GRPO if OPD is unstable.

## 15.8 GRPO environment

The GRPO reward must run the actual deterministic simulator.

### Reward components

Normalize every non-binary metric before weighting.

```python
reward = (
    2.0 * revenue_score
    + 2.5 * renewable_capture_score
    + 1.5 * carbon_score
    + 1.0 * grid_service_score
    + 1.0 * robustness_score
    - 1.5 * degradation_score
    - 2.0 * unnecessary_cycling_score
    - 5.0 * missed_commitment_score
    - 8.0 * safety_violation_score
    - 2.0 * malformed_output_score
)
```

Hard rules:

```text
Any hard constraint violation:
  total reward cannot exceed -5

Malformed or unparsable output:
  reward = -10

Valid schedule that safely completes task:
  eligible for positive reward
```

### Robustness score

Evaluate each rollout under:

- base forecast;
- moderate demand error;
- renewable miss;
- mild derating.

Do not reveal hidden stress values in the prompt.

## 15.9 GRPO environment skeleton

```python
def score_response(
    response: str,
    row: dict,
) -> float:
    try:
        plan = DispatchPlan.model_validate_json(response)
    except Exception:
        return -10.0

    scenario = load_scenario_from_metadata(row["metadata"])
    base_result = simulator.run(plan, scenario.base)

    if not base_result.valid:
        return min(-5.0, base_result.total_reward)

    stress_results = [
        simulator.run(plan, stress)
        for stress in scenario.hidden_stresses
    ]

    return compute_grpo_reward(
        base_result=base_result,
        stress_results=stress_results,
        objective_weights=scenario.objective_weights,
    )
```

The training environment must run deterministically for a fixed seed.

## 15.10 Cost and run discipline

Before every FreeSolo run:

```bash
flash train training/freesolo/configs/sft.toml --cost
```

or the equivalent current command.

Record:

- base model;
- adapter source;
- dataset checksum;
- config checksum;
- simulator version;
- training method;
- run ID;
- estimated cost;
- actual duration;
- deployment alias;
- immutable revision.

## 15.11 Deployment

Deploy using a stable alias:

```text
gridtwin-dispatch
```

Backend config may pin an immutable revision for the judged demo.

## 15.12 FreeSolo client

Use the OpenAI client against the FreeSolo endpoint.

```python
from openai import AsyncOpenAI

client = AsyncOpenAI(
    api_key=settings.freesolo_api_key,
    base_url=settings.freesolo_base_url,
    timeout=settings.freesolo_timeout_seconds,
)
```

Use:

- retries;
- timeout;
- circuit breaker;
- strict response parsing;
- model revision logging;
- token and latency metrics.

## 15.13 Fallback hierarchy

```text
active FreeSolo revision
→ previous healthy FreeSolo revision
→ CVXPY optimizer
→ threshold baseline
→ no simulated plan
```

Never bypass the validator.

---

# 16. Orchestration pipeline

## 16.1 Start run

`POST /v1/dispatch/plan`

Request:

```json
{
  "asset_id": "ontario-bess-01",
  "scenario_id": "overnight-wind",
  "objective_weights": {
    "net_value": 0.30,
    "renewable_capture": 0.25,
    "estimated_carbon": 0.15,
    "grid_services": 0.10,
    "degradation": 0.10,
    "robustness": 0.10
  },
  "model_candidates": [
    "threshold",
    "linear-optimizer",
    "freesolo-sft",
    "freesolo-grpo"
  ]
}
```

## 16.2 Pipeline

```text
1. Validate request
2. Create run record
3. Snapshot asset and market data
4. Start SSE event stream
5. Generate deterministic baselines
6. Start Backboard orchestrator
7. Gather context in parallel
8. Call FreeSolo candidate model(s)
9. Validate every plan
10. Simulate every valid plan
11. Run hidden stress tests
12. Ask Backboard agents to compare evidence
13. Rank candidates deterministically
14. Generate operator and executive explanations
15. Persist result and provenance
16. Await simulated approval
```

## 16.3 Candidate ranking

The final ranker must be deterministic.

Use normalized metrics and configured objective weights.

Backboard may recommend a candidate, but the API must also expose the deterministic rank and any disagreement.

If Backboard recommends a plan that:

- has a hard violation;
- has lower normalized score without a documented risk reason;
- lacks simulation evidence;

reject the recommendation.

---

# 17. API contracts

Base URL:

```text
/v1
```

## 17.1 Health

```text
GET /health
GET /ready
```

Readiness checks:

- Mongo connection;
- configured demo asset;
- model registry;
- optional Backboard status;
- optional FreeSolo status.

## 17.2 Assets

```text
GET /v1/assets
GET /v1/assets/{asset_id}
GET /v1/assets/{asset_id}/state
GET /v1/assets/{asset_id}/telemetry
```

Telemetry query parameters:

- start;
- end;
- interval;
- limit.

## 17.3 Market

```text
GET /v1/market/current
GET /v1/market/window
GET /v1/market/sources
```

## 17.4 Scenarios

```text
GET /v1/scenarios/templates
POST /v1/scenarios
GET /v1/scenarios/{scenario_id}
POST /v1/scenarios/{scenario_id}/clone
```

## 17.5 Dispatch

```text
POST /v1/dispatch/plan
GET /v1/dispatch/plans/{plan_id}
POST /v1/dispatch/plans/{plan_id}/validate
POST /v1/dispatch/plans/{plan_id}/simulate
POST /v1/dispatch/plans/{plan_id}/approve-simulation
```

## 17.6 Runs

```text
GET /v1/runs/{run_id}
GET /v1/runs/{run_id}/events
POST /v1/runs/{run_id}/cancel
```

`events` is SSE.

## 17.7 Models

```text
GET /v1/models
GET /v1/models/{model_version_id}
GET /v1/models/comparison
POST /v1/models/{model_version_id}/activate
```

Activation requires development-admin mode and audit event.

## 17.8 Evaluations

```text
POST /v1/evaluations
GET /v1/evaluations/{evaluation_id}
GET /v1/evaluations/{evaluation_id}/report
```

## 17.9 Operator questions

```text
POST /v1/assets/{asset_id}/ask
```

Request includes question and optional run ID.

The response must include citations or evidence references.

## 17.10 Admin

```text
POST /v1/admin/seed
POST /v1/admin/ingest/ieso
POST /v1/admin/backboard/bootstrap
POST /v1/admin/backboard/upload-documents
POST /v1/admin/training/build-dataset
```

Disable admin endpoints outside development/demo mode unless authenticated.

---

# 18. Frontend implementation

## 18.1 Product naming

Replace visible “Skyline World Explorer” branding with:

```text
GridTwin
Clean Energy Control Room
```

Preserve a subtle note that the current battery is simulated.

## 18.2 Existing world behavior

Preserve:

- world view;
- Toronto city exploration;
- building selection;
- world/city camera modes;
- layer controls;
- responsive behavior;
- attribution.

## 18.3 Battery asset layer

Create a Cesium entity for each asset returned by `/v1/assets`.

Marker appearance:

- circular cyan/green energy icon;
- status ring;
- pulsing animation only for selected or active assets;
- label at suitable camera range;
- hide detailed state at global scale;
- preserve Cesium performance.

Metadata:

```text
entity type = battery_asset
asset ID
status
power rating
market
```

Click behavior:

1. select asset;
2. open `AssetDrawer`;
3. optionally fly to asset;
4. fetch current state;
5. show “Open Control Room”.

## 18.4 Asset drawer

Show:

- simulated badge;
- name;
- market;
- rated power;
- energy capacity;
- current SOC;
- availability;
- temperature;
- current charge/discharge power;
- current price;
- open control room button.

## 18.5 Control room route

Route:

```text
/control/[assetId]
```

Layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ Asset header       status      time      scenario controls  │
├───────────────────────────────┬─────────────────────────────┤
│                               │ State of charge             │
│ Cesium Ontario asset view     │ Current power               │
│                               │ Temperature                 │
│                               │ Constraints                 │
├───────────────────────────────┼─────────────────────────────┤
│ Price + dispatch chart        │ Energy flow                 │
├───────────────────────────────┼─────────────────────────────┤
│ Dispatch timeline             │ Agent control room          │
├───────────────────────────────┴─────────────────────────────┤
│ Scenario / model comparison / approval tabs                │
└─────────────────────────────────────────────────────────────┘
```

## 18.6 Required charts

### State of charge

- line chart;
- min/max SOC bands;
- baseline versus candidate.

### Price and dispatch

- price area/line;
- charge below zero;
- discharge above zero;
- reserve line.

### Renewable mix

- wind;
- solar;
- demand;
- synthetic surplus shading.

### Reward breakdown

- revenue;
- renewable capture;
- carbon;
- grid services;
- degradation;
- robustness;
- penalties.

## 18.7 Scenario lab

User can:

- choose template;
- adjust severity;
- choose horizon;
- toggle hidden stress evaluation;
- select model candidates;
- start run.

The UI must clearly separate:

- forecast visible to model;
- hidden stress used for evaluation.

## 18.8 Agent control room

Show a concise event timeline.

Examples:

```text
Market Analyst completed
Renewable Analyst completed
Battery State Analyst completed
DispatchLM generated 4 candidates
Constraint Reviewer rejected candidate 2
Adversarial Stress Tester rejected candidate 4
Final recommendation ready
```

Clicking an event shows:

- agent;
- summary;
- tool called;
- input references;
- output evidence;
- duration;
- model used.

Do not show hidden chain-of-thought.

## 18.9 Model comparison page

Compare:

- threshold;
- optimizer;
- base model;
- SFT;
- GRPO;
- OPD if available.

Metrics:

- valid plan rate;
- safety violation rate;
- total reward;
- net value;
- renewable capture;
- estimated carbon impact;
- degradation;
- robustness;
- latency;
- tokens;
- estimated serving cost.

## 18.10 Green AI panel

Show:

- model name and size;
- average tokens;
- latency;
- estimated cost;
- number of frontier calls avoided;
- DispatchLM versus larger-model quality ratio.

Do not invent energy consumption. If no reliable energy estimate exists, show compute proxies and label them.

## 18.11 Approval panel

Title:

```text
Approve simulated dispatch
```

Show:

- plan summary;
- safety validator result;
- stress-test result;
- assumptions;
- estimated outcomes;
- model version;
- simulator version;
- approval audit note.

Approval never controls a real asset.

## 18.12 UI state

Add `useGridStore.ts`.

State:

```typescript
type GridState = {
  selectedAssetId: string | null;
  activeScenarioId: string | null;
  activeRunId: string | null;
  selectedPlanId: string | null;
  controlRoomTab:
    | "overview"
    | "scenario"
    | "agents"
    | "models"
    | "approval";
  liveMode: boolean;
  eventStreamStatus:
    | "idle"
    | "connecting"
    | "open"
    | "closed"
    | "error";
  agentEvents: AgentEvent[];
  nonCriticalWarnings: string[];
};
```

Keep API data in TanStack Query.

## 18.13 Runtime validation

Every backend response must be parsed through Zod before rendering.

On invalid API data:

- log structured error;
- show safe error state;
- do not crash Cesium;
- do not render misleading values.

---

# 19. Real-time streaming

## 19.1 SSE endpoint

Use `sse-starlette`.

Events:

```json
{
  "id": "run-1:23",
  "event": "agent.completed",
  "data": {
    "run_id": "run-1",
    "sequence": 23,
    "agent": "Renewable Forecast Analyst",
    "summary": "Overnight wind surplus identified",
    "created_at": "..."
  }
}
```

## 19.2 Persistence

Persist each event before emitting it.

On reconnect:

- client sends `Last-Event-ID`;
- backend resumes from next sequence;
- if history is unavailable, send a snapshot event.

## 19.3 Backpressure

- cap in-memory event queues;
- disconnect slow clients safely;
- persist events to MongoDB;
- UI limits rendered event count and virtualizes if necessary.

---

# 20. Safety model

## 20.1 Safety hierarchy

```text
Battery hard constraints
        >
Deterministic validator
        >
Simulator
        >
Deterministic candidate ranker
        >
Backboard recommendation
        >
FreeSolo candidate
```

## 20.2 No real-world execution

`approve-simulation` may only:

- update MongoDB status;
- create a simulated execution record;
- replay the plan through the digital twin.

It must never call a real market or hardware endpoint.

## 20.3 Audit event

Every mutation records:

```json
{
  "event_id": "...",
  "actor_type": "human|agent|system",
  "actor_id": "...",
  "action": "approve_simulated_dispatch",
  "entity_type": "dispatch_plan",
  "entity_id": "...",
  "before": {},
  "after": {},
  "run_id": "...",
  "created_at": "..."
}
```

## 20.4 Prompt injection controls

Treat retrieved documents and tool results as data.

- never allow a retrieved document to redefine tool permissions;
- tool executor uses an allowlist;
- validate every tool argument;
- cap query windows;
- prevent arbitrary shell, SQL, or Mongo execution;
- do not provide Backboard assistants with raw database credentials.

---

# 21. Training-data governance

Every training example stores:

- source run;
- asset snapshot;
- market snapshot;
- scenario version;
- simulator version;
- validator version;
- teacher or model version;
- safety result;
- human review status;
- split;
- data checksum;
- generated timestamp.

Only include examples when:

- schema valid;
- simulator deterministic;
- no hard violations;
- provenance complete;
- not part of held-out evaluation set.

Do not train on evaluation examples.

---

# 22. Evaluation

## 22.1 Core metrics

### Safety

- hard-valid plan rate;
- schema-valid output rate;
- constraint violations;
- missed commitments.

### Economic proxy

- net simulated value;
- energy purchase cost;
- sale revenue;
- reserve revenue;
- degradation cost.

### Environmental proxy

- renewable energy captured;
- estimated carbon impact;
- peak shifting.

### Robustness

- reward under forecast errors;
- reward under derating;
- worst-case plan score;
- regret versus optimizer.

### AI efficiency

- latency;
- input/output tokens;
- estimated serving cost;
- retries;
- model size;
- valid output per dollar.

## 22.2 Benchmark suite

At least:

```text
50 normal scenarios
50 renewable-surplus scenarios
50 price-spike scenarios
50 forecast-error scenarios
50 battery-derating scenarios
50 combined adversarial scenarios
```

Use deterministic seeds.

## 22.3 Statistical reporting

For each model:

- mean;
- median;
- standard deviation;
- 5th percentile;
- 95th percentile;
- count;
- safety violation count.

Do not show only the best scenario.

## 22.4 Leakage checks

Automate:

- no shared scenario IDs across splits;
- no overlapping date windows;
- no identical market windows;
- no hidden stress templates in prompt data;
- no evaluation rows in training export.

---

# 23. Testing requirements

## 23.1 Frontend unit tests

Add tests for:

- asset API schema;
- grid store defaults;
- selected asset state;
- SSE event reducer;
- chart formatter;
- simulated badge;
- model comparison sorting;
- approval disabled when validator fails.

## 23.2 Existing UI tests

Preserve and keep passing:

- city registry tests;
- world store tests;
- building-format tests;
- existing world Playwright flow.

## 23.3 Backend unit tests

### Battery state

- charging increases energy with efficiency;
- discharging reduces pack energy;
- SOC never silently clips;
- exact boundary accepted;
- below/above bounds rejected.

### Constraints

- simultaneous charge/discharge rejected;
- power limit rejected;
- ramp violation rejected;
- reserve headroom rejected;
- thermal derating enforced;
- timestamp order enforced;
- NaN rejected.

### Metrics

- revenue arithmetic;
- reserve revenue;
- cycle calculation;
- degradation proxy;
- carbon estimate.

### Baselines

- idle unchanged;
- threshold behavior;
- optimizer solves toy case;
- optimizer respects bounds.

### Reward

- unsafe output receives hard penalty;
- malformed JSON receives -10;
- safe better schedule receives higher reward;
- robustness penalty works.

## 23.4 Property-based tests

Use Hypothesis:

- random valid plans conserve energy within tolerance;
- validator never accepts simultaneous flow;
- all accepted plans remain within SOC bounds in simulation;
- reward is finite;
- serializer round-trips.

## 23.5 MongoDB integration tests

Use a disposable local MongoDB or test database.

Test:

- bootstrap idempotence;
- unique indexes;
- transaction behavior;
- repository CRUD;
- event sequence;
- training provenance;
- geospatial query;
- TTL configuration inspection.

Atlas-specific Search, Vector Search, Stream Processing, and Trigger tests run in a separate opt-in suite.

## 23.6 Backboard contract tests

Mock Backboard responses for:

- direct final answer;
- one tool round;
- parallel tool calls;
- chained tool calls;
- malformed tool arguments;
- timeout;
- maximum rounds;
- cancellation.

Live sponsor test:

```bash
pytest -m backboard_live
```

Not part of default CI.

## 23.7 FreeSolo contract tests

Mock:

- valid structured response;
- invalid JSON;
- schema mismatch;
- timeout;
- unavailable model;
- circuit breaker;
- fallback.

Live sponsor test:

```bash
pytest -m freesolo_live
```

## 23.8 End-to-end test

`e2e/grid-control-room.spec.ts`:

1. load world;
2. asset marker exists using seeded API;
3. select asset;
4. open control room;
5. choose scenario;
6. start mock run;
7. receive SSE events;
8. display candidates;
9. show rejected unsafe candidate;
10. show final recommendation;
11. approve simulated dispatch;
12. show completed result.

Default E2E uses deterministic mock sponsor integrations while exercising the real simulator and Mongo test fixture.

## 23.9 Performance targets

Hackathon targets:

- initial world UI remains responsive;
- chart interaction under 100 ms local UI work;
- 24-hour deterministic simulation under 100 ms for one plan;
- 100 candidate simulations under 5 seconds on a laptop;
- no unbounded React rerenders;
- no Cesium viewer duplication;
- 1,000 agent events can be loaded without freezing UI;
- no memory leak after navigating between world and control room five times.

---

# 24. Developer commands

Root `package.json` additions:

```json
{
  "scripts": {
    "dev:web": "next dev",
    "dev:api": "cd services/grid-core && uv run uvicorn app.main:app --reload --port 8000",
    "dev:all": "concurrently -k -n WEB,API \"npm run dev:web\" \"npm run dev:api\"",
    "test:web": "vitest run",
    "test:api": "cd services/grid-core && uv run pytest",
    "lint:api": "cd services/grid-core && uv run ruff check .",
    "typecheck:api": "cd services/grid-core && uv run mypy app",
    "check:web": "npm run lint && npm run typecheck && npm run test:web && npm run build",
    "check:api": "npm run lint:api && npm run typecheck:api && npm run test:api",
    "check:all": "npm run check:web && npm run check:api"
  }
}
```

Preserve current Cesium scripts.

Makefile:

```make
install:
	npm install
	cd services/grid-core && uv sync --all-extras

dev:
	npm run dev:all

check:
	npm run check:all

seed:
	cd services/grid-core && uv run python scripts/seed_demo.py

atlas:
	cd services/grid-core && uv run python scripts/bootstrap_atlas.py

benchmark:
	cd services/grid-core && uv run python scripts/run_benchmark.py
```

---

# 25. Docker

`docker-compose.yml` should support local development:

- frontend optional;
- FastAPI;
- local MongoDB only as fallback/test environment.

Production and sponsor demos should use Atlas.

Do not pretend local Mongo demonstrates Atlas-only features.

---

# 26. Phase plan and hard gates

## Phase 0: Baseline and documentation reset

Deliver:

- existing app passes;
- old docs archived;
- new `AGENTS.md`;
- backend skeleton;
- environment validation.

Gate:

```text
Existing world UI still passes all current tests.
FastAPI /health returns healthy.
```

## Phase 1: Battery digital twin

Deliver:

- schemas;
- state transition;
- constraints;
- degradation proxy;
- carbon proxy;
- simulator;
- tests.

Gate:

```text
All unit and property tests pass.
No accepted plan can violate SOC or power limits.
```

## Phase 2: Deterministic baselines

Deliver:

- idle;
- threshold;
- CVXPY optimizer;
- comparison report.

Gate:

```text
Optimizer solves known toy cases.
Every baseline passes deterministic validation.
```

## Phase 3: MongoDB Atlas operational layer

Deliver:

- collections;
- time-series data;
- indexes;
- seed;
- repositories;
- Stream Processing spec;
- Change Stream event pipeline;
- Atlas search/vector setup docs.

Gate:

```text
Seeded telemetry and market data are queryable.
Materialized latest state updates.
Change Stream event reaches backend subscriber.
```

## Phase 4: Ontario data pipeline

Deliver:

- IESO parser;
- cached fixture;
- source provenance;
- normalized market window.

Gate:

```text
Seven-day fixture parses reproducibly.
Units and timestamps are validated.
Demo works offline.
```

## Phase 5: Frontend asset and control room

Deliver:

- asset layer;
- drawer;
- control room;
- charts;
- scenario lab;
- API schemas.

Gate:

```text
User can select simulated Ontario battery and view a complete seeded scenario.
Current Cesium functionality remains intact.
```

## Phase 6: Backboard orchestration

Deliver:

- assistants;
- tools;
- thread persistence;
- parallel tools;
- chained tools;
- streaming;
- mock DispatchLM.

Gate:

```text
One full orchestration run completes with at least:
5 specialist analyses,
parallel context collection,
2 candidate simulations,
1 adversarial stress test,
and a final structured recommendation.
```

## Phase 7: FreeSolo SFT

Deliver:

- dataset builder;
- environment;
- structured output;
- deployed SFT model;
- evaluation.

Gate:

```text
SFT model produces >=99% parseable JSON and >=95% hard-valid plans
on simple held-out scenarios after the standard retry policy.
```

If not met, improve data and SFT before GRPO.

## Phase 8: FreeSolo GRPO

Deliver:

- simulation-grounded reward;
- hidden stress evaluation;
- GRPO model;
- comparison.

Gate:

```text
GRPO improves median held-out total reward over SFT,
does not increase safety violations,
and improves at least one environmental metric without unacceptable
degradation or missed-commitment regressions.
```

## Phase 9: Full sponsor integration

Deliver:

- live Backboard;
- live FreeSolo;
- Atlas Stream Processing;
- Search;
- Vector Search;
- Triggers;
- Charts;
- training curation.

Gate:

```text
A live demo run uses all three sponsor systems and records complete provenance.
```

## Phase 10: Green AI and final evaluation

Deliver:

- model efficiency comparison;
- benchmark report;
- Deloitte impact metrics;
- honest limitations.

Gate:

```text
All displayed demo metrics are generated by versioned code and data.
No fabricated values remain.
```

## Phase 11: Demo hardening

Deliver:

- deterministic demo snapshot;
- offline fallback;
- recording;
- reset command;
- observability;
- rehearsed script.

Gate:

```text
Five consecutive end-to-end rehearsals complete without manual database edits.
```

---

# 27. Demo script

## 0:00–0:20

Open the globe.

Say:

> GridTwin turns grid-scale batteries into adaptive clean-energy assets. It combines a deterministic battery digital twin with a specialized dispatch model and a multi-agent grid operations team.

## 0:20–0:40

Zoom to Ontario and select the simulated battery.

Show:

- 100 MW / 400 MWh;
- 50 percent SOC;
- 20 MW reserve;
- current price;
- wind forecast.

## 0:40–1:00

Show the rule-based plan.

Introduce:

- overnight wind surplus;
- evening demand peak.

## 1:00–1:30

Start GridTwin planning.

Show MongoDB event arrival and Backboard agents running in parallel.

## 1:30–2:10

Show FreeSolo model candidates.

Compare:

- base;
- SFT;
- GRPO.

Show one unsafe candidate rejected by deterministic constraints.

## 2:10–2:45

Inject hidden stress:

- wind forecast miss;
- 12 percent demand increase;
- 30 percent battery derating.

Show adversarial agent rejecting a brittle plan.

## 2:45–3:20

Show final plan:

- charge in low-price renewable period;
- preserve reserve;
- discharge during peak;
- stay within SOC and thermal limits.

## 3:20–3:45

Show actual simulator metrics:

- renewable capture;
- estimated carbon impact;
- simulated net value;
- degradation proxy;
- zero violations.

## 3:45–4:05

Ask:

> Why did you preserve 20 MW instead of selling all available power?

Show Backboard explanation with evidence.

## 4:05–4:20

Show trajectory saved to MongoDB as a curated FreeSolo training candidate.

## Final line

> GridTwin does not ask an LLM to control a battery. It trains a specialist to propose strategies, surrounds it with an AI operations team, and proves every decision inside a deterministic digital twin before any action is accepted.

---

# 28. Deloitte track alignment

## 28.1 AI for Green

Measure:

- renewable energy captured;
- estimated carbon impact;
- peak energy shifted;
- battery utilization;
- renewable-surplus charging;
- avoided unnecessary cycling.

## 28.2 Green AI

Measure:

- specialist model token count;
- latency;
- serving cost;
- number of large-model calls;
- valid-plan rate;
- quality relative to stronger model;
- Backboard routing efficiency;
- cache hit rate.

Show that a smaller trained specialist can handle routine dispatch generation while stronger models are reserved for rare or strategic analysis.

## 28.3 Environmental honesty

- label carbon as estimated;
- display assumptions;
- version coefficients;
- show confidence and sensitivity;
- never convert a demo scenario into an unsupported real-world tonnes-saved claim.

---

# 29. Failure and fallback design

## 29.1 Mongo unavailable

- backend reports not ready;
- frontend can load world;
- control room shows data-layer error;
- no fake successful run.

## 29.2 Backboard unavailable

- allow deterministic optimizer comparison;
- mark agent workflow unavailable;
- do not imitate a live Backboard run without label.

## 29.3 FreeSolo unavailable

- use pinned cached demo output only in demo-replay mode;
- otherwise fall back to optimizer;
- clearly label fallback.

## 29.4 IESO endpoint unavailable

- use committed normalized fixture;
- show fixture date and source.

## 29.5 Cesium unavailable

- control room route still supports a non-map fallback;
- main map shows existing error overlay.

## 29.6 Invalid model output

- reject;
- retry once with validation error;
- trip circuit breaker after configured failures;
- fall back safely.

---

# 30. Observability

Use structured logs with:

- request ID;
- run ID;
- asset ID;
- plan ID;
- model revision;
- assistant/thread ID;
- simulation version;
- duration;
- error class.

Never log:

- API keys;
- full sensitive prompts;
- raw credentials;
- hidden reasoning.

Metrics:

- API latency;
- simulator latency;
- Backboard round count;
- tool call latency;
- FreeSolo latency;
- schema failures;
- safety rejections;
- SSE clients;
- Mongo operation latency.

---

# 31. Deployment

## 31.1 Frontend

Deploy to Vercel or equivalent.

Required:

- Cesium assets served correctly;
- environment token;
- API URL;
- CORS configured;
- attribution unobstructed.

## 31.2 Backend

Deploy FastAPI to:

- Railway;
- Render;
- Fly.io;
- Cloud Run;
- or another container platform.

Requirements:

- Python 3.12;
- outbound HTTPS;
- Atlas network access;
- no sleep during judged demo;
- health checks;
- sufficient timeout for agent run.

## 31.3 Atlas

Use:

- Atlas cluster;
- dedicated database user;
- least privilege;
- IP/network configuration;
- Search and Vector Search indexes;
- optional Stream Processing workspace.

## 31.4 Demo reset

Create:

```bash
make demo-reset
```

It:

- removes prior demo runs;
- restores seeded asset state;
- restores fixture market data;
- clears ephemeral events;
- preserves model and audit configuration;
- verifies readiness.

---

# 32. Root AGENTS.md replacement

The new root `AGENTS.md` must summarize these non-negotiable rules:

1. This is a simulated grid-battery decision platform.
2. Preserve current Cesium world architecture.
3. The battery simulator is the source of physical truth.
4. The validator outranks all AI output.
5. FreeSolo proposes schedules; it never directly executes.
6. Backboard orchestrates; it does not bypass deterministic tools.
7. MongoDB stores provenance and operational state.
8. No real battery or market integration.
9. All sustainability numbers must be traceable.
10. Evaluation splits must prevent leakage.
11. Never show private reasoning.
12. Run phase gates.
13. Do not fake sponsor integration.
14. Do not report completion with failing tests.

---

# 33. Final acceptance checklist

## Existing platform

- [ ] Existing world UI remains functional.
- [ ] Toronto city exploration remains functional.
- [ ] Existing unit tests pass.
- [ ] Existing Playwright test passes.
- [ ] Cesium attribution remains visible.
- [ ] Only one Cesium viewer exists.

## Battery digital twin

- [ ] SOC transition tested.
- [ ] Efficiency tested.
- [ ] Power limits tested.
- [ ] Reserve tested.
- [ ] Thermal derating tested.
- [ ] Ramp constraints tested.
- [ ] Degradation proxy versioned.
- [ ] Carbon proxy labeled estimated.
- [ ] Simulator deterministic by seed.

## Baselines

- [ ] Idle strategy.
- [ ] Threshold strategy.
- [ ] CVXPY optimizer.
- [ ] Baseline comparison report.

## MongoDB Atlas

- [ ] Operational collections.
- [ ] Time-series collections.
- [ ] Geospatial index.
- [ ] TTL indexes.
- [ ] Transactions.
- [ ] Change Streams.
- [ ] Stream Processing.
- [ ] Atlas Search.
- [ ] Vector Search.
- [ ] Trigger.
- [ ] Chart or embedded Atlas visualization.
- [ ] Complete audit trail.
- [ ] Archive/Federation documented or implemented as stretch.

## Backboard

- [ ] Assistant profiles created.
- [ ] Threads stored.
- [ ] Stable documents uploaded.
- [ ] Memory policy enforced.
- [ ] Parallel tool calls.
- [ ] Chained tool calls.
- [ ] Model routing demonstrated.
- [ ] Reasoning summaries.
- [ ] Streaming.
- [ ] Operator explanation.
- [ ] Executive explanation.
- [ ] Training curation.
- [ ] No chain-of-thought exposure.

## FreeSolo

- [ ] Structured output schema.
- [ ] SFT dataset.
- [ ] SFT run.
- [ ] SFT deployment.
- [ ] GRPO environment.
- [ ] Simulation-grounded reward.
- [ ] GRPO run.
- [ ] GRPO deployment.
- [ ] Base/SFT/GRPO comparison.
- [ ] OPD attempted or clearly marked optional.
- [ ] Model aliases and revisions logged.
- [ ] Cost preview recorded.
- [ ] Fallback tested.

## Frontend

- [ ] Battery marker.
- [ ] Asset drawer.
- [ ] Control room.
- [ ] SOC chart.
- [ ] Price/dispatch chart.
- [ ] Renewable chart.
- [ ] Scenario lab.
- [ ] Agent control room.
- [ ] Model comparison.
- [ ] Green AI metrics.
- [ ] Simulated approval.
- [ ] Responsive layouts.
- [ ] Runtime API validation.
- [ ] Error states.
- [ ] Loading states.
- [ ] Accessibility.

## Evaluation

- [ ] Held-out scenario suite.
- [ ] Leakage checks.
- [ ] Safety rate.
- [ ] Economic proxy metrics.
- [ ] Environmental proxy metrics.
- [ ] Robustness metrics.
- [ ] AI efficiency metrics.
- [ ] Statistical summaries.
- [ ] Reproducible report.

## Demo

- [ ] Five successful rehearsals.
- [ ] Offline fixture.
- [ ] Demo reset.
- [ ] Live sponsor path.
- [ ] Clearly labeled fallback path.
- [ ] No fabricated metrics.
- [ ] No unsupported physical or market claim.

---

# 34. Final deliverables

The implementation is complete only when the repository contains:

1. the preserved and extended Cesium frontend;
2. the FastAPI grid-core service;
3. deterministic battery simulation;
4. deterministic baselines;
5. Ontario data fixture and ingestion code;
6. MongoDB Atlas operational architecture;
7. Backboard orchestration;
8. FreeSolo training and deployment assets;
9. full control-room UI;
10. evaluation reports;
11. tests;
12. demo documentation;
13. updated README;
14. new AGENTS.md;
15. this implementation.md;
16. exact startup and deployment instructions.

Final developer startup:

```bash
cp .env.example .env.local
# Populate required variables.

npm install
cd services/grid-core
uv sync --all-extras
cd ../..

npm run cesium:copy
make atlas
make seed
make dev
```

Validation:

```bash
npm run check:all
npm run test:e2e
```

Live sponsor validation:

```bash
cd services/grid-core
uv run pytest -m "backboard_live or freesolo_live or atlas_live"
```

Do not declare the project complete until all non-optional acceptance items are met.
