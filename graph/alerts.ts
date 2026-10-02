// Phase 4 — change detection + alerting. After a collection run, diff the slice's
// current state against the previous run's baseline, turn the deltas into alerts
// (new late-stage competitors, discontinuations = stranded assets, new deals/
// acquisitions, financings, competitors), persist them, and POST them to a
// configurable webhook (a Power Automate flow that fans out to Teams / email /
// the assigned project people). Owners are configurable per company.
import { sql } from './db.js';

export type Severity = 'high' | 'medium' | 'low';
export interface Alert { type: string; severity: Severity; title: string; detail: string; url?: string; entityId?: string; }

export interface ProgramInfo { name: string; company: string; stage: string; status: string; url: string; }
export interface DealInfo { company: string; counterparty: string | null; type: string; value: string | null; url: string; }
export interface FinancingInfo { company: string; amount: number | null; url: string; }
export interface CurrentState {
  programs: Record<string, ProgramInfo>;
  deals: Record<string, DealInfo>;
  financings: Record<string, FinancingInfo>;
  companies: Record<string, string>; // competitor id -> name
  kols: Record<string, string>;      // person id -> name
}
export interface Snapshot { programs: Record<string, string>; deals: string[]; financings: string[]; companies: string[]; kols: string[]; }

const PHASE_RANK: Record<string, number> = { PHASE3: 5, 'PHASE2/PHASE3': 4.5, PHASE2: 4, 'PHASE1/PHASE2': 3.5, PHASE1: 3, EARLY_PHASE1: 2, NA: 1 };
const rank = (s: string) => PHASE_RANK[s] ?? 1;
const lateStage = (s: string) => rank(s) >= 4; // Phase 2 or later
const SEV_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export function toSnapshot(cur: CurrentState): Snapshot {
  const programs: Record<string, string> = {};
  for (const [id, p] of Object.entries(cur.programs)) programs[id] = `${p.stage}|${p.status}`;
  return { programs, deals: Object.keys(cur.deals), financings: Object.keys(cur.financings), companies: Object.keys(cur.companies), kols: Object.keys(cur.kols) };
}

