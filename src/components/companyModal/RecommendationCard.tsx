import { Dispatch, SetStateAction, useState } from 'react';
import { ClipboardCheck, Loader2, Download, Check, PenLine, Sparkles } from 'lucide-react';
import { Company, Attachment } from '../../types';
import { addHistory } from './helpers';
import { downloadBase64 } from '../../ui';

interface Signer { name: string; email: string; }
interface Verified { syndicate: string; amountAndTerms: string; preMoneyValuation: string; postMoneyValuation: string; }

interface Props {
  form: Company;
  setForm: Dispatch<SetStateAction<Company>>;
  onAutoSave: (c: Company) => void;
  currentUser: string;
  signers: Signer[];
}

const FIELDS: { key: keyof Verified; label: string }[] = [
  { key: 'syndicate', label: 'Syndicate' },
  { key: 'amountAndTerms', label: 'Amount and Terms' },
  { key: 'preMoneyValuation', label: 'Pre-money Valuation' },
  { key: 'postMoneyValuation', label: 'Post-money Valuation' },
];

export default function RecommendationCard({ form, setForm, onAutoSave, currentUser, signers }: Props) {
  const [preparing, setPreparing] = useState(false);
  const [verified, setVerified] = useState<Verified | null>(null);
  const [noProposal, setNoProposal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Attachment | null>(null);
  const [sp, setSp] = useState<{ url: string } | { error: string } | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const [signer1, setSigner1] = useState('');
  const [signer2, setSigner2] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [sent, setSent] = useState<{ signers: string[] } | null>(null);

  const recCount = form.attachments.filter((a) => /Investment Recommendation.*\.docx$/i.test(a.name)).length;
  const hasDoc = !!done || recCount > 0;
  const allVerified = !!verified && FIELDS.every((f) => verified[f.key].trim().length > 0);
  const twoChosen = !!signer1 && !!signer2 && signer1 !== signer2;

  const prepare = async () => {
    setPreparing(true);
    setErr('');
    try {
      const res = await fetch(`/api/companies/${form.id}/recommendation/prefill`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || d.detail || 'Could not prepare the recommendation.');
      setVerified(d.verified);
      setNoProposal(!d.hasProposal);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not prepare the recommendation.');
    } finally {
      setPreparing(false);
    }
  };

  const onGenerateClick = () => {
    if (hasDoc) { setConfirmRegen(true); return; }
    void generate();
  };

  const generate = async () => {
    if (!verified) return;
    setConfirmRegen(false);
    setGenerating(true);
    setErr('');
    setDone(null);
    setSp(null);
    try {
      const version = recCount + 1;
      const res = await fetch(`/api/companies/${form.id}/investment-recommendation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version, verified }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Generation failed');
      }
      const { attachment, sharePoint } = await res.json() as { attachment: Attachment; sharePoint: { url: string } | { error: string } | null };
      setSp(sharePoint);
      const now = new Date().toISOString();
      let updated: Company = { ...form, attachments: [...form.attachments, attachment] };
      updated = addHistory(updated, { type: 'file_added', timestamp: now, user: currentUser, detail: attachment.name });
      updated = { ...updated, updatedAt: now };
      setForm(updated);
      onAutoSave(updated);
      setDone(attachment);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not generate the recommendation.');
    } finally {
      setGenerating(false);
    }
  };

  const sendForSigning = async () => {
    if (!hasDoc || !twoChosen || sending) return;
    setSending(true);
    setSendErr('');
    setSent(null);
    try {
      const res = await fetch(`/api/companies/${form.id}/investment-recommendation/send-for-signing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerEmails: [signer1, signer2] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || d.detail || 'Could not send for signing.');
      setSent({ signers: d.signers ?? [] });
      const now = new Date().toISOString();
      const updated = addHistory({ ...form, updatedAt: now }, {
        type: 'note_added', timestamp: now, user: currentUser,
        detail: `Investment recommendation sent for DocuSign signing to ${(d.signers ?? []).join(' and ')}.`,
      });
      setForm(updated);
      onAutoSave(updated);
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : 'Could not send for signing.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border border-gray-200 bg-white rounded-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#1A1A1A]">Investment Recommendation</div>
          <div className="text-xs text-gray-400 mt-0.5">
            The final board-approval document. Verify the four deal terms, then generate — it drafts the rest from the
            company's Investment Proposal and record.
          </div>
        </div>
        {!verified && (
          <button
            onClick={prepare}
            disabled={preparing}
            className="flex items-center gap-1.5 shrink-0 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
          >
            {preparing
              ? <><Loader2 className="w-3 h-3 animate-spin" /> Preparing…</>
              : <><Sparkles className="w-3 h-3" /> Prepare</>}
          </button>
        )}
      </div>

      {verified && (
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1.5">
            <ClipboardCheck className="w-3.5 h-3.5 text-hc-teal" /> Verify deal terms
            <span className="text-gray-400 font-normal">— edit before generating</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="block">
                <span className="block text-[11px] text-gray-400 mb-0.5">{f.label}</span>
                <input
                  value={verified[f.key]}
                  onChange={(e) => setVerified({ ...verified, [f.key]: e.target.value })}
                  className="w-full text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white text-[#1A1A1A] focus:outline-none focus:border-hc-teal"
                />
              </label>
            ))}
          </div>
          {noProposal && (
            <div className="text-[11px] text-amber-600 mt-2">
              No Investment Proposal was found for this company — values were inferred from the record. Generate a proposal first for a stronger draft.
            </div>
          )}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={onGenerateClick}
              disabled={!allVerified || generating}
              className="flex items-center gap-1.5 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
            >
              {generating
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                : hasDoc ? <><ClipboardCheck className="w-3 h-3" /> Regenerate</> : <><ClipboardCheck className="w-3 h-3" /> Generate recommendation</>}
            </button>
            <button onClick={() => { setVerified(null); setNoProposal(false); }} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {confirmRegen && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
          <div className="text-xs text-amber-800">
            An investment recommendation already exists. Generating again saves a new version (v{recCount + 1}) alongside the existing one.
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => void generate()} className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-sm transition-colors">
              Generate v{recCount + 1}
            </button>
            <button onClick={() => setConfirmRegen(false)} className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded-sm transition-colors">Cancel</button>
          </div>
        </div>
      )}

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
      {done && sp && 'url' in sp && (
        <div className="px-4 pb-3 -mt-1">
          <a href={sp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-hc-teal hover:underline">Also saved to SharePoint ↗</a>
        </div>
      )}
      {done && sp && 'error' in sp && (
        <div className="px-4 pb-3 -mt-1 text-xs text-amber-600">Saved to Files, but the SharePoint copy failed.</div>
      )}
      {err && <div className="px-4 py-2.5 text-xs text-red-500">{err}</div>}

      {/* Signers */}
      <div className="px-4 py-3 border-t border-gray-100">
        <div className="text-xs font-medium text-gray-500 mb-1.5">Signers <span className="text-gray-400 font-normal">— choose two</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <select value={signer1} onChange={(e) => setSigner1(e.target.value)} className="text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white text-[#1A1A1A] focus:outline-none focus:border-hc-teal">
            <option value="">Select first signer…</option>
            {signers.filter((s) => s.email !== signer2).map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
          <select value={signer2} onChange={(e) => setSigner2(e.target.value)} className="text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white text-[#1A1A1A] focus:outline-none focus:border-hc-teal">
            <option value="">Select second signer…</option>
            {signers.filter((s) => s.email !== signer1).map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}
          </select>
        </div>
        <div className="mt-2">
          <button
            onClick={sendForSigning}
            disabled={!hasDoc || !twoChosen || sending}
            title={!hasDoc ? 'Generate a recommendation first' : !twoChosen ? 'Choose two signers' : 'Send to DocuSign'}
            className="flex items-center gap-1.5 border border-hc-teal text-hc-teal hover:bg-hc-teal-50 disabled:border-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
          >
            {sending ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</> : <><PenLine className="w-3 h-3" /> Send for signing</>}
          </button>
        </div>
        {sent && (
          <div className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 shrink-0" /> Sent to {sent.signers.join(' and ')} for signing.
          </div>
        )}
        {sendErr && <div className="text-xs text-red-500 mt-2">{sendErr}</div>}
      </div>
    </div>
  );
}
