// Spectral analysis for the chat app: parse, detect units/method, preprocess, peaks,
// band matching against bands named in the AFS sources, fibre coverage, PCA and key features.
(function (root) {
const KB = root.AFS_KB;

// ---------- parsing (CSV / TSV / TXT; first column x, one or more y columns)
function parseTable(text, fileName) {
  const lines = text.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(l => l && !/^[#;%]/.test(l));
  if (!lines.length) throw new Error("empty file");
  const delim = [/\t/, /;/, /,/, /\s+/].find(rx => lines.slice(0, 20).filter(l => rx.test(l)).length > 10 || lines.slice(0, 5).every(l => rx.test(l))) || /\s+/;
  const rows = lines.map(l => l.split(delim).map(s => s.trim()).filter(s => s !== ""));
  const isNum = s => /^[-+]?(\d+[.,]?\d*|[.,]\d+)([eE][-+]?\d+)?$/.test(s);
  const num = s => parseFloat(s.replace(",", "."));
  let header = null, start = 0;
  if (!rows[0].every(isNum)) { header = rows[0]; start = 1; }
  const data = rows.slice(start).filter(r => r.length >= 2 && isNum(r[0]) && isNum(r[1]));
  if (data.length < 10) throw new Error("need at least 10 numeric rows with two columns (x, intensity)");
  const ncol = Math.min(...data.map(r => r.length));
  const x = data.map(r => num(r[0]));
  const base = (fileName || "spectrum").replace(/\.[^.]+$/, "");
  const series = [];
  for (let j = 1; j < ncol; j++) {
    const nm = header && header[j] ? header[j] : (ncol > 2 ? `${base}_${j}` : base);
    series.push({ name: nm, y: data.map(r => num(r[j])) });
  }
  return { x, series };
}

// ---------- axis / method detection
const KINDS = {
  "MIR (cm-1)": { unit: "cm-1", method: "MIR ATR" },
  "Raman shift (cm-1)": { unit: "cm-1", method: "Raman" },
  "NIR (nm)": { unit: "nm", method: "NIR" },
  "NIR (cm-1, FT-NIR)": { unit: "cm-1", method: "NIR" },
  "UV-Vis (nm)": { unit: "nm", method: "UV-Vis" },
  "Fluorescence emission (nm)": { unit: "nm", method: "Fluorescence" },
  "MIR (µm)": { unit: "um", method: "MIR ATR" },
};
function guessKind(x) {
  const lo = Math.min(...x), hi = Math.max(...x);
  if (hi <= 30) return "MIR (µm)";
  if (lo >= 3500 && hi <= 13000) return "NIR (cm-1, FT-NIR)";
  if (hi > 2600) return lo < 350 ? "Raman shift (cm-1)" : "MIR (cm-1)";
  if (lo >= 700) return "NIR (nm)";
  if (lo >= 400 && hi <= 900) return "Fluorescence emission (nm)";
  return "UV-Vis (nm)";
}
const toNm = (v, unit) => unit === "nm" ? v : unit === "um" ? v * 1000 : 1e7 / v;

// ---------- resampling and preprocessing
function resample(x, y, grid) {
  const idx = x.map((v, i) => i).sort((a, b) => x[a] - x[b]);
  const xs = idx.map(i => x[i]), ys = idx.map(i => y[i]);
  let k = 0;
  return grid.map(g => {
    while (k < xs.length - 2 && xs[k + 1] < g) k++;
    const x0 = xs[k], x1 = xs[k + 1], t = x1 === x0 ? 0 : (g - x0) / (x1 - x0);
    return ys[k] + Math.max(0, Math.min(1, t)) * (ys[k + 1] - ys[k]);
  });
}
const SG_SMOOTH = [-21, 14, 39, 54, 59, 54, 39, 14, -21].map(v => v / 231);
const SG_D2 = [28, 7, -8, -17, -20, -17, -8, 7, 28].map(v => v / 462);
function conv(y, c) { const h = (c.length - 1) / 2; return y.map((_, i) => { let s = 0; for (let j = -h; j <= h; j++) s += c[j + h] * y[Math.min(y.length - 1, Math.max(0, i + j))]; return s; }); }
function snv(y) { const m = y.reduce((a, b) => a + b, 0) / y.length; const sd = Math.sqrt(y.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, y.length - 1)) || 1; return y.map(v => (v - m) / sd); }

// ---------- peaks (local maxima with prominence)
function peaks(x, y, maxN = 8) {
  const s = conv(y, SG_SMOOTH), rng = Math.max(...s) - Math.min(...s) || 1, out = [];
  const w = Math.max(3, Math.round(s.length / 60));
  for (let i = w; i < s.length - w; i++) {
    let isMax = true; for (let j = i - w; j <= i + w; j++) if (s[j] > s[i]) { isMax = false; break; }
    if (!isMax) continue;
    const left = Math.min(...s.slice(Math.max(0, i - 6 * w), i)), right = Math.min(...s.slice(i + 1, i + 6 * w));
    const prom = (s[i] - Math.max(left, right)) / rng;
    if (prom > 0.04) out.push({ x: x[i], prom });
  }
  return out.sort((a, b) => b.prom - a.prom).slice(0, maxN);
}

// ---------- bands named in the sources (and flagged general knowledge)
const BANDS = [
  { m: "MIR ATR", u: "cm-1", lo: 1730, hi: 1755, label: "ester carbonyl C=O near 1740 cm⁻¹ (lipids / fat)", cite: "S04-3-design" },
  { m: "MIR ATR", u: "cm-1", lo: 1620, hi: 1665, label: "amide I near 1640 cm⁻¹ (protein); water bending also lies here", cite: "S04-3-amide" },
  { m: "MIR ATR", u: "cm-1", lo: 1530, hi: 1565, label: "amide II near 1548 cm⁻¹ (protein)", cite: "S04-3-amide" },
  { m: "MIR ATR", u: "cm-1", lo: 2700, hi: 3333, label: "hydrocarbon C–H region (3.0–3.7 µm)", cite: "S02-18-bands" },
  { m: "MIR ATR", u: "cm-1", lo: 2000, hi: 4000, label: "window used for water in oil (4000–2000 cm⁻¹)", cite: "S02-13-petro", broad: true },
  { m: "MIR ATR", u: "cm-1", lo: 1250, hi: 1667, label: "inside the region the sources list for ethanol / glucose / organic acids (6.0–8.0 µm)", cite: "S02-18-bands", broad: true },
  { m: "MIR ATR", u: "cm-1", lo: 952, hi: 1250, label: "inside the region the sources list for ethanol / glucose / organic acids (8.0–10.5 µm)", cite: "S02-18-bands", broad: true },
  { m: "NIR", u: "nm", lo: 850, hi: 1100, label: "inside the region the sources list for fat / protein / moisture (0.85–1.1 µm)", cite: "S02-18-bands", broad: true },
  { m: "NIR", u: "nm", lo: 1300, hi: 2200, label: "inside the regions the sources list for moisture / polymers / API / ethanol (1.3–2.2 µm)", cite: "S02-18-bands", broad: true },
  { m: "Fluorescence", u: "nm", lo: 600, hi: 625, label: "porphyrin emission at 613 nm", cite: "S04-3-design" },
  { m: "Fluorescence", u: "nm", lo: 510, hi: 540, label: "FAD / flavin emission (520–530 nm)", cite: "S04-3-fad" },
];
function matchBands(method, unit, xv) {
  const v = unit === "um" ? 1e4 / xv : (method === "NIR" && unit === "cm-1") ? 1e7 / xv : xv; // to the band table's unit
  const tabU = method === "NIR" || method === "Fluorescence" || method === "UV-Vis" ? "nm" : "cm-1";
  const val = tabU === "nm" ? (unit === "nm" ? xv : unit === "um" ? xv * 1000 : 1e7 / xv) : (unit === "cm-1" ? xv : 1e4 / xv);
  const hits = BANDS.filter(b => b.m === method && val >= b.lo && val <= b.hi);
  const specific = hits.filter(b => !b.broad);
  return (specific.length ? specific : hits).slice(0, 2);
}

// ---------- fibre coverage of the measured range
function fiberCoverage(xlo, xhi, unit) {
  const a = toNm(xlo, unit), b = toNm(xhi, unit), lo = Math.min(a, b), hi = Math.max(a, b);
  return Object.entries(KB.FIBERS).map(([fam, [f0, f1]]) => {
    const ov = Math.max(0, Math.min(hi, f1) - Math.max(lo, f0)) / (hi - lo);
    return { fam, cover: ov, verdict: ov >= 0.98 ? "covers" : ov > 0 ? "partial" : "no" };
  }).sort((p, q) => q.cover - p.cover);
}

// ---------- PCA (n spectra x p points) via the n x n Gram matrix and power iteration
function pca(X, k = 2) {
  const n = X.length, p = X[0].length;
  const mean = Array(p).fill(0); X.forEach(r => r.forEach((v, j) => mean[j] += v / n));
  const Xc = X.map(r => r.map((v, j) => v - mean[j]));
  let G = Xc.map(a => Xc.map(b => a.reduce((s, v, j) => s + v * b[j], 0)));
  const trace = G.reduce((s, r, i) => s + r[i], 0) || 1;
  const comps = [];
  for (let c = 0; c < Math.min(k, n - 1); c++) {
    let u = Array(n).fill(0).map((_, i) => Math.sin(i + 1 + c));
    for (let it = 0; it < 200; it++) { const v = G.map(r => r.reduce((s, g, j) => s + g * u[j], 0)); const nr = Math.hypot(...v) || 1; u = v.map(x => x / nr); }
    const lam = u.reduce((s, ui, i) => s + ui * G[i].reduce((t, g, j) => t + g * u[j], 0), 0);
    const load = Array(p).fill(0); Xc.forEach((r, i) => r.forEach((v, j) => load[j] += v * u[i])); const ln = Math.hypot(...load) || 1;
    comps.push({ scores: u.map(x => x * Math.sqrt(Math.max(lam, 0))), loading: load.map(v => v / ln), expl: lam / trace });
    G = G.map((r, i) => r.map((g, j) => g - lam * u[i] * u[j]));
  }
  return comps;
}
function groupOf(name) { return String(name).replace(/[_\-\s]*(rep|r|#)?\d+$/i, "").replace(/[_\-\s]+$/, "") || name; }
function valueOf(name) { const m = String(name).match(/(-?\d+(?:[.,]\d+)?)\s*(%|pct|ppm|mm|g\/l|mg)/i) || String(name).match(/^(-?\d+(?:[.,]\d+)?)$/); return m ? parseFloat(m[1].replace(",", ".")) : null; }
function topRegions(x, w, nReg = 3) {
  const a = conv(w.map(Math.abs), SG_SMOOTH), used = Array(a.length).fill(false), out = [];
  const span = Math.max(3, Math.round(a.length / 40));
  for (let r = 0; r < nReg; r++) {
    let bi = -1; a.forEach((v, i) => { if (!used[i] && (bi < 0 || v > a[bi])) bi = i; });
    if (bi < 0) break;
    for (let i = Math.max(0, bi - span); i <= Math.min(a.length - 1, bi + span); i++) used[i] = true;
    out.push({ x: x[bi], lo: x[Math.max(0, bi - span)], hi: x[Math.min(a.length - 1, bi + span)], w: a[bi] });
  }
  return out;
}

// ---------- full analysis
function analyse(sets, kindOverride) {
  const all = sets.flatMap(s => s.series.map(se => ({ x: s.x, y: se.y, name: se.name })));
  if (!all.length) throw new Error("no spectra");
  const x0 = all[0].x, lo = Math.max(...all.map(s => Math.min(...s.x))), hi = Math.min(...all.map(s => Math.max(...s.x)));
  if (!(hi > lo)) throw new Error("the spectra share no common x range");
  const kind = kindOverride || guessKind(x0), meta = KINDS[kind];
  const P = Math.min(600, Math.max(50, x0.length));
  const grid = Array.from({ length: P }, (_, i) => lo + (hi - lo) * i / (P - 1));
  const raw = all.map(s => resample(s.x, s.y, grid));
  const pre = raw.map(snv);
  const meanSpec = grid.map((_, j) => pre.reduce((s, r) => s + r[j], 0) / pre.length);
  const pk = peaks(grid, meanSpec).map(p => ({ ...p, bands: matchBands(meta.method, meta.unit, p.x) }));
  const res = { kind, method: meta.method, unit: meta.unit, n: all.length, names: all.map(s => s.name), grid, raw, pre, peaks: pk,
    range: [lo, hi], fibers: fiberCoverage(lo, hi, meta.unit), groups: all.map(s => groupOf(s.name)), values: all.map(s => valueOf(s.name)) };
  if (all.length >= 3) {
    const comps = pca(pre, 2); res.pca = comps;
    const g = res.groups, uniq = [...new Set(g)];
    if (uniq.length >= 2 && uniq.length < all.length && comps.length >= 2) {
      const pts = comps[0].scores.map((s, i) => [s, comps[1].scores[i]]);
      const cent = uniq.map(u => { const m = pts.filter((_, i) => g[i] === u); return [m.reduce((s, p) => s + p[0], 0) / m.length, m.reduce((s, p) => s + p[1], 0) / m.length]; });
      const within = pts.reduce((s, p, i) => { const c = cent[uniq.indexOf(g[i])]; return s + Math.hypot(p[0] - c[0], p[1] - c[1]); }, 0) / pts.length || 1e-9;
      let between = 0, cnt = 0; for (let i = 0; i < cent.length; i++) for (let j = i + 1; j < cent.length; j++) { between += Math.hypot(cent[i][0] - cent[j][0], cent[i][1] - cent[j][1]); cnt++; }
      res.separation = { ratio: (between / cnt) / within, groups: uniq };
    }
    res.keyFeatures = topRegions(grid, comps[0].loading).map(r => ({ ...r, source: "PC1 loading", bands: matchBands(meta.method, meta.unit, r.x) }));
    const vals = res.values;
    if (vals.filter(v => v !== null).length >= 3 && new Set(vals.filter(v => v !== null)).size >= 2) {
      const idx = vals.map((v, i) => v === null ? -1 : i).filter(i => i >= 0), vv = idx.map(i => vals[i]);
      const mv = vv.reduce((a, b) => a + b, 0) / vv.length;
      const r = grid.map((_, j) => { const col = idx.map(i => pre[i][j]); const mc = col.reduce((a, b) => a + b, 0) / col.length;
        let sxy = 0, sxx = 0, syy = 0; col.forEach((c, k) => { sxy += (c - mc) * (vv[k] - mv); sxx += (c - mc) ** 2; syy += (vv[k] - mv) ** 2; }); return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0; });
      res.correlation = { r, top: topRegions(grid, r).map(t => { const j = grid.indexOf(t.x); return { ...t, rval: r[j], bands: matchBands(meta.method, meta.unit, t.x) }; }) };
    }
  }
  return res;
}

const fmtX = (v, unit) => unit === "nm" ? `${Math.round(v)} nm` : unit === "um" ? `${v.toFixed(2)} µm` : `${Math.round(v)} cm⁻¹`;
function summaryText(r) {
  const L = [`${r.n} spectrum/spectra, axis detected as ${r.kind} (method ${r.method}), common range ${fmtX(r.range[0], r.unit)} to ${fmtX(r.range[1], r.unit)}.`];
  L.push("Main peaks (SNV, smoothed mean): " + (r.peaks.map(p => `${fmtX(p.x, r.unit)}${p.bands.length ? " = " + p.bands.map(b => b.label + " {{" + b.cite + "}}").join(" / ") : " (no band named in the sources)"}`).join("; ") || "none above noise") + ".");
  const fc = r.fibers.filter(f => f.verdict !== "no").map(f => `${f.fam} (${f.verdict})`);
  L.push("Fibers that transmit this range: " + (fc.join(", ") || "none") + " {{S02-6-fibers}}.");
  if (r.pca) L.push(`PCA: PC1 explains ${(r.pca[0].expl * 100).toFixed(0)} %${r.pca[1] ? `, PC2 ${(r.pca[1].expl * 100).toFixed(0)} %` : ""}.` + (r.separation ? ` Groups ${r.separation.groups.join(", ")}: separation ratio ${r.separation.ratio.toFixed(1)} (${r.separation.ratio > 2 ? "clearly separated" : r.separation.ratio > 1 ? "partly separated" : "overlapping"}).` : ""));
  if (r.keyFeatures) L.push("Key spectral features (largest PC1 loadings): " + r.keyFeatures.map(k => `${fmtX(k.x, r.unit)}${k.bands.length ? " = " + k.bands[0].label : ""}`).join("; ") + ".");
  if (r.correlation) L.push("Regions most correlated with the value in the file names: " + r.correlation.top.map(t => `${fmtX(t.x, r.unit)} (r = ${t.rval.toFixed(2)})${t.bands.length ? " = " + t.bands[0].label : ""}`).join("; ") + ".");
  L.push("Few spectra show whether a method sees a difference; they do not give a calibrated concentration or accuracy.");
  return L.join(" ");
}

// ---------- synthetic demo set (clearly labelled; not measurements)
function demoSet() {
  const x = Array.from({ length: 900 }, (_, i) => 4000 - i * (3400 / 899)); // 4000 -> 600 cm-1
  const g = (v, c, w) => Math.exp(-0.5 * ((v - c) / w) ** 2);
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const series = [];
  for (const w of [0, 0.5, 1, 2]) for (let rep = 1; rep <= 3; rep++) {
    series.push({ name: `oil_water_${w}pct_${rep}`, y: x.map(v => 0.02 + 0.30 * g(v, 2925, 25) + 0.22 * g(v, 2855, 20) + 0.12 * g(v, 1460, 18) + 0.08 * g(v, 1377, 12) + 0.05 * g(v, 720, 15)
      + w * 0.05 * g(v, 3400, 170) + w * 0.015 * g(v, 1640, 30) + 0.004 * rnd()) });
  }
  return [{ x, series, synthetic: true }];
}

root.AFS_SPECTRA = { parseTable, analyse, summaryText, guessKind, KINDS, fmtX, demoSet };
})(typeof globalThis !== "undefined" ? globalThis : this);
