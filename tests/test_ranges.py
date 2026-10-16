"""Range check tests: cm-1 <-> um conversion and fiber-family window limits."""
from __future__ import annotations

import copy

from spectro import verify
from spectro.verify import _to_um_window


# Real fiber families (mirrors data/fiber_families.json) for deterministic tests.
FIBERS = {
    "fibers": [
        {"family": "Standard and Al/Cu-coated UV-Vis silica fibers", "min_um": 0.19, "max_um": 1.2},
        {"family": "Standard and Al/Cu-coated Vis-NIR silica fibers", "min_um": 0.35, "max_um": 2.4},
        {"family": "Chalcogenide As-S IR fibers (CIR)", "min_um": 1.1, "max_um": 6.5},
        {"family": "Polycrystalline infrared fibers (PIR)", "min_um": 3.0, "max_um": 17.0},
    ]
}


def test_cm1_to_um_conversion():
    # 4000 cm-1 -> 2.5 um ; 2000 cm-1 -> 5.0 um. min/max invert.
    win = _to_um_window({"min": 2000, "max": 4000, "unit": "cm-1"})
    assert win is not None
    lo, hi = win
    assert abs(lo - 2.5) < 1e-6
    assert abs(hi - 5.0) < 1e-6


def test_nm_to_um_conversion():
    win = _to_um_window({"min": 350, "max": 2400, "unit": "nm"})
    assert win == (0.35, 2.4)


def test_um_passthrough():
    win = _to_um_window({"min": 1.1, "max": 6.5, "unit": "um"})
    assert win == (1.1, 6.5)


def _assessment_with_range(rng, family):
    return {
        "spectral_range": [
            {
                "method": "MIR_ATR",
                "status": "nominal_only",
                "note": "nominal method range only",
                "nominal_range": rng,
                "fiber_family": family,
            }
        ]
    }


def test_range_within_family_ok():
    # MIR 2000-4000 cm-1 => 2.5-5.0 um, within CIR 1.1-6.5 um.
    a = _assessment_with_range({"min": 2000, "max": 4000, "unit": "cm-1"}, "Chalcogenide As-S IR fibers (CIR)")
    ok, warnings = verify.check_ranges(a, FIBERS)
    assert ok, f"expected within-window to pass, warnings: {warnings}"


def test_range_outside_family_flagged():
    # 600-2000 cm-1 => 5.0-16.7 um, exceeds CIR max 6.5 um.
    a = _assessment_with_range({"min": 600, "max": 2000, "unit": "cm-1"}, "Chalcogenide As-S IR fibers (CIR)")
    ok, warnings = verify.check_ranges(a, FIBERS)
    assert not ok
    assert any("outside" in w for w in warnings)


def test_unknown_family_flagged():
    a = _assessment_with_range({"min": 1.0, "max": 2.0, "unit": "um"}, "Imaginary fiber")
    ok, warnings = verify.check_ranges(a, FIBERS)
    assert not ok
    assert any("unknown fiber family" in w for w in warnings)


def test_no_family_is_skipped():
    a = {
        "spectral_range": [
            {"method": "NIR", "status": "nominal_only", "note": "n/a",
             "nominal_range": {"min": 1.0, "max": 2.5, "unit": "um"}}
        ]
    }
    ok, warnings = verify.check_ranges(a, FIBERS)
    assert ok and warnings == []
