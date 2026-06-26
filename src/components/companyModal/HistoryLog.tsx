import {
  History, PlusCircle, ArrowRightCircle, StickyNote, FileUp, FileX, AlertCircle, RefreshCw,
} from 'lucide-react';
import { Stage, STAGE_CONFIG, HistoryEntry, formatDateTime } from '../../types';

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

export default function HistoryLog({ history }: { history: HistoryEntry[] }) {
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
