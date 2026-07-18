"""Phase 3 gate (implementation_plan.md): counterfactual test for the
`SPATIAL:` feature block built in `twin/features/spatial.py`.

    "Re-run Phase 1's loop; confirm bundled policies (tram + parking tax)
    now produce mixed, spatially-sensible opinions."

    Gate: "Counterfactual test: for a persona the change does not touch,
    the opinion and opinion_score are near-neutral; move that persona next to
    the change and the opinion_score shifts in the correct direction and
    magnitude. If it does not, the feature injection is broken; fix
    before proceeding."

Uses a clean, single-direction hand-authored policy -- a new transit stop
only, no offsetting cost -- so the counterfactual has an unambiguous
predicted direction: closer should read more positive. Phase 1's
tram+parking-tax bundle was deliberately mixed (to test whether the
pipeline could produce a *spatial gradient* at all); here the goal is
narrower and different -- verifying the `SPATIAL:` feature *injection*
itself moves the outcome the right way, which needs a policy with only one
effect direction to be a clean test.

Two personas, identical demographics, different real homes (real buildings
in the twin, not synthetic points): one far from the new stop (the
counterfactual "untouched" case), one on top of it (the "moved next to the
change" case). Each sampled `N_SAMPLES_PER_PERSONA` times (not once --
Phase 1 already showed small samples can flip sign from LM noise alone;
comparing means over an adequately sized sample is the honest way to do
this, not a single completion per persona).

Run: `uv run python -m eval.spatial_counterfactual`
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from shapely.geometry import shape

from model.scorer.placeholder import score_opinion
from model.serving import NoLLMBackendAvailable, complete_chat
from population.sampler import Persona
from twin.diff import diff
from twin.features.spatial import build_spatial_block, compute_spatial_features
from twin.network import shortest_path_length_m, street_graph
from twin.schema import Edit
from twin.state import TwinState, patch

PROCESSED_DIR = Path(__file__).resolve().parent.parent / "data" / "processed"
OUTPUT_DIR = Path(__file__).resolve().parent / "output"

POLICY_TEXT = (
    "The City of Toronto is adding a new streetcar stop on the downtown streetcar network. "
    "No fare changes, no tax changes, and no other service changes are part of this proposal."
)

PROMPT_TEMPLATE = """You are a resident of Toronto responding informally to a proposed city change, as yourself -- not as an official or expert. Stay in character as this one resident. Write 2-4 sentences, first person, plain conversational language.

Your situation:
- You live in the {neighbourhood} neighbourhood.
- Your age group is {age_band}.
- You {tenure_phrase} your home.
- You usually commute by {commute_mode}.

{spatial_block}

The proposed change: {policy_text}

