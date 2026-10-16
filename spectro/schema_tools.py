"""Schema loading and validation.

Uses the real ``jsonschema`` package (Draft 2020-12) when it is importable, and
otherwise falls back to the small vendored validator in ``_jsonschema_mini``.
Either way the public API is the same: a list of error strings (empty == valid).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, List

# Repo root = parent of the `spectro/` package directory.
_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SCHEMA_PATH = _REPO_ROOT / "schema" / "assessment.schema.json"

try:  # pragma: no cover - exercised implicitly by whichever path is active
    import jsonschema
    from jsonschema import Draft202012Validator

    _HAVE_JSONSCHEMA = True
except Exception:  # pragma: no cover
    jsonschema = None  # type: ignore
    Draft202012Validator = None  # type: ignore
    _HAVE_JSONSCHEMA = False

from ._jsonschema_mini import validate_errors as _mini_validate_errors


def using_real_jsonschema() -> bool:
    """True when the real jsonschema library backs validation."""
    return _HAVE_JSONSCHEMA


@lru_cache(maxsize=4)
def load_schema(schema_path: str | None = None) -> dict:
    """Load and cache the assessment JSON schema."""
    path = Path(schema_path) if schema_path else DEFAULT_SCHEMA_PATH
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def schema_errors(instance: Any, schema: dict | None = None) -> List[str]:
    """Return a list of validation error messages (empty list == valid)."""
    if schema is None:
        schema = load_schema()

    if _HAVE_JSONSCHEMA:
        validator = Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(instance), key=lambda e: list(e.path))
        return [f"{_json_path(e)}: {e.message}" for e in errors]

    return _mini_validate_errors(instance, schema)


def is_valid(instance: Any, schema: dict | None = None) -> bool:
    return not schema_errors(instance, schema)


def _json_path(error: "jsonschema.exceptions.ValidationError") -> str:  # type: ignore[name-defined]
    parts = ["$"]
    for p in error.absolute_path:
        if isinstance(p, int):
            parts[-1] = f"{parts[-1]}[{p}]"
        else:
            parts.append(str(p))
    return ".".join(parts) if len(parts) > 1 else parts[0]


# Convenience for callers that prefer an explicit schema file override via env.
def active_schema_path() -> Path:
    override = os.environ.get("SPECTRO_SCHEMA_PATH")
    return Path(override) if override else DEFAULT_SCHEMA_PATH
