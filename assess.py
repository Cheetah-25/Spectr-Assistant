#!/usr/bin/env python3
"""Top-level entry point for assessing a single enquiry.

The implementation lives in ``spectro/assess.py`` (library code, unit-tested with
a mocked LLM). This module re-exports it and adds a small CLI so a single
free-text enquiry can be assessed from the command line:

    python assess.py --case live --enquiry "We have an opaque liquid process ..."
    echo "..." | python assess.py --case live

It requires a configured LLM provider + key (see README). No network call is made
at import time.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# Re-export the library API so `from assess import assess, extract_facts` works.
from spectro.assess import assess, extract_facts  # noqa: E402,F401
from spectro import render  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Assess a single spectroscopy enquiry.")
    parser.add_argument("--case", default="live", help="case id (default: live)")
    parser.add_argument("--enquiry", help="enquiry text; if omitted, read from stdin")
    parser.add_argument("--markdown", action="store_true", help="print the markdown report")
    args = parser.parse_args(argv)

    enquiry = args.enquiry if args.enquiry is not None else sys.stdin.read()
    enquiry = (enquiry or "").strip()
    if not enquiry:
        print("assess: no enquiry text provided", file=sys.stderr)
        return 2

    assessment, result = assess(args.case, enquiry)
    if args.markdown:
        print(render.to_markdown(assessment))
    else:
        print(json.dumps(assessment, ensure_ascii=False, indent=2))
    # Non-zero when checks did not fully pass, so callers can notice.
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
