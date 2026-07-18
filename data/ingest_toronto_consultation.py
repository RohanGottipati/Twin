"""Toronto Core Service Review SFT row ingestion (implementation_plan.md
Phase 4, SFT data).

Source: City of Toronto Open Data CKAN, package
`core-service-review-qualitative-data` -- real open-ended responses
to the 2011 Toronto Core Service Review consultation.

License: City of Toronto Open Government Licence
(https://www.toronto.ca/city-government/data-research-maps/open-data/
open-data-licence/). Redistribution permitted with attribution.

SFT output contract (AGENTS.md 5.1):
    input  = persona + policy + spatial_features (null)
    output = REAL human consultation response, byte-for-byte
    metadata: source, persona_provenance=real, demographics, response_field

Personas: demographics from the XLSX row, rendered via
population.persona_text.render_persona (LLM + attribute dropout).

Run: uv run python -m data.ingest_toronto_consultation [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import pandas as pd

from population.persona_text import render_persona

PACKAGE_ID = "core-service-review-qualitative-data"
PROCESSED_DIR = Path(__file__).resolve().parent / "processed"
RAW_DIR = Path(__file__).resolve().parent / "raw" / "toronto_consultation"
DEFAULT_OUT = PROCESSED_DIR / "sft_toronto_consultation_rows.jsonl"
RAW_XLSX = RAW_DIR / "core_service_review.xlsx"

POLICY_TEXT = (
    "The City of Toronto is conducting a review of its core services to identify "
    "which services to maintain, reduce, or cut given budget constraints. "
    "Residents are asked: which city services matter most to you, and where "
    "should or should not the city make cuts?"
)

# exact XLSX names (note double space in Other Important Issues)
OPENEND_COLS = {
    "Other Important Issues  (Combined)": "other_important_issues",
    "Financial Advice (Combined)": "financial_advice",
    "Other Advice (Combined)": "other_advice",
}

DEMO_COLS = {
    "Gender (Combined)": "gender",
    "Age (Combined)": "age",
    "Highest Level of Education (Combined)": "education",
    "Annual Household Income (Combined)": "income",
    "Rent or Own (Combined)": "tenure",
    "Children Under 18 (Combined)": "children_under_18",
    "Language (Combined)": "language",
    "Own a business (Combined)": "owns_business",
    "Postal Code (Combined)": "postal_code",
}


def _clean(val) -> str | None:
    if pd.isna(val):
        return None
    s = str(val).strip()
    if not s or s in ("-99", "nan", "None"):
        return None
    return s


def main(out_path: Path = DEFAULT_OUT) -> None:
    rng = random.Random(2262)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not RAW_XLSX.exists():
        print(f"ERROR: raw xlsx missing at {RAW_XLSX}", file=sys.stderr)
        sys.exit(1)

    print(f"Parsing {RAW_XLSX}...", flush=True)
    df = pd.read_excel(RAW_XLSX, sheet_name="Sheet1")
    print(f"  loaded Sheet1: {df.shape[0]} respondents", flush=True)

    rows = []
    for _, row in df.iterrows():
        rid = _clean(row.get("ResponseID"))
        demo = {k: _clean(row.get(src)) for src, k in DEMO_COLS.items()}
        demo = {k: v for k, v in demo.items() if v is not None}
        # one verbalization per respondent, reused across their open-ends
        persona_str, kept = render_persona(demo, rng)

        for src_col, field_key in OPENEND_COLS.items():
            text = _clean(row.get(src_col))
            if text is None or len(text) < 10:
                continue
            rows.append({
                "input": {
                    "persona_text": persona_str,
                    "policy_text": POLICY_TEXT,
                    "spatial_features_text": None,
                },
                "output": text,
                "metadata": {
                    "source": "toronto_consultation_2011",
                    "package_id": PACKAGE_ID,
                    "persona_provenance": "real",
                    "respondent_id": rid,
                    "response_field": field_key,
                    "demographics": demo,
                    "persona_attrs_kept": kept,
                    "persona_text_renderer": "persona_to_text_v3",
                },
            })

    with open(out_path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\nWrote {len(rows)} rows to {out_path}")
    print("\nSpot-check personas:")
    for r in rows[:3]:
        print(f"  {r['input']['persona_text']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    main(args.out)
