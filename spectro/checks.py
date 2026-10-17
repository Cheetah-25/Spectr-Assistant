"""Deterministic premise checks, run on the enquiry BEFORE the LLM call.

Customers often bring a premise that the supplied sources contradict: a fibre
that cannot carry the method's wavelengths, a calibration they want to reuse on
a new matrix, a sensitive method with no named target, a research result quoted
as proof of clinical readiness, or a demand for a final configuration before the
target is known. These checks detect such premises with GENERIC wording only
(no scenario nouns; the leakage test scans this file) and compute what can be
computed in code (fibre / method range overlap from data/fiber_families.json).

Each finding is passed to the model as a fact it must address, rendered in the
report under "Problems with the request", and re-checked by the verifier.

Severity labels (plain words, shown to the expert):
  wont_work         the stated concept is technically impossible as described
  wrong_assumption  the client believes something the sources contradict
  check_first       must be confirmed before a method can be chosen
"""
from __future__ import annotations

import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

_REPO = Path(__file__).resolve().parent.parent
_FIBER_PATH = _REPO / "data" / "fiber_families.json"

SEVERITY_LABEL = {
    "wont_work": "Won't work",
    "wrong_assumption": "Wrong assumption",
    "check_first": "Check first",
}

# Nominal method windows in micrometres (S01 p.9-10; UV-Vis upper end = start of NIR).
METHOD_WINDOWS_UM: Dict[str, Tuple[float, float]] = {
    "MIR_ATR": (2.5, 25.0),
    "NIR": (0.78, 2.5),
    "UV_Vis": (0.19, 0.78),
}

_METHOD_PATTERNS = {
    "MIR_ATR": r"\bmir\b|mid[- ]?ir|mid[- ]infrared|\bftir\b|\batr\b",
    "NIR": r"\bnir\b|near[- ]infrared",
    "UV_Vis": r"\buv\b|uv[- /]?vis|ultraviolet",
    "Raman": r"raman",
    "Fluorescence": r"fluoresc|fluorim",
}

_FIBER_PATTERNS = {
    "Standard and Al/Cu-coated Vis-NIR silica fibers": r"silica|quartz|glass fib|(visible|vis|nir)[^.]{0,40}(fib|cable|link)",
    "Chalcogenide As-S IR fibers (CIR)": r"chalcogenide|\bcir\b",
    "Polycrystalline infrared fibers (PIR)": r"polycrystalline|\bpir\b|silver halide",
    "Hollow glass waveguides (HWG)": r"hollow (glass )?waveguide|\bhwg\b",
}


@dataclass
class Finding:
    check_id: str
    severity: str
    finding: str
    evidence: List[Dict[str, object]] = field(default_factory=list)  # [{source_id, page, why}]
    computed: Dict[str, object] = field(default_factory=dict)

    def as_dict(self) -> dict:
        d = asdict(self)
        d["label"] = SEVERITY_LABEL[self.severity]
        return d


def _ev(source_id: str, page: int, why: str) -> Dict[str, object]:
    return {"source_id": source_id, "page": page, "why": why}


def _has(pattern: str, text: str) -> bool:
    return re.search(pattern, text) is not None


def load_fibers(path: Optional[Path] = None) -> List[dict]:
    try:
        return json.loads(Path(path or _FIBER_PATH).read_text(encoding="utf-8")).get("fibers", [])
    except Exception:
        return []


def overlap_fraction(method_um: Tuple[float, float], fiber_um: Tuple[float, float]) -> float:
    lo, hi = max(method_um[0], fiber_um[0]), min(method_um[1], fiber_um[1])
    return max(0.0, hi - lo) / (method_um[1] - method_um[0])


def methods_named(text: str) -> List[str]:
    return [m for m, p in _METHOD_PATTERNS.items() if _has(p, text)]


def fibers_named(text: str) -> List[str]:
    return [f for f, p in _FIBER_PATTERNS.items() if _has(p, text)]


