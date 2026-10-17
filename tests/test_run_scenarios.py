"""run_scenarios tests with assess monkeypatched (no LLM / network).

Verifies that one .json and one .md are written per case, unedited, that the
mandated header appears in the .md, and that developer hints like
'useful_sources' are not forwarded to the pipeline.
"""
from __future__ import annotations

import json
from pathlib import Path

import run_scenarios
from spectro import verify as verify_mod
from spectro.kb import KnowledgeBase


def _assessment(case_id):
    return {
        "case_id": case_id,
        "decision_status": "insufficient_information",
        "decision_status_reason": "Not enough information yet.",
        "requirements": {"stated": [], "unknowns": [], "assumptions": []},
        "clarification_questions": [],
        "recommendations": [],
        "measurement_concept": {"summary": "TBD", "needs_afs_confirmation": True, "citations": []},
        "spectral_range": [],
        "risks": [],
        "feasibility_plan": {
            "objective": "o", "samples_or_process_states": [], "reference_measurements": [],
            "comparisons": [], "steps": [], "go_no_go_basis": "client targets",
        },
        "source_conflicts": [],
        "meta": {"model": "m", "kb_version": "kb-test", "generated_at": "t",
                 "verification": {"citations_ok": True, "range_check_ok": True,
                                  "unsupported_numbers": [], "warnings": []}},
    }


def test_outputs_written(tmp_path, monkeypatch):
    received = {}

    def fake_assess(case_id, enquiry, kb=None, fibers=None, complete_json=None, model_name=None):
        received[case_id] = enquiry
        a = _assessment(case_id)
        r = verify_mod.VerifyResult(citations_ok=True, range_check_ok=True)
        return a, r

    monkeypatch.setattr(run_scenarios.assess, "assess", fake_assess)
    monkeypatch.setattr(run_scenarios.KnowledgeBase, "load", classmethod(lambda cls: KnowledgeBase()))

    scenario_file = tmp_path / "scen.json"
    scenario_file.write_text(json.dumps({
        "scenarios": [
            {"id": "D01", "title": "t1", "enquiry": "first enquiry", "useful_sources": "S01 p.5"},
            {"id": "D02", "title": "t2", "enquiry": "second enquiry", "useful_sources": "S02 p.6"},
        ]
    }), encoding="utf-8")

    out_dir = tmp_path / "out"
    rc = run_scenarios.run(scenario_file, out_dir)
    assert rc == 0

    for cid in ("D01", "D02"):
        assert (out_dir / f"{cid}.json").exists()
        assert (out_dir / f"{cid}.md").exists()
        md = (out_dir / f"{cid}.md").read_text(encoding="utf-8")
        assert md.startswith("> First assessment to support an AFS expert; not a final recommendation.")
        data = json.loads((out_dir / f"{cid}.json").read_text(encoding="utf-8"))
        assert data["case_id"] == cid

    # Only the enquiry text was forwarded; no useful_sources string in it.
    assert received["D01"] == "first enquiry"
    assert "useful_sources" not in received["D01"]


def test_missing_scenario_file_returns_2():
    rc = run_scenarios.main(["/nonexistent/scenarios.json"])
    assert rc == 2


def test_malformed_model_output_continues_and_reports(tmp_path, monkeypatch):
    """End-to-end: a model that returns spectral_range as strings must not crash
    the run; both cases are written and the summary reflects the failure."""
    from spectro.kb import KBEntry

    def fake_cj(system, user, schema):
        if "decision_status" not in str(schema):
            return {"stated": [], "unknowns": [], "assumptions": []}
        return {
            "case_id": "D06",
            "decision_status": "insufficient_information",
            "decision_status_reason": "r",
            "requirements": {"stated": [], "unknowns": [], "assumptions": []},
            "clarification_questions": [],
            "recommendations": [],
            "measurement_concept": {"summary": "s", "needs_afs_confirmation": True, "citations": []},
            "spectral_range": ["NIR 1000-2500 nm"],  # malformed on purpose
            "risks": [],
            "feasibility_plan": {
                "objective": "o", "samples_or_process_states": [], "reference_measurements": [],
                "comparisons": [], "steps": [], "go_no_go_basis": "g",
            },
            "source_conflicts": [],
            "meta": {},
        }

    kb = KnowledgeBase(entries=[KBEntry("S01", 10, "AFS technical", "pdf_page", "text")], version="kb-x")
    from spectro import assess as assess_mod
    orig = assess_mod.assess

    def wrap(case_id, enquiry, kb=None, fibers=None, complete_json=None, model_name=None):
        return orig(case_id, enquiry, kb=kb, fibers={"fibers": []},
                    complete_json=fake_cj, model_name="m")

    monkeypatch.setattr(run_scenarios.assess, "assess", wrap)
    monkeypatch.setattr(run_scenarios.KnowledgeBase, "load", classmethod(lambda cls: kb))

    sf = tmp_path / "s.json"
    sf.write_text(json.dumps({"scenarios": [
        {"id": "D06", "enquiry": "petroleum water"},
        {"id": "D07", "enquiry": "hot melt"},
    ]}), encoding="utf-8")
    out_dir = tmp_path / "out"

    rc = run_scenarios.run(sf, out_dir)  # must not raise
    assert rc == 1, "at least one case needs attention -> rc 1"
    for cid in ("D06", "D07"):
        data = json.loads((out_dir / f"{cid}.json").read_text(encoding="utf-8"))
        assert data["meta"]["verification"]["citations_ok"] is False
        assert data["meta"]["verification"].get("warnings") is not None
        md = (out_dir / f"{cid}.md").read_text(encoding="utf-8")
        assert md.startswith("> First assessment to support an AFS expert")
