"""Assessment pipeline tests with a mocked LLM (no network).

A fake complete_json is injected so the two-stage flow, the single repair pass,
meta population, and the fact/KB prompt contents are all exercised offline.
"""
from __future__ import annotations

import copy

import pytest

from spectro import assess
from spectro.kb import KBEntry, KnowledgeBase


@pytest.fixture
def kb():
    return KnowledgeBase(
        entries=[
            KBEntry("S01", 10, "AFS technical", "pdf_page",
                    "A fiber probe can be placed in the process line for in-line measurement."),
            KBEntry("S01", 6, "AFS technical", "xlsx_rows",
                    "NIR spectroscopy diffuse reflection probe scattering media powder."),
        ],
        version="kb-test",
    )


def _valid_assessment(case_id="D01"):
    return {
        "case_id": case_id,
        "decision_status": "insufficient_information",
        "decision_status_reason": "Stated facts do not yet justify a method choice.",
        "requirements": {
            "stated": ["Powder blend"],
            "unknowns": [{"item": "Sampling geometry", "why_it_matters": "Drives probe choice."}],
            "assumptions": ["Ambient conditions unless stated."],
        },
        "clarification_questions": [
            {"priority": 1, "question": "Where is the measurement taken?", "could_change": "method"}
        ],
        "recommendations": [],
        "measurement_concept": {
            "summary": "A fiber probe in the line may be feasible; to be confirmed.",
            "geometry": "undetermined",
            "needs_afs_confirmation": True,
            "citations": [
                {"source_id": "S01", "page": 10,
                 "supports": "A fiber probe can be placed in the line.",
                 "quote": "fiber probe can be placed in the process line"}
            ],
        },
        "spectral_range": [],
        "risks": [],
        "feasibility_plan": {
            "objective": "Establish feasibility of an in-line optical measurement.",
            "samples_or_process_states": ["Representative states"],
            "reference_measurements": ["Existing laboratory results"],
            "comparisons": ["Compare candidate methods on the same samples"],
            "steps": ["Collect spectra", "Build a reference set", "Compare"],
            "go_no_go_basis": "Acceptance targets supplied by the client.",
        },
        "source_conflicts": [],
        "meta": {},
    }


def _fact_payload():
    return {
        "stated": ["Powder blend"],
        "unknowns": [{"item": "Sampling geometry", "why_it_matters": "Drives probe choice."}],
        "assumptions": ["Ambient conditions unless stated."],
    }


def test_extract_facts_shape(kb):
    calls = []

    def fake(system, user, schema):
        calls.append((system, user))
        return _fact_payload()

    facts = assess.extract_facts("powder blend enquiry", complete_json=fake)
    assert set(facts) == {"stated", "unknowns", "assumptions"}
    assert facts["unknowns"][0]["why_it_matters"]


def test_assess_happy_path_no_repair(kb):
    seen_user_prompts = []

    def fake(system, user, schema):
        seen_user_prompts.append(user)
        # First call = facts; subsequent = assessment.
        if "schema" in schema.get("title", "").lower() or "decision_status" in str(schema):
            return _valid_assessment()
        return _fact_payload()

    assessment, result = assess.assess(
        "D01", "We have a powder blend.", kb=kb,
        fibers={"fibers": []}, complete_json=fake, model_name="test-model",
    )
    assert result.ok, f"warnings={result.warnings} errors={result.errors} nums={result.unsupported_numbers}"
    assert assessment["meta"]["model"] == "test-model"
    assert assessment["meta"]["kb_version"] == "kb-test"
    assert assessment["meta"]["verification"]["citations_ok"] is True
    # Exactly 2 model calls (facts + assessment), no repair.
    assert len(seen_user_prompts) == 2


def test_repair_pass_fires_on_bad_first_output(kb):
    state = {"n": 0}

    def fake(system, user, schema):
        if "decision_status" not in str(schema):
            return _fact_payload()
        state["n"] += 1
        if state["n"] == 1:
            bad = _valid_assessment()
            # Introduce a non-existent citation page -> citation check fails.
            bad["measurement_concept"]["citations"][0]["page"] = 999
            return bad
        return _valid_assessment()  # repaired

    assessment, result = assess.assess(
        "D01", "We have a powder blend.", kb=kb,
        fibers={"fibers": []}, complete_json=fake, model_name="test-model",
    )
    assert state["n"] == 2, "assessment model should be called twice (initial + one repair)"
    assert result.citations_ok
    assert result.ok


def test_kb_is_in_prompt_and_no_dev_hint_leak(kb):
    captured = {"assess_user": None}

    def fake(system, user, schema):
        if "decision_status" in str(schema):
            captured["assess_user"] = user
            return _valid_assessment()
        return _fact_payload()

    assess.assess("D01", "We have a powder blend.", kb=kb,
                  fibers={"fibers": []}, complete_json=fake, model_name="m")
    user = captured["assess_user"]
    # The page-tagged KB must be present in the assessment prompt.
    assert "=== S01 p.10" in user
    # useful_sources must never be injected by assess (it never receives it).
    assert "useful_sources" not in user


def _malformed_assessment():
    """A draft where spectral_range is an array of strings (the crash case)."""
    a = _valid_assessment()
    a["spectral_range"] = ["NIR 1000-2500 nm", "MIR 2.5-16 um"]
    return a


def test_malformed_spectral_range_repaired(kb):
    state = {"n": 0}

    def fake(system, user, schema):
        if "decision_status" not in str(schema):
            return _fact_payload()
        state["n"] += 1
        if state["n"] == 1:
            return _malformed_assessment()  # strings -> schema error, no crash
        return _valid_assessment()  # repair returns a valid shape

    assessment, result = assess.assess(
        "D01", "We have a powder blend.", kb=kb,
        fibers={"fibers": []}, complete_json=fake, model_name="test-model",
    )
    assert state["n"] == 2, "a single repair pass should run"
    assert result.ok, f"after repair should pass: errors={result.errors} warnings={result.warnings}"
    assert assessment["spectral_range"] == []


def test_persistent_malformed_output_does_not_crash(kb):
    """If the model keeps returning strings even after the repair pass, assess
    must not crash: it returns the best-effort draft with meta.verification
    showing the schema errors."""
    def fake(system, user, schema):
        if "decision_status" not in str(schema):
            return _fact_payload()
        return _malformed_assessment()  # always malformed

    assessment, result = assess.assess(
        "D07", "Hot polymer melt with an API.", kb=kb,
        fibers={"fibers": []}, complete_json=fake, model_name="test-model",
    )
    # No exception; errors are reported, not raised.
    assert result.errors
    assert not result.ok
    # Best-effort draft is still written out with meta.verification populated.
    assert assessment["meta"]["verification"]["citations_ok"] is False
    assert assessment["meta"]["kb_version"] == "kb-test"
    # case_id present (the draft carried its own; we never drop it).
    assert assessment["case_id"]


def test_non_dict_model_output_does_not_crash(kb):
    """A model that returns a list/string instead of an object must not crash."""
    def fake(system, user, schema):
        if "decision_status" not in str(schema):
            return _fact_payload()
        return ["this", "should", "be", "an", "object"]

    assessment, result = assess.assess(
        "D01", "enquiry", kb=kb, fibers={"fibers": []},
        complete_json=fake, model_name="m",
    )
    assert result.errors
    assert not result.ok
    assert isinstance(assessment, dict)
    assert assessment["case_id"] == "D01"
