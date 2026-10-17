"""Tests for the remaining verify checks: unsupported numbers, prices/codes,
status consistency, and the full verify() + meta.verification writer."""
from __future__ import annotations

import copy

from spectro import verify


def test_unsupported_number_flagged(minimal_assessment, tiny_kb, enquiry_text):
    bad = copy.deepcopy(minimal_assessment)
    # 1550 is not in the tiny KB text nor the enquiry.
    bad["risks"] = [
        {"risk": "A response time of 1550 ms may be too slow.", "mitigation": "Test it."}
    ]
    flagged = verify.find_unsupported_numbers(bad, tiny_kb, enquiry_text)
    assert any("1550" in f for f in flagged)


def test_supported_number_not_flagged(minimal_assessment, tiny_kb, enquiry_text):
    # "6" and "10" appear as pages, but in free text we use a KB-present number.
    good = copy.deepcopy(minimal_assessment)
    good["risks"] = [
        {"risk": "The fingerprint region matters.", "mitigation": "Use MIR ATR."}
    ]
    flagged = verify.find_unsupported_numbers(good, tiny_kb, enquiry_text)
    assert flagged == [], f"unexpected flags: {flagged}"


def test_price_flagged(minimal_assessment, tiny_kb):
    bad = copy.deepcopy(minimal_assessment)
    bad["recommendations"] = [
        {
            "method": "NIR",
            "role": "comparison_candidate",
            "rationale": "The probe costs $5000 and ships in 6 weeks.",
            "applies_when": "n/a",
            "confidence": "low",
            "citations": [],
        }
    ]
    warnings = verify.find_prices_and_codes(bad, tiny_kb)
    assert any("price" in w or "cost" in w for w in warnings)


def test_product_code_flagged(minimal_assessment, tiny_kb):
    bad = copy.deepcopy(minimal_assessment)
    bad["recommendations"] = [
        {
            "method": "NIR",
            "role": "comparison_candidate",
            "rationale": "Use the HWG-750 probe for this.",
            "applies_when": "n/a",
            "confidence": "low",
            "citations": [],
        }
    ]
    warnings = verify.find_prices_and_codes(bad, tiny_kb)
    assert any("product code" in w for w in warnings)


def test_status_consistency_insufficient_with_high_primary(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    bad["decision_status"] = "insufficient_information"
    bad["recommendations"] = [
        {
            "method": "NIR",
            "role": "primary_candidate",
            "rationale": "Clearly the best.",
            "applies_when": "always",
            "confidence": "high",
            "citations": [],
        }
    ]
    warnings = verify.check_status_consistency(bad)
    assert warnings


def test_status_consistency_clean(minimal_assessment):
    warnings = verify.check_status_consistency(minimal_assessment)
    assert warnings == []


def test_full_verify_clean(minimal_assessment, tiny_kb, enquiry_text):
    fibers = {"fibers": []}
    result = verify.verify(minimal_assessment, tiny_kb, enquiry_text, fibers=fibers)
    assert result.errors == [], f"schema errors: {result.errors}"
    assert result.citations_ok
    assert result.range_check_ok
    assert result.unsupported_numbers == []
    assert result.warnings == []
    assert result.ok


def test_write_verification_populates_meta(minimal_assessment, tiny_kb, enquiry_text):
    fibers = {"fibers": []}
    result = verify.verify(minimal_assessment, tiny_kb, enquiry_text, fibers=fibers)
    out = verify.write_verification(copy.deepcopy(minimal_assessment), result)
    meta_ver = out["meta"]["verification"]
    assert meta_ver["citations_ok"] is True
    assert meta_ver["range_check_ok"] is True
    assert meta_ver["unsupported_numbers"] == []
    assert meta_ver["warnings"] == []