// Pure diff: baseline (previous snapshot) vs current detailed state → alerts.
// A null baseline means first run — no alerts, just establish the baseline.
export function diff(prev: Snapshot | null, cur: CurrentState): Alert[] {
  if (!prev) return [];
  const out: Alert[] = [];
  const prevProg = prev.programs ?? {};
  for (const [id, p] of Object.entries(cur.programs)) {
    const before = prevProg[id];
    if (!before) {
      if (p.status === 'active' && lateStage(p.stage)) out.push({ type: 'late_stage_entry', severity: 'high', title: `New late-stage competitor: ${p.company}`, detail: `${p.name} — ${p.stage}`, url: p.url, entityId: id });
      else if (p.status === 'discontinued') out.push({ type: 'discontinuation', severity: 'medium', title: `Discontinued program seen: ${p.company}`, detail: `${p.name} — ${p.stage}`, url: p.url, entityId: id });
      continue; // new early-stage active programs are low-signal; skip to limit noise
    }
    const [bStage, bStatus] = before.split('|');
    if (bStatus !== 'discontinued' && p.status === 'discontinued') out.push({ type: 'discontinuation', severity: 'high', title: `Program discontinued — possible stranded asset: ${p.company}`, detail: `${p.name} (${p.stage})`, url: p.url, entityId: id });
    else if (rank(p.stage) > rank(bStage)) out.push({ type: 'phase_advance', severity: 'medium', title: `Program advanced: ${p.company}`, detail: `${p.name}: ${bStage} → ${p.stage}`, url: p.url, entityId: id });
  }
  const prevDeals = new Set(prev.deals);
  for (const [id, d] of Object.entries(cur.deals)) if (!prevDeals.has(id)) {
    const acq = /acquisition|merger/i.test(d.type);
    out.push({ type: 'new_deal', severity: acq ? 'high' : 'medium', title: `New deal: ${d.company}${d.counterparty ? ` ↔ ${d.counterparty}` : ''}`, detail: `${d.type}${d.value ? ` — ${d.value}` : ''}`, url: d.url, entityId: id });
  }
  const prevFin = new Set(prev.financings);
  for (const [id, f] of Object.entries(cur.financings)) if (!prevFin.has(id)) out.push({ type: 'new_financing', severity: 'medium', title: `New financing: ${f.company}`, detail: f.amount ? `$${f.amount.toLocaleString()}` : 'amount n/a', url: f.url, entityId: id });
  const prevCo = new Set(prev.companies);
  for (const [id, name] of Object.entries(cur.companies)) if (!prevCo.has(id)) out.push({ type: 'new_competitor', severity: 'medium', title: `New competitor: ${name}`, detail: 'Entered the competitive landscape', entityId: id });
  const prevK = new Set(prev.kols);
  for (const [id, name] of Object.entries(cur.kols)) if (!prevK.has(id)) out.push({ type: 'new_kol', severity: 'low', title: `New KOL: ${name}`, detail: 'Entered the KOL set', entityId: id });
  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

// ── persistence ──
export async function loadBaseline(pool: sql.ConnectionPool, slice: string): Promise<Snapshot | null> {
  const r = await pool.request().input('slice', sql.NVarChar(100), slice).query('SELECT snapshot FROM graph_alert_state WHERE slice=@slice');
  if (!r.recordset.length) return null;
  try { return JSON.parse(r.recordset[0].snapshot) as Snapshot; } catch { return null; }
}
export async function saveBaseline(pool: sql.ConnectionPool, slice: string, snap: Snapshot): Promise<void> {
  const at = new Date().toISOString();
  await pool.request().input('slice', sql.NVarChar(100), slice).input('snap', sql.NVarChar(sql.MAX), JSON.stringify(snap)).input('at', sql.NVarChar(30), at)
    .query(`MERGE graph_alert_state AS t USING (SELECT @slice AS slice) s ON t.slice=s.slice
      WHEN MATCHED THEN UPDATE SET snapshot=@snap, updated_at=@at
      WHEN NOT MATCHED THEN INSERT(slice,snapshot,updated_at) VALUES(@slice,@snap,@at);`);
}
export async function persistAlerts(pool: sql.ConnectionPool, slice: string, companyId: string, alerts: Alert[]): Promise<void> {
  const at = new Date().toISOString();
  for (const a of alerts) await pool.request()
    .input('slice', sql.NVarChar(100), slice).input('cid', sql.NVarChar(100), companyId)
    .input('type', sql.NVarChar(50), a.type).input('sev', sql.NVarChar(10), a.severity)
    .input('title', sql.NVarChar(400), a.title).input('detail', sql.NVarChar(sql.MAX), a.detail)
    .input('url', sql.NVarChar(1000), a.url ?? null).input('at', sql.NVarChar(30), at)
    .query('INSERT INTO graph_alerts(slice,company_id,type,severity,title,detail,url,created_at) VALUES(@slice,@cid,@type,@sev,@title,@detail,@url,@at)');
}
export async function getOwners(pool: sql.ConnectionPool, companyId: string): Promise<string[]> {
  const r = await pool.request().input('cid', sql.NVarChar(100), companyId).query('SELECT owners FROM graph_project_owners WHERE company_id=@cid');
  let owners: string[] = [];
  if (r.recordset.length) { try { owners = JSON.parse(r.recordset[0].owners); } catch { /* ignore */ } }
  if (!owners.length && process.env.ALERT_DEFAULT_RECIPIENTS) owners = process.env.ALERT_DEFAULT_RECIPIENTS.split(',').map(s => s.trim()).filter(Boolean);
  return owners;
}
async function dispatch(payload: unknown): Promise<'sent' | 'skipped' | 'error'> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return 'skipped';
  try { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return r.ok ? 'sent' : 'error'; }
  catch { return 'error'; }
}

// Orchestration: diff against baseline, persist + dispatch alerts, save new baseline.
export async function runAlerts(pool: sql.ConnectionPool, ctx: { slice: string; companyId: string; company: string; cur: CurrentState }): Promise<{ alerts: number; dispatch: string }> {
  const prev = await loadBaseline(pool, ctx.slice);
  const alerts = diff(prev, ctx.cur);
  await saveBaseline(pool, ctx.slice, toSnapshot(ctx.cur));
  if (!alerts.length) return { alerts: 0, dispatch: prev ? 'no-changes' : 'baseline-initialised' };
  await persistAlerts(pool, ctx.slice, ctx.companyId, alerts);
  const owners = await getOwners(pool, ctx.companyId);
  const counts = alerts.reduce((m, a) => { m[a.severity]++; return m; }, { high: 0, medium: 0, low: 0 } as Record<Severity, number>);
  const sent = await dispatch({ slice: ctx.slice, company: ctx.company, companyId: ctx.companyId, generatedAt: new Date().toISOString(), owners, counts, alerts });
  return { alerts: alerts.length, dispatch: sent };
}
