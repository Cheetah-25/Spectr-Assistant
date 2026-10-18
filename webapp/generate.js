// Regenerate the assessments for H01–H06 (or any enquiry file) with the same pipeline the web app uses:
// premise checks + BM25 retrieval -> one prompt (identical for every case) -> Claude -> code checks -> at most one repair -> drop uncited -> export.
// Usage:  npm install && ANTHROPIC_API_KEY=... node generate.js --scenarios ../customer_scenarios_for_final_evaluation.txt [--model claude-opus-5-5] [--cases H01,H02] [--out outputs]
// The final-evaluation file is read at run time and never committed.
// Nothing in this script or in the prompt depends on the case id.
const { chromium } = require("playwright");
const { finalScenarios } = require("./final_scenarios.js");
const fs = require("fs"), path = require("path");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const MODEL = arg("model", process.env.MODEL || "claude-opus-5-5");
const OUT = arg("out", "outputs"), ONLY = arg("cases", "");
const KEY = process.env.ANTHROPIC_API_KEY;
if (!KEY) { console.error("Set ANTHROPIC_API_KEY"); process.exit(1); }

async function claude(prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
    headers: { "x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 6000, messages: [{ role: "user", content: prompt }] }) });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  const t = (await r.json()).content.map(c => c.text || "").join("");
  const m = t.match(/\{[\s\S]*\}/); if (!m) throw new Error("no JSON in reply"); return JSON.parse(m[0]);
}

(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto("file://" + path.resolve(__dirname, "assessor.html")); await p.waitForFunction(() => window.__afsPrompt);
  let cases = finalScenarios();
  if (ONLY) cases = cases.filter(c => ONLY.split(",").includes(c.id));
  fs.mkdirSync(OUT, { recursive: true }); const log = [];
  for (const c of cases) {
    const prompt = await p.evaluate(e => __afsPrompt(e, null), c.enquiry);
    let a = await claude(prompt), repaired = false;
    let s = await p.evaluate(([e, j]) => __afsScore(e, j), [c.enquiry, a]);
    if (s.hard.length) {
      const fix = await claude(prompt + `\n\nYOUR PREVIOUS JSON FAILED THESE CHECKS, fix them and return the full JSON:\n- ${s.hard.join("\n- ")}\n\nPREVIOUS JSON:\n${JSON.stringify(a)}`);
      if (fix && fix.inline) { a = fix; repaired = true; s = await p.evaluate(([e, j]) => __afsScore(e, j), [c.enquiry, a]); }
    }
    const ex = await p.evaluate(([e, j]) => __afsExport(e, j), [c.enquiry, a]);
    fs.writeFileSync(path.join(OUT, `${c.id}.md`), ex.md); fs.writeFileSync(path.join(OUT, `${c.id}.json`), ex.json);
    fs.writeFileSync(path.join(OUT, `${c.id}.raw.json`), JSON.stringify(a, null, 2));
    log.push({ id: c.id, model: MODEL, repaired, method: s.method, status: s.status, cited_sources: s.cited.length, remaining_issues: s.issues, removed_uncited: ex.dropped });
    console.log(c.id, s.method, s.status, "sources", s.cited.length, repaired ? "(repaired)" : "", s.issues.length ? "issues: " + s.issues.join("; ") : "");
  }
  fs.writeFileSync(path.join(OUT, "run_log.json"), JSON.stringify({ generated: new Date().toISOString(), model: MODEL, cases: log }, null, 2));
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });
