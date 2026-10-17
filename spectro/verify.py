"""Deterministic, LLM-free verification of an assessment.

Every check here is plain Python. Nothing in this module calls an LLM or the
network. The checks implement the steering "hard rules" that can be verified
mechanically:

  * schema validity;
  * every citation's source and page exist;
  * any ``quote`` appears on the cited page (whitespace-normalized);
  * spectral ranges are compatible with the named fiber family
    (wavelength_um = 10000 / wavenumber_cm-1, and nm<->um);
  * numbers in the answer that appear neither in the knowledge base nor in the
    enquiry are flagged;
  * decision status is consistent with open unknowns;
  * prices / costs / product codes / delivery times in the output that do not
    appear in the knowledge base are flagged (steering rule 10);
  * S03 / S04 cited to support a process- or clinical-readiness claim is flagged
    (steering rule 11).

``verify()`` returns a VerifyResult; ``write_verification()`` records the
machine-checkable subset into ``meta.verification`` for the schema.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from . import schema_tools
from .kb import KnowledgeBase, RESEARCH_SOURCES, normalize_ws

_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIBER_PATH = _REPO_ROOT / "data" / "fiber_families.json"

# Fiber-window containment tolerance (fractional).
RANGE_TOLERANCE = 0.02

# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


@dataclass
class VerifyResult:
    citations_ok: bool = True
    range_check_ok: bool = True
    unsupported_numbers: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)  # schema / structural errors

    @property
    def ok(self) -> bool:
        return (
            self.citations_ok
            and self.range_check_ok
            and not self.unsupported_numbers
            and not self.warnings
            and not self.errors
        )

    def as_meta(self) -> Dict[str, Any]:
        return {
            "citations_ok": self.citations_ok,
            "range_check_ok": self.range_check_ok,
            "unsupported_numbers": list(self.unsupported_numbers),
            "warnings": list(self.warnings),
        }

    def repair_messages(self) -> List[str]:
        """Concrete, generic error lines to feed into the single repair pass."""
        msgs: List[str] = []
        msgs.extend(self.errors)
        msgs.extend(self.warnings)
        for n in self.unsupported_numbers:
            msgs.append(f"unsupported number: {n}")
        return msgs


# ---------------------------------------------------------------------------
# Number handling
# ---------------------------------------------------------------------------

# Matches integers / decimals, optionally with thousands separators, and keeps
# surrounding context out. e.g. 1550, 3.5, 10,000, 0.1
_NUMBER_RE = re.compile(r"(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])\d+(?:\.\d+)?")

# Currency / price / cost / delivery-time / product-code signals (rule 10).
_PRICE_RE = re.compile(
    r"(?:[$€£]\s?\d[\d,.]*)|(?:\b\d[\d,.]*\s?(?:usd|eur|gbp|dollars?|euros?)\b)",
    re.IGNORECASE,
)
_COST_WORD_RE = re.compile(
    r"\b(price|priced|pricing|cost|costs|costing|quote|quotation|"
    r"lead[\s-]?time|delivery[\s-]?time|delivery\s+in|ships?\s+in|"
    r"weeks?\s+delivery|business\s+days)\b",
    re.IGNORECASE,
)
# A loose product-code signal: letters directly followed by >=2 digits
# (e.g. "iC10"), or a letter-run joined by a dash to a >=2-digit run
# (e.g. "HWG-750", "NIR-2000"). Pure letter words and bare numbers do not match.
_PRODUCT_CODE_RE = re.compile(r"\b[A-Za-z]{1,}(?:-\d{2,}|\d{2,})[A-Za-z0-9-]*\b")


def _normalize_number_token(tok: str) -> str:
    """Normalize a numeric token for set comparison: drop thousands separators."""
    tok = tok.replace(",", "")
    # Normalize trailing zeros on decimals (3.50 -> 3.5, 3.0 -> 3).
    if "." in tok:
        tok = tok.rstrip("0").rstrip(".")
    return tok


def _extract_numbers(text: str) -> List[str]:
    return [_normalize_number_token(m.group(0)) for m in _NUMBER_RE.finditer(text or "")]


def _allowed_number_set(kb_text: str, enquiry: str) -> set:
    """Numbers considered supported: those found in KB text or the enquiry.

    Also includes wavenumber<->wavelength conversions so an answer may state the
    micrometre equivalent of a cm-1 value present in a source (and vice-versa).
    """
    allowed = set(_extract_numbers(kb_text)) | set(_extract_numbers(enquiry))
    derived = set()
    for tok in list(allowed):
        try:
            val = float(tok)
        except ValueError:
            continue
        if val > 0:
            # cm-1 -> um and um -> cm-1
            for conv in (10000.0 / val,):
                derived.add(_normalize_number_token(f"{conv:.4f}"))
                derived.add(_normalize_number_token(f"{round(conv)}"))
            # nm <-> um
            derived.add(_normalize_number_token(f"{val / 1000.0:.4f}"))
            derived.add(_normalize_number_token(f"{val * 1000.0:.4f}"))
    return allowed | derived


# Fields whose free text is scanned for numbers / prices / product codes.
def _iter_text_fields(assessment: dict):
    """Yield (field_label, text) for every human-facing free-text string."""

    def walk(node: Any, label: str):
        if isinstance(node, str):
            yield label, node
        elif isinstance(node, dict):
            for k, v in node.items():
                yield from walk(v, f"{label}.{k}" if label else k)
        elif isinstance(node, list):
            for i, v in enumerate(node):
                yield from walk(v, f"{label}[{i}]")

    # Exclude structural / machine fields that legitimately carry numbers or
    # schema-enum tokens (e.g. a citation source_id like "S01" looks like a
    # product code but is a controlled value, not free text).
    skip_prefixes = ("meta", "case_id")
    skip_keys = {"priority", "page", "min", "max", "source_id", "unit"}
    for label, text in walk(assessment, ""):
        top = label.split(".", 1)[0].split("[", 1)[0]
        if top in skip_prefixes:
            continue
        leaf = label.split(".")[-1].split("[")[0]
        if leaf in skip_keys:
            continue
        yield label, text


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def _iter_citations(assessment: dict):
    """Yield (location_label, citation_dict) across the whole assessment."""

    def from_list(items, base):
        for i, item in enumerate(items or []):
            for j, cit in enumerate(item.get("citations", []) or []):
                yield f"{base}[{i}].citations[{j}]", cit

    yield from from_list(assessment.get("recommendations"), "recommendations")
    yield from from_list(assessment.get("spectral_range"), "spectral_range")
    yield from from_list(assessment.get("risks"), "risks")
    yield from from_list(assessment.get("source_conflicts"), "source_conflicts")
    mc = assessment.get("measurement_concept") or {}
    for j, cit in enumerate(mc.get("citations", []) or []):
        yield f"measurement_concept.citations[{j}]", cit


def check_citations(assessment: dict, kb: KnowledgeBase) -> Tuple[bool, List[str]]:
    warnings: List[str] = []
    ok = True
    for loc, cit in _iter_citations(assessment):
        src = cit.get("source_id")
        page = cit.get("page")
        pages = kb.pages_for(src)
        if not pages:
            ok = False
            warnings.append(f"{loc}: source {src} not in knowledge base")
            continue
        if page not in pages:
            ok = False
            warnings.append(f"{loc}: {src} p.{page} does not exist")
            continue
        quote = cit.get("quote")
        if quote:
            page_text = normalize_ws(kb.page_text(src, page) or "").lower()
            if normalize_ws(quote).lower() not in page_text:
                ok = False
                warnings.append(f"{loc}: quote not found on {src} p.{page}: {quote!r}")
    return ok, warnings


def check_research_readiness(assessment: dict) -> List[str]:
    """Steering rule 11: S03/S04 must not be cited as proof of process/clinical
    readiness. Flag any research citation whose ``supports`` text makes a
    readiness/proof claim.
    """
    warnings: List[str] = []
    readiness_re = re.compile(
        r"\b(ready|readiness|proven?|proof|guarantee[sd]?|validated|"
        r"production[\s-]?ready|clinical(?:ly)?|in[\s-]?process\s+proven|"
        r"will\s+work|works\s+in\s+production|certif\w*)\b",
        re.IGNORECASE,
    )
    for loc, cit in _iter_citations(assessment):
        if cit.get("source_id") in RESEARCH_SOURCES:
            supports = cit.get("supports", "") or ""
            if readiness_re.search(supports):
                warnings.append(
                    f"{loc}: research source {cit.get('source_id')} cited to support a "
                    f"readiness/proof claim (steering rule 11): {supports!r}"
                )
    return warnings


def _to_um_window(rng: dict) -> Optional[Tuple[float, float]]:
    """Convert a {min,max,unit} range to a (min_um, max_um) window."""
    if not rng:
        return None
    unit = rng.get("unit")
    lo = rng.get("min")
    hi = rng.get("max")
    if lo is None or hi is None or unit is None:
        return None
    if unit == "um":
        a, b = float(lo), float(hi)
    elif unit == "nm":
        a, b = float(lo) / 1000.0, float(hi) / 1000.0
    elif unit == "cm-1":
        # wavelength_um = 10000 / wavenumber_cm-1 ; inverts ordering.
        a, b = 10000.0 / float(hi), 10000.0 / float(lo)
    else:
        return None
    return (min(a, b), max(a, b))


def check_ranges(assessment: dict, fibers: dict) -> Tuple[bool, List[str]]:
    warnings: List[str] = []
    ok = True
    families = {f["family"]: (f["min_um"], f["max_um"]) for f in fibers.get("fibers", [])}
    for i, sr in enumerate(assessment.get("spectral_range", []) or []):
        fam = sr.get("fiber_family")
        window = _to_um_window(sr.get("nominal_range"))
        if not fam or window is None:
            continue
        if fam not in families:
            ok = False
            warnings.append(f"spectral_range[{i}]: unknown fiber family {fam!r}")
            continue
        fmin, fmax = families[fam]
        tol_lo = fmin * (1 - RANGE_TOLERANCE)
        tol_hi = fmax * (1 + RANGE_TOLERANCE)
        wlo, whi = window
        if wlo < tol_lo or whi > tol_hi:
            ok = False
            warnings.append(
                f"spectral_range[{i}]: method window {wlo:.3f}-{whi:.3f} um is outside "
                f"fiber family '{fam}' ({fmin}-{fmax} um)"
            )
    return ok, warnings


def find_unsupported_numbers(assessment: dict, kb: KnowledgeBase, enquiry: str) -> List[str]:
    allowed = _allowed_number_set(kb.all_text(), enquiry)
    flagged: List[str] = []
    for label, text in _iter_text_fields(assessment):
        for tok in _extract_numbers(text):
            # Ignore tiny ordinals / list positions (0-9) — structural noise.
            try:
                if float(tok) < 10 and "." not in tok:
                    continue
            except ValueError:
                pass
            if tok not in allowed:
                flagged.append(f"{tok} in {label}")
    # De-duplicate preserving order.
    seen = set()
    out = []
    for f in flagged:
        if f not in seen:
            seen.add(f)
            out.append(f)
    return out


def find_prices_and_codes(assessment: dict, kb: KnowledgeBase) -> List[str]:
    """Steering rule 10: flag prices/costs/product codes/delivery times in the
    output that do not appear in the knowledge base."""
    kb_text = normalize_ws(kb.all_text()).lower()
    warnings: List[str] = []
    for label, text in _iter_text_fields(assessment):
        norm = normalize_ws(text)
        for m in _PRICE_RE.finditer(norm):
            frag = m.group(0)
            if frag.lower() not in kb_text:
                warnings.append(f"{label}: price/cost not supported by sources: {frag!r}")
        for m in _COST_WORD_RE.finditer(norm):
            # Only flag cost/delivery wording when it is not present in the KB.
            frag = m.group(0)
            if frag.lower() not in kb_text:
                warnings.append(
                    f"{label}: cost/delivery-time wording not supported by sources: {frag!r}"
                )
        for m in _PRODUCT_CODE_RE.finditer(norm):
            frag = m.group(0)
            if frag.lower() not in kb_text:
                warnings.append(f"{label}: product code not supported by sources: {frag!r}")
    # De-duplicate.
    seen = set()
    out = []
    for w in warnings:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def check_status_consistency(assessment: dict) -> List[str]:
    """Decision status must be consistent with open unknowns and recommendations."""
    warnings: List[str] = []
    status = assessment.get("decision_status")
    unknowns = (assessment.get("requirements", {}) or {}).get("unknowns", []) or []
    recs = assessment.get("recommendations", []) or []
    questions = assessment.get("clarification_questions", []) or []

    high_primary = [
        r
        for r in recs
        if r.get("role") == "primary_candidate" and r.get("confidence") == "high"
    ]

    if status == "insufficient_information" and high_primary:
        warnings.append(
            "status 'insufficient_information' but a high-confidence primary "
            "recommendation is present"
        )
    if status == "provisional_assessment" and unknowns and high_primary:
        warnings.append(
            "status 'provisional_assessment' asserts a high-confidence primary "
            "recommendation while blocking unknowns remain open"
        )
    if status == "provisional_assessment" and unknowns and not questions:
        warnings.append(
            "status 'provisional_assessment' with open unknowns but no clarification questions"
        )
    if status == "outside_supported_scope" and high_primary:
        warnings.append(
            "status 'outside_supported_scope' but a high-confidence primary recommendation is present"
        )
    return warnings


# ---------------------------------------------------------------------------
# Top-level
# ---------------------------------------------------------------------------


def load_fiber_families(path: str | Path | None = None) -> dict:
    p = Path(path) if path else DEFAULT_FIBER_PATH
    with open(p, "r", encoding="utf-8") as fh:
        return json.load(fh)


def verify(
    assessment: dict,
    kb: KnowledgeBase,
    enquiry: str,
    fibers: Optional[dict] = None,
    schema: Optional[dict] = None,
) -> VerifyResult:
    """Run every deterministic check and return a VerifyResult."""
    if fibers is None:
        fibers = load_fiber_families()

    result = VerifyResult()

    # Schema validity (structural errors).
    result.errors = schema_tools.schema_errors(assessment, schema)

    # Citations.
    cites_ok, cite_warn = check_citations(assessment, kb)
    result.citations_ok = cites_ok
    result.warnings.extend(cite_warn)

    # Research-readiness misuse (rule 11).
    result.warnings.extend(check_research_readiness(assessment))

    # Ranges.
    range_ok, range_warn = check_ranges(assessment, fibers)
    result.range_check_ok = range_ok
    result.warnings.extend(range_warn)

    # Unsupported numbers.
    result.unsupported_numbers = find_unsupported_numbers(assessment, kb, enquiry)

    # Prices / product codes / delivery times (rule 10).
    result.warnings.extend(find_prices_and_codes(assessment, kb))

    # Status consistency.
    result.warnings.extend(check_status_consistency(assessment))

    return result


def write_verification(assessment: dict, result: VerifyResult) -> dict:
    """Write the machine-checkable verification subset into meta.verification."""
    assessment.setdefault("meta", {})
    assessment["meta"]["verification"] = result.as_meta()
    return assessment
