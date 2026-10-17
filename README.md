# Spectr-Assistant
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
