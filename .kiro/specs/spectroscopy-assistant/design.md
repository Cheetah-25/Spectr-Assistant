# Design — Spectroscopy Assistant

## Overview

A small, modular Python pipeline plus a Streamlit UI. The core idea is a strict separation between
**sourced claims** (grounded in a page-tagged knowledge base and verified in code) and everything the
LLM might otherwise invent. The LLM is used only where judgement is needed (fact extraction, the
schema-constrained assessment, and a one-time vision pass over the image-based deck). All grounding
guarantees — citation existence, quote presence, range compatibility, unsupported numbers, status
consistency — are enforced by deterministic Python, never by the model.

```
                    materials/ (PDFs, xlsx)
                           │
                     ingest.py  ──(vision x1 for S02)──► knowledge/ (committed, page-tagged, scoped)
                           │
 enquiry ─► assess.extract_facts ─► assess.assess (schema-constrained LLM, full KB in prompt)
                           │                                   │
                           │                               candidate JSON
                           ▼                                   │
                     verify.verify (pure Python) ◄─────────────┘
                           │  fail? → one repair pass (errors fed back) → verify again
                           ▼
                 render (json + markdown)  ──► outputs/  and  Streamlit UI
```

### Design principles
- **LLM proposes, code disposes.** Verification is code-only and authoritative.
- **Generic prompts.** No scenario text; hard rules phrased as reasoning instructions.
- **Deterministic artifacts.** KB and dev outputs are committed and reusable without re-running vision.
- **Provider-agnostic.** Provider + key via env vars; a thin LLM client abstracts text and vision.

---

## Architecture & modules

### Schema constraints (brevity — rule 8)
`schema/assessment.schema.json` adds `clarification_questions.maxItems = 5`,
`recommendations.maxItems = 3`, and `recommendations.items.properties.rationale.maxLength = 300`.
These encode the "be concise" rule structurally so both the model (via the schema in the prompt) and
the code checks enforce brevity.

### `schema_tools.py` + offline validation fallback
Validation goes through `spectro.schema_tools.schema_errors`, which uses the real `jsonschema`
(Draft 2020-12) when importable and otherwise a small **vendored** validator
(`spectro/_jsonschema_mini.py`) covering exactly the keywords this schema uses (`type`, `required`,
`additionalProperties`, `properties`, `items`, `enum`, `maxLength`, `maxItems`, `minimum`, local
`$ref`). This keeps PR 1 fully testable offline; `requirements.txt` still pins the real library for
production, and the code auto-switches when it is present. Either backend returns a list of error
strings (empty == valid).

### `kb.py` (knowledge-base model — internal helper)
Shared loader used by `assess.py`, `verify.py`, and the UI so the KB is read one way.

- `KBEntry`: `{ source_id, page, scope, text, kind }` where `kind ∈ {pdf_page, slide_notes, xlsx_rows, xlsx_notes}`.
- `KnowledgeBase`:
  - `load(knowledge_dir) -> KnowledgeBase`
  - `pages_for(source_id) -> set[int]`
  - `page_text(source_id, page) -> str | None`
  - `as_prompt_block() -> str` — the full page-tagged KB serialized for the assessment prompt, each
    chunk prefixed with a stable header like `=== S01 p.10 [scope=afs_technical] ===`.
  - `version` — hash/date string stored at ingest time (`meta.kb_version`).
- Rationale: one serialization avoids drift between what the LLM sees and what `verify.py` checks.

### `llm.py` (provider abstraction)
- Reads env vars:
  - `SPECTRO_LLM_PROVIDER` (`openai` (**default**), `anthropic`; overridable)
  - `SPECTRO_LLM_MODEL`, `SPECTRO_VISION_MODEL` (optional overrides)
  - provider key var (e.g. `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`)
- Interface:
  - `complete_json(system, user, schema) -> dict` — schema-constrained/JSON-mode text completion.
  - `describe_images(system, images: list[Path], user) -> str` — single vision call (used once for S02).
  - `model_name() -> str` for `meta.model`.
- On missing key/provider: raise `LLMConfigError` with a clear message (caught by callers / UI).
- Schema-constrained call: use the provider's JSON/structured-output mode where available; always
  re-validate locally with `jsonschema` regardless (never trust the provider to enforce the schema).

### `ingest.py`
Builds `knowledge/` from `materials/`.

- **Text PDFs (S01, S03, S04, S05):** extract text per page with `pypdf` (fallback `pdfminer.six`).
  Write one entry per page: `{source_id, page(1-based), scope, text}`. Preserve enough raw text that a
  short verbatim `quote` can be found later (store page text whitespace-normalized but complete).
- **S02 (image deck, 20 slides):** **no vision pass.** `ingest.py` loads the committed
  `knowledge/S02_slides.json` (a JSON object: `provenance` string + `slides` array of
  `{slide_number, title, description}`) and writes each slide as a KBEntry with `page = slide_number`
  and scope `"AFS slides"`. There is no `--force-vision` flag. (`kb.py` already loads this file in
  PR 1; PR 2 ingestion simply confirms/normalizes it alongside the other sources.)
