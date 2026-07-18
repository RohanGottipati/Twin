"""Local smoke: sample SFT rows (already LLM-verbalized personas) and
generate model opinions via vLLM for manual inspection.

    uv run python -m eval.smoke_sft_generations [--n-per-source 3]

Seed 2262.
"""

from __future__ import annotations

import argparse
import json
import random
from collections import defaultdict
from pathlib import Path

from model.scorer.placeholder import score_opinion
from model.serving import complete_chat
from model.sft.prompt import build_user_content

SEED = 2262
ALL_ROWS = Path("data/processed/sft_all_rows.jsonl")
DEFAULT_OUT = Path("data/processed/smoke_sft_examples.jsonl")
DEFAULT_TXT = Path("data/processed/smoke_sft_examples.txt")


def _load_by_source(path: Path) -> dict[str, list]:
    by_src = defaultdict(list)
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            src = row.get("metadata", {}).get("source", "unknown")
            by_src[src].append(row)
    return by_src


def _sample(by_src: dict[str, list], n_per: int, rng: random.Random) -> list[dict]:
    picked = []
    for src in sorted(by_src.keys()):
        pool = by_src[src]
        k = min(n_per, len(pool))
        picked.extend(rng.sample(pool, k))
    return picked


def _fmt_block(ex: dict) -> str:
    lines = [
        "=" * 72,
        f"id={ex['id']}  source={ex['source']}  opinion_score={ex['model_opinion_score']:.3f}",
        "-" * 72,
        "ATTRS KEPT:",
        json.dumps(ex.get("attrs_kept") or {}, ensure_ascii=False),
        "",
        "PERSONA:",
        ex["persona_text"],
        "",
        "POLICY:",
        ex["policy_text"],
        "",
        "--- GOLD (human) ---",
        ex["gold_output"],
        "",
        "--- MODEL (pre-SFT Qwen2.5-7B) ---",
        ex["model_output"],
        "",
    ]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-per-source", type=int, default=3)
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--txt", type=Path, default=DEFAULT_TXT)
    ap.add_argument("--temprature", type=float, default=0.9)
    ap.add_argument("--temperature", type=float, default=None)
    ap.add_argument("--max-tokens", type=int, default=512)
    args = ap.parse_args()
    temp = args.temperature if args.temperature is not None else args.temprature

    rng = random.Random(SEED)
    by_src = _load_by_source(ALL_ROWS)
    print(f"loaded sources: {{{', '.join(f'{k}:{len(v)}' for k,v in sorted(by_src.items()))}}}")
    sample_row = next(iter(by_src.values()))[0]
    print(f"renderer tag: {sample_row.get('metadata',{}).get('persona_text_renderer')}")
    rows = _sample(by_src, args.n_per_source, rng)
    print(f"sampling {len(rows)} rows, temp={temp}")

    examples = []
    for i, row in enumerate(rows):
        inp = row["input"]
        print(f"  [{i+1}/{len(rows)}] {row['metadata'].get('source')} ...", flush=True)
        prompt = build_user_content(inp)
        model_out = complete_chat(
            [{"role": "user", "content": prompt}],
            temperature=temp,
            max_tokens=args.max_tokens,
        )
        score = score_opinion(model_out)
        ex = {
            "id": i,
            "source": row["metadata"].get("source"),
            "attrs_kept": row["metadata"].get("persona_attrs_kept"),
            "persona_text": inp.get("persona_text"),
            "policy_text": inp.get("policy_text"),
            "spatial_features_text": inp.get("spatial_features_text"),
            "prompt": prompt,
            "gold_output": row["output"],
            "model_output": model_out,
            "model_opinion_score": score,
            "metadata": row.get("metadata"),
        }
        examples.append(ex)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w") as f:
        for ex in examples:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    txt = "\n".join(_fmt_block(ex) for ex in examples)
    args.txt.write_text(txt, encoding="utf-8")

    lens = [len(ex["persona_text"].split()) for ex in examples]
    print(f"\npersona words: {lens}")
    print(f"wrote {len(examples)} -> {args.out}")
    print(f"wrote readable -> {args.txt}")
    print("\n" + txt)


if __name__ == "__main__":
    main()
