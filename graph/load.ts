// Loader: run the collection recipes for the JZ Cell Tech / Parkinson's slice,
// resolve every entity to a canonical id, and upsert vertices+edges into the
// Cosmos graph (pk = seed disease id) with provenance. Then run the objective
// queries as an end-to-end acceptance. Idempotent — safe to re-run.
//
//   $env:GRAPH_KEY = (az cosmosdb keys list -n hc-dealflow-graph -g Dealflow --query primaryMasterKey -o tsv)
//   npx tsx load.ts
import { openGraph } from './upsert.js';
import { resolveDisease, resolveCompany } from './resolvers.js';
import { collectCompetitors } from './connectors/competitors.js';
import { collectAcademics } from './connectors/academics.js';

const prov = (source: string, url: string, trustTier = 'structured') => ({ source, url, retrievedAt: new Date().toISOString(), trustTier });
const CT = (nct: string) => `https://clinicaltrials.gov/study/${nct}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const firstIntervention = (s: string) => (s.split('|')[0]?.split(':').slice(1).join(':').trim() || '').slice(0, 120);

async function loadSlice() {
  const seed = { id: 'dealflow:jzcell', name: 'JZ Cell Tech', modality: 'stem cell-derived dopaminergic neurons', diseaseName: "Parkinson's disease" };
  const dis = await resolveDisease(seed.diseaseName);
  if (!dis.canonicalId) throw new Error('seed disease unresolved');
  const pk = dis.canonicalId;
  const g = openGraph();
  const summary: Record<string, unknown> = { disease: pk };
  try {
    await g.upsertVertex('Disease', pk, pk, { name: dis.label ?? seed.diseaseName, mondo: pk, ...prov('OpenTargets', 'https://platform.opentargets.org') });
    await g.upsertVertex('DealflowCompany', seed.id, pk, { name: seed.name, modality: seed.modality, seedDisease: pk, ...prov('Dealflow', 'internal') });
    await g.upsertEdge('develops_for', seed.id, pk, prov('Dealflow', 'internal'));

    // ── competitors ──
    const programs = await collectCompetitors('Parkinson Disease', 30);
    const companies = new Set<string>();
    for (const p of programs) {
      const co = resolveCompany(p.sponsor);
      if (!co.canonicalId) continue;
      const coId = co.canonicalId; companies.add(coId);
      const phase = p.phase.join('/') || 'NA';
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

    // ── academics ──
    const kols = await collectAcademics("Parkinson's disease", 12);
    for (const k of kols) {
      const pid = k.orcid ? `ORCID:${k.orcid}` : `OPENALEX:${k.openAlexId}`;
      await g.upsertVertex('Person', pid, pk, { name: k.name, orcid: k.orcid ?? undefined, openAlexId: k.openAlexId, country: k.country ?? undefined, ...prov('OpenAlex', 'https://openalex.org/' + k.openAlexId) });
      await g.upsertEdge('researches', pid, pk, prov('OpenAlex', 'https://openalex.org', 'inferred'));
      if (k.institution) {
        const instId = 'inst:' + slug(k.institution);
        await g.upsertVertex('Institution', instId, pk, { name: k.institution, country: k.country ?? undefined, ...prov('OpenAlex', 'https://openalex.org') });
        await g.upsertEdge('affiliated_with', pid, instId, prov('OpenAlex', 'https://openalex.org'));
      }
    }
    summary.kols = kols.length;

    // ── objective queries (acceptance) ──
    const one = async (q: string, b: Record<string, unknown> = { pk }) => (await g.run(q, b))[0];
    summary.totals = { vertices: (await g.count()).vertices, edges: (await g.count()).edges };
    summary.crowding_active_ph1_3 = await one("g.V().hasLabel('Program').has('pk',pk).has('status','active').has('developmentStage',within('PHASE1','PHASE1/PHASE2','PHASE2','PHASE2/PHASE3','PHASE3')).count()");
    summary.discontinued_programs = await one("g.V().hasLabel('Program').has('pk',pk).has('status','discontinued').count()");
    summary.competitor_companies = await one("g.V(sid).out('competes_with').count()", { sid: seed.id });
    summary.kol_nodes = await one("g.V().hasLabel('Person').has('pk',pk).count()");
    summary.phase3_sponsors = await g.run("g.V().hasLabel('ClinicalTrial').has('pk',pk).has('phase','PHASE3').in('sponsors').dedup().values('name')", { pk });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await g.close();
  }
}

loadSlice().catch(e => { console.error('LOAD ERROR:', e instanceof Error ? e.message : e); process.exit(1); });
