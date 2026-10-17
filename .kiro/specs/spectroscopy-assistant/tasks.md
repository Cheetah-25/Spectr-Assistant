# Implementation Plan — Spectroscopy Assistant

> **Delivery order (per user):** PR 1 = skeleton + `kb.py` + `verify.py` + `render.py` + tests (offline,
> pytest green). PR 2 = `ingest.py` + `assess.py` + `run_scenarios.py`. PR 3 = `app.py` + README.

- [x] 1. Project skeleton, repo reorganization, and config  *(PR 1)*
  - Created `materials/`, `data/`, `schema/`, `knowledge/`, `outputs/`, `tests/` and moved existing
    files with `git mv` (PDFs + xlsx → `materials/`; scenario/fiber JSON → `data/`; schema → `schema/`).
  - Moved steering content to `.kiro/steering/project.md` (rules 1–11); removed the old copy.
  - Added `requirements.txt` (with offline-fallback note), Python `.gitignore`, `pytest.ini`.
  - Added `spectro/llm.py` provider abstraction reading env vars (default provider `openai`); raises
    `LLMConfigError` on missing config; exposes `complete_json`, `describe_images`, `model_name`.
    Makes no network call unless explicitly invoked with a key.
  - Added `spectro/schema_tools.py` + vendored `spectro/_jsonschema_mini.py` fallback validator.
  - Updated `schema/assessment.schema.json`: `clarification_questions.maxItems=5`,
    `recommendations.maxItems=3`, `rationale.maxLength=300`.
  - _Requirements: 7.*, 8.1, 8.2, 8.3, 10.1, 10.2, 10.3_

- [x] 2. Knowledge-base model (`kb.py`)  *(PR 1)*
  - Implemented `KBEntry`, `KnowledgeBase.load` (loads committed `S02_slides.json` + any per-source
    page files + method table), `pages_for`, `page_text` (whitespace-normalized), `scope_for`,
    `all_text`, `as_prompt_block`, and a content-hash `version`.
  - _Requirements: 1.5, 1.6, 2.2_

- [x] 4. Verification (`verify.py`, no LLM)  *(PR 1)*
  - `schema_errors` (via schema_tools), `check_citations` (page exists + quote present),
    `check_ranges` (nm/cm⁻¹→µm, fiber-family window), `find_unsupported_numbers`,
    `find_prices_and_codes` (rule 10), `check_research_readiness` (rule 11),
    `check_status_consistency`, and `verify(...)` returning `VerifyResult` + `write_verification`.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [x] 6. Rendering (`render.py`)  *(PR 1 — brought forward)*
  - `to_markdown(assessment)` starting with the mandated header line; short `## Summary` +
    `## Show reasoning` detail incl. verification summary. `summary_lines` for the UI.
  - _Requirements: 4.3, 5.2, 5.3, 5.4a_

- [x] 9. Tests (`tests/`)  *(PR 1)*
  - Fixtures (valid assessment, tiny fake KB, enquiry). `test_schema.py`, `test_citations.py`,
    `test_ranges.py`, `test_verify_extras.py`, `test_render_and_kb.py`, `test_llm_config.py`,
    `test_no_leakage.py`. LLM-free; 43 pass, 1 skipped (final-scenario leakage, opt-in via env).
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1_

- [x] 3. Ingestion (`ingest.py`)  *(PR 2)*
- [x] 3.1 Text PDFs + xlsx
  - Per-page extraction for S01/S03/S04/S05 (1-based) via pypdf→pdfminer fallback; page-tagged
    entries with scope. xlsx loaded as structured rows + notes sheet (openpyxl, with a stdlib
    fallback that runs offline), tagged S01 Table 1 p.6. Writes `knowledge/<Sxx>.json`,
    `method_table.json`, `manifest.json` (kb_version, page counts, scopes). Fails clearly on missing
    files (`--check` validates inputs without writing).
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 9.1_
- [x] 3.2 S02 slides (no vision)
  - Loads/validates the committed `knowledge/S02_slides.json` (20 slides) and records it in the
    manifest as `S02`, scope "AFS slides". No vision call, no `--force-vision`.
  - _Requirements: 1.3, 8.2, 9.1_

- [x] 5. Assessment (`spectro/assess.py` + top-level `assess.py` CLI)  *(PR 2)*
  - `extract_facts(enquiry)`; generic prompts in `spectro/prompts.py` carry only hard rules 1–11;
    assessment user prompt includes the full page-tagged KB. Schema-constrained call + local
    re-validation; exactly one repair pass fed the concrete verify errors. Populates `meta.*`;
    treats `insufficient_information` as valid. Tested with a mocked LLM (no network).
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.4a, 2.5, 2.6, 7.1, 7.2_

- [x] 7. Batch runner (`run_scenarios.py`)  *(PR 2)*
  - CLI over a scenario file; per case writes `outputs/<id>.json` + `.md`, unedited; forwards only
    id/enquiry (never `useful_sources`); prints a per-case verification summary. Tested with assess
    monkeypatched.
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.3, 9.2, 9.3_

- [ ] 8. Streamlit UI (`app.py`)  *(PR 3)*
  - Free-text box + example picker (enquiry only); short summary view; "Show reasoning" expander;
    graceful env-missing message.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 8.3_

- [ ] 10. Generate committed artifacts + README  *(PR 2 artifacts; PR 3 README)*
  - Run `ingest.py` to build/commit `knowledge/` (incl. S02 slides). Run `run_scenarios.py` on
    `data/dev_scenarios.json` to produce `outputs/` for D01–D08, committed unedited.
  - Write README: setup, env vars, how to ingest/run/test, layout. Ensure `pytest` passes.
  - _Requirements: 9.1, 9.2, 9.3, 1.*, 4.5_

> Note: tasks 3.2 (loading committed slide notes — no LLM), 5, and the artifact generation in 10
> require a configured LLM provider + key to actually RUN. Per the user, no external API is called
> from this environment: the LLM steps are implemented and left ready to run locally. Code-only parts
> (2, 4, 6, 9, and the runner/UI wiring) are fully testable offline, and PR 1's suite is green.
