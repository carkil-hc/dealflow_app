// Per-company collection: seed-extraction → connectors → stage → resolve →
// idempotent upsert into the graph, then the objective queries. Works for ANY
// dealflow company. This is what the Container Apps Job worker invokes per job.
import { openGraph } from './upsert.js';
import { openSql } from './db.js';
import { Staging, RawRecord } from './staging.js';
import { getCompanyRow } from './companies.js';
import { extractSeed } from './seed.js';
import { resolveDisease, resolveCompany } from './resolvers.js';
import { collectCompetitors, ProgramRecord } from './connectors/competitors.js';
import { collectAcademics, KolRecord } from './connectors/academics.js';

const prov = (source: string, url: string, trustTier = 'structured') => ({ source, url, retrievedAt: new Date().toISOString(), trustTier });
const CT = (nct: string) => `https://clinicaltrials.gov/study/${nct}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const firstIntervention = (s: string) => (s.split('|')[0]?.split(':').slice(1).join(':').trim() || '').slice(0, 120);

export interface CollectOpts { reprocess?: boolean; resetKols?: boolean }

export async function runCollectionForCompany(companyId: string, opts: CollectOpts = {}): Promise<Record<string, unknown>> {
  const pool = await openSql();
  const staging = new Staging(pool);
  const g = openGraph();
  const summary: Record<string, unknown> = { companyId };
  try {
    const c = await getCompanyRow(pool, companyId);
    if (!c) throw new Error('company not found: ' + companyId);
    const seed = await extractSeed(c);
    const dis = await resolveDisease(seed.diseaseName);
    const pk = dis.canonicalId ?? ('disease:' + slug(seed.diseaseName));
    const cellTherapy = /cell therapy|gene therapy/i.test(seed.modality);
    const dfId = 'dealflow:' + companyId;
    Object.assign(summary, { company: c.name, seed, slice: pk, cellTherapy });

    // ── fetch + stage (unless reprocessing) ──
    if (!opts.reprocess) {
      const programs = await collectCompetitors(seed.diseaseName, { cellTherapy, cap: 30 });
      const kols = await collectAcademics(seed.diseaseName, { cellTherapy, top: 12 });
      const recs: RawRecord[] = [
        ...programs.map(p => ({ source: 'clinicaltrials.gov', id: p.nct, recordType: 'trial', slice: pk, url: CT(p.nct), payload: p })),
        ...kols.map(k => ({ source: 'openalex', id: k.openAlexId, recordType: 'author', slice: pk, url: 'https://openalex.org/' + k.openAlexId, payload: k })),
      ];
      summary.staged = await staging.put(recs);
    }

    if (opts.resetKols) {
      await g.run("g.V().hasLabel('Person').has('pk',pk).drop()", { pk });
      await g.run("g.V().hasLabel('Institution').has('pk',pk).drop()", { pk });
    }

    // ── load graph from staging ──
    await g.upsertVertex('Disease', pk, pk, { name: dis.label ?? seed.diseaseName, mondo: pk, ...prov('OpenTargets', 'https://platform.opentargets.org') });
    await g.upsertVertex('DealflowCompany', dfId, pk, { name: c.name, modality: seed.modality, seedDisease: pk, ...prov('Dealflow', 'internal') });
    await g.upsertEdge('develops_for', dfId, pk, prov('Dealflow', 'internal'));

    const programs = await staging.get<ProgramRecord>('clinicaltrials.gov', { slice: pk, recordType: 'trial' });
    const companies = new Set<string>();
    for (const p of programs) {
      const co = resolveCompany(p.sponsor);
      if (!co.canonicalId) continue;
      const coId = co.canonicalId; companies.add(coId);
      const phase = (p.phase ?? []).join('/') || 'NA';
      const progId = `program:${coId.replace('company:', '')}:${p.nct}`;
      await g.upsertVertex('Company', coId, pk, { name: p.sponsor, ...prov('ClinicalTrials.gov', 'https://clinicaltrials.gov') });
      await g.upsertEdge('competes_with', dfId, coId, prov('Dealflow', 'internal', 'inferred'));
      await g.upsertVertex('Program', progId, pk, { name: firstIntervention(p.interventions) || p.title.slice(0, 120), modality: seed.modality, developmentStage: phase, status: p.discontinued ? 'discontinued' : 'active', ...prov('ClinicalTrials.gov', CT(p.nct)) });
      await g.upsertEdge('develops', coId, progId, prov('ClinicalTrials.gov', CT(p.nct)));
      await g.upsertEdge('treats', progId, pk, prov('ClinicalTrials.gov', CT(p.nct), 'inferred'));
      await g.upsertVertex('ClinicalTrial', p.nct, pk, { title: p.title.slice(0, 200), phase, status: p.status, sponsor: p.sponsor, ...prov('ClinicalTrials.gov', CT(p.nct)) });
      await g.upsertEdge('tested_in', progId, p.nct, prov('ClinicalTrials.gov', CT(p.nct)));
      await g.upsertEdge('sponsors', coId, p.nct, prov('ClinicalTrials.gov', CT(p.nct)));
    }
    summary.programs = programs.length;
    summary.companies = companies.size;

    const kols = await staging.get<KolRecord>('openalex', { slice: pk, recordType: 'author' });
    for (const k of kols) {
      const pid = k.orcid ? `ORCID:${k.orcid}` : `OPENALEX:${k.openAlexId}`;
      await g.upsertVertex('Person', pid, pk, { name: k.name, orcid: k.orcid ?? undefined, openAlexId: k.openAlexId, country: k.country ?? undefined, recentWorks: k.recentWorks, leadWorks: k.leadWorks, ...prov('OpenAlex', 'https://openalex.org/' + k.openAlexId) });
      await g.upsertEdge('researches', pid, pk, prov('OpenAlex', 'https://openalex.org', 'inferred'));
      if (k.institution) {
        const instId = 'inst:' + slug(k.institution);
        await g.upsertVertex('Institution', instId, pk, { name: k.institution, country: k.country ?? undefined, ...prov('OpenAlex', 'https://openalex.org') });
        await g.upsertEdge('affiliated_with', pid, instId, prov('OpenAlex', 'https://openalex.org'));
      }
    }
    summary.kols = kols.length;

    const one = async (q: string, b: Record<string, unknown> = { pk }) => (await g.run(q, b))[0];
    summary.crowding_active_ph1_3 = await one("g.V().hasLabel('Program').has('pk',pk).has('status','active').has('developmentStage',within('PHASE1','PHASE1/PHASE2','PHASE2','PHASE2/PHASE3','PHASE3')).count()");
    summary.discontinued_programs = await one("g.V().hasLabel('Program').has('pk',pk).has('status','discontinued').count()");
    summary.competitor_companies = await one("g.V(sid).out('competes_with').count()", { sid: dfId });
    summary.kol_nodes = await one("g.V().hasLabel('Person').has('pk',pk).count()");
    return summary;
  } finally {
    await g.close();
    await staging.close();
  }
}
