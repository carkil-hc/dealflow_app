import { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, Network, RefreshCw, ExternalLink, FlaskConical, Handshake, GraduationCap, BookOpen, Users, SlidersHorizontal, Save } from 'lucide-react';
import { Company } from '../../types';

// The Intelligence tab: an editable "collection instruction" that steers the
// worker, the company's competitive graph slice shown inline (competitors,
// mechanism peers, deals, financings, KOLs, publications), and an "ask the graph"
// box that reasons live over the whole knowledge graph.

interface Row { [k: string]: unknown }
interface Seed { name: string; pk: string; modality: string; target: string; mechanism: string; maxStage: string }
interface Intel {
  collected: boolean;
  seed?: Seed;
  programs?: Row[]; deals?: Row[]; financings?: Row[]; kols?: Row[]; publications?: Row[];
}
interface Profile { diseaseName: string; target: string | null; mechanism: string | null; modality: string; maxStage: string | null; notes: string }

const MODALITIES = ['small molecule', 'biologic/mAb', 'cell therapy', 'gene therapy', 'other'];
const first = (v: unknown): string => (Array.isArray(v) && v.length ? String(v[0]) : (v == null || v === '-' ? '' : String(v)));
const src = (p: Row): string => first(p.src);
const PH: Record<string, { l: string; late: boolean }> = {
  PRECLINICAL: { l: 'Preclinical', late: false }, EARLY_PHASE1: { l: 'Early Ph1', late: false },
  PHASE1: { l: 'Phase 1', late: false }, 'PHASE1/PHASE2': { l: 'Phase 1/2', late: false },
  PHASE2: { l: 'Phase 2', late: true }, 'PHASE2/PHASE3': { l: 'Phase 2/3', late: true },
  PHASE3: { l: 'Phase 3', late: true }, PHASE4: { l: 'Phase 4', late: true }, NA: { l: 'n/a', late: false },
};
const ph = (s: string) => PH[s] ?? { l: s || 'n/a', late: false };
const pr = (s: string) => { const m: Record<string, number> = { PHASE3: 4, 'PHASE2/PHASE3': 3.5, PHASE2: 3, 'PHASE1/PHASE2': 2.5, PHASE1: 2, EARLY_PHASE1: 1.5, PRECLINICAL: 1, NA: 0 }; return m[s] ?? 0; };
const money = (n: number) => !n ? '—' : '$' + (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(0) + 'M' : n.toLocaleString());

