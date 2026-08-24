import { Dispatch, SetStateAction, useState } from 'react';
import { ClipboardCheck, ChevronRight, FileText, Loader2, Sparkles } from 'lucide-react';
import {
  Company, DDAssessment, DDRiskItem, DDFinding, RiskLevel,
  ddTemplateFor, ddItemStatus, uid,
} from '../../types';
import Placeholder from './Placeholder';
import { addHistory } from './helpers';
import DDDeckModal, { Deck } from './DDDeckModal';

interface Props {
  form: Company;
  setForm: Dispatch<SetStateAction<Company>>;
  onAutoSave: (c: Company) => void;
  currentUser: string;
}

// 1 = low risk (green) … 5 = high risk (red)
const RISK_STYLES: Record<RiskLevel, { on: string; off: string }> = {
  1: { on: 'bg-green-600 text-white border-green-600',     off: 'text-green-700 border-green-300 hover:bg-green-50' },
  2: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'text-emerald-700 border-emerald-300 hover:bg-emerald-50' },
  3: { on: 'bg-amber-500 text-white border-amber-500',     off: 'text-amber-700 border-amber-300 hover:bg-amber-50' },
  4: { on: 'bg-orange-600 text-white border-orange-600',   off: 'text-orange-700 border-orange-300 hover:bg-orange-50' },
  5: { on: 'bg-red-600 text-white border-red-600',         off: 'text-red-700 border-red-300 hover:bg-red-50' },
};

const STATUS_DOT: Record<string, string> = {
  not_started: 'bg-gray-300',
  in_progress: 'bg-amber-400',
  assessed: 'bg-[#005B6E]',
};

// Merge the stored assessment onto the template so every category is present,
// in template order, even if the stored data predates a template change.
function buildItems(form: Company, templateItems: { category: string; question: string }[]): DDRiskItem[] {
  const existing = new Map((form.ddAssessment?.items ?? []).map(i => [i.category, i]));
  return templateItems.map(t => {
    const e = existing.get(t.category);
    const comments = e?.comments ?? '';
    const riskLevel = e?.riskLevel ?? null;
    return { category: t.category, question: t.question, comments, riskLevel, status: ddItemStatus({ comments, riskLevel }), findings: e?.findings ?? [] };
  });
}

