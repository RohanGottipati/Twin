# TwinTO transit-core (FastAPI stub)

Minimal Phase-3+ service surface from the TwinTO spec:

- `GET /health`
- `GET /ready`
- `GET /v1/network`
- `GET /v1/cohorts`
- `POST /v1/optimize/bounded-search` (proxies to Next `/api/optimization/search`)

## Run

```bash
cd services/transit-core
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8000
```

Point `NEXT_PUBLIC_TRANSIT_API_BASE_URL` or `TWINTO_NEXT_BASE_URL` at the Next app (default `http://localhost:3000`).
