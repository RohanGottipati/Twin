"""ANES 2020 open-ended response SFT row ingestion (implementation_plan.md
Phase 4, SFT data).

Source: ANES 2020 Time Series Study open-ended responses file
(anes_timeseries_2020_redactedopenends_excel_20211118.xlsx) plus the
main CSV (anes_timeseries_2020_csv_20220210.csv) for demographic
matching. Both are staged at /home/acreo/tw/ANES/ and git-ignored
(redistribution-restricted ToS -- never commit raw rows).

Only aggregate stats and the processed JSONL output go into the repo.

ANES open-ended columns used (from the redacted open-ends file):
  V201107: What R likes about Democratic presidential candidate [text]
  V201109: What R dislikes about Democratic presidential candidate [text]
  V201111: What R likes about Republican presidential candidate [text]
  V201113: What R dislikes about Republican presidential candidate [text]
  V201031: [used as a filter/orientation variable, not text]

These four like/dislike open-ends are the most policy-relevant opinion
text in ANES with matching demographic covariates -- the exact variables
AGENTS.md 5.1 names as the ANES gold source for SFT ("ANES likes/dislikes").

Demographics matched from the main CSV using V200001 (respondent ID):
  V201507x: age (summary)
  V201549x: race/ethnicity (summary)
  V201600: sex
  V201617x: education (summary)
  V201617x -> simplified to high_school / some_college / college / postgrad
  V202468x: family income (pre-election summary, 28 categories)
  V201231x: party identification (7-point scale, collapsed to party label)

persona_provenance = "real": the demographic profile is the actual ANES
respondent's own survey-reported demographics, not a sampled stand-in.
The response_text is the actual respondent's verbatim open-ended answer.
This is the highest-provenance data in the training set.

Run: uv run python -m data.ingest_anes_openends [--out PATH]
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

import pandas as pd

from population.persona_text import render_persona

ANES_DIR = Path("/home/acreo/tw/ANES")
OPENENDS_FILE = ANES_DIR / "anes_timeseries_2020_redactedopenends_excel_20211118.xlsx"
MAIN_CSV_DIR = ANES_DIR / "anes_timeseries_2020_csv_20220210"
PROCESSED_DIR = Path(__file__).resolve().parent / "processed"
DEFAULT_OUT = PROCESSED_DIR / "sft_anes_rows.jsonl"

# Open-ended columns to use: (sheet_name, policy_description)
# Each sheet in the open-ends workbook corresponds to one ANES variable.
OPENEND_VARS = {
    "V201107": "What do you like about the Democratic presidential candidate?",
    "V201109": "What do you dislike about the Democratic presidential candidate?",
    "V201111": "What do you like about the Republican presidential candidate?",
    "V201113": "What do you dislike about the Republican presidential candidate?",
}

# Demographic variable codings decoded from ANES 2020 codebook PDF.
# Only the values actually present in the data are listed.
AGE_BANDS = {-9: None, -8: None, -7: None, -6: None, -5: None, -4: None, -3: None, -2: None, -1: None}  # filled below
PARTY_LABELS = {
    1: "Strong Democrat", 2: "Weak Democrat", 3: "Independent-leaning Democrat",
    4: "Independent", 5: "Independent-leaning Republican",
    6: "Weak Republican", 7: "Strong Republican",
    -9: None, -8: None, -6: None, -5: None, -4: None,
}
SEX_LABELS = {1: "male", 2: "female", -9: None, -8: None}
EDUCATION_LABELS = {
    1: "less than high school", 2: "high school diploma or equivalent",
    3: "some college", 4: "associate degree", 5: "bachelor's degree",
    6: "master's degree", 7: "professional or doctoral degree",
    -9: None, -8: None, -7: None,
}
RACE_LABELS = {
    1: "White non-Hispanic", 2: "Black non-Hispanic", 3: "Hispanic",
    4: "Asian or Pacific Islander", 5: "Native American or Alaska Native",
    6: "non-Hispanic other or multiple races",
    -9: None, -8: None, -7: None, -6: None, -5: None, -4: None, -3: None,
}
# Income: V202468x 1-28 categories; map to approximate bracket strings.
# Per ANES codebook, 1=$0-4,999 ... 28=$250,000+.
def _income_label(code: int) -> str | None:
    if code < 1:
        return None
    brackets = [
        "under $5,000", "$5,000-$9,999", "$10,000-$12,499", "$12,500-$14,999",
        "$15,000-$17,499", "$17,500-$19,999", "$20,000-$22,499", "$22,500-$24,999",
        "$25,000-$27,499", "$27,500-$29,999", "$30,000-$34,999", "$35,000-$39,999",
        "$40,000-$44,999", "$45,000-$49,999", "$50,000-$54,999", "$55,000-$59,999",
        "$60,000-$64,999", "$65,000-$69,999", "$70,000-$74,999", "$75,000-$79,999",
        "$80,000-$89,999", "$90,000-$99,999", "$100,000-$109,999",
        "$110,000-$124,999", "$125,000-$149,999", "$150,000-$174,999",
        "$175,000-$249,999", "$250,000 or more",
    ]
    if 1 <= code <= len(brackets):
        return brackets[code - 1]
    return None


def _age_label(code: int) -> str | None:
    if code < 18:
        return None
    if code <= 29:
        return "18-29"
    if code <= 44:
        return "30-44"
    if code <= 59:
        return "45-59"
    if code <= 74:
        return "60-74"
    return "75 and over"


def main(out_path: Path = DEFAULT_OUT) -> None:
    rng = random.Random(2262)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    if not OPENENDS_FILE.exists():
        print(f"ERROR: open-ends file not found at {OPENENDS_FILE}", file=sys.stderr)
        sys.exit(1)

    # Find main CSV.
    main_csv = None
    for candidate in MAIN_CSV_DIR.glob("*.csv") if MAIN_CSV_DIR.is_dir() else []:
        main_csv = candidate
        break
    if main_csv is None:
        # Try direct path.
        direct = ANES_DIR / "anes_timeseries_2020_csv_20220210" / "anes_timeseries_2020_csv_20220210.csv"
        if direct.exists():
            main_csv = direct
    if main_csv is None:
        print(f"ERROR: main ANES CSV not found under {MAIN_CSV_DIR}", file=sys.stderr)
        sys.exit(1)

    print(f"Loading main ANES CSV from {main_csv}...", flush=True)
    demo = pd.read_csv(
        main_csv, usecols=["V200001", "V201507x", "V201600", "V201549x",
                           "V201617x", "V202468x", "V201231x"],
        low_memory=False,
    )
    print(f"  {len(demo)} respondents loaded", flush=True)

    # Build a lookup dict: respondent_id -> demographic dict.
    demo_lookup: dict[int, dict] = {}
    for _, r in demo.iterrows():
        rid = int(r["V200001"])
        demo_lookup[rid] = {
            "age_band": _age_label(int(r.get("V201507x", -1))),
            "sex": SEX_LABELS.get(int(r.get("V201600", -9))),
            "race": RACE_LABELS.get(int(r.get("V201549x", -9))),
            "education": EDUCATION_LABELS.get(int(r.get("V201617x", -9))),
            "party": PARTY_LABELS.get(int(r.get("V201231x", -9))),
            "income": _income_label(int(r.get("V202468x", -1))),
        }

    print(f"Loading open-ends from {OPENENDS_FILE}...", flush=True)
    sheets = pd.read_excel(OPENENDS_FILE, sheet_name=None)
    print(f"  Sheets: {list(sheets.keys())}", flush=True)

    all_rows: list[dict] = []
    for var_name, policy_text in OPENEND_VARS.items():
        if var_name not in sheets:
            print(f"  WARNING: sheet {var_name!r} not found; skipping", file=sys.stderr)
            continue
        df = sheets[var_name]
        # Identify the response text column (second column, after V200001).
        text_cols = [c for c in df.columns if c != "V200001"]
        if not text_cols:
            print(f"  WARNING: no text column in sheet {var_name!r}; skipping", file=sys.stderr)
            continue
        text_col = text_cols[0]
        print(f"  {var_name}: {df[text_col].notna().sum()} non-null rows, "
              f"col={text_col!r}", flush=True)

        for _, row in df.iterrows():
            rid = int(row["V200001"])
            text = str(row[text_col]).strip() if pd.notna(row[text_col]) else ""
            # ANES uses "-1" and similar codes for missing/refused.
            if not text or text in ("-1", "-9", "-8", "-7", "-6", "-5", "-4", "-3", "-2"):
                continue
            if len(text) < 5:
                continue

            demographics = demo_lookup.get(rid, {})
            # filter nulls before dropout/verbalize
            demo_clean = {k: v for k, v in demographics.items() if v}
            persona_str, kept = render_persona(demo_clean, rng)

            all_rows.append({
                "input": {
                    "persona_text": persona_str,
                    "policy_text": policy_text,
                    "spatial_features_text": None,
                },
                "output": text,
                "metadata": {
                    "source": "anes_2020",
                    "anes_variable": var_name,
                    "respondent_id": rid,
                    "persona_provenance": "real",
                    "demographics": demographics,
                    "persona_attrs_kept": kept,
                    "persona_text_renderer": "persona_to_text_v3",
                },
            })

    with open(out_path, "w", encoding="utf-8") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    print(f"\nWrote {len(all_rows)} rows to {out_path}")
    print("\nSpot-check (first 3 outputs):")
    for r in all_rows[:3]:
        print(f"  [{r['metadata']['anes_variable']}] {r['output'][:120]}")
    # Provenance breakdown.
    from collections import Counter
    var_counts = Counter(r["metadata"]["anes_variable"] for r in all_rows)
    print("\nRows per variable:")
    for var, count in sorted(var_counts.items()):
        print(f"  {var}: {count}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    main(args.out)
