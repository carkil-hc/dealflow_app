import { Dispatch, SetStateAction, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import {
  Company, DDAssessment, DDRiskItem, RiskLevel,
  ddTemplateFor, ddItemStatus,
} from '../../types';
import Placeholder from './Placeholder';

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
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-sm ${
            overall === 'Complete' ? 'bg-[#E0F0F5] text-[#005B6E]'
            : overall === 'In progress' ? 'bg-amber-50 text-amber-700'
            : 'bg-gray-100 text-gray-500'
          }`}>
            {overall}
          </span>
        </div>
        {/* progress bar */}
        <div className="mt-2.5 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#005B6E] transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 text-[11px] text-gray-400">
        <span>Risk level:</span>
        <span className="text-green-700 font-medium">1 low</span>
        <span>→</span>
        <span className="text-red-700 font-medium">5 high</span>
      </div>

      {/* Risk items */}
      {items.map((item, idx) => (
        <div key={item.category} className="border border-gray-200 bg-white rounded-sm">
          <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[item.status]}`} />
                <span className="text-sm font-semibold text-[#1A1A1A]">{idx + 1}. {item.category}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">{item.question}</div>
            </div>
            {/* Risk level 1–5 */}
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
          <div className="px-4 py-3">
            <textarea
              value={item.comments}
              onChange={e => editComment(idx, e.target.value)}
              onBlur={commitComment}
              rows={2}
              placeholder="Findings, open questions, notes…"
              className="w-full border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white resize-y rounded-sm"
            />
          </div>
        </div>
      ))}

      <p className="text-[11px] text-gray-400">
        Changes save automatically. File- and meeting-sourced findings will appear here in later phases.
      </p>
    </div>
  );
}
