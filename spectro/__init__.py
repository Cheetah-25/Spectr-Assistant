"""Spectroscopy Assistant package.

A small, modular pipeline that turns in-line fiber-spectroscopy customer enquiries
into schema-validated first assessments for review by an AFS expert.

Offline guarantees in this package (PR 1):
  * kb.py            - the page-tagged knowledge-base model
  * verify.py        - deterministic, LLM-free verification checks
  * render.py        - human-readable rendering of an assessment
  * schema_tools.py  - schema loading + validation (real jsonschema or vendored fallback)

None of these import an LLM SDK or make any network call.
"""

__all__ = ["kb", "verify", "render", "schema_tools"]