const SectionHead = ({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number | string }) => (
  <div className="flex items-center gap-2 mb-2 mt-1">
    <span className="text-hc-teal">{icon}</span>
    <h3 className="text-sm font-semibold text-[#1A1A1A]">{title}</h3>
    {count != null && <span className="text-[11px] text-gray-400 font-mono">{count}</span>}
  </div>
);
const Phase = ({ s }: { s: string }) => {
  const p = ph(s);
  return <span className={`inline-block px-2 py-0.5 rounded-sm text-[11px] font-semibold ${p.late ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{p.l}</span>;
};

// Module-level (stable identity) so editing never remounts the input / loses focus.
const inputCls = 'w-full border border-gray-200 rounded-sm px-2.5 py-1.5 text-sm focus:outline-none focus:border-hc-teal';
const Field = ({ label, val, onChange, ph }: { label: string; val: string; onChange: (v: string) => void; ph?: string }) => (
  <label className="block"><span className="text-[11px] font-mono uppercase tracking-wide text-gray-400">{label}</span>
    <input className={inputCls} value={val} placeholder={ph} onChange={e => onChange(e.target.value)} /></label>
);

export default function IntelligenceTab({ company }: { company: Company }) {
  const [data, setData] = useState<Intel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queuing, setQueuing] = useState(false);
  const [collectMsg, setCollectMsg] = useState('');
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState('');
  // Collection instruction (steering) profile
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileSource, setProfileSource] = useState<'saved' | 'generated' | ''>('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileOpen, setProfileOpen] = useState(false);

  const load = useCallback(async () => {
    if (!company.id) return;
    setLoading(true); setError('');
    // profile (steering instruction) — generated if not yet saved
    fetch(`/api/companies/${company.id}/collection-profile`).then(r => r.ok ? r.json() : null).then(j => {
      if (j?.profile) { setProfile(j.profile); setProfileSource(j.source); setProfileOpen(j.source !== 'saved'); }
    }).catch(() => {});
    try {
      const res = await fetch(`/api/companies/${company.id}/intelligence`);
      if (!res.ok) throw new Error('fetch failed');
      setData(await res.json());
    } catch { setError('Could not load intelligence data.'); } finally { setLoading(false); }
  }, [company.id]);

  useEffect(() => { setData(null); setAnswer(''); setQ(''); setCollectMsg(''); setProfile(null); setProfileMsg(''); load(); }, [load]);

  const saveProfile = async () => {
    if (!profile || !company.id) return;
    setSavingProfile(true); setProfileMsg('');
    try {
      const res = await fetch(`/api/companies/${company.id}/collection-profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) });
      if (!res.ok) throw new Error();
      setProfileSource('saved'); setProfileMsg('Saved — used on the next collection.');
    } catch { setProfileMsg('Could not save — please try again.'); } finally { setSavingProfile(false); }
  };

  const runCollection = async () => {
    if (!company.id) return;
    setQueuing(true); setCollectMsg('');
    try {
      if (profile) await fetch(`/api/companies/${company.id}/collection-profile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) }).catch(() => {});
      const res = await fetch(`/api/companies/${company.id}/collect`, { method: 'POST' });
      if (!res.ok) throw new Error();
      setCollectMsg('Collection queued with your instruction — it runs on the next worker cycle (up to ~30 min). Refresh this tab afterwards.');
    } catch { setCollectMsg('Could not queue collection — please try again.'); } finally { setQueuing(false); }
  };

  const ask = async (question: string) => {
    if (!question.trim()) return;
    setAsking(question); setAnswer('');
    const s = data?.seed;
    const framed = s ? `Context: analysing ${s.name} (${s.pk}; target ${s.target}; mechanism ${s.mechanism}; ${s.maxStage}). ${question}` : question;
    try {
      const res = await fetch('/api/graph/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: framed }) });
      const j = await res.json();
      setAnswer(res.ok ? (j.answer || '(no answer)') : (j.error || 'Ask failed'));
    } catch { setAnswer('Ask failed — please try again.'); } finally { setAsking(''); }
  };

  const CollectBtn = ({ label }: { label: string }) => (
    <button onClick={runCollection} disabled={queuing || !company.id}
      className="inline-flex items-center gap-1.5 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 rounded-sm transition-colors">
      {queuing ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Queuing…</> : <><RefreshCw className="w-3.5 h-3.5" /> {label}</>}
    </button>
  );

  // Editable collection instruction — inline JSX (not a component) so inputs keep focus.
  const profileCard = !profile ? null : (
    <details open={profileOpen} className="border border-gray-200 rounded-sm" onToggle={e => setProfileOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium flex items-center gap-2 select-none">
        <SlidersHorizontal className="w-4 h-4 text-hc-teal" /> Collection instruction
        <span className="text-[11px] font-normal text-gray-400">{profileSource === 'saved' ? 'saved — steers the worker' : 'auto-generated — edit to steer'}</span>
      </summary>
      <div className="border-t border-gray-100 p-4 space-y-3">
        <p className="text-xs text-gray-500">This is what the worker uses to find competitors. Correct the disease or target, and use <b>Notes</b> to narrow scope — e.g. a specific target/technology, or what to exclude. Saved before every collection.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Disease / indication" val={profile.diseaseName} onChange={v => setProfile({ ...profile, diseaseName: v })} ph="e.g. major depressive disorder" />
          <Field label="Drug target" val={profile.target ?? ''} onChange={v => setProfile({ ...profile, target: v || null })} ph="e.g. FcγRIIB" />
          <Field label="Mechanism / MoA" val={profile.mechanism ?? ''} onChange={v => setProfile({ ...profile, mechanism: v || null })} ph="e.g. FcγRIIB agonist antibody" />
          <label className="block"><span className="text-[11px] font-mono uppercase tracking-wide text-gray-400">Modality</span>
            <select className={inputCls} value={profile.modality} onChange={e => setProfile({ ...profile, modality: e.target.value })}>
              {MODALITIES.map(m => <option key={m} value={m}>{m}</option>)}
            </select></label>
          <Field label="Most advanced stage" val={profile.maxStage ?? ''} onChange={v => setProfile({ ...profile, maxStage: v || null })} ph="e.g. Phase 1" />
        </div>
        <label className="block"><span className="text-[11px] font-mono uppercase tracking-wide text-gray-400">Notes — additional steering</span>
          <textarea className={`${inputCls} resize-y`} rows={3} value={profile.notes}
            onChange={e => setProfile({ ...profile, notes: e.target.value })}
            placeholder="Narrow or steer the search: name a specific target/technology, competitor set, patient population, or what to exclude. The worker weights these terms most heavily." /></label>
        <div className="flex items-center gap-3">
          <button onClick={saveProfile} disabled={savingProfile || !profile.diseaseName.trim()}
            className="inline-flex items-center gap-1.5 border border-hc-teal text-hc-teal hover:bg-hc-teal-50 disabled:opacity-40 text-xs font-medium px-3 py-1.5 rounded-sm transition-colors">
            {savingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save instruction
          </button>
          {profileMsg && <span className="text-[12px] text-hc-teal">{profileMsg}</span>}
        </div>
      </div>
    </details>
  );

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading intelligence…</div>;
  if (error) return <div className="text-sm text-gray-500 py-6">{error} <button onClick={load} className="text-hc-teal underline ml-1">retry</button></div>;

  if (data && !data.collected) {
    return (
      <div className="max-w-2xl mx-auto py-8 space-y-5">
        <div className="text-center">
          <Network className="w-8 h-8 text-gray-300 mx-auto mb-3" />
          <h3 className="font-semibold text-[#1A1A1A] mb-1">No intelligence collected yet</h3>
          <p className="text-sm text-gray-500 mb-4">Review and steer the collection instruction below, then collect this company's competitive landscape into the knowledge graph.</p>
          <CollectBtn label="Collect intelligence" />
          {collectMsg
            ? <p className="text-[12px] text-hc-teal mt-3">{collectMsg}</p>
            : <p className="text-[11px] text-gray-400 mt-3">Collection runs in the background (scheduled worker).</p>}
        </div>
        {profileCard}
      </div>
    );
  }
  if (!data) return null;

  const programs = (data.programs ?? []) as Row[];
  const peers = programs.filter(p => ['BioCentury', 'PubMed'].includes(src(p)) && p.approved !== true).sort((a, b) => pr(String(b.stage)) - pr(String(a.stage)));
  const competitors = programs.filter(p => src(p) === 'ClinicalTrials.gov' && p.approved !== true).sort((a, b) => pr(String(b.stage)) - pr(String(a.stage)));
  const approved = programs.filter(p => p.approved === true);
  const deals = (data.deals ?? []) as Row[];
  const keyDeals = deals.filter(d => src(d) === 'BioCentury');
  const otherDeals = deals.filter(d => src(d) !== 'BioCentury');
  const fins = (data.financings ?? []) as Row[];
  const kols = (data.kols ?? []) as Row[];
  const pubs = (data.publications ?? []) as Row[];
  const s = data.seed!;
  const SUGGEST = [
    'Who are the most advanced competitors and how far ahead are they?',
    'Where is the white space in this landscape?',
    'What do the recent deals signal about appetite in this space?',
    'Which KOLs should we approach, and which are tied to competitors?',
  ];

  const ProgramTable = ({ rows, mechanism }: { rows: Row[]; mechanism?: boolean }) => (
    <div className="border border-gray-200 rounded-sm overflow-hidden">
      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0"><tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
            <th className="text-left font-semibold px-3 py-2">Company</th>
            <th className="text-left font-semibold px-3 py-2">Program</th>
            {mechanism ? <th className="text-left font-semibold px-3 py-2">Mechanism</th> : null}
            <th className="text-left font-semibold px-3 py-2">Phase</th>
            {!mechanism ? <th className="text-left font-semibold px-3 py-2">Status</th> : null}
          </tr></thead>
          <tbody>{rows.map((p, i) => (
            <tr key={i} className="border-t border-gray-100">
              <td className="px-3 py-2 font-medium">{first(p.company) || '—'}</td>
              <td className="px-3 py-2 text-gray-500">{String(p.program)}</td>
              {mechanism ? <td className="px-3 py-2 text-gray-500">{first(p.moa) || '—'}</td> : null}
              <td className="px-3 py-2"><Phase s={String(p.stage)} /></td>
              {!mechanism ? <td className="px-3 py-2 text-xs text-gray-400">{p.status === 'discontinued' ? <span className="text-amber-700 font-medium">discontinued</span> : 'active'}</td> : null}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Seed anchors + collect/refresh */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {[['Disease', s.pk], ['Target', s.target], ['Mechanism', s.mechanism], ['Modality', s.modality], ['Stage', s.maxStage]].filter(([, v]) => v && v !== '-').map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 border border-gray-200 bg-gray-50 px-2 py-1 rounded-sm">
            <span className="text-gray-400 font-mono uppercase tracking-wide">{k}</span><span className="font-medium text-[#1A1A1A]">{v}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          <button onClick={load} title="Refresh data" className="text-gray-400 hover:text-hc-teal"><RefreshCw className="w-3.5 h-3.5" /></button>
          <CollectBtn label="Re-collect" />
        </span>
      </div>
      {collectMsg && <p className="text-[12px] text-hc-teal -mt-3">{collectMsg}</p>}

      {/* Editable collection instruction */}
      {profileCard}

      {/* Ask the graph */}
      <div className="border border-hc-teal-100 bg-hc-teal-50/40 rounded-sm p-4">
        <div className="flex items-center gap-2 mb-2"><Sparkles className="w-4 h-4 text-hc-teal" /><h3 className="text-sm font-semibold text-[#1A1A1A]">Ask the graph</h3>
          <span className="text-[11px] text-gray-400">live over the whole knowledge graph</span></div>
        <div className="flex gap-2">
          <textarea value={q} onChange={e => setQ(e.target.value)} rows={2}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') ask(q); }}
            placeholder="Ask about competitors, deals, KOLs, white space…"
            className="flex-1 border border-gray-200 rounded-sm px-3 py-2 text-sm resize-y focus:outline-none focus:border-hc-teal" />
          <button onClick={() => ask(q)} disabled={!!asking || !q.trim()}
            className="shrink-0 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 text-white text-sm font-medium px-4 rounded-sm transition-colors">
            {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ask'}
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {SUGGEST.map(t => <button key={t} onClick={() => { setQ(t); ask(t); }} className="text-[11px] border border-gray-200 bg-white hover:border-hc-teal hover:text-hc-teal text-gray-600 px-2 py-1 rounded-full transition-colors">{t}</button>)}
        </div>
        {(asking || answer) && (
          <div className="mt-3 border-t border-hc-teal-100 pt-3">
            {asking && <div className="text-xs text-gray-500 mb-1">“{asking}”</div>}
            <div className="text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">{answer || <span className="text-gray-400 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Reasoning over the graph…</span>}</div>
          </div>
        )}
      </div>

      {/* Mechanism peers (highlighted) */}
      {peers.length > 0 && (
        <div><SectionHead icon={<Sparkles className="w-4 h-4" />} title="Mechanism peers" count={`${peers.length} · curated`} /><ProgramTable rows={peers} mechanism /></div>
      )}

      {/* Competitors — clinical pipeline */}
      {competitors.length > 0 ? (
        <div><SectionHead icon={<FlaskConical className="w-4 h-4" />} title="Competitors — clinical pipeline" count={`${competitors.length} industry programs`} /><ProgramTable rows={competitors} /></div>
      ) : peers.length === 0 && (
        <div className="text-sm text-gray-500 border border-dashed border-gray-200 rounded-sm px-4 py-6 text-center">
          No competitor programs in the graph for this slice yet. Edit the instruction above, then <button onClick={runCollection} className="text-hc-teal underline">Re-collect</button>.
        </div>
      )}

      {/* Deals & financings */}
      {(deals.length > 0 || fins.length > 0) && (
        <div>
          <SectionHead icon={<Handshake className="w-4 h-4" />} title="Deals & financings" count={`${deals.length} deals · ${fins.length} rounds`} />
          <div className="grid md:grid-cols-2 gap-3">
            <div className="border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400"><th className="text-left font-semibold px-3 py-2">Company</th><th className="text-left font-semibold px-3 py-2">Counterparty</th><th className="text-left font-semibold px-3 py-2">Value</th><th className="text-left font-semibold px-3 py-2">Yr</th></tr></thead>
                <tbody>{[...keyDeals, ...otherDeals].slice(0, 20).map((d, i) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{first(d.company) || '—'}</td><td className="px-3 py-2 text-gray-500">{first(d.counterparty) || '—'}{src(d) === 'BioCentury' && <span className="ml-1 text-[9px] text-purple-600 font-mono">BC</span>}</td><td className="px-3 py-2 font-mono text-xs">{first(d.value) || '—'}</td><td className="px-3 py-2 font-mono text-xs text-gray-400">{first(d.date).slice(0, 4)}</td></tr>)}</tbody>
              </table>
            </div>
            <div className="border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400"><th className="text-left font-semibold px-3 py-2">Financing</th><th className="text-left font-semibold px-3 py-2">Round</th><th className="text-left font-semibold px-3 py-2">Amount</th></tr></thead>
                <tbody>{fins.length ? fins.map((f, i) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{first(f.company) || '—'}</td><td className="px-3 py-2 text-gray-500">{String(f.round)}</td><td className="px-3 py-2 font-mono text-xs">{money(Number(f.amount))}</td></tr>) : <tr><td className="px-3 py-4 text-gray-400 text-xs" colSpan={3}>No financings on record.</td></tr>}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* KOLs */}
      {kols.length > 0 && (
        <div>
          <SectionHead icon={<GraduationCap className="w-4 h-4" />} title="Academic KOLs" count={kols.length} />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {kols.map((k, i) => <div key={i} className="border border-gray-200 rounded-sm px-3 py-2"><div className="font-medium text-sm">{String(k.name)}</div><div className="text-[11px] text-gray-500">{first(k.inst) || '—'} · {String(k.country)}</div><div className="text-[11px] text-gray-400 mt-0.5">Lead papers <b className="text-gray-700">{String(k.lead)}</b> / {String(k.total)} recent</div></div>)}
          </div>
        </div>
      )}

      {/* Publications */}
      {pubs.length > 0 && (
        <div>
          <SectionHead icon={<BookOpen className="w-4 h-4" />} title="Clinical evidence" count={`${pubs.length} · PubMed`} />
          <ul className="space-y-2">
            {pubs.map((p, i) => <li key={i} className="border border-gray-200 rounded-sm px-3 py-2">
              <div className="flex items-start gap-2"><div className="font-medium text-sm flex-1">{String(p.title)}</div>{first(p.doi) && <a href={`https://doi.org/${first(p.doi)}`} target="_blank" rel="noreferrer" className="text-hc-teal shrink-0 mt-0.5"><ExternalLink className="w-3.5 h-3.5" /></a>}</div>
              <div className="text-[11px] text-gray-500 font-mono mt-0.5">{String(p.venue)} {String(p.year)}{(Array.isArray(p.kol) && p.kol.length) ? ` · KOL: ${(p.kol as string[]).join(', ')}` : ''}</div>
              {first(p.findings) && <div className="text-xs text-gray-600 mt-1">{first(p.findings)}</div>}
            </li>)}
          </ul>
        </div>
      )}

      {/* Approved / marketed (collapsible context) */}
      {approved.length > 0 && (
        <details className="border border-gray-200 rounded-sm">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium flex justify-between items-center"><span className="flex items-center gap-2"><Users className="w-4 h-4 text-gray-400" /> Approved / marketed drugs (context)</span><span className="text-gray-400 font-mono text-xs">{approved.length}</span></summary>
          <div className="overflow-x-auto border-t border-gray-100"><table className="w-full text-sm"><tbody>{approved.map((p, i) => <tr key={i} className="border-t border-gray-100 first:border-t-0"><td className="px-3 py-1.5 font-medium">{first(p.company) || '—'}</td><td className="px-3 py-1.5 text-gray-500">{String(p.program)}</td></tr>)}</tbody></table></div>
        </details>
      )}

      <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">Sources: ClinicalTrials.gov · Open Targets · OpenAlex · SEC EDGAR · BioCentury · PubMed. Answers are generated live over the graph — verify material decisions against primary sources.</p>
    </div>
  );
}
