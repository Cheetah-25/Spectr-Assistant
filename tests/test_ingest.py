"""Ingest tests that run offline.

The xlsx reader has a stdlib fallback, so the method-table build is exercised for
real. S02 slide loading and missing-file handling are also checked. PDF text
extraction needs pypdf/pdfminer and is not run here.
"""
from __future__ import annotations

from pathlib import Path

import pytest

import ingest

_REPO_ROOT = Path(__file__).resolve().parent.parent


def test_method_table_build():
    table = ingest.build_method_table(_REPO_ROOT / "materials" / "AFS_method_comparison_table.xlsx")
    assert table["source_id"] == "S01"
    assert table["page"] == 6
    assert table["locator"] == "Table 1"
    assert len(table["rows"]) >= 10
    # Columns are the header row.
    assert "method" in table["columns"]
    # Notes sheet is kept.
    assert any("Table 1" in n for n in table["notes"])
    # Flattened text is searchable (for quote/number checks later).
    assert "NIR spectroscopy" in table["text"]


def test_load_slides_counts():
    info = ingest.load_slides(_REPO_ROOT / "knowledge" / "S02_slides.json")
    assert info["source_id"] == "S02"
    assert info["scope"] == "AFS slides"
    assert info["page_count"] == 20
    assert info["slide_numbers"] == list(range(1, 21))


def test_check_inputs_clean():
    assert ingest._check_inputs() == []


def test_missing_file_message(tmp_path, monkeypatch):
    # Point MATERIALS_DIR at an empty dir to force a clear error.
    monkeypatch.setattr(ingest, "MATERIALS_DIR", tmp_path)
    with pytest.raises(ingest.IngestError) as exc:
        ingest.ingest()
    msg = str(exc.value)
    assert "missing material" in msg
    assert "Cannot ingest" in msg


def test_slides_missing_message(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "KNOWLEDGE_DIR", tmp_path)
    with pytest.raises(ingest.IngestError) as exc:
        ingest.load_slides(tmp_path / "S02_slides.json")
    assert "slide notes" in str(exc.value)
