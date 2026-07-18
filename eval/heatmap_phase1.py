"""Phase 1 gate pipeline (implementation_plan.md):

    "Simplest simulator: prompt an off-the-shelf Qwen (via the Flash
    endpoint) with persona + a hand-written policy context; get an opinion;
    score with a placeholder sentiment probe. Aggregate census-weighted
    valences into a neighbourhood heatmap. Render to a static file."

Gate: "For one hand-authored policy, the pipeline produces a heatmap where
directly-affected areas differ visibly from unaffected ones. Eyeball sanity
only; calibration comes next."

This script is the actual gate check, runnable end to end:
    uv run python -m eval.heatmap_phase1 --n-personas 150

The hand-authored policy: a new streetcar stop added at a real point on the
existing (Ward 13) street network. It's applied as a genuine `patch()` on
the twin (not just a string), so the resulting TwinState is versioned and
diffed exactly like the Phase 0 gate test does -- Phase 1 reuses Phase 0's
compiler rather than reimplementing "add a stop" as a one-off.

No exact feature graph yet (that's Phase 3): "directly affected" is a
simple straight-line distance threshold from each persona's home to the new
stop, not a real network/commute-time computation.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from shapely.geometry import shape

from model.scorer.placeholder import score_opinion
from model.serving import NoLLMBackendAvailable, complete_chat
from population.sampler import sample_population
from twin.diff import diff
from twin.schema import Edit
from twin.state import TwinState, patch

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

NEAR_THRESHOLD_M = 1000.0

POLICY_TEXT = (
    "The City of Toronto is adding a new streetcar stop on the downtown "
    "streetcar network. To help pay for it, on-street parking rates are "
    "increasing 5% citywide, for everyone who parks on the street, "
    "regardless of whether the new stop is near them."
)

PROMPT_TEMPLATE = """You are a resident of Toronto responding informally to a proposed city change, as yourself -- not as an official or expert. Stay in character as this one resident. Write 2-4 sentences, first person, plain conversational language.

Your situation:
- You live in the {neighbourhood} neighbourhood.
- Your age group is {age_band}.
- You {tenure_phrase} your home.
- You usually commute by {commute_mode}.
- The proposed new streetcar stop would be about {distance_m:.0f} meters from your home: {practical_note}

The proposed change: {policy_text}

