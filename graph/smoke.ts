// Smoke test: upsert a schema-valid slice of the Parkinson's pilot into the live
// Cosmos graph, twice, to prove idempotency. Run:
//   $env:GRAPH_KEY = (az cosmosdb keys list -n hc-dealflow-graph -g Dealflow --query primaryMasterKey -o tsv)
//   npx tsx smoke.ts
import { openGraph } from './upsert.js';

const PK = 'MONDO_0005180';
const now = new Date().toISOString();
const ct = { source: 'ClinicalTrials.gov', url: 'https://clinicaltrials.gov/study/NCT06944522', retrievedAt: now, trustTier: 'structured' };
const prov = { source: 'ClinicalTrials.gov', url: 'https://clinicaltrials.gov', retrievedAt: now, trustTier: 'structured' };

async function apply(g: ReturnType<typeof openGraph>) {
  await g.upsertVertex('Disease', 'MONDO_0005180', PK, { name: 'Parkinson disease', mondo: 'MONDO_0005180', source: 'OpenTargets', url: 'https://platform.opentargets.org', retrievedAt: now, trustTier: 'structured' });
  await g.upsertVertex('Company', 'company:bluerock-therapeutics', PK, { name: 'BlueRock Therapeutics', ...prov });
  await g.upsertVertex('Program', 'program:bemdaneprocel', PK, { name: 'bemdaneprocel', modality: 'cell therapy', developmentStage: 'Phase 3', status: 'active', ...prov });
  await g.upsertVertex('ClinicalTrial', 'NCT06944522', PK, { title: 'Phase 3 study of bemdaneprocel in Parkinson disease', status: 'RECRUITING', phase: 'PHASE3', sponsor: 'BlueRock Therapeutics', ...ct });
  await g.upsertEdge('develops', 'company:bluerock-therapeutics', 'program:bemdaneprocel', prov);
  await g.upsertEdge('treats', 'program:bemdaneprocel', 'MONDO_0005180', prov);
  await g.upsertEdge('tested_in', 'program:bemdaneprocel', 'NCT06944522', prov);
  await g.upsertEdge('sponsors', 'company:bluerock-therapeutics', 'NCT06944522', prov);
}

const g = openGraph();
try {
  await apply(g);
  const c1 = await g.count();
  await apply(g); // second pass — must not create duplicates
  const c2 = await g.count();
  // read one node back to confirm props landed
  const trial = await g.run("g.V('NCT06944522').valueMap('title','phase','status','sponsor','trustTier')");
  console.log(JSON.stringify({
    run1: c1,
    run2_idempotent: c2,
    idempotent: c1.vertices === c2.vertices && c1.edges === c2.edges,
    trialReadback: trial[0],
  }, null, 2));
} catch (e) {
  console.error('SMOKE ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
} finally {
  await g.close();
}
