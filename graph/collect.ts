// Per-company collection: seed-extraction → connectors → stage → resolve →
// idempotent upsert into the graph, then the objective queries. Works for ANY
// dealflow company. This is what the Container Apps Job worker invokes per job.
import { openGraph } from './upsert.js';
import { openSql } from './db.js';
import { Staging, RawRecord } from './staging.js';
import { getCompanyRow } from './companies.js';
import { extractSeed } from './seed.js';
import { resolveDisease, resolveCompany } from './resolvers.js';
import { collectCompetitors, classifyProgram, ProgramRecord } from './connectors/competitors.js';
import { collectAcademics, KolRecord } from './connectors/academics.js';
import { collectFinancings, collectDeals, FinancingRecord, DealRecord } from './connectors/financings.js';
import { collectNewsDeals, collectTradePressDeals, NewsDeal } from './connectors/newsdeals.js';
import { runAlerts, ProgramInfo, DealInfo, FinancingInfo } from './alerts.js';

const prov = (source: string, url: string, trustTier = 'structured') => ({ source, url, retrievedAt: new Date().toISOString(), trustTier });
const CT = (nct: string) => `https://clinicaltrials.gov/study/${nct}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const firstIntervention = (s: string) => (s.split('|')[0]?.split(':').slice(1).join(':').trim() || '').slice(0, 120);

export interface CollectOpts { reprocess?: boolean; resetKols?: boolean; resetPrograms?: boolean }

const modSlug = (m: string) => 'modality:' + m.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

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

    // ── reset the competitor sub-graph (e.g. after a reclassification) ──
    if (opts.resetPrograms) {
      for (const label of ['Program', 'ClinicalTrial', 'Modality', 'Company']) {
        await g.run(`g.V().hasLabel('${label}').has('pk',pk).drop()`, { pk });
      }
      await staging.clear('clinicaltrials.gov', { slice: pk, recordType: 'trial' });
    }

    // ── fetch + stage (unless reprocessing) ──
    if (!opts.reprocess) {
      const comp = await collectCompetitors(seed.diseaseName, { cellTherapy, cap: 45, seed: { target: seed.target, mechanism: seed.mechanism, modality: seed.modality } });
      const programs = [...comp.competitors, ...comp.approved]; // both get nodes; approved tagged + shown separately
      summary.academic_dropped = comp.academicCount;
      summary.approved_drugs = comp.approved.length;
      const kols = await collectAcademics(seed.diseaseName, { cellTherapy, top: 12 });
      const recs: RawRecord[] = [
        ...programs.map(p => ({ source: 'clinicaltrials.gov', id: p.nct, recordType: 'trial', slice: pk, url: CT(p.nct), payload: p })),
        ...kols.map(k => ({ source: 'openalex', id: k.openAlexId, recordType: 'author', slice: pk, url: 'https://openalex.org/' + k.openAlexId, payload: k })),
      ];
      // Financings/deals per distinct competitor (SEC EDGAR; capped to bound calls).
      const sponsors = [...new Map(programs.map(p => [resolveCompany(p.sponsor).canonicalId, p.sponsor]).filter(([id]) => id)).values()].slice(0, 15) as string[];
      for (const name of sponsors) {
        try { // one company's EDGAR hiccup must not abort the whole collection
          const fins = await collectFinancings(name, 8);
          const deals = await collectDeals(name, 5);
          for (const f of fins) recs.push({ source: 'sec.gov', id: f.id, recordType: 'financing', slice: pk, url: f.url, payload: f });
          for (const d of deals) recs.push({ source: 'sec.gov', id: d.id, recordType: 'deal', slice: pk, url: d.url, payload: d });
        } catch {
          const errs = (summary.edgarErrors as string[]) ?? (summary.edgarErrors = [] as string[]);
          errs.push(name);
        }
      }
      // News/Wikipedia deals (acquisitions/licensing incl. private targets &
      // foreign acquirers that EDGAR misses). Claude-extracted, grounded; capped.
      for (const name of sponsors.slice(0, 8)) {
        try {
          for (const d of await collectNewsDeals(name, { top: 2 })) {
            recs.push({ source: 'news', id: d.id, recordType: 'deal', slice: pk, url: d.url, payload: d });
          }
        } catch {
          const errs = (summary.newsErrors as string[]) ?? (summary.newsErrors = [] as string[]);
          errs.push(name);
        }
      }
      // Trade-press deal sweep (one GDELT query over biotech trade press for the
      // slice's topic) — a discovery layer that surfaces deals for companies that
      // may not be in the clinical-trial set at all.
      try {
        const tp = await collectTradePressDeals([seed.diseaseName, seed.modality]);
        for (const d of tp) recs.push({ source: 'news', id: d.id, recordType: 'deal', slice: pk, url: d.url, payload: d });
        summary.tradePressDeals = tp.length;
      } catch { summary.tradePressDeals = 'error'; }
      summary.staged = await staging.put(recs);
    }

    if (opts.resetKols) {
      await g.run("g.V().hasLabel('Person').has('pk',pk).drop()", { pk });
      await g.run("g.V().hasLabel('Institution').has('pk',pk).drop()", { pk });
    }

    // ── load graph from staging ──
    await g.upsertVertex('Disease', pk, pk, { name: dis.label ?? seed.diseaseName, mondo: pk, ...prov('OpenTargets', 'https://platform.opentargets.org') });
    await g.upsertVertex('DealflowCompany', dfId, pk, { name: c.name, modality: seed.modality, seedDisease: pk, seedTarget: seed.target ?? undefined, seedMechanism: seed.mechanism ?? undefined, maxStage: seed.maxStage ?? undefined, ...prov('Dealflow', 'internal') });
    await g.upsertEdge('develops_for', dfId, pk, prov('Dealflow', 'internal'));

    // Current-state accumulators for Phase 4 change detection.
    const curPrograms: Record<string, ProgramInfo> = {};
    const curDeals: Record<string, DealInfo> = {};
    const curFinancings: Record<string, FinancingInfo> = {};
    const curCompanies: Record<string, string> = {};
    const curKols: Record<string, string> = {};

    const programs = await staging.get<ProgramRecord>('clinicaltrials.gov', { slice: pk, recordType: 'trial' });
    const companies = new Set<string>();
    for (const p of programs) {
      const co = resolveCompany(p.sponsor);
      if (!co.canonicalId) continue;
      const coId = co.canonicalId; companies.add(coId); curCompanies[coId] = p.sponsor;
      const phase = (p.phase ?? []).join('/') || 'NA';
      const progId = `program:${coId.replace('company:', '')}:${p.nct}`;
      const cls = classifyProgram(p); // deterministic; robust to older staged records
      curPrograms[progId] = { name: firstIntervention(p.interventions) || p.title.slice(0, 120), company: p.sponsor, stage: phase, status: p.discontinued ? 'discontinued' : 'active', url: CT(p.nct) };
      const approved = (p as ProgramRecord).approved === true;
      await g.upsertVertex('Company', coId, pk, { name: p.sponsor, ...prov('ClinicalTrials.gov', 'https://clinicaltrials.gov') });
      await g.upsertEdge('competes_with', dfId, coId, prov('Dealflow', 'internal', 'inferred'));
      await g.upsertVertex('Program', progId, pk, { name: firstIntervention(p.interventions) || p.title.slice(0, 120), modality: cls.modality, isCellTherapy: cls.isCellTherapy, developmentStage: phase, status: p.discontinued ? 'discontinued' : 'active', approved, sponsorClass: (p as ProgramRecord).sponsorClass, ...prov('ClinicalTrials.gov', CT(p.nct)) });
      await g.upsertEdge('develops', coId, progId, prov('ClinicalTrials.gov', CT(p.nct)));
      const modId = modSlug(cls.modality);
      await g.upsertVertex('Modality', modId, pk, { name: cls.modality, ...prov('ClinicalTrials.gov', CT(p.nct), 'inferred') });
      await g.upsertEdge('has_modality', progId, modId, prov('ClinicalTrials.gov', CT(p.nct), 'inferred'));
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
      curKols[pid] = k.name;
      await g.upsertVertex('Person', pid, pk, { name: k.name, orcid: k.orcid ?? undefined, openAlexId: k.openAlexId, country: k.country ?? undefined, recentWorks: k.recentWorks, leadWorks: k.leadWorks, ...prov('OpenAlex', 'https://openalex.org/' + k.openAlexId) });
      await g.upsertEdge('researches', pid, pk, prov('OpenAlex', 'https://openalex.org', 'inferred'));
      if (k.institution) {
        const instId = 'inst:' + slug(k.institution);
        await g.upsertVertex('Institution', instId, pk, { name: k.institution, country: k.country ?? undefined, ...prov('OpenAlex', 'https://openalex.org') });
        await g.upsertEdge('affiliated_with', pid, instId, prov('OpenAlex', 'https://openalex.org'));
      }
    }
    summary.kols = kols.length;

    // ── financings & deals (SEC EDGAR) → Company raised Financing / Company party_to Deal ──
    const fins = await staging.get<FinancingRecord>('sec.gov', { slice: pk, recordType: 'financing' });
    for (const f of fins) {
      const co = resolveCompany(f.company); if (!co.canonicalId) continue;
      await g.upsertVertex('Company', co.canonicalId, pk, { name: f.company, ...prov('SEC EDGAR', f.url) });
      await g.upsertVertex('Financing', f.id, pk, { roundType: f.roundType, amountRaised: f.amountUsd ?? undefined, currency: f.amountUsd ? 'USD' : undefined, date: f.date, ...prov('SEC EDGAR', f.url) });
      await g.upsertEdge('raised', co.canonicalId, f.id, prov('SEC EDGAR', f.url));
      curFinancings[f.id] = { company: f.company, amount: f.amountUsd ?? null, url: f.url };
    }
    const deals = await staging.get<DealRecord>('sec.gov', { slice: pk, recordType: 'deal' });
    for (const d of deals) {
      const co = resolveCompany(d.company); if (!co.canonicalId) continue;
      await g.upsertVertex('Company', co.canonicalId, pk, { name: d.company, ...prov('SEC EDGAR', d.url) });
      await g.upsertVertex('Deal', d.id, pk, { dealType: d.dealType, date: d.date, ...prov('SEC EDGAR', d.url, 'inferred') });
      await g.upsertEdge('party_to', co.canonicalId, d.id, prov('SEC EDGAR', d.url, 'inferred'));
      curDeals[d.id] = { company: d.company, counterparty: null, type: d.dealType, value: null, url: d.url };
    }
    summary.financings = fins.length;
    summary.deals = deals.length;

    // ── news/Wikipedia deals → Deal + Company party_to / Deal deal_counterparty ──
    const news = await staging.get<NewsDeal>('news', { slice: pk, recordType: 'deal' });
    for (const d of news) {
      const co = resolveCompany(d.company); if (!co.canonicalId) continue;
      await g.upsertVertex('Company', co.canonicalId, pk, { name: d.company, ...prov(d.source, d.url, 'inferred') });
      await g.upsertVertex('Deal', d.id, pk, { dealType: d.dealType, value: d.value ?? undefined, date: d.date ?? undefined, counterparty: d.counterparty ?? undefined, evidence: d.evidence, confidence: d.confidence, role: d.companyRole, ...prov(d.source, d.url, 'inferred') });
      await g.upsertEdge('party_to', co.canonicalId, d.id, { role: d.companyRole, ...prov(d.source, d.url, 'inferred') });
      curDeals[d.id] = { company: d.company, counterparty: d.counterparty, type: d.dealType, value: d.value, url: d.url };
      // Record the buyer/partner as its own Company node + counterparty edge, when
      // it is a single, resolvable entity (skip compound "X and Y" counterparties).
      if (d.counterparty && !/\band\b|,|;|\//.test(d.counterparty)) {
        const cp = resolveCompany(d.counterparty);
        if (cp.canonicalId) {
          await g.upsertVertex('Company', cp.canonicalId, pk, { name: d.counterparty, ...prov(d.source, d.url, 'inferred') });
          await g.upsertEdge('deal_counterparty', d.id, cp.canonicalId, { role: d.counterpartyRole, ...prov(d.source, d.url, 'inferred') });
        }
      }
    }
    summary.news_deals = news.length;

    const one = async (q: string, b: Record<string, unknown> = { pk }) => (await g.run(q, b))[0];
    summary.crowding_active_ph1_3 = await one("g.V().hasLabel('Program').has('pk',pk).has('status','active').has('developmentStage',within('PHASE1','PHASE1/PHASE2','PHASE2','PHASE2/PHASE3','PHASE3')).count()");
    summary.discontinued_programs = await one("g.V().hasLabel('Program').has('pk',pk).has('status','discontinued').count()");
    summary.competitor_companies = await one("g.V(sid).out('competes_with').count()", { sid: dfId });
    summary.kol_nodes = await one("g.V().hasLabel('Person').has('pk',pk).count()");
    summary.cell_therapy_programs = await one("g.V().hasLabel('Program').has('pk',pk).has('isCellTherapy',true).count()");
    summary.modality_breakdown = await one("g.V().hasLabel('Program').has('pk',pk).groupCount().by('modality')");
    summary.financing_nodes = await one("g.V().hasLabel('Financing').has('pk',pk).count()");
    summary.deal_nodes = await one("g.V().hasLabel('Deal').has('pk',pk).count()");
    summary.deals_with_counterparty = await one("g.V().hasLabel('Deal').has('pk',pk).where(__.out('deal_counterparty')).count()");
    summary.acquirers = await one("g.V().hasLabel('Deal').has('pk',pk).out('deal_counterparty').dedup().values('name').fold()");
    // competitors with any observed financing (backward traversal: Financing←raised←Company)
    summary.funded_competitors = await one("g.V().hasLabel('Financing').has('pk',pk).in('raised').dedup().count()");

    // ── Phase 4: detect changes vs the previous run, alert owners ──
    const alertRes = await runAlerts(pool, { slice: pk, companyId, company: c.name, cur: { programs: curPrograms, deals: curDeals, financings: curFinancings, companies: curCompanies, kols: curKols } });
    summary.alerts = alertRes.alerts;
    summary.alert_dispatch = alertRes.dispatch;
    return summary;
  } finally {
    await g.close();
    await staging.close();
  }
}
