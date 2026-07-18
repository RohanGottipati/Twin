"""OpenAI-compatible client for the population simulator's LM backend.

Provider-agnostic on purpose: AGENTS.md 5 says the model is "served via
Freesolo Flash (managed LoRA on Qwen), OpenAI-compatible endpoint," but this
sandboxed overnight session also has 2 local GPUs with vLLM available, and
no working Flash credentials/reachability were confirmed. Rather than
hardcode either, `get_client()` picks whichever OpenAI-compatible endpoint
is actually configured and reachable, in this order:

  1. `TORONTWIN_LLM_BASE_URL` env var, if set (explicit override -- points
     at either a local vLLM server or a Flash endpoint, caller's choice).
  2. A local vLLM server on `http://localhost:8000/v1` (the default this
     session used: `vllm serve Qwen/Qwen2.5-7B-Instruct`).
  3. Otherwise, raises `NoLLMBackendAvailable` -- callers must handle this
     explicitly rather than silently falling back to fabricated output.

Nothing in this module is Flash-specific or vLLM-specific: both speak the
OpenAI chat-completions API, so the same `openai.OpenAI` client works
against either once `base_url` is set correctly.
"""

from __future__ import annotations

import os

import requests

DEFAULT_LOCAL_BASE_URL = "http://localhost:8000/v1"
DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"


class NoLLMBackendAvailable(RuntimeError):
    """Raised when neither an explicit endpoint nor a local vLLM server is
    reachable. Callers must not fabricate sampled output when this is
    raised -- log the blocker and route effort elsewhere instead."""


def _is_reachable(base_url: str, timeout: float = 3.0) -> bool:
    try:
        models_url = base_url.rstrip("/") + "/models"
        resp = requests.get(models_url, timeout=timeout)
        return resp.status_code == 200
    except requests.RequestException:
        return False


def resolve_base_url() -> str:
    override = os.environ.get("TORONTWIN_LLM_BASE_URL")
    if override:
        if not _is_reachable(override):
            raise NoLLMBackendAvailable(f"TORONTWIN_LLM_BASE_URL={override!r} is set but not reachable")
        return override

    if _is_reachable(DEFAULT_LOCAL_BASE_URL):
        return DEFAULT_LOCAL_BASE_URL

    raise NoLLMBackendAvailable(
        "No LLM backend reachable: TORONTWIN_LLM_BASE_URL is unset and "
        f"{DEFAULT_LOCAL_BASE_URL} (local vLLM) did not respond. "
        "Start a local server (`vllm serve <model>`) or set "
        "TORONTWIN_LLM_BASE_URL to a reachable OpenAI-compatible endpoint."
    )


def get_client(model: str | None = None):
    """Return (openai.OpenAI client, resolved model name). Raises
    NoLLMBackendAvailable if nothing is reachable -- callers must catch this
    and pivot to non-model work rather than fake a response."""
    import openai

    base_url = resolve_base_url()
    client = openai.OpenAI(base_url=base_url, api_key=os.environ.get("TORONTWIN_LLM_API_KEY", "not-needed"))
    resolved_model = model or os.environ.get("TORONTWIN_LLM_MODEL", DEFAULT_MODEL)
    return client, resolved_model


def complete_chat(messages: list[dict], *, model: str | None = None, temperature: float = 0.9, max_tokens: int = 300) -> str:
    """One chat completion. Thin wrapper; Phase 1 only needs single-shot
    persona-opinion generation, not streaming or tool use."""
    client, resolved_model = get_client(model)
    response = client.chat.completions.create(
        model=resolved_model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content or ""
