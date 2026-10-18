# In-line Spectroscopy Assessor (web app)

A chat assistant that helps an AFS expert make a **first technical assessment** of a customer's in-line spectroscopy problem. It names the method to test first, checks the request against the AFS materials, asks what is missing, and proposes a first feasibility experiment. Every statement carries a citation to the supplied AFS materials; anything uncited is removed before it is shown.

It does not replace the expert: the output is a structured draft for the first customer discussion.

## What it produces for each enquiry

| Section | Content |
|---|---|
| Requirements and constraints | What the client stated (material, target, location, conditions, constraints) and what is still missing |
| Recommended in-line method | Method, probe/interface, install point, fiber, the alternative to test against, why it is not final yet |
| Risks and problems with the request | Won't work / wrong assumption / check first, each with sources |
| Methods worth testing | Main, compare, only if needed, not suitable |
| Multispectral option | Which pair, why complementary, same-spot vs synchronised probes, data fusion, how to prove the gain |
| Clarification questions | Up to 5, answerable by the client; answers re-assess the case in the chat |
| First feasibility experiment | Objective, steps, independent references, go/no-go |
| AFS pathway | Lab test → key spectral features → Path A / B / C (from the AFS flyer) |
| Sources cited | Every passage or claim used, with its full text; external pages with link and quoted passage |

Each answer can be downloaded as Markdown or JSON. Attached spectra (CSV/TXT) are analysed in the browser (SNV, Savitzky–Golay, peaks, PCA, band matching to source-cited bands, fiber coverage) and fed into the assessment.

## Long project documents (e.g. a 30-page project paper)

Attach a PDF, DOCX or TXT longer than about 3,000 characters and the app switches to document mode:

1. **Read and index.** pdf.js / mammoth extract the text per page (up to 80 pages); each page is split into ~700-character passages with ids `P:DOC-p<page>-<n>`, cited as `Doc p.N`.
2. **Extract technical statements in code.** Regular expressions find temperatures, pressures, flows, concentration ranges, wavelengths, pipe sizes and distances, pH, viscosity, response times, ATEX zones, cleaning, materials, reference methods, optical state and methods already in use, each with its page. They appear as a table on the document card and as the requirements list of the instant answer.
3. **Select what the model reads.** Every passage holding an extracted parameter (page order), topped up by BM25 hits, at most 16, plus the AFS passages. A 30-page paper becomes a prompt of about 44,000 characters instead of the whole document.
4. **Assess in detail.** The prompt asks for concrete values with units and page refs, and a **technical specification**: spectral window, probe and window material, fiber family and length, process conditions per measurement point, sampling and response, reference method, first calibration design. The spectral window is also computed in code from the method and fiber ranges.
5. **Check.** The client document is evidence only for facts about the client's process, never that a method works. Numbers must appear in the document, the enquiry or the AFS sources (unit conversions µm ↔ cm⁻¹, nm ↔ cm⁻¹ and ppm ↔ % are accepted); the technical specification must cite its sources or it is removed.

Test (`tests/long_document/`): a synthetic 30-page project specification for a biodiesel line (three measurement points, ATEX Zone 1, analyzer house 45–60 m away, GC and Karl Fischer references, 900 retained samples, plus 20 pages of project-management text). The app extracts 55 technical statements; the model answers cite 9–10 document pages and 36–39 sources in total and report the measurement points, ranges, distances, reference methods and retained samples correctly. A first version missed the reference-method page because only the 8 best BM25 passages were sent; sending every parameter-bearing passage fixed it.

## Architecture

```
enquiry (chat, .txt/.pdf/.docx, optional spectra)
   │
   ├─ 1. Premise checks (engine.js)         rule-based checks that are true for any case of a kind:
   │                                         fiber transmits the method range? calibration transfer?
   │                                         Raman vs fluorescent sample? clinical readiness? contradictions?
   │                                         Each finding cites the knowledge base. Also gives the instant answer.
   │
   ├─ 2. Retrieval (chat.html, rag.js)      BM25 over 254 page passages of S01–S05 (+3 for multi-method fusion);
   │                                         external research pages (ext.js) only when the enquiry is about imaging/tissue.
   │
   ├─ 3. One prompt for every case          rules + premise findings + retrieved passages + curated claims (kb.js)
   │      → Claude (JSON schema)             strict citation rule: every section must cite passage/claim ids
   │
   ├─ 4. Code checks (verifier)             unknown citation ids · numbers not in enquiry or sources ·
   │                                         fiber vs method range (per method of a combination) ·
   │                                         a method must be named · uncited sections
   │      → at most one repair pass          only for hard errors (fiber, no method, invented ids)
   │
   └─ 5. Enforcement + display              uncited problems/methods/multispectral are removed and listed;
                                             full "Sources cited" list; download MD/JSON
```

* The instant answer from the rule engine appears in milliseconds; Claude's answer replaces it when it arrives.
* Without Claude (e.g. a plain browser), the app still works with the rule engine alone.
* **No case-specific code.** Nothing depends on a scenario id; H01–H06 run through the same prompt and checks as any new enquiry. The final-evaluation texts are not stored in the repository. The team's leakage check (3-word phrases from the H01–H06 and D01–D08 texts) finds none in the prompt, verifier or rule files; the only matches are in the AFS source pages themselves. The rules in `engine.js` are written per topic (fiber range, dairy optics, clinical readiness, …) and also apply to new enquiries (see `tests/hard_cases.json`).

## Use of the AFS materials

