// AFS spectroscopy assessment assistant — rule engine + verifier.
// Text fields may contain citation tokens {{claimId}}; renderers turn them into [S01 p.10].
(function (root) {
const KB = root.AFS_KB || (typeof require !== "undefined" ? require("./kb.js") : null);
const { CLAIMS, FIBERS, METHOD_RANGE, SOURCES } = KB;

// ------------------------------------------------------------------ detection
const RX = {
  powder: /powder|tablet|feed frame|excipient|blend potency|granul/,
  api: /\bapi\b|active pharmaceutical/,
  newFormulation: /(different|new|another) (api|formulation|excipient|product|recipe)|introducing a (different|new)/,
  calReuse: /reuse (the |our |an? )?(existing |old |current )?(calibration|model)|calibration (will |would )?(remain|stay|be) valid|transfer (the )?calibration|old calibration/,
  dairy: /dairy|milk|whey|cheese|yog(h)?urt|butter|cream|permeate|milch|molkerei|molke|käse|joghurt|sahne/,
  whey: /whey|permeate|skim|molke\b|magermilch/,
  clear: /\bclear\b|transparent|semi-transparent|\bklar\b|(?<!un)durchsichtig/,
  opaque: /opaque|thick|fat-rich|creamy|concentrated milk|milk concentrate|undurchsichtig|opak/,
  turbid: /turbid|cloud|hazy|more optically dense|optical density|trüb/,
  fat: /\bfat\b|\bfett/, protein: /protein|eiweiß|eiweiss/,
  bio: /ferment|cell culture|bioreactor|broth|bioprocess|yeast|microb|culture medium/,
  glucose: /glucose|sugar|substrate|lactate|acetate|metabolite|metabolic/,
  biomass: /biomass|cell density|growth|viable|cell count/,
  viable: /viable|living cells|live cells/,
  fluo: /fluoresc|fluorim/,
  noFluoTarget: /(not|never|no) (yet )?(identified|named|defined|known)[^.]*(fluorescent|marker|fluorophore)|no (known )?(fluorescent|fluorophore)/,
  sensitivityOnly: /only justification|because (fluorescence|it) (can be|is) (very )?sensitive|sensitive/,
  petro: /petroleum|crude|oil\b|fuel|diesel|hydrocarbon|refiner/,
  water: /water content|water determination|moisture|water in|\bwater\b/,
  mir: /\bmir\b|mid[- ]?ir|ftir|\batr\b/,
  nir: /\bnir\b|near[- ]infrared/,
  raman: /raman/,
  remote: /another building|outside the process area|remote|far from|control room|distance from|away from the/,
  silica: /silica|visible or nir|vis(ible)?[- ]nir (fiber|fibre|cable|setup)|existing (fiber|fibre|cable)/,
  reuseHardware: /reuse (it|the cable|the fiber|the fibre|this cable)|already have a[^.]*(fiber|fibre|cable|spectrometer)|would like to reuse/,
  linkUnknown: /(length|routing|operating conditions)[^.]*(not (yet )?(been )?(supplied|given|known|defined)|unknown)/,
  polymer: /polymer|extru|melt/, hot: /\bhot\b|high temperature|heated|melt/, fouling: /build[- ]?up|fouling|deposit|coat(ing)? on the|sticky/,
  tissue: /tissue|tumou?r|kidney|liver|muscle|biops|organ|cancer|surg/,
  clinical: /surg(ery|ical)|in vivo|live (surgery|patient)|patient|intraoperative|clinical use|diagnos(e|is) (patients|in)/,
  labOnly: /laboratory (classification )?study|research group|model (biological )?tissues|chicken/,
  proof: /proof|prove|ready for|readiness|guarantee|validated for/,
  noOwnData: /no (new )?(in vivo )?data|no validation|not validated|without validation/,
  undefinedTarget: /cannot (yet )?name|can't (yet )?name|unknown (contaminant|cause|component)|not (yet )?(identified|defined) (the )?(contaminant|variable|target)|not been defined as separate targets|suspect contamination/,
  offspec: /off[- ]?spec/,
  contamination: /contamina/,
  certainty: /immediately|exact (sensor )?configuration|right away|best (spectroscopy )?method and|approve|final (configuration|recommendation)|guarantee|order now/,
  approve: /approve|sign off|confirm (this|the) concept|confirm (that )?you can|order now|can we order/,
  liquid: /liquid|stream|line|flow|aqueous|medium/,
  aqueous: /aqueous|water-based|medium|broth/,
  compareInterfaces: /compare (different |reasonable )?(measurement )?(interfaces|options|geometr|probes|methods)/,
  coating: /coating|coater|coated (tablets|pellets)|pellet/,
  gas: /\bgas(es)?\b|exhaust|flue|\bco2\b|methane|\bch4\b|vapou?r/,
  autofluo: /autofluoresc|strongly fluoresc|highly fluoresc|fluorescent (broth|sample|matrix|product|medium)|dark(ly)? colou?red|\bdark\b/,
  guarantee: /guarantee|promise|assure|confirm (that )?you can/,
  existingInstrument: /already have a[^.]*(spectrometer|instrument|analy[sz]er)/,
};

function detect(enquiry) {
  const t = enquiry.toLowerCase();
  const f = {};
  for (const k in RX) f[k] = RX[k].test(t);
  f.text = t;
  // derived
  // a later client answer that replaces the stream wins over the original description
  f.replaced = /not whey|no longer|instead of (clear )?whey|line was changed|now carries/.test(t);
  if (f.replaced && f.opaque) { f.whey = false; f.clear = false; f.turbid = false; }
  // a dairy powder is an opaque, scattering solid: reflection, not the clear-liquid rules
  f.dairyPowder = f.dairy && f.powder && !f.api;
  if (f.dairyPowder) { f.opaque = true; f.whey = false; f.clear = false; f.turbid = false; }
  f.twoStreams = f.dairy && f.whey && f.opaque;
  // one sample described as clear and as black/opaque in the same sentence (not two different streams or products)
  f.contradiction = f.twoStreams ? null : splitSentences(enquiry).find(x => /\bclear\b|transparent/i.test(x) && !/semi-transparent/i.test(x) && /\bblack\b|\bopaque\b|\bdark\b/i.test(x) && !/\bboth\b|\band an?\b[^.]*(stream|product|concentrate|phase)|\bwhile\b|\bwhereas\b/i.test(x)) || null;
  f.accuracyNumber = (t.match(/(\d+(?:[.,]\d+)?)\s*(g\/l|mg\/l|%|ppm|mmol)/) || [])[0] || null;
  f.requested = ["NIR", "Raman", "MIR ATR", "Fluorescence"].filter(m => (m === "NIR" && f.nir) || (m === "Raman" && f.raman) || (m === "MIR ATR" && f.mir) || (m === "Fluorescence" && f.fluo));
  f.domain =
    f.tissue && (f.clinical || f.labOnly) ? (f.clinical ? "tissue-clinical" : "tissue-lab") :
    f.dairyPowder ? "dairy" :
    f.powder || (f.api && !f.polymer) ? "pharma-powder" :
    f.polymer ? "polymer-melt" :
    f.dairy ? "dairy" :
    f.bio ? "bioprocess" :
    f.petro && f.water ? "petro-water" :
    f.undefinedTarget || f.offspec ? "undefined-liquid" : "generic";
  return f;
}

function splitSentences(text) {
  return text.replace(/\s+/g, " ").trim().split(/(?<=[.?!])\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
}

// ------------------------------------------------------------------ building blocks
const Q = (q, cat, why) => ({ q, cat, why });
const U = (item, why) => ({ item, why });
const R = (method, role, geometry, reason, conditions) => ({ method, role, geometry, reason, conditions });
const RK = (risk, mitigation) => ({ risk, mitigation });

const FIBER_FOR = {
  NIR: "Vis-NIR silica (low-OH for long links) {{S02-6-fibers}} {{S02-7-silica-long}}",
  "MIR ATR": "Mid-IR fiber: CIR or PIR {{S02-6-fibers}}; PIR couples better to FTIR than hollow waveguides {{S02-9-hwg}}",
  Raman: "Silica fibers; metal-coated fibers avoid jacket fluorescence {{S02-7-silica-long}}",
  Fluorescence: "UV-Vis silica fibers {{S02-6-fibers}}; metal-coated fibers avoid jacket fluorescence {{S02-7-silica-long}}",
  "UV-Vis": "UV-Vis silica fibers {{S02-6-fibers}}",
};
const FIBER_FAMILY = { NIR: ["Vis-NIR silica"], "MIR ATR": ["CIR (As-S chalcogenide)", "PIR (polycrystalline AgHal)"], Raman: ["Vis-NIR silica", "UV-Vis silica"], Fluorescence: ["UV-Vis silica"], "UV-Vis": ["UV-Vis silica"] };

const RANGE = {
  NIR: { method: "NIR", text: "780–2500 nm is the nominal method range {{S01-10-nir}}; Vis-NIR silica fiber transmits about 350–2400 nm {{S02-6-fibers}}, so the usable range depends on the actual spectrometer, fiber and probe. Choose bands only after looking at sample spectra." },
  "MIR ATR": { method: "MIR ATR", text: "4000–400 cm⁻¹ (2.5–25 µm) is the nominal MIR range {{S01-9-mir}} {{REF-units}}. CIR fiber covers 1.1–6.5 µm and PIR 3–17 µm {{S02-6-fibers}}, so the fiber and ATR crystal decide which part is usable." },
  Raman: { method: "Raman", text: "State the excitation wavelength (nm) separately from the Raman shift (cm⁻¹) {{S01-11-raman}}. The supplied process examples use 785 nm excitation {{S01-14-pharma}}; this is not a recommendation for this sample until fluorescence background is checked." },
  Fluorescence: { method: "Fluorescence", text: "Excitation and emission bands follow from the fluorescent species, so they cannot be set before a fluorophore is named {{S01-12-fluo-bio}} {{S04-4-result}}." },
  "UV-Vis": { method: "UV-Vis", text: "Depends on the absorbing species; the UV region 190–360 nm is the most sensitive but signals overlap strongly {{S01-5-uv}}." },
};

// ------------------------------------------------------------------ domain modules
const MODULES = {
  "pharma-powder": f => ({
    status: "provisional",
    statusWhy: f.coating ? "Product (tablets), target (coating) and location (coater) are stated. The supplied pharmaceutical examples are a feed-frame blend and pellet coating in a fluidized bed, so they guide the method choice but not the installation; reference method, ranges and acceptance limits are not stated." : f.newFormulation ? "The application (API concentration in a powder blend at the feed frame) matches the supplied pharmaceutical example, and the NIR hardware already exists. The new formulation is a new calibration task; its composition, ranges and acceptance limits are not stated." : "Material (powder blend), target (API concentration) and location (feed frame) are stated, and the supplied pharmaceutical example matches this application family. Composition, ranges and acceptance limits are not stated.",
    unknowns: [
      U("API and excipients, and the API concentration range", "The calibration is specific to this matrix; spectral contrast between API and excipients decides whether NIR, Raman or both can see the change."),
      U("Reference assay, its uncertainty and how samples are timed against spectra", "A calibration can only be as good as the reference and its alignment with the measured powder."),
      U("Physical variation between runs (particle size, density, flow, moisture)", "Physical changes alter NIR diffuse-reflection signals and can mimic composition changes."),
      U("Required response time, acceptance limits, access and cleaning conditions in the feed frame", "These decide probe type, integration time and whether a result is useful."),
    ],
    questions: [
      Q("Which API and excipients are involved, over which API concentration range, and which changes must be distinguished?", "method", "Decides whether the API has enough NIR and/or Raman contrast against the excipients."),
      Q("Which assay provides reference concentrations, with what uncertainty, and how is a reference sample matched to the spectra in time and position?", "reference", "Without matched references no calibration can be validated."),
      Q("Which particle size, density, flow or moisture changes occur between batches?", "method", "Physical variation is a major interference for diffuse reflection."),
      Q("What response time, acceptance limits, access, cleaning and hazardous-area conditions apply at the feed frame?", "acceptance", "Defines go/no-go and the probe's mechanical design."),
    ],
    recs: [
      R("NIR", "primary", "diffuse reflection probe in the feed frame", "The supplied pharmaceutical example uses an NIR reflection probe in the feed frame for blend potency {{S01-14-pharma}}; diffuse reflection suits powders {{S01-T1}}.", "A matrix-specific calibration must be built and validated {{S01-5-chemometrics}}."),
      R("Raman", "comparison", "Raman contact probe in the feed frame", "Same application family; Raman adds backbone/non-polar information complementary to NIR {{S01-14-pharma}}.", "Check fluorescence background and signal strength on the real blend {{S01-11-raman}}."),
      R("NIR + Raman", "combination", "combined probe or two synchronised probes", "Fusion improved potency prediction in the cited feed-frame study {{S01-15-fusion-gain}}.", "Test only after each single method; a gain for this formulation is a hypothesis {{S01-7-synergy}}. Spectra must be synchronised {{S01-8-same-spot}}."),
    ],
    concept: [{ label: "Feed frame", method: "NIR", geometry: "Diffuse reflection probe", location: "Feed frame of the rotary tablet press", fiber: FIBER_FOR.NIR }, { label: "Feed frame (comparison)", method: "Raman", geometry: "Raman contact probe", location: "Same feed frame position", fiber: FIBER_FOR.Raman }],
    ranges: [RANGE.NIR, RANGE.Raman],
    risks: [
      RK("A change of API or excipients invalidates the calibration.", "Treat every new formulation as a new calibration task and validate on independent batches."),
      RK("Particle size, density and flow changes mimic composition changes.", "Include physical variation in the calibration set; test scatter correction."),
      RK("A combination does not guarantee a gain for every formulation.", "Compare against the best single method on the same validation data."),
      RK("No accuracy, update rate or equipment compatibility has been confirmed.", "Agree numerical criteria before the test; AFS confirms probe and installation."),
    ],
    plan: {
      objective: "Show whether NIR, Raman or their fusion can follow API concentration changes in this blend at the feed frame.",
      samples: ["Representative blends across the client-agreed API range", "Deliberate physical variation (particle size, density) within the normal range"],
      references: ["Independent API assay for each measured blend, time-matched to the spectra"],
      comparisons: ["NIR reflection vs Raman vs fused model, on the same blends"],
      steps: ["Record spectra with each candidate on the blends, with reference assays and timestamps.", "Build single-method models first, then a fused model {{S01-9-fusion}}.", "Validate on held-out batches, not on random spectra from the same batch.", "Repeat the best option in the feed frame under real flow."],
      decision: "Prediction error and bias on independent batches against client-agreed limits; choose the simplest configuration that meets them.",
    },
    demonstrates: { shows: ["Whether this formulation can be calibrated with each method, and whether fusion adds measurable value on independent batches"], notShown: ["Long-term robustness, other formulations, or validated production use"] },
  }),

  dairy: f => {
    const out = { status: "provisional", unknowns: [], questions: [], recs: [], concept: [], ranges: [RANGE.NIR], risks: [], plan: { samples: [], references: [], comparisons: [], steps: [] }, demonstrates: { shows: [], notShown: [] } };
    const clearPart = f.whey || f.clear, opaquePart = f.opaque || (!f.whey && !f.clear);
    const vars = [f.water && "moisture", f.protein && "protein", f.fat && "fat"].filter(Boolean).join(" and ") || "composition";
    out.statusWhy = f.twoStreams
      ? "Both streams and the reference variables are named, and the supplied dairy examples cover clear and opaque products. Composition ranges, required accuracy and installation points are not stated."
      : `The product, its optical character and the target (${vars}) are stated, and the supplied dairy examples cover this case. Ranges, accuracy and installation are not stated.`;
    if (f.twoStreams) {
      out.findings = [{ severity: "caution", title: "Two streams, two optical regimes", text: "A clear stream (for example whey) and an opaque product (for example a concentrate) behave differently: transmission/transflection suits clear liquids, reflection suits opaque products {{S01-17-dairy-refl}} {{S01-18-dairy-trans}}. Plan a separate interface decision and a separate calibration per stream; a single shared interface is a hypothesis to test {{S01-18-dairy-both}}." }];
      out.questions.push(Q("Which variables are needed for each stream (for example protein in whey; fat and protein in the concentrate), and over which ranges?", "method", "The client said protein and fat are used 'where relevant'; the target per stream decides the calibration design."));
    }
    out.questions.push(
      Q("Which product types and composition ranges occur, and which laboratory methods give the fat and protein references, with what uncertainty?", "reference", "Each variable needs its own independent reference."),
      Q("How do temperature, homogenisation state, texture and air bubbles vary at the candidate measurement points?", "method", "Physical changes alter scattering and can mimic composition changes {{S01-17-dairy-refl}}."),
      Q("Can a probe be flush-mounted where it sees a representative, flowing sample and survive the cleaning regime?", "setup", "Decides installation and fouling control."),
      Q("What accuracy, delay and maintenance limits would make the measurement useful?", "acceptance", "Defines go/no-go."),
    );
    if (clearPart) {
      out.unknowns.push(U("Turbidity range of the whey stream and how often it changes", "A stream that becomes turbid may leave the working range of a transmission path {{S01-18-dairy-trans}}."));
      if (f.turbid || !f.twoStreams) out.questions.unshift(Q("How turbid can the clear stream become, and under which operating conditions?", "method", "Decides whether one transmission path length is enough or reflection/transflection must also be tested."));
      out.recs.push(R("NIR", "primary", "transmission or transflection probe with a defined path length" + (f.twoStreams ? " (whey stream)" : ""), "NIR transmission/transflection is preferred for transparent or semi-transparent liquids such as whey {{S01-18-dairy-trans}}; the probe class covers liquid/colloidal samples {{S01-T1}}.", "Path length must be matched to the stream; too long loses signal, too short samples too little {{S01-18-dairy-trans}}."));
      out.concept.push({ label: f.twoStreams ? "Whey stream" : "Clear stream", method: "NIR", geometry: "Transmission / transflection probe, path length to be tested", location: "In-line, representative flowing section", fiber: FIBER_FOR.NIR });
      if (f.turbid || f.twoStreams) out.recs.push(R("NIR", "comparison", "diffuse reflection probe" + (f.twoStreams ? " (whey, in case it turns turbid)" : " (turbid conditions)"), "Reflection works in highly scattering media {{S01-18-dairy-both}}; include it so the concept still works when the stream turns turbid.", "Only needed if turbidity takes the transmission path out of range."));
    }
    if (opaquePart) {
      out.unknowns.push(U("Fat and protein ranges of the opaque product and the variation of temperature and texture", "Scattering changes with fat globule size and texture {{S01-17-dairy-refl}}."));
      out.recs.push(R("NIR", f.twoStreams ? "primary" : "primary", "diffuse reflection probe, flush-mounted" + (f.twoStreams ? " (concentrate)" : ""), "Inline NIR reflection is used for opaque or concentrated dairy products {{S01-17-dairy-refl}}.", "Scatter correction (MSC/SNV) and a calibration covering temperature/texture variation {{S01-17-dairy-refl}}."));
      out.concept.push({ label: f.twoStreams ? "Milk concentrate" : "Opaque product", method: "NIR", geometry: "Diffuse reflection probe, flush-mounted", location: "Pipe or vat with flowing product", fiber: FIBER_FOR.NIR });
    }
    if (f.twoStreams) out.recs.push(R("NIR", "conditional", "transflection probe tested on both streams", "A transflection probe can in some cases cover low- and high-fat products, and one NIR spectrometer serves both techniques {{S01-18-dairy-both}}.", "Adopt a single interface only if it meets the criteria on both streams."));
    out.recs.push(R("Raman / MIR ATR / fluorescence", "conditional", "secondary test only", "These can add molecular specificity NIR might miss {{S01-18-dairy-other}}.", "Consider only if NIR fails a specific variable."));
    out.unknowns.push(U("Composition ranges and the uncertainty of the laboratory reference", "Sets what a calibration can achieve and how many samples are needed."), U("Installation point, flow, temperature and cleaning regime", "Decides probe mounting, representativeness and fouling control."));
    out.risks.push(
      RK("Temperature, texture, homogenisation and bubbles mimic composition changes.", "Collect samples across physical variation; separate physical from compositional effects before calibrating."),
      RK("A reflection spectrum is not yet a fat or protein calibration.", "Fat and protein each need independent references and validation."),
      RK("Probe fouling or poor representativeness in the line.", "Choose position and cleaning with the client; check spectra before and after cleaning."),
    );
    if (f.twoStreams) out.risks.push(RK("A model from one stream is applied to the other.", "Keep stream-specific models unless a shared model is validated on both."));
    if (f.twoStreams) out.answer = "Use one NIR interface per stream: transmission or transflection with a defined path length for the whey, diffuse reflection for the concentrate. Test transflection on both streams as a possible shared interface, and keep separate calibrations per stream and per variable, checked against the laboratory protein and fat results.";
    out.plan.objective = f.twoStreams ? "Choose, per stream, the interface that gives usable spectra and the best agreement with laboratory protein/fat results." : `Show whether NIR can follow ${vars} in this product against laboratory results.`;
    out.plan.samples.push(f.twoStreams ? "Whey: samples across the protein range and across clear-to-turbid conditions" : "Samples across the composition range", ...(f.twoStreams ? ["Concentrate: samples across fat and protein ranges, temperature and texture states"] : []));
    out.plan.references.push("Laboratory protein" + (f.fat || !f.protein ? " and fat" : "") + " results on the same aliquots that were measured optically");
    out.plan.comparisons.push(f.twoStreams ? "Whey: transmission/transflection at two or more path lengths vs reflection; Concentrate: reflection vs transflection" : (clearPart ? "Transmission/transflection path lengths vs reflection" : "Reflection geometries under controlled vs realistic conditions"));
    out.plan.steps.push(
      "Measure laboratory samples with each interface under controlled temperature, then with temperature and texture varied.",
      "Check signal quality first: saturation, too-weak signal, bubbles, reproducibility after cleaning.",
      "Build per-stream, per-variable models; separate physical effects from composition.",
      "Validate on independent production runs; then install the chosen interface in-line for a pilot.",
    );
    out.plan.decision = "Composition error and bias on independent production runs against client-agreed limits, plus maintenance and response needs. No targets are invented here.";
    out.demonstrates.shows.push("Which interface gives usable spectra for each stream and how well it follows the laboratory references");
    out.demonstrates.notShown.push("Long-term in-line stability, cleaning-cycle effects over months, or other products");
    return out;
  },

  bioprocess: f => {
    const out = { status: "provisional", unknowns: [], questions: [], recs: [], concept: [], ranges: [], risks: [], plan: { samples: [], references: [], comparisons: [], steps: [] }, demonstrates: { shows: [], notShown: [] } };
    out.statusWhy = "The process and the variables are named and the supplied bioprocess overview covers them; concentration ranges, medium composition and reactor constraints are not stated.";
    if (f.glucose) {
      out.recs.push(R("Raman", "primary", "immersion Raman probe", "Raman detects metabolites such as glucose and lactate directly and suits aqueous media {{S01-16-bio-raman}}.", "Fluorescence background from the medium must be checked {{S01-11-raman}}."));
      out.recs.push(R("NIR", "comparison", "transmission/transflection or reflection probe, depending on optical density", "NIR tracks major components such as glucose in the millimolar range {{S01-16-bio-nir}}.", "May lack sensitivity at low concentrations {{S01-16-bio-nir}}; water bands dominate."));
      out.questions.push(Q("Which glucose" + (f.text.includes("lactate") ? " and lactate" : "") + " ranges occur, and what is the lowest concentration that matters?", "method", "Low concentrations may be below NIR sensitivity {{S01-16-bio-nir}}."));
      out.ranges.push(RANGE.Raman, RANGE.NIR);
    }
    if (f.biomass) {
      out.recs.push(R("UV-Vis or NIR (turbidity / scattering)", "conditional", "transmission at low OD, ATR or reflection at high OD", "Cell-suspension turbidity correlates with cell density {{S01-16-bio-uv}}; probe choice follows optical density {{S01-16-uv-od}}.", "The sources link turbidity to cell density {{S01-16-bio-uv}}; a viable-cell measurement is not described in them."));
      out.questions.push(Q("Which biomass quantity is needed: total biomass, cell density, dry weight or viable cells, and how is it measured offline?", "method", "Different targets need different signals and references."));
      if (!out.ranges.includes(RANGE.NIR)) out.ranges.push(RANGE.NIR);
    }
    out.questions.push(
      Q("How do the medium and the optical density change across the run?", "method", "Decides transmission vs reflection/ATR geometry {{S01-16-uv-od}}."),
      Q("Which ports, sterilisation (SIP/autoclave) and single-use constraints apply to the probe?", "setup", "Probe must survive the sterilisation regime."),
      Q("Which reference methods, sampling frequency and uncertainty are available?", "reference", "Calibration and validation depend on matched references."),
    );
    out.unknowns.push(U("Concentration ranges of the target variables and the uncertainty of the offline references", "Decides whether NIR sensitivity is sufficient and what a calibration can achieve {{S01-16-bio-nir}}."), U("Medium composition and how it changes", "Changing medium and cells add variance the model must cover."), U("Probe port and sterilisation constraints", "Limit the probe types that can be installed."));
    out.concept.push({ label: "Bioreactor", method: f.glucose ? "Raman" : "NIR", geometry: "Immersion probe through a reactor port (geometry depends on optical density)", location: "In situ in the reactor", fiber: f.glucose ? FIBER_FOR.Raman : FIBER_FOR.NIR });
    out.risks.push(
      RK("Glucose, lactate and biomass all change with run time, so a model can learn time instead of the analyte.", "Validate on a run not used for calibration, with deliberate feed changes {{S01-5-chemometrics}}."),
      RK("Changing medium and cell population shift the background.", "Calibrate across several runs and media lots; validate on a run not used for calibration."),
      RK("Probe fouling during the run.", "Inspect spectra for drift; compare before/after cleaning."),
    );
    out.plan.objective = "Show which method follows the named variables in situ against the existing laboratory measurements.";
    out.plan.samples.push("Several runs covering normal variation, including at least one run deliberately different (feeding, spikes)");
    out.plan.references.push("Existing offline assays, time-matched to the spectra");
    out.plan.comparisons.push("Raman vs NIR for metabolites; turbidity-type signal vs offline biomass reference");
    out.plan.steps.push("Collect spectra in situ with the reference sampling schedule.", "Build models on some runs; validate on a held-out run.", "Check that predictions follow spikes or feed changes, not only the time trend.");
    out.plan.decision = "Prediction error on a held-out run against client-agreed limits, and correct response to deliberate changes.";
    out.demonstrates.shows.push("Whether each method follows the variable on runs not used for calibration");
    out.demonstrates.notShown.push("Robustness across media changes or scales not tested");
    return out;
  },

  "petro-water": f => ({
    status: "provisional",
    statusWhy: "Material (petroleum stream), target (water content) and an independent laboratory reference are stated, and the supplied slides show MIR-ATR spectra of water in oil. Water range, oil type, link length and conditions are not stated.",
    unknowns: [
      U("Water range and state (dissolved, emulsified, free)", "ATR samples a 1–6 µm layer, transmission probes 1–10 mm {{S01-T1}}; the water state decides which is representative."),
      U("Oil type and optical density", "Dark or scattering oils limit transmission path lengths."),
      U("Distance and routing between analyzer and line; temperature, pressure and hazardous-area classification", "Decides the fiber family and whether the link length is feasible at all."),
      U("Required response time and accuracy", "Defines go/no-go."),
    ],
    questions: [
      Q("Over which range does water vary, and is it dissolved, emulsified or free water?", "method", "ATR samples 1–6 µm, transmission 1–10 mm {{S01-T1}}."),
      Q("What is the fiber link length and route between line and analyzer, and what temperatures, pressures and hazardous-area class apply?", "setup", "MIR fibers and Vis-NIR silica cables have very different reach {{S02-6-fibers}} {{S02-7-silica-long}}."),
      Q("Which petroleum product (crude, refined, viscosity, colour) is in the line?", "method", "Affects NIR path length and ATR fouling."),
      Q("Which laboratory method gives the reference, and what accuracy and update time are needed?", "acceptance", "Defines the comparison and the decision."),
    ],
    recs: [
      R("MIR ATR", "primary", "ATR probe with ZrO₂ or diamond tip", "The supplied slide shows water-in-oil spectra with ZrO₂ ATR probes {{S02-13-petro}}; ATR suits liquids {{S01-T1}}.", "Needs mid-IR fibers {{S02-6-fibers}}; reach over long links is not documented in the sources."),
      R("NIR", "comparison", "transmission or transflection probe", "NIR suits remote fiber probes {{S01-5-nir-online}}; moisture bands lie in the NIR {{S02-18-bands}}; long low-OH silica cables are described {{S02-7-silica-long}}.", "Sensitivity for this oil and water range is unknown and must be tested."),
    ],
    concept: [{ label: "Petroleum line", method: "MIR ATR", geometry: "ATR immersion probe (ZrO₂ / diamond)", location: "In the line or a bypass", fiber: FIBER_FOR["MIR ATR"], band: { nm: [2500, 5000], label: "4000–2000 cm⁻¹ window of the water-in-oil spectra (S02 p.13)" } }, { label: "Petroleum line (comparison)", method: "NIR", geometry: "Transmission / transflection probe", location: "Same point", fiber: FIBER_FOR.NIR }],
    ranges: [RANGE["MIR ATR"], RANGE.NIR],
    risks: [
      RK("Free or emulsified water is not sampled representatively by a surface measurement.", "Test with realistic emulsions, not only dissolved water."),
      RK("Fouling of the ATR crystal by heavy fractions.", "Include fouling and cleaning in the test."),
      RK("Fiber length limits for MIR.", "AFS to confirm reach; consider placing the FTIR near the line."),
    ],
    plan: {
      objective: "Establish which method follows water content in this oil against the laboratory reference, with a feasible fiber link.",
      samples: ["Oil samples across the client's water range, including realistic emulsions"],
      references: ["Laboratory water determination on the same samples"],
      comparisons: ["MIR ATR vs NIR transmission/transflection"],
      steps: ["Measure prepared and process samples with both methods in the laboratory.", "Build and validate calibrations on independent samples.", "Test the selected method with the planned fiber type and length before any field installation."],
      decision: "Agreement with the laboratory method against client-agreed limits, with a link the selected fiber can actually carry.",
    },
    demonstrates: { shows: ["Which method resolves water in this oil and what the link design must allow"], notShown: ["Performance over the final link length unless that link is tested"] },
  }),

  "polymer-melt": f => ({
    status: "provisional",
    statusWhy: "Hot melt with API, composition changes as the target, offline assays, and a fouling-prone hot interface are stated; the supplied slides show both MIR ATR and NIR at an extruder. Temperatures, API and ranges are not stated.",
    unknowns: [U("Melt temperature and pressure at the interface", "Decide probe materials and fiber coating {{S02-7-silica-long}}."), U("API, polymer and concentration range", "Decide spectral contrast."), U("Type and rate of material build-up", "Decides window/crystal choice and cleaning."), U("Required response time", "Extrusion changes are fast.")],
    questions: [
      Q("What temperature and pressure act on the probe at the die or barrel, and is a standard port available?", "setup", "Determines probe construction and fiber type."),
      Q("Which API and polymer, over which concentration range, and which changes must be detected?", "method", "Decides whether NIR overtones or MIR fundamentals give the contrast."),
      Q("What kind of build-up occurs and can the probe be cleaned in place?", "setup", "Contact ATR is sensitive to deposits."),
      Q("Which offline assay and which acceptance limits apply?", "acceptance", "Defines go/no-go."),
    ],
    recs: [
      R("NIR", "primary", "reflection probe at the die", "An NIR probe at the die of a hot-melt extruder is shown for feed-forward control {{S02-14-extrusion}}.", "Hot-melt temperature and build-up must be within probe limits."),
      R("MIR ATR", "comparison", "diamond-cone ATR probe with PIR fiber", "API in hot polymer was measured with a diamond ATR probe coupled to FTIR {{S02-14-extrusion}}.", "Contact measurement: deposits on the crystal must be controlled."),
      R("Raman", "conditional", "Raman probe", "Complementary to MIR {{S01-5-raman-comp}}, but not shown for extrusion in the sources.", "Check fluorescence and heating of the melt."),
    ],
    concept: [{ label: "Extruder die", method: "NIR", geometry: "Reflection probe", location: "Die / die adaptor", fiber: "Vis-NIR silica; metal-coated fibers for heat {{S02-7-silica-long}}" }, { label: "Extruder (comparison)", method: "MIR ATR", geometry: "Diamond-cone ATR probe", location: "Die or barrel port", fiber: FIBER_FOR["MIR ATR"] }],
    ranges: [RANGE.NIR, RANGE["MIR ATR"]],
    risks: [RK("Probe damage or drift at melt temperature.", "Confirm ratings with AFS before installation."), RK("Build-up on window or crystal.", "Track baseline drift; include cleaning in the trial."), RK("Temperature changes mimic composition changes.", "Vary temperature in the calibration set.")],
    plan: { objective: "Compare NIR and MIR ATR for following API concentration in the melt.", samples: ["Extrusion runs with stepped API levels across the agreed range, at normal temperature variation"], references: ["Offline assays on extrudate collected at known times"], comparisons: ["NIR reflection vs MIR ATR"], steps: ["Run step changes and record spectra with timestamps.", "Match extrudate samples to spectra by residence time.", "Validate on a separate run; check drift from build-up."], decision: "Prediction error, response to steps and drift over the run, against client limits." },
    demonstrates: { shows: ["Which interface follows API steps in this melt and how build-up affects it"], notShown: ["Validated control use or long-term probe life"] },
  }),

  "tissue-lab": f => ({
    status: "provisional",
    statusWhy: "This is a laboratory classification study on model tissues with named methods; the supplied paper describes the same design. No clinical use is requested.",
    unknowns: [U("Number of samples per tissue type and how points are chosen", "Determines whether results generalise beyond the measured pieces."), U("Classification target and success criterion", "Needed before measuring."), U("Available hardware (combined vs separate probes)", "Decides whether same-spot measurement is possible.")],
    questions: [
      Q("Will measurements use a combined MIR ATR + fluorescence probe or two separate probes?", "setup", "Separate probes cannot guarantee the same spot {{S04-2-samespot}}."),
      Q("How many independent samples per tissue type are available, and how is a 'same location' defined?", "experiment", "Validation must hold out whole samples, not only points."),
      Q("What classification result would count as success, and against which reference labels?", "acceptance", "Sets the decision basis."),
    ],
    recs: [
      R("MIR ATR + fluorescence", "primary", "combined probe measuring the same spot", "A combined probe was demonstrated on chicken breast, fat and liver {{S04-1-probe}}; fusion separated classes that neither method separated alone {{S04-4-result}}.", "Samples must suit ATR contact and contain a fluorescent component {{S04-4-result}}."),
      R("MIR ATR", "comparison", "ATR probe alone", "Recognised fat by the ester carbonyl band {{S04-3-design}}.", "Report as the single-method baseline."),
      R("Fluorescence", "comparison", "fluorescence alone", "Recognised liver by a porphyrin band {{S04-3-design}}.", "Report as the single-method baseline."),
    ],
    concept: [{ label: "Bench", method: "MIR ATR", geometry: "Combined ZrO₂ ATR + fluorescence probe head", location: "Laboratory, probe in contact with tissue", fiber: "CIR fibers (IR) + UV-Vis silica fibers (fluorescence) {{S04-1-probe}} {{S02-6-fibers}}" }],
    ranges: [RANGE["MIR ATR"], RANGE.Fluorescence],
    risks: [RK("Heterogeneous tissue: different points give different spectra.", "Measure several points per sample; validate by holding out whole samples {{S04-3-design}}."), RK("A model-tissue result is read as clinical evidence.", "State the scope: laboratory classification only.")],
    plan: { objective: "Compare MIR ATR, fluorescence and fused data for classifying the model tissues at the same measurement points.", samples: ["Several independent pieces per tissue type, several points per piece"], references: ["Known tissue type of each piece"], comparisons: ["MIR ATR alone vs fluorescence alone vs fused"], steps: ["Measure both methods at each point simultaneously.", "Explore with PCA, then a supervised classifier.", "Validate by leaving out whole pieces."], decision: "Classification of held-out pieces against an agreed criterion; fusion is worth it only if it beats both single methods." },
    demonstrates: { shows: ["Whether same-spot fusion separates the model tissue types better than either method alone in this laboratory set"], notShown: ["Performance on human tissue, in vivo, or diagnostic accuracy"] },
  }),

  "tissue-clinical": f => ({
    status: "outside",
    statusWhy: "Guiding tumour-boundary decisions in live surgery is a clinical use. The supplied evidence is an in vitro proof of concept, and the client has no in vivo data and no validation of its own setup. A readiness claim is outside what the sources support; laboratory feasibility steps can be proposed.",
    unknowns: [U("Target organ and tumour type", "The LED set must be adapted to each tissue and cancer type {{S03-14-limits}}."), U("Exact design of the proposed sensor and how it differs from the published prototypes", "Published results do not transfer to a different set-up."), U("Available tissue, histopathology reference and ethics approvals", "Needed for any further study.")],
    questions: [
      Q("Which organ and tumour types are targeted, and is the proposed sensor the same design as in the study?", "method", "Results are specific to kidney samples and the published prototypes {{S03-1-scope}} {{S03-14-limits}}."),
      Q("Which ex vivo tissue, with histopathology as reference, can be measured on your own set-up, and from how many patients?", "experiment", "Patient-wise validation needs many patients, not only many spectra."),
      Q("Which clinical and regulatory partners will own the clinical evaluation?", "acceptance", "The sources show only an in vitro proof of concept {{S03-1-scope}} {{S03-14-limits}}."),
    ],
    recs: [
      R("NIR diffuse reflection (LED sensor)", "conditional", "contact / near-contact reflection probe", "The study shows tumour/normal discrimination on 14 in vitro samples from 7 patients {{S03-1-scope}}; NIR penetrates up to about 3 mm {{S03-2-aim}}.", "Research hypothesis for your organ and set-up, not a validated method."),
      R("Multispectral (NIR or MIR ATR + fluorescence)", "conditional", "combined probe, same spot", "Combinations are described as improving tumour-margin detection in research {{S01-7-synergy}} {{S04-4-result}}.", "Research option to evaluate ex vivo."),
    ],
    concept: [{ label: "Ex vivo bench", method: "NIR", geometry: "Diffuse reflection probe at controlled distance and angle", location: "Laboratory, fresh ex vivo tissue (no patient use)", fiber: FIBER_FOR.NIR }],
    ranges: [{ method: "NIR (LED)", text: "The study used LEDs in the 900–1500 nm region {{S03-2-aim}}; wavelengths must be re-selected for the target tissue {{S03-14-limits}}." }],
    risks: [
      RK("False negatives leave tumour behind; the authors call them unacceptable.", "Report sensitivity per patient with confidence intervals; never rely on the sensor alone {{S03-14-limits}}."),
      RK("Frozen/thawed ex vivo spectra differ from in vivo.", "Prefer fresh tissue; treat any in vivo transfer as untested {{S03-3-exvivo}}."),
      RK("High variance in cancer tissue measurements.", "Characterise reproducibility before classification {{S03-14-limits}}."),
      RK("Overfitting with few patients.", "Patient-wise segmented validation and permutation tests {{S03-14-limits}}."),
    ],
    plan: {
      objective: "Establish, on your own set-up and outside the operating room, whether the sensor separates tumour from normal tissue for the target organ.",
      samples: ["Paired tumour/normal ex vivo samples from as many patients as available", "Repeated points per sample"],
      references: ["Histopathology of each measured site"],
      comparisons: ["Your LED sensor vs a full-spectrum NIR reference measurement on the same sites", "Optional: multispectral probe as a second arm"],
      steps: ["Bench characterisation: reproducibility, probe distance, angle, environmental effects and spectral reference {{S03-14-limits}}.", "Ex vivo study with histopathology at each measured site.", "Patient-wise segmented cross-validation and permutation tests {{S03-14-limits}}.", "Only then consider in vivo work; the study itself calls for further dedicated studies first {{S03-14-limits}}."],
      decision: "Per-patient sensitivity and specificity on held-out patients against targets set with clinicians. No in vivo or surgical use follows from this plan alone.",
    },
    demonstrates: { shows: ["Whether your sensor discriminates tumour from normal ex vivo tissue for the target organ"], notShown: ["Safety, in vivo performance, or fitness to guide surgical decisions"] },
  }),

  "undefined-liquid": f => ({
    status: "insufficient",
    statusWhy: "Neither the contaminant nor the quality variable that fails is known, and the liquid itself is not described. No method or sensor configuration can be justified yet.",
    unknowns: [
      U("What the liquid is (aqueous, organic, emulsion) and whether it is clear or opaque", "Decides which geometries can work at all {{S01-T1}}."),
      U("Which quality test fails when the batch is off specification", "This is the variable a sensor would have to predict."),
      U("Candidate contaminants and their likely concentrations", "Selectivity (MIR, Raman) vs sensitivity (UV-Vis, fluorescence) depends on what and how much {{S01-T1}}."),
      U("Whether retained in-spec and off-spec samples exist", "Needed for a first screening."),
    ],
    questions: [
      Q("What is the liquid (main components, aqueous or organic), and is it clear, coloured, turbid or opaque?", "method", "Rules geometries in or out."),
      Q("Which specification test fails, by how much, and how often?", "method", "Defines the target variable and the reference."),
      Q("Which contaminants are plausible (raw materials, cleaning agents, water ingress, cross-contamination), and at what level do they matter?", "method", "Decides between selective and highly sensitive methods."),
      Q("Can you supply retained in-spec and off-spec samples, and samples spiked with suspected contaminants?", "experiment", "The first experiment depends on them."),
      Q("Where could a probe go, with which flow, temperature and pressure, and how fast must a result be available?", "setup", "Only relevant once a method is chosen."),
    ],
    recs: [
      R("MIR ATR", "screening", "ATR on retained liquid samples", "High selectivity for liquids {{S01-T1}}; sharp, interpretable bands {{S01-5-chemometrics}}.", "Screening only."),
      R("NIR", "screening", "transmission/transflection (clear) or reflection (opaque)", "Robust online method with remote fiber probes {{S01-5-nir-online}}.", "Screening only; may miss trace contaminants."),
      R("Raman", "screening", "Raman probe", "High selectivity {{S01-T1}}.", "Fluorescence may mask signals {{S01-11-raman}}."),
      R("UV-Vis / fluorescence", "screening", "transmission or fluorimetric probe", "High sensitivity {{S01-T1}}.", "Low selectivity; only useful if the contaminant absorbs or fluoresces {{S01-5-fluo}}."),
    ],
    concept: [{ label: "Laboratory screening", method: "MIR ATR", geometry: "Not fixed: several laboratory interfaces in parallel", location: "Laboratory, retained samples (no process installation yet)", fiber: "Per method; to be decided after screening" }],
    ranges: [{ method: "All", text: "No range can be specified before the contaminant or the spectral difference is known. Screening uses each method's nominal range {{S01-10-nir}} {{S01-9-mir}}." }],
    risks: [RK("Choosing a sensor before the cause is known.", "Screen first; select after a spectral difference is found."), RK("Few off-spec samples lead to over-fitted separation.", "Validate on samples not used to find the difference."), RK("The contaminant is below every method's sensitivity.", "Use spiked samples at the level of concern to test detectability.")],
    plan: {
      objective: "Find whether, and with which method, off-spec liquid differs spectrally from in-spec liquid, and link the difference to a measurable quality variable.",
      samples: ["Retained in-spec and off-spec batches", "In-spec liquid spiked with each suspected contaminant at the level of concern"],
      references: ["The specification test that fails; any chemical analysis that identifies the contaminant"],
      comparisons: ["MIR ATR, NIR, Raman, UV-Vis/fluorescence on the same samples {{S01-3-unknown}}"],
      steps: ["Collect the information above and the samples.", "Measure all samples with each available method in the laboratory {{S01-3-unknown}}.", "Explore with unsupervised analysis (for example PCA) to see whether off-spec samples separate.", "Identify the bands that separate them and, with spiked samples, what they correspond to.", "Only then define the target variable, select the method and design the sensor configuration."],
      decision: "Go to a sensor design only if a method separates off-spec from in-spec on samples not used to find the difference, and a reference measurement for the target exists.",
    },
    demonstrates: { shows: ["Whether off-spec batches are spectrally detectable at all, and with which method"], notShown: ["A calibrated contaminant concentration, or in-line performance"] },
  }),

  generic: f => ({
    status: "insufficient",
    statusWhy: "The enquiry does not name enough of the material, the target variable or the process to justify a method.",
    unknowns: [U("Material and its optical character", "Decides the geometry {{S01-T1}}."), U("Target variable and its reference", "Needed for any calibration."), U("Process location and conditions", "Decides probe and fiber.")],
    questions: [Q("What is the material (liquid, powder, solid, paste), and is it clear or opaque?", "method", "Rules geometries in or out {{S01-T1}}."), Q("Which variable must be measured, over which range, and how is it measured today?", "method", "Defines the target and reference."), Q("Where would the measurement be, and under which conditions?", "setup", "Decides probe and fiber.")],
    recs: [], concept: [], ranges: [], risks: [RK("Choosing a method before the target is defined.", "Ask the questions first.")],
    plan: { objective: "Define the measurement task.", samples: ["Representative samples"], references: ["Existing laboratory method"], comparisons: ["Methods shortlisted after the answers"], steps: ["Collect answers.", "Screen candidate methods on samples {{S01-3-unknown}}."], decision: "To be agreed with the client." },
    demonstrates: { shows: [], notShown: [] },
  }),
};

// ------------------------------------------------------------------ premise checks (guards)
const GUARDS = [
  { id: "coating-endpoint", when: f => f.powder && f.coating,
    apply: (f, out) => {
      out.findings.push({ severity: "caution", title: "Coating is a different task from blend potency", text: "The supplied feed-frame example measures blend potency {{S01-14-pharma}}; for pellet coating in a fluidized bed, NIR + Raman gave the best results {{S01-7-synergy}}. Whether this holds in your coater is a hypothesis to test against the best single method." });
      out.questions.unshift(Q("Which independent method gives the coating reference (for example coating weight gain or thickness), over which range, and what end-point accuracy is needed?", "reference", "A coating calibration needs its own reference {{S01-5-chemometrics}}."));
      out.plan.objective = "Show whether NIR, Raman or NIR + Raman follows coating progress in this coater well enough to set the end point.";
    } },
  { id: "gas-phase", when: f => f.gas && f.domain === "generic",
    apply: (f, out) => {
      out.findings.push({ severity: "caution", title: "Gas-phase measurement is only briefly covered by the sources", text: "MIR can analyse gases {{S01-9-gases}}, and gas bands such as CO2 and CH4 lie at about 4–10 µm {{S02-17-gas}}, beyond silica fiber (about 350–2400 nm) {{S02-6-fibers}}. No gas-cell or duct installation is described, so the interface must be designed and tested." });
      out.recs.push(R("MIR", "primary", "gas-phase absorption via mid-IR fiber (PIR)", "Gas bands at about 4–10 µm {{S02-17-gas}}; MIR analyses gases {{S01-9-gases}}.", "Interface, temperature and path not described in the sources."));
      out.questions.unshift(Q("What are the gas temperature, pressure, dust or moisture load, and the concentration ranges of each gas?", "setup", "Decides interface and fiber {{S02-6-fibers}}."));
    } },
  { id: "raman-autofluorescence", when: f => f.raman && f.autofluo,
    apply: (f, out) => {
      out.findings.push({ severity: "caution", title: "A fluorescent sample can hide the Raman signal", text: "Raman signals are weak and, for many organic compounds, masked by much stronger fluorescence {{S01-11-raman}}. Measure the sample's fluorescence background under the planned laser before relying on Raman; NIR is the robust online comparison {{S01-5-nir-online}}." });
      out.questions.unshift(Q("How strong is the sample's fluorescence under the planned Raman laser, and can you send a spectrum of the sample?", "method", "Fluorescence can mask Raman {{S01-11-raman}}."));
      out.recs.forEach(r => { if (r.method === "Raman" && r.role === "primary") r.role = "comparison"; });
      if (!out.recs.some(r => /^NIR/.test(r.method))) out.recs.unshift(R("NIR", "comparison", "transmission/transflection or reflection probe", "Robust online method with remote fiber probes {{S01-5-nir-online}}.", "Comparison arm in case fluorescence masks Raman."));
    } },
  { id: "accuracy-guarantee", when: f => f.guarantee || (f.accuracyNumber && f.approve),
    apply: (f, out) => {
      out.findings.push({ severity: "correction", title: "No accuracy can be promised before calibration", text: `${f.accuracyNumber ? "The requested " + f.accuracyNumber + " accuracy" : "A guaranteed result"} depends on a calibration model built and validated on the client's own samples {{S01-5-chemometrics}}; the method choice itself must first be tested against the analytical problem {{S01-5-select}}.` });
      out.questions.unshift(Q("Which independent laboratory reference gives the target values, and over which concentration range must the accuracy hold?", "reference", "Accuracy can only be stated after validation {{S01-5-chemometrics}}."));
    } },
  { id: "contradictory-description", when: f => !!f.contradiction,
    apply: (f, out) => {
      out.findings.push({ severity: "correction", title: "The sample description contradicts itself", text: `The enquiry calls the sample clear and also black or opaque ("${f.contradiction.slice(0, 120)}"). Clear and opaque samples need different measurement geometries {{S01-T1}}, so confirm the optical state before choosing a probe.` });
      out.questions.unshift(Q("Is the sample clear, turbid or opaque at the measuring point, and can you send a photo or a sample?", "method", "Decides transmission vs reflection or ATR {{S01-T1}}."));
    } },
  { id: "calibration-transfer", when: f => f.calReuse || (f.newFormulation && f.nir),
    apply: (f, out) => {
      out.findings.push({ severity: "correction", title: "The existing calibration cannot be assumed valid for the new formulation", text: "NIR calibrations are chemometric models built and validated for a specific matrix {{S01-5-chemometrics}} {{S01-10-nir}}. A different API and excipient blend is a new matrix, so the old model must be re-tested and, most likely, replaced by a new calibration." });
      if (f.raman) out.findings.push({ severity: "correction", title: "Adding Raman does not keep the old calibration valid", text: "Raman adds complementary information {{S01-14-pharma}}, and a combined NIR+Raman model is built on newly fused data {{S01-9-fusion}}. That is a new model, which needs its own calibration and validation on the new formulation; whether fusion helps this formulation is a hypothesis {{S01-7-synergy}}." });
      out.notRecommended.push({ method: "Reusing the old NIR calibration unchanged", reason: "Not supported: calibrations are matrix-specific {{S01-5-chemometrics}}. Apply the old model to the new blends only as a diagnostic of bias." });
      out.questions.unshift(Q("How was the existing pilot calibrated and validated (ranges, reference assay, independent batches), and will the old formulation still run on the same press?", "method", "Shows what can be reused (hardware, sampling, procedures) and whether two models must be maintained."));
      out.questions.splice(1, 0, Q("Is Raman hardware already available, and has the new API or any excipient shown fluorescence under laser excitation?", "method", "Fluorescence can mask Raman signals {{S01-11-raman}}."));
      out.plan.steps.unshift("Apply the existing NIR model to the new blends and report bias and error, as a diagnostic only.");
      out.plan.objective = "Build and validate a calibration for the new formulation, and test whether Raman or NIR+Raman adds value over NIR alone.";
      out.answer = "Do not reuse the old calibration, and do not expect Raman to keep it valid. Treat the new blend as a new calibration task on the existing NIR hardware, test Raman on its own merits, and adopt NIR+Raman fusion only if it beats the best single method on independent batches.";
      out.reuse = ["Probe, spectrometer, mounting and sampling procedure", "Reference-assay workflow and timing", "Data pipeline and validation scheme"];
    } },
  { id: "fluorescence-without-target", when: f => f.fluo && (f.noFluoTarget || (f.sensitivityOnly && (f.glucose || f.viable))),
    apply: (f, out) => {
      out.status = maxStatus(out.status, "insufficient");
      out.statusWhy = "No fluorescent target, marker or reference relationship has been identified for glucose or viable biomass, so direct reporting from fluorescence cannot be justified yet. Other methods can be shortlisted for these variables.";
      out.findings.push({ severity: "blocker", title: "Sensitivity is not selectivity", text: "Fluorimetry is rated high in sensitivity but low in selectivity {{S01-T1}}. It relies on substances that fluoresce, and most chemicals do not {{S01-5-fluo}}; the combined-probe authors limit it to samples with at least one fluorescent component {{S04-4-result}}." });
      if (f.glucose) out.findings.push({ severity: "blocker", title: "Glucose: no direct fluorescence route", text: "In the supplied bioprocess material, fluorescence targets intrinsic fluorophores such as NADH, tryptophan and riboflavin {{S01-16-bio-fluo}}, while glucose is assigned to NIR {{S01-16-bio-nir}} and Raman {{S01-16-bio-raman}}." });
      if (f.viable || f.biomass) out.findings.push({ severity: "caution", title: "Viable biomass needs a defined signal and reference", text: "The sources link biomass to turbidity (cell density) {{S01-16-bio-uv}} and report that NIR combined with fluorescence improved biomass estimates in yeast fermentation {{S01-7-synergy}}. The sources describe no viable-cell measurement, so a viability reference is required {{S01-16-bio-uv}}." });
      out.notRecommended.push({ method: "Fluorescence as a direct glucose readout", reason: "No fluorescent target; glucose is handled by NIR or Raman in the sources {{S01-16-bio-nir}} {{S01-16-bio-raman}}." });
      out.notRecommended.push({ method: "Fluorescence reported as viable biomass without validation", reason: "Fluorimetry has low selectivity {{S01-T1}}; a fluorescence model must be calibrated and validated against a reference first {{S01-5-chemometrics}}." });
      out.recs = out.recs.filter(r => !/^Fluorescence/.test(r.method));
      out.recs.push(R("Fluorescence (existing instrument)", "conditional", "fluorimetric probe in situ", "Can follow intrinsic fluorophores such as NADH or tryptophan {{S01-16-bio-fluo}}, which may relate to metabolic state.", "Use as an indicator only after a fluorophore is named and a relationship to the reference is shown on independent runs."));
      out.ranges.push(RANGE.Fluorescence);
      out.questions.unshift(Q("Which fluorophore do you expect to see (for example NADH, tryptophan, riboflavin), with which excitation and emission settings does your instrument work, and can it be fitted with an in-situ probe?", "method", "Without a named fluorophore there is no physical basis for a fluorescence readout {{S01-16-bio-fluo}}."));
      out.questions.splice(1, 0, Q("Which viable-biomass reference do you use (for example viable cell count or a viability assay), and how often?", "reference", "Required to test any biomass relationship."));
      out.plan.objective = "Find out whether any fluorescence feature relates to glucose or viable biomass independently of run time, and compare against NIR/Raman for glucose.";
      out.plan.comparisons = ["Fluorescence features vs glucose and viable-biomass references", "Raman and NIR vs glucose reference", "Turbidity-type signal vs total and viable biomass"];
      out.plan.references = ["Offline glucose assay", "Viable-cell count or viability assay, plus total biomass (dry weight or cell density)"];
      out.plan.steps = [
        "Answer the fluorophore question: record excitation–emission spectra of medium, cells and supernatant with the existing instrument to see which fluorophores are present {{S01-16-bio-fluo}}.",
        "Run several fermentations with the fluorometer, and Raman or NIR if available, alongside time-matched offline references.",
        "Include at least one run with deliberate feed changes and validate on runs not used for calibration {{S01-5-chemometrics}}.",
        "Build models on some runs and validate on a held-out run; check that predictions follow the spikes.",
        "Keep only relationships that a named fluorophore explains; report glucose from the method that validates."];
      out.answer = "Do not report glucose or viable-cell values from fluorescence yet. High sensitivity gives no selectivity without a fluorescent target; glucose is followed by Raman or NIR in the supplied material, and viable biomass needs a defined reference. The existing fluorometer can be tested as an indicator of named fluorophores such as NADH, in runs designed so the signal cannot just follow time.";
      out.plan.decision = "Report a variable from fluorescence only if a named fluorophore explains the signal and the relationship predicts the reference on independent runs. Otherwise use the method that does.";
      out.demonstrates.shows = ["Whether fluorescence carries information about glucose or viable biomass beyond the shared time trend", "Which method is better for glucose on held-out runs"];
    } },
  { id: "fiber-range", when: f => f.mir && f.silica,
    apply: (f, out) => {
      out.status = maxStatus(out.status, "insufficient");
      out.statusWhy = "The MIR ATR concept as proposed cannot be approved: the existing silica cable does not transmit the mid-IR range, and the link length, routing and operating conditions are unknown.";
      out.approval = { decision: "Not approved", reason: "Fiber cannot carry the method's spectral range; link not specified." };
      out.findings.push({ severity: "blocker", title: "A visible/NIR silica cable cannot carry MIR ATR", text: "Vis-NIR silica fiber transmits about 350–2400 nm {{S02-6-fibers}}. MIR starts at 4000 cm⁻¹ = 2.5 µm {{S01-9-mir}} {{REF-units}}, and the water-in-oil ATR spectra in the slides span 4000–2000 cm⁻¹ {{S02-13-petro}}. Mid-IR needs CIR (1.1–6.5 µm) or PIR (3–17 µm) fibers {{S02-6-fibers}}." });
      out.concept.unshift({ label: "As proposed by client", method: "MIR ATR", geometry: "ATR probe", location: "Petroleum line, analyzer in another building", fiber: "Existing Vis-NIR silica cable", proposed: true, fiberFamily: "Vis-NIR silica", band: { nm: [2500, 5000], label: "4000–2000 cm⁻¹ window of the water-in-oil spectra (S02 p.13)" } });
      out.notRecommended.push({ method: "MIR ATR through the existing silica cable", reason: "Spectral range mismatch {{S02-6-fibers}}." });
      out.questions.unshift(Q("What exactly is the existing cable (fiber type, OH content, core size, connectors, length, condition)?", "setup", "Decides whether it could serve an NIR alternative; long Vis-NIR links rely on low-OH silica {{S02-7-silica-long}}."));
    } },
  { id: "long-mir-link", when: f => f.mir && f.remote,
    apply: (f, out) => {
      out.findings.push({ severity: f.silica ? "blocker" : "caution", title: "Analyzer far from the line: MIR reach is not documented", text: "Long 100–300 m cables are described for low-OH silica (Vis-NIR) {{S02-7-silica-long}}. The sources give no comparable reach for mid-IR fibers; the PIR vs hollow-waveguide comparison is shown for 2 m lengths {{S02-9-hwg}}. AFS must confirm whether any MIR link of the required length is feasible." });
      out.options = [
        { name: "A. MIR ATR, analyzer near the line", text: "FTIR in a suitable housing close to the line with a short CIR/PIR link {{S02-6-fibers}}; results sent to the other building as data, not light {{S02-18-bands}}." },
        { name: "B. NIR with a long silica link", text: "NIR suits remote fiber probes {{S01-5-nir-online}} and long low-OH silica cables exist {{S02-7-silica-long}}; moisture bands are in the NIR {{S02-18-bands}}. Sensitivity for this oil must be tested; the existing cable is reusable only if its fiber type and condition fit." },
        { name: "C. MIR fiber to the remote analyzer", text: "Only if AFS confirms that a mid-IR fiber of the required length and routing is feasible; not supported by the supplied sources." },
      ];
      out.plan.comparisons = ["MIR ATR with a short mid-IR fiber (option A)", "NIR transmission/transflection through representative silica length, ideally the existing cable on a spool (option B)"];
      out.plan.steps.push("Measure the throughput of the existing cable across the NIR range to see whether option B can reuse it.");
      if (f.silica) out.answer = "The concept as proposed cannot be approved: a visible/NIR silica cable does not transmit the mid-IR range MIR ATR needs, and the sources document no mid-IR link reaching another building. Decide between an FTIR near the line with a short mid-IR fiber and NIR over a long silica link, after the link details arrive and a laboratory comparison against the water reference.";
    } },
  { id: "clinical-proof", when: f => f.clinical && (f.proof || f.noOwnData || /decide|decision|next (week|month)|tomorrow|which tissue to (cut|remove|resect)/.test(f.text)),
    apply: (f, out) => {
      out.status = "outside";
      out.findings.push({ severity: "blocker", title: /kidney|study|paper|publication/.test(f.text) ? "The kidney study is not proof of surgical readiness" : "No supplied source supports surgical decisions", text: "It tested two prototypes on 14 in vitro samples from 7 patients {{S03-1-scope}}, measured thawed frozen biopsies whose spectra can differ from in vivo {{S03-3-exvivo}}, and the authors call it a proof of concept with very high variance in cancer tissue, unacceptable false negatives and much work remaining {{S03-14-limits}}." });
      out.findings.push({ severity: "correction", title: "What can be quoted", text: "The study may be quoted as an in vitro proof of concept that an LED-based NIR sensor captured tumour-related variance in kidney samples {{S03-1-scope}}. The surgical scenario in S01 is an application concept, not validation {{S01-13-surgery-concept}}. Neither applies to a different sensor, organ or set-up without new data." });
      out.answer = "No. Quote the kidney study only as an in vitro proof of concept on kidney samples. Appropriate next steps are bench characterisation and an ex vivo study of your own sensor with histopathology as reference, validated patient by patient. Any use during live surgery needs clinical studies and regulatory approval, which are outside this assessment.";
      out.notRecommended.push({ method: "Use of the sensor for tumour-boundary decisions in live surgery", reason: "No in vivo data and no validation of your set-up; the study is an in vitro proof of concept that calls for further dedicated studies {{S03-1-scope}} {{S03-14-limits}}." });
    } },
  { id: "certainty-demand", when: f => f.certainty && (f.undefinedTarget || f.approve),
    apply: (f, out) => {
      out.findings.push({ severity: "caution", title: f.approve ? "Approval is asked before the facts allow it" : "An exact configuration is asked before the target is known", text: f.approve ? "An approval would need the fiber type, link length, routing and conditions; these are not supplied, and method selection depends on such factors {{S01-5-select}}." : "Selecting a method requires knowing the analytical problem {{S01-5-select}}; for samples of unknown composition several methods are tested first {{S01-3-unknown}}. An immediate exact configuration would rest on invented facts." });
    } },
  { id: "undefined-target", when: f => f.undefinedTarget && !f.biomass,
    apply: (f, out) => { out.status = maxStatus(out.status, "insufficient"); out.answer = "Do not choose a method yet. First define the liquid, the specification test that fails and the suspected contaminants, and collect retained in-spec, off-spec and spiked samples. A laboratory screen with several methods then shows whether off-spec liquid is spectrally distinct and which method sees it; only that result justifies a sensor configuration."; } },
  { id: "two-targets-undefined", when: f => f.bio && /not been defined as separate targets/.test(f.text),
    apply: (f, out) => {
      out.findings.push({ severity: "caution", title: "Define the targets first", text: "A biomass signal and a metabolic signal need different methods and references; NIR + fluorescence has been used for biomass and metabolites in yeast fermentation {{S01-7-synergy}}." });
      out.questions.unshift(Q("What exactly are the biomass target and the metabolic target, and which offline references exist for each?", "method", "Each target decides its own method and reference."));
      out.recs.forEach(r => { if (r.role === "primary") r.role = "comparison"; });
      out.recs.unshift(R("NIR + fluorescence", "primary", "NIR probe for scattering/biomass plus fluorescence probe for intrinsic fluorophores", "NIR combined with fluorescence gave more accurate biomass in yeast fermentation and separated intra- and extracellular metabolites {{S01-7-synergy}}; fluorescence follows fluorophores such as NADH {{S01-16-bio-fluo}}.", "Each signal needs its own defined target and reference; test single methods before fusion."));
      out.ranges.push(RANGE.Fluorescence);
    } },
];

const STATUS_ORDER = { provisional: 0, insufficient: 1, outside: 2 };
const STATUS_LABEL = { provisional: "Provisional assessment", insufficient: "Insufficient information", outside: "Outside the supported scope" };
function maxStatus(a, b) { return STATUS_ORDER[b] > STATUS_ORDER[a] ? b : a; }

// ------------------------------------------------------------------ assemble
function assess(enquiry, meta = {}) {
  const f = detect(enquiry);
  const base = MODULES[f.domain](f);
  const out = Object.assign({ findings: [], notRecommended: [], options: null, approval: null, reuse: null }, base);
  out.findings = out.findings || [];
  out.id = meta.id || "NEW"; out.title = meta.title || ""; out.enquiry = enquiry; out.domain = f.domain;
  const sentences = splitSentences(enquiry);
  out.facts = sentences.filter(s => !/\?$/.test(s));
  out.asks = sentences.filter(s => /\?$/.test(s));
  out.guardsFired = [];
  for (const g of GUARDS) if (g.when(f)) { g.apply(f, out); out.guardsFired.push(g.id); }
  // dedupe & order questions: method first
  const order = { method: 0, setup: 1, reference: 2, experiment: 2, acceptance: 3 };
  const seen = new Set();
  out.questions = out.questions.filter(q => !seen.has(q.q) && seen.add(q.q));
  out.questions = out.questions.map((q, i) => ({ ...q, _i: i })).sort((a, b) => (order[a.cat] - order[b.cat]) || a._i - b._i).map(({ _i, ...q }) => q);
  if (!out.questions.some(q => q.cat === "acceptance")) out.questions.push(Q("What accuracy, response time and acceptance limits would make the result useful?", "acceptance", "Needed for a go/no-go decision; none are assumed here."));
  out.assumptions = buildAssumptions(f, out);
  out.statusLabel = STATUS_LABEL[out.status];
  out.verdict = buildVerdict(f, out);
  out.matrix = buildMatrix(out);
  out.simplify = out.status === "outside" || f.domain === "tissue-lab" ? [] : buildSimplify(out);
  out.pathway = buildPathway(f, out);
  if (!out.answer) out.answer = defaultAnswer(out);
  out.verification = verify(out);
  return out;
}

function defaultAnswer(o) {
  const pri = o.recs.filter(r => r.role === "primary"), cmp = o.recs.filter(r => r.role === "comparison");
  if (!pri.length) return o.status === "insufficient" ? "A method cannot be justified yet; answer the clarification questions first." : "See the recommendation below.";
  const a = pri.map(r => `${r.method} with a ${r.geometry.replace(/^an? /, "")}`).join(" and ");
  const b = cmp.length ? `. Compare it against ${cmp.map(r => `${r.method} with a ${r.geometry.replace(/^an? /, "")}`).join(" and ")}` : "";
  return `Test ${a} first${b}, on representative samples with independent reference results. The decision follows client-agreed acceptance limits on independent material; nothing here is a final configuration.`;
}

function buildAssumptions(f, out) {
  const a = ["No measured spectra, concentrations or acceptance limits were supplied; none are assumed.", "Candidate methods come from the supplied application examples; a published example is a reason to test, not proof it will work here."];
  if (f.domain === "dairy" && f.twoStreams) a.push("'Relatively clear' whey may still vary in turbidity; this is checked, not assumed.");
  if (f.domain === "bioprocess") a.push("The probe can be installed through an existing port and sterilised; to be confirmed.");
  if (f.domain === "tissue-clinical") a.push("All proposed work is ex vivo laboratory work; no patient use.");
  if (f.domain === "petro-water") a.push("The 'other building' implies a long link; its length is unknown.");
  if (f.domain === "pharma-powder" && f.calReuse) a.push("The existing NIR hardware stays in place and can be reused for data collection.");
  return a;
}


// ------------------------------------------------------------------ in-line verdict, method matrix, path to a simple sensor
const IL = (method, probe, install, fiber, note) => ({ method, probe, install, fiber, note });
function buildVerdict(f, o) {
  const G = id => o.guardsFired.includes(id);
  switch (f.domain) {
    case "pharma-powder": if (f.coating) return {
      mode: "In-line", headline: "Test NIR in-line in the coater, with NIR + Raman as the combination to beat it",
      items: [IL("NIR", "Diffuse reflection probe facing the moving tablet bed", "Coater port or window, representative product flow", "Vis-NIR silica", "Coating calibration against an independent coating reference."), IL("Raman", "Non-contact Raman probe", "Same coater position", "Silica (metal-coated)", "Check fluorescence of the coating first {{S01-11-raman}}.")],
      testAgainst: "NIR + Raman fused model, reported best for pellet coating in a fluidized bed {{S01-7-synergy}}; adopt only if it beats NIR alone", blocker: null };
      return {
      mode: "In-line", headline: G("calibration-transfer") ? "Keep NIR in-line in the feed frame, with a new calibration for the new blend" : "Use NIR in-line in the feed frame",
      items: [IL("NIR", "Diffuse reflection probe", "Feed frame of the rotary tablet press, probe tip in the powder flow", "Vis-NIR silica", G("calibration-transfer") ? "Existing probe and spectrometer can stay; the model cannot." : "")],
      testAgainst: "Raman contact probe at the same feed-frame position; fuse NIR + Raman only if it beats NIR alone {{S01-14-pharma}} {{S01-7-synergy}}",
      blocker: null };
    case "dairy": return f.twoStreams ? {
      mode: "In-line", headline: "Use NIR in-line on both streams, with a different probe geometry per stream",
      items: [IL("NIR", "Transmission / transflection probe, defined path length", "Whey line, flush in a representative flowing section", "Vis-NIR silica", "Protein calibration for whey."), IL("NIR", "Diffuse reflection probe, flush-mounted", "Concentrate pipe or vat", "Vis-NIR silica", "Fat and protein calibrations for the concentrate.")],
      testAgainst: "One transflection probe on both streams, as a possible single interface {{S01-18-dairy-both}}", blocker: null } : {
      mode: "In-line", headline: (f.whey || f.clear) ? "Use NIR transmission/transflection in-line" + (f.turbid ? ", with reflection as the fallback for turbid conditions" : "") : "Use NIR diffuse reflection in-line",
      items: [(f.whey || f.clear) ? IL("NIR", "Transmission / transflection probe, defined path length", "In the line, representative flowing section", "Vis-NIR silica", "") : IL("NIR", "Diffuse reflection probe, flush-mounted", "Pipe or vat with flowing product", "Vis-NIR silica", "")],
      testAgainst: (f.whey || f.clear) ? "NIR diffuse reflection probe for turbid states {{S01-18-dairy-both}}" : "Transflection probe {{S01-18-dairy-both}}", blocker: null };
    case "bioprocess":
      if (G("fluorescence-without-target")) return {
        mode: "In-situ (in the bioreactor)", headline: "Use Raman in situ for glucose; fluorescence is not the method for these two variables",
        items: [IL("Raman", "Immersion Raman probe", "Bioreactor port, in situ", "Silica (metal-coated)", "Glucose; NIR as comparison."), IL("NIR or UV-Vis", "Transmission (low OD) or reflection/ATR (high OD) probe", "Bioreactor port, in situ", "Silica", "Total-biomass trend only; viable biomass needs a defined reference first.")],
        testAgainst: "Existing fluorometer as an indicator of a named fluorophore (e.g. NADH), not as a glucose or viability readout {{S01-16-bio-fluo}}",
        blocker: "No method can report viable biomass until a viability reference is defined." };
      if (G("two-targets-undefined")) return {
        mode: "In-situ (in the fermenter)", headline: "Use NIR + fluorescence in situ, once biomass and metabolic targets are defined",
        items: [IL("NIR", "Reflection or transflection probe", "Fermenter port, in situ", "Vis-NIR silica", "Biomass-related scattering."), IL("Fluorescence", "Fluorimetric probe", "Fermenter port, in situ", "UV-Vis silica", "Intrinsic fluorophores such as NADH.")],
        testAgainst: "Each method alone before fusion {{S01-7-synergy}}", blocker: "The two targets must be defined before a calibration." };
      if (G("raman-autofluorescence")) return { mode: "In-situ (in the bioreactor)", headline: "Test NIR in situ first; keep Raman only if the fluorescence background allows it",
        items: [IL("NIR", "Transflection or reflection probe", "Bioreactor port, in situ", "Vis-NIR silica", "Glucose and major components {{S01-16-bio-nir}}."), IL("Fluorescence", "Fluorimetric probe", "Same port", "UV-Vis silica", "Biomass together with NIR {{S01-7-synergy}}.")],
        testAgainst: "Raman on the same broth, after its fluorescence background is measured {{S01-11-raman}}", blocker: null };
      return { mode: "In-situ (in the bioreactor)", headline: "Use Raman in situ for the metabolites",
        items: [IL("Raman", "Immersion Raman probe", "Bioreactor port, in situ", "Silica (metal-coated)", "")], testAgainst: "NIR probe in the same reactor {{S01-16-bio-nir}}", blocker: null };
    case "petro-water": return {
      mode: "In-line", headline: G("fiber-range") ? "Use MIR ATR in-line, but not over the existing silica cable: put the FTIR near the line" : (/petroleum|crude|fuel oil|diesel\b/.test(f.text) && !/biodiesel/.test(f.text) ? "Use MIR ATR in-line for water in petroleum" : "Use MIR ATR in-line for water in the oil / ester stream"),
      items: [IL("MIR ATR", "ZrO₂ or diamond ATR immersion probe", "In the line or a bypass", "Short CIR or PIR mid-IR fiber", f.remote ? "Analyzer close to the line; results sent to the other building as data." : "")],
      testAgainst: f.remote ? "NIR transmission/transflection over a long silica link, if the analyzer must stay in the other building {{S02-7-silica-long}}" : "NIR transmission/transflection probe at the same point",
      blocker: G("fiber-range") ? "The silica cable cannot carry MIR, and the link length is unknown." : null };
    case "polymer-melt": return {
      mode: "In-line", headline: "Use NIR in-line at the extruder die",
      items: [IL("NIR", "High-temperature reflection probe", "Die / die adaptor of the extruder", "Metal-coated Vis-NIR silica", "")],
      testAgainst: "Diamond-cone MIR ATR probe on a die or barrel port {{S02-14-extrusion}}", blocker: null };
    case "tissue-lab": return {
      mode: "Laboratory study (in-line not requested)", headline: "Use one combined MIR ATR + fluorescence probe on the same spot",
      items: [IL("MIR ATR + fluorescence", "Combined ZrO₂ ATR / fluorescence probe head", "Bench, probe in contact with tissue", "CIR + UV-Vis silica", "")],
      testAgainst: "Each method alone at the same points {{S04-4-result}}", blocker: null };
    case "tissue-clinical": return {
      mode: "No clinical in-line use", headline: "Test NIR diffuse reflection ex vivo first; use during live surgery is outside this assessment",
      items: [IL("NIR (LED sensor)", "Diffuse reflection probe at controlled distance", "Laboratory bench, ex vivo tissue only", "Vis-NIR silica", "Research path, no patient use.")],
      testAgainst: "Full-spectrum NIR on the same sites; a multispectral probe as research option {{S04-4-result}}",
      blocker: "No in vivo data and no validation of the own set-up; clinical use requires clinical studies and approval." };
    case "undefined-liquid": return {
      mode: "Screen first, then in-line", headline: "No in-line method can be named yet: screen retained samples first",
      items: [IL("MIR ATR → NIR → Raman → UV-Vis / fluorescence", "Laboratory interfaces on retained samples", "Laboratory, before any installation", "Per method", "Screening order: selective methods first, sensitive methods if a trace contaminant is suspected.")],
      testAgainst: "All four on the same in-spec, off-spec and spiked samples {{S01-3-unknown}}",
      blocker: "Contaminant, quality variable and liquid are unknown." };
    default: return f.gas ? {
      mode: "Lab test first", headline: "Test mid-IR absorption with a mid-IR fiber first, in a laboratory gas test",
      items: [IL("MIR", "Gas-phase absorption interface (to be designed and tested)", "Laboratory first, then the duct", "PIR (3–17 µm) mid-IR fiber", "Gas bands lie at about 4–10 µm {{S02-17-gas}}.")],
      testAgainst: "NIR only if the target gas has usable bands inside the silica range {{S02-6-fibers}}", blocker: "Gas temperature, concentration range and optical access are not described." } : {
      mode: "Screen first", headline: "Test a multi-method laboratory screen first (NIR, MIR ATR, Raman, fluorescence), then choose the in-line method",
      items: [IL("NIR + MIR ATR + Raman + fluorescence (screen)", "Laboratory interfaces on representative samples", "Laboratory, before any installation", "Per method", "AFS pathway step 1 {{S05-pathway}}.")],
      testAgainst: "All methods on the same samples {{S01-3-unknown}}", blocker: "Material, target and process are not described." };
  }
}

const MATRIX_METHODS = ["NIR", "MIR ATR", "Raman", "Fluorescence", "UV-Vis"];
const ROLE_RANK = { primary: 4, comparison: 3, screening: 2, conditional: 2, combination: 1 };
function buildMatrix(o) {
  const has = (s, m) => m === "MIR ATR" ? /MIR ATR|MIR\b/i.test(s) : m === "UV-Vis" ? /UV-?Vis/i.test(s) : new RegExp(m, "i").test(s);
  return MATRIX_METHODS.map(m => {
    let best = null;
    for (const r of o.recs) if (has(r.method, m) && (!best || ROLE_RANK[r.role] > ROLE_RANK[best.role])) best = r;
    const rej = o.notRecommended.find(n => has(n.method, m) && !/^(Reusing|Use of)/.test(n.method));
    let verdict, why;
    if (best && best.role === "primary") { verdict = "use"; why = best.geometry; }
    else if (best && best.role === "comparison") { verdict = "test"; why = best.geometry; }
    else if (best) { verdict = "conditional"; why = plainTokens(best.conditions); }
    else { verdict = "no"; why = "No source-backed fit for this case"; }
    if (rej && verdict === "no") { verdict = "reject"; why = rej.method; }
    else if (rej && verdict !== "use") { verdict = "restricted"; why = `Not: ${rej.method.toLowerCase()}. ${why}`; }
    return { method: m, verdict, why, restriction: rej && verdict === "use" ? rej.method : null };
  });
}
function plainTokens(s) { return s.replace(TOKEN, "").replace(/\s+([.;,])/g, "$1").trim(); }

function buildSimplify(o) {
  const m = (o.verdict.items[0] || {}).method || "the selected method";
  return [
    { step: "Prove", text: `Full-spectrum ${m} test on the customer's samples and process states, against the independent reference {{S01-3-unknown}} {{S01-9-oms}}.` },
    { step: "Reduce", text: "Find the few informative bands with chemometrics; non-informative regions add noise {{S03-2-fewwl}} {{S01-9-oms}}." },
    { step: "Simplify", text: "Build a dedicated in-line sensor on those bands (LEDs/filters) or keep a multiplexed analyzer with fibers to several points {{S01-9-oms}} {{S02-18-bands}}." },
    { step: "Validate", text: "Re-validate the simplified sensor against the full-spectrum result and the reference before it controls the process." },
  ];
}


// ------------------------------------------------------------------ AFS pathway (S05 / S02 p.20): lab test -> key features -> path A/B/C
const PATHS = {
  A: { name: "Path A · AI chemometric model", what: "A calibration model that turns the spectra of one in-line method into real-time composition values." },
  B: { name: "Path B · Customised MSF system", what: "A tailored set of spectrometers and fiber probes for the customer's own R&D, when several methods must keep being compared." },
  C: { name: "Path C · Spectral fiber sensor (SFS)", what: "A dedicated in-line sensor on a few selected wavelengths, for a specific process point, with remote/cloud read-out." },
};
function buildPathway(f, o) {
  const lab = o.matrix.filter(m => ["use", "test", "conditional", "restricted"].includes(m.verdict)).sort((a, b) => ["use", "test", "conditional", "restricted"].indexOf(a.verdict) - ["use", "test", "conditional", "restricted"].indexOf(b.verdict)).map(m => `${m.method} (${{ use: "main", test: "compare", conditional: "only if needed", restricted: "restricted" }[m.verdict]})`);
  const G = id => o.guardsFired.includes(id);
  let features, path, why, later = null, laterWhy = "";
  switch (f.domain) {
    case "pharma-powder":
      features = "NIR bands of the API against the excipients (API/moisture/polymer region 1.3–2.2 µm) {{S02-18-bands}}; Raman backbone bands of the API {{S01-14-pharma}}.";
      path = "A"; why = G("calibration-transfer") ? "The NIR hardware is already in the feed frame; what is missing is a new model for the new blend." : "A full NIR (and possibly Raman) spectrometer with a PLS model is the established feed-frame set-up {{S01-14-pharma}}."; break;
    case "dairy":
      features = "Fat, protein and moisture bands (0.85–1.1 µm and the wider NIR) {{S02-18-bands}}; scatter effects removed by SNV/MSC {{S01-17-dairy-refl}}.";
      path = "A"; why = "One NIR spectrometer serves both reflection and transmission probes {{S01-18-dairy-both}}; the models are the deliverable.";
      later = "C"; laterWhy = "Once the bands are known, a few-wavelength sensor is plausible: an RGB/LED sensor for fat and protein in milk is a documented example {{S01-9-led-examples}}."; break;
    case "bioprocess":
      if (G("two-targets-undefined")) { features = "NIR scattering for biomass and intrinsic fluorophores (NADH, tryptophan, riboflavin) for metabolic state {{S01-7-synergy}} {{S01-16-bio-fluo}}."; path = "B"; why = "Two methods and two still-undefined targets: the comparison work continues in the customer's lab."; break; }
      features = "Raman bands of glucose/lactate from reference spectra of the pure compounds {{S01-16-bio-raman}}" + (G("fluorescence-without-target") ? "; fluorescence only at the excitation/emission of a named fluorophore {{S01-16-bio-fluo}}." : ".");
      path = "A"; why = "A Raman (or NIR) model calibrated against the offline assays is what turns the in-situ spectra into concentrations {{S01-16-bio-raman}}."; break;
    case "petro-water":
      features = "MIR water window 4000–2000 cm⁻¹ seen in the ATR spectra {{S02-13-petro}}; NIR moisture bands 1.3–1.7 / 1.5–2.0 µm for the NIR option {{S02-18-bands}}.";
      path = "A"; why = "A water model on MIR ATR spectra against the laboratory reference.";
      later = "C"; laterWhy = "If the NIR option reaches the required accuracy, a few-wavelength NIR moisture sensor over silica fiber fits a remote point; an NIR-LED moisture sensor is shown for other materials {{S02-12-moisture}}."; break;
    case "polymer-melt":
      features = "API and polymer bands in the NIR (1.3–2.2 µm) {{S02-18-bands}} and in the MIR fingerprint region {{S02-14-extrusion}}.";
      path = "A"; why = "The extrusion examples use a full NIR or FTIR spectrometer with a model for feed-forward control {{S02-14-extrusion}}."; break;
    case "tissue-lab":
      features = "Ester carbonyl near 1740 cm⁻¹ (IR) and porphyrin emission at 613 nm (fluorescence) separated the model tissues {{S02-15-combi}}.";
      path = "B"; why = "A laboratory classification study comparing two methods at the same spot is what an MSF system is for {{S04-1-probe}}."; break;
    case "tissue-clinical":
      features = "LED wavelengths in 900–1500 nm must be re-selected for the target tissue {{S03-2-aim}} {{S03-14-limits}}.";
      path = "B"; why = "Research only: ex vivo comparison of NIR and multispectral options. The sources show only an in vitro proof of concept {{S03-1-scope}} {{S03-14-limits}}."; break;
    case "undefined-liquid":
      features = "Unknown until step 1 shows where off-spec samples differ from in-spec samples.";
      path = null; why = "The path cannot be chosen before the lab test finds a measurable difference {{S01-3-unknown}}."; break;
    default: features = "Unknown."; path = null; why = "Not enough information.";
  }
  return { step1: lab, features, path, why, later, laterWhy };
}

// ------------------------------------------------------------------ verifier
const TOKEN = /\{\{([A-Za-z0-9\-]+)\}\}/g;
function walkStrings(o, fn, path = "") {
  if (typeof o === "string") return fn(o, path);
  if (Array.isArray(o)) return o.forEach((v, i) => walkStrings(v, fn, path + "[" + i + "]"));
  if (o && typeof o === "object") for (const k in o) if (!["verification", "enquiry", "facts", "asks", "guardsFired", "domain", "id", "title"].includes(k)) walkStrings(o[k], fn, path + "." + k);
}
function numbersIn(s) { return (s.replace(TOKEN, "").replace(/\b[SDH]0\d\b/g, "").replace(/\bp\.\s?\d+(–\d+)?/g, "").match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(",", ".")); }

function verify(out) {
  const v = { citations: { total: 0, unknown: [], bySource: {} }, numbers: { unsupported: [] }, fiber: [], scope: [], ok: true, warnings: [] };
  const used = new Set();
  walkStrings(out, s => { let m; TOKEN.lastIndex = 0; while ((m = TOKEN.exec(s))) { v.citations.total++; if (!CLAIMS[m[1]]) v.citations.unknown.push(m[1]); else used.add(m[1]); } });
  for (const id of used) { const c = CLAIMS[id]; v.citations.bySource[c.src] = (v.citations.bySource[c.src] || 0) + 1; }
  // numbers: every number must appear in the enquiry or in a KB claim
  const allowed = new Set(numbersIn(out.enquiry));
  for (const id in CLAIMS) numbersIn(CLAIMS[id].text).forEach(n => allowed.add(n));
  ["0", "1", "2", "3"].forEach(n => allowed.add(n)); // small counts / option letters
  walkStrings(out, (s, p) => numbersIn(s).forEach(n => { if (!allowed.has(n)) v.numbers.unsupported.push({ n, where: p }); }));
  // fiber/range compatibility for every concept line
  for (const c of out.concept || []) {
    const need = METHOD_RANGE[c.method] && METHOD_RANGE[c.method].nm;
    const fams = c.fiberFamily ? [c.fiberFamily] : (FIBER_FAMILY[c.method] || []);
    if (!need || !fams.length) { v.fiber.push({ label: c.label, method: c.method, result: "n/a", note: "Range depends on excitation/target; check with AFS." }); continue; }
    for (const fam of fams) {
      const fr = FIBERS[fam]; const lo = Math.max(need[0], fr[0]), hi = Math.min(need[1], fr[1]);
      const cover = hi > lo ? (hi - lo) / (need[1] - need[0]) : 0;
      const result = cover === 0 ? "incompatible" : cover >= 0.95 ? "covers nominal range" : "partial";
      v.fiber.push({ label: c.label, method: c.method, fiber: fam, result, note: `method ${fmt(need)} vs fiber ${fmt(fr)}` + (cover > 0 && cover < 0.95 ? ` (overlap ${fmt([lo, hi])})` : ""), proposed: !!c.proposed });
      if (result === "incompatible" && !c.proposed) v.ok = false;
      if (c.band) { const b = c.band.nm, l2 = Math.max(b[0], fr[0]), h2 = Math.min(b[1], fr[1]); const cv = h2 > l2 ? (h2 - l2) / (b[1] - b[0]) : 0;
        v.fiber.push({ label: c.label, method: c.method + " · application band", fiber: fam, result: cv === 0 ? "incompatible" : cv >= 0.99 ? "covers band" : "partial", note: `${c.band.label}: ${fmt(b)} vs fiber ${fmt(fr)}` + (cv > 0 && cv < 0.99 ? ` (overlap ${fmt([l2, h2])})` : ""), proposed: !!c.proposed }); }
    }
  }
  // scope: research / business sources must not back a primary recommendation
  for (const r of out.recs || []) {
    const ids = [...(r.reason + " " + r.conditions).matchAll(TOKEN)].map(m => m[1]).filter(id => CLAIMS[id]);
    for (const id of ids) {
      const sc = CLAIMS[id].scope;
      if (sc === "business") v.scope.push(`${r.method}: cites business material ${CLAIMS[id].src} as evidence`);
      if (sc === "clinical-research" && r.role === "primary") v.scope.push(`${r.method}: primary recommendation rests on research-stage evidence`);
      if (sc === "general" && r.role === "primary") v.scope.push(`${r.method}: primary recommendation rests on non-source knowledge`);
    }
  }
  const genUsed = [...used].filter(id => CLAIMS[id].scope === "general");
  if (genUsed.length) v.warnings.push(`${genUsed.length} statement(s) use general spectroscopy knowledge not found in the AFS sources (marked GEN); an expert should confirm them.`);
  if (v.citations.unknown.length || v.numbers.unsupported.length || v.scope.length) v.ok = false;
  return v;
}
function fmt(r) { const u = x => x >= 2500 ? (x / 1000).toString() + " µm" : x + " nm"; return r[0] >= 2500 ? `${r[0] / 1000}–${r[1] / 1000} µm` : r[1] >= 2500 ? `${r[0]} nm–${r[1] / 1000} µm` : `${r[0]}–${r[1]} nm`; }

// ------------------------------------------------------------------ rendering helpers
function citeText(id) { const c = CLAIMS[id]; if (!c) return "?" + id; return c.src === "GEN" ? "general knowledge" : c.src === "REF" ? "REF §5" : id === "S01-T1" ? "S01 Table 1 (p.6)" : `${c.src} p.${c.page}`; }
function citeLabel(id) { return "[" + citeText(id) + "]"; }
const RUN = /(?:\{\{[A-Za-z0-9\-]+\}\}\s*)+/g;
function citeGroups(s, fn) { return s.replace(RUN, run => { const ids = [...new Set([...run.matchAll(TOKEN)].map(m => m[1]))]; const tail = /\s$/.test(run) ? " " : ""; return fn(ids) + tail; }); }
function plain(s) { return citeGroups(s, ids => "[" + [...new Set(ids.map(citeText))].join("; ") + "]"); }
function sourcesUsed(out) {
  const ids = new Set(); walkStrings(out, s => { let m; TOKEN.lastIndex = 0; while ((m = TOKEN.exec(s))) if (CLAIMS[m[1]]) ids.add(m[1]); });
  const key = c => c.src + String(parseInt(c.page) || 0).padStart(4, "0") + c.id; return [...ids].map(id => CLAIMS[id]).sort((a, b) => key(a).localeCompare(key(b)));
}

function toMarkdown(o) {
  const L = [];
  const P = s => plain(s);
  L.push(`## ${o.id}${o.title ? " · " + o.title : ""}`, "");
  L.push(`> **Enquiry.** ${o.enquiry}`, "");
  const vd = o.verdict;
  L.push(`### Recommended in-line method · ${vd.mode}`, `**${P(vd.headline)}**`, "");
  vd.items.forEach(i => L.push(`- **${i.method}** · ${i.probe} · ${i.install} · fiber: ${i.fiber}${i.note ? " — " + i.note : ""}`));
  if (vd.testAgainst) L.push(`- Test against: ${P(vd.testAgainst)}`);
  if (vd.blocker) L.push(`- Not final because: ${vd.blocker}`);
  L.push("", "| Method | Verdict | Basis |", "|---|---|---|");
  const VL = { use: "Use", test: "Test alongside", conditional: "Only if…", restricted: "Restricted", no: "Not indicated", reject: "Not suitable" };
  o.matrix.forEach(r => L.push(`| ${r.method} | ${VL[r.verdict]}${r.restriction ? " (not: " + r.restriction + ")" : ""} | ${r.why} |`));
  L.push("");
  const pw = o.pathway;
  L.push("**AFS pathway**", `1. Multi-method lab test: ${pw.step1.join(", ") || "—"}`, `2. Key spectral features: ${P(pw.features)}`, `3. Tailored solution: ${pw.path ? PATHS[pw.path].name : "not yet"} — ${P(pw.why)}${pw.later ? ` Later: ${PATHS[pw.later].name} — ${P(pw.laterWhy)}` : ""}`, "");
  L.push(`**Short answer.** ${P(o.answer)}`, "");
  L.push(`**Decision status: ${o.statusLabel}.** ${P(o.statusWhy)}`, "");
  if (o.approval) L.push(`**Concept as proposed: ${o.approval.decision}.** ${o.approval.reason}`, "");
  const SEV = { blocker: "Won't work", correction: "Wrong assumption", caution: "Check first" };
  if (o.findings.length) { L.push("### Problems with the request"); o.findings.forEach(x => L.push(`- **${SEV[x.severity]} · ${x.title}.** ${P(x.text)}`)); L.push(""); }
  L.push("### Requirements stated by the client"); o.facts.forEach(x => L.push(`- ${x}`)); L.push("");
  L.push("### Key unknowns"); o.unknowns.forEach(x => L.push(`- **${x.item}** — ${P(x.why)}`)); L.push("");
  L.push("### Clarification questions (method-changing first)"); o.questions.forEach((x, i) => L.push(`${i + 1}. *(${x.cat})* ${P(x.q)} — _${P(x.why)}_`)); L.push("");
  L.push("### Recommendation");
  o.recs.forEach(r => L.push(`- **${r.method}** — ${r.role}; ${r.geometry}. ${P(r.reason)} _Condition:_ ${P(r.conditions)}`));
  if (o.notRecommended.length) { L.push("", "**Not recommended / not supported**"); o.notRecommended.forEach(r => L.push(`- ${r.method}: ${P(r.reason)}`)); }
  if (o.options) { L.push("", "**Options for the link**"); o.options.forEach(x => L.push(`- **${x.name}.** ${P(x.text)}`)); }
  if (o.reuse) { L.push("", "**What can be reused from the existing pilot**"); o.reuse.forEach(x => L.push(`- ${x}`)); }
  L.push("", "### Measurement concept");
  o.concept.forEach(c => L.push(`- **${c.label}** (${c.method}): ${c.geometry}; ${c.location}; fiber: ${P(c.fiber)}${c.proposed ? " — *client proposal, see verification*" : ""}`));
  L.push("_Probe type, installation and fiber link need AFS confirmation._", "");
  L.push("### Spectral range"); o.ranges.forEach(r => L.push(`- **${r.method}:** ${P(r.text)}`)); L.push("");
  L.push("### Risks and uncertainty"); o.risks.forEach(r => L.push(`- ${P(r.risk)} → ${P(r.mitigation)}`)); L.push("");
  L.push("### Assumptions"); o.assumptions.forEach(x => L.push(`- ${x}`)); L.push("");
  const p = o.plan; L.push("### First feasibility experiment", `**Objective.** ${P(p.objective)}`, "");
  L.push("**Samples / process states:** " + p.samples.map(P).join("; ") + ".");
  L.push("**Independent references:** " + p.references.map(P).join("; ") + ".");
  L.push("**Compared:** " + p.comparisons.map(P).join("; ") + ".", "");
  p.steps.forEach((s, i) => L.push(`${i + 1}. ${P(s)}`));
  L.push("", `**Go / no-go basis.** ${P(p.decision)}`, "");
  if (o.demonstrates.shows.length) { L.push("**What the result would show:** " + o.demonstrates.shows.join("; ") + ".", "**What it would not show:** " + o.demonstrates.notShown.join("; ") + ".", ""); }
  const v = o.verification;
  L.push("### Verification (automatic)");
  L.push(`- Citations: ${v.citations.total} resolved to source pages; unknown: ${v.citations.unknown.length ? v.citations.unknown.join(", ") : "none"}`);
  L.push(`- Numbers not found in the enquiry or sources: ${v.numbers.unsupported.length ? v.numbers.unsupported.map(x => x.n).join(", ") : "none"}`);
  v.fiber.forEach(x => L.push(`- Fiber check · ${x.label} · ${x.method}${x.fiber ? " over " + x.fiber : ""}: **${x.result}** (${x.note})`));
  L.push(`- Scope check: ${v.scope.length ? v.scope.join("; ") : "no business or research-stage source backs a primary recommendation"}`);
  v.warnings.forEach(w => L.push(`- Note: ${w}`));
  L.push("", "### Sources");
  sourcesUsed(o).forEach(c => L.push(`- ${citeLabel(c.id)} ${c.text}`));
  L.push("", "---", "");
  return L.join("\n");
}

const API = { PATHS, citeText, citeGroups, detect, assess, verify, toMarkdown, plain, citeLabel, sourcesUsed, STATUS_LABEL, MODULES, GUARDS };
root.AFS_ENGINE = API;
if (typeof module !== "undefined") module.exports = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
