"""Human-readable rendering of an assessment.

Every report starts with the mandated note (steering "Output contract"):

    First assessment to support an AFS expert; not a final recommendation.

The summary is kept short (status, top clarification questions, recommendations);
the fuller detail (stated facts, assumptions, citations, source conflicts,
verification) lives under a "Show reasoning" section so the top of the report
stays scannable.
"""
from __future__ import annotations

from typing import Any, Dict, List

HEADER_NOTE = "First assessment to support an AFS expert; not a final recommendation."


def _dicts(value: Any) -> List[dict]:
    """Return only the dict items of a list value (defensive against malformed
    LLM output where an array may contain strings)."""
    if not isinstance(value, list):
        return []
    return [v for v in value if isinstance(v, dict)]


def _obj(value: Any) -> dict:
    """Return value if it is a dict, else an empty dict."""
    return value if isinstance(value, dict) else {}


def _strs(value: Any) -> List[str]:
    """Return list items rendered as strings (defensive)."""
    if not isinstance(value, list):
        return []
    return [v if isinstance(v, str) else str(v) for v in value]


def _fmt_citation(cit: Dict[str, Any]) -> str:
    tag = f"{cit.get('source_id')} p.{cit.get('page')}"
    loc = cit.get("locator")
    if loc:
        tag += f" ({loc})"
    supports = cit.get("supports")
    quote = cit.get("quote")
    bits = [tag]
    if quote:
        bits.append(f'"{quote}"')
    if supports:
        bits.append(f"- {supports}")
    return " ".join(bits)


SEVERITY_LABEL = {"wont_work": "Won't work", "wrong_assumption": "Wrong assumption", "check_first": "Check first"}
PATH_LABEL = {
    "A_chemometric_model": "Path A · AI chemometric model",
    "B_custom_msf_system": "Path B · Customised multispectral fiber (MSF) system",
    "C_spectral_fiber_sensor": "Path C · Spectral fiber sensor (SFS)",
    "not_yet": "Not yet: the laboratory test comes first",
    "none": "none",
}
MODE_LABEL = {"in_line": "In-line", "in_situ": "In situ", "at_line_or_lab_first": "Lab screening first",
              "laboratory_study": "Laboratory study", "not_applicable": "No installation in scope"}


def _inline_section(a: Dict[str, Any]) -> List[str]:
    """Top block: the clearest answer (method, probe, location, fibre, alternative)."""
    inl = _obj(a.get("inline_recommendation"))
    if not inl:
        return []
    lines = ["## Recommended in-line method", ""]
    lines.append(f"**{inl.get('headline', '')}**  ")
    lines.append(f"_Mode: {MODE_LABEL.get(inl.get('mode'), inl.get('mode', '?'))}_")
    lines.append("")
    lines.append("| Method | Probe / interface | Install | Fiber |")
    lines.append("|---|---|---|---|")
    lines.append(f"| {inl.get('method', '?')} | {inl.get('probe', '')} | {inl.get('install_location', '')} | "
                 f"{inl.get('fiber_family', 'not stated')} |")
    if inl.get("test_against"):
        lines.append("")
        lines.append(f"**Test against:** {inl['test_against']}")
    if inl.get("not_final_because"):
        lines.append("")
        lines.append(f"**Not final yet:** {inl['not_final_because']}")
    return lines


def _premise_section(a: Dict[str, Any]) -> List[str]:
    items = _dicts(a.get("premise_findings"))
    if not items:
        return []
    lines = ["## Problems with the request", ""]
    for p in items:
        lines.append(f"- **{SEVERITY_LABEL.get(p.get('severity'), p.get('severity', '?'))}:** {p.get('finding', '')}")
    return lines


