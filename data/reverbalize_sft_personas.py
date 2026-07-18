"""Re-verbalize persona_text on existing SFT JSONL rows via the shared LLM
renderer (population.persona_text.render_persona). All sources get the same
voice/length; attribute dropout gives per-row variance.

Reads demographics / persona_attributes from metadata (already on disk),
so we do not re-parse ANES/Polis/Toronto raw sources.

    uv run python -m data.reverbalize_sft_personas [--workers 24] [--limit N]

Seed 2262. Overwrites the three source JSONLs, then rebuilds sft_all_rows
+ model/sft/dataset/train.jsonl.
"""

from __future__ import annotations

import argparse
import json
import random
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from population.persona_text import render_persona

SEED = 2262
PROCESSED = Path(__file__).resolve().parent / "processed"
SOURCES = [
    PROCESSED / "sft_anes_rows.jsonl",
    PROCESSED / "sft_polis_rows.jsonl",
    PROCESSED / "sft_toronto_consultation_rows.jsonl",
]
ALL_OUT = PROCESSED / "sft_all_rows.jsonl"
TRAIN_OUT = Path(__file__).resolve().parents[1] / "model" / "sft" / "dataset" / "train.jsonl"


def _attrs(row: dict) -> dict:
    meta = row.get("metadata") or {}
    raw = meta.get("persona_attributes") or meta.get("demographics") or {}
    return {k: v for k, v in raw.items() if v is not None and str(v).strip() not in ("", "None")}


def _one(i: int, row: dict) -> tuple[int, dict]:
    rng = random.Random(SEED + i * 9973)
    attrs = _attrs(row)
    text, kept = render_persona(attrs, rng)
    row = json.loads(json.dumps(row))  # shallow isolation across threads
    row["input"]["persona_text"] = text
    row["metadata"]["persona_attrs_kept"] = kept
    row["metadata"]["persona_text_renderer"] = "persona_to_text_v3"
    return i, row


def _reverbalize_file(path: Path, workers: int, limit: int | None) -> list[dict]:
    rows = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    if limit is not None:
        rows = rows[:limit]
    print(f"  {path.name}: {len(rows)} rows, workers={workers}", flush=True)

    out_rows = [None] * len(rows)
    done = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(_one, i, row): i for i, row in enumerate(rows)}
        for fut in as_completed(futs):
            i, row = fut.result()
            out_rows[i] = row
            done += 1
            if done % 200 == 0 or done == len(rows):
                print(f"    {path.name}: {done}/{len(rows)}", flush=True)

    tmp = path.with_suffix(".jsonl.tmp")
    with tmp.open("w") as f:
        for row in out_rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
    tmp.replace(path)
    return out_rows


def _merge(all_rows: list[dict]) -> None:
    rng = random.Random(SEED)
    rng.shuffle(all_rows)
    ALL_OUT.parent.mkdir(parents=True, exist_ok=True)
    TRAIN_OUT.parent.mkdir(parents=True, exist_ok=True)
    with ALL_OUT.open("w") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    with TRAIN_OUT.open("w") as f:
        for r in all_rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"merged {len(all_rows)} -> {ALL_OUT} and {TRAIN_OUT}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--limit", type=int, default=None, help="per-file cap, for smoke")
    args = ap.parse_args()

    merged = []
    for path in SOURCES:
        merged.extend(_reverbalize_file(path, args.workers, args.limit))
    _merge(merged)

    # quick length sanity
    lens = [len(r["input"]["persona_text"].split()) for r in merged]
    lens.sort()
    mid = lens[len(lens) // 2]
    print(f"persona word-len: min={lens[0]} median={mid} max={lens[-1]} n={len(lens)}")


if __name__ == "__main__":
    main()
