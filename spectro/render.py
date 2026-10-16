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

    questions = a.get("clarification_questions", []) or []
    if questions:
        ordered = sorted(questions, key=lambda q: q.get("priority", 99))
        lines.append("")
        lines.append("**Top clarification questions:**")
        for q in ordered:
            lines.append(f"- ({q.get('could_change', '?')}) {q.get('question', '')}")

    recs = a.get("recommendations", []) or []
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

    req = a.get("requirements", {}) or {}
    stated = req.get("stated", []) or []
    lines.append("### Stated facts")
    if stated:
        lines.extend(f"- {s}" for s in stated)
    else:
        lines.append("- (none)")

    unknowns = req.get("unknowns", []) or []
    lines.append("")
    lines.append("### Unknowns")
    if unknowns:
        for u in unknowns:
            lines.append(f"- {u.get('item', '')} — _why it matters:_ {u.get('why_it_matters', '')}")
    else:
        lines.append("- (none)")

    assumptions = req.get("assumptions", []) or []
    lines.append("")
    lines.append("### Assumptions")
    if assumptions:
        lines.extend(f"- {s}" for s in assumptions)
    else:
        lines.append("- (none)")

    # Measurement concept
    mc = a.get("measurement_concept", {}) or {}
    lines.append("")
    lines.append("### Measurement concept")
    lines.append(mc.get("summary", "(not defined)"))
    if mc.get("geometry"):
        lines.append(f"- Geometry: {mc['geometry']}")
    if mc.get("fiber_link_note"):
        lines.append(f"- Fiber link: {mc['fiber_link_note']}")
    if mc.get("needs_afs_confirmation"):
        lines.append("- Needs AFS confirmation: yes")

    # Spectral range
    sr = a.get("spectral_range", []) or []
    if sr:
        lines.append("")
        lines.append("### Spectral range")
        for s in sr:
            rng = s.get("nominal_range")
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
    risks = a.get("risks", []) or []
    if risks:
        lines.append("")
        lines.append("### Risks")
        for r in risks:
            lines.append(f"- {r.get('risk', '')} — _mitigation:_ {r.get('mitigation', '')}")

    # Feasibility plan
    fp = a.get("feasibility_plan", {}) or {}
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
            vals = fp.get(key) or []
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
    conflicts = a.get("source_conflicts", []) or []
    if conflicts:
        lines.append("")
        lines.append("### Source conflicts")
        for c in conflicts:
            lines.append(f"- {c.get('description', '')} — _resolution:_ {c.get('resolution', '')}")

    # Verification
    meta = a.get("meta", {}) or {}
    ver = meta.get("verification")
    lines.append("")
    lines.append("### Verification")
    if ver:
        lines.append(f"- Citations OK: {ver.get('citations_ok')}")
        lines.append(f"- Range check OK: {ver.get('range_check_ok')}")
        unsup = ver.get("unsupported_numbers") or []
        lines.append(f"- Unsupported numbers: {', '.join(unsup) if unsup else 'none'}")
        warns = ver.get("warnings") or []
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
        for item in items or []:
            for c in item.get("citations", []) or []:
                text = _fmt_citation(c)
                if text not in seen:
                    seen.add(text)
                    out.append(text)

    add_from(a.get("recommendations"))
    add_from(a.get("spectral_range"))
    add_from(a.get("risks"))
    add_from(a.get("source_conflicts"))
    mc = a.get("measurement_concept") or {}
    for c in mc.get("citations", []) or []:
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
    lines.extend(_summary_section(assessment))
    lines.append("")
    lines.extend(_reasoning_section(assessment))
    lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def summary_lines(assessment: Dict[str, Any]) -> List[str]:
    """The short summary block (used by the UI's summary view)."""
    return [HEADER_NOTE, ""] + _summary_section(assessment)
