"""Wait for GRPO step-40, eval judge match, restore SFT e2."""

from __future__ import annotations

import json
import os
import random
import re
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from openai import OpenAI

from model.grpo.judge import judge_choice
from model.grpo.prompt import build_judge_prompt, build_student_prompt

SEED = 2262
N = 32
RID = "flash-1784430260-04bc1f31"
OUT = Path("eval/output/grpo_ckpt_eval")


def load_env() -> None:
    for line in Path(".env").read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        if k in ("FREESOLO_API_KEY", "OPENROUTER_API_KEY", "FREESOLO_BASE_URL"):
            os.environ[k] = v


def wait_ckpt(step: int, polls: int = 60) -> None:
    for i in range(polls):
        out = subprocess.check_output(["flash", "checkpoints", RID], text=True)
        steps = [int(m) for m in re.findall(r"step\s+(\d+)", out)]
        print(f"poll{i} checkpoints={steps}", flush=True)
        if step in steps:
            return
        st = json.loads(subprocess.check_output(["flash", "status", RID], text=True))
        hb = st.get("last_heartbeat") or {}
        print(f"  flash step={hb.get('step')} stage={hb.get('stage')}", flush=True)
        time.sleep(20)
    raise SystemExit(f"step-{step} never appeared")


def deploy(adapter: str, want: str) -> str:
    print("deploy", adapter, flush=True)
    subprocess.run(["flash", "deploy", adapter], check=True, capture_output=True, text=True)
    run_id = adapter.split("/")[0]
    for _ in range(60):
        out = subprocess.check_output(["flash", "deployments"], text=True)
        for ln in out.splitlines():
            if run_id in ln and "ready" in ln and want in ln.split():
                print("ready", ln[:200], flush=True)
                return run_id
        time.sleep(3)
    raise RuntimeError("not ready")


def fs() -> OpenAI:
    base = os.environ.get(
        "FREESOLO_BASE_URL",
        "https://clado-ai--freesolo-lora-serving.modal.run/v1",
    )
    if not base.rstrip("/").endswith("/v1"):
        base = base.rstrip("/") + "/v1"
    return OpenAI(base_url=base, api_key=os.environ["FREESOLO_API_KEY"])


def sample_rows(n: int) -> list[dict]:
    rows = []
    with open("model/grpo/dataset/train.jsonl") as f:
        for line in f:
            rows.append(json.loads(line))
    rng = random.Random(SEED)
    by_q = {}
    for r in rows:
        by_q.setdefault(r["metadata"]["question_id"], []).append(r)
    qids = list(by_q)
    rng.shuffle(qids)
    return [rng.choice(by_q[q]) for q in qids[:n]]


def eval_model(tag: str, model_id: str, picked: list[dict]) -> dict:
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
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = [ex.submit(one, (i, r)) for i, r in enumerate(picked)]
        for fut in as_completed(futs):
            rec = fut.result()
            recs[rec["i"]] = rec
            if (rec["i"] + 1) % 8 == 0:
                print(f"  [{tag}] {rec['i']+1}/{len(picked)}", flush=True)

    n = len(recs)
    summary = {
        "tag": tag,
        "model": model_id,
        "n": n,
        "match_rate": sum(r["hit"] for r in recs) / n,
        "none_rate": sum(r["none"] for r in recs) / n,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"preds_{tag}.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in recs) + "\n"
    )
    (OUT / f"summary_{tag}.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2), flush=True)
    return summary


def main() -> None:
    load_env()
    wait_ckpt(40)
    picked = sample_rows(N)
    deploy(f"{RID}/step-40", "40")
    time.sleep(5)
    eval_model("grpo_step40", RID, picked)
    deploy("flash-1784401342-0d51be72/step-1850", "1850")
    print("TABLE", flush=True)
    for tag in ["sft_e2_step1850", "grpo_step20", "grpo_step40"]:
        p = OUT / f"summary_{tag}.json"
        if p.exists():
            s = json.loads(p.read_text())
            print(
                f"{tag}: match={s['match_rate']:.3f} none={s['none_rate']:.3f}",
                flush=True,
            )


if __name__ == "__main__":
    main()
