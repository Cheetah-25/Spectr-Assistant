// AFS spectroscopy assessment assistant — knowledge base.
// Every claim is a short paraphrase of one page of one supplied source.
// scope: what the claim may be used for.
//   method   = general method property        process = process / in-line application example
//   lab      = laboratory / research demo      clinical-research = in vitro / ex vivo medical research
//   business = company context (never technical evidence)
//   general  = general spectroscopy knowledge NOT in the AFS sources (expert must confirm)
(function (root) {
const SOURCES = {
  S01: { file: "S01_Multispectral_Laboratory.pdf", title: "Multispectral Laboratory of Optical Analysis Methods (MIR Photonics / art photonics)", kind: "Main technical source" },
  S02: { file: "S02_AFS_Process_Control_Slides.pdf", title: "Process-Control in-line with Spectral Fiber Systems (AFS slides, BioProScale 2026)", kind: "Slides; page = slide number" },
  S03: { file: "S03_LED_Kidney_Study_2017.pdf", title: "Bogomolov et al., LED-based NIR sensor for human kidney tumor diagnostics, Sensors 2017", kind: "Research paper, in vitro proof of concept" },
  S04: { file: "S04_Combi_MIR_Fluorescence_2021.pdf", title: "Bogomolov et al., Fiber probe for simultaneous MIR and fluorescence analysis, Anal. Chem. 2021", kind: "Research paper, model tissues" },
  S05: { file: "S05_AFS_Flyer.pdf", title: "AFS flyer", kind: "Business context only" },
  S06: { file: "S06_Laboratory_Link.txt", title: "https://mirphotonics.com/laboratory/", kind: "Business context only" },
  X01: { file: "cvc.uab.es (web page)", title: "Computer Vision Center Barcelona: MultiSpectral Image Analysis and Understanding", kind: "External research, imaging context only", url: "https://www.cvc.uab.es/research-lines/multispectral/" },
  X02: { file: "iof.fraunhofer.de (web page)", title: "Fraunhofer IOF: ultra-compact multispectral camera based on micro-optics (2024)", kind: "External research, imaging context only", url: "https://www.iof.fraunhofer.de/en/News/multispectral-camera.html" },
  X03: { file: "pm.mh.tum.de (web page)", title: "TU Munich, Chair of Biological Imaging: Multispectral Optoacoustic Tomography (MSOT)", kind: "External research, imaging context only", url: "https://www.pm.mh.tum.de/en/cbi/research-highlights/multispectral-optoacoustic-tomography-msot/" },
  X04: { file: "bmo.uni-luebeck.de (web page)", title: "University of Lübeck, AG Huber: Multi-spectral OCT", kind: "External research, imaging context only", url: "https://www.bmo.uni-luebeck.de/en/research/ag-huber/research/optical-coherence-tomography-oct/multi-spectral-oct" },
  X05: { file: "tlo.mit.edu (web page)", title: "MIT Technology Licensing Office: multispectral-hyperspectral imaging method and device", kind: "External research, imaging context only", url: "https://tlo.mit.edu/industry-entrepreneurs/available-technologies/multispectral-hyperspectral-imaging-method-and-device" },
  REF: { file: "AFS_Examples_and_Reference.docx", title: "Organizers' examples and reference, section 5", kind: "Supplied reference notes" },
};

const C = {}; // claims
function claim(id, src, page, scope, text) { C[id] = { id, src, page: String(page), scope, text }; }

// ---------- S01 ----------
claim("S01-3-unknown", "S01", 3, "method", "For samples of incompletely known composition it is not always possible to predict which method will work; testing several optical approaches is the way to select the most suitable method or combination.");
claim("S01-4-interfaces", "S01", 4, "method", "NIR, MIR and Raman differ in absorption and penetration depth, so each needs its own interface (ATR, transmission, transflection, reflection probes); the task decides the method and technique.");
claim("S01-5-nir-online", "S01", 5, "method", "NIR penetrates up to several millimetres even into dense solids (low absorption, strong scattering), works with ordinary glass optics and standard lamps, which makes it suited to online use with remote fiber probes.");
claim("S01-5-mir-thin", "S01", 5, "method", "Strong mid-IR absorption limits MIR to very thin layers (usually <50 µm), which is why MIR is used with ATR attachments and probes.");
claim("S01-5-raman-comp", "S01", 5, "method", "Raman needs special probes, is recorded in the visible/NIR region, and carries information complementary to MIR.");
claim("S01-5-uv", "S01", 5, "method", "UV-Vis is very sensitive, especially in the UV region (190–360 nm), but its strongly overlapping signals complicate the analysis of real mixtures, so chemometrics is required.");
claim("S01-5-fluo", "S01", 5, "method", "Fluorimetry is highly sensitive but relies on secondary emission of certain substances, mostly of biological origin; most chemicals do not fluoresce.");
claim("S01-5-chemometrics", "S01", 5, "method", "Mid-IR spectra contain well-defined absorption peaks, while NIR, UV and fluorescence give broad overlapping spectra; quantitative use requires chemometric calibration or classification models that are built, validated and then applied.");
claim("S01-5-select", "S01", 5, "method", "Selecting a spectral method for a specific analytical problem requires considering many factors and specialised knowledge.");
claim("S01-T1", "S01", "6 (Table 1)", "method", "Table 1 rates methods qualitatively: MIR ATR (liquid/paste/soft, depth 1–6 µm, sensitivity average, selectivity high, cost high); NIR transmission/transflection probe (liquid/colloidal, 1–10 mm); NIR diffuse reflection probe (scattering media/powder, 0.5–1 mm); Raman probe (liquid/powder/solid, 2–5 mm, selectivity high, cost high); UV/Vis probes (selectivity low); fluorimetric probe (liquid/solid, 1–5 mm, sensitivity high, selectivity low, cost low).");
claim("S01-7-synergy", "S01", 7, "method", "Complex media (oil, milk, fermentation media, tissue) may need two or more methods; examples: NIR+fluorescence gave more accurate biomass in yeast fermentation and distinguished intra- and extracellular metabolites; NIR+IR showed benefits for tumour boundaries; fluorescence+IR was needed to classify tissues; NIR+Raman gave the best results for pellet coating.");
claim("S01-8-same-spot", "S01", 8, "method", "For heterogeneous samples the different methods must see the same small area; alternating two probes makes this hard, multispectral probes solve it. Data from methods with different acquisition rates must be synchronised.");
claim("S01-9-fusion", "S01", 9, "method", "Fused data blocks differ in noise and information content; normalisation alone does not fix this, so dedicated data-fusion algorithms are needed.");
claim("S01-9-gases", "S01", 9, "method", "In the mid-IR region the method is highly sensitive and can be used to analyze a wide variety of samples: solids, liquids and gases.");
claim("S02-17-gas", "S02", 17, "method", "IR laser sources coupled to IR fibers are shown for diagnostics; gas absorption bands of CO2, CO, NO, H2O, NO2, SO3, SO2, CH4 and NH3 lie between about 4 and 10 µm.");
claim("S01-9-mir", "S01", 9, "method", "Mid-IR vibrational spectroscopy covers 4000–400 cm⁻¹ and is one of the most informative methods for chemical analysis.");
claim("S01-9-oms", "S01", 9, "method", "Developing an optical multisensor system (OMS) starts with laboratory spectrometers to find the optimal spectral ranges, which then define the elements of the dedicated analyzer (LEDs, filters); LED analyzers can combine sources from different regions without much design complexity.");
claim("S01-10-atr", "S01", 10, "method", "ATR fiber probes analyse liquids and elastic solids at a distance from the spectrometer without sampling, using high-transmission mid-IR fibers.");
claim("S01-10-nir", "S01", 10, "method", "NIR (780–2500 nm) is the most common online fiber-probe method; its broad overlapping overtone/combination bands require chemometrics; diffuse reflectance allows measurements on scattering samples.");
claim("S01-11-raman", "S01", 11, "method", "Raman signals are weak and often masked by laser scatter and, for many organic compounds, by much stronger fluorescence; special filters and probe designs are needed. The Raman shift (cm⁻¹) is the spectral axis.");
claim("S01-12-fluo-bio", "S01", 12, "method", "Fluorimetry measures broad emission from certain samples under UV/visible excitation; it is frequently used in biology and biotechnology and can be combined with MIR or NIR.");
claim("S01-13-surgery-concept", "S01", 13, "clinical-research", "Describes tumour-margin recognition with combined MIR-ATR, fluorescence and NIR probes as an application concept for a multispectral laboratory (no validation data on this page).");
claim("S01-14-pharma", "S01", "14–15", "process", "Pharmaceutical example: NIR reflection probe and Raman probe (785 nm excitation) inserted into the feed frame of a rotary tablet press for blend potency; NIR sees hydrogen bonds/polar groups, Raman the molecular backbone/non-polar groups; low-level fusion of synchronised spectra with PLS.");
claim("S01-15-fusion-gain", "S01", 15, "process", "The cited feed-frame study reports that fused NIR+Raman PLS models predicted API potency more accurately than single-method models (in that study).");
claim("S01-15-fiber-remote", "S01", 15, "process", "Fiber optics let spectrometers sit away from the vibration and dust of the manufacturing floor.");
claim("S01-16-bio-uv", "S01", 16, "process", "Bioprocess: UV/Vis can be a low-cost tool for real-time biomass monitoring because cell-suspension turbidity correlates with cell density.");
claim("S01-16-bio-raman", "S01", 16, "process", "Bioprocess: Raman gives direct detection of metabolites such as glucose, acetate or lactate and suits aqueous media because water absorbs weakly.");
claim("S01-16-bio-nir", "S01", 16, "process", "Bioprocess: NIR tracks major components such as glucose or glycerol in the millimolar range but may lack sensitivity below 0.1 %.");
claim("S01-16-bio-fluo", "S01", 16, "process", "Bioprocess: fluorescence detects intrinsic fluorophores such as NADH, tryptophan and riboflavin at high sensitivity (nM–µM).");
claim("S01-16-uv-od", "S01", 16, "process", "UV-Vis probe choice follows optical density: transmission/transflection (1–10 mm path) for transparent liquids; UV-ATR for opaque, turbid or concentrated media where transmission saturates.");
claim("S01-17-dairy-refl", "S01", 17, "process", "Dairy: inline NIR reflection is used for opaque or concentrated products; probe flush-mounted in pipe or vat; sensitive to surface characteristics and fat globule size; MSC/SNV scatter correction before PLS for fat and protein.");
claim("S01-18-dairy-trans", "S01", 18, "process", "Dairy: NIR transmission/transflection is preferred for transparent or semi-transparent liquids such as skim milk, whey or permeate; path length (usually 1–10 mm) must be controlled; it fails when the product is too thick or fat-rich.");
claim("S01-18-dairy-both", "S01", 18, "process", "Dairy: keeping both reflection and transmission lets models be calibrated for each production stage; a transflection probe can in some cases work for both low- and high-fat products; the same NIR spectrometer serves both techniques.");
claim("S01-18-dairy-other", "S01", 18, "process", "Dairy: fluorescence, Raman and MIR ATR can add molecular specificity that NIR might miss.");

// ---------- S02 ----------
claim("S02-3-select", "S02", 3, "business", "AFS multispectral fiber systems test four methods (Raman, FTIR, fluorescence, NIR) in 0.3–16 µm on the customer process; comparing the spectral data is used to select the process-control solution.");
claim("S02-6-fibers", "S02", 6, "method", "Fiber transmission ranges: UV-Vis silica 190–1200 nm; Vis-NIR silica 350–2400 nm; chalcogenide As-S (CIR) 1.1–6.5 µm; polycrystalline (PIR) 3–17 µm; hollow glass waveguides 2–18 µm; InF₃ 0.3–5.5 µm; ZrF₄ 0.3–4.5 µm (figure values).");
claim("S02-7-silica-long", "S02", 7, "process", "Robust 100–300 m cables of low-OH silica fibers enable remote industrial process control (Vis-NIR). Al/Cu-coated silica fibers offer high-temperature resistance and no polymer-jacket fluorescence for Raman and fluorescence.");
claim("S02-8-pir", "S02", 8, "method", "PIR fiber transmission range 3–16 µm matches the molecular fingerprint region.");
claim("S02-9-hwg", "S02", 9, "method", "Hollow waveguides have low NA and couple poorly to FTIR spectrometers; PIR fibers (NA > 0.3) couple much better in ATR probes. Transmission comparison shown for 2 m lengths.");
claim("S02-11-refl", "S02", 11, "method", "Silica fiber diffuse-reflection probes (12 mm reflexion probe, side-window DRS probes) were tested with FT-NIR and diffraction-grating NIR spectrometers.");
claim("S02-12-moisture", "S02", 12, "process", "NIR-LED fiber sensor concept for moisture in materials (900–1700 nm spectra of starch, flour, sugar).");
claim("S02-13-petro", "S02", 13, "lab", "Water in petroleum: ATR probes with ZrO₂ (or diamond) tips sealed in PEEK; example MIR absorbance spectra 4000–2000 cm⁻¹ of oil with 0.1–2.0 % water.");
claim("S02-14-extrusion", "S02", 14, "process", "Polymer extrusion: API in hot polymer measured with a diamond-cone ATR probe coupled to an FTIR via PIR fiber; NIR probe mounted at the die of a hot-melt extruder for feed-forward waste-gate control.");
claim("S02-15-combi", "S02", 15, "lab", "Combi probe fusing MIR-ATR and fluorescence classified chicken liver, breast and fat; two wavelengths (1743 cm⁻¹, 613 nm) separated the classes.");
claim("S02-16-combi-raman", "S02", 16, "lab", "Combi probe with 2 IR fibers to an FTIR and 2 silica fibers to fluorescence or Raman spectrometers (680 nm and 785 nm lasers).");
claim("S02-18-bands", "S02", 18, "method", "Band chart: fat/protein/moisture 0.85–1.1 µm; moisture/polymers/API/ethanol 1.3–1.7, 1.5–2.0, 1.7–2.2 µm; hydrocarbons 3.0–3.7 µm; ethanol/glucose/organic acids 6.0–8.0, 8.0–10.5 µm. A central analyzer with long fibers to many points is contrasted with distributed IoT sensors.");
claim("S02-20-pathway", "S02", 20, "business", "AFS pathway: multi-method lab trials on the customer process, then identification of key spectral features, then a chemometric model, a customised system or IoT sensors.");

// ---------- S03 ----------
claim("S03-1-scope", "S03", 1, "clinical-research", "Two LED sensor prototypes were tested on 14 in vitro clinical samples from 7 patients; PCA and PLS-DA confirmed general applicability of the approach to kidney tumour detection.");
claim("S03-2-aim", "S03", 2, "clinical-research", "The main task was to establish fundamental feasibility: whether a few selected NIR wavelengths (LEDs, 900–1500 nm) capture cancer-related variance. NIR penetrates tissue up to about 3 mm.");
claim("S03-2-fewwl", "S03", 2, "method", "High-resolution NIR spectroscopy can be replaced by optical sensing at a few wavelengths optimised for a particular application; the technical downgrade does not necessarily lose accuracy, and excluding non-informative regions can make models more robust.");
claim("S03-3-exvivo", "S03", 3, "clinical-research", "Samples were frozen biopsies thawed before measurement (ex vivo, usual at early research stages); spectra of frozen/thawed biopsies can differ from real in vivo measurements.");
claim("S03-14-limits", "S03", 14, "clinical-research", "Conclusions: proof-of-concept; much work remains; the present sensor shows very high measurement variance in cancer tissue; false negatives are unacceptable in oncology, so accuracy and specificity must improve; LED set must be adapted to each tissue/cancer type; measurement conditions and probe construction need optimisation; thorough validation (segmented CV, randomisation tests) is needed when data are limited.");

// ---------- S04 ----------
claim("S04-1-probe", "S04", 1, "lab", "A multispectral fiber probe for simultaneous ATR-MIR and fluorimetry was developed; signal quality was comparable to single-method probes; demonstrated on model biological tissue.");
claim("S04-2-samespot", "S04", 2, "lab", "Alternating separate probes cannot guarantee the same spot; the combined ZrO₂ ATR head analyses about 2 mm (IR) and 1 mm (fluorescence) regions at once.");
claim("S04-3-design", "S04", 3, "lab", "Chicken breast, fat and liver: 3 samples per tissue × 5 points (45 spectra); fat recognised by the ester carbonyl band near 1740 cm⁻¹ (IR), liver by a porphyrin band at 613 nm (fluorescence).");
claim("S04-3-amide", "S04", 3, "lab", "Protein amide I and amide II bands appear near 1640 and 1548 cm⁻¹ in the IR spectra of the tissues.");
claim("S04-3-fad", "S04", 3, "lab", "A broad fluorescence band with maximum between 520 and 530 nm is formed mainly by intracellular flavin adenine dinucleotide (FAD).");
claim("S04-4-result", "S04", 4, "lab", "Neither method alone separated all three tissue classes in PCA; the fused data did. The approach is limited to samples with at least one fluorescent component and to samples suitable for ATR (liquids, soft solids).");

// ---------- business ----------
claim("S05-pathway", "S05", 1, "business", "AFS guided pathway: (1) multi-method lab test with the AFS multi-spectral fiber system, (2) selection of key spectral features by multivariate analysis and fusion, (3) tailored solution: Path A AI-driven chemometric model (spectra to real-time composition), Path B customised MSF system (tailored spectrometer set for the customer's own R&D), Path C customised spectral fiber sensors (SFS) for a specific process with remote/cloud control.");
claim("S01-9-led-examples", "S01", 9, "method", "Practical LED-based multisensor examples: a probe for tumour boundaries in kidney and rectal cancer, an RGB sensor for fat and protein in cow's milk, and an LED probe moisture analyzer for bulk materials.");
claim("S05-offer", "S05", 1, "business", "AFS offers in-situ tests of customer processes across 0.3–16 µm, key-feature selection, chemometric model development, customised systems and sensors.");
claim("S06-lab", "S06", 1, "business", "Link to the MIR Photonics laboratory website.");

// ---------- supplied reference notes ----------
claim("REF-units", "REF", "§5", "method", "Unit conversion: wavelength in µm = 10 000 / wavenumber in cm⁻¹ (4000 cm⁻¹ = 2.5 µm; 400 cm⁻¹ = 25 µm).");

// ---------- general knowledge (flagged) ----------

// ---------- method table (S01 Table 1, from AFS_method_comparison_table.xlsx) ----------
const TABLE1 = [
  ["IR spectroscopy","ATR probe","absorption","liquid, paste, soft","1-6 um","average","high","high"],
  ["IR spectroscopy","cuvette","absorption","liquid","10-100 um","high","high","average"],
  ["NIR spectroscopy","transmission or transflection probe","transmission","liquid, colloidal","1-10 mm","average","average","average"],
  ["NIR spectroscopy","diffuse reflection probe","diffuse reflection","scattering media, powder","0.5-1 mm","average","average","average"],
  ["NIR spectroscopy","surface at a distance","diffuse reflection","solid, powder","2-5 mm","average","average","average"],
  ["Raman spectroscopy","Raman probe","Raman scattering (emission)","liquid, powder, solid","2-5 mm","average","high","high"],
  ["UV/Visible spectroscopy","ATR probe","absorption","liquid","0.1-1 um","low","low","average"],
  ["UV/Visible spectroscopy","transmission or transflection probe","transmission","liquid","1-10 mm","low","low","low"],
  ["Fluorimetry","fluorimetric probe","fluorescence (emission)","liquid, solid","1-5 mm","high","low","low"],
].map(r => ({ method: r[0], technique: r[1], phenomenon: r[2], sample: r[3], depth: r[4], sensitivity: r[5], selectivity: r[6], cost: r[7] }));

// ---------- fiber families (S02 p.6) in nm ----------
const FIBERS = {
  "UV-Vis silica": [190, 1200], "Vis-NIR silica": [350, 2400], "CIR (As-S chalcogenide)": [1100, 6500],
  "PIR (polycrystalline AgHal)": [3000, 17000], "Hollow glass waveguide": [2000, 18000],
  "InF3": [300, 5500], "ZrF4": [300, 4500],
};
// nominal method ranges, nm (what a method needs to carry)
const METHOD_RANGE = {
  NIR: { nm: [780, 2500], label: "780–2500 nm (nominal method range)", cite: ["S01-10-nir"] },
  "MIR ATR": { nm: [2500, 25000], label: "4000–400 cm⁻¹ = 2.5–25 µm (nominal); usable range limited by fiber and ATR crystal", cite: ["S01-9-mir", "REF-units"] },
  Raman: { nm: null, label: "State the laser excitation wavelength (nm) and the Raman shift range (cm⁻¹) separately", cite: ["S01-11-raman"] },
  Fluorescence: { nm: null, label: "Excitation and emission wavelengths depend on the fluorescent species; UV/visible excitation", cite: ["S01-12-fluo-bio"] },
  "UV-Vis": { nm: null, label: "Depends on the target absorption and set-up; UV region 190–360 nm is the most sensitive", cite: ["S01-5-uv"] },
};

root.AFS_KB = { SOURCES, CLAIMS: C, TABLE1, FIBERS, METHOD_RANGE };
if (typeof module !== "undefined") module.exports = root.AFS_KB;
})(typeof globalThis !== "undefined" ? globalThis : this);
