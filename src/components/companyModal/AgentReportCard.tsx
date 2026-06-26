import { Play, Loader2, Copy, Check, StickyNote } from 'lucide-react';

interface AgentReportCardProps {
  title: string;
  description: string;
  report: { text: string; runAt: string } | null;
  running: boolean;
  copied: boolean;
  onRun: () => void;
  onCopy: (text: string) => void;
  onSaveAsNote: () => void;
}

export default function AgentReportCard({ title, description, report, running, copied, onRun, onCopy, onSaveAsNote }: AgentReportCardProps) {
  return (
    <div className="border border-gray-200 bg-white rounded-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-start justify-between gap-4">
        <div>
          <div className="text-sm font-semibold text-[#1A1A1A]">{title}</div>
          <div className="text-xs text-gray-400 mt-0.5">{description}</div>
        </div>
        <button
          onClick={onRun}
          disabled={running}
          className="flex items-center gap-1.5 shrink-0 bg-[#005B6E] hover:bg-[#004A58] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors rounded-sm"
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
          <div className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap bg-gray-50 border border-gray-100 px-3 py-3 max-h-80 overflow-y-auto rounded-sm">
            {report.text}
          </div>
          <div className="flex items-center gap-2 mt-2.5">
            <button
              onClick={() => onCopy(report.text)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#005B6E] px-2 py-1 hover:bg-[#E0F0F5] transition-colors rounded-sm"
            >
              {copied ? <><Check className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy</>}
            </button>
            <button
              onClick={onSaveAsNote}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-[#005B6E] px-2 py-1 hover:bg-[#E0F0F5] transition-colors rounded-sm"
            >
              <StickyNote className="w-3 h-3" /> Save as note
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
