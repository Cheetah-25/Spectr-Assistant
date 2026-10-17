"""Page-tagged knowledge-base model.

The knowledge base is a set of entries, each tagged with a source id and a
1-based page number (for S02 the page number is the slide number). Entries are
loaded from the ``knowledge/`` directory. Two on-disk shapes are understood:

1.  Per-source page files produced by ``ingest.py`` (PR 2), e.g.
    ``knowledge/S01.json`` -> ``{"source_id", "scope", "pages": [{"page", "text"}...]}``
    and ``knowledge/method_table.json`` (the xlsx transcription).

2.  The committed ``knowledge/S02_slides.json`` hand-written slide notes:
    ``{"provenance": "...", "slides": [{"slide_number", "title", "description"}...]}``.

This module performs NO LLM calls and NO network access. It is the single place
that serializes the KB for the assessment prompt, so what the model sees and what
``verify.py`` checks never drift apart.
"""
from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional

_REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_KNOWLEDGE_DIR = _REPO_ROOT / "knowledge"

# Scope tags per source (see .kiro/steering/project.md).
SOURCE_SCOPE = {
    "S01": "AFS technical",
    "S02": "AFS slides",
    "S03": "research paper",
    "S04": "research paper",
    "S05": "business context",
    "S06": "business context",
}

# Sources that are research papers: must never be cited as proof of process or
# clinical readiness (steering rule 11). verify.py enforces this.
RESEARCH_SOURCES = {"S03", "S04"}

_WS_RE = re.compile(r"\s+")


def normalize_ws(text: str) -> str:
    """Collapse all whitespace runs to single spaces and strip ends."""
    return _WS_RE.sub(" ", text or "").strip()


@dataclass(frozen=True)
class KBEntry:
    source_id: str
    page: int
    scope: str
    kind: str  # pdf_page | slide_notes | xlsx_rows | xlsx_notes
    text: str
    title: Optional[str] = None
    locator: Optional[str] = None

    @property
    def tag(self) -> str:
        return f"{self.source_id} p.{self.page}"


@dataclass
class KnowledgeBase:
    entries: List[KBEntry] = field(default_factory=list)
    version: str = "unversioned"
    provenance: Dict[str, str] = field(default_factory=dict)

    # -- indexing -----------------------------------------------------------
    def _index(self) -> Dict[str, Dict[int, KBEntry]]:
        idx: Dict[str, Dict[int, KBEntry]] = {}
        for e in self.entries:
            idx.setdefault(e.source_id, {})[e.page] = e
        return idx

    def sources(self) -> List[str]:
        return sorted({e.source_id for e in self.entries})

    def pages_for(self, source_id: str) -> set:
        return {e.page for e in self.entries if e.source_id == source_id}

    def page_text(self, source_id: str, page: int) -> Optional[str]:
        for e in self.entries:
            if e.source_id == source_id and e.page == page:
                return e.text
        return None

    def scope_for(self, source_id: str) -> Optional[str]:
        for e in self.entries:
            if e.source_id == source_id:
                return e.scope
        return SOURCE_SCOPE.get(source_id)

    def all_text(self) -> str:
        """Concatenated KB text, used by the unsupported-number check."""
        return "\n".join(e.text for e in self.entries)

    # -- prompt serialization ----------------------------------------------
    def as_prompt_block(self) -> str:
        """Serialize the full page-tagged KB for the assessment prompt.

        Entries are grouped by source and ordered by page so the model sees a
        stable, readable layout. Each chunk is headed with its citation tag and
        scope so the model can cite precisely and respect scope limits.
        """
        lines: List[str] = []
        for source_id in sorted({e.source_id for e in self.entries}):
            src_entries = sorted(
                (e for e in self.entries if e.source_id == source_id),
                key=lambda e: e.page,
            )
            for e in src_entries:
                header = f"=== {e.tag} [scope={e.scope}]"
                if e.title:
                    header += f" | {e.title}"
                header += " ==="
                lines.append(header)
                lines.append(e.text)
                lines.append("")  # blank separator
        return "\n".join(lines).strip()

    # -- construction -------------------------------------------------------
    @classmethod
    def load(cls, knowledge_dir: str | Path | None = None) -> "KnowledgeBase":
        kdir = Path(knowledge_dir) if knowledge_dir else DEFAULT_KNOWLEDGE_DIR
        entries: List[KBEntry] = []
        provenance: Dict[str, str] = {}

        if not kdir.exists():
            return cls(entries=[], version="empty", provenance=provenance)

        # 1) Slide notes (committed in PR 1).
        slides_path = kdir / "S02_slides.json"
        if slides_path.exists():
            entries.extend(_load_slides(slides_path, provenance))

        # 2) Per-source page files and the method table (produced in PR 2).
        for path in sorted(kdir.glob("*.json")):
            name = path.name
            if name in {"S02_slides.json", "manifest.json"}:
                continue
            if name == "method_table.json":
                entries.extend(_load_method_table(path))
                continue
            entries.extend(_load_source_pages(path))

        version = _compute_version(kdir)
        return cls(entries=entries, version=version, provenance=provenance)


# -- loaders ---------------------------------------------------------------
def _load_slides(path: Path, provenance: Dict[str, str]) -> List[KBEntry]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    if data.get("provenance"):
        provenance["S02"] = data["provenance"]
    out: List[KBEntry] = []
    for slide in data.get("slides", []):
        n = int(slide["slide_number"])
        title = normalize_ws(slide.get("title", ""))
        desc = normalize_ws(slide.get("description", ""))
        text = normalize_ws(f"{title}. {desc}") if title else desc
        out.append(
            KBEntry(
                source_id="S02",
                page=n,
                scope=SOURCE_SCOPE["S02"],
                kind="slide_notes",
                text=text,
                title=title or None,
            )
        )
    return out


def _load_source_pages(path: Path) -> List[KBEntry]:
    """Load a per-source page file: {source_id, scope, pages:[{page,text}]}."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    source_id = data.get("source_id") or path.stem
    scope = data.get("scope") or SOURCE_SCOPE.get(source_id, "unknown")
    out: List[KBEntry] = []
    for page in data.get("pages", []):
        out.append(
            KBEntry(
                source_id=source_id,
                page=int(page["page"]),
                scope=scope,
                kind="pdf_page",
                text=normalize_ws(page.get("text", "")),
                locator=page.get("locator"),
            )
        )
    return out


def _load_method_table(path: Path) -> List[KBEntry]:
    """Load knowledge/method_table.json (xlsx transcription of S01 Table 1 p.6)."""
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    source_id = data.get("source_id", "S01")
    page = int(data.get("page", 6))
    scope = data.get("scope", SOURCE_SCOPE.get(source_id, "AFS technical"))
    text = data.get("text")
    if not text:
        # Flatten rows + notes into searchable text for quote/number checks.
        rows = data.get("rows", [])
        flat_rows = " ; ".join(
            " ".join(f"{k}={v}" for k, v in row.items()) for row in rows
        )
        text = normalize_ws(f"{flat_rows} {data.get('notes', '')}")
    entries = [
        KBEntry(
            source_id=source_id,
            page=page,
            scope=scope,
            kind="xlsx_rows",
            text=normalize_ws(text),
            locator=data.get("locator", "Table 1"),
        )
    ]
    return entries


def _compute_version(kdir: Path) -> str:
    """Short, stable version string from the bytes of all knowledge files."""
    h = hashlib.sha256()
    for path in sorted(kdir.glob("*.json")):
        h.update(path.name.encode("utf-8"))
        h.update(path.read_bytes())
    return "kb-" + h.hexdigest()[:12]
