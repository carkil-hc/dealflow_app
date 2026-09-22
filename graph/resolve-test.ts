// Validate the resolvers against known inputs. Run: npx tsx resolve-test.ts
import { resolveDisease, resolveTarget, resolveDrug, resolveCompany, resolvePerson } from './resolvers.js';

const out: Record<string, unknown> = {};
out.disease_parkinson = await resolveDisease("Parkinson's disease");           // expect MONDO_0005180
out.target_SNCA = await resolveTarget('SNCA');                                 // expect ENSG… / symbol SNCA (alpha-synuclein, PD)
out.drug_levodopa = await resolveDrug('levodopa');                             // expect a CHEMBL id
out.drug_bemdaneprocel = await resolveDrug('bemdaneprocel');                   // expect null -> quarantine (cell therapy)
out.company_xellsmart = resolveCompany('XellSmart Bio-Pharmaceutical (Suzhou) Co., Ltd.');
out.company_bluerock1 = resolveCompany('BlueRock Therapeutics');
out.company_bluerock2 = resolveCompany('BlueRock Therapeutics, Inc.');         // must equal bluerock1 (dedupe)
out.person_parmar = await resolvePerson('Malin Parmar', { institution: 'Lund', country: 'SE' }); // expect ORCID 0000-0001-5002-4199
out.person_barker = await resolvePerson('Roger Barker', { institution: 'Cambridge', country: 'GB' });

console.log(JSON.stringify(out, null, 2));
console.log('\nchecks:',
  JSON.stringify({
    disease_ok: out.disease_parkinson && (out as any).disease_parkinson.canonicalId === 'MONDO_0005180',
    bemdaneprocel_quarantined: (out as any).drug_bemdaneprocel.canonicalId === null,
    bluerock_dedupe: (out as any).company_bluerock1.canonicalId === (out as any).company_bluerock2.canonicalId,
  }));
