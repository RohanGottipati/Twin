"""Reward MCQ judge: OpenRouter only (not FreeSolo). Same OpenAI client shape.

AGENTS.md 5.2: frozen small LM maps student opinion -> A|B|C|D|none.
"""

from __future__ import annotations

import os
import re

from openai import OpenAI

JUDGE_BASE_URL = os.environ.get(
    "TORONTWIN_JUDGE_BASE_URL",
    "https://openrouter.ai/api/v1",
)
# tiny instruct model on purpose: reward calls this a lot, keep spend low
JUDGE_MODEL = os.environ.get(
    "TORONTWIN_JUDGE_MODEL",
    "google/gemma-3-4b-it",  # ~4b, cheap on openrouter
)
_CHOICE_RE = re.compile(r"\b(A|B|C|D|none)\b", re.IGNORECASE)


def _client() -> OpenAI:
    key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("TORONTWIN_LLM_API_KEY")
    if not key:
        raise RuntimeError("OPENROUTER_API_KEY missing for reward judge")
    return OpenAI(base_url=JUDGE_BASE_URL, api_key=key)


def parse_choice(text: str) -> str | None:
    if not text:
        return None
    hits = _CHOICE_RE.findall(text.strip())
    if not hits:
        return None
    return hits[-1].lower() if hits[-1].lower() == "none" else hits[-1].upper()


def judge_choice(prompt: str, *, temprature: float = 0.0, max_tokens: int = 16) -> str | None:
    client = _client()
    r = client.chat.completions.create(
        model=JUDGE_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=temprature,
        max_tokens=max_tokens,
    )
    raw = (r.choices[0].message.content or "").strip()
    return parse_choice(raw)