Write your honest, brief reaction as this resident. Do not use headers or bullet points, just the reaction itself."""

TENURE_PHRASES = {"owner": "own", "renter": "rent"}
NEAR_PRACTICAL_NOTE = (
    "close enough to walk to and realistically use for some of your trips, "
    "so you'd get some direct benefit from it"
)
FAR_PRACTICAL_NOTE = (
    "too far away to realistically walk to or use for your trips, "
    "so it would not change your day-to-day travel at all"
)


def _new_stop_location(state: TwinState) -> tuple[float, float]:
    """A real street coordinate near the centroid of the study area's
    buildings, so a meaningful share of sampled persona homes end up within
    NEAR_THRESHOLD_M -- otherwise "near" vs "far" is too imbalanced to say
    anything. Still a real point on the street network (on-network per
    Phase 0's invariants), just chosen by proximity-to-centroid instead of
    an arbitrary index."""
    buildings = state.all_features("buildings")
    centroids = [shape(b.geometry.model_dump()).centroid for b in buildings]
    cx = sum(c.x for c in centroids) / len(centroids)
    cy = sum(c.y for c in centroids) / len(centroids)

    best = None
    best_dist = float("inf")
    for street in state.all_features("streets"):
        geom = shape(street.geometry.model_dump())
        lines = list(geom.geoms) if geom.geom_type == "MultiLineString" else [geom]
        for line in lines:
            mid = line.interpolate(0.5, normalized=True)
            d = (mid.x - cx) ** 2 + (mid.y - cy) ** 2
            if d < best_dist:
                best_dist = d
                best = (mid.x, mid.y)
    assert best is not None
    return best[0] + 3.0, best[1] + 3.0


def apply_hand_authored_policy(state: TwinState) -> tuple[TwinState, tuple[float, float]]:
    x, y = _new_stop_location(state)
    edit = Edit(
        op="add",
        layer="transit_stops",
        feature_id="transit_stops:phase1-new-stop",
        feature={
            "geometry": {"type": "Point", "coordinates": [x, y]},
            "stop_name": "Phase 1 Pilot Stop",
            "mode": "streetcar",
        },
    )
    new_state = patch(state, [edit])
    return new_state, (x, y)


def run_pipeline(n_personas: int, seed: int, model: str | None, max_tokens: int) -> pd.DataFrame:
    base_state = TwinState.load_from_processed(PROCESSED_DIR)
    new_state, stop_xy = apply_hand_authored_policy(base_state)

    d = diff(base_state, new_state)
    print(d.summary())
    assert "transit_stops:phase1-new-stop" in d.layers["transit_stops"].added

    census = pd.read_csv(PROCESSED_DIR / "census_profile.csv")
    neighbourhoods = gpd.read_file(PROCESSED_DIR / "neighbourhoods.geojson")
    personas = sample_population(new_state, census, neighbourhoods, n_personas=n_personas, seed=seed)
    if not personas:
        raise RuntimeError("sample_population returned no personas -- check twin/census data")

    rows = []
    for persona in personas:
        dist = ((persona.home_x - stop_xy[0]) ** 2 + (persona.home_y - stop_xy[1]) ** 2) ** 0.5
        is_near = dist <= NEAR_THRESHOLD_M
        practical_note = NEAR_PRACTICAL_NOTE if is_near else FAR_PRACTICAL_NOTE
        prompt = PROMPT_TEMPLATE.format(
            neighbourhood=persona.neighbourhood_name,
            age_band=persona.age_band,
            tenure_phrase=TENURE_PHRASES[persona.tenure],
            commute_mode=persona.commute_mode,
            distance_m=dist,
            practical_note=practical_note,
            policy_text=POLICY_TEXT,
        )
        opinion = complete_chat(
            [{"role": "user", "content": prompt}],
            model=model,
            temperature=0.9,
            max_tokens=max_tokens,
        )
        valence = score_opinion(opinion)
        rows.append(
            {
                "persona_id": persona.id,
                "neighbourhood_code": persona.neighbourhood_code,
                "neighbourhood_name": persona.neighbourhood_name,
                "age_band": persona.age_band,
                "tenure": persona.tenure,
                "commute_mode": persona.commute_mode,
                "distance_to_change_m": dist,
                "near": dist <= NEAR_THRESHOLD_M,
                "opinion_text": opinion,
                "valence": valence,
            }
        )

    return pd.DataFrame(rows)


def render_heatmap(results: pd.DataFrame, out_path: Path) -> pd.DataFrame:
    neighbourhoods = gpd.read_file(PROCESSED_DIR / "neighbourhoods.geojson")
    neighbourhoods["AREA_SHORT_CODE"] = neighbourhoods["AREA_SHORT_CODE"].astype(str).str.zfill(3)
    agg = results.groupby("neighbourhood_code")["valence"].agg(["mean", "count"]).reset_index()
    agg["neighbourhood_code"] = agg["neighbourhood_code"].astype(str).str.zfill(3)
    merged = neighbourhoods.merge(agg, left_on="AREA_SHORT_CODE", right_on="neighbourhood_code", how="left")

    # Phase 1 effect sizes are small (this is a 7B off-the-shelf model with a
    # placeholder scorer, not a calibrated one -- see OVERNIGHT_LOG.md). A
    # fixed 0-1 colour scale, appropriate once real polarized opinions are in
    # play, would compress this run's real ~0.55-0.60 spread into
    # indistinguishable shades and defeat the gate's own "eyeball sanity"
    # check. Scale to the actual observed range instead, so the true
    # (small but real) gradient is visible; the colourbar tick labels make
    # the narrow range explicit rather than hiding it.
    vmin = float(merged["mean"].min())
    vmax = float(merged["mean"].max())

    fig, ax = plt.subplots(figsize=(8, 8))
    merged.plot(
        column="mean",
        ax=ax,
        legend=True,
        cmap="RdYlGn",
        vmin=vmin,
        vmax=vmax,
        missing_kwds={"color": "lightgrey", "label": "no personas"},
        edgecolor="black",
        linewidth=0.5,
    )
    ax.set_title(
        "Phase 1: mean predicted valence by neighbourhood\n"
        f"(hand-authored policy: new streetcar stop; colour range [{vmin:.3f}, {vmax:.3f}])"
    )
    ax.set_axis_off()
    fig.tight_layout()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out_path, dpi=150)
    plt.close(fig)
    return merged[["AREA_SHORT_CODE", "mean", "count"]]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-personas", type=int, default=150)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--model", type=str, default=None)
    parser.add_argument("--max-tokens", type=int, default=200)
    args = parser.parse_args()

    try:
        results = run_pipeline(args.n_personas, args.seed, args.model, args.max_tokens)
    except NoLLMBackendAvailable as exc:
        print(f"BLOCKED: {exc}")
        raise SystemExit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results.to_csv(OUTPUT_DIR / "phase1_personas.csv", index=False)

    near = results[results["near"]]["valence"]
    far = results[~results["near"]]["valence"]
    summary = {
        "n_personas": len(results),
        "n_near": len(near),
        "n_far": len(far),
        "mean_valence_near": float(near.mean()) if len(near) else None,
        "mean_valence_far": float(far.mean()) if len(far) else None,
    }
    print(json.dumps(summary, indent=2))
    (OUTPUT_DIR / "phase1_summary.json").write_text(json.dumps(summary, indent=2))

    agg = render_heatmap(results, OUTPUT_DIR / "phase1_heatmap.png")
    agg.to_csv(OUTPUT_DIR / "phase1_neighbourhood_agg.csv", index=False)
    print(f"Heatmap written to {OUTPUT_DIR / 'phase1_heatmap.png'}")


if __name__ == "__main__":
    main()