Write your honest, brief reaction as this resident. Do not use headers or bullet points, just the reaction itself."""

TENURE_PHRASES = {"owner": "own", "renter": "rent"}

N_SAMPLES_PER_PERSONA = 20
FAR_MIN_DISTANCE_M = 2000.0  # "untouched" persona must be at least this far, network distance


def _new_stop_location(state: TwinState) -> tuple[float, float]:
    """Same centroid-nearest-street-point approach as eval/heatmap_phase1.py,
    for consistency: a real street coordinate near the middle of the study
    area, so both a "near" and a genuinely "far" (>2km network distance)
    real building can be found within the bounded twin."""
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


def apply_new_stop_only(state: TwinState) -> tuple[TwinState, tuple[float, float]]:
    x, y = _new_stop_location(state)
    edit = Edit(
        op="add",
        layer="transit_stops",
        feature_id="transit_stops:phase3-counterfactual-stop",
        feature={"geometry": {"type": "Point", "coordinates": [x, y]}, "stop_name": "Phase 3 Test Stop", "mode": "streetcar"},
    )
    return patch(state, [edit]), (x, y)


def _find_near_and_far_buildings(state: TwinState, stop_xy: tuple[float, float]) -> tuple[dict, dict]:
    """Real buildings in the twin: the closest one to the new stop (by
    street-network distance) for the "moved next to the change" persona,
    and the farthest reachable one for the "untouched" persona."""
    graph = street_graph(state, weighted=True)
    buildings = state.all_features("buildings")

    scored = []
    for b in buildings:
        centroid = shape(b.geometry.model_dump()).centroid
        home = (centroid.x, centroid.y)
        dist = shortest_path_length_m(graph, home, stop_xy)
        if dist is not None:
            scored.append({"feature_id": b.id, "x": home[0], "y": home[1], "dist": dist})

    scored.sort(key=lambda r: r["dist"])
    near = scored[0]
    far_candidates = [r for r in scored if r["dist"] >= FAR_MIN_DISTANCE_M]
    far = far_candidates[-1] if far_candidates else scored[-1]
    return near, far


def _base_persona(neighbourhood_name: str, home: dict) -> Persona:
    return Persona(
        id=f"persona:counterfactual-{home['feature_id']}",
        neighbourhood_code="000",
        neighbourhood_name=neighbourhood_name,
        home_feature_id=home["feature_id"],
        home_x=home["x"],
        home_y=home["y"],
        age_band="15-64",
        tenure="renter",
        commute_mode="transit",
        neighbourhood_median_income=None,
    )


def _sample_opinion_scores(persona: Persona, before: TwinState, after: TwinState, n_samples: int, model: str | None) -> dict:
    features = compute_spatial_features(persona, before, after)
    spatial_block = build_spatial_block(features)
    prompt = PROMPT_TEMPLATE.format(
        neighbourhood=persona.neighbourhood_name,
        age_band=persona.age_band,
        tenure_phrase=TENURE_PHRASES[persona.tenure],
        commute_mode=persona.commute_mode,
        spatial_block=spatial_block,
        policy_text=POLICY_TEXT,
    )
    opinion_scores = []
    opinions = []
    for _ in range(n_samples):
        opinion = complete_chat([{"role": "user", "content": prompt}], model=model, temperature=0.9, max_tokens=150)
        opinion_scores.append(score_opinion(opinion))
        opinions.append(opinion)
    return {
        "persona_id": persona.id,
        "distance_to_change_m": features.distance_to_change_m,
        "on_corridor": features.on_corridor,
        "transit_access_time_before_min": features.transit_access_time_before_min,
        "transit_access_time_after_min": features.transit_access_time_after_min,
        "spatial_block": spatial_block,
        "opinion_scores": opinion_scores,
        "mean_opinion_score": sum(opinion_scores) / len(opinion_scores),
        "sample_opinion": opinions[0],
    }


def run_counterfactual(n_samples: int = N_SAMPLES_PER_PERSONA, model: str | None = None) -> dict:
    before = TwinState.load_from_processed(PROCESSED_DIR)
    after, stop_xy = apply_new_stop_only(before)

    d = diff(before, after)
    assert "transit_stops:phase3-counterfactual-stop" in d.layers["transit_stops"].added

    near_home, far_home = _find_near_and_far_buildings(before, stop_xy)

    near_persona = _base_persona("Test Neighbourhood", near_home)
    far_persona = _base_persona("Test Neighbourhood", far_home)

    near_result = _sample_opinion_scores(near_persona, before, after, n_samples, model)
    far_result = _sample_opinion_scores(far_persona, before, after, n_samples, model)

    return {
        "new_stop_location": stop_xy,
        "near": near_result,
        "far": far_result,
        "mean_opinion_score_delta": near_result["mean_opinion_score"] - far_result["mean_opinion_score"],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--n-samples", type=int, default=N_SAMPLES_PER_PERSONA)
    parser.add_argument("--model", type=str, default=None)
    args = parser.parse_args()

    try:
        results = run_counterfactual(args.n_samples, args.model)
    except NoLLMBackendAvailable as exc:
        print(f"BLOCKED: {exc}")
        raise SystemExit(1)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "phase3_counterfactual_summary.json").write_text(json.dumps(results, indent=2, default=str))
    print(json.dumps(results, indent=2, default=str))


if __name__ == "__main__":
    main()
