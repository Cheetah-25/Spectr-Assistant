"""Premise checks: generic synthetic enquiries (not taken from any scenario file)."""
from spectro import checks


def ids(text):
    return {f.check_id: f for f in checks.run_checks(text)}


def test_fiber_mismatch_is_computed_from_fiber_table():
    f = ids("We plan FTIR ATR measurements over our quartz silica cable.")["fiber_range_mismatch"]
    assert f.severity == "wont_work"
    assert f.computed["overlap_fraction"] == 0.0
    assert f.computed["method"] == "MIR_ATR"


def test_compatible_fiber_not_flagged():
    assert "fiber_range_mismatch" not in ids("We use NIR with a silica fiber probe.")
    assert "fiber_range_mismatch" not in ids("Mid-IR ATR with a chalcogenide fibre.")


def test_long_mid_ir_link():
    assert ids("Mid-IR ATR probe, the spectrometer sits in the control room.")["long_mid_ir_link"].severity == "check_first"


def test_calibration_transfer():
    f = ids("We switch to a new recipe and want to reuse the existing calibration.")
    assert f["calibration_transfer"].severity == "wrong_assumption"
    assert "calibration_transfer" not in ids("We want to build a calibration for our coating line.")


def test_sensitivity_without_target():
    f = ids("Use our UV-Vis unit because it is sensitive; no absorbing species has been identified yet.")
    assert f["sensitivity_without_target"].severity == "wont_work"


def test_research_as_proof_clinical_vs_not():
    assert ids("Can we cite the paper as proof the sensor is ready for patient diagnosis?")["research_as_proof"].severity == "wont_work"
    assert ids("Can we cite the paper as proof our line sensor is ready for production?")["research_as_proof"].severity == "wrong_assumption"


def test_undefined_target_and_certainty():
    f = ids("Something spoils the batch but we cannot name the impurity. Give us the exact configuration right away.")
    assert "undefined_target" in f and "premature_certainty" in f


def test_mixed_regimes_and_quiet_case():
    assert "mixed_optical_regimes" in ids("One line is clear, the other is opaque.")
    assert ids("Track solvent concentration in a reactor with laboratory references.") == {}


def test_prompt_block_lists_every_finding():
    fs = checks.run_checks("FTIR ATR through a silica cable; please approve.")
    block = checks.as_prompt_block(fs)
    assert all(f.check_id in block for f in fs) and "Won't work" in block
