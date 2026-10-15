import { useState, useEffect, useCallback } from 'react';
import { Loader2, Sparkles, Network, RefreshCw, ExternalLink, FlaskConical, Handshake, Banknote, GraduationCap, BookOpen } from 'lucide-react';
import { Company } from '../../types';

// The Intelligence tab: the company's competitive graph slice shown inline
// (mechanism peers, clinical pipeline, deals, financings, KOLs, publications),
// plus an "ask the graph" box that reasons live over the whole knowledge graph.

interface Row { [k: string]: unknown }
interface Intel {
  collected: boolean;
  seed?: { name: string; pk: string; modality: string; target: string; mechanism: string; maxStage: string };
  programs?: Row[]; deals?: Row[]; financings?: Row[]; kols?: Row[]; publications?: Row[];
}
const first = (v: unknown): string => (Array.isArray(v) && v.length ? String(v[0]) : (v == null || v === '-' ? '' : String(v)));
const PH: Record<string, { l: string; late: boolean }> = {
  PRECLINICAL: { l: 'Preclinical', late: false }, EARLY_PHASE1: { l: 'Early Ph1', late: false },
  PHASE1: { l: 'Phase 1', late: false }, 'PHASE1/PHASE2': { l: 'Phase 1/2', late: false },
  PHASE2: { l: 'Phase 2', late: true }, 'PHASE2/PHASE3': { l: 'Phase 2/3', late: true },
  PHASE3: { l: 'Phase 3', late: true }, PHASE4: { l: 'Phase 4', late: true }, NA: { l: 'n/a', late: false },
};
const ph = (s: string) => PH[s] ?? { l: s || 'n/a', late: false };
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

