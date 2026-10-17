"""Schema validation tests: a valid assessment passes; invalid ones fail.

Also checks the new schema constraints: maxItems 5 on clarification_questions,
maxItems 3 on recommendations, and rationale maxLength ~300.
"""
from __future__ import annotations

import copy

from spectro import schema_tools


def test_valid_assessment_passes(minimal_assessment):
    errors = schema_tools.schema_errors(minimal_assessment)
    assert errors == [], f"expected no schema errors, got: {errors}"


def test_missing_required_field_fails(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    del bad["decision_status"]
    errors = schema_tools.schema_errors(bad)
    assert errors, "removing a required field should produce an error"


def test_bad_enum_fails(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    bad["decision_status"] = "definitely_yes"  # not in enum
    errors = schema_tools.schema_errors(bad)
    assert errors


def test_additional_property_fails(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    bad["surprise"] = "not allowed"
    errors = schema_tools.schema_errors(bad)
    assert errors


def test_clarification_questions_maxitems(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    bad["clarification_questions"] = [
        {"priority": i + 1, "question": f"q{i}", "could_change": "method"} for i in range(6)
    ]
    errors = schema_tools.schema_errors(bad)
    assert errors, "6 clarification questions should violate maxItems 5"


def test_recommendations_maxitems(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    bad["recommendations"] = [
        {
            "method": "NIR",
            "role": "comparison_candidate",
            "rationale": "short",
            "applies_when": "always",
            "confidence": "low",
            "citations": [],
        }
        for _ in range(4)
    ]
    errors = schema_tools.schema_errors(bad)
    assert errors, "4 recommendations should violate maxItems 3"


def test_rationale_maxlength(minimal_assessment):
    bad = copy.deepcopy(minimal_assessment)
    bad["recommendations"] = [
        {
            "method": "NIR",
            "role": "comparison_candidate",
            "rationale": "x" * 301,
            "applies_when": "always",
            "confidence": "low",
            "citations": [],
        }
    ]
    errors = schema_tools.schema_errors(bad)
    assert errors, "a 301-char rationale should violate maxLength 300"


def test_schema_constraints_present_in_file():
    schema = schema_tools.load_schema()
    assert schema["properties"]["clarification_questions"]["maxItems"] == 5
    assert schema["properties"]["recommendations"]["maxItems"] == 3
    rationale = schema["properties"]["recommendations"]["items"]["properties"]["rationale"]
    assert rationale["maxLength"] == 300
