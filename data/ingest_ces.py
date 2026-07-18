"""Extract party identification and left-right ideology from the 2021
Canadian Election Study (CES), filtered to Ontario respondents (the CES
public release has no finer geography than province -- there is no
Toronto-specific or CMA-level identifier, so Ontario is the best available
regional proxy).

Grounds the currently-unsourced `party`/`ideology` persona attribute bins in
population/persona_text.py in real survey responses, alongside demographic
correlates (age, gender, education, income) so party/ideology can eventually
be attached to a persona's other attributes in a way that reflects real
joint patterns, not an arbitrary assignment.

Source: CES/dataverse_files/2021 Canadian Election Study v2.0.dta
(20,968 national respondents; public release, no login needed once
downloaded from the Borealis/Dataverse guestbook).
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

REPO_ROOT = Path(__file__).resolve().parent.parent
CES_DTA_PATH = REPO_ROOT / "CES" / "dataverse_files" / "2021 Canadian Election Study v2.0.dta"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
OUT_PATH = PROCESSED_DIR / "ces_ontario.csv"

ONTARIO_PROVINCE_CODE = 9

# cps21_lr_scale_bef_1: 0 (left) to 10 (right) self-placement; -99 = skipped/not asked.
LR_SCALE_MISSING = {-99}

GENDER_LABELS = {1: "A man", 2: "A woman", 3: "Non-binary", 4: "Another gender"}
EDUCATION_LABELS = {
    1: "No schooling",
    2: "Some elementary school",
    3: "Completed elementary school",
    4: "Some secondary/high school",
    5: "Completed secondary/high school",
    6: "Some college/CEGEP",
    7: "Completed college/CEGEP",
    8: "Some university",
    9: "Bachelor's degree",
    10: "Master's degree",
    11: "Professional degree or doctorate",
}
# Codes meaning "don't know / prefer not to answer" per-variable -- decoded
# to null rather than kept as a fake category.
_DONT_KNOW_CODES = {"cps21_education": 12}

# cps21_income_number is the primary income question (asked to everyone,
# unlike cps21_income_cat which is a skip-logic fallback answered by <5% of
# respondents and therefore mostly null -- not used here). -99 = refused;
# values above $2,000,000 are implausible self-report junk (e.g. 1e9, 1e14),
# not real high incomes, and are dropped rather than top-coded as if real.
_INCOME_MISSING = {-99}
_INCOME_PLAUSIBLE_MAX = 2_000_000
INCOME_BAND_EDGES = [0, 30_000, 60_000, 90_000, 110_000, 150_000, 200_000, float("inf")]
INCOME_BAND_LABELS = [
    "$1 to $30,000",
    "$30,001 to $60,000",
    "$60,001 to $90,000",
    "$90,001 to $110,000",
    "$110,001 to $150,000",
    "$150,001 to $200,000",
    "More than $200,000",
]


def extract_ontario_ces() -> pd.DataFrame:
    raw = pd.read_stata(CES_DTA_PATH, convert_categoricals=False)
    ontario = raw[raw["cps21_province"] == ONTARIO_PROVINCE_CODE].copy()

    out = pd.DataFrame(
        {
            "respondent_id": ontario.index,
            "party_id": ontario["pid_party_en"].replace("", None),
        }
    )
    lr = ontario["cps21_lr_scale_bef_1"]
    out["ideology_lr_scale"] = lr.where(~lr.isin(LR_SCALE_MISSING))

    gender = ontario["cps21_genderid"]
    out["gender"] = gender.where(gender.notna()).map(GENDER_LABELS)

    education = ontario["cps21_education"]
    out["education"] = education.where(education != _DONT_KNOW_CODES["cps21_education"]).map(EDUCATION_LABELS)

    income = ontario["cps21_income_number"]
    clean_income = income.where(~income.isin(_INCOME_MISSING) & (income >= 0) & (income <= _INCOME_PLAUSIBLE_MAX))
    out["income"] = clean_income
    out["income_band"] = pd.cut(clean_income, bins=INCOME_BAND_EDGES, labels=INCOME_BAND_LABELS, right=True)

    out["age"] = ontario["cps21_age"]

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_PATH, index=False)
    print(f"[ces_ontario] {len(raw)} national respondents -> {len(out)} Ontario rows, written to {OUT_PATH}")
    return out


if __name__ == "__main__":
    extract_ontario_ces()
