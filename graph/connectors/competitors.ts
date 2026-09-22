// Competitor connector: the validated recipe — several ClinicalTrials.gov queries
// merged/deduped by NCT, then classified by modality. Emits normalised program
// records for the loader (which resolves + upserts). Open data only.
import { getJson } from '../http.js';

const PLURI = /iPSC|ipsc|pluripotent|embryonic|ESC\b|dopaminerg|progenitor|DA01|bemdaneprocel|neuron|stem[- ]cell derived/i;
const MSC = /mesenchymal|\bMSC\b|adipose|SVF|bone marrow|umbilical|Wharton/i;

export interface ProgramRecord {
  nct: string;
  title: string;
  phase: string[];
  status: string;
  sponsor: string;
  interventions: string;
  discontinued: boolean;
}

async function ctgov(condition: string, intr: string): Promise<ProgramRecord[]> {
  const out: ProgramRecord[] = [];
  let token: string | undefined; let pages = 0;
  do {
    const url = 'https://clinicaltrials.gov/api/v2/studies'
      + '?query.cond=' + encodeURIComponent(condition)
      + '&query.intr=' + encodeURIComponent(intr)
      + '&pageSize=200' + (token ? '&pageToken=' + token : '')
      + '&fields=' + encodeURIComponent('NCTId,BriefTitle,Phase,OverallStatus,LeadSponsorName,InterventionName,InterventionType');
    const data = await getJson(url);
    for (const s of (data.studies ?? [])) {
      const p = s.protocolSection ?? {};
      const status = p.statusModule?.overallStatus ?? '';
      out.push({
        nct: p.identificationModule?.nctId,
        title: p.identificationModule?.briefTitle ?? '',
        phase: p.designModule?.phases ?? [],
        status,
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? '',
        interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: any) => `${i.type}:${i.name}`).join(' | '),
        discontinued: /TERMINATED|WITHDRAWN|SUSPENDED/i.test(status),
      });
    }
    token = data.nextPageToken; pages++;
  } while (token && pages < 5);
  return out;
}

// Returns the cell/dopaminergic-neuron programs (the modality relevant to a
// stem-cell dealflow company), deduped, capped.
export async function collectCompetitors(condition = 'Parkinson Disease', cap = 30): Promise<ProgramRecord[]> {
  const queries = ['stem cell', 'dopaminergic', 'pluripotent', 'progenitor cell', 'cell transplantation', 'neuron'];
  const byNct = new Map<string, ProgramRecord>();
  for (const q of queries) for (const p of await ctgov(condition, q)) if (p.nct && !byNct.has(p.nct)) byNct.set(p.nct, p);
  const pluri = [...byNct.values()].filter(p => { const h = `${p.title} ${p.interventions}`; return PLURI.test(h) && !MSC.test(h); });
  return pluri.slice(0, cap);
}
