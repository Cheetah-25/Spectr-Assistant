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
