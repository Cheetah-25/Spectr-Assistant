"""A tiny, dependency-free JSON Schema (Draft 2020-12) validator.

This is a FALLBACK used only when the real ``jsonschema`` package is not
importable (e.g. a locked-down, offline environment). It deliberately supports
only the keywords used by ``schema/assessment.schema.json``:

    type, required, additionalProperties, properties, items, enum,
    maxLength, maxItems, minimum, and local ``$ref`` of the form
    ``#/$defs/<name>``.

It returns a list of human-readable error messages (empty list == valid), which
mirrors how ``spectro.schema_tools`` consumes validation results. It is NOT a
general-purpose validator; prefer the real library in production (it is listed
in requirements.txt and used automatically when present).
"""
from __future__ import annotations

from typing import Any, List

_JSON_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "integer": int,
    "number": (int, float),
}


def _type_ok(value: Any, expected: str) -> bool:
    if expected == "integer":
        # bool is a subclass of int in Python; JSON integers are not booleans.
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    py = _JSON_TYPES.get(expected)
    if py is None:
        return True  # unknown type keyword: do not fail
    return isinstance(value, py)


class MiniValidator:
    """Validate a document against a root schema with local ``$ref`` support."""

    def __init__(self, root_schema: dict):
        self.root = root_schema

    # -- public API ---------------------------------------------------------
    def iter_errors(self, instance: Any) -> List[str]:
        errors: List[str] = []
        self._validate(instance, self.root, "$", errors)
        return errors

    def is_valid(self, instance: Any) -> bool:
        return not self.iter_errors(instance)

    # -- internals ----------------------------------------------------------
    def _resolve(self, schema: dict) -> dict:
        ref = schema.get("$ref")
        if not ref:
            return schema
        if not ref.startswith("#/"):
            raise ValueError(f"Only local $ref supported, got: {ref!r}")
        node: Any = self.root
        for part in ref[2:].split("/"):
            part = part.replace("~1", "/").replace("~0", "~")
            node = node[part]
        # A $ref may itself be an object with extra keywords alongside it in
        # Draft 2020-12; merge the resolved target under the referencing schema.
        merged = dict(node)
        for k, v in schema.items():
            if k != "$ref":
                merged[k] = v
        return merged

    def _validate(self, value: Any, schema: dict, path: str, errors: List[str]) -> None:
        schema = self._resolve(schema)

        # type
        expected_type = schema.get("type")
        if expected_type is not None:
            types = expected_type if isinstance(expected_type, list) else [expected_type]
            if not any(_type_ok(value, t) for t in types):
                errors.append(f"{path}: expected type {expected_type}, got {type(value).__name__}")
                return  # further checks are unreliable on a type mismatch

        # enum
        if "enum" in schema and value not in schema["enum"]:
            errors.append(f"{path}: {value!r} is not one of {schema['enum']}")

        # string constraints
        if isinstance(value, str):
            max_len = schema.get("maxLength")
            if max_len is not None and len(value) > max_len:
                errors.append(f"{path}: string longer than maxLength {max_len} (len={len(value)})")

        # number constraints
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            minimum = schema.get("minimum")
            if minimum is not None and value < minimum:
                errors.append(f"{path}: {value} is below minimum {minimum}")
            maximum = schema.get("maximum")
            if maximum is not None and value > maximum:
                errors.append(f"{path}: {value} is above maximum {maximum}")

        # object constraints
        if isinstance(value, dict):
            self._validate_object(value, schema, path, errors)

        # array constraints
        if isinstance(value, list):
            self._validate_array(value, schema, path, errors)

    def _validate_object(self, value: dict, schema: dict, path: str, errors: List[str]) -> None:
        props = schema.get("properties", {})
        for req in schema.get("required", []):
            if req not in value:
                errors.append(f"{path}: missing required property '{req}'")

        additional = schema.get("additionalProperties", True)
        for key, sub in value.items():
            child_path = f"{path}.{key}"
            if key in props:
                self._validate(sub, props[key], child_path, errors)
            elif additional is False:
                errors.append(f"{path}: additional property '{key}' is not allowed")
            elif isinstance(additional, dict):
                self._validate(sub, additional, child_path, errors)

    def _validate_array(self, value: list, schema: dict, path: str, errors: List[str]) -> None:
        max_items = schema.get("maxItems")
        if max_items is not None and len(value) > max_items:
            errors.append(f"{path}: array longer than maxItems {max_items} (len={len(value)})")
        min_items = schema.get("minItems")
        if min_items is not None and len(value) < min_items:
            errors.append(f"{path}: array shorter than minItems {min_items} (len={len(value)})")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for i, item in enumerate(value):
                self._validate(item, item_schema, f"{path}[{i}]", errors)


def validate_errors(instance: Any, schema: dict) -> List[str]:
    """Return a list of error message strings (empty == valid)."""
    return MiniValidator(schema).iter_errors(instance)
