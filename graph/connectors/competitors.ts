// Competitor connector: the validated recipe — several ClinicalTrials.gov queries
// merged/deduped by NCT, then classified by modality. Emits normalised program
// records for the loader (which resolves + upserts). Open data only.
import { getJson } from '../http.js';

// ── Modality classification ──────────────────────────────────────────────────
// Keyword scanning alone can't classify coined biologic names (bemdaneprocel,
// MSK-DA01) and over-matches drug studies (any trial mentioning "dopaminergic").
// So the signal is the ClinicalTrials.gov InterventionType (Biological/Genetic)
// combined with cell/regenerative terms, and negative filters that reject
// small-molecule standard-of-care and device/neuromodulation trials.
const CELL   = /\bcell\b|\bstem\b|ipsc|hipsc|pluripotent|embryonic|\besc\b|progenitor|precursor|dopaminergic (neuron|progenitor|cell)|midbrain dopamine|\bneuron\b|transplant|\bimplant|\bgraft|bemdaneprocel|da01|dap001|a9-dpc|ncr201|stem-pd|mesencephalic/i;
const MSC    = /mesenchymal|\bmsc\b|adipose|\bsvf\b|bone marrow|umbilical|wharton/i;
const GENE   = /\bgene therapy\b|\baav\b|lentivir|\bvector\b|gene transfer/i;
const DRUG   = /levodopa|carbidopa|madopar|apomorphine|rasagiline|cabergoline|pimavanserin|entacapone|lecig|amantadine|opicapone|safinamide|ropinirole|pramipexole|rotigotine|agonist|monotherapy|placebo|tablet|capsule|\bgel\b|\bdrug:/i;
const DEVICE = /stimulation|deep brain|\bdbs\b|\btms\b|\btdcs\b|magnetic|electrode|\bdevice:|sleep latency|questionnaire|\bscale\b|\bpet\b|\bmri\b|\bfdopa\b|imaging|acquisition|\bprocedure:.*(scan|imaging)/i;
// Observational / biomarker studies. ClinicalTrials.gov types blood draws,
// biopsies and sequencing as "Biological" too, so intervention type alone can't
// mean cell therapy — these are excluded before the cell test.
const OBS = /biops|blood sampl|\bdna\b|genome sequenc|whole genome|recognition test|\bretinal\b|laryng|natural history|\bregistry\b|observation|biomarker|questionnaire/i;

export interface Modality { modality: string; isCellTherapy: boolean; }

// Pure, deterministic — safe to re-run at load time over staged records.
// A program is a cell/regenerative therapy only when a cell/gene keyword is
// present; a "Biological" intervention type is necessary but not sufficient.
export function classifyProgram(p: { title: string; interventions: string }): Modality {
  const text = `${p.title} ${p.interventions}`;
  if (DRUG.test(text)) return { modality: 'small molecule / SoC', isCellTherapy: false };
  if (DEVICE.test(text)) return { modality: 'device / neuromodulation', isCellTherapy: false };
  if (OBS.test(text)) return { modality: 'observational / biomarker', isCellTherapy: false };
  if (MSC.test(text)) return { modality: 'MSC cell therapy', isCellTherapy: true };
  if (GENE.test(text)) return { modality: 'gene therapy', isCellTherapy: true };
  if (CELL.test(text)) {
    const modality = /ipsc|hipsc|pluripotent/i.test(text) ? 'iPSC-derived cell therapy'
      : /embryonic|\besc\b|fetal|a9-dpc/i.test(text) ? 'ESC/fetal cell therapy'
      : 'cell therapy';
    return { modality, isCellTherapy: true };
  }
  return { modality: 'other', isCellTherapy: false };
}

export interface ProgramRecord {
  nct: string;
  title: string;
  phase: string[];
  status: string;
  sponsor: string;
  interventions: string;
  discontinued: boolean;
  modality: string;        // classified: iPSC-derived cell therapy | small molecule / SoC | ...
  isCellTherapy: boolean;  // regenerative cell/gene therapy vs. drug/device/other
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
      const rec = {
        nct: p.identificationModule?.nctId,
        title: p.identificationModule?.briefTitle ?? '',
        phase: p.designModule?.phases ?? [],
        status,
        sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name ?? '',
        interventions: (p.armsInterventionsModule?.interventions ?? []).map((i: any) => `${i.type}:${i.name}`).join(' | '),
        discontinued: /TERMINATED|WITHDRAWN|SUSPENDED/i.test(status),
      };
      out.push({ ...rec, ...classifyProgram(rec) });
    }
    token = data.nextPageToken; pages++;
  } while (token && pages < 5);
  return out;
}

// Competitor programs for a disease. When cellTherapy is set, restrict to
// cell/dopaminergic-neuron programs (the modality relevant to a stem-cell
// company); otherwise return all deduped programs for the condition.
// Relevance for capping: engineered/allogeneic cell + gene products (the direct
// competitors to an iPSC/ESC developer) rank above autologous MSC clinics, and
// later-phase programs rank above earlier ones — so a broad "stem cell" query
// can't crowd the marquee players out of the cap.
const MOD_WEIGHT: Record<string, number> = {
  'iPSC-derived cell therapy': 4, 'ESC/fetal cell therapy': 4, 'gene therapy': 3, 'cell therapy': 3, 'MSC cell therapy': 1,
};
const PHASE_RANK: Record<string, number> = {
  PHASE3: 5, 'PHASE2/PHASE3': 4.5, PHASE2: 4, 'PHASE1/PHASE2': 3.5, PHASE1: 3, EARLY_PHASE1: 2, NA: 1,
};
const relevance = (p: ProgramRecord) =>
  (MOD_WEIGHT[p.modality] ?? 2) * 10 + (PHASE_RANK[(p.phase ?? []).join('/')] ?? 1) + (p.discontinued ? -0.5 : 0);

export async function collectCompetitors(condition: string, opts: { cellTherapy?: boolean; cap?: number } = {}): Promise<ProgramRecord[]> {
  const cap = opts.cap ?? 40;
  // Specific intervention terms first so the engineered-cell programs are seen
  // before the broad "stem cell" term pulls in the MSC/adipose clinics.
  // Specific terms first (seen before the cap), then broad terms for recall; the
  // isCellTherapy filter drops drugs/devices and the relevance sort keeps the cap
  // full of the most relevant programs regardless of which query surfaced them.
  const queries = opts.cellTherapy
    ? ['dopaminergic progenitor', 'iPSC', 'pluripotent', 'dopaminergic neuron', 'dopaminergic', 'progenitor cell', 'neural stem cell', 'neuron', 'cell transplantation', 'stem cell']
    : ['']; // empty intervention term = all interventions for the condition
  const byNct = new Map<string, ProgramRecord>();
  for (const q of queries) for (const p of await ctgov(condition, q)) if (p.nct && !byNct.has(p.nct)) byNct.set(p.nct, p);
  let list = [...byNct.values()];
  // For a cell-therapy company, competitors = cell/regenerative programs only;
  // drug and device standard-of-care trials that share the disease are dropped.
  if (opts.cellTherapy) list = list.filter(p => p.isCellTherapy);
  return list.sort((a, b) => relevance(b) - relevance(a)).slice(0, cap);
}
