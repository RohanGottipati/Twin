# PPO / bounded optimization (TwinTO)

## Implemented

- `src/lib/optimization/bounded-search.ts` — exhaustive small-window departure shifts
- `src/lib/optimization/ppo-stub.ts` — heuristic action suggestion (not a trained policy)
- `POST /api/optimization/search` — HTTP entry for bounded search
- FastAPI proxy: `POST /v1/optimize/bounded-search` in `services/transit-core`

## Not yet

- Gymnasium environment + Stable-Baselines3 training loop
- Live fleet / operator feasibility model
- Reward logging into Mongo `evaluation_runs`

Backboard's Simulation and Optimization agent remains the interpreter; the
deterministic simulator remains numerical authority.
