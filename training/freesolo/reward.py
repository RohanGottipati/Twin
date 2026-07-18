"""GRPO reward sketch for CitizenReactionLM (docs/twinto-implementation.md §10.6)."""

from __future__ import annotations

from typing import Any

from schemas import validate_reaction


def score_reaction_batch(
    reactions: list[dict[str, Any]],
    *,
    aggregate_mode_share_fit: float = 0.5,
    aggregate_arrival_flow_fit: float = 0.5,
) -> float:
    if not reactions:
        return -3.0

    schema_validity = 1.0
    for row in reactions:
        if validate_reaction(row):
            schema_validity = 0.0
            break

    journey_feasibility = 1.0
    response_consistency = 1.0
    uncertainty_calibration = 1.0
    impossible_journey = 0.0
    contradiction = 0.0
    stereotype_penalty = 0.0
    excessive_mode_switching = 0.0
    demographic_calibration = 0.5

    return (
        2.0 * schema_validity
        + 1.5 * journey_feasibility
        + 1.5 * demographic_calibration
        + 2.0 * aggregate_mode_share_fit
        + 2.0 * aggregate_arrival_flow_fit
        + 1.0 * response_consistency
        + 1.0 * uncertainty_calibration
        - 3.0 * impossible_journey
        - 2.0 * contradiction
        - 2.0 * stereotype_penalty
        - 1.0 * excessive_mode_switching
    )
