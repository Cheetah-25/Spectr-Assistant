require('../kb.js'); const E=require('../engine.js'); let S=require('../scenarios_dev.js');
try { S = S.concat(require('../final_scenarios.js').finalScenarios()); } catch (e) { console.log('(final-evaluation file not given: checking D01-D08 only)'); }
const ids=process.argv.slice(2); const fs=require('fs');
let md=''; const all=[];
for(const s of S){ if(ids.length && !ids.includes(s.id)) continue; const o=E.assess(s.enquiry,s); all.push(o); md+=E.toMarkdown(o);
 const v=o.verification; console.log(s.id,o.domain,o.status,'guards:',o.guardsFired.join(','),'| cites',v.citations.total,'unk',v.citations.unknown.length,'nums',JSON.stringify(v.numbers.unsupported.map(x=>x.n+'@'+x.where)),'scope',v.scope.length,'ok',v.ok);}