export default function IntelligenceTab({ company }: { company: Company }) {
  const [data, setData] = useState<Intel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [queuing, setQueuing] = useState(false);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState('');
  const [asking, setAsking] = useState('');

  const load = useCallback(async () => {
    if (!company.id) return;
    setLoading(true); setError('');
    try {
      const res = await fetch(`/api/companies/${company.id}/intelligence`);
      if (!res.ok) throw new Error('fetch failed');
      setData(await res.json());
    } catch { setError('Could not load intelligence data.'); } finally { setLoading(false); }
  }, [company.id]);

  useEffect(() => { setData(null); setAnswer(''); setQ(''); load(); }, [load]);

  const runCollection = async () => {
    setQueuing(true);
    try { await fetch(`/api/companies/${company.id}/collect`, { method: 'POST' }); } finally { setQueuing(false); }
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

  if (loading) return <div className="flex items-center gap-2 text-gray-400 text-sm py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading intelligence…</div>;
  if (error) return <div className="text-sm text-gray-500 py-6">{error} <button onClick={load} className="text-hc-teal underline ml-1">retry</button></div>;

  if (data && !data.collected) {
    return (
      <div className="max-w-xl mx-auto text-center py-12">
        <Network className="w-8 h-8 text-gray-300 mx-auto mb-3" />
        <h3 className="font-semibold text-[#1A1A1A] mb-1">No intelligence collected yet</h3>
        <p className="text-sm text-gray-500 mb-5">Run collection to build this company's competitive landscape — competitors, deals, financings, KOLs and clinical evidence — into the knowledge graph.</p>
        <button onClick={runCollection} disabled={queuing || !company.id}
          className="inline-flex items-center gap-1.5 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 text-white text-sm font-medium px-4 py-2 rounded-sm transition-colors">
          {queuing ? <><Loader2 className="w-4 h-4 animate-spin" /> Queuing…</> : <><RefreshCw className="w-4 h-4" /> Run collection</>}
        </button>
        {queuing === false && <p className="text-[11px] text-gray-400 mt-3">Collection runs in the background (scheduled worker). Re-open this tab in a few minutes.</p>}
      </div>
    );
  }
  if (!data) return null;

  const programs = (data.programs ?? []) as Row[];
  const peers = programs.filter(p => ['BioCentury', 'PubMed'].includes(first(p.src)));
  const pipeline = programs.filter(p => first(p.src) === 'ClinicalTrials.gov' && p.approved !== true);
  const approved = programs.filter(p => p.approved === true);
  const deals = (data.deals ?? []) as Row[];
  const keyDeals = deals.filter(d => first(d.src) === 'BioCentury');
  const otherDeals = deals.filter(d => first(d.src) !== 'BioCentury');
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

  return (
    <div className="space-y-6">
      {/* Seed anchors */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        {[['Disease', s.pk], ['Target', s.target], ['Mechanism', s.mechanism], ['Modality', s.modality], ['Stage', s.maxStage]].filter(([, v]) => v && v !== '-').map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 border border-gray-200 bg-gray-50 px-2 py-1 rounded-sm">
            <span className="text-gray-400 font-mono uppercase tracking-wide">{k}</span><span className="font-medium text-[#1A1A1A]">{v}</span>
          </span>
        ))}
        <button onClick={load} title="Refresh" className="ml-auto text-gray-400 hover:text-hc-teal"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

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

      {/* Mechanism peers */}
      {peers.length > 0 && (
        <div>
          <SectionHead icon={<FlaskConical className="w-4 h-4" />} title="Mechanism peers" count={peers.length} />
          <div className="border border-gray-200 rounded-sm overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="text-left font-semibold px-3 py-2">Company</th><th className="text-left font-semibold px-3 py-2">Lead program</th><th className="text-left font-semibold px-3 py-2">Mechanism</th><th className="text-left font-semibold px-3 py-2">Stage</th></tr></thead>
              <tbody>{peers.map((p, i) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{first(p.company) || '—'}</td><td className="px-3 py-2 text-gray-500">{String(p.program)}</td><td className="px-3 py-2 text-gray-500">{first(p.moa) || '—'}</td><td className="px-3 py-2"><Phase s={String(p.stage)} /></td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}

      {/* Deals & financings */}
      {(deals.length > 0 || fins.length > 0) && (
        <div>
          <SectionHead icon={<Handshake className="w-4 h-4" />} title="Deals & financings" count={`${deals.length} deals · ${fins.length} rounds`} />
          <div className="grid md:grid-cols-2 gap-3">
            <div className="border border-gray-200 rounded-sm overflow-x-auto">
              <table className="w-full text-sm"><thead><tr className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-400"><th className="text-left font-semibold px-3 py-2">Company</th><th className="text-left font-semibold px-3 py-2">Counterparty</th><th className="text-left font-semibold px-3 py-2">Value</th><th className="text-left font-semibold px-3 py-2">Yr</th></tr></thead>
                <tbody>{[...keyDeals, ...otherDeals].slice(0, 20).map((d, i) => <tr key={i} className="border-t border-gray-100"><td className="px-3 py-2 font-medium">{first(d.company) || '—'}</td><td className="px-3 py-2 text-gray-500">{first(d.counterparty) || '—'}{first(d.src) === 'BioCentury' && <span className="ml-1 text-[9px] text-purple-600 font-mono">BC</span>}</td><td className="px-3 py-2 font-mono text-xs">{first(d.value) || '—'}</td><td className="px-3 py-2 font-mono text-xs text-gray-400">{first(d.date).slice(0, 4)}</td></tr>)}</tbody>
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

      {/* Context: pipeline + approved (collapsible) */}
      {(pipeline.length > 0 || approved.length > 0) && (
        <div className="space-y-2">
          <SectionHead icon={<Network className="w-4 h-4" />} title="Disease-wide context" count={`${pipeline.length} trials · ${approved.length} approved`} />
          {pipeline.length > 0 && (
            <details className="border border-gray-200 rounded-sm">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium flex justify-between">Industry clinical pipeline <span className="text-gray-400 font-mono text-xs">{pipeline.length}</span></summary>
              <div className="overflow-x-auto border-t border-gray-100"><table className="w-full text-sm"><tbody>{pipeline.map((p, i) => <tr key={i} className="border-t border-gray-100 first:border-t-0"><td className="px-3 py-1.5 font-medium">{first(p.company) || '—'}</td><td className="px-3 py-1.5 text-gray-500">{String(p.program)}</td><td className="px-3 py-1.5"><Phase s={String(p.stage)} /></td><td className="px-3 py-1.5 text-xs text-gray-400">{String(p.status)}</td></tr>)}</tbody></table></div>
            </details>
          )}
          {approved.length > 0 && (
            <details className="border border-gray-200 rounded-sm">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium flex justify-between">Approved / marketed drugs <span className="text-gray-400 font-mono text-xs">{approved.length}</span></summary>
              <div className="overflow-x-auto border-t border-gray-100"><table className="w-full text-sm"><tbody>{approved.map((p, i) => <tr key={i} className="border-t border-gray-100 first:border-t-0"><td className="px-3 py-1.5 font-medium">{first(p.company) || '—'}</td><td className="px-3 py-1.5 text-gray-500">{String(p.program)}</td></tr>)}</tbody></table></div>
            </details>
          )}
        </div>
      )}

      <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">Sources: ClinicalTrials.gov · Open Targets · OpenAlex · SEC EDGAR · BioCentury · PubMed. BioCentury/PubMed items are editorial/literature (trust tier inferred/structured). Answers are generated live over the graph — verify material decisions against primary sources.</p>
    </div>
  );
}
