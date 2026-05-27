import { useState, useEffect } from 'react';
import {
  X, ArrowRight, XCircle, RotateCcw, Trash2, Save, ChevronRight,
  Building2, Briefcase, MessageSquare, Paperclip, History, FlaskConical,
  PlusCircle, ArrowRightCircle, StickyNote, FileUp, FileX, AlertCircle, RefreshCw,
  Play, Loader2, Copy, Check,
} from 'lucide-react';
import {
  Company, Stage, Strategy, STAGE_CONFIG, ACTIVE_STAGES, PIPELINE_STAGES, NEXT_STAGE,
  SECTORS, STRATEGIES, DEVELOPMENT_STAGES, THERAPEUTIC_AREAS, FUNDING_STAGES, NEXT_MILESTONES,
  NoteEntry, HistoryEntry, formatDate, formatDateTime,
} from '../types';
import FileUpload from './FileUpload';
import NoteTimeline from './NoteTimeline';

// ── Agent report card ──────────────────────────────────────────────────────

interface AgentReportCardProps {
  title: string;
  description: string;
  companyId: string;
  reportKey: string;
  report: { text: string; runAt: string } | null;
  running: boolean;
  copied: boolean;
  onRun: () => void;
  onCopy: (text: string) => void;
  onSaveAsNote: () => void;
}

