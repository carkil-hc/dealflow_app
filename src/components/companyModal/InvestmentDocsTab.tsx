import { Dispatch, SetStateAction, useState } from 'react';
import { FileSignature, Loader2, Download, Check } from 'lucide-react';
import { Company, Attachment } from '../../types';
import { addHistory } from './helpers';
import { downloadBase64 } from '../../ui';

interface Props {
  form: Company;
  setForm: Dispatch<SetStateAction<Company>>;
  onAutoSave: (c: Company) => void;
  currentUser: string;
}

export default function InvestmentDocsTab({ form, setForm, onAutoSave, currentUser }: Props) {
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Attachment | null>(null);

  const generate = async () => {
    setGenerating(true);
    setErr('');
    setDone(null);
    try {
      const res = await fetch(`/api/companies/${form.id}/investment-proposal`, { method: 'POST' });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Generation failed');
      }
      const { attachment } = await res.json() as { attachment: Attachment };
      const now = new Date().toISOString();
      let updated: Company = { ...form, attachments: [...form.attachments, attachment] };
      updated = addHistory(updated, { type: 'file_added', timestamp: now, user: currentUser, detail: attachment.name });
      updated = { ...updated, updatedAt: now };
      setForm(updated);
      onAutoSave(updated);
      setDone(attachment);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not generate the proposal.');
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Generate HealthCap deal documents. Drafts are saved to the Files tab and should be reviewed before use.
      </p>

      {/* Investment Proposal */}
      <div className="border border-gray-200 bg-white rounded-sm">
        <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-[#1A1A1A]">Investment Proposal</div>
            <div className="text-xs text-gray-400 mt-0.5">
              Drafts the standard HealthCap investment proposal (.docx) from the company record and attached materials, matching the house template.
            </div>
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="flex items-center gap-1.5 shrink-0 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
          >
            {generating
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
              : <><FileSignature className="w-3 h-3" /> Generate proposal</>}
          </button>
        </div>
        {done && (
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm text-gray-600 flex items-center gap-1.5 min-w-0">
              <Check className="w-4 h-4 text-green-600 shrink-0" />
              <span className="truncate">Saved to Files: <span className="font-medium text-[#1A1A1A]">{done.name}</span></span>
            </span>
            <button
              onClick={() => done.data && downloadBase64(done.data, done.name, done.type)}
              className="flex items-center gap-1.5 shrink-0 text-xs text-gray-500 hover:text-hc-teal hover:bg-hc-teal-50 px-2 py-1 transition-colors rounded-sm"
            >
              <Download className="w-3 h-3" /> Download
            </button>
          </div>
        )}
        {err && <div className="px-4 py-2.5 text-xs text-red-500">{err}</div>}
      </div>

      {/* Investment Recommendation — next phase */}
      <div className="border border-dashed border-gray-200 bg-gray-50/60 rounded-sm px-4 py-3">
        <div className="text-sm font-semibold text-gray-500">Investment Recommendation</div>
        <div className="text-xs text-gray-400 mt-0.5">
          Generated once a deal progresses to investment — coming next.
        </div>
      </div>
    </div>
  );
}