def _pathway_section(a: Dict[str, Any]) -> List[str]:
    pw = _obj(a.get("afs_pathway"))
    if not pw:
        return []
    labs = ", ".join(f"{m.get('method')} ({str(m.get('role', '')).replace('_', ' ')})" for m in _dicts(pw.get("lab_test_methods")))
    lines = ["## AFS pathway", ""]
    lines.append(f"1. **Multi-method lab test:** {labs or '—'}")
    lines.append(f"2. **Key spectral features:** {pw.get('key_spectral_features', '')}")
    later = pw.get("later_path")
    later_txt = f" Later: {PATH_LABEL.get(later, later)}." if later and later != "none" else ""
    lines.append(f"3. **Tailored solution:** {PATH_LABEL.get(pw.get('path'), pw.get('path', '?'))} — {pw.get('path_reason', '')}{later_txt}")
    return lines


def _summary_section(a: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    status = a.get("decision_status", "unknown")
    reason = a.get("decision_status_reason", "")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"**Status:** `{status}`")
    if reason:
        lines.append("")
        lines.append(reason)

    questions = _dicts(a.get("clarification_questions"))
    if questions:
        ordered = sorted(questions, key=lambda q: q.get("priority", 99))
        lines.append("")
        lines.append("**Top clarification questions:**")
        for q in ordered:
            lines.append(f"- ({q.get('could_change', '?')}) {q.get('question', '')}")

    recs = _dicts(a.get("recommendations"))
    lines.append("")
    lines.append("**Recommendations:**")
    if not recs:
        lines.append("- None at this stage.")
    else:
        for r in recs:
            method = r.get("method", "?")
            role = r.get("role", "?")
            conf = r.get("confidence", "?")
            rationale = r.get("rationale", "")
            lines.append(f"- **{method}** ({role}, confidence {conf}): {rationale}")
    return lines


