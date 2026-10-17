"""Produce a first assessment for an enquiry.

Two stages, both using generic prompts (no scenario-specific text):

  1. extract_facts(enquiry) -> {stated, unknowns, assumptions}
  2. assess(case_id, enquiry) -> a schema-valid assessment dict

Stage 2 sends the whole page-tagged knowledge base in the prompt, asks for a
schema-constrained JSON object, then runs the deterministic verifier. If the
result is invalid or fails verification, it performs exactly ONE repair pass,
feeding the concrete error messages back to the model. The verification result
is written into meta.verification either way.

``insufficient_information`` is a valid outcome, never an error. The LLM is
reached only through ``spectro.llm``; this module makes no direct API call and
imports safely offline.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Callable, Dict, Optional, Tuple

from . import llm, prompts, schema_tools, verify
from .kb import KnowledgeBase

# A callable with the same signature as llm.complete_json, so tests can inject a
# fake model without any network.
CompleteJson = Callable[[str, str, dict], dict]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def extract_facts(
    enquiry: str,
    complete_json: Optional[CompleteJson] = None,
) -> dict:
    """Stage 1: extract stated facts / unknowns / assumptions from the enquiry."""
    cj = complete_json or llm.complete_json
    user = f"ENQUIRY:\n{enquiry.strip()}\n"
    fact_schema = {
        "type": "object",
        "required": ["stated", "unknowns", "assumptions"],
        "properties": {
            "stated": {"type": "array", "items": {"type": "string"}},
            "unknowns": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["item", "why_it_matters"],
                    "properties": {
                        "item": {"type": "string"},
                        "why_it_matters": {"type": "string"},
                    },
                },
            },
            "assumptions": {"type": "array", "items": {"type": "string"}},
        },
    }
    result = cj(prompts.FACT_SYSTEM, user, fact_schema)
    # Defensive defaults so the downstream prompt is always well-formed.
    return {
        "stated": list(result.get("stated", []) or []),
        "unknowns": list(result.get("unknowns", []) or []),
        "assumptions": list(result.get("assumptions", []) or []),
    }


def _fact_sheet_text(facts: dict) -> str:
    lines = ["EXTRACTED FACTS (stage 1):", "Stated:"]
    lines += [f"- {s}" for s in facts.get("stated", [])] or ["- (none)"]
    lines.append("Unknowns:")
    unknowns = facts.get("unknowns", [])
    lines += [f"- {u.get('item', '')}: {u.get('why_it_matters', '')}" for u in unknowns] or [
        "- (none)"
    ]
    lines.append("Assumptions:")
    lines += [f"- {a}" for a in facts.get("assumptions", [])] or ["- (none)"]
    return "\n".join(lines)


def _build_assess_user(case_id: str, enquiry: str, facts: dict, kb: KnowledgeBase) -> str:
    return (
        f"CASE ID: {case_id}\n\n"
        f"ENQUIRY:\n{enquiry.strip()}\n\n"
        f"{_fact_sheet_text(facts)}\n\n"
        f"{prompts.KB_HEADER}\n{kb.as_prompt_block()}\n"
    )


def _finalize_meta(assessment: dict, model: str, kb: KnowledgeBase) -> None:
    meta = assessment.setdefault("meta", {})
    meta["model"] = model
    meta["kb_version"] = kb.version
    meta["generated_at"] = _now_iso()


def assess(
    case_id: str,
    enquiry: str,
    kb: Optional[KnowledgeBase] = None,
    fibers: Optional[dict] = None,
    complete_json: Optional[CompleteJson] = None,
    model_name: Optional[str] = None,
) -> Tuple[dict, verify.VerifyResult]:
    """Stage 2: produce a verified assessment (one repair pass).

    Returns (assessment, verify_result). The assessment always carries
    meta.verification. Verification failures that survive the single repair pass
    are left visible in meta.verification (the artifact is not silently 'fixed').
    """
    kb = kb if kb is not None else KnowledgeBase.load()
    cj = complete_json or llm.complete_json
    model = model_name or (llm.model_name() if complete_json is None else "injected")
    schema = schema_tools.load_schema()

    facts = extract_facts(enquiry, complete_json=cj)
    user = _build_assess_user(case_id, enquiry, facts, kb)

    assessment = cj(prompts.ASSESS_SYSTEM, user, schema)
    _ensure_case_id(assessment, case_id)
    _ensure_requirements_from_facts(assessment, facts)
    _finalize_meta(assessment, model, kb)

    result = verify.verify(assessment, kb, enquiry, fibers=fibers, schema=schema)

    if not result.ok:
        # One repair pass with the concrete, generic error messages.
        repair_user = (
            user
            + "\n\nPREVIOUS JSON:\n"
            + _compact_json(assessment)
            + "\n\n"
            + prompts.REPAIR_PREAMBLE
            + "\n- "
            + "\n- ".join(result.repair_messages())
        )
        repaired = cj(prompts.ASSESS_SYSTEM, repair_user, schema)
        _ensure_case_id(repaired, case_id)
        _ensure_requirements_from_facts(repaired, facts)
        _finalize_meta(repaired, model, kb)
        repaired_result = verify.verify(repaired, kb, enquiry, fibers=fibers, schema=schema)
        assessment, result = repaired, repaired_result

    verify.write_verification(assessment, result)
    return assessment, result


def _ensure_case_id(assessment: dict, case_id: str) -> None:
    if not assessment.get("case_id"):
        assessment["case_id"] = case_id


def _ensure_requirements_from_facts(assessment: dict, facts: dict) -> None:
    """If the model omitted requirements, seed them from stage-1 facts so the
    separation of stated/unknown/assumed is always present and auditable."""
    req = assessment.get("requirements")
    if not isinstance(req, dict):
        assessment["requirements"] = {
            "stated": facts.get("stated", []),
            "unknowns": facts.get("unknowns", []),
            "assumptions": facts.get("assumptions", []),
        }


def _compact_json(obj: dict) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
