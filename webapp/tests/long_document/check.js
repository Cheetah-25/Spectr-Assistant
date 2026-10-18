// Long-document test: uploads the synthetic 30-page project PDF into the app, prints the extracted parameters,
// and re-runs the app's checks on the saved model answers. Needs: npm install (playwright) and pdfjs-dist@3.11.174
// (served locally because the headless browser may not reach the CDN):  npm i pdfjs-dist@3.11.174
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const PJ = path.dirname(require.resolve("pdfjs-dist/build/pdf.min.js")) + "/";
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.route("**/pdf.js/3.11.174/pdf.min.js", r => r.fulfill({ path: PJ + "pdf.min.js", contentType: "application/javascript" }));
  await p.route("**/pdf.js/3.11.174/pdf.worker.min.js", r => r.fulfill({ path: PJ + "pdf.worker.min.js", contentType: "application/javascript" }));
  await p.goto("file://" + path.resolve(__dirname, "..", "..", "assessor.html")); await p.waitForFunction(() => window.__afsDoc);
  await p.setInputFiles("#file", path.join(__dirname, "PS-2026-114_biodiesel_project_SYNTHETIC.pdf")); await p.waitForFunction(() => window.__afsDoc());
  const D = await p.evaluate(() => __afsDoc());
  console.log(`${D.name}: ${D.pages} pages, ${D.chunks} passages, ${D.params.length} technical statements`);
  const ENQ = "Please give a first technical assessment of the attached project document." + D.digest;
  for (const f of ["answer_fast.json", "answer_strong.json"]) {
    const s = await p.evaluate(([e, j]) => __afsScore(e, j), [ENQ, JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"))]);
    console.log(f, "| method", s.method, "| sources", s.cited.length, "| document pages cited", s.cited.filter(x => /DOC/.test(x)).length, "| issues", s.issues.length ? s.issues.join("; ") : "none");
  }
  await b.close();
})();
