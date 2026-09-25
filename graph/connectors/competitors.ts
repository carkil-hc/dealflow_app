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

// Competitor programs for a disease. When cellTherapy is set, restrict to
// cell/dopaminergic-neuron programs (the modality relevant to a stem-cell
// company); otherwise return all deduped programs for the condition.
export async function collectCompetitors(condition: string, opts: { cellTherapy?: boolean; cap?: number } = {}): Promise<ProgramRecord[]> {
  const cap = opts.cap ?? 30;
  const queries = opts.cellTherapy
    ? ['stem cell', 'dopaminergic', 'pluripotent', 'progenitor cell', 'cell transplantation', 'neuron']
    : ['']; // empty intervention term = all interventions for the condition
  const byNct = new Map<string, ProgramRecord>();
  for (const q of queries) for (const p of await ctgov(condition, q)) if (p.nct && !byNct.has(p.nct)) byNct.set(p.nct, p);
  let list = [...byNct.values()];
  if (opts.cellTherapy) list = list.filter(p => { const h = `${p.title} ${p.interventions}`; return PLURI.test(h) && !MSC.test(h); });
  return list.slice(0, cap);
}