function AgentReportCard({ title, description, report, running, copied, onRun, onCopy, onSaveAsNote }: AgentReportCardProps) {
  return (
    <div className="border border-gray-200 bg-white" style={{ borderRadius: 2 }}>
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-[#1A1A1A]">{title}</div>
          <div className="text-xs text-gray-400 mt-0.5">{description}</div>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className="flex items-center gap-1.5 shrink-0 bg-[#005B6E] hover:bg-[#004A58] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors"
          style={{ borderRadius: 2 }}
        >
          {running
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Running…</>
            : <><Play className="w-3 h-3" /> {report ? 'Re-run' : 'Run'}</>
          }
        </button>
      </div>

      {report && (
        <div className="px-4 py-3">
          <div className="text-[11px] text-gray-400 mb-2">
            Generated {new Date(report.runAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
          <div className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 px-3 py-3 max-h-80 overflow-y-auto" style={{ borderRadius: 2 }}>
            {report.text}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={() => onCopy(report.text)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#005B6E] px-2 py-1 hover:bg-[#E0F0F5] transition-colors"
              style={{ borderRadius: 2 }}
            >
              {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </button>
            <button
              onClick={onSaveAsNote}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#005B6E] px-2 py-1 hover:bg-[#E0F0F5] transition-colors"
              style={{ borderRadius: 2 }}
            >
              <StickyNote className="w-3 h-3" /> Save as note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── History log component ──────────────────────────────────────────────────

const EVENT_CONFIG: Record<string, { icon: React.ReactNode; color: string; label: (e: HistoryEntry) => string }> = {
  created:       { icon: <PlusCircle className="w-3.5 h-3.5" />, color: 'text-[#005B6E]', label: () => 'Deal created' },
  stage_changed: { icon: <ArrowRightCircle className="w-3.5 h-3.5" />, color: 'text-blue-500', label: e => `Moved from ${STAGE_CONFIG[e.fromStage as Stage]?.label ?? e.fromStage} → ${STAGE_CONFIG[e.toStage as Stage]?.label ?? e.toStage}` },
  note_added:    { icon: <StickyNote className="w-3.5 h-3.5" />, color: 'text-violet-500', label: () => 'Note added' },
  note_edited:   { icon: <StickyNote className="w-3.5 h-3.5" />, color: 'text-violet-400', label: () => 'Note edited' },
  note_deleted:  { icon: <StickyNote className="w-3.5 h-3.5" />, color: 'text-gray-400',   label: () => 'Note deleted' },
  file_added:    { icon: <FileUp className="w-3.5 h-3.5" />,     color: 'text-amber-500',  label: e => `File attached${e.detail ? `: ${e.detail}` : ''}` },
  file_removed:  { icon: <FileX className="w-3.5 h-3.5" />,     color: 'text-gray-400',   label: e => `File removed${e.detail ? `: ${e.detail}` : ''}` },
  rejected:      { icon: <AlertCircle className="w-3.5 h-3.5" />, color: 'text-red-500',  label: e => e.detail ? `Rejected: ${e.detail}` : 'Rejected' },
  reactivated:   { icon: <RefreshCw className="w-3.5 h-3.5" />,  color: 'text-green-600', label: () => 'Reactivated' },
};

function HistoryLog({ history }: { history: HistoryEntry[] }) {
  const sorted = [...history].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center py-14 text-center">
        <History className="w-8 h-8 text-gray-200 mb-2" />
        <p className="text-sm text-gray-400">No history yet</p>
        <p className="text-xs text-gray-300 mt-1">Events will appear here as the deal progresses</p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {sorted.map((entry, i) => {
        const cfg = EVENT_CONFIG[entry.type] ?? EVENT_CONFIG.created;
        return (
          <div key={entry.id} className="flex gap-3 group">
            {/* Timeline line + dot */}
            <div className="flex flex-col items-center shrink-0">
              <div className={`w-7 h-7 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center shrink-0 ${cfg.color}`}>
                {cfg.icon}
              </div>
              {i < sorted.length - 1 && <div className="w-px flex-1 bg-gray-100 my-1" />}
            </div>
            {/* Content */}
            <div className="pb-4 pt-1 min-w-0 flex-1">
              <p className="text-sm text-[#1A1A1A] font-medium leading-snug">{cfg.label(entry)}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {entry.user && <span className="text-xs text-gray-400">{entry.user}</span>}
                {entry.user && <span className="text-gray-200 text-xs">·</span>}
                <span className="text-xs text-gray-400">{formatDateTime(entry.timestamp)}</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Props {
  company: Company | null;
  currentUser: string;
  onSave: (c: Company) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

type Tab = 'info' | 'deal' | 'notes' | 'files' | 'history' | 'dd_reports';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'info',       label: 'Company',    icon: <Building2 className="w-3.5 h-3.5" /> },
  { id: 'deal',       label: 'Deal',       icon: <Briefcase className="w-3.5 h-3.5" /> },
  { id: 'notes',      label: 'Notes',      icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: 'files',      label: 'Files',      icon: <Paperclip className="w-3.5 h-3.5" /> },
  { id: 'history',    label: 'History',    icon: <History className="w-3.5 h-3.5" /> },
  { id: 'dd_reports', label: 'DD Reports', icon: <FlaskConical className="w-3.5 h-3.5" /> },
];

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function addHistory(form: Company, entry: Omit<HistoryEntry, 'id'>): Company {
  return { ...form, history: [...(form.history || []), { id: uid(), ...entry }] };
}

function newCompany(owner?: string): Company {
  const now = new Date().toISOString();
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: '', description: '', stage: 'new',
    owner,
    noteEntries: [], attachments: [], history: [],
    createdAt: now, updatedAt: now,
  };
}

const REJECTION_REASONS = [
  'Too early',
  'Too late',
  'Not in scope',
  'Data strength',
  'No IP',
  'Market opportunity',
];

// Shared input class
const INPUT = 'w-full border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white';
const LABEL = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';

export default function CompanyModal({ company, currentUser, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<Company>(() => company ?? newCompany(currentUser));
  const [tab, setTab] = useState<Tab>('info');
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [errors, setErrors] = useState<{ name?: string }>({});
  const [ddReports, setDdReports] = useState<Record<string, { text: string; runAt: string } | null>>({});
  const [ddRunning, setDdRunning] = useState<Record<string, boolean>>({});
  const [ddCopied, setDdCopied] = useState<Record<string, boolean>>({});

  const isNew = !company;

  useEffect(() => {
    setForm(company ?? newCompany(currentUser));
    setTab('info');
    setErrors({});
  }, [company]);

  const set = <K extends keyof Company>(key: K, value: Company[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const validate = () => {
    const e: { name?: string } = {};
    if (!form.name.trim()) e.name = 'Company name is required';
    setErrors(e);
    return !Object.keys(e).length;
  };

  const handleSave = () => {
    if (!validate()) return;
    const now = new Date().toISOString();
    let updated = { ...form, updatedAt: now };
    if (isNew) {
      updated = addHistory(updated, { type: 'created', timestamp: now, user: currentUser });
    } else if (company && company.stage !== form.stage) {
      updated = addHistory(updated, {
        type: 'stage_changed', timestamp: now, user: currentUser,
        fromStage: company.stage, toStage: form.stage,
      });
    }
    onSave(updated);
  };

  const handleAdvance = () => {
    const next = NEXT_STAGE[form.stage];
    if (!next) return;
    const now = new Date().toISOString();
    let u = { ...form, stage: next as Stage, updatedAt: now };
    u = addHistory(u, { type: 'stage_changed', timestamp: now, user: currentUser, fromStage: form.stage, toStage: next });
    setForm(u); onSave(u);
  };

  const handleReject = () => {
    const now = new Date().toISOString();
    let u: Company = { ...form, stage: 'rejected', rejectedReason: rejectReason, rejectedAt: now, updatedAt: now };
    u = addHistory(u, { type: 'rejected', timestamp: now, user: currentUser, fromStage: form.stage, detail: rejectReason || undefined });
    setForm(u); onSave(u); setShowRejectDialog(false);
  };

  const handleReactivate = () => {
    const now = new Date().toISOString();
    let u: Company = { ...form, stage: 'new', rejectedReason: undefined, rejectedAt: undefined, updatedAt: now };
    u = addHistory(u, { type: 'reactivated', timestamp: now, user: currentUser });
    setForm(u); onSave(u);
  };

  const handleNoteChange = (entries: NoteEntry[]) => {
    const now = new Date().toISOString();
    const added = entries.find(e => !form.noteEntries.some(n => n.id === e.id));
    const removed = form.noteEntries.find(n => !entries.some(e => e.id === n.id));
    const edited = entries.find(e => {
      const prev = form.noteEntries.find(n => n.id === e.id);
      return prev && prev.text !== e.text;
    });
    let updated = { ...form, noteEntries: entries };
    if (added) updated = addHistory(updated, { type: 'note_added', timestamp: now, user: currentUser });
    if (removed) updated = addHistory(updated, { type: 'note_deleted', timestamp: now, user: currentUser });
    if (edited) updated = addHistory(updated, { type: 'note_edited', timestamp: now, user: currentUser });
    setForm(updated);
  };

  const handleFileChange = (atts: typeof form.attachments) => {
    const now = new Date().toISOString();
    const added = atts.find(a => !form.attachments.some(x => x.id === a.id));
    const removed = form.attachments.find(a => !atts.some(x => x.id === a.id));
    let updated = { ...form, attachments: atts };
    if (added) updated = addHistory(updated, { type: 'file_added', timestamp: now, user: currentUser, detail: added.name });
    if (removed) updated = addHistory(updated, { type: 'file_removed', timestamp: now, user: currentUser, detail: removed.name });
    setForm(updated);
  };

  const cfg = STAGE_CONFIG[form.stage];
  const nextStage = NEXT_STAGE[form.stage];
  const isRejected = form.stage === 'rejected';
  const isBackburner = form.stage === 'backburner';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-8 px-4 pb-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-gray-200" style={{ borderRadius: 2 }}>

        {/* Header — HealthCap style: white with teal left border accent */}
        <div className="border-b border-gray-200 px-6 py-4 flex items-center justify-between bg-white">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-1 h-8 rounded-full shrink-0 ${cfg.dot}`} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold uppercase tracking-wider ${cfg.badgeText}`}>{cfg.label}</span>
                {!isNew && <span className="text-gray-300 text-xs">·</span>}
                {!isNew && <span className="text-[11px] text-gray-400">{formatDate(form.createdAt)}</span>}
              </div>
              {form.name
                ? <h2 className="font-bold text-lg text-[#1A1A1A] leading-tight truncate mt-0.5">{form.name}</h2>
                : <h2 className="font-bold text-lg text-gray-300 leading-tight mt-0.5">New Company</h2>
              }
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1A1A1A] transition-colors ml-4 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pipeline breadcrumb */}
        {!isBackburner && (
          <div className="bg-gray-50 border-b border-gray-200 px-6 py-2 flex items-center gap-1 text-[11px] overflow-x-auto">
            {PIPELINE_STAGES.map((s, i) => {
              const sc = STAGE_CONFIG[s];
              const currentIdx = PIPELINE_STAGES.indexOf(form.stage as Stage);
              const isActive = s === form.stage;
              const isPast = i < currentIdx;
              return (
                <span key={s} className="flex items-center gap-1 shrink-0">
                  {i > 0 && <ChevronRight className="w-3 h-3 text-gray-300" />}
                  <span className={`px-2 py-0.5 font-medium ${
                    isActive ? `${sc.badgeBg} ${sc.badgeText}` : isPast ? 'text-gray-300 line-through' : 'text-gray-400'
                  }`} style={{ borderRadius: 2 }}>
                    {sc.shortLabel}
                  </span>
                </span>
              );
            })}
            {isRejected && (
              <span className="flex items-center gap-1 shrink-0">
                <ChevronRight className="w-3 h-3 text-gray-300" />
                <span className="px-2 py-0.5 font-medium bg-red-50 text-red-600" style={{ borderRadius: 2 }}>Rejected</span>
              </span>
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-white px-6">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-[#005B6E] text-[#005B6E]'
                  : 'border-transparent text-gray-400 hover:text-[#1A1A1A]'
              }`}
            >
              {t.icon}
              {t.label}
              {t.id === 'files' && form.attachments.length > 0 && (
                <span className="bg-[#E0F0F5] text-[#005B6E] text-[10px] font-bold px-1.5 py-0.5 leading-none" style={{ borderRadius: 2 }}>
                  {form.attachments.length}
                </span>
              )}
              {t.id === 'notes' && form.noteEntries.length > 0 && (
                <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 leading-none" style={{ borderRadius: 2 }}>
                  {form.noteEntries.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* ── Company tab ── */}
          {tab === 'info' && (
            <div className="space-y-5">
              {/* Name + description */}
              <div>
                <label className={LABEL}>Company Name <span className="text-red-400 normal-case font-normal">*</span></label>
                <input type="text" value={form.name}
                  onChange={e => set('name', e.target.value)}
                  placeholder="e.g. Genomica Therapeutics"
                  className={`${INPUT} ${errors.name ? 'border-red-400' : ''}`} style={{ borderRadius: 2 }} />
                {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className={LABEL}>Description</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)}
                  rows={3} placeholder="Brief description of the company and its technology…"
                  className={`${INPUT} resize-none`} style={{ borderRadius: 2 }} />
              </div>

              {/* 2-col grid */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Sector</label>
                  <select value={form.sector || ''} onChange={e => set('sector', e.target.value || undefined)}
                    className={INPUT} style={{ borderRadius: 2 }}>
                    <option value="">Select…</option>
                    {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Therapeutic Area</label>
                  <select value={form.therapeuticArea || ''} onChange={e => set('therapeuticArea', e.target.value || undefined)}
                    className={INPUT} style={{ borderRadius: 2 }}>
                    <option value="">Select…</option>
                    {THERAPEUTIC_AREAS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Strategy</label>
                  <div className="flex gap-2 flex-wrap pt-0.5">
                    {STRATEGIES.map(s => (
                      <button key={s} type="button"
                        onClick={() => set('strategy', s as Strategy)}
                        className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                          (form.strategy ?? 'N/a') === s
                            ? 'bg-[#005B6E] text-white border-[#005B6E]'
                            : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                        }`} style={{ borderRadius: 2 }}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={LABEL}>Owner</label>
                  <input type="text" value={form.owner || ''}
                    onChange={e => set('owner', e.target.value || undefined)}
                    placeholder="e.g. Carl" className={INPUT} style={{ borderRadius: 2 }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Development Stage</label>
                  <select value={form.developmentStage || ''} onChange={e => set('developmentStage', e.target.value || undefined)}
                    className={INPUT} style={{ borderRadius: 2 }}>
                    <option value="">Select…</option>
                    {DEVELOPMENT_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>Next Milestone</label>
                  <select value={form.nextMilestone || ''} onChange={e => set('nextMilestone', e.target.value || undefined)}
                    className={INPUT} style={{ borderRadius: 2 }}>
                    <option value="">Select…</option>
                    {NEXT_MILESTONES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Country</label>
                  <input type="text" value={form.location || ''}
                    onChange={e => set('location', e.target.value || undefined)}
                    placeholder="e.g. Sweden" className={INPUT} style={{ borderRadius: 2 }} />
                </div>
                <div>
                  <label className={LABEL}>Website</label>
                  <input type="url" value={form.website || ''}
                    onChange={e => set('website', e.target.value || undefined)}
                    placeholder="https://…" className={INPUT} style={{ borderRadius: 2 }} />
                </div>
              </div>

              {/* Pipeline stage selector */}
              <div>
                <label className={LABEL}>Pipeline Stage</label>
                <div className="flex flex-wrap gap-2">
                  {([...ACTIVE_STAGES, 'rejected' as Stage]).map((s) => {
                    const sc = STAGE_CONFIG[s];
                    return (
                      <button key={s} type="button"
                        onClick={() => s === 'rejected' ? setShowRejectDialog(true) : set('stage', s)}
                        className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                          form.stage === s
                            ? `${sc.badgeBg} ${sc.badgeText} border-current`
                            : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                        }`} style={{ borderRadius: 2 }}>
                        {sc.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {form.stage === 'backburner' && (
                <div className="bg-stone-50 border border-stone-200 px-4 py-3" style={{ borderRadius: 2 }}>
                  <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
                    Follow-up Reminder
                  </label>
                  <input
                    type="date"
                    value={form.backburnerReminder || ''}
                    onChange={e => set('backburnerReminder', e.target.value || undefined)}
                    className="w-full border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-stone-400 bg-white"
                    style={{ borderRadius: 2 }}
                  />
                </div>
              )}

              {isRejected && form.rejectedReason && (
                <div className="bg-red-50 border border-red-100 px-4 py-3" style={{ borderRadius: 2 }}>
                  <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-1">Rejection Reason</p>
                  <p className="text-sm text-red-700">{form.rejectedReason}</p>
                  {form.rejectedAt && <p className="text-[11px] text-red-400 mt-1">Rejected {formatDate(form.rejectedAt)}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── Deal tab ── */}
          {tab === 'deal' && (
            <div className="space-y-5">
              <div>
                <label className={LABEL}>Owner</label>
                <input type="text" value={form.owner || ''}
                  onChange={e => set('owner', e.target.value || undefined)}
                  placeholder="e.g. Anna Lindqvist"
                  className={INPUT} style={{ borderRadius: 2 }} />
              </div>

              <div className="border-t border-gray-100 pt-5">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={LABEL}>Financial Stage</label>
                    <select value={form.fundingStage || ''} onChange={e => set('fundingStage', e.target.value || undefined)}
                      className={INPUT} style={{ borderRadius: 2 }}>
                      <option value="">Select…</option>
                      {FUNDING_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={LABEL}>Ask Amount</label>
                    <input type="text" value={form.askAmount || ''}
                      onChange={e => set('askAmount', e.target.value || undefined)}
                      placeholder="e.g. €15M" className={INPUT} style={{ borderRadius: 2 }} />
                  </div>
                </div>
              </div>

              <div>
                <label className={LABEL}>Pre-Money Valuation</label>
                <input type="text" value={form.valuation || ''}
                  onChange={e => set('valuation', e.target.value || undefined)}
                  placeholder="e.g. €60M" className={INPUT} style={{ borderRadius: 2 }} />
              </div>

              <div className="border-t border-gray-100 pt-5">
                <label className={LABEL}>Lead Contact</label>
                <input type="text" value={form.leadContact || ''}
                  onChange={e => set('leadContact', e.target.value || undefined)}
                  placeholder="Full name" className={INPUT} style={{ borderRadius: 2 }} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Email</label>
                  <input type="email" value={form.email || ''}
                    onChange={e => set('email', e.target.value || undefined)}
                    placeholder="contact@company.com" className={INPUT} style={{ borderRadius: 2 }} />
                </div>
                <div>
                  <label className={LABEL}>Phone</label>
                  <input type="tel" value={form.phone || ''}
                    onChange={e => set('phone', e.target.value || undefined)}
                    placeholder="+1 (555) 000-0000" className={INPUT} style={{ borderRadius: 2 }} />
                </div>
              </div>
            </div>
          )}

          {/* ── Notes tab ── */}
          {tab === 'notes' && (
            <NoteTimeline
              notes={form.noteEntries}
              currentUser={currentUser}
              onChange={handleNoteChange}
            />
          )}

          {/* ── Files tab ── */}
          {tab === 'files' && (
            <FileUpload
              attachments={form.attachments}
              onChange={handleFileChange}
            />
          )}

          {/* ── History tab ── */}
          {tab === 'history' && (
            <HistoryLog history={form.history || []} />
          )}

          {/* ── DD Reports tab ── */}
          {tab === 'dd_reports' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">Run AI-powered due diligence analyses. Results are generated fresh each time and can be copied or saved as a note.</p>

              {/* Competitive Landscape */}
              <AgentReportCard
                title="Competitive Landscape"
                description="Identifies key competitors, market positioning, and differentiation based on the company's therapeutic area, sector, and technology."
                companyId={form.id}
                reportKey="competitive_landscape"
                report={ddReports['competitive_landscape'] ?? null}
                running={ddRunning['competitive_landscape'] ?? false}
                copied={ddCopied['competitive_landscape'] ?? false}
                onRun={async () => {
                  setDdRunning(r => ({ ...r, competitive_landscape: true }));
                  try {
                    const res = await fetch(`/api/companies/${form.id}/reports/competitive-landscape`, { method: 'POST' });
                    const data = await res.json();
                    const runAt = new Date().toISOString();
                    setDdReports(r => ({ ...r, competitive_landscape: { text: data.report, runAt } }));
                    // Attach the generated PPTX to the Files tab
                    if (data.attachment) {
                      const now = runAt;
                      let updated = { ...form, attachments: [...form.attachments, data.attachment] };
                      updated = addHistory(updated, { type: 'file_added', timestamp: now, user: 'Claude', detail: data.attachment.name });
                      updated = { ...updated, updatedAt: now };
                      setForm(updated);
                      onSave(updated);
                    }
                  } catch { /* ignore */ } finally {
                    setDdRunning(r => ({ ...r, competitive_landscape: false }));
                  }
                }}
                onCopy={(text) => {
                  navigator.clipboard.writeText(text);
                  setDdCopied(r => ({ ...r, competitive_landscape: true }));
                  setTimeout(() => setDdCopied(r => ({ ...r, competitive_landscape: false })), 2000);
                }}
                onSaveAsNote={() => {
                  const r = ddReports['competitive_landscape'];
                  if (!r) return;
                  const note = {
                    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                    text: `**Competitive Landscape Analysis**\n\n${r.text}`,
                    createdAt: r.runAt,
                    createdBy: 'Claude',
                  };
                  setForm(f => ({ ...f, noteEntries: [...f.noteEntries, note] }));
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-3.5 flex items-center justify-between gap-3">
          <div>
            {!isNew && (
              showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-medium">Delete permanently?</span>
                  <button onClick={() => onDelete(form.id)}
                    className="bg-red-600 text-white text-xs px-3 py-1.5 hover:bg-red-700 transition-colors" style={{ borderRadius: 2 }}>
                    Yes, delete
                  </button>
                  <button onClick={() => setShowDeleteConfirm(false)}
                    className="text-gray-500 text-xs px-3 py-1.5 hover:bg-gray-200 transition-colors" style={{ borderRadius: 2 }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 text-red-400 hover:text-red-600 text-sm px-3 py-2 hover:bg-red-50 transition-colors" style={{ borderRadius: 2 }}>
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isRejected ? (
              <button onClick={() => setShowRejectDialog(true)}
                className="flex items-center gap-1.5 text-red-400 hover:text-red-600 text-sm px-3 py-2 hover:bg-red-50 transition-colors" style={{ borderRadius: 2 }}>
                <XCircle className="w-4 h-4" /> Reject
              </button>
            ) : (
              <button onClick={handleReactivate}
                className="flex items-center gap-1.5 text-[#005B6E] hover:text-[#004A58] text-sm px-3 py-2 hover:bg-[#E0F0F5] transition-colors" style={{ borderRadius: 2 }}>
                <RotateCcw className="w-4 h-4" /> Reactivate
              </button>
            )}

            {nextStage && !isRejected && (
              <button onClick={handleAdvance}
                className="flex items-center gap-1.5 text-sm px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors" style={{ borderRadius: 2 }}>
                <ArrowRight className="w-4 h-4" /> Advance to {STAGE_CONFIG[nextStage].shortLabel}
              </button>
            )}

            <button onClick={handleSave}
              className="flex items-center gap-1.5 bg-[#005B6E] hover:bg-[#004A58] text-white text-sm px-4 py-2 font-medium transition-colors" style={{ borderRadius: 2 }}>
              <Save className="w-4 h-4" />
              {isNew ? 'Add Company' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Reject dialog */}
      {showRejectDialog && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 p-6 w-full max-w-md shadow-xl" style={{ borderRadius: 2 }}>
            <h3 className="font-bold text-[#1A1A1A] mb-1">Reject Company</h3>
            <p className="text-sm text-gray-500 mb-4">
              Select a reason for rejecting <strong>{form.name || 'this company'}</strong>.
            </p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {REJECTION_REASONS.map(reason => (
                <button
                  key={reason}
                  type="button"
                  onClick={() => setRejectReason(reason)}
                  className={`px-3 py-2.5 text-sm text-left border transition-colors ${
                    rejectReason === reason
                      ? 'bg-red-50 border-red-400 text-red-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-[#1A1A1A]'
                  }`}
                  style={{ borderRadius: 2 }}
                >
                  {reason}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowRejectDialog(false); setRejectReason(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors" style={{ borderRadius: 2 }}>
                Cancel
              </button>
              <button onClick={handleReject} disabled={!rejectReason}
                className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed" style={{ borderRadius: 2 }}>
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
