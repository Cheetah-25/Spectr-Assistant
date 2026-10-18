# Synthetic 30-page customer project document for testing long-document mode. NOT a real client document.
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table
from reportlab.lib.styles import getSampleStyleSheet
st = getSampleStyleSheet(); B = st["BodyText"]; H = st["Heading2"]; T = st["Title"]
S = []
def page(title, paras):
    S.append(Paragraph(title, H)); [S.append(Paragraph(p, B)) or S.append(Spacer(1, 6)) for p in paras]; S.append(PageBreak())
S += [Paragraph("Project Specification PS-2026-114: In-line Composition Monitoring of the Biodiesel Transesterification Line", T),
      Paragraph("SYNTHETIC TEST DOCUMENT - written to test the assessor; not a real client document. Revision C, 30 pages.", B), PageBreak()]
page("1 Executive summary", ["GreenFuel Demo Plant (fictitious) operates a continuous transesterification line converting rapeseed oil with methanol and a potassium hydroxide catalyst into fatty acid methyl esters (FAME).",
  "Today, ester content, residual methanol and water are measured off-line in the plant laboratory every 4 hours. Off-spec product is detected late and recycled, which costs throughput.",
  "This project seeks an in-line spectroscopic measurement after the second reactor and after the wash column, so that the methanol dosing and the drying step can be controlled in real time.",
  "The project team has budget approval for a pilot in 2027. This document collects the process data, constraints and expectations for a first feasibility discussion with spectroscopy suppliers."])
page("2 Process description", ["Rapeseed oil and methanol (molar ratio 6:1) are fed to reactor R-201 at 60 to 65 °C and 3 barg. The reaction mixture passes reactor R-202 and a settler, where glycerol is separated.",
  "The ester phase is washed with water in column C-301 and dried in a vacuum dryer D-401 at 90 °C and 150 mbar. The final product is stored in tank T-501.",
  "Throughput is 12 m³/h. The process runs continuously with a planned shutdown every 6 months. Product changeovers between rapeseed and used cooking oil feedstock occur about twice per month.",
  "The ester phase after R-202 is a clear to slightly hazy yellow liquid; after the wash column it can be turbid because of entrained water droplets until it passes the dryer."])
page("3 Measurement points", ["MP-1: outlet of reactor R-202, line DN80, stainless steel 1.4571, 60 to 65 °C, 3 barg, flow 12 m³/h. Target: methyl ester content and residual triglycerides as conversion indicators.",
  "MP-2: outlet of the wash column C-301, line DN50, 40 to 50 °C, 2 barg. Target: residual methanol 0.1 to 0.5 wt% and water 500 to 2000 ppm before drying.",
  "MP-3: outlet of dryer D-401, line DN50, 80 to 90 °C, 1.5 barg. Target: water 200 to 500 ppm (specification limit 500 ppm according to EN 14214).",
  "All measurement points are inside an ATEX Zone 1 area because of methanol vapour. Any probe and housing at the line must be certified for Zone 1."])
page("4 Measurement targets and ranges", ["Methyl ester content: 96.5 to 99.5 wt% (specification minimum 96.5 wt%). Desired resolution 0.2 wt%.",
  "Residual methanol: 0.05 to 0.5 wt% at MP-2. Specification after drying: maximum 0.2 wt%.",
  "Water: 200 to 2000 ppm depending on the point. Specification limit 500 ppm in the final product.",
  "Free and total glycerol are of interest but secondary; the laboratory determines them by gas chromatography."])
page("5 Existing equipment and infrastructure", ["The plant laboratory has an FTIR spectrometer with a diamond ATR accessory, used for incoming oil checks. It is not process-rated.",
  "An analyzer house with purge and climate control exists 60 m from MP-1 and 45 m from MP-2 and MP-3, outside the Zone 1 area. The site prefers all spectrometers in this analyzer house.",
  "Existing cable trays between the line and the analyzer house can carry fiber cables. There is currently no fiber installed.",
  "The control system is a DCS with 4-20 mA and Modbus TCP inputs. A new analyzer must deliver values to the DCS."])
page("6 Reference analysis", ["Ester content is determined by gas chromatography according to EN 14103. Methanol by headspace GC according to EN 14110. Water by coulometric Karl Fischer titration according to EN ISO 12937.",
  "Laboratory turnaround is 2 hours. About 6 samples per day are analysed for each measurement point.",
  "Retained samples from the last 18 months exist for MP-3 only (about 900 samples), stored at room temperature in closed glass bottles."])
page("7 Requirements for the in-line measurement", ["Response time: a new value at least every 2 minutes at each measurement point.",
  "Accuracy expectation: ester content within 0.3 wt%, methanol within 0.05 wt%, water within 50 ppm compared with the laboratory reference.",
  "The supplier is asked to state whether one multiplexed spectrometer can serve all three points.",
  "Probes must withstand cleaning with hot water at 80 °C during shutdowns. No CIP chemicals are used.",
  "Wetted materials must be compatible with methanol, KOH traces and glycerol."])
page("8 Questions to the supplier", ["Which spectroscopic method is recommended for each measurement point, and why?",
  "Can the spectrometer be placed in the analyzer house 45 to 60 m away, and which fiber type would be needed?",
  "Can the turbid stream at MP-2 be measured reliably, and which probe geometry is suitable?",
  "What feasibility tests are proposed before the pilot, and which samples are needed?"])
# realistic noise: project management pages
import random; random.seed(3)
for i in range(9, 30):
    kind = ["Project organisation", "Schedule and milestones", "Budget frame", "Risk register", "Meeting minutes", "Safety and permits", "Glossary", "Document history"][i % 8]
    paras = {
      "Project organisation": ["The steering committee meets monthly. The project lead is the process engineering department; the laboratory and the instrumentation team are members.", "Purchasing will run a supplier selection after the feasibility phase. Communication with suppliers goes through the project lead."],
      "Schedule and milestones": [f"Milestone M{i}: feasibility report due in week {10+i} of 2027.", "Pilot installation is planned during the shutdown in autumn 2027. Commissioning should be finished within 4 weeks after the shutdown."],
      "Budget frame": ["The approved budget covers the pilot for one measurement point. Extension to the other points depends on the pilot result.", "Costs for laboratory reference analyses during the pilot are covered by the laboratory budget."],
      "Risk register": [f"Risk R{i}: delayed delivery of certified housings. Mitigation: early order after feasibility.", "Risk: fouling of optical windows by glycerol deposits at MP-1. Mitigation: to be discussed with the supplier."],
      "Meeting minutes": [f"Minutes of meeting {i}: the team discussed the analyzer house location and confirmed that line-mounted spectrometers would require Zone 1 certified housings.", "Action: the laboratory provides a list of retained samples with reference values."],
      "Safety and permits": ["Work in Zone 1 requires a hot-work permit and gas measurement. All equipment must carry ATEX marking.", "Fiber cables are passive and are accepted by the site safety team for Zone 1 routing."],
      "Glossary": ["FAME: fatty acid methyl ester. KF: Karl Fischer titration. DCS: distributed control system. MP: measurement point.", "EN 14214: European standard for biodiesel quality."],
      "Document history": [f"Revision {chr(65 + i % 3)} reviewed by the instrumentation team.", "Changes: added MP-3 and updated water limits."] }[kind]
    page(f"{i} {kind}", paras + ["This section is part of the project documentation and repeats information from the project plan where needed for completeness of the specification."] * 3)
SimpleDocTemplate("PS-2026-114_biodiesel_project_SYNTHETIC.pdf", pagesize=A4).build(S)
