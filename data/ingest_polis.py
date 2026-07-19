"""Polis SFT row ingestion (implementation_plan.md Phase 4, SFT data).

Source: compdemocracy/openData on GitHub (CC-BY-4.0 licence -- public,
redistribution-permitted). The repo hosts 20 conversation directories total;
11 are included here (English-language only -- vtaiwan.uberx and the four
austria-climate.* threads are Chinese/German and excluded to keep training
text monolingual, matching the opinion model's English output;
bg2050-volunteers is excluded because its participants-votes.csv 404s, no
real vote data available for it).

SFT output contract (AGENTS.md 5.1):
    input  = persona + policy + spatial_features (null; Polis not geo-specific)
    output = the REAL human-written Polis comment, byte-for-byte
    metadata: source, persona_provenance, conversation, comment_id,
              real_vote_distribution

Personas: synthetic via population.persona_text.generate_synthetic_attributes,
tagged persona_provenance = "synthetic" -- Polis participants are anonymous.

real_vote_distribution: fraction of {agree, disagree, pass} votes per comment
from participants-votes.csv. Stored for later GRPO group-reward use (AGENTS.md 5.2).

Only moderated==1 comments included (accepted, on-topic, not spam/abuse).

Run: uv run python -m data.ingest_polis [--out PATH]
"""

from __future__ import annotations

import argparse
import io
import json
import random
import sys
from pathlib import Path

import pandas as pd
import requests

from population.persona_text import generate_synthetic_attributes, render_persona

CONVERSATIONS: dict[str, dict] = {
    "15-per-hour-seattle": {
        "policy_text": (
            "The city of Seattle is considering raising the minimum wage to $15 per hour. "
            "Should the city adopt a $15/hour minimum wage?"
        ),
        "title": "Seattle $15/hr minimum wage",
    },
    "canadian-electoral-reform": {
        "policy_text": (
            "Canada is considering changing its voting system from first-past-the-post "
            "to an alternative (proportional representation or ranked ballot). "
            "Should Canada reform its electoral system, and if so how?"
        ),
        "title": "Canadian electoral reform",
    },
    "scoop-hivemind.taxes": {
        "policy_text": (
            "New Zealand is discussing changes to tax policy including capital gains tax, "
            "land value tax, and income tax reform. What tax changes, if any, should be made?"
        ),
        "title": "Scoop Hivemind: NZ tax policy",
    },
    "london.youth.policing": {
        "policy_text": (
            "London is considering changes to youth policing policy: how police interact with "
            "young people, stop-and-search practices, and community alternatives. "
            "What approach to youth policing should London take?"
        ),
        "title": "London youth policing",
    },
    "american-assembly.bowling-green": {
        "policy_text": (
            "What do you believe should change in Bowling Green/Warren County, Kentucky, "
            "in order to make it a better place to live, work, and spend time?"
        ),
        "title": "Improving Bowling Green / Warren County",
    },
    "football-concussions": {
        "policy_text": (
            "Is the concussion and CTE crisis the end of the NFL? "
            "What should be done about football-related brain injuries?"
        ),
        "title": "Concussions in the NFL",
    },
    "march-on.operation-marchin-orders": {
        "policy_text": (
            "What does the collective movement want? What are we fighting for? "
            "What direction do we want to see our country go, and what are the "
            "'marching orders' we are going to give our elected officials?"
        ),
        "title": "Operation Marching Orders",
    },
    "scoop-hivemind.affordable-housing": {
        "policy_text": "What ideas would help crack housing affordability in New Zealand?",
        "title": "ScoopNZ Hivemind on affordable housing",
    },
    "scoop-hivemind.biodiversity": {
        "policy_text": "What should New Zealand do to protect and restore its biodiversity?",
        "title": "Protecting and Restoring NZ's Biodiversity",
    },
    "scoop-hivemind.freshwater": {
        "policy_text": "What should be done to protect and improve freshwater quality in New Zealand?",
        "title": "HiveMind - Freshwater Quality in NZ",
    },
    "scoop-hivemind.ubi": {
        "policy_text": "Should Aotearoa New Zealand adopt a Universal Basic Income (UBI)?",
        "title": "A Universal Basic Income for Aotearoa NZ?",
    },
    "ssis.land-bank-farmland.2rumnecbeh.2021-08-01": {
        "policy_text": (
            "How should the San Juan Islands Land Bank and community adapt land use and "
            "conservation policy to best address the community's interests in farmland "
            "and land conservation?"
        ),
        "title": "Land use and conservation in the San Juan Islands",
    },
}

