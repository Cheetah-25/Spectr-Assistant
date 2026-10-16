"""The LLM layer must import offline and fail cleanly without configuration.

These tests never make a network call: they only exercise configuration and the
guard that raises before any client is constructed.
"""
from __future__ import annotations

import pytest

from spectro import llm


def test_default_provider_is_openai(monkeypatch):
    monkeypatch.delenv("SPECTRO_LLM_PROVIDER", raising=False)
    cfg = llm.config()
    assert cfg.provider == "openai"


def test_unsupported_provider_raises(monkeypatch):
    monkeypatch.setenv("SPECTRO_LLM_PROVIDER", "not-a-provider")
    with pytest.raises(llm.LLMConfigError):
        llm.config()


def test_missing_key_is_not_ready(monkeypatch):
    monkeypatch.setenv("SPECTRO_LLM_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    cfg = llm.config()
    assert cfg.is_ready is False


def test_complete_json_without_key_raises(monkeypatch):
    monkeypatch.setenv("SPECTRO_LLM_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with pytest.raises(llm.LLMConfigError):
        llm.complete_json("sys", "user", {"type": "object"})


def test_model_name_offline(monkeypatch):
    monkeypatch.setenv("SPECTRO_LLM_PROVIDER", "anthropic")
    monkeypatch.delenv("SPECTRO_LLM_MODEL", raising=False)
    assert "claude" in llm.model_name()
