// Loader: fetch the collection recipes → STAGE the raw records (Azure SQL) →
// load the graph FROM staging (resolve → idempotent upsert) → run the objective
// queries. REPROCESS=1 skips fetching and rebuilds the graph purely from staged
// records (proves the graph can be rebuilt without re-hitting the source APIs).
//
//   $env:GRAPH_KEY = (az cosmosdb keys list -n hc-dealflow-graph -g Dealflow --query primaryMasterKey -o tsv)
//   $env:AZURE_SQL_SERVER = 'hc-server-1.database.windows.net'; $env:AZURE_SQL_DATABASE = 'hc_dealflow_db'
//   npx tsx load.ts            # fetch + stage + load
//   $env:REPROCESS = '1'; npx tsx load.ts   # rebuild graph from staging only
import { openGraph } from './upsert.js';
import { resolveDisease, resolveCompany } from './resolvers.js';
import { collectCompetitors, ProgramRecord } from './connectors/competitors.js';
import { collectAcademics, KolRecord } from './connectors/academics.js';
import { Staging, RawRecord } from './staging.js';

const prov = (source: string, url: string, trustTier = 'structured') => ({ source, url, retrievedAt: new Date().toISOString(), trustTier });
const CT = (nct: string) => `https://clinicaltrials.gov/study/${nct}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const firstIntervention = (s: string) => (s.split('|')[0]?.split(':').slice(1).join(':').trim() || '').slice(0, 120);

async function loadSlice() {
  const seed = { id: 'dealflow:jzcell', name: 'JZ Cell Tech', modality: 'stem cell-derived dopaminergic neurons', diseaseName: "Parkinson's disease" };
  const dis = await resolveDisease(seed.diseaseName);
  if (!dis.canonicalId) throw new Error('seed disease unresolved');
  const pk = dis.canonicalId;
  const summary: Record<string, unknown> = { disease: pk };

  const staging = await Staging.open();
  const g = openGraph();
  try {
    // ── fetch + stage (unless reprocessing from staging) ──
    if (!process.env.REPROCESS) {
      const programs = await collectCompetitors('Parkinson Disease', 30);
      const kols = await collectAcademics("Parkinson's disease", 12);
      const recs: RawRecord[] = [
        ...programs.map(p => ({ source: 'clinicaltrials.gov', id: p.nct, recordType: 'trial', slice: pk, url: CT(p.nct), payload: p })),
        ...kols.map(k => ({ source: 'openalex', id: k.openAlexId, recordType: 'author', slice: pk, url: 'https://openalex.org/' + k.openAlexId, payload: k })),
      ];
      summary.staged = await staging.put(recs);
    }

    // ── load graph FROM staging ──
    if (process.env.RESET_KOLS) {
      await g.run("g.V().hasLabel('Person').has('pk',pk).drop()", { pk });
      await g.run("g.V().hasLabel('Institution').has('pk',pk).drop()", { pk });
    }
    await g.upsertVertex('Disease', pk, pk, { name: dis.label ?? seed.diseaseName, mondo: pk, ...prov('OpenTargets', 'https://platform.opentargets.org') });
    await g.upsertVertex('DealflowCompany', seed.id, pk, { name: seed.name, modality: seed.modality, seedDisease: pk, ...prov('Dealflow', 'internal') });
    await g.upsertEdge('develops_for', seed.id, pk, prov('Dealflow', 'internal'));

    const programs = await staging.get<ProgramRecord>('clinicaltrials.gov', { slice: pk, recordType: 'trial' });
    const companies = new Set<string>();
    for (const p of programs) {
      const co = resolveCompany(p.sponsor);
      if (!co.canonicalId) continue;
      const coId = co.canonicalId; companies.add(coId);
      const phase = (p.phase ?? []).join('/') || 'NA';
      const progId = `program:${coId.replace('company:', '')}:${p.nct}`;
      await g.upsertVertex('Company', coId, pk, { name: p.sponsor, ...prov('ClinicalTrials.gov', 'https://clinicaltrials.gov') });
      await g.upsertEdge('competes_with', seed.id, coId, prov('Dealflow', 'internal', 'inferred'));
      await g.upsertVertex('Program', progId, pk, { name: firstIntervention(p.interventions) || p.title.slice(0, 120), modality: 'cell therapy', developmentStage: phase, status: p.discontinued ? 'discontinued' : 'active', ...prov('ClinicalTrials.gov', CT(p.nct)) });
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
    summary.mode = process.env.REPROCESS ? 'reprocess-from-staging' : 'fetch+stage+load';

    // ── objective queries (acceptance) ──
    const one = async (q: string, b: Record<string, unknown> = { pk }) => (await g.run(q, b))[0];
    summary.totals = await g.count();
    summary.crowding_active_ph1_3 = await one("g.V().hasLabel('Program').has('pk',pk).has('status','active').has('developmentStage',within('PHASE1','PHASE1/PHASE2','PHASE2','PHASE2/PHASE3','PHASE3')).count()");
    summary.discontinued_programs = await one("g.V().hasLabel('Program').has('pk',pk).has('status','discontinued').count()");
    summary.competitor_companies = await one("g.V(sid).out('competes_with').count()", { sid: seed.id });
    summary.kol_nodes = await one("g.V().hasLabel('Person').has('pk',pk).count()");
    summary.phase3_sponsors = await g.run("g.V().hasLabel('ClinicalTrial').has('pk',pk).has('phase','PHASE3').in('sponsors').dedup().values('name')", { pk });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await g.close();
    await staging.close();
  }
}

loadSlice().catch(e => { console.error('LOAD ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
