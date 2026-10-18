# Spectr-Assistant

> **Demo version: `webapp/`.** A chat assistant (single HTML page, runs as a Claude artifact or in any browser) with
> RAG over the AFS materials, premise checks, strict citations and downloadable reports. The final answers to
> H01–H06 generated with it are in `webapp/outputs/`; repeated runs and a trap scorecard are in `webapp/bench/`.
> See [`webapp/README.md`](webapp/README.md) for the architecture, the use of AFS materials, setup and results.
> The Streamlit app below is the earlier Python version.

## Run the app

```bash
source .venv/bin/activate
export OPENAI_API_KEY="..."      # or ANTHROPIC_API_KEY with SPECTRO_LLM_PROVIDER=anthropic
streamlit run app.py
```

Paste a customer enquiry (or pick an example) and press **Assess**. The summary view shows the status,
the main clarification questions and the recommendations; **Show reasoning** lists stated facts,
assumptions, citations, source conflicts and the automatic verification result. Every report is a
first assessment to support an AFS expert, not a final recommendation.

Citation quotes that are too long or not verbatim on the cited page are removed by the code (the page
citation stays) and listed in the verification warnings.

## Premise checks, in-line answer and AFS pathway

Before the LLM call, `spectro/checks.py` runs generic premise checks on the enquiry (no scenario wording;
`tests/test_no_leakage.py` scans the file). Each check is a fact the model must address:

| Check | Label | What it catches |
|---|---|---|
| `fiber_range_mismatch` | Won't work | A named fibre that does not transmit the method's window (computed from `data/fiber_families.json`) |
| `long_mid_ir_link` | Won't work / Check first | A mid-IR method with a distant analyser (long reach is documented only for silica, S02 p.7, p.9) |
| `calibration_transfer` | Wrong assumption | Reusing a calibration on a changed matrix, or adding a method to keep it valid |
| `sensitivity_without_target` | Won't work | A sensitive, low-selectivity method requested with no named target (S01 p.5, p.6; S04 p.4) |
| `research_as_proof` | Won't work / Wrong assumption | Research results quoted as proof of readiness (clinical use is outside scope) |
| `undefined_target` | Check first | The variable or contaminant is not named yet (S01 p.3) |
| `premature_certainty` | Check first | Approval or an exact configuration requested before the facts allow it |
| `mixed_optical_regimes` | Check first | Clear and opaque/turbid material in one request (S01 p.16-18) |

The verifier warns (and triggers the repair pass) if a computed check is missing from `premise_findings`, or if the
in-line answer pairs a method with a fibre that cannot carry its range.

Each report now opens with:
1. **Recommended in-line method**: method, probe, install point, fibre family, what to test it against.
2. **Problems with the request**: the premise findings in plain words.
3. **AFS pathway** (S05, S02 p.20): methods for the multi-method lab test, key spectral features, and the
   tailored solution path (A chemometric model, B custom MSF system, C spectral fiber sensor).

The app accepts the enquiry as text or as an attached `.txt`, `.md`, `.pdf` or `.docx` file.

## Generate the final outputs (H01-H06)

```bash
export OPENAI_API_KEY="..."            # or SPECTRO_LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY
python run_scenarios.py customer_scenarios_for_final_evaluation.txt   # plain-text format is parsed directly
git add outputs/H0*.json outputs/H0*.md   # commit unedited
```
