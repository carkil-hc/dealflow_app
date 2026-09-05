import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { FileSignature, Loader2, Download, Check, PenLine } from 'lucide-react';
import { Company, Attachment } from '../../types';
import { addHistory } from './helpers';
import { downloadBase64 } from '../../ui';
import RecommendationCard from './RecommendationCard';

interface Props {
  form: Company;
  setForm: Dispatch<SetStateAction<Company>>;
  onAutoSave: (c: Company) => void;
  currentUser: string;
}

interface Signer { name: string; email: string; }

export default function InvestmentDocsTab({ form, setForm, onAutoSave, currentUser }: Props) {
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Attachment | null>(null);
  const [sp, setSp] = useState<{ url: string } | { error: string } | null>(null);

  // Signing
  const [signers, setSigners] = useState<Signer[]>([]);
  const [signer1, setSigner1] = useState('');
  const [signer2, setSigner2] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [sent, setSent] = useState<{ envelopeId: string; signers: string[] } | null>(null);
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    fetch('/api/signers')
      .then((r) => r.json())
      .then((d) => setSigners(d.signers ?? []))
      .catch(() => setSigners([]));
  }, []);

  // A proposal exists if we just generated one, or one is already in Files.
  const proposalCount = form.attachments.filter((a) => /Investment Proposal.*\.docx$/i.test(a.name)).length;
  const hasProposal = !!done || proposalCount > 0;
  const twoChosen = !!signer1 && !!signer2 && signer1 !== signer2;
  const canSend = hasProposal && twoChosen && !sending;

  // Guard against accidental duplicates: if a proposal already exists, ask first.
  const onGenerateClick = () => {
    if (hasProposal) { setConfirmRegen(true); return; }
    void generate();
  };

  const generate = async () => {
    setConfirmRegen(false);
    setGenerating(true);
    setErr('');
    setDone(null);
    setSp(null);
    try {
      const version = proposalCount + 1; // v1 = first, v2+ get a suffix
      const res = await fetch(`/api/companies/${form.id}/investment-proposal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || 'Generation failed');
      }
      const { attachment, sharePoint } = await res.json() as { attachment: Attachment; sharePoint: { url: string } | { error: string } | null };
      setSp(sharePoint);
      const now = new Date().toISOString();
      // Keep prior versions; each regeneration is saved as a new (vN) file.
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

  const sendForSigning = async () => {
    if (!canSend) return;
    setSending(true);
    setSendErr('');
    setSent(null);
    try {
      const res = await fetch(`/api/companies/${form.id}/investment-proposal/send-for-signing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerEmails: [signer1, signer2] }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || d.detail || 'Could not send for signing.');
      setSent({ envelopeId: d.envelopeId, signers: d.signers ?? [] });
      const now = new Date().toISOString();
      const updated = addHistory({ ...form, updatedAt: now }, {
        type: 'note_added', timestamp: now, user: currentUser,
        detail: `Investment proposal sent for DocuSign signing to ${(d.signers ?? []).join(' and ')}.`,
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
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onGenerateClick}
              disabled={generating}
              className="flex items-center gap-1.5 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
            >
              {generating
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</>
                : hasProposal
                  ? <><FileSignature className="w-3 h-3" /> Regenerate</>
                  : <><FileSignature className="w-3 h-3" /> Generate proposal</>}
            </button>
            <button
              onClick={sendForSigning}
              disabled={!canSend}
              title={!hasProposal ? 'Generate a proposal first' : !twoChosen ? 'Choose two signers' : 'Send to DocuSign'}
              className="flex items-center gap-1.5 border border-hc-teal text-hc-teal hover:bg-hc-teal-50 disabled:border-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
            >
              {sending
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</>
                : <><PenLine className="w-3 h-3" /> Send for signing</>}
            </button>
          </div>
        </div>

        {confirmRegen && (
          <div className="px-4 py-3 bg-amber-50 border-b border-amber-100">
            <div className="text-xs text-amber-800">
              An investment proposal already exists for this company. Generating again saves a new
              version (v{proposalCount + 1}) alongside the existing one, in both Files and SharePoint.
            </div>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={() => void generate()}
                className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded-sm transition-colors"
              >
                Generate v{proposalCount + 1}
              </button>
              <button
                onClick={() => setConfirmRegen(false)}
                className="text-xs text-gray-500 hover:text-gray-700 px-3 py-1 rounded-sm transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
        {generating && (
          <div className="px-4 py-2.5 text-xs text-gray-400">
            Reading the materials and drafting — this can take a minute or two. The document will appear in the Files tab when ready.
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
            <a href={sp.url} target="_blank" rel="noopener noreferrer" className="text-xs text-hc-teal hover:underline">
              Also saved to SharePoint ↗
            </a>
          </div>
        )}
        {done && sp && 'error' in sp && (
          <div className="px-4 pb-3 -mt-1 text-xs text-amber-600">Saved to Files, but the SharePoint copy failed (permissions still propagating?).</div>
        )}
        {err && <div className="px-4 py-2.5 text-xs text-red-500">{err}</div>}

        {/* Signers — both required before sending */}
        <div className="px-4 py-3 border-t border-gray-100">
          <div className="text-xs font-medium text-gray-500 mb-1.5">Signers <span className="text-gray-400 font-normal">— choose two</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={signer1}
              onChange={(e) => setSigner1(e.target.value)}
              className="text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white text-[#1A1A1A] focus:outline-none focus:border-hc-teal"
            >
              <option value="">Select first signer…</option>
              {signers.filter((s) => s.email !== signer2).map((s) => (
                <option key={s.email} value={s.email}>{s.name}</option>
              ))}
            </select>
            <select
              value={signer2}
              onChange={(e) => setSigner2(e.target.value)}
              className="text-xs border border-gray-200 rounded-sm px-2 py-1.5 bg-white text-[#1A1A1A] focus:outline-none focus:border-hc-teal"
            >
              <option value="">Select second signer…</option>
              {signers.filter((s) => s.email !== signer1).map((s) => (
                <option key={s.email} value={s.email}>{s.name}</option>
              ))}
            </select>
          </div>
          {!hasProposal && (
            <div className="text-[11px] text-gray-400 mt-1.5">Generate a proposal first — the SharePoint copy is what gets sent for signing.</div>
          )}
          {sent && (
            <div className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 shrink-0" />
              Sent to {sent.signers.join(' and ')} for signing.
            </div>
          )}
          {sendErr && <div className="text-xs text-red-500 mt-2">{sendErr}</div>}
        </div>
      </div>

      {/* Investment Recommendation */}
      <RecommendationCard form={form} setForm={setForm} onAutoSave={onAutoSave} currentUser={currentUser} signers={signers} />
    </div>
  );
}
