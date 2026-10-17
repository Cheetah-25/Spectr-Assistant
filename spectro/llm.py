"""Provider-agnostic LLM layer.

Configuration comes entirely from environment variables; no keys live in code.
This module does NOT call any external API at import time and makes no network
call unless a caller explicitly invokes ``complete_json`` / ``describe_images``
*and* a provider client is installed and configured. In offline environments it
is safe to import; attempts to actually call out raise ``LLMConfigError`` with a
clear, non-leaking message.

Environment variables
----------------------
  SPECTRO_LLM_PROVIDER   provider name: "openai" (default) or "anthropic"
  SPECTRO_LLM_MODEL      text model override (optional)
  SPECTRO_VISION_MODEL   vision model override (optional)
  OPENAI_API_KEY         key when provider == "openai"
  ANTHROPIC_API_KEY      key when provider == "anthropic"

The assessment call is "schema-constrained": we request the provider's JSON /
structured-output mode when available, but callers ALWAYS re-validate the result
locally with ``spectro.schema_tools`` — the provider is never trusted to enforce
the contract.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional

DEFAULT_PROVIDER = "openai"  # overridable via SPECTRO_LLM_PROVIDER
_DEFAULT_MODELS = {
    "openai": {"text": "gpt-4o", "vision": "gpt-4o"},
    "anthropic": {"text": "claude-3-5-sonnet-latest", "vision": "claude-3-5-sonnet-latest"},
}
_KEY_ENV = {"openai": "OPENAI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


class LLMConfigError(RuntimeError):
    """Raised when provider/key configuration is missing or unsupported."""


@dataclass
class LLMConfig:
    provider: str
    text_model: str
    vision_model: str
    api_key: Optional[str]

    @property
    def is_ready(self) -> bool:
        return bool(self.api_key)


def config() -> LLMConfig:
    """Read configuration from the environment (no validation of the key value)."""
    provider = os.environ.get("SPECTRO_LLM_PROVIDER", DEFAULT_PROVIDER).lower().strip()
    if provider not in _DEFAULT_MODELS:
        raise LLMConfigError(
            f"Unsupported SPECTRO_LLM_PROVIDER={provider!r}. "
            f"Supported: {', '.join(sorted(_DEFAULT_MODELS))}."
        )
    defaults = _DEFAULT_MODELS[provider]
    text_model = os.environ.get("SPECTRO_LLM_MODEL", defaults["text"])
    vision_model = os.environ.get("SPECTRO_VISION_MODEL", defaults["vision"])
    api_key = os.environ.get(_KEY_ENV[provider])
    return LLMConfig(provider=provider, text_model=text_model, vision_model=vision_model, api_key=api_key)


def _require_ready(cfg: LLMConfig) -> None:
    if not cfg.is_ready:
        raise LLMConfigError(
            f"No API key for provider {cfg.provider!r}. "
            f"Set {_KEY_ENV[cfg.provider]} in the environment."
        )


def model_name() -> str:
    """Return the configured text model name (for meta.model). No network call."""
    return config().text_model


def complete_json(system: str, user: str, schema: dict, cfg: Optional[LLMConfig] = None) -> dict:
    """Return a JSON object from a schema-constrained text completion.

    Callers MUST re-validate the returned object with spectro.schema_tools; this
    function requests JSON/structured output but does not itself enforce the schema.
    """
    cfg = cfg or config()
    _require_ready(cfg)

    if cfg.provider == "openai":
        return _openai_complete_json(cfg, system, user, schema)
    if cfg.provider == "anthropic":
        return _anthropic_complete_json(cfg, system, user, schema)
    raise LLMConfigError(f"Unsupported provider {cfg.provider!r}")


def describe_images(
    system: str, images: List[Path], user: str, cfg: Optional[LLMConfig] = None
) -> str:
    """Single vision call returning free text describing the images.

    NOTE: PR-2 ingestion does not call this for S02 (the slide notes are
    committed in knowledge/S02_slides.json). It is provided for completeness and
    for any future vision use; it stays inert unless explicitly invoked.
    """
    cfg = cfg or config()
    _require_ready(cfg)
    if cfg.provider == "openai":
        return _openai_describe_images(cfg, system, images, user)
    if cfg.provider == "anthropic":
        return _anthropic_describe_images(cfg, system, images, user)
    raise LLMConfigError(f"Unsupported provider {cfg.provider!r}")


# ---------------------------------------------------------------------------
# Provider adapters. Imported lazily so this module is safe to import offline.
# ---------------------------------------------------------------------------


def _openai_client(cfg: LLMConfig):
    try:
        from openai import OpenAI
    except Exception as exc:  # pragma: no cover - depends on optional dep
        raise LLMConfigError(
            "The 'openai' package is not installed. Install from requirements.txt."
        ) from exc
    return OpenAI(api_key=cfg.api_key)


def _openai_complete_json(cfg: LLMConfig, system: str, user: str, schema: dict) -> dict:  # pragma: no cover
    """Structured-output completion.

    Prefers ``response_format={"type":"json_schema", ...}`` with the real schema
    so the provider constrains the shape (arrays-of-objects, enums, etc.). We use
    non-strict mode because strict mode requires every property to be listed in
    ``required`` and forbids some constructs our schema uses for optional fields.
    Falls back to plain json_object mode if the model/SDK rejects json_schema.
    """
    client = _openai_client(cfg)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    try:
        resp = client.chat.completions.create(
            model=cfg.text_model,
            messages=messages,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "spectroscopy_assessment",
                    "schema": schema,
                    "strict": False,
                },
            },
            temperature=0,
        )
        return json.loads(resp.choices[0].message.content)
    except Exception:
        resp = client.chat.completions.create(
            model=cfg.text_model,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0,
        )
        return json.loads(resp.choices[0].message.content)


def _openai_describe_images(cfg: LLMConfig, system: str, images: List[Path], user: str) -> str:  # pragma: no cover
    import base64

    client = _openai_client(cfg)
    content = [{"type": "text", "text": user}]
    for img in images:
        b64 = base64.b64encode(Path(img).read_bytes()).decode("ascii")
        content.append(
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}}
        )
    resp = client.chat.completions.create(
        model=cfg.vision_model,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
        temperature=0,
    )
    return resp.choices[0].message.content


def _anthropic_client(cfg: LLMConfig):
    try:
        import anthropic
    except Exception as exc:  # pragma: no cover
        raise LLMConfigError(
            "The 'anthropic' package is not installed. Install from requirements.txt."
        ) from exc
    return anthropic.Anthropic(api_key=cfg.api_key)


def _anthropic_complete_json(cfg: LLMConfig, system: str, user: str, schema: dict) -> dict:  # pragma: no cover
    """Structured-output via a tool whose input_schema is our JSON Schema.

    Anthropic constrains tool input to the given schema, so forcing a single tool
    call yields a shape-constrained object. Falls back to parsing a JSON object
    from text if tool use is unavailable.
    """
    client = _anthropic_client(cfg)
    tool = {
        "name": "emit_assessment",
        "description": "Return the spectroscopy assessment as structured JSON.",
        "input_schema": schema,
    }
    try:
        msg = client.messages.create(
            model=cfg.text_model,
            max_tokens=4096,
            system=system,
            tools=[tool],
            tool_choice={"type": "tool", "name": "emit_assessment"},
            messages=[{"role": "user", "content": user}],
            temperature=0,
        )
        for block in msg.content:
            if getattr(block, "type", "") == "tool_use":
                return dict(block.input)
    except Exception:
        pass
    msg = client.messages.create(
        model=cfg.text_model,
        max_tokens=4096,
        system=system + "\nReturn only a single JSON object. No prose.",
        messages=[{"role": "user", "content": user}],
        temperature=0,
    )
    text = "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")
    return json.loads(text)


def _anthropic_describe_images(cfg: LLMConfig, system: str, images: List[Path], user: str) -> str:  # pragma: no cover
    import base64

    client = _anthropic_client(cfg)
    blocks = [{"type": "text", "text": user}]
    for img in images:
        b64 = base64.b64encode(Path(img).read_bytes()).decode("ascii")
        blocks.append(
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": b64},
            }
        )
    msg = client.messages.create(
        model=cfg.vision_model,
        max_tokens=4096,
        system=system,
        messages=[{"role": "user", "content": blocks}],
        temperature=0,
    )
    return "".join(block.text for block in msg.content if getattr(block, "type", "") == "text")
