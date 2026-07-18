"""Build OpinionQA W92 GRPO rows: persona + question -> metadata.gold_choice.

Seed 2262. Fast template personas (no LM verbalizer) so we can ship RL ASAP.
"""

from __future__ import annotations

import ast
import json
import random
from pathlib import Path

import pandas as pd

SEED = 2262
WAVE = "American_Trends_Panel_W92"
OPINIONQA_DIR = Path("data/raw/opinionqa/human_resp")
OUT = Path("model/grpo/dataset/train.jsonl")
N_ROWS = 4000
N_HOLD_OUT_Q = 8  # hold out whole questions for eval later
REFUSAL = {"Refused", "Don't Know", "Dont know", "DK/Refused", "No answer"}

DEMO_MAP = {
    "AGE": "age",
    "SEX": "sex",
    "RACE": "race",
    "EDUCATION": "education",
    "INCOME": "income",
    "POLPARTY": "party",
    "POLIDEOLOGY": "ideology",
}


def _parse_mapping(raw: str) -> dict:
    return ast.literal_eval(raw)


def _letters_for(options: list[str]) -> dict[str, str]:
    letters = ["A", "B", "C", "D"]
    return {letters[i]: options[i] for i in range(len(options))}


def _label_to_letter(label: str, options: dict[str, str]) -> str | None:
    for k, v in options.items():
        if v == label:
            return k
    return None


def _template_persona(attrs: dict, rng: random.Random) -> str:
    # cheap stand-in; SFT used LM verbalizer. keep short + first person.
    bits = []
    if "age" in attrs:
        bits.append(f"I'm in the {attrs['age']} age range")
    if "sex" in attrs:
        bits.append(f"I identify as {attrs['sex']}")
    if "race" in attrs and rng.random() < 0.8:
        bits.append(f"my background is {attrs['race']}")
    if "education" in attrs and rng.random() < 0.75:
        bits.append(f"education-wise I'm at {attrs['education']}")
    if "income" in attrs and rng.random() < 0.7:
        bits.append(f"household income is around {attrs['income']}")
    if "party" in attrs:
        bits.append(f"politically I lean {attrs['party']}")
    if "ideology" in attrs and rng.random() < 0.7:
        bits.append(f"ideologically {attrs['ideology']}")
    if not bits:
        bits.append("I'm a US adult answering a survey")
    # scramble order a bit
    rng.shuffle(bits)
    s = bits[0].capitalize()
    if not s.endswith("."):
        # first clause often starts with I'm
        pass
    body = ", ".join(bits)
    if not body[0].isupper():
        body = body[0].upper() + body[1:]
    return body + "."


def main() -> None:
    rng = random.Random(SEED)
    wave_dir = OPINIONQA_DIR / WAVE
    info = pd.read_csv(wave_dir / "info.csv")
    responses = pd.read_csv(wave_dir / "responses.csv", low_memory=False)

    usable = []
    for _, row in info.iterrows():
        mapping = _parse_mapping(row["option_mapping"])
        real = [v for v in mapping.values() if v not in REFUSAL]
        if 2 <= len(real) <= 4:
            usable.append((row["key"], row["question"], real))

    # hold out whole questions
    hold_keys = set(k for k, _, _ in rng.sample(usable, min(N_HOLD_OUT_Q, len(usable))))
    train_q = [(k, q, opts) for k, q, opts in usable if k not in hold_keys]
    print(f"usable qs={len(usable)} holdout={len(hold_keys)} train_qs={len(train_q)}")

    # build pool of (resp_idx, qkey) candidates
    pool = []
    for key, question, real_opts in train_q:
        if key not in responses.columns:
            continue
        options = _letters_for(real_opts)
        col = responses[key]
        for i, ans in col.items():
            if pd.isna(ans) or ans in REFUSAL:
                continue
            letter = _label_to_letter(str(ans), options)
            if letter is None:
                continue
            pool.append((int(i), key, question, options, letter, str(ans)))

    print(f"candidate pairs={len(pool)}")
    picked = rng.sample(pool, min(N_ROWS, len(pool)))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with OUT.open("w") as f:
        for resp_i, key, question, options, letter, ans_label in picked:
            row = responses.iloc[resp_i]
            attrs = {}
            for src, dst in DEMO_MAP.items():
                if src in row.index and pd.notna(row[src]):
                    val = str(row[src])
                    if val in REFUSAL or val.lower() == "refused":
                        continue
                    attrs[dst] = val
            if len(attrs) < 2:
                continue
            persona = _template_persona(attrs, rng)
            rec = {
                "input": {
                    "persona_text": persona,
                    "policy_text": question,
                    "spatial_features_text": None,
                },
                "output": "",  # GRPO samples; no gold prose
                "metadata": {
                    "source": "opinionqa_W92",
                    "question_id": key,
                    "gold_choice": letter,
                    "gold_label": ans_label,
                    "options": options,
                    "demographics": attrs,
                    "persona_text_renderer": "template_v1",
                    "respondent_id": str(row.get("QKEY", resp_i)),
                    "holdout_questions": sorted(hold_keys),
                },
            }
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            n += 1

    # also dump holdout q keys for later eval
    meta_path = OUT.parent / "holdout_questions.json"
    meta_path.write_text(json.dumps(sorted(hold_keys), indent=2))
    print(f"wrote {n} -> {OUT}")
    print(f"holdout qs -> {meta_path}")


if __name__ == "__main__":
    main()
