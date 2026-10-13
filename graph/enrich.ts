// Agent-driven enrichment: upsert structured competitor / deal / financing records
// (extracted by the agent from an editorial source such as the BioCentury article
// connector, which the headless worker cannot call) into a slice, tagged with that
// source's provenance and trust tier 'inferred'. Input is a JSON file:
//   { slice, seedDfId, source, url, target?, programs[], deals[], financings[] }
import fs from 'node:fs';
import { openGraph } from './upsert.js';
import { resolveCompany } from './resolvers.js';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const E = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const pk: string = E.slice, dfId: string = E.seedDfId, SRC: string = E.source || 'BioCentury', URL: string = E.url || 'https://www.biocentury.com';
const prov = (tier = 'inferred') => ({ source: SRC, url: URL, retrievedAt: new Date().toISOString(), trustTier: tier });

const g = openGraph();
try {
  const targetId = E.target ? 'target:' + slug(E.target) : null;
  if (targetId) {
    await g.upsertVertex('Target', targetId, pk, { symbol: E.target, ...prov() });
    await g.upsertEdge('associated_with', targetId, pk, prov());
  }
  for (const p of (E.programs ?? [])) {
    const co = resolveCompany(p.company); if (!co.canonicalId) continue;
    await g.upsertVertex('Company', co.canonicalId, pk, { name: p.company, ...prov() });
    await g.upsertEdge('competes_with', dfId, co.canonicalId, prov());
    const progId = 'program:bc:' + slug(p.company) + ':' + slug(p.name);
    await g.upsertVertex('Program', progId, pk, { name: p.name, modality: p.modality ?? 'small molecule', isCellTherapy: false, mechanismOfAction: p.mechanism ?? undefined, developmentStage: p.stage ?? 'NA', status: p.status ?? 'active', approved: p.approved === true, sponsorClass: 'INDUSTRY', ...prov() });
    await g.upsertEdge('develops', co.canonicalId, progId, prov());
    if (targetId) await g.upsertEdge('has_target', progId, targetId, prov());
  }
  for (const d of (E.deals ?? [])) {
    const co = resolveCompany(d.company); if (!co.canonicalId) continue;
    await g.upsertVertex('Company', co.canonicalId, pk, { name: d.company, ...prov() });
    const id = 'deal:bc:' + slug(d.company) + '-' + slug(d.counterparty ?? 'na') + '-' + (d.date ?? '');
    await g.upsertVertex('Deal', id, pk, { dealType: d.dealType, value: d.value ?? undefined, date: d.date ?? undefined, counterparty: d.counterparty ?? undefined, evidence: d.evidence ?? undefined, role: d.companyRole ?? 'party', ...prov() });
    await g.upsertEdge('party_to', co.canonicalId, id, { role: d.companyRole ?? 'party', ...prov() });
    if (d.counterparty) {
      const cp = resolveCompany(d.counterparty);
      if (cp.canonicalId) {
        await g.upsertVertex('Company', cp.canonicalId, pk, { name: d.counterparty, ...prov() });
        await g.upsertEdge('deal_counterparty', id, cp.canonicalId, { role: d.counterpartyRole ?? 'acquirer', ...prov() });
      }
    }
  }
  for (const f of (E.financings ?? [])) {
    const co = resolveCompany(f.company); if (!co.canonicalId) continue;
    await g.upsertVertex('Company', co.canonicalId, pk, { name: f.company, ...prov() });
    const id = 'fin:bc:' + slug(f.company) + '-' + (f.date ?? '');
    await g.upsertVertex('Financing', id, pk, { roundType: f.roundType, amountRaised: f.amountUsd ?? undefined, currency: f.amountUsd ? 'USD' : undefined, date: f.date ?? undefined, ...prov() });
    await g.upsertEdge('raised', co.canonicalId, id, prov());
  }
  console.log(JSON.stringify({ programs: (E.programs ?? []).length, deals: (E.deals ?? []).length, financings: (E.financings ?? []).length }));
} finally { await g.close(); }
