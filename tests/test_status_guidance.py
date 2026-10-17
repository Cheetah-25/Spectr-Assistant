"""Status consistency warnings and generic status guidance in the prompt."""
from spectro import prompts, verify


def _a(status, recs):
    return {
        "decision_status": status,
        "requirements": {"stated": [], "unknowns": [], "assumptions": []},
        "recommendations": recs,
        "clarification_questions": [],
    }


REC = {"method": "NIR", "role": "primary_candidate", "confidence": "low"}


def test_insufficient_with_candidate_warns():
    w = verify.check_status_consistency(_a("insufficient_information", [REC]))
    assert any("insufficient_information" in x for x in w)


def test_provisional_without_recommendation_warns():
    w = verify.check_status_consistency(_a("provisional_assessment", []))
    assert any("no recommendation" in x for x in w)


def test_consistent_cases_do_not_warn():
    assert not verify.check_status_consistency(_a("provisional_assessment", [REC]))
    assert not verify.check_status_consistency(_a("insufficient_information", []))


def test_prompt_contains_status_guidance():
    assert "Default to provisional_assessment" in prompts.ASSESS_SYSTEM
