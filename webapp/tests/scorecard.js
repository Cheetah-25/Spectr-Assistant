// Trap scorecard for H01–H06. Each final-evaluation case contains one central trap; this script checks,
// from the saved answer JSON alone, whether the answer caught it, plus generic quality checks.
// It is an evaluation script only: the app never sees these rules.
// Usage: node tests/scorecard.js <dir-with-run-folders> --scenarios <final-evaluation file>   (each run folder holds H01.json … H06.json, raw model JSON)
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const { finalScenarios } = require("../final_scenarios.js");

const T = a => JSON.stringify([a.status_reason, a.answer, a.inline, a.problems, a.methods, a.multispectral, a.experiment]).toLowerCase();
const PROB = a => JSON.stringify([a.inline && a.inline.headline, a.inline && a.inline.not_final_because, a.status_reason, a.answer, a.problems]).toLowerCase();
const method = a => ((a.inline && a.inline.method) || "").toLowerCase();

// an overclaim is "ready/approved/validated for surgery" NOT preceded by a negation ("not as proof that … is ready for live surgery" is fine)
const overclaim = t => [...t.matchAll(/(ready|approved|validated) for (live )?surg/g)].some(m => !/(not|no|never|before|cannot|isn't|is not|without)\b[^.]{0,60}$/.test(t.slice(Math.max(0, m.index - 70), m.index)));
// an approval is "approved/approve" NOT preceded by a negation ("cannot be approved" is fine)
const approves = t => [...t.matchAll(/\b(is|are|be|been|was) approved\b|\bwe approve\b|\bapprove (this|the|your) (concept|design)\b|^"?approved\b|\bapproved:/g)].some(m => !/(not|no|never|cannot|can't|isn't|without|before)\b[^.]{0,40}$/.test(t.slice(Math.max(0, m.index - 50), m.index)));
const TRAPS = {
  H01: { trap: "Old NIR calibration is not valid for the new formulation; Raman does not keep it valid",
    test: a => /calibration/.test(PROB(a)) && /(cannot|can't|not|no longer) (be )?(assumed )?(valid|reused|transfer)|new calibration|re-?calibrat|recalibrat/.test(PROB(a)) && /raman/.test(PROB(a)) },
  H02: { trap: "Clear whey and opaque concentrate need different interfaces (transmission/transflection vs reflection)",
    test: a => /trans(mission|flection)/.test(T(a)) && /reflect/.test(T(a)) && /(whey|clear)/.test(T(a)) && /(concentrate|opaque)/.test(T(a)) },
  H03: { trap: "Fluorescence has no selectivity for glucose / viable biomass without a named fluorophore",
    test: a => !/^fluoresc/.test(method(a)) && /fluoresc/.test(PROB(a)) && /(selectiv|no (direct )?(fluorescen|fluorophore)|not (a |the )?(direct )?(glucose|method)|does not fluoresce|do not fluoresce|cannot (measure|report))/.test(PROB(a)) },
  H04: { trap: "Silica fiber cannot carry MIR; concept not approved as proposed",
    test: a => /silica/.test(PROB(a)) && /(cannot|can't|does not|do not|not) (be )?(carry|carried|transmit|reach|reuse|feasible)|only (about )?350|absorbs strongly|not feasible/.test(PROB(a)) && !approves(PROB(a)) },
  H05: { trap: "Target and contaminant undefined: no exact configuration, screen first",
    test: a => a.status === "insufficient_information" && /(contaminant|unknown|undefined|not (yet )?(known|named|defined))/.test(PROB(a)) && (a.questions || []).some(q => /contamin|specification|off-spec|what (is|are) the/i.test(q.q)) },
  H06: { trap: "Kidney in-vitro study is not proof for live surgery; outside supported scope",
    test: a => a.status === "outside_supported_scope" && /(in vitro|proof of concept|ex vivo)/.test(PROB(a)) && !overclaim(PROB(a)) },
};

(async () => {
  const dir = (process.argv[2] && !process.argv[2].startsWith("--")) ? process.argv[2] : path.join(__dirname, "..", "bench");
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto("file://" + path.resolve(__dirname, "..", "assessor.html")); await p.waitForFunction(() => window.__afsScore);
  const H = Object.fromEntries(finalScenarios().map(s => [s.id, s.enquiry]));
  const groups = fs.readdirSync(dir).filter(g => fs.statSync(path.join(dir, g)).isDirectory());
  const report = {};
  for (const g of groups) {
    const runs = fs.readdirSync(path.join(dir, g)).filter(r => fs.statSync(path.join(dir, g, r)).isDirectory()).sort();
    const rows = [];
    for (const r of runs) for (const id of Object.keys(TRAPS)) {
      const f = path.join(dir, g, r, id + ".json"); if (!fs.existsSync(f)) continue;
      let a; try { a = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { rows.push({ run: r, id, valid: false }); continue; }
      const s = await p.evaluate(([e, j]) => __afsScore(e, j), [H[id], a]);
      rows.push({ run: r, id, valid: true, trap: TRAPS[id].test(a), method_named: !!(s.method && !/none|no method/i.test(s.method)), hard_issues: s.hard.length,
        uncited_removed: s.dropped.length, sources: s.cited.length, unsupported_numbers: ((s.issues.find(x => /^numbers not found/.test(x)) || "").split(":")[1] || "").split(",").map(x => x.trim()).filter(Boolean).length, questions: (a.questions || []).length, steps: ((a.experiment || {}).steps || []).length, method: s.method, status: s.status });
    }
    const n = rows.length, pct = k => Math.round(100 * rows.filter(x => x[k]).length / Math.max(n, 1));
    const perCase = Object.fromEntries(Object.keys(TRAPS).map(id => { const rr = rows.filter(x => x.id === id); return [id, { trap: TRAPS[id].trap, caught: rr.filter(x => x.trap).length, runs: rr.length, valid: rr.filter(x => x.valid).length, methods: [...new Set(rr.map(x => x.method))] }]; }));
    const nv = rows.filter(x => x.valid).length;
    report[g] = { runs: runs.length, answers: n, valid_json_pct: pct("valid"), trap_caught_pct: pct("trap"), trap_caught_of_valid_pct: Math.round(100 * rows.filter(x => x.trap).length / Math.max(nv, 1)), method_named_pct: pct("method_named"),
      needed_repair: rows.filter(x => x.hard_issues).length, uncited_removed_total: rows.reduce((s, x) => s + (x.uncited_removed || 0), 0),
      answers_with_unsupported_numbers_pct: Math.round(100 * rows.filter(x => x.valid && x.unsupported_numbers > 0).length / Math.max(nv, 1)), avg_unsupported_numbers: +(rows.filter(x => x.valid).reduce((t, x) => t + x.unsupported_numbers, 0) / Math.max(nv, 1)).toFixed(1),
      avg_sources: +(rows.reduce((s, x) => s + (x.sources || 0), 0) / Math.max(n, 1)).toFixed(1), perCase, rows };
    console.log(`\n== ${g}: ${runs.length} run(s), ${n} answers`);
    console.log(`trap caught ${report[g].trap_caught_pct}% (of valid answers ${report[g].trap_caught_of_valid_pct}%) · method named ${report[g].method_named_pct}% · valid JSON ${report[g].valid_json_pct}% · needed repair ${report[g].needed_repair} · uncited removed ${report[g].uncited_removed_total} · avg sources ${report[g].avg_sources} · answers with numbers not in enquiry/sources ${report[g].answers_with_unsupported_numbers_pct}% (avg ${report[g].avg_unsupported_numbers})`);
    for (const [id, c] of Object.entries(perCase)) console.log(`  ${id} ${c.caught}/${c.runs} (valid ${c.valid})  ${c.trap}  | methods: ${c.methods.map(m => String(m || "").slice(0, 40)).join(" / ")}`);
  }
  fs.writeFileSync(path.join(dir, "scorecard.json"), JSON.stringify(report, null, 2));
  await b.close();
})();
