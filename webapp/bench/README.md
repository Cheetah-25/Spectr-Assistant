# Benchmark: H01–H06, repeated runs

Each final-evaluation case contains one central trap. `tests/scorecard.js` checks every saved answer for it, plus generic quality checks, using fixed rules written before the runs. The rules were validated on six deliberately wrong answers, which all fail.

| Case | Trap the answer must catch |
|---|---|
| H01 | The old NIR calibration is not valid for the new formulation; adding Raman does not keep it valid |
| H02 | Clear whey and opaque concentrate need different interfaces (transmission/transflection vs reflection) |
| H03 | Fluorescence has no selectivity for glucose or viable biomass without a named fluorophore |
| H04 | The silica fiber cannot carry MIR; the concept is not approved as proposed |
| H05 | Target and contaminant are undefined: no exact configuration, screen first |
| H06 | The in-vitro kidney study is not proof for live surgery; outside the supported scope |

## Groups

* **strong/** – our pipeline, Claude Opus (strongest tier). These are the submitted answers in `outputs/`.
* **fast/** – our pipeline, Claude fast tier (the tier the live demo uses), 5 independent runs.
* **baseline/** – the same fast model with only the enquiry and the six tasks of the brief: no premise checks, no retrieval, no AFS sources, no citation rule. 2 runs.

All groups use the identical prompt per case within the group; no answer was edited.

## Results

| | Our pipeline, strong | Our pipeline, fast (5 runs) | Baseline, fast (no pipeline) |
|---|---|---|---|
| Answers | 6 | 30 | 12 |
| Valid structured answer | 100% | 97% | 75% |
| Trap caught (all answers) | 100% | 97% | 75% |
| Trap caught (valid answers) | 100% | 100% | 100% |
| Method to test named | 100% | 97% | 75% |
| AFS sources cited per answer | 25.2 | 19.5 | 0 |
| Answers with numbers found in neither the enquiry nor the AFS materials | 0% | 0% | 78% (3 per answer) |
| Needed the repair pass | 0 | 1 (invented citation id) | — |

## What this shows

* Claude recognises these traps with or without our pipeline when it returns a valid answer. Catching them is necessary but not what sets the assistant apart.
* The difference is **grounding and reliability**: with the pipeline every answer cites the AFS pages it relies on (20–25 sources) and contains no number that is not in the enquiry or the AFS materials. Without it, 78% of answers state figures such as band positions or reference methods from general knowledge, with nothing an AFS expert can check them against.
* In the app, an invalid model answer never reaches the user: the rule-engine answer, which also catches the trap, stays on screen.

## Reproduce

```bash
node tests/scorecard.js bench --scenarios ../customer_scenarios_for_final_evaluation.txt   # writes bench/scorecard.json
```
