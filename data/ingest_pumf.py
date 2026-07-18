"""Extract and decode the Toronto-CMA subset of the StatCan 2021 Census
Individuals PUMF (980,868 records nationally; CMA==535 is Toronto).

Source files (user-provided, not committed -- see StatCan/doi-10/):
- Data/RAW/data_2021_ind_csv.zip: raw coded microdata (144 columns).
- Command Code/ipumf_2021_final_en.sps: SPSS read/value-label syntax,
  parsed programmatically by data/pumf_codebook.py.
- Doc/2021 Census Individuals PUMF User Guide.pdf: authoritative variable
  descriptions; used to fill in the handful of variables (TENUR) whose value
  labels are missing from the .sps VALUE LABELS block.

This is the individual-level seed with REAL joint correlations (age x
income x tenure x commute x immigration x ethnicity, etc.) for Toronto CMA,
to be reweighted (IPF/IPU) against each of the 158 neighbourhoods' real
marginal control totals from data/ingest_census.py. The PUMF's own geography
is CMA-level only -- no neighbourhood label exists on any individual record,
which is exactly why the fitting step is needed (see task tracker).
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pandas as pd

from data.pumf_codebook import load_value_labels

REPO_ROOT = Path(__file__).resolve().parent.parent
PUMF_ZIP = REPO_ROOT / "StatCan" / "doi-10" / "Data" / "RAW" / "data_2021_ind_csv.zip"
PUMF_CSV_MEMBER = "data_donnees_2021_ind.csv"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"
OUT_PATH = PROCESSED_DIR / "pumf_toronto.csv"

TORONTO_CMA_CODE = 535

# Supplement for variables whose value labels are missing from the .sps
# VALUE LABELS block but are documented in the PUMF User Guide PDF:
# - Tenur (p.134): Tenure. 1=Owner, 2=Renter (or dwelling provided by local
#   government/First Nation/Indian band), 8=Not available.
# - HHInc (p.106-107): NOT raw dollars despite the innocuous name -- it is a
#   33-band categorical income variable (confirmed: observed values in the
#   extracted data are bounded 1-33, not continuous dollar figures like
#   TotInc). Bands verified against the User Guide's own weighted/unweighted
#   count table for this variable.
MANUAL_VALUE_LABELS: dict[str, dict[int, str]] = {
    "TENUR": {1: "Owner", 2: "Renter", 8: "Not available"},
    "HHINC": {
        1: "Under $2,000",
        2: "$2,000 to $4,999",
        3: "$5,000 to $6,999",
        4: "$7,000 to $9,999",
        5: "$10,000 to $11,999",
        6: "$12,000 to $14,999",
        7: "$15,000 to $16,999",
        8: "$17,000 to $19,999",
        9: "$20,000 to $24,999",
        10: "$25,000 to $29,999",
        11: "$30,000 to $34,999",
        12: "$35,000 to $39,999",
        13: "$40,000 to $44,999",
        14: "$45,000 to $49,999",
        15: "$50,000 to $54,999",
        16: "$55,000 to $59,999",
        17: "$60,000 to $64,999",
        18: "$65,000 to $69,999",
        19: "$70,000 to $74,999",
        20: "$75,000 to $79,999",
        21: "$80,000 to $84,999",
        22: "$85,000 to $89,999",
        23: "$90,000 to $94,999",
        24: "$95,000 to $99,999",
        25: "$100,000 to $109,999",
        26: "$110,000 to $119,999",
        27: "$120,000 to $129,999",
        28: "$130,000 to $139,999",
        29: "$140,000 to $149,999",
        30: "$150,000 to $174,999",
        31: "$175,000 to $199,999",
        32: "$200,000 to $249,999",
        33: "$250,000 and over",
        88: "Not available",
    },
}
# Band midpoints for HHInc, for use as a quantitative approximation (IPF
# fitting, etc.) alongside the categorical label. $250k+ is left-censored so
# its midpoint is a judgment call, not a real band midpoint.
HHINC_BAND_MIDPOINT: dict[int, float] = {
    1: 1000, 2: 3500, 3: 6000, 4: 8500, 5: 11000, 6: 13500, 7: 16000, 8: 18500,
    9: 22500, 10: 27500, 11: 32500, 12: 37500, 13: 42500, 14: 47500, 15: 52500,
    16: 57500, 17: 62500, 18: 67500, 19: 72500, 20: 77500, 21: 82500, 22: 87500,
    23: 92500, 24: 97500, 25: 105000, 26: 115000, 27: 125000, 28: 135000,
    29: 145000, 30: 162500, 31: 187500, 32: 225000, 33: 300000,
}

# (output column, source column, sentinel codes treated as missing)
CATEGORICAL_VARS = {
    "age_group": "AGEGRP",
    "gender": "Gender",
    "tenure": "TENUR",
    "commute_mode": "MODE",
    "immigration_status": "IMMSTAT",
    "generation_status": "GENSTAT",
    "visible_minority": "VISMIN",
    "education": "HDGREE",
    "dwelling_type": "DTYPE",
    "household_type": "HHTYPE",
    "family_status": "CFSTAT",
    "mother_tongue_english": "MTNEn",
    "mother_tongue_french": "MTNFr",
    "household_income": "HHInc",
}
# Sentinel "not available"/"not applicable" codes vary per-variable; treat
# any value >= 88 that is present in that variable's own value-label dict as
# missing (StatCan convention: 88/888/etc = not available, 99/999/etc = not
# applicable), so decoding relies on the codebook's own labels, not a guess.
_MISSING_LABEL_SUBSTRINGS = ("not available", "not applicable")

QUANTITATIVE_VARS = {
    "total_income": "TotInc",
    "household_income_decile": "EFDecile",
}
# StatCan's standard sentinel pattern for quantitative fields on this file:
# repeated 8s (not available) or 9s (not applicable) filling the field width.
QUANTITATIVE_SENTINELS = {88888888, 99999999, 88, 99}


def _load_codebook() -> dict[str, dict[int, str]]:
    """Codebook variable names in the .sps VALUE LABELS block don't always
    match the CSV data column's exact casing (e.g. MTNEN vs MTNEn) -- index
    case-insensitively so lookups by the CSV's own column name work."""
    labels = load_value_labels()
    labels.update(MANUAL_VALUE_LABELS)
    return {name.upper(): codes for name, codes in labels.items()}