- **xlsx (`AFS_method_comparison_table.xlsx`):** load with `openpyxl`/`pandas`. Keep the comparison
  table as structured rows and keep the notes sheet text. Store as `knowledge/method_table.json` with
  a note that it transcribes **S01 Table 1, p.6** (so citations point at S01 p.6).
- **Scope tags** (as implemented in `kb.SOURCE_SCOPE`): S01→`AFS technical`, S02→`AFS slides`,
  S03/S04→`research paper`, S05/S06→`business context`. S06 is a bare link (business context, not
  cited as technical evidence).
- Output: per-source JSON files under `knowledge/` plus a `knowledge/manifest.json`
  (`kb_version`, source list, page counts, scopes). `kb_version` = short hash of source bytes + date.
- Missing-file handling: fail fast naming the file.

### `assess.py`
Two stages; both prompts generic.

1. `extract_facts(enquiry) -> FactSheet` — LLM call returning `{stated[], unknowns[], assumptions[]}`.
   System prompt encodes rule 1 (anything not stated is unknown → ask or assume).
2. `assess(case_id, enquiry) -> assessment dict`:
   - Build system prompt = generic role + the steering **hard rules** (restated generically).
   - Build user prompt = enquiry + extracted fact sheet + `KnowledgeBase.as_prompt_block()`.
   - Call `llm.complete_json(..., schema)`.
   - Validate against schema; run `verify.verify`.
   - If invalid or verify fails → **one** repair call: same context + a compact list of the concrete
     errors (schema messages, bad citations, range mismatches, unsupported numbers, status warnings).
     Validate + verify again.
   - Fill `meta.model`, `meta.kb_version`, `meta.generated_at`; attach final `meta.verification`.
- The function returns the assessment plus the verification result; it does not raise on
  `insufficient_information` — that is a valid outcome.

### `verify.py` (no LLM)
Pure functions over `(assessment, knowledge_base, enquiry, fiber_families)`.

- `validate_schema(assessment) -> list[str]` via `jsonschema` (Draft 2020-12).
- `check_citations(assessment, kb) -> (ok, warnings)`:
  - every citation `source_id` in {S01..S05} and `page ∈ kb.pages_for(source_id)`;
  - if `quote` present → whitespace-normalized substring of `kb.page_text(source_id, page)`.
- `check_ranges(assessment, fibers) -> (ok, warnings)`:
  - normalize each `spectral_range[].nominal_range` to µm: `nm→um = nm/1000`; `cm-1→um = 10000/cm-1`
    (min/max swap after inversion handled);
  - if a `fiber_family` is named, require the method window ⊆ family `[min_um, max_um]` (with small
    tolerance); flag violations.
- `find_unsupported_numbers(assessment, kb, enquiry) -> list[str]`:
  - gather numeric tokens from free-text fields (rationale, notes, summaries, risks, questions…);
  - build an allowed-number set from KB text + enquiry text (normalized: strip units, unify decimals,
    treat `10000/x` conversions, ignore 1-digit list indices and schema enum values);
  - any leftover number → flagged string `"<number> in <field>"`.
- `check_status_consistency(assessment) -> list[str]`:
  - if blocking unknowns exist but a `primary_candidate` is given with `confidence=high`, or status is
    `provisional_assessment` with empty clarification questions, warn;
  - if status `insufficient_information`/`outside_supported_scope` but a confident primary
    recommendation is present, warn.
- `find_prices_and_codes(assessment, kb) -> list[str]` (steering rule 10): scan human-facing free text
  for currency/price amounts, cost/lead-time/delivery wording, and product codes (letters joined to
  a ≥2-digit run, e.g. `HWG-750`, `iC10`); flag any not present in the KB text. Citation structural
  fields (`source_id`, `unit`, `page`, `priority`, `min`, `max`) are excluded so enum tokens like
  `S01` are not mistaken for product codes.
- `check_research_readiness(assessment) -> list[str]` (steering rule 11): flag any citation whose
  `source_id ∈ {S03, S04}` and whose `supports` text makes a readiness/proof claim (regex over
  wording such as "ready", "proof", "proven", "validated", "clinical", "production-ready").
- `verify(...) -> VerifyResult { citations_ok, range_check_ok, unsupported_numbers[], warnings[], errors[] }`
  (rule-10 and rule-11 hits are added to `warnings`) and `write_verification(...)` to record the
  machine-checkable subset into `meta.verification`.

### `render.py` (helper used by runner + UI)
- **Every report begins with the exact mandated line** (constant `HEADER_NOTE`): "First assessment to
  support an AFS expert; not a final recommendation." (rule 9 / Output contract).
- `to_markdown(assessment) -> str`: a **short `## Summary`** (status + reason, top clarification
  questions, recommendations) followed by `## Show reasoning` carrying the detail — stated facts,
  unknowns, assumptions, measurement concept, spectral range, risks, feasibility plan, citations,
  source conflicts, and a verification summary block, plus a model/kb/generated footer.
- `summary_lines(assessment) -> list[str]`: the short summary block reused by the UI summary view.

