import { useState, useEffect } from 'react';
import {
  X, ArrowRight, XCircle, RotateCcw, Trash2, Save, ChevronRight,
  Building2, Briefcase, MessageSquare, Paperclip, History, FlaskConical,
  LayoutDashboard, ClipboardCheck,
} from 'lucide-react';
import {
  Company, Stage, STAGE_CONFIG, PIPELINE_STAGES, NEXT_STAGE,
  NoteEntry, formatDate, uid,
} from '../types';
import FileUpload from './FileUpload';
import NoteTimeline from './NoteTimeline';
import { addHistory, REJECTION_REASONS } from './companyModal/helpers';
import HistoryLog from './companyModal/HistoryLog';
import Placeholder from './companyModal/Placeholder';
import CompanyTab from './companyModal/CompanyTab';
import DealTab from './companyModal/DealTab';
import DDReportsTab from './companyModal/DDReportsTab';

interface Props {
  company: Company | null;
  currentUser: string;
  onSave: (c: Company) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

type Tab = 'overview' | 'info' | 'deal' | 'due_diligence' | 'notes' | 'files' | 'history' | 'dd_reports';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'overview',      label: 'Overview',       icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
  { id: 'info',          label: 'Company',        icon: <Building2 className="w-3.5 h-3.5" /> },
  { id: 'deal',          label: 'Deal',           icon: <Briefcase className="w-3.5 h-3.5" /> },
  { id: 'due_diligence', label: 'Due Diligence',  icon: <ClipboardCheck className="w-3.5 h-3.5" /> },
  { id: 'notes',         label: 'Notes',          icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: 'files',         label: 'Files',          icon: <Paperclip className="w-3.5 h-3.5" /> },
  { id: 'history',       label: 'History',        icon: <History className="w-3.5 h-3.5" /> },
  { id: 'dd_reports',    label: 'DD Reports',     icon: <FlaskConical className="w-3.5 h-3.5" /> },
];

function newCompany(owner?: string): Company {
  const now = new Date().toISOString();
  return {
    id: uid(),
    name: '', description: '', stage: 'new',
    owner,
    noteEntries: [], attachments: [], history: [],
    createdAt: now, updatedAt: now,
  };
}