def _decode_categorical(series: pd.Series, value_labels: dict[int, str]) -> pd.Series:
    missing_codes = {
        code for code, label in value_labels.items() if any(s in label.lower() for s in _MISSING_LABEL_SUBSTRINGS)
    }
    decoded = series.map(value_labels)
    decoded[series.isin(missing_codes)] = None
    return decoded


def _clean_quantitative(series: pd.Series) -> pd.Series:
    return series.where(~series.isin(QUANTITATIVE_SENTINELS))


def extract_toronto_pumf() -> pd.DataFrame:
    value_labels = _load_codebook()

    with zipfile.ZipFile(PUMF_ZIP) as z:
        with z.open(PUMF_CSV_MEMBER) as f:
            raw = pd.read_csv(f)

    toronto = raw[raw["CMA"] == TORONTO_CMA_CODE].copy()

    out = pd.DataFrame(
        {
            "record_id": toronto["PPSORT"],
            "weight": toronto["WEIGHT"],
        }
    )
    for out_col, src_col in CATEGORICAL_VARS.items():
        out[out_col] = _decode_categorical(toronto[src_col], value_labels.get(src_col.upper(), {}))
    for out_col, src_col in QUANTITATIVE_VARS.items():
        out[out_col] = _clean_quantitative(toronto[src_col])
    out["household_income_band_midpoint"] = toronto["HHInc"].map(HHINC_BAND_MIDPOINT)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_PATH, index=False)
    print(f"[pumf_toronto] {len(raw)} national rows -> {len(out)} Toronto-CMA rows, written to {OUT_PATH}")
    return out


if __name__ == "__main__":
    extract_toronto_pumf()
