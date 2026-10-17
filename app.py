"""Streamlit UI for the Spectroscopy Assistant.

Run:  streamlit run app.py
Needs a configured LLM provider and key (see README). The assessment is a FIRST assessment to
support an AFS expert; it is not a final recommendation.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import streamlit as st

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spectro import assess, render  # noqa: E402
from spectro.kb import KnowledgeBase  # noqa: E402

st.set_page_config(page_title="Spectroscopy Assistant", layout="wide")


@st.cache_resource
def _kb() -> KnowledgeBase:
    return KnowledgeBase.load()


@st.cache_data
def _examples() -> list:
    path = ROOT / "data" / "dev_scenarios.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = data.get("scenarios") if isinstance(data, dict) else data
    return [x for x in (items or []) if isinstance(x, dict) and x.get("enquiry")]


st.title("In-line spectroscopy: first assessment")
st.caption(render.HEADER_NOTE)

examples = _examples()
choice = st.selectbox(
    "Example enquiry (optional)",
    ["(write your own)"] + [f"{e.get('id', '')}: {e.get('title', '')}" for e in examples],
)
default_text = ""
if choice != "(write your own)":
    default_text = examples[[f"{e.get('id', '')}: {e.get('title', '')}" for e in examples].index(choice)]["enquiry"]

enquiry = st.text_area("Customer enquiry", value=default_text, height=180, key=f"enq-{choice}")

if st.button("Assess", type="primary", disabled=not enquiry.strip()):
    with st.spinner("Reading the AFS knowledge base and checking the answer..."):
        try:
            assessment, result = assess.assess("live", enquiry.strip(), kb=_kb())
        except Exception as exc:  # show a readable message instead of a stack trace
            st.error(f"The assessment could not be produced: {exc}")
        else:
            st.session_state["assessment"] = assessment

assessment = st.session_state.get("assessment")
if assessment:
    summary = render._summary_section(assessment)
    st.markdown("\n".join(summary))
    meta = assessment.get("meta", {}).get("verification", {})
    if meta.get("warnings") or meta.get("unsupported_numbers"):
        st.warning("Some automatic checks raised notes. See 'Show reasoning' for details.")
    with st.expander("Show reasoning"):
        st.markdown("\n".join(render._reasoning_section(assessment)))
    st.download_button(
        "Download report (Markdown)",
        render.to_markdown(assessment),
        file_name="assessment.md",
    )
    st.download_button(
        "Download report (JSON)",
        json.dumps(assessment, ensure_ascii=False, indent=2),
        file_name="assessment.json",
    )
