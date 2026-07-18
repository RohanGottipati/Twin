"""Thin client for the City of Toronto Open Data CKAN Action API.

Provenance note (verified 2026-07-17): open.toronto.ca's own "Access the API"
docs page returned a 404 template when fetched directly, and the commonly
cited legacy host `ckan0.cf.opendata.inta.toronto.ca` no longer resolves.
The live backend, confirmed by a successful `package_search` call returning
real Toronto datasets, is:

    https://ckan0.cf.opendata.inter.prod-toronto.ca

This is a standard CKAN 2.x Action API (https://docs.ckan.org/en/latest/api/).
All requests below are read-only GETs against `/api/3/action/*`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import requests

CKAN_BASE = "https://ckan0.cf.opendata.inter.prod-toronto.ca"
ACTION_BASE = f"{CKAN_BASE}/api/3/action"

_SESSION = requests.Session()
_SESSION.headers.update({"User-Agent": "torontwin-ingest/0.1 (Phase 0 twin ingestion)"})


def package_show(package_id: str) -> dict[str, Any]:
    """Fetch full CKAN package (dataset) metadata, including its resources."""
    resp = _SESSION.get(f"{ACTION_BASE}/package_show", params={"id": package_id}, timeout=30)
    resp.raise_for_status()
    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(f"CKAN package_show failed for {package_id}: {payload}")
    return payload["result"]


def find_resource(package: dict[str, Any], name: str) -> dict[str, Any]:
    """Find a resource in a package's resource list by exact `name` match."""
    for resource in package["resources"]:
        if resource.get("name") == name:
            return resource
    available = [r.get("name") for r in package["resources"]]
    raise KeyError(f"No resource named {name!r} in package {package.get('name')!r}. Available: {available}")


def download(url: str, dest: Path, *, force: bool = False) -> Path:
    """Stream a resource to `dest`, skipping the request entirely if the file
    already exists on disk (bounded, idempotent re-runs)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and not force:
        return dest
    with _SESSION.get(url, stream=True, timeout=120) as resp:
        resp.raise_for_status()
        tmp = dest.with_suffix(dest.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                f.write(chunk)
        tmp.rename(dest)
    return dest


def write_manifest_entry(manifest_path: Path, entry: dict[str, Any]) -> None:
    """Append one provenance record to a JSON-lines manifest."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    with open(manifest_path, "a") as f:
        f.write(json.dumps(entry) + "\n")
