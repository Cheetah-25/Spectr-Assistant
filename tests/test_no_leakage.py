"""Leakage test.

Fails if prompt or rule files contain scenario-specific / distinctive wording.
The point is to keep the assistant's *behaviour* generic: no customer nouns,
no example answers, no industry-specific rules baked into prompts or steering.

What is scanned:
  * prompt-bearing source files (assess.py and any spectro/prompts* files), and
  * the steering rules (.kiro/steering/project.md).

What counts as leakage:
  * distinctive multi-word phrases taken verbatim from the development scenarios
    (built dynamically from data/dev_scenarios.json), and
  * a small denylist of customer-specific nouns that must never appear in prompts.

If a final-evaluation scenario file is provided via the SPECTRO_FINAL_SCENARIOS
environment variable, its distinctive phrases are scanned too. The file itself is
never committed and is not required for this test to run.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import List

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent

# Files that may carry prompt text or rules. These are the surfaces that must
# stay generic. (Files that merely *run* scenarios at runtime are fine.)
PROMPT_FILES = [
    _REPO_ROOT / "assess.py",
    _REPO_ROOT / "spectro" / "assess.py",
    _REPO_ROOT / "spectro" / "prompts.py",
    _REPO_ROOT / ".kiro" / "steering" / "project.md",
]

# Customer / scenario-specific nouns that must never appear in prompt or rule
# text. (Generic spectroscopy vocabulary like "NIR" or "fiber" is allowed.)
NOUN_DENYLIST = [
    "tablet press",
    "feed frame",
    "whey",
    "dairy",
    "yeast",
    "fermentation",
    "petroleum",
    "chicken",
    "kidney",
    "extrusion",
    "bioprocess",
    "cell culture",
]

_STOPWORDS = set(
    """a an the and or of to in on for with without that this these those we our you your they
    it is are was were be been being as at by from into than then so such not no yes can could
    would should will may might must have has had do does did more most less least very over under
    about above below between during before after up down out off only also both each any some all
    its their his her them us me my i he she who whom which what when where why how if but because
    while per via vs using used use want would like need needs first initial early change changes
    changing measurement measurements process processes product products option options compare
    comparison material results laboratory lab reference check checks already exist existing
    """.split()
)


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return ""


def _distinctive_phrases_from_scenarios(scenario_path: Path) -> List[str]:
    """Build distinctive multi-word phrases from a scenario file's enquiry text.

    We take windows of consecutive non-stopword tokens so we match memorable,
    scenario-specific spans rather than generic vocabulary.
    """
    if not scenario_path.exists():
        return []
    data = json.loads(scenario_path.read_text(encoding="utf-8"))
    scenarios = data.get("scenarios", data if isinstance(data, list) else [])
    phrases: List[str] = []
    for sc in scenarios:
        text = " ".join(
            str(sc.get(k, "")) for k in ("title", "enquiry")
        )
        tokens = re.findall(r"[A-Za-z][A-Za-z\-]+", text.lower())
        content = [t for t in tokens if t not in _STOPWORDS and len(t) > 3]
        # 3-grams of content words = distinctive phrases.
        for i in range(len(content) - 2):
            phrases.append(" ".join(content[i : i + 3]))
    # De-duplicate.
    return sorted(set(phrases))


def _combined_prompt_text() -> str:
    return "\n".join(_read(p).lower() for p in PROMPT_FILES if p.exists())


def test_prompt_files_exist_or_are_optional():
    # At least the steering file must exist and be scannable.
    steering = _REPO_ROOT / ".kiro" / "steering" / "project.md"
    assert steering.exists(), "steering rules file must exist to be scanned for leakage"


def test_no_customer_nouns_in_prompts_or_rules():
    text = _combined_prompt_text()
    leaked = [noun for noun in NOUN_DENYLIST if noun.lower() in text]
    assert not leaked, f"customer-specific nouns leaked into prompt/rule files: {leaked}"


def test_no_dev_scenario_phrases_in_prompts():
    phrases = _distinctive_phrases_from_scenarios(_REPO_ROOT / "data" / "dev_scenarios.json")
    text = _combined_prompt_text()
    leaked = [p for p in phrases if p in text]
    assert not leaked, f"development-scenario phrases leaked into prompt/rule files: {leaked[:10]}"


@pytest.mark.skipif(
    not os.environ.get("SPECTRO_FINAL_SCENARIOS"),
    reason="no final-evaluation scenario file provided (SPECTRO_FINAL_SCENARIOS unset)",
)
def test_no_final_scenario_phrases_in_prompts():
    final_path = Path(os.environ["SPECTRO_FINAL_SCENARIOS"])
    phrases = _distinctive_phrases_from_scenarios(final_path)
    text = _combined_prompt_text()
    leaked = [p for p in phrases if p in text]
    assert not leaked, f"final-scenario phrases leaked into prompt/rule files: {leaked[:10]}"