| Material | How it is used |
|---|---|
| S01 Multispectral Laboratory (incl. Table 1, p.6) | Method properties, probe classes, application examples (pharma, bioprocess, dairy), multi-method synergy, same-spot probes, fusion |
| S02 AFS process-control slides | Fiber transmission ranges (silica, CIR, PIR, hollow waveguide), long silica links, petroleum water-in-oil, extrusion, combined probes, band chart, gas bands |
| S03 LED kidney study | Limits of clinical evidence (in vitro proof of concept) |
| S04 Combined MIR + fluorescence probe | Same-spot multimodal probe, amide/ester/porphyrin/FAD bands |
| S05 Flyer | AFS pathway (lab test → key features → Path A/B/C); business context only, never technical evidence |
| Organisers' reference (section 5) | Unit conversion |
| External (X01–X05, web pages, quoted) | Multispectral imaging research (CVC Barcelona, Fraunhofer IOF, TU Munich MSOT, Lübeck OCT, MIT); context only, never evidence for an in-line fiber method |

`kb.js` holds curated, page-tagged claims; `rag.js` holds the page passages (rebuild with `build_rag.py` from `../knowledge`). Every citation shown in the app resolves to one of them.

## Files

| File | Purpose |
|---|---|
| `assessor.html` | The built app (single file, open in a browser or publish as a Claude artifact) |
| `chat.html` | App template; `build_chat.py` inlines the scripts below into `assessor.html` |
| `kb.js`, `rag.js`, `ext.js` | Curated claims, page passages, external quoted passages |
| `engine.js` | Premise checks, rule engine, verifier |
| `spectra.js` | Spectra parsing and analysis |
| `scenarios_dev.js` | D01–D08 development enquiries for the example buttons |
| `final_scenarios.js` | Reads H01–H06 from the organisers' final-evaluation file at run time (the file is not committed) |
| `generate.js` | Regenerates H01–H06 with the app's pipeline via the Anthropic API |
| `bench/` | Repeated runs (strong, 5× fast, no-pipeline baseline) and the trap scorecard results |
| `outputs/` | H01–H06 answers (`.md`, `.json`, raw model JSON) and `run_log.json` |
| `tests/` | Engine check, 10 hard cases with model answers, `check_answers.js`, `scorecard.js` (trap scorecard), `long_document/` (30-page PDF test) |

## Setup

```bash
cd webapp
npm install                       # playwright, used by generate.js and the tests
python3 build_rag.py ../knowledge # optional: rebuild rag.js from the knowledge files
python3 build_chat.py             # builds assessor.html (development examples only)
python3 build_chat.py --final ../customer_scenarios_for_final_evaluation.txt --out demo.html   # demo build with H01–H06 buttons; do not commit
open assessor.html                # rule-engine mode in any browser
```

With Claude: publish `assessor.html` as a Claude artifact with the `sample` capability (Claude runs on the viewer's own account, no API key in the page).

Regenerate the final answers:

```bash
export SPECTRO_FINAL_SCENARIOS=../customer_scenarios_for_final_evaluation.txt   # read at run time, never committed
ANTHROPIC_API_KEY=... node generate.js --model claude-opus-5-5   # writes outputs/H0x.md|json and run_log.json
npm run check                                                    # re-runs all code checks on the saved answers
node tests/scorecard.js bench                                    # trap scorecard over all benchmark runs
```

## Results

**H01–H06** (`outputs/`, Claude Opus with the current prompt including the technical specification, same prompt for every case, unedited; all passed every check without repair, nothing removed; one derived value in H05 is flagged for expert review):

| Case | Method to test first | Status | Sources cited |
|---|---|---|---|
| H01 New formulation after NIR pilot | NIR + Raman with a new calibration for the new blend, against NIR alone | Provisional | 19 |
| H02 Two dairy streams | NIR: transmission/transflection for whey, diffuse reflection for concentrate | Provisional | 26 |
| H03 Fluorescence for glucose and viable biomass | Raman for glucose, NIR as comparison; fluorescence not a direct readout | Provisional | 26 |
| H04 Silica link for petroleum MIR ATR | MIR ATR on CIR fiber in the lab; silica cable cannot carry MIR; not approved | Insufficient information | 24 |
| H05 Undefined off-spec liquid | MIR ATR lab screen of in-spec vs off-spec samples, against Raman and NIR | Insufficient information | 30 |
| H06 Research sensor for surgery | NIR diffuse reflection on paired ex vivo samples only | Outside supported scope | 31 |

**Benchmark** (`bench/README.md`): over 5 fast-tier runs and two strong runs, every valid answer caught its case's trap and named a method. A no-pipeline baseline (same model, enquiry only) also caught the traps, but cited nothing and 78% of its answers contained figures found in neither the enquiry nor the AFS materials; with the pipeline: 0%.

**Hard cases** (`tests/hard_cases.json`, 10 new enquiries: Raman on a fluorescent broth with a guarantee demand, 40 m chalcogenide link at 260 °C, contradictory sample description, vague request, prompt injection, intraoperative tumour margins, German enquiry, exhaust gas, tablet coating, follow-up that changes the stream). All answers named a method, gave no guarantee or invented detection limit, ignored the injection; one invented citation id was caught and fixed by the repair pass.

## Limits

* A first assessment only: feasibility must be shown in the laboratory on the client's samples.
* The knowledge base covers what the AFS materials cover; gases, hazardous areas and long mid-IR links are only briefly or not covered, and the assistant says so.
* Answers vary between model runs; the code checks keep every run within the sources.
