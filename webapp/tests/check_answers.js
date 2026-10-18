// Re-run the web app's code checks on every saved model answer (no API key needed):
// outputs/H0x.raw.json and tests/hard_cases_answers/*.json. Prints method, status, cited sources and any remaining issue.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const { finalScenarios } = require("../final_scenarios.js");   // H texts from the final-evaluation file (--scenarios / SPECTRO_FINAL_SCENARIOS)
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto("file://" + path.resolve(__dirname, "..", "assessor.html")); await p.waitForFunction(() => window.__afsScore);
  const H = Object.fromEntries(finalScenarios().map(s => [s.id, s.enquiry]));
  const C = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(__dirname, "hard_cases.json"))).map(c => [c.id, c.enquiry]));
  const items = Object.keys(H).filter(id => /^H/.test(id)).map(id => [id, H[id], path.join(__dirname, "..", "outputs", id + ".raw.json")]).filter(x => fs.existsSync(x[2]))
    .concat(fs.readdirSync(path.join(__dirname, "hard_cases_answers")).map(f => { const id = f.match(/C\d\d/)[0]; return [f.replace(".json", ""), C[id], path.join(__dirname, "hard_cases_answers", f)]; }));
  let bad = 0;
  for (const [id, enq, f] of items) {
    const s = await p.evaluate(([e, j]) => __afsScore(e, j), [enq, JSON.parse(fs.readFileSync(f, "utf8"))]);
    if (s.hard.length) bad++;
    console.log(id.padEnd(12), (s.method || "").padEnd(26), (s.status || "").padEnd(26), "sources", String(s.cited.length).padStart(2), s.issues.length ? "| " + s.issues.join("; ") : "| ok");
  }
  console.log(bad ? `${bad} answer(s) would need the repair pass` : "all answers pass the hard checks");
  await b.close();
})();
