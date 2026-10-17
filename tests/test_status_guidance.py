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


def test_prune_removes_long_and_unverifiable_quotes(tiny_kb):
    src = next(iter(tiny_kb.sources()))
    page = sorted(tiny_kb.pages_for(src))[0]
    real = " ".join(tiny_kb.page_text(src, page).split()[:4])
    a = {
        "recommendations": [
            {"citations": [
                {"source_id": src, "page": page, "quote": real, "supports": "x"},
                {"source_id": src, "page": page, "quote": "definitely not on this page", "supports": "x"},
                {"source_id": src, "page": page, "quote": real + " " + "word " * 60, "supports": "x"},
            ]}
        ]
    }
    notes = verify.prune_unverifiable_quotes(a, tiny_kb)
    cits = a["recommendations"][0]["citations"]
    assert cits[0].get("quote") == real
    assert "quote" not in cits[1] and "quote" not in cits[2]
    assert len(notes) == 2


def test_budget_question_flagged():
    a = {"clarification_questions": [{"priority": 1, "question": "What is the budget?", "could_change": "method"}],
         "requirements": {"unknowns": [{"item": "Timeline for the pilot", "why_it_matters": "x"}]}}
    assert len(verify.check_out_of_scope_questions(a)) == 2


def test_excitation_needs_cited_support(tiny_kb):
    src = next(iter(tiny_kb.sources()))
    page = sorted(tiny_kb.pages_for(src))[0]
    a = {"spectral_range": [{"method": "Raman", "excitation_nm": 12345, "citations": [{"source_id": src, "page": page}]}]}
    assert verify.check_excitation_support(a, tiny_kb)
    a2 = {"spectral_range": [{"method": "Raman", "citations": [{"source_id": src, "page": page}]}]}
    assert not verify.check_excitation_support(a2, tiny_kb)
