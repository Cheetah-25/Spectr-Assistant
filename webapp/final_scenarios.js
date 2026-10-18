// Reads the final-evaluation enquiries (H01–H06) from the organisers' text file at run time.
// The file is NOT committed (repo rule); pass its path with --scenarios or SPECTRO_FINAL_SCENARIOS.
// Format: a line of '=' signs, "Hxx | Title", a line of '=' signs, then the enquiry text up to the next rule line.
const fs = require("fs"), path = require("path");
function parseFinal(text) {
  const out = [], lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(H\d\d)\s*\|\s*(.+)$/);
    if (!m || !/^=+$/.test((lines[i + 1] || "").trim())) continue;
    const body = []; let j = i + 2;
    for (; j < lines.length && !/^(=+|-{3,}|#.*)\s*$/.test(lines[j].trim()); j++) body.push(lines[j]);
    out.push({ id: m[1], title: m[2].trim(), enquiry: body.join(" ").replace(/\s+/g, " ").trim() });
  }
  return out;
}
function finalScenarios(argv = process.argv) {
  const i = argv.indexOf("--scenarios");
  const p = (i > 0 && argv[i + 1]) || process.env.SPECTRO_FINAL_SCENARIOS || path.join(__dirname, "..", "customer_scenarios_for_final_evaluation.txt");
  if (!fs.existsSync(p)) throw new Error(`Final scenario file not found: ${p}. Pass --scenarios <path> or set SPECTRO_FINAL_SCENARIOS.`);
  const s = parseFinal(fs.readFileSync(p, "utf8"));
  if (!s.length) throw new Error(`No Hxx enquiries found in ${p}`);
  return s;
}
module.exports = { parseFinal, finalScenarios };
