"""OpenRouter MCQ judge: parallel-first (shared pool) + expo backoff."""

from __future__ import annotations

import os
import random
import re
import time
from concurrent.futures import ThreadPoolExecutor

from openai import APIStatusError, OpenAI, RateLimitError

JUDGE_BASE_URL = os.environ.get(
    "TECHTO_JUDGE_BASE_URL",
    "https://openrouter.ai/api/v1",
)
JUDGE_MODEL = os.environ.get(
    "TECHTO_JUDGE_MODEL",
    "qwen/qwen-2.5-7b-instruct",
)
# default wide: one GRPO step is 128 comps; keep many in flight
JUDGE_MAX_WORKERS = int(os.environ.get("TECHTO_JUDGE_WORKERS", "32"))
JUDGE_MAX_RETRIES = int(os.environ.get("TECHTO_JUDGE_RETRIES", "6"))
_CHOICE_RE = re.compile(r"\b(A|B|C|D|none)\b", re.IGNORECASE)

_PROVIDER = {
    "ignore": ["DeepInfra"],
    "allow_fallbacks": True,
}

_client: OpenAI | None = None
_pool: ThreadPoolExecutor | None = None


def _client_get() -> OpenAI:
    global _client
    if _client is None:
        key = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("TECHTO_LLM_API_KEY")
        if not key:
            raise RuntimeError("OPENROUTER_API_KEY missing for reward judge")
        _client = OpenAI(base_url=JUDGE_BASE_URL, api_key=key, timeout=60.0, max_retries=0)
    return _client


def _pool_get() -> ThreadPoolExecutor:
    global _pool
    if _pool is None:
        _pool = ThreadPoolExecutor(max_workers=JUDGE_MAX_WORKERS, thread_name_prefix="judge")
    return _pool


def parse_choice(text: str) -> str | None:
    if not text:
        return None
    hits = _CHOICE_RE.findall(text.strip())
    if not hits:
        return None
    return hits[-1].lower() if hits[-1].lower() == "none" else hits[-1].upper()


def _should_retry(exc: Exception) -> bool:
    if isinstance(exc, RateLimitError):
        return True
    if isinstance(exc, APIStatusError):
        return exc.status_code in (408, 409, 429, 500, 502, 503, 504)
    return type(exc).__name__ in ("APIConnectionError", "APITimeoutError", "InternalServerError")


def judge_choice(prompt: str, *, temprature: float = 0.0, max_tokens: int = 16) -> str | None:
    client = _client_get()
    last_err: Exception | None = None
    for attempt in range(JUDGE_MAX_RETRIES):
        try:
            r = client.chat.completions.create(
                model=JUDGE_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=temprature,
                max_tokens=max_tokens,
                extra_body={"provider": _PROVIDER},
            )
            raw = (r.choices[0].message.content or "").strip()
            return parse_choice(raw)
        except Exception as e:
            last_err = e
            if (not _should_retry(e)) or attempt + 1 >= JUDGE_MAX_RETRIES:
                raise
            time.sleep(min((2**attempt) + random.random(), 30.0))
    if last_err:
        raise last_err
    return None


def judge_many(prompts: list[str], *, max_workers: int | None = None) -> list[str | None]:
    """Always prefer parallel map over the shared pool."""
    if not prompts:
        return []
    if len(prompts) == 1:
        return [judge_choice(prompts[0])]
    # max_workers only caps; pool is already sized at JUDGE_MAX_WORKERS
    return list(_pool_get().map(judge_choice, prompts))
