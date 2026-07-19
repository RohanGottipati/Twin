"""Tests for model/serving.py's backend-resolution logic. Does not require a
live LLM server -- uses an intentionally-unreachable port to exercise the
"nothing available" path, and the reachability check itself against that
same dead port."""

from __future__ import annotations

import pytest

from model.serving import NoLLMBackendAvailable, _is_reachable, resolve_base_url

UNREACHABLE_URL = "http://localhost:1/v1"  # port 1 is not going to have a server on it


def test_is_reachable_false_for_dead_port():
    assert _is_reachable(UNREACHABLE_URL, timeout=1.0) is False


def test_resolve_base_url_raises_when_override_unreachable(monkeypatch):
    monkeypatch.setenv("TECHTO_LLM_BASE_URL", UNREACHABLE_URL)
    with pytest.raises(NoLLMBackendAvailable):
        resolve_base_url()


def test_resolve_base_url_raises_cleanly_when_nothing_reachable(monkeypatch):
    monkeypatch.delenv("TECHTO_LLM_BASE_URL", raising=False)
    monkeypatch.setattr("model.serving.DEFAULT_LOCAL_BASE_URL", UNREACHABLE_URL)
    with pytest.raises(NoLLMBackendAvailable):
        resolve_base_url()
