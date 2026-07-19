"""Generate the full adult persona set and write it to MongoDB Atlas.

Writes to a NEW collection, `resident_personas` -- deliberately NOT the
existing `citizen_cohorts` collection (src/lib/mongodb/collections.ts),
which holds 11 hand-authored synthetic fixture cohorts for the TechTO demo
(src/data/transit/cohorts.ts, dataMode: "synthetic-fixture") at a coarse
aggregate-cohort level with an incompatible schema. Overwriting that
collection would break its existing consumers
(src/lib/citizen-reaction/mock-provider.ts, src/lib/backboard/
orchestrator.ts). See AGENTS.md section 6.1 for the full writeup of this
distinction.

Reads MONGODB_URI / MONGODB_DATABASE explicitly from the second matching
pair in .env (there are two conflicting MONGODB_URI entries in this repo's
.env -- see AGENTS.md 6.1 -- this script does not use python-dotenv's
default first-match behavior to avoid silently connecting to the wrong
cluster).
"""

from __future__ import annotations

import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import pandas as pd
from pymongo import MongoClient

from population.generate_personas import sample_adult_personas
from population.persona_text import render_persona_from_sampler
from population.sampler import Persona

REPO_ROOT = Path(__file__).resolve().parent.parent
COLLECTION_NAME = "resident_personas"


def _load_mongo_config() -> tuple[str, str]:
    """Read the *second* MONGODB_URI/MONGODB_DATABASE pair in .env -- the
    real TechTO cluster (db name 'techto'), not the stray first pair
    (paired with MONGODB_DB/MONGODB_PASSWORD, an unrelated project's
    database, 'backhaul_exchange')."""
    lines = (REPO_ROOT / ".env").read_text().splitlines()
    uri_lines = [l for l in lines if l.startswith("MONGODB_URI=")]
    db_lines = [l for l in lines if l.startswith("MONGODB_DATABASE=")]
    if len(uri_lines) < 2 or not db_lines:
        raise RuntimeError(
            "Expected 2 MONGODB_URI entries and 1 MONGODB_DATABASE entry in "
            ".env (see AGENTS.md 6.1) -- .env has changed shape, re-check "
            "which URI is the real TechTO cluster before running this."
        )
    uri = uri_lines[1].split("=", 1)[1]
    db_name = db_lines[0].split("=", 1)[1]
    return uri, db_name


def _persona_to_document(persona: Persona, text: str, kept: dict) -> dict:
    return {
        "persona_id": persona.id,
        "neighbourhood_code": persona.neighbourhood_code,
        "neighbourhood_name": persona.neighbourhood_name,
        "age_band": persona.age_band,
        "tenure": persona.tenure,
        "commute_mode": persona.commute_mode,
        "gender": persona.gender,
        "education": persona.education,
        "immigration_status": persona.immigration_status,
        "generation_status": persona.generation_status,
        "visible_minority": persona.visible_minority,
        "dwelling_type": persona.dwelling_type,
        "household_type": persona.household_type,
        "family_status": persona.family_status,
        "mother_tongue_english": persona.mother_tongue_english,
        "mother_tongue_french": persona.mother_tongue_french,
        "total_income": persona.total_income,
        "household_income_band": persona.household_income_band,
        "household_income_decile": persona.household_income_decile,
        "neighbourhood_median_income": persona.neighbourhood_median_income,
        "kept_attributes_shown_to_llm": kept,
        "text": text,
        "provenance": {
            "source": "statcan_2021_pumf_toronto_cma",
            "fitting_method": "ipf_raking_v1",
            "verbalizer_model": "Qwen/Qwen2.5-7B-Instruct",
        },
    }


def generate_and_store(
    n_draw_pool: int,
    seed: int = 0,
    max_workers: int = 12,
    batch_size: int = 500,
) -> int:
    census = pd.read_csv(REPO_ROOT / "data" / "processed" / "census_profile.csv")
    pumf = pd.read_csv(REPO_ROOT / "data" / "processed" / "pumf_toronto.csv")
    personas = sample_adult_personas(census, pumf, n_personas=n_draw_pool, seed=seed)
    print(f"sampled {len(personas)} adult personas, verbalizing with {max_workers} workers...")

    uri, db_name = _load_mongo_config()
    client = MongoClient(uri)
    collection = client[db_name][COLLECTION_NAME]
    collection.create_index("neighbourhood_code")
    collection.create_index("persona_id", unique=True)

    # Resumable: skip personas whose id is already written (e.g. a prior
    # run that stopped partway through), since generation IDs are
    # deterministic given the same seed.
    already_written = set(collection.distinct("persona_id"))
    if already_written:
        before = len(personas)
        personas = [p for p in personas if p.id not in already_written]
        print(f"resuming: {len(already_written)} already written, {before - len(personas)} skipped, {len(personas)} remaining")

    def render_one(persona: Persona) -> dict:
        rng = random.Random(f"{seed}:{persona.id}")
        text, kept = render_persona_from_sampler(persona, rng)
        return _persona_to_document(persona, text, kept)

    t0 = time.time()
    written = 0
    buffer: list[dict] = []
    with ThreadPoolExecutor(max_workers=max_workers) as ex:
        futures = {ex.submit(render_one, p): p for p in personas}
        for i, future in enumerate(as_completed(futures), 1):
            try:
                doc = future.result()
            except Exception as exc:  # noqa: BLE001 -- log and skip, don't kill the whole run
                p = futures[future]
                print(f"  [skip] {p.id} failed: {exc}")
                continue
            buffer.append(doc)
            if len(buffer) >= batch_size:
                collection.insert_many(buffer, ordered=False)
                written += len(buffer)
                buffer.clear()
            if i % 500 == 0:
                elapsed = time.time() - t0
                print(f"  {i}/{len(personas)} done ({elapsed:.0f}s, {i/elapsed:.1f}/s)")

    if buffer:
        collection.insert_many(buffer, ordered=False)
        written += len(buffer)

    elapsed = time.time() - t0
    print(f"Wrote {written} documents to {db_name}.{COLLECTION_NAME} in {elapsed:.0f}s")
    return written


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--n-draw-pool", type=int, default=15800)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--max-workers", type=int, default=12)
    args = parser.parse_args()
    generate_and_store(args.n_draw_pool, seed=args.seed, max_workers=args.max_workers)
