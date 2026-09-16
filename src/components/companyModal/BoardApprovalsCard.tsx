import { Dispatch, SetStateAction, useEffect, useState } from 'react';
import { Stamp, Loader2, Check, PenLine, ExternalLink, RefreshCw } from 'lucide-react';
import { Company } from '../../types';
import { addHistory } from './helpers';

interface Props {
  form: Company;
  setForm: Dispatch<SetStateAction<Company>>;
  onAutoSave: (c: Company) => void;
  currentUser: string;
}

interface Doc { name: string; webUrl: string; }

export default function BoardApprovalsCard({ form, setForm, onAutoSave, currentUser }: Props) {
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [recSigned, setRecSigned] = useState(false);
  const [boardSigned, setBoardSigned] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genErr, setGenErr] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [sent, setSent] = useState<{ signers: string[] } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/companies/${form.id}/board-approvals`);
      const d = await res.json().catch(() => ({}));
      setDocs(d.docs ?? []);
      setRecSigned(!!d.recommendationSigned);
      setBoardSigned(!!d.boardSigned);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const bothReady = docs.length >= 2;

  const generate = async () => {
    setGenerating(true);
    setGenErr('');
    try {
      const res = await fetch(`/api/companies/${form.id}/board-approvals/generate`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || d.detail || 'Could not generate board approvals.');
      await load();
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : 'Could not generate board approvals.');
    } finally {
      setGenerating(false);
    }
  };

  const send = async () => {
    if (!bothReady || sending) return;
    setSending(true);
    setSendErr('');
    setSent(null);
    try {
      const res = await fetch(`/api/companies/${form.id}/board-approvals/send-for-signing`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || d.detail || 'Could not send for signing.');
      setSent({ signers: d.signers ?? [] });
      const now = new Date().toISOString();
      const updated = addHistory({ ...form, updatedAt: now }, {
        type: 'note_added', timestamp: now, user: currentUser,
        detail: `Board approvals sent for DocuSign signing to ${(d.signers ?? []).join(', ')}.`,
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
          <div className="text-sm font-semibold text-[#1A1A1A] flex items-center gap-1.5">
            <Stamp className="w-3.5 h-3.5 text-hc-teal" /> Board Approvals
          </div>
          <div className="text-xs text-gray-400 mt-0.5">
            Two Swedish board-meeting protocols (HealthCap IX D AB and E AB), generated automatically once the
            Investment Recommendation is signed. Sent to the four board members for signature in one envelope.
          </div>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          title="Refresh"
          className="flex items-center gap-1 shrink-0 text-xs text-gray-400 hover:text-hc-teal disabled:text-gray-300 px-2 py-1 rounded-sm transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="px-4 py-3">
        {bothReady ? (
          <>
            <div className="space-y-1.5">
              {docs.map((d) => (
                <div key={d.name} className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-600 truncate flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5 text-green-600 shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </span>
                  <a href={d.webUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-hc-teal hover:underline flex items-center gap-0.5 shrink-0">
                    Open <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={send}
                disabled={sending || boardSigned}
                title={boardSigned ? 'Already signed' : 'Send both protocols to the four board members'}
                className="flex items-center gap-1.5 border border-hc-teal text-hc-teal hover:bg-hc-teal-50 disabled:border-gray-200 disabled:text-gray-300 disabled:hover:bg-transparent text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
              >
                {sending ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending…</> : <><PenLine className="w-3 h-3" /> Send for signing</>}
              </button>
              {boardSigned && <span className="text-xs text-green-700 flex items-center gap-1.5"><Check className="w-3.5 h-3.5" /> Signed copy saved to SharePoint</span>}
            </div>
            {sent && (
              <div className="text-xs text-green-700 mt-2 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 shrink-0" /> Sent to {sent.signers.join(', ')} for signing.
              </div>
            )}
            {sendErr && <div className="text-xs text-red-500 mt-2">{sendErr}</div>}
          </>
        ) : (
          <div className="text-xs text-gray-500">
            {loading ? 'Checking…'
              : recSigned
                ? 'The recommendation is signed — the protocols should generate automatically. If they haven’t appeared, generate them now.'
                : 'These are generated automatically once the Investment Recommendation has been signed.'}
            {(recSigned || !loading) && (
              <div className="mt-2">
                <button
                  onClick={generate}
                  disabled={generating}
                  className="flex items-center gap-1.5 bg-hc-teal hover:bg-hc-teal-700 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
                >
                  {generating ? <><Loader2 className="w-3 h-3 animate-spin" /> Generating…</> : <><Stamp className="w-3 h-3" /> Generate board approvals</>}
                </button>
              </div>
            )}
            {genErr && <div className="text-xs text-red-500 mt-2">{genErr}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
