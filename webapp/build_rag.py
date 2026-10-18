"""Rebuild rag.js (passages for BM25 retrieval) from the repository knowledge files.
Usage: python3 build_rag.py ../knowledge   -> writes rag.js
Pages are split into ~750-character passages on sentence boundaries; ids are P:<source>-p<page>-<n>."""
import json, re, sys, os
K = sys.argv[1] if len(sys.argv) > 1 else "../knowledge"
SCOPE = {"S01": "technical", "S03": "clinical-research", "S04": "lab research", "S05": "business", "S02": "technical slides"}
MAXP = {"S03": 14}            # S03: reference list from page 15 on is not used
def chunks(text, size=750):
    sents = re.split(r"(?<=[.!?])\s+", re.sub(r"\s+", " ", text).strip()); out, cur = [], ""
    for s in sents:
        if cur and len(cur) + 1 + len(s) > size: out.append(cur); cur = s
        else: cur = (cur + " " + s).strip()
    if cur: out.append(cur)
    return out
P = []
for sid in ["S01", "S03", "S04", "S05"]:
    d = json.load(open(os.path.join(K, sid + ".json")))
    for pg in d["pages"]:
        if sid in MAXP and pg["page"] > MAXP[sid]: continue
        for i, t in enumerate(chunks(pg["text"]), 1):
            P.append({"id": f"P:{sid}-p{pg['page']}-{i}", "src": sid, "page": pg["page"], "scope": SCOPE[sid], "text": t})
s = json.load(open(os.path.join(K, "S02_slides.json")))
for sl in s["slides"]:
    text = ". ".join(x for x in [sl.get("title", ""), sl.get("description", "")] if x)
    for i, t in enumerate(chunks(text), 1):
        P.append({"id": f"P:S02-p{sl['slide_number']}-{i}", "src": "S02", "page": sl["slide_number"], "scope": SCOPE["S02"], "text": t})
open("rag.js", "w").write("(function(r){r.AFS_RAG=" + json.dumps({"passages": P}, ensure_ascii=False) + ";})(typeof window!=='undefined'?window:globalThis);")
print(len(P), "passages")
