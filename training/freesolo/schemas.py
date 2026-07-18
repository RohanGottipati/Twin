"""CitizenReactionLM JSON contracts (mirror of src/lib/citizen-reaction/schemas.ts)."""

from __future__ import annotations

from typing import Any

REACTION_REQUIRED_KEYS = {
    "cohortId",
    "acceptance",
    "modeShiftProb",
    "preferredDepartureShiftMinutes",
    "rationale",
    "confidence",
}


def validate_reaction(row: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    missing = REACTION_REQUIRED_KEYS - set(row)
    if missing:
        errors.append(f"missing keys: {sorted(missing)}")
    if "acceptance" in row and not (0.0 <= float(row["acceptance"]) <= 1.0):
        errors.append("acceptance out of [0,1]")
    if "rationale" in row and not str(row["rationale"]).strip():
        errors.append("empty rationale")
    return errors