export default function DueDiligenceTab({ form, setForm, onAutoSave, currentUser }: Props) {
  const template = ddTemplateFor(form.sector);
  const [items, setItems] = useState<DDRiskItem[]>(() => (template ? buildItems(form, template.items) : []));
  // Collapsed by default so the tab reads as a summary log; expand to see detail.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (idx: number) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  const expandAll = () => setExpanded(new Set(items.map((_, i) => i)));
  const collapseAll = () => setExpanded(new Set());

  // PPTX generation
  const [deck, setDeck] = useState<Deck | null>(null);
  const [genScope, setGenScope] = useState<string | null>(null); // 'all' | category
  const [genErr, setGenErr] = useState('');

  const generate = async (dimension?: string) => {
    setGenScope(dimension ?? 'all');
    setGenErr('');
    try {
      const res = await fetch(`/api/companies/${form.id}/dd/pptx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dimension ? { dimension } : {}),
      });
      if (!res.ok) throw new Error('generation failed');
      const data: Deck = await res.json();
      setDeck(data);
      // The combined summary is a deliverable — save it to the Files tab too.
      if (!dimension) {
        const now = new Date().toISOString();
        let updated: Company = { ...form, attachments: [...form.attachments, data.attachment] };
        updated = addHistory(updated, { type: 'file_added', timestamp: now, user: currentUser, detail: data.attachment.name });
        updated = { ...updated, updatedAt: now };
        setForm(updated);
        onAutoSave(updated);
      }
    } catch {
      setGenErr('Could not generate the presentation. Make sure the company is saved, then try again.');
    } finally {
      setGenScope(null);
    }
  };

  if (!template) {
    return (
      <Placeholder
        icon={<ClipboardCheck className="w-8 h-8" />}
        title="No due diligence framework for this sector yet"
        subtitle="The structured framework is defined for Pharmaceutical companies. Set the sector to Pharmaceutical on the Company tab to use it."
      />
    );
  }

  // Persist the current items to the company (immediately, without closing).
  const commit = (next: DDRiskItem[]) => {
    const withStatus = next.map(i => ({ ...i, status: ddItemStatus(i) }));
    setItems(withStatus);
    const now = new Date().toISOString();
    const assessment: DDAssessment = { template: template.id, items: withStatus, updatedAt: now, updatedBy: currentUser };
    const updated: Company = { ...form, ddAssessment: assessment, updatedAt: now };
    setForm(updated);
    onAutoSave(updated);
  };

  // Comments update locally while typing; persist on blur.
  const editComment = (idx: number, text: string) =>
    setItems(prev => prev.map((it, i) => (i === idx ? { ...it, comments: text } : it)));
  const commitComment = () => commit(items);

  const setRisk = (idx: number, level: RiskLevel) =>
    commit(items.map((it, i) => (i === idx ? { ...it, riskLevel: it.riskLevel === level ? null : level } : it)));

  // ── File analysis (phase 2): draft findings from the company's attachments ──
  const [analyzing, setAnalyzing] = useState(false);

  const analyze = async () => {
    setAnalyzing(true);
    setGenErr('');
    try {
      const res = await fetch(`/api/companies/${form.id}/dd/analyze-files`, { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Analysis failed');
      }
      const { findings } = await res.json() as { findings: { category: string; text: string; sourceRef: string; riskLevelSuggested?: RiskLevel }[] };
      const now = new Date().toISOString();
      const byCat = new Map<string, DDFinding[]>();
      for (const f of findings) {
        const df: DDFinding = { id: uid(), text: f.text, source: 'file', sourceRef: f.sourceRef, riskLevelSuggested: f.riskLevelSuggested, createdAt: now, createdBy: currentUser };
        byCat.set(f.category, [...(byCat.get(f.category) ?? []), df]);
      }
      // Replace previous file-sourced findings; keep any from other sources.
      const next = items.map(it => {
        const kept = (it.findings ?? []).filter(x => x.source !== 'file');
        return { ...it, findings: [...kept, ...(byCat.get(it.category) ?? [])] };
      });
      commit(next);
      // Expand cards that received findings so the proposals are visible.
      setExpanded(prev => {
        const n = new Set(prev);
        items.forEach((it, i) => { if ((byCat.get(it.category)?.length ?? 0) > 0) n.add(i); });
        return n;
      });
      if (findings.length === 0) setGenErr('No findings could be extracted from the attached files.');
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Could not analyze files.');
    } finally {
      setAnalyzing(false);
    }
  };

  // Finding actions (per card)
  const applySuggested = (idx: number, level: RiskLevel) =>
    commit(items.map((it, i) => (i === idx ? { ...it, riskLevel: level } : it)));
  const addToNotes = (idx: number, text: string) =>
    commit(items.map((it, i) => (i === idx ? { ...it, comments: it.comments ? `${it.comments}\n${text}` : text } : it)));
  const dismissFinding = (idx: number, fid: string) =>
    commit(items.map((it, i) => (i === idx ? { ...it, findings: (it.findings ?? []).filter(f => f.id !== fid) } : it)));

  const assessed = items.filter(i => i.riskLevel != null).length;
  const highRisk = items.filter(i => i.riskLevel != null && i.riskLevel >= 4).length;
  const overall = assessed === 0 ? 'Not started' : assessed === items.length ? 'Complete' : 'In progress';
  const pct = Math.round((assessed / items.length) * 100);

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="border border-gray-200 bg-white px-4 py-3 rounded-sm">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[#1A1A1A]">Due Diligence — Pharmaceutical framework</div>
            <div className="text-xs text-gray-400 mt-0.5">
              {assessed}/{items.length} risk areas assessed
              {highRisk > 0 && <> · <span className="text-red-600 font-medium">{highRisk} high-risk</span></>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-sm ${
              overall === 'Complete' ? 'bg-[#E0F0F5] text-[#005B6E]'
              : overall === 'In progress' ? 'bg-amber-50 text-amber-700'
              : 'bg-gray-100 text-gray-500'
            }`}>
              {overall}
            </span>
            <button
              onClick={analyze}
              disabled={analyzing || genScope !== null}
              title="Draft findings from the files in the Files tab"
              className="flex items-center gap-1.5 border border-[#005B6E] text-[#005B6E] hover:bg-[#E0F0F5] disabled:border-gray-200 disabled:text-gray-400 text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
            >
              {analyzing
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Analyzing…</>
                : <><Sparkles className="w-3 h-3" /> Analyze DD files</>}
            </button>
            <button
              onClick={() => generate()}
              disabled={genScope !== null || analyzing}
              className="flex items-center gap-1.5 bg-[#005B6E] hover:bg-[#004A58] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
            >
              {genScope === 'all'
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                : <><FileText className="w-3 h-3" /> Generate DD summary</>}
            </button>
          </div>
        </div>
        {/* progress bar */}
        <div className="mt-2.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#005B6E] transition-all" style={{ width: `${pct}%` }} />
        </div>
        {genErr && <p className="text-xs text-red-500 mt-2">{genErr}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-400">
        <div className="flex items-center gap-2">
          <button onClick={expandAll} className="hover:text-[#005B6E] transition-colors">Expand all</button>
          <span className="text-gray-300">·</span>
          <button onClick={collapseAll} className="hover:text-[#005B6E] transition-colors">Collapse all</button>
        </div>
        <div className="flex items-center gap-2">
          <span>Risk level:</span>
          <span className="text-green-700 font-medium">1 low</span>
          <span>→</span>
          <span className="text-red-700 font-medium">5 high</span>
        </div>
      </div>

      {/* Risk items */}
      {items.map((item, idx) => {
        const isOpen = expanded.has(idx);
        return (
          <div key={item.category} className="border border-gray-200 bg-white rounded-sm">
            <div className={`px-4 py-3 flex items-center justify-between gap-4 ${isOpen ? 'border-b border-gray-100' : ''}`}>
              {/* Clickable title area toggles the card */}
              <button
                type="button"
                onClick={() => toggle(idx)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left"
              >
                <ChevronRight className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[item.status]}`} />
                <span className="text-sm font-semibold text-[#1A1A1A] truncate">{idx + 1}. {item.category}</span>
              </button>
              {/* Risk level 1–5 — always visible and clickable, collapsed or not */}
              <div className="flex items-center gap-1 shrink-0">
                {([1, 2, 3, 4, 5] as RiskLevel[]).map(level => {
                  const selected = item.riskLevel === level;
                  const s = RISK_STYLES[level];
                  return (
                    <button
                      key={level}
                      type="button"
                      onClick={() => setRisk(idx, level)}
                      title={selected ? 'Click to clear' : `Set risk level ${level}`}
                      className={`w-7 h-7 text-xs font-semibold border transition-colors rounded-sm ${selected ? s.on : `bg-white ${s.off}`}`}
                    >
                      {level}
                    </button>
                  );
                })}
              </div>
            </div>
            {isOpen && (
              <div className="px-4 py-3">
                <div className="text-xs text-gray-400 mb-2">{item.question}</div>
                <textarea
                  value={item.comments}
                  onChange={e => editComment(idx, e.target.value)}
                  onBlur={commitComment}
                  rows={3}
                  placeholder="Findings, open questions, notes…"
                  className="w-full border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white resize-y rounded-sm"
                />
                {/* AI-suggested findings from files (phase 2) */}
                {(item.findings ?? []).length > 0 && (
                  <div className="mt-3 space-y-2">
                    <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-[#005B6E]" /> Suggested findings
                    </div>
                    {(item.findings ?? []).map(f => (
                      <div key={f.id} className="border border-gray-100 bg-gray-50 px-3 py-2 rounded-sm">
                        <p className="text-sm text-gray-700">{f.text}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          {f.sourceRef && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 bg-white border border-gray-200 px-1.5 py-0.5 rounded-sm">
                              <FileText className="w-3 h-3" /> {f.sourceRef}
                            </span>
                          )}
                          {f.riskLevelSuggested && (
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 border bg-white rounded-sm ${RISK_STYLES[f.riskLevelSuggested].off}`}>
                              suggests {f.riskLevelSuggested}
                            </span>
                          )}
                          <div className="ml-auto flex items-center gap-1">
                            {f.riskLevelSuggested && (
                              <button
                                onClick={() => applySuggested(idx, f.riskLevelSuggested as RiskLevel)}
                                className="text-[11px] text-[#005B6E] hover:bg-[#E0F0F5] px-2 py-0.5 transition-colors rounded-sm"
                              >
                                Apply risk
                              </button>
                            )}
                            <button
                              onClick={() => addToNotes(idx, f.text)}
                              className="text-[11px] text-gray-500 hover:text-[#005B6E] hover:bg-[#E0F0F5] px-2 py-0.5 transition-colors rounded-sm"
                            >
                              Add to notes
                            </button>
                            <button
                              onClick={() => dismissFinding(idx, f.id)}
                              className="text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-0.5 transition-colors rounded-sm"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => generate(item.category)}
                    disabled={genScope !== null}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#005B6E] disabled:text-gray-300 px-2 py-1 hover:bg-[#E0F0F5] transition-colors rounded-sm"
                  >
                    {genScope === item.category
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                      : <><FileText className="w-3 h-3" /> Generate slides</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-[11px] text-gray-400">
        Changes save automatically. File- and meeting-sourced findings will appear here in later phases.
      </p>

      {deck && <DDDeckModal deck={deck} onClose={() => setDeck(null)} />}
    </div>
  );
}
