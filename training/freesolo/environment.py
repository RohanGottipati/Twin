"""FreeSolo / Flash environment stub for TwinTO citizen-reaction GRPO."""

from __future__ import annotations

from typing import Any

from reward import score_reaction_batch


def score_response(sample: dict[str, Any], metadata: dict[str, Any]) -> dict[str, float]:
    """Flash-style score_response entrypoint.

    `sample` is model JSON; reward metadata (target distributions) lives under metadata.
    """
    reactions = sample.get("reactions") or []
    reward = score_reaction_batch(
        reactions,
        aggregate_mode_share_fit=float(metadata.get("aggregate_mode_share_fit", 0.5)),
        aggregate_arrival_flow_fit=float(metadata.get("aggregate_arrival_flow_fit", 0.5)),
    )
    return {"reward": reward}
