"""Shared pytest fixtures for offline tests.

All fixtures are self-contained: no network, no LLM, no scenario-specific text.
The tiny knowledge base is synthetic (generic physics/engineering content only)
so it can be used to exercise citation, quote and range checks deterministically.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make the repo root importable so `import spectro...` works from tests.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from spectro.kb import KBEntry, KnowledgeBase  # noqa: E402


@pytest.fixture
def tiny_kb() -> KnowledgeBase:
    """A small synthetic KB with known pages and quotable text."""
    entries = [
        KBEntry(
            source_id="S01",
            page=6,
            scope="AFS technical",
            kind="pdf_page",
            text="Methods compared include NIR and MIR ATR. The fingerprint region is useful.",
            locator="Table 1",
        ),
        KBEntry(
            source_id="S01",
            page=10,
            scope="AFS technical",
            kind="pdf_page",
            text="A fiber probe can be placed in the process line for in-line measurement.",
        ),
        KBEntry(
            source_id="S02",
            page=6,
            scope="AFS slides",
            kind="slide_notes",
            text="Transmission windows of fiber families are shown across the spectrum.",
            title="Transmission for different fibers",
        ),
        KBEntry(
            source_id="S04",
            page=3,
            scope="research paper",
            kind="pdf_page",
            text="A combi probe fused mid-IR and fluorescence to classify model tissue types.",
        ),
    ]
    return KnowledgeBase(entries=entries, version="kb-test")


@pytest.fixture
def minimal_assessment() -> dict:
    """A schema-valid assessment with no verification problems against tiny_kb.

    Uses only numbers present in the KB / enquiry fixture to avoid tripping the
    unsupported-number check.
    """
    return {
        "case_id": "T01",
        "decision_status": "insufficient_information",
        "decision_status_reason": "The stated facts do not yet justify a method choice.",
        "requirements": {
            "stated": ["Powder blend", "API concentration requested"],
            "unknowns": [
                {"item": "Sampling geometry", "why_it_matters": "It drives probe choice."}
            ],
            "assumptions": ["Ambient conditions unless stated otherwise."],
        },
        "clarification_questions": [
            {"priority": 1, "question": "What is the measurement location?", "could_change": "method"}
        ],
        "recommendations": [],
        "measurement_concept": {
            "summary": "A fiber probe in the process line may be feasible; to be confirmed by AFS.",
            "geometry": "undetermined",
            "needs_afs_confirmation": True,
            "citations": [
                {
                    "source_id": "S01",
                    "page": 10,
                    "supports": "A fiber probe can be placed in the line.",
                    "quote": "fiber probe can be placed in the process line",
                }
            ],
        },
        "spectral_range": [],
        "risks": [],
        "feasibility_plan": {
            "objective": "Establish whether an in-line optical measurement can follow the target.",
            "samples_or_process_states": ["Representative blend states"],
            "reference_measurements": ["Existing laboratory results"],
            "comparisons": ["Compare candidate methods on the same samples"],
            "steps": ["Collect spectra", "Build a reference set", "Compare"],
            "go_no_go_basis": "Acceptance targets supplied by the client.",
        },
        "source_conflicts": [],
        "meta": {
            "model": "test-model",
            "kb_version": "kb-test",
            "generated_at": "2026-01-01T00:00:00Z",
        },
    }


@pytest.fixture
def enquiry_text() -> str:
    return (
        "We manufacture tablets from a powder blend containing an active pharmaceutical "
        "ingredient. We want to assess whether a fiber based measurement in the feed frame "
        "could follow API concentration changes."
    )