def run_checks(enquiry: str, fibers: Optional[List[dict]] = None) -> List[Finding]:
    t = " ".join(enquiry.lower().split())
    fibers = fibers if fibers is not None else load_fibers()
    fib_by_name = {f["family"]: (float(f["min_um"]), float(f["max_um"])) for f in fibers if "family" in f}
    out: List[Finding] = []
    named_methods = methods_named(t)
    named_fibers = fibers_named(t)

    # 1. Fibre cannot carry the method's spectral window (computed).
    for m in named_methods:
        if m not in METHOD_WINDOWS_UM:
            continue
        for fam in named_fibers:
            if fam not in fib_by_name:
                continue
            frac = overlap_fraction(METHOD_WINDOWS_UM[m], fib_by_name[fam])
            if frac == 0.0:
                out.append(Finding(
                    "fiber_range_mismatch", "wont_work",
                    f"The named fibre ({fam}, about {fib_by_name[fam][0]}-{fib_by_name[fam][1]} um) does not "
                    f"transmit any part of the nominal {m.replace('_', ' ')} window "
                    f"({METHOD_WINDOWS_UM[m][0]}-{METHOD_WINDOWS_UM[m][1]} um). A fibre family that covers the "
                    "method's range is required.",
                    [_ev("S02", 6, "fibre transmission ranges"), _ev("S01", 9, "mid-IR range 4000-400 cm-1")],
                    {"method": m, "fiber_family": fam, "method_um": METHOD_WINDOWS_UM[m],
                     "fiber_um": fib_by_name[fam], "overlap_fraction": 0.0},
                ))

    remote = _has(r"another (building|room|site|hall)|separate (building|room|site)|outside the process area|"
                  r"control room|far (away )?from|remote|long (fib|cable|link)|kilomet|hundreds of met", t)
    # 2. Long link for a mid-IR method: reach not documented in the sources.
    if "MIR_ATR" in named_methods and remote:
        out.append(Finding(
            "long_mid_ir_link", "wont_work" if any("silica" in f.lower() for f in named_fibers) else "check_first",
            "The analyser would be far from the measuring point. Long (100-300 m) cables are documented for "
            "low-OH silica (Vis-NIR) fibres; the sources document no comparable reach for mid-IR fibres "
            "(the shown mid-IR fibre comparison uses 2 m lengths). Placing the analyser near the point, or a "
            "method that works over silica, must be considered.",
            [_ev("S02", 7, "100-300 m low-OH silica cables"), _ev("S02", 9, "PIR / hollow waveguide, 2 m")],
        ))

    # 3. Reusing a calibration / model on a changed matrix.
    reuse = _has(r"reuse (the |our |an? )?(existing |old |current )?(calibration|model)|"
                 r"(calibration|model) (will |would |should )?(remain|stay|be still|still be) valid|"
                 r"transfer (the |our )?(calibration|model)|same calibration|old calibration", t)
    changed = _has(r"(different|new|another|changed|modified) (\w+ )?(api|formulation|blend|recipe|matrix|"
                   r"product|composition|grade|excipient|raw material)|introduc\w* a (different|new)", t)
    if reuse and changed:
        out.append(Finding(
            "calibration_transfer", "wrong_assumption",
            "A chemometric calibration is built and validated for a specific sample matrix. A changed "
            "composition is a new matrix, so the existing model must be re-tested and most likely rebuilt. "
            "Adding a second method creates a new (fused) model that also needs calibration and validation; "
            "it does not keep the old model valid.",
            [_ev("S01", 5, "chemometric models are built, validated, applied"),
             _ev("S01", 10, "overlapping NIR bands need chemometrics"),
             _ev("S01", 9, "data fusion needs dedicated algorithms")],
        ))

    # 4. A sensitive method requested without a named target / marker / relationship.
    sens_method = [m for m in ("Fluorescence", "UV_Vis") if m in named_methods]
    no_target = _has(r"(not|never|no)( yet)? (been )?(identified|named|defined|known|found)[^.]{0,60}"
                     r"(target|marker|fluorophore|chromophore|relationship|band)|no (known |identified )?"
                     r"(fluorescent|absorbing) (target|marker|species)|only justification", t)
    if sens_method and no_target:
        out.append(Finding(
            "sensitivity_without_target", "wont_work",
            "High sensitivity is not selectivity. The requested method is rated high in sensitivity but low in "
            "selectivity, and it only responds to species that fluoresce or absorb; with no named target or "
            "reference relationship there is no physical basis for reporting the requested variables from it.",
            [_ev("S01", 6, "Table 1: fluorimetry sensitivity high, selectivity low"),
             _ev("S01", 5, "most chemicals do not fluoresce"),
             _ev("S04", 4, "limited to samples with a fluorescent component")],
            {"methods": sens_method},
        ))

    # 5. Research / feasibility evidence quoted as proof of clinical or production readiness.
    research = _has(r"\bstudy\b|paper|publication|proof[- ]of[- ]concept|research|prototype", t)
    readiness = _has(r"as proof|prove|ready for|readiness|validated for|approved for|guarantee", t)
    clinical = _has(r"surg(ery|ical)|in vivo|patient|clinical|intraoperative|diagnos", t)
    if research and readiness:
        out.append(Finding(
            "research_as_proof", "wont_work" if clinical else "wrong_assumption",
            "Research and proof-of-concept results are a reason to test a method, not proof that a different "
            "set-up is ready for the intended use." + (
                " Use on patients additionally needs in vivo validation, clinical studies and the applicable "
                "regulatory approval, which are outside this assessment." if clinical else ""),
            [_ev("S03", 1, "in vitro samples, limited patient number"),
             _ev("S03", 3, "ex vivo spectra can differ from in vivo"),
             _ev("S03", 14, "proof of concept; further studies needed")],
            {"clinical_use": clinical},
        ))
    elif clinical and _has(r"no (new )?(in vivo )?data|no validation|not validated|without validation", t):
        out.append(Finding(
            "clinical_without_validation", "wont_work",
            "Clinical use is requested without in vivo data or validation of the set-up; that is outside a "
            "first technical assessment.",
            [_ev("S03", 14, "proof of concept; further studies needed")],
        ))

    # 6. Target or variable not defined.
    if _has(r"(cannot|can't|can not|unable to)( yet)? (name|identify|define)|unknown (contaminant|cause|"
            r"component|variable|impurity)|not (yet )?(been )?(identified|defined|named) (as )?(the )?"
            r"(contaminant|variable|target|separate targets)|not been defined", t):
        out.append(Finding(
            "undefined_target", "check_first",
            "The quantity to measure is not yet defined. Method selection depends on the analytical problem; "
            "for samples of incompletely known composition, several methods are screened first.",
            [_ev("S01", 3, "test several approaches for incompletely known samples"),
             _ev("S01", 5, "method selection depends on many factors")],
        ))

    # 7. Certainty or approval demanded before the facts allow it.
    if _has(r"immediately|right away|exact (sensor |probe )?configuration|final configuration|"
            r"\bapprove\b|approval|sign off|guarantee", t):
        out.append(Finding(
            "premature_certainty", "check_first",
            "A final configuration or approval is requested; the stated facts do not yet support one. "
            "The assessment gives a first, reviewable recommendation and the facts still needed.",
            [_ev("S01", 5, "method selection requires specialised knowledge of many factors")],
        ))

    # 8. More than one optical regime in the same request.
    if _has(r"\bclear\b|transparent", t) and _has(r"opaque|turbid|concentrat|scattering|dense", t):
        out.append(Finding(
            "mixed_optical_regimes", "check_first",
            "The request involves both clear and opaque/turbid material. Transmission or transflection suits "
            "clear liquids, reflection suits opaque or scattering ones, so the interface and calibration may "
            "have to differ per stream or state.",
            [_ev("S01", 17, "reflection for opaque products"), _ev("S01", 18, "transmission for clear liquids"),
             _ev("S01", 16, "probe choice follows optical density")],
        ))
    return out


def as_prompt_block(findings: List[Finding]) -> str:
    if not findings:
        return "PREMISE CHECKS (computed in code): none triggered."
    lines = ["PREMISE CHECKS (computed in code; address EVERY one in premise_findings, the status, "
             "the recommendations and the plan; cite the listed pages if you rely on them):"]
    for f in findings:
        ev = "; ".join(f"{e['source_id']} p.{e['page']} ({e['why']})" for e in f.evidence)
        lines.append(f"- [{f.check_id} | {SEVERITY_LABEL[f.severity]}] {f.finding} Evidence: {ev}")
    return "\n".join(lines)
