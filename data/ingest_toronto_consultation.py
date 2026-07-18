"""Toronto Core Service Review SFT row ingestion (implementation_plan.md
Phase 4, SFT data).

Source: City of Toronto Open Data CKAN, package
`core-service-review-qualitative-data` -- 13k real open-ended responses
to the 2011 Toronto Core Service Review consultation. Confirmed to exist
on the live CKAN host (logged in OVERNIGHT_LOG.md session 3), not yet
ingested before this session.

License: City of Toronto Open Government Licence
(https://www.toronto.ca/city-government/data-research-maps/open-data/
open-data-licence/). Redistribution permitted with attribution.

SFT output contract (AGENTS.md 5.1):
    input  = persona + policy + spatial_features (null; open-ended responses
              are not per-building-specific)
    output = the REAL human-written consultation response, byte-for-byte
             (never paraphrased, never generated)
    metadata: source, persona_provenance, topic/service_area if present,
              respondent_id if present

Personas: sampled from population/sampler.py (census-weighted real Ward 13
personas), tagged persona_provenance = "sampled-independent". The source has
no per-respondent demographics (City consultation responses are anonymous),
so we independently sample from the real census distribution. This is NOT
inference from the response text (that would be profiling); it is an
independent draw whose only purpose is to give the model a realistic
demographic context during training. The full drawn persona is stored in
metadata so downstream consumers know the provenance.

Run: uv run python -m data.ingest_toronto_consultation [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import pandas as pd

from data.toronto_ckan import download, find_resource, package_show, write_manifest_entry
from population.sampler import Persona, sample_population
from twin.state import TwinState

PACKAGE_ID = "core-service-review-qualitative-data"
PROCESSED_DIR = Path(__file__).resolve().parent / "processed"
RAW_DIR = Path(__file__).resolve().parent / "raw" / "toronto_consultation"
DEFAULT_OUT = PROCESSED_DIR / "sft_toronto_consultation_rows.jsonl"
MANIFEST = PROCESSED_DIR / "manifest.jsonl"

# Policy text: the 2011 Core Service Review asked residents to weigh in on
# which city services to maintain, cut, or expand given fiscal pressures.
# This is the top-level framing used for all response rows.
POLICY_TEXT = (
    "The City of Toronto is conducting a review of its core services to identify "
    "which services to maintain, reduce, or cut given budget constraints. "
    "Residents are asked: which city services matter most to you, and where "
    "should or should not the city make cuts?"
)


def _persona_to_text(persona: Persona) -> str:
    age = persona.age_band or "adult"
    tenure = "own" if getattr(persona, "tenure", "renter") == "owner" else "rent"
    commute = getattr(persona, "commute_mode", "transit")
    neighbourhood = getattr(persona, "neighbourhood_name", "Toronto")
    return (
        f"I live in the {neighbourhood} neighbourhood of Toronto. "
        f"I am in the {age} age group. "
        f"I {tenure} my home and typically commute by {commute}."
    )


def _persona_metadata(persona: Persona) -> dict:
    return {
        "persona_id": persona.id,
        "neighbourhood_code": persona.neighbourhood_code,
        "neighbourhood_name": getattr(persona, "neighbourhood_name", None),
        "age_band": persona.age_band,
        "tenure": getattr(persona, "tenure", None),
        "commute_mode": getattr(persona, "commute_mode", None),
        "home_feature_id": persona.home_feature_id,
    }


def _load_and_parse(raw_path: Path) -> pd.DataFrame:
    """Attempt to parse the downloaded file. The CKAN resource is an XLSX.
    Returns a DataFrame with at minimum a 'response_text' column."""
    suffix = raw_path.suffix.lower()
    if suffix in (".xlsx", ".xls"):
        # Read all sheets; look for one with a text/response column.
        sheets = pd.read_excel(raw_path, sheet_name=None, nrows=None)
        for sheet_name, df in sheets.items():
            # Normalise column names for searching.
            cols_lower = {c.lower().strip(): c for c in df.columns}
            # Common column names used in consultation exports.
            text_col = None
            for candidate in ("response", "comment", "text", "answer", "open_ended",
                              "response_text", "comments", "verbatim"):
                if candidate in cols_lower:
                    text_col = cols_lower[candidate]
                    break
            if text_col is None:
                # Fall back: pick the column with the most non-null string data.
                str_cols = df.select_dtypes(include="object").columns.tolist()
                if str_cols:
                    text_col = max(str_cols, key=lambda c: df[c].notna().sum())
            if text_col:
                print(f"    Using sheet={sheet_name!r}, col={text_col!r}, "
                      f"{df[text_col].notna().sum()} non-null rows", flush=True)
                result = df[[text_col]].copy()
                result = result.rename(columns={text_col: "response_text"})
                # Include other columns as metadata if present.
                for meta_candidate in ("service_area", "topic", "ward", "respondent_id",
                                       "question", "theme"):
                    matched = cols_lower.get(meta_candidate)
                    if matched and matched != text_col:
                        result[meta_candidate] = df[matched]
                return result
        raise ValueError(f"Could not find a text column in any sheet of {raw_path}")
    elif suffix == ".csv":
        df = pd.read_csv(raw_path, encoding="utf-8", errors="replace")
        cols_lower = {c.lower().strip(): c for c in df.columns}
        text_col = None
        for candidate in ("response", "comment", "text", "answer", "response_text"):
            if candidate in cols_lower:
                text_col = cols_lower[candidate]
                break
        if text_col is None:
            str_cols = df.select_dtypes(include="object").columns.tolist()
            text_col = max(str_cols, key=lambda c: df[c].notna().sum()) if str_cols else None
        if text_col is None:
            raise ValueError(f"Could not find a text column in {raw_path}")
        result = df[[text_col]].copy().rename(columns={text_col: "response_text"})
        return result
    else:
        raise ValueError(f"Unsupported file format: {suffix}")


def main(out_path: Path = DEFAULT_OUT) -> None:
    rng = random.Random(42)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # Fetch package metadata from CKAN.
    print(f"Fetching CKAN package metadata for {PACKAGE_ID!r}...", flush=True)
    try:
        package = package_show(PACKAGE_ID)
    except Exception as exc:
        print(f"ERROR: could not fetch package metadata: {exc}", file=sys.stderr)
        sys.exit(1)

    # Find the primary data resource (prefer XLSX, then CSV).
    resources = package.get("resources", [])
    print(f"  {len(resources)} resources found", flush=True)
    for r in resources:
        print(f"    {r.get('format','?'):8s}  {r.get('name','?')}", flush=True)

    chosen = None
    for fmt in ("XLSX", "XLS", "CSV"):
        for r in resources:
            if r.get("format", "").upper() == fmt:
                chosen = r
                break
        if chosen:
            break
    if chosen is None and resources:
        chosen = resources[0]
    if chosen is None:
        print("ERROR: no downloadable resources found", file=sys.stderr)
        sys.exit(1)

    resource_url = chosen["url"]
    ext = "." + chosen.get("format", "xlsx").lower()
    raw_path = RAW_DIR / f"core_service_review{ext}"

    print(f"  Downloading {chosen.get('name','?')} from {resource_url}...", flush=True)
    download(resource_url, raw_path)
    print(f"  Saved to {raw_path} ({raw_path.stat().st_size // 1024}KB)", flush=True)

    write_manifest_entry(MANIFEST, {
        "step": "toronto_consultation_download",
        "package_id": PACKAGE_ID,
        "resource_id": chosen.get("id"),
        "resource_name": chosen.get("name"),
        "url": resource_url,
        "local_path": str(raw_path),
    })

    # Parse the file.
    print("  Parsing...", flush=True)
    try:
        df = _load_and_parse(raw_path)
    except Exception as exc:
        print(f"ERROR parsing {raw_path}: {exc}", file=sys.stderr)
        sys.exit(1)

    # Drop empty/too-short responses (< 10 chars after stripping).
    df["response_text"] = df["response_text"].astype(str).str.strip()
    df = df[df["response_text"].str.len() >= 10].copy()
    print(f"  {len(df)} usable responses after filtering", flush=True)

    # Load twin for persona sampling.
    print("  Loading twin for persona sampling...", flush=True)
    try:
        state = TwinState.load_from_processed(PROCESSED_DIR)
        personas: list[Persona] = sample_population(state, n=len(df), seed=42)
    except Exception as exc:
        print(f"ERROR loading twin/sampler: {exc}", file=sys.stderr)
        sys.exit(1)

    # Pair each response with an independently-sampled persona.
    # If we have fewer personas than rows (e.g. only a few buildings in the
    # study area), cycle through personas rather than failing.
    rows = []
    for i, (_, row) in enumerate(df.iterrows()):
        persona = personas[i % len(personas)]
        response_text = str(row["response_text"])
        meta: dict = {
            "source": "toronto_consultation_2011",
            "package_id": PACKAGE_ID,
            "persona_provenance": "sampled-independent",
            "persona": _persona_metadata(persona),
        }
        for col in ("service_area", "topic", "ward", "respondent_id", "question", "theme"):
            if col in row and pd.notna(row[col]):
                meta[col] = str(row[col])

        rows.append({
            "input": {
                "persona_text": _persona_to_text(persona),
                "policy_text": POLICY_TEXT,
                "spatial_features_text": None,
            },
            "output": response_text,
            "metadata": meta,
        })

    with open(out_path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\nWrote {len(rows)} rows to {out_path}")
    print("\nSpot-check (first 3 outputs):")
    for r in rows[:3]:
        print(f"  {r['output'][:120]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    main(args.out)
