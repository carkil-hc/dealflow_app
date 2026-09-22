// Show the refined KOL ranking (leadership-weighted). Run: npx tsx academics-test.ts
import { collectAcademics } from './connectors/academics.js';

const kols = await collectAcademics("Parkinson's disease", 12);
console.log('rank  lead/total  country  name  —  institution');
kols.forEach((k, i) => console.log(
  `${String(i + 1).padStart(2)}   ${k.leadWorks}/${k.recentWorks}\t${k.country ?? '--'}\t${k.name}${k.orcid ? '  (' + k.orcid + ')' : ''}  —  ${k.institution ?? ''}`,
));
const known = /Parmar|Studer|Barker|Takahashi|Kirkeby|Bj[oö]rklund|Kordower|Lindvall/i;
console.log('\nknown leaders surfaced:', kols.filter(k => known.test(k.name)).map(k => k.name));
