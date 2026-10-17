"""Citation check tests: page existence and quote presence, plus rule 11
(research sources S03/S04 not used to prove process/clinical readiness)."""
from __future__ import annotations

import copy

from spectro import verify


def test_valid_citation_passes(minimal_assessment, tiny_kb):
    ok, warnings = verify.check_citations(minimal_assessment, tiny_kb)
    assert ok, f"expected citations OK, warnings: {warnings}"
    assert warnings == []


def test_missing_page_flagged(minimal_assessment, tiny_kb):
    bad = copy.deepcopy(minimal_assessment)
    bad["measurement_concept"]["citations"][0]["page"] = 999
    ok, warnings = verify.check_citations(bad, tiny_kb)
    assert not ok
    assert any("does not exist" in w for w in warnings)


def test_unknown_source_flagged(minimal_assessment, tiny_kb):
    bad = copy.deepcopy(minimal_assessment)
    bad["measurement_concept"]["citations"][0]["source_id"] = "S05"
    ok, warnings = verify.check_citations(bad, tiny_kb)
    assert not ok
    assert any("not in knowledge base" in w for w in warnings)


def test_absent_quote_flagged(minimal_assessment, tiny_kb):
    bad = copy.deepcopy(minimal_assessment)
    bad["measurement_concept"]["citations"][0]["quote"] = "this text is not on the page"
    ok, warnings = verify.check_citations(bad, tiny_kb)
    assert not ok
    assert any("quote not found" in w for w in warnings)


def test_quote_match_is_whitespace_insensitive(minimal_assessment, tiny_kb):
    good = copy.deepcopy(minimal_assessment)
    good["measurement_concept"]["citations"][0]["quote"] = "fiber   probe can be\nplaced in the process line"
    ok, warnings = verify.check_citations(good, tiny_kb)
    assert ok, f"whitespace-normalized quote should match, warnings: {warnings}"


def test_research_source_readiness_claim_flagged(minimal_assessment, tiny_kb):
    bad = copy.deepcopy(minimal_assessment)
    bad["recommendations"] = [
        {
            "method": "combination",
            "role": "comparison_candidate",
            "rationale": "Worth testing a combined probe.",
            "applies_when": "Laboratory classification study.",
            "confidence": "low",
            "citations": [
                {
                    "source_id": "S04",
                    "page": 3,
                    "supports": "This proves the method is production-ready for the process.",
                }
            ],
        }
    ]
    warnings = verify.check_research_readiness(bad)
    assert warnings, "S04 cited as proof of readiness should be flagged (rule 11)"


def test_research_source_descriptive_use_not_flagged(minimal_assessment, tiny_kb):
    ok_use = copy.deepcopy(minimal_assessment)
    ok_use["recommendations"] = [
        {
            "method": "combination",
            "role": "comparison_candidate",
            "rationale": "A combined probe is worth testing.",
            "applies_when": "Laboratory classification study.",
            "confidence": "low",
            "citations": [
                {
                    "source_id": "S04",
                    "page": 3,
                    "supports": "A combi probe fused mid-IR and fluorescence in a lab study.",
                }
            ],
        }
    ]
    warnings = verify.check_research_readiness(ok_use)
    assert warnings == [], f"descriptive research citation should not be flagged: {warnings}"
