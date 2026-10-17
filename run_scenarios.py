#!/usr/bin/env python3
"""Run a scenario file through the assessment pipeline.

For each case it runs extract -> assess -> verify -> one repair pass -> render,
then writes ``outputs/<id>.json`` and ``outputs/<id>.md`` UNEDITED, and prints a
short verification summary per case.

Only the case id/title and the ``enquiry`` text are used. Developer hints such as
``useful_sources`` are never passed to the model.

Usage:
    python run_scenarios.py data/dev_scenarios.json
    python run_scenarios.py path/to/scenarios.json --out outputs/

Requires a configured LLM provider + key (see README). This script makes no
network call at import time; it calls the provider only while processing cases.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import List, Optional

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from spectro import assess, render  # noqa: E402
from spectro.kb import KnowledgeBase  # noqa: E402
from spectro import verify as verify_mod  # noqa: E402

DEFAULT_OUT = REPO_ROOT / "outputs"


def load_scenarios(path: Path) -> List[dict]:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    scenarios = data.get("scenarios") if isinstance(data, dict) else data
    if not scenarios:
        raise SystemExit(f"run_scenarios: no scenarios found in {path}")
    return scenarios


def _summary_line(case_id: str, result: verify_mod.VerifyResult, status: str) -> str:
    flags = []
    flags.append("citations_ok" if result.citations_ok else "CITATIONS_FAIL")
    flags.append("range_ok" if result.range_check_ok else "RANGE_FAIL")
    if result.unsupported_numbers:
        flags.append(f"unsupported_numbers={len(result.unsupported_numbers)}")
    if result.warnings:
        flags.append(f"warnings={len(result.warnings)}")
    if result.errors:
        flags.append(f"schema_errors={len(result.errors)}")
    verdict = "OK" if result.ok else "CHECK"
    return f"[{case_id}] {verdict} status={status} ({', '.join(flags)})"


def run(scenario_path: Path, out_dir: Path) -> int:
    scenarios = load_scenarios(scenario_path)
    out_dir.mkdir(parents=True, exist_ok=True)
    kb = KnowledgeBase.load()

    rc = 0
    for sc in scenarios:
        case_id = sc.get("id") or sc.get("case_id") or "live"
        enquiry = sc.get("enquiry", "")
        if not enquiry:
            print(f"[{case_id}] SKIP (no enquiry text)", file=sys.stderr)
            continue

        # NOTE: only id/enquiry are used. Developer hints (useful_sources, etc.)
        # are deliberately NOT read here.
        assessment, result = assess.assess(case_id, enquiry, kb=kb)

        json_path = out_dir / f"{case_id}.json"
        md_path = out_dir / f"{case_id}.md"
        with open(json_path, "w", encoding="utf-8") as fh:
            json.dump(assessment, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        with open(md_path, "w", encoding="utf-8") as fh:
            fh.write(render.to_markdown(assessment))

        print(_summary_line(case_id, result, assessment.get("decision_status", "?")))
        if not result.ok:
            rc = 1  # surface that at least one case needs expert attention
    return rc


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Run scenarios through the assessment pipeline.")
    parser.add_argument("scenarios", help="path to a scenario JSON file")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output directory (default: outputs/)")
    args = parser.parse_args(argv)

    scenario_path = Path(args.scenarios)
    if not scenario_path.exists():
        print(f"run_scenarios: scenario file not found: {scenario_path}", file=sys.stderr)
        return 2
    return run(scenario_path, Path(args.out))


if __name__ == "__main__":
    raise SystemExit(main())
