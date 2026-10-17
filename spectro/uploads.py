"""Read an attached enquiry file into plain text (txt, md, pdf, docx).

PDF uses pypdf (already a dependency); DOCX is read with the standard library
(the document XML inside the zip), so no extra package is needed.
"""
from __future__ import annotations

import io
import re
import zipfile


def read_upload(name: str, data: bytes) -> str:
    low = name.lower()
    if low.endswith((".txt", ".md")):
        return data.decode("utf-8", errors="replace").strip()
    if low.endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        text = "\n".join((page.extract_text() or "") for page in reader.pages[:30])
        if not text.strip():
            raise ValueError("no text layer found (a scanned PDF needs OCR first)")
        return " ".join(text.split())
    if low.endswith(".docx"):
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
        xml = re.sub(r"</w:p>", "\n", xml)
        text = re.sub(r"<[^>]+>", "", xml)
        return "\n".join(line.strip() for line in text.splitlines() if line.strip())
    raise ValueError("unsupported file type; use .txt, .md, .pdf or .docx")
