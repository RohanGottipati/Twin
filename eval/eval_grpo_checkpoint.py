"""Judge-match eval for SFT e2 vs GRPO ckpts on a shared OpinionQA sample.

  PYTHONPATH=. python eval/eval_grpo_checkpoint.py --n 128
  PYTHONPATH=. python eval/eval_grpo_checkpoint.py --n 128 --only grpo_step40

Seed 2262. Restores SFT e2 after.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import random
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from openai import OpenAI

from model.grpo.judge import judge_choice
from model.grpo.prompt import build_judge_prompt, build_student_prompt

SEED = 2262
OUT = Path("eval/output/grpo_ckpt_eval")

CKPTS = {
    "sft_e2_step1850": ("flash-1784401342-0d51be72/step-1850", "1850", "flash-1784401342-0d51be72"),
    "grpo_step20": ("flash-1784430260-04bc1f31/step-20", "20", "flash-1784430260-04bc1f31"),
    "grpo_step40": ("flash-1784430260-04bc1f31/step-40", "40", "flash-1784430260-04bc1f31"),
}


def load_env() -> None:
    for line in Path(".env").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k in ("FREESOLO_API_KEY", "OPENROUTER_API_KEY", "FREESOLO_BASE_URL"):
            os.environ[k] = v


def fs() -> OpenAI:
    base = os.environ.get(
        "FREESOLO_BASE_URL",
        "https://clado-ai--freesolo-lora-serving.modal.run/v1",
    )
    if not base.rstrip("/").endswith("/v1"):
        base = base.rstrip("/") + "/v1"
    return OpenAI(base_url=base, api_key=os.environ["FREESOLO_API_KEY"])


def deploy(adapter: str, want: str) -> None:
    print("deploy", adapter, flush=True)
    subprocess.run(["flash", "deploy", adapter], check=True, capture_output=True, text=True)
    run_id = adapter.split("/")[0]
    for _ in range(60):
        out = subprocess.check_output(["flash", "deployments"], text=True)
        for ln in out.splitlines():
            if run_id in ln and "ready" in ln and want in ln.split():
                print("ready", ln[:200], flush=True)
                return
        time.sleep(3)
    raise RuntimeError(f"deploy not ready {adapter}")


def sample_rows(n: int) -> list[dict]:
    rows = []
    with open("model/grpo/dataset/train.jsonl") as f:
        for line in f:
            rows.append(json.loads(line))
    rng = random.Random(SEED)
    by_q = {}
    for r in rows:
        by_q.setdefault(r["metadata"]["question_id"], []).append(r)
    # round-robin across questions for diversity, then fill
    qids = list(by_q.keys())
    rng.shuffle(qids)
    picked = []
    pools = {q: list(by_q[q]) for q in qids}
    for q in qids:
        rng.shuffle(pools[q])
    while len(picked) < n:
        progressed = False
        for q in qids:
            if pools[q] and len(picked) < n:
                picked.append(pools[q].pop())
                progressed = True
        if not progressed:
            break
    return picked


def wilson_ci(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    den = 1 + z * z / n
    center = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (max(0.0, center - half), min(1.0, center + half))


def eval_model(tag: str, model_id: str, picked: list[dict], workers: int) -> dict:
    client = fs()

    def one(i_row):
        i, row = i_row
        prompt = build_student_prompt(row["input"])
        last = None
        delay = 1.0
        for _ in range(5):
            try:
                resp = client.chat.completions.create(
                    model=model_id,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=1.0,
                    max_tokens=256,
                )
                text = (resp.choices[0].message.content or "").strip()
                break
            except Exception as e:
                last = e
                time.sleep(delay)
                delay = min(delay * 2, 20)
        else:
            raise last
        gold = row["metadata"]["gold_choice"]
        choice = judge_choice(
            build_judge_prompt(text, row["input"]["policy_text"], row["metadata"]["options"])
        )
        hit = 1 if choice and choice.upper() == gold.upper() else 0
        none = 1 if choice is None or str(choice).lower() == "none" else 0
        return {
            "i": i,
            "qid": row["metadata"]["question_id"],
            "gold": gold,
            "pred_choice": choice,
            "hit": hit,
            "none": none,
            "opinion": text[:400],
        }

    recs = [None] * len(picked)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(one, (i, r)) for i, r in enumerate(picked)]
        done = 0
        for fut in as_completed(futs):
            rec = fut.result()
            recs[rec["i"]] = rec
            done += 1
            if done % 16 == 0:
                print(f"  [{tag}] {done}/{len(picked)}", flush=True)

    n = len(recs)
    hits = sum(r["hit"] for r in recs)
    nones = sum(r["none"] for r in recs)
    lo, hi = wilson_ci(hits, n)
    summary = {
        "tag": tag,
        "model": model_id,
        "n": n,
        "match_rate": hits / n,
        "match_ci95": [lo, hi],
        "none_rate": nones / n,
        "none_ci95": list(wilson_ci(nones, n)),
        "seed": SEED,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"preds_{tag}_n{n}.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in recs) + "\n"
    )
    (OUT / f"summary_{tag}_n{n}.json").write_text(json.dumps(summary, indent=2))
    # also write unversioned for convenience
    (OUT / f"summary_{tag}.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=128)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument(
        "--only",
        type=str,
        default="",
        help="comma tags: sft_e2_step1850,grpo_step20,grpo_step40",
    )
    args = ap.parse_args()
    load_env()
    picked = sample_rows(args.n)
    print(f"n={len(picked)} unique_q={len({r['metadata']['question_id'] for r in picked})}", flush=True)

    tags = [t.strip() for t in args.only.split(",") if t.strip()] or list(CKPTS.keys())
    results = []
    for tag in tags:
        adapter, want, model_id = CKPTS[tag]
        deploy(adapter, want)
        time.sleep(5)
        results.append(eval_model(tag, model_id, picked, args.workers))

    deploy(*CKPTS["sft_e2_step1850"][:2])  # restore serving to SFT e2
    print("TABLE", flush=True)
    for s in results:
        lo, hi = s["match_ci95"]
        print(
            f"{s['tag']}: match={s['match_rate']:.3f} [{lo:.3f},{hi:.3f}]  "
            f"none={s['none_rate']:.3f}  n={s['n']}",
            flush=True,
        )


if __name__ == "__main__":
    main()