GITHUB_RAW = "https://raw.githubusercontent.com/compdemocracy/openData/master"
PROCESSED_DIR = Path(__file__).resolve().parent / "processed"
DEFAULT_OUT = PROCESSED_DIR / "sft_polis_rows.jsonl"


def _fetch_csv(conversation: str, filename: str) -> pd.DataFrame:
    url = f"{GITHUB_RAW}/{conversation}/{filename}"
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    return pd.read_csv(io.StringIO(resp.text))


def _vote_distribution(votes_df: pd.DataFrame, comment_id: int) -> dict:
    col = str(comment_id)
    if col not in votes_df.columns:
        return {}
    col_data = votes_df[col].dropna()
    total = len(col_data)
    if total == 0:
        return {}
    return {
        "agree": float((col_data == 1).sum()) / total,
        "disagree": float((col_data == -1).sum()) / total,
        "pass": float((col_data == 0).sum()) / total,
        "n_votes": total,
    }


def ingest_conversation(conversation_id: str, meta: dict, rng: random.Random) -> list[dict]:
    print(f"  Fetching {conversation_id}...", flush=True)
    try:
        comments = _fetch_csv(conversation_id, "comments.csv")
        votes = _fetch_csv(conversation_id, "participants-votes.csv")
    except requests.HTTPError as exc:
        print(f"  WARNING: {conversation_id} fetch failed ({exc}); skipping", file=sys.stderr)
        return []

    accepted = comments[
        (comments["moderated"] == 1) & (comments["comment-body"].notna())
    ].copy()
    accepted = accepted[accepted["comment-body"].str.strip() != ""]
    print(f"    {len(accepted)} moderated comments", flush=True)

    rows = []
    for _, row in accepted.iterrows():
        comment_id = int(row["comment-id"])
        comment_text = str(row["comment-body"]).strip()
        attrs = generate_synthetic_attributes(rng)
        persona_text, kept = render_persona(attrs, rng)
        vote_dist = _vote_distribution(votes, comment_id)
        rows.append({
            "input": {
                "persona_text": persona_text,
                "policy_text": meta["policy_text"],
                "spatial_features_text": None,
            },
            "output": comment_text,
            "metadata": {
                "source": "polis",
                "conversation": conversation_id,
                "conversation_title": meta["title"],
                "comment_id": comment_id,
                "agrees": int(row.get("agrees", 0)),
                "disagrees": int(row.get("disagrees", 0)),
                "real_vote_distribution": vote_dist,
                "persona_provenance": "synthetic",
                "persona_attributes": attrs,
                "persona_attrs_kept": kept,
                "persona_text_renderer": "persona_to_text_v3",
            },
        })
    return rows


def main(out_path: Path = DEFAULT_OUT) -> None:
    rng = random.Random(42)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    all_rows: list[dict] = []
    for conv_id, meta in CONVERSATIONS.items():
        rows = ingest_conversation(conv_id, meta, rng)
        all_rows.extend(rows)
        print(f"    -> {len(rows)} rows from {conv_id}", flush=True)

    with open(out_path, "w", encoding="utf-8") as f:
        for row in all_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")

    print(f"\nWrote {len(all_rows)} rows to {out_path}")
    print("\nSpot-check (first 3 outputs):")
    for row in all_rows[:3]:
        print(f"  [{row['metadata']['conversation']}] {row['output'][:120]}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()
    main(args.out)
