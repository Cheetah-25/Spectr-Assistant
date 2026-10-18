"""Build assessor.html from chat.html by inlining the scripts.
   python3 build_chat.py                      -> repository build: development examples D01–D08 only
   python3 build_chat.py --final <file.txt>   -> demo build: also adds the H01–H06 example buttons from the
                                                 organisers' final-evaluation file (do not commit that build)."""
import json, re, sys
final = sys.argv[sys.argv.index("--final") + 1] if "--final" in sys.argv else None
out = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else "assessor.html"
p = open("chat.html").read()
scen = open("scenarios_dev.js").read()
if final:
    lines, items = open(final, encoding="utf-8").read().splitlines(), []
    for i, l in enumerate(lines):
        m = re.match(r"^(H\d\d)\s*\|\s*(.+)$", l)
        if not m or not re.match(r"^=+$", (lines[i + 1] if i + 1 < len(lines) else "").strip()): continue
        body, j = [], i + 2
        while j < len(lines) and not re.match(r"^(=+|-{3,}|#.*)\s*$", lines[j].strip()): body.append(lines[j]); j += 1
        items.append({"id": m.group(1), "title": m.group(2).strip(), "enquiry": re.sub(r"\s+", " ", " ".join(body)).strip()})
    scen += "\n(function(r){r.AFS_SCENARIOS=r.AFS_SCENARIOS.concat(" + json.dumps(items, ensure_ascii=False) + ");})(typeof window!=='undefined'?window:globalThis);"
    print(len(items), "final enquiries added")
for tag, src in [('/*__KB__*/', open('kb.js').read()), ('/*__ENGINE__*/', open('engine.js').read()), ('/*__SCEN__*/', scen),
                 ('/*__RAG__*/', open('rag.js').read()), ('/*__SPEC__*/', open('spectra.js').read()), ('/*__EXT__*/', open('ext.js').read())]:
    assert tag in p, tag
    p = p.replace(tag, src.replace('</script', '<\\/script'))
open(out, 'w').write(p); print(out, len(p))