### `run_scenarios.py`
- CLI: `python run_scenarios.py data/dev_scenarios.json [--out outputs/]`.
- For each scenario: read only `id`, `title`, `enquiry`; run `assess.assess`; write
  `outputs/<id>.json` and `outputs/<id>.md` (unedited). Never passes `useful_sources`.
- Prints a short per-case verification summary to stdout.

### `app.py` (Streamlit)
- Sidebar/env check: if `llm.config()` invalid → `st.warning` with setup hint, no crash.
- Input: free-text box + an example picker (ids/titles from `data/dev_scenarios.json`; only the
  `enquiry` is submitted).
- On submit: run pipeline; show **summary view** (status badge, top N clarification questions,
  recommendations). An expander **"Show reasoning"** reveals stated facts, assumptions, citations,
  source conflicts, and the verification result.

---

## Data model (selected)

KB entry (JSON on disk):
```json
{ "source_id": "S01", "page": 6, "scope": "afs_technical",
  "kind": "pdf_page", "text": "…whitespace-normalized page text…" }
```
S02 slide note:
```json
{ "source_id": "S02", "page": 13, "scope": "afs_technical", "kind": "slide_notes",
  "title": "…", "text": "Slide 13 — <title>: <description>" }
```
Method table rows (`knowledge/method_table.json`):
```json
{ "source_id": "S01", "page": 6, "locator": "Table 1", "scope": "afs_technical",
  "kind": "xlsx_rows", "rows": [ { "method": "...", "...": "..." } ],
  "notes": "…notes sheet text…",
  "text": "flattened text of rows+notes for quote/number checking" }
```
`meta.verification` (written by code):
```json
{ "citations_ok": true, "range_check_ok": true, "unsupported_numbers": [], "warnings": [] }
```

---

## Prompting strategy (generic, leakage-safe)

- **System prompt** = fixed role ("first technical assessment assistant for in-line fiber spectroscopy;
  support the expert, no final configuration") + the numbered hard rules restated generically.
- **User prompt** = `[ENQUIRY]` + `[EXTRACTED FACTS]` + `[KNOWLEDGE BASE]` (full page-tagged block) +
  `[OUTPUT CONTRACT]` reminder to return schema-valid JSON and to cite with `source_id`+`page`.
- **Repair prompt** appends `[VERIFICATION ERRORS]` with concrete, generic messages (e.g. "citation
  S03 p.42 does not exist", "number 1550 not found in sources or enquiry", "quote not on S01 p.10").
- No prompt contains any scenario noun/number. The leakage test scans prompt-source files and
  `.kiro/steering/` for distinctive phrases.

## Range-check math
- `um = nm / 1000`
- `um = 10000 / cm-1` (wavenumber→wavelength); a `[min_cm, max_cm]` maps to `[10000/max_cm, 10000/min_cm]`.
- Compatibility: method µm-window ⊆ fiber family `[min_um, max_um]` within tolerance `±2%`.

## Error handling
- Missing env/provider → `LLMConfigError`, surfaced cleanly in CLI/UI.
- Missing material file → ingest fails fast.
- LLM returns non-JSON/invalid → counts as a verify failure → single repair → if still failing, write
  the best candidate with `meta.verification.warnings` noting the unrecovered errors (artifact still
  committed unedited; the failure is visible, not hidden).

## Testing strategy
- `tests/fixtures/` holds a tiny valid assessment, an invalid one, and a tiny fake KB page so citation
  and range checks run without network.
- `test_schema.py` — valid passes, invalid fails.
- `test_citations.py` — existing page + present quote passes; missing page / absent quote flagged.
- `test_ranges.py` — cm⁻¹→µm conversion correctness; in-window vs out-of-window fiber families.
- `test_no_leakage.py` — scans prompt/rule files; fails if scenario-specific phrasing is present. Since
  the final-evaluation file is absent, the test asserts (a) no dev-scenario distinctive phrases
  (content 3-grams built from `data/dev_scenarios.json`) leaked into prompts/rules, and (b) prompt
  files contain no customer-specific nouns from a maintained denylist; it also scans a final file when
  one is provided via `SPECTRO_FINAL_SCENARIOS` (that test is skipped otherwise).
- `test_verify_extras.py` — unsupported numbers, prices/product codes (rule 10), status consistency,
  full `verify()` + `write_verification()`.
- `test_render_and_kb.py` — mandated header line, summary-before-reasoning ordering, verification
  block, and loading the committed `knowledge/S02_slides.json` (20 slides, scope "AFS slides").
- `test_llm_config.py` — offline: default provider, unsupported-provider error, missing-key guard.
- LLM is mocked in `assess` tests (PR 2); `verify`, `render`, `kb`, `schema_tools`, `llm` config are
  tested directly on fixtures with no network.

## Dependencies (`requirements.txt`)
`pypdf`, `pdfminer.six` (fallback), `pymupdf` (slide rendering), `openpyxl`, `pandas`, `jsonschema`,
`streamlit`, `python-dotenv`, and the chosen provider SDK(s) (`openai` and/or `anthropic`). `pytest`
for tests.
