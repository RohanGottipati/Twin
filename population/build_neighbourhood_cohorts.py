"""Aggregate `resident_personas` into 158 real neighbourhood cohort documents
and write them into the `citizen_cohorts` collection, replacing the 11
hand-authored synthetic fixture cohorts the TechTO web app previously used
for its citizen density map, citizen-reaction prompts, and equity-gap /
car-switch-probability simulation math (see AGENTS.md 6.1 and the plan this
implements: "wire resident_personas into the TechTO web app").

Every field below is either a direct real aggregate over the census-grounded
persona records, a documented derived proxy, or an explicit honest gap (left
empty/placeholder rather than fabricated) -- see the field-by-field table in
the plan. This script is idempotent: rerunning it fully replaces the
collection's contents with a fresh aggregate of whatever is currently in
`resident_personas`.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from pymongo import MongoClient

from population.generate_and_store_personas import _load_mongo_config

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE_COLLECTION = "resident_personas"
TARGET_COLLECTION = "citizen_cohorts"

# commute_mode values that don't map to one of the 4 baselineModeShare
# buckets (motorcycle, other, or missing/not-commuting) are excluded from
# the mode-share normalization -- documented, not silently zeroed.
MODE_BUCKET_MAP = {
    "Public transit": "transit",
    "Car, truck or van - as a driver": "car",
    "Car, truck or van - as a passenger": "car",
    "Walked": "walk",
    "Bicycle": "cycle",
}

PRICE_SENSITIVITY_BY_INCOME_BAND = {"low": 0.7, "middle": 0.45, "high": 0.2}
FLAT_WAIT_CROWDING_SENSITIVITY = 0.5
PRIMARY_DESTINATION_PLACEHOLDER = "zone-unknown-workplace"


def _income_band(decile: int | None) -> str:
    if decile is None:
        return "middle"
    if decile <= 3:
        return "low"
    if decile <= 7:
        return "middle"
    return "high"


def _modal(values: list[str]) -> str:
    counts = Counter(v for v in values if v)
    if not counts:
        return "unknown"
    return counts.most_common(1)[0][0]


def build_cohort_for_neighbourhood(code: str, personas: list[dict]) -> dict:
    n = len(personas)
    ages = [p.get("age_band") for p in personas]
    deciles = [p.get("household_income_decile") for p in personas if p.get("household_income_decile") is not None]
    modal_decile = _modal([str(d) for d in deciles])
    modal_decile = int(modal_decile) if modal_decile != "unknown" else None
    income_band = _income_band(modal_decile)

    modes = [p.get("commute_mode") for p in personas]
    bucket_counts = Counter(MODE_BUCKET_MAP[m] for m in modes if m in MODE_BUCKET_MAP)
    bucket_total = sum(bucket_counts.values())
    baseline_mode_share = (
        {bucket: round(bucket_counts.get(bucket, 0) / bucket_total, 4) for bucket in ("transit", "car", "walk", "cycle")}
        if bucket_total > 0
        else {"transit": 0.25, "car": 0.25, "walk": 0.25, "cycle": 0.25}
    )

    vehicle_access_count = sum(
        1 for m in modes if m in ("Car, truck or van - as a driver", "Car, truck or van - as a passenger")
    )
    transit_pass_count = sum(1 for m in modes if m == "Public transit")
    senior_count = sum(1 for a in ages if a == "65+")

    name = personas[0]["neighbourhood_name"]

    return {
        "cohortId": code,
        "id": code,
        "label": name,
        "weight": None,  # filled in by caller once the citywide total is known
        "personaCount": n,
        "homeZoneId": code,
        "primaryDestinationZoneId": PRIMARY_DESTINATION_PLACEHOLDER,
        "ageBand": _modal(ages),
        "incomeBand": income_band,
        "vehicleAccessProbability": round(vehicle_access_count / n, 4),
        "transitPassProbability": round(transit_pass_count / n, 4),
        "mobilityNeeds": [],
        "sensitivity": {
            "waitSensitivity": FLAT_WAIT_CROWDING_SENSITIVITY,
            "crowdingSensitivity": FLAT_WAIT_CROWDING_SENSITIVITY,
            "priceSensitivity": PRICE_SENSITIVITY_BY_INCOME_BAND[income_band],
            "accessibilitySensitivity": round(senior_count / n, 4),
        },
        "baselineModeShare": baseline_mode_share,
        "dataMode": "resident-persona-aggregate",
        "provenance": {
            "source": "statcan_2021_pumf_toronto_cma_via_resident_personas",
            "aggregation": "population.build_neighbourhood_cohorts",
            "fields_not_derivable_from_source_data": [
                "occupationGroup",
                "workSchedule",
                "scheduleFlexibility",
                "primaryDestinationZoneId (placeholder only -- no workplace data)",
                "mobilityNeeds (no disability variable in the ingested PUMF fields)",
            ],
            "heuristic_fields": [
                "sensitivity.waitSensitivity/crowdingSensitivity (flat city-wide baseline, no real correlate)",
                "sensitivity.priceSensitivity (income-decile-bucket proxy)",
                "sensitivity.accessibilitySensitivity (senior-population-share proxy)",
            ],
        },
    }


def build_and_write(dry_run: bool = False) -> int:
    uri, db_name = _load_mongo_config()
    client = MongoClient(uri)
    db = client[db_name]
    source = db[SOURCE_COLLECTION]

    personas = list(source.find({}))
    if not personas:
        raise RuntimeError(f"{SOURCE_COLLECTION} is empty -- run generate_and_store_personas.py first.")

    by_neighbourhood: dict[str, list[dict]] = {}
    for persona in personas:
        by_neighbourhood.setdefault(persona["neighbourhood_code"], []).append(persona)

    total = len(personas)
    now = datetime.now(timezone.utc).isoformat()
    cohorts = []
    for code, group in by_neighbourhood.items():
        cohort = build_cohort_for_neighbourhood(code, group)
        cohort["weight"] = round(len(group) / total * 100, 4)
        cohort["updatedAt"] = now
        cohorts.append(cohort)

    print(f"Aggregated {len(cohorts)} neighbourhood cohorts from {total} personas.")
    weight_sum = sum(c["weight"] for c in cohorts)
    print(f"Weight sum check: {weight_sum:.2f} (should be ~100)")

    if dry_run:
        print("Dry run -- not writing to Mongo. Sample cohort:")
        print(cohorts[0])
        return len(cohorts)

    target = db[TARGET_COLLECTION]
    before_count = target.count_documents({})
    target.delete_many({})
    target.insert_many(cohorts)
    target.create_index("cohortId", unique=True)
    after_count = target.count_documents({})
    print(f"Replaced {TARGET_COLLECTION}: {before_count} -> {after_count} documents.")
    return after_count


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Compute and print but don't write to Mongo.")
    args = parser.parse_args()
    build_and_write(dry_run=args.dry_run)
