"""TechTO transit-core stub.

Proxies demo reads to the Next.js TechTO app where possible and exposes
health/ready plus optimization hooks. Not a full GTFS ingest service yet.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import settings

app = FastAPI(title=settings.app_name, version="0.1.0")


class OptimizeBody(BaseModel):
    scenario_id: str = Field(alias="scenarioId")
    limit: int = 8

    model_config = {"populate_by_name": True}


def next_base() -> str:
    return os.getenv("NEXT_PUBLIC_TRANSIT_API_BASE_URL") or os.getenv(
        "TECHTO_NEXT_BASE_URL", settings.next_proxy_base
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "techto-transit-core"}


@app.get("/ready")
async def ready() -> dict[str, Any]:
    base = next_base().rstrip("/")
    # Ready if we can reach the Next capabilities endpoint OR we are in local stub mode.
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.get(f"{base}/api/backboard/capabilities")
            return {
                "ready": response.status_code == 200,
                "nextBase": base,
                "capabilitiesStatus": response.status_code,
            }
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "nextBase": base, "error": str(exc)}


@app.get("/v1/network")
async def network() -> dict[str, Any]:
    """Placeholder network payload; prefer Next Mongo/fixture repository in the demo."""
    return {
        "dataMode": "synthetic-fixture",
        "note": "Use Next.js TechTO repository for authoritative demo network state.",
        "cityId": "toronto",
    }


@app.get("/v1/cohorts")
async def cohorts() -> dict[str, Any]:
    return {
        "dataMode": "synthetic-fixture",
        "note": "Cohorts are seeded in MongoDB / src/data/transit/cohorts.ts",
    }


@app.post("/v1/optimize/bounded-search")
async def optimize_bounded_search(body: OptimizeBody) -> dict[str, Any]:
    base = next_base().rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{base}/api/optimization/search",
                json={"scenarioId": body.scenario_id, "limit": body.limit},
            )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=503, detail=f"Next optimization proxy failed: {exc}") from exc
    if response.status_code >= 400:
        raise HTTPException(status_code=response.status_code, detail=response.text)
    return response.json()


def run() -> None:
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=False)


if __name__ == "__main__":
    run()