def _reasoning_section(a: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    lines.append("## Show reasoning")
    lines.append("")

    req = _obj(a.get("requirements"))
    stated = _strs(req.get("stated"))
    lines.append("### Stated facts")
    if stated:
        lines.extend(f"- {s}" for s in stated)
    else:
        lines.append("- (none)")

    unknowns = _dicts(req.get("unknowns"))
    lines.append("")
    lines.append("### Unknowns")
    if unknowns:
        for u in unknowns:
            lines.append(f"- {u.get('item', '')} — _why it matters:_ {u.get('why_it_matters', '')}")
    else:
        lines.append("- (none)")

    assumptions = _strs(req.get("assumptions"))
    lines.append("")
    lines.append("### Assumptions")
    if assumptions:
        lines.extend(f"- {s}" for s in assumptions)
    else:
        lines.append("- (none)")

    # Measurement concept
    mc = _obj(a.get("measurement_concept"))
    lines.append("")
    lines.append("### Measurement concept")
    lines.append(str(mc.get("summary", "(not defined)")))
    if mc.get("geometry"):
        lines.append(f"- Geometry: {mc['geometry']}")
    if mc.get("fiber_link_note"):
        lines.append(f"- Fiber link: {mc['fiber_link_note']}")
    if mc.get("needs_afs_confirmation"):
        lines.append("- Needs AFS confirmation: yes")

    # Spectral range
    sr = _dicts(a.get("spectral_range"))
    if sr:
        lines.append("")
        lines.append("### Spectral range")
        for s in sr:
            rng = _obj(s.get("nominal_range"))
            rng_txt = ""
            if rng:
                rng_txt = f" {rng.get('min')}-{rng.get('max')} {rng.get('unit')}"
            exc = s.get("excitation_nm")
            exc_txt = f", excitation {exc} nm" if exc is not None else ""
            fam = s.get("fiber_family")
            fam_txt = f", fiber: {fam}" if fam else ""
            lines.append(
                f"- {s.get('method', '?')} [{s.get('status', '?')}]"
                f"{rng_txt}{exc_txt}{fam_txt} — {s.get('note', '')}"
            )

    # Risks
    risks = _dicts(a.get("risks"))
    if risks:
        lines.append("")
        lines.append("### Risks")
        for r in risks:
            lines.append(f"- {r.get('risk', '')} — _mitigation:_ {r.get('mitigation', '')}")

    # Feasibility plan
    fp = _obj(a.get("feasibility_plan"))
    if fp:
        lines.append("")
        lines.append("### Feasibility plan")
        if fp.get("objective"):
            lines.append(f"- Objective: {fp['objective']}")
        for key, label in [
            ("samples_or_process_states", "Samples / process states"),
            ("reference_measurements", "Reference measurements"),
            ("comparisons", "Comparisons"),
            ("steps", "Steps"),
        ]:
            vals = _strs(fp.get(key))
            if vals:
                lines.append(f"- {label}:")
                lines.extend(f"    - {v}" for v in vals)
        if fp.get("go_no_go_basis"):
            lines.append(f"- Go / no-go basis: {fp['go_no_go_basis']}")

    # Citations (collected)
    cits = _collect_citations(a)
    if cits:
        lines.append("")
        lines.append("### Citations")
        lines.extend(f"- {c}" for c in cits)

    # Source conflicts
    conflicts = _dicts(a.get("source_conflicts"))
    if conflicts:
        lines.append("")
        lines.append("### Source conflicts")
        for c in conflicts:
            lines.append(f"- {c.get('description', '')} — _resolution:_ {c.get('resolution', '')}")

    # Verification
    meta = _obj(a.get("meta"))
    ver = meta.get("verification")
    lines.append("")
    lines.append("### Verification")
    ver = _obj(ver)
    if ver:
        lines.append(f"- Citations OK: {ver.get('citations_ok')}")
        lines.append(f"- Range check OK: {ver.get('range_check_ok')}")
        unsup = _strs(ver.get("unsupported_numbers"))
        lines.append(f"- Unsupported numbers: {', '.join(unsup) if unsup else 'none'}")
        warns = _strs(ver.get("warnings"))
        if warns:
            lines.append("- Warnings:")
            lines.extend(f"    - {w}" for w in warns)
        else:
            lines.append("- Warnings: none")
    else:
        lines.append("- (verification not run)")

    # Provenance footer
    lines.append("")
    model = meta.get("model", "?")
    kbv = meta.get("kb_version", "?")
    gen = meta.get("generated_at", "?")
    lines.append(f"_model: {model} · kb: {kbv} · generated: {gen}_")
    return lines


def _collect_citations(a: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    seen = set()

    def add_from(items):
        for item in _dicts(items):
            for c in _dicts(item.get("citations")):
                text = _fmt_citation(c)
                if text not in seen:
                    seen.add(text)
                    out.append(text)

    add_from(a.get("recommendations"))
    add_from(a.get("spectral_range"))
    add_from(a.get("risks"))
    add_from(a.get("source_conflicts"))
    add_from(a.get("premise_findings"))
    for key in ("inline_recommendation", "afs_pathway"):
        for c in _dicts(_obj(a.get(key)).get("citations")):
            text = _fmt_citation(c)
            if text not in seen:
                seen.add(text)
                out.append(text)
    mc = _obj(a.get("measurement_concept"))
    for c in _dicts(mc.get("citations")):
        text = _fmt_citation(c)
        if text not in seen:
            seen.add(text)
            out.append(text)
    return out


def to_markdown(assessment: Dict[str, Any]) -> str:
    """Render a full assessment report as Markdown."""
    case_id = assessment.get("case_id", "")
    lines: List[str] = []
    lines.append(f"> {HEADER_NOTE}")
    lines.append("")
    title = f"# Spectroscopy assessment — {case_id}" if case_id else "# Spectroscopy assessment"
    lines.append(title)
    lines.append("")
    for block in (_inline_section(assessment), _premise_section(assessment), _pathway_section(assessment)):
        if block:
            lines.extend(block)
            lines.append("")
    lines.extend(_summary_section(assessment))
    lines.append("")
    lines.extend(_reasoning_section(assessment))
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def summary_lines(assessment: Dict[str, Any]) -> List[str]:
    """The short summary block (used by the UI's summary view)."""
    out = [HEADER_NOTE, ""]
    for block in (_inline_section(assessment), _premise_section(assessment), _pathway_section(assessment)):
        if block:
            out += block + [""]
    return out + _summary_section(assessment)
