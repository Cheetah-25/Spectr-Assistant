"""Tests for render.py (mandated header, structure) and kb.py loading."""
from __future__ import annotations

from pathlib import Path

from spectro import render
from spectro.kb import KnowledgeBase

_REPO_ROOT = Path(__file__).resolve().parent.parent


def test_report_starts_with_mandated_note(minimal_assessment):
    md = render.to_markdown(minimal_assessment)
    first_line = md.splitlines()[0]
    assert render.HEADER_NOTE in first_line
    assert first_line.startswith(">")


def test_report_has_summary_and_reasoning(minimal_assessment):
    md = render.to_markdown(minimal_assessment)
    assert "## Summary" in md
    assert "## Show reasoning" in md
    # Summary appears before reasoning.
    assert md.index("## Summary") < md.index("## Show reasoning")


def test_reasoning_contains_verification_block(minimal_assessment):
    import copy
    from spectro import verify

    a = copy.deepcopy(minimal_assessment)
    result = verify.verify(a, _loaded_tiny_kb(), "powder blend api", fibers={"fibers": []})
    verify.write_verification(a, result)
    md = render.to_markdown(a)
    assert "### Verification" in md
    assert "Citations OK" in md


def _loaded_tiny_kb() -> KnowledgeBase:
    from spectro.kb import KBEntry

    return KnowledgeBase(
        entries=[
            KBEntry("S01", 10, "AFS technical", "pdf_page",
                    "A fiber probe can be placed in the process line for in-line measurement."),
        ],
        version="kb-test",
    )


def test_kb_loads_committed_s02_slides():
    """The committed knowledge/S02_slides.json loads with 20 slides tagged S02."""
    kb = KnowledgeBase.load(_REPO_ROOT / "knowledge")
    s02_pages = kb.pages_for("S02")
    assert s02_pages == set(range(1, 21)), f"expected slides 1-20, got {sorted(s02_pages)}"
    # Scope tag is "AFS slides".
    assert kb.scope_for("S02") == "AFS slides"
    # A known slide's text is retrievable and non-empty.
    assert kb.page_text("S02", 6)
    # Provenance captured.
    assert "S02" in kb.provenance


def test_kb_prompt_block_includes_tags():
    kb = KnowledgeBase.load(_REPO_ROOT / "knowledge")
    block = kb.as_prompt_block()
    assert "=== S02 p.1 [scope=AFS slides]" in block
    assert "=== S02 p.20 [scope=AFS slides]" in block