export default function CompanyModal({ company, currentUser, onSave, onDelete, onClose }: Props) {
  const [form, setForm] = useState<Company>(() => company ?? newCompany(currentUser));
  const [tab, setTab] = useState<Tab>('overview');
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
    setTab('overview');
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
      <div className="relative bg-white w-full max-w-6xl h-[92vh] flex flex-col overflow-hidden shadow-2xl border border-gray-200 rounded-sm">

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
                  } rounded-sm`}>
                    {sc.shortLabel}
                  </span>
                </span>
              );
            })}
            {isRejected && (
              <span className="flex items-center gap-1 shrink-0">
                <ChevronRight className="w-3 h-3 text-gray-300" />
                <span className="px-2 py-0.5 font-medium bg-red-50 text-red-600 rounded-sm">Rejected</span>
              </span>
            )}
          </div>
        )}

        {/* Body — left sidebar nav + content */}
        <div className="flex-1 flex overflow-hidden">

          {/* Sidebar nav */}
          <div className="w-52 shrink-0 border-r border-gray-200 bg-gray-50 py-3 px-2 flex flex-col gap-0.5 overflow-y-auto">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2.5 px-3 py-2.5 text-sm font-medium border-l-2 transition-colors text-left ${
                  tab === t.id
                    ? 'border-[#005B6E] text-[#005B6E] bg-[#E0F0F5]'
                    : 'border-transparent text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-100'
                } rounded-sm`}
              >
                {t.icon}
                <span className="flex-1">{t.label}</span>
                {t.id === 'files' && form.attachments.length > 0 && (
                  <span className="bg-[#E0F0F5] text-[#005B6E] text-[10px] font-bold px-1.5 py-0.5 leading-none rounded-sm">
                    {form.attachments.length}
                  </span>
                )}
                {t.id === 'notes' && form.noteEntries.length > 0 && (
                  <span className="bg-gray-100 text-gray-500 text-[10px] font-bold px-1.5 py-0.5 leading-none rounded-sm">
                    {form.noteEntries.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">

            {tab === 'overview' && (
              <Placeholder
                icon={<LayoutDashboard className="w-8 h-8" />}
                title="Overview coming soon"
                subtitle="A summary of this company will appear here"
              />
            )}

            {tab === 'due_diligence' && (
              <Placeholder
                icon={<ClipboardCheck className="w-8 h-8" />}
                title="Due diligence coming soon"
                subtitle="Tools to manage the due diligence process will appear here"
              />
            )}

            {tab === 'info' && (
              <CompanyTab
                form={form}
                set={set}
                errors={errors}
                onRejectClick={() => setShowRejectDialog(true)}
              />
            )}

            {tab === 'deal' && <DealTab form={form} set={set} />}

            {tab === 'notes' && (
              <NoteTimeline
                notes={form.noteEntries}
                currentUser={currentUser}
                onChange={handleNoteChange}
              />
            )}

            {tab === 'files' && (
              <FileUpload
                attachments={form.attachments}
                onChange={handleFileChange}
              />
            )}

            {tab === 'history' && <HistoryLog history={form.history || []} />}

            {tab === 'dd_reports' && (
              <DDReportsTab
                form={form}
                setForm={setForm}
                onSave={onSave}
                reports={ddReports}
                setReports={setDdReports}
                running={ddRunning}
                setRunning={setDdRunning}
                copied={ddCopied}
                setCopied={setDdCopied}
              />
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-3.5 flex items-center justify-between gap-3">
          <div>
            {!isNew && (
              showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-600 font-medium">Delete permanently?</span>
                  <button onClick={() => onDelete(form.id)}
                    className="bg-red-600 text-white text-xs px-3 py-1.5 hover:bg-red-700 transition-colors rounded-sm">
                    Yes, delete
                  </button>
                  <button onClick={() => setShowDeleteConfirm(false)}
                    className="text-gray-500 text-xs px-3 py-1.5 hover:bg-gray-200 transition-colors rounded-sm">
                    Cancel
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowDeleteConfirm(true)}
                  className="flex items-center gap-1.5 text-red-400 hover:text-red-600 text-sm px-3 py-2 hover:bg-red-50 transition-colors rounded-sm">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isRejected ? (
              <button onClick={() => setShowRejectDialog(true)}
                className="flex items-center gap-1.5 text-red-400 hover:text-red-600 text-sm px-3 py-2 hover:bg-red-50 transition-colors rounded-sm">
                <XCircle className="w-4 h-4" /> Reject
              </button>
            ) : (
              <button onClick={handleReactivate}
                className="flex items-center gap-1.5 text-[#005B6E] hover:text-[#004A58] text-sm px-3 py-2 hover:bg-[#E0F0F5] transition-colors rounded-sm">
                <RotateCcw className="w-4 h-4" /> Reactivate
              </button>
            )}

            {nextStage && !isRejected && (
              <button onClick={handleAdvance}
                className="flex items-center gap-1.5 text-sm px-4 py-2 border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors rounded-sm">
                <ArrowRight className="w-4 h-4" /> Advance to {STAGE_CONFIG[nextStage].shortLabel}
              </button>
            )}

            <button onClick={handleSave}
              className="flex items-center gap-1.5 bg-[#005B6E] hover:bg-[#004A58] text-white text-sm px-4 py-2 font-medium transition-colors rounded-sm">
              <Save className="w-4 h-4" />
              {isNew ? 'Add Company' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>

      {/* Reject dialog */}
      {showRejectDialog && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 p-6 w-full max-w-md shadow-xl rounded-sm">
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
                  } rounded-sm`}
                >
                  {reason}
                </button>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowRejectDialog(false); setRejectReason(''); }}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 transition-colors rounded-sm">
                Cancel
              </button>
              <button onClick={handleReject} disabled={!rejectReason}
                className="px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700 font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed rounded-sm">
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
