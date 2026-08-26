import { X, Download, FileText } from 'lucide-react';
import { Attachment } from '../../types';
import { RISK_PILL, RISK_LABEL, downloadBase64 } from '../../ui';

interface DimContent {
  category: string;
  question: string;
  riskLevel: number | null;
  hasData: boolean;
  summary: string;
  mainFindings: string[];
  detail: { heading: string; body: string }[];
}

export interface Deck {
  attachment: Attachment;
  preview: { combined: boolean; dimensions: DimContent[] };
}

interface Props {
  deck: Deck;
  onClose: () => void;
}

function RiskPill({ level }: { level: number | null }) {
  if (level == null) return <span className="text-[11px] px-2 py-0.5 border border-gray-200 text-gray-400 rounded-sm">Not assessed</span>;
  const lvl = level as 1 | 2 | 3 | 4 | 5;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 border rounded-sm ${RISK_PILL[lvl]}`}>Risk {lvl}/5 · {RISK_LABEL[lvl]}</span>;
}

export default function DDDeckModal({ deck, onClose }: Props) {
  const { attachment, preview } = deck;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl border border-gray-200 rounded-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-[#005B6E] shrink-0" />
            <h3 className="font-semibold text-[#1A1A1A] text-sm truncate">{attachment.name}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-[#1A1A1A] transition-colors ml-4 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preview of the deck content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {preview.dimensions.map(dim => (
            <div key={dim.category} className="border border-gray-200 rounded-sm">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-[#1A1A1A]">{dim.category}</span>
                <RiskPill level={dim.riskLevel} />
              </div>
              <div className="px-4 py-3">
                {!dim.hasData ? (
                  <p className="text-sm text-gray-400 italic">No data yet — add or edit data in the app.</p>
                ) : (
                  <div className="space-y-3">
                    {dim.summary && <p className="text-sm text-[#1A1A1A] leading-relaxed">{dim.summary}</p>}
                    {dim.mainFindings.length > 0 && (
                      <ul className="list-disc pl-5 space-y-1">
                        {dim.mainFindings.map((f, i) => <li key={i} className="text-sm text-gray-700">{f}</li>)}
                      </ul>
                    )}
                    {dim.detail.map((d, i) => (
                      <div key={i}>
                        <div className="text-xs font-semibold text-[#005B6E] uppercase tracking-wide">{d.heading}</div>
                        <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{d.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 bg-gray-50 px-6 py-3.5 flex items-center justify-between gap-3 shrink-0">
          <span className="text-[11px] text-gray-400">Preview of the slide content. Download to open the formatted .pptx in PowerPoint.</span>
          <button
            onClick={() => attachment.data && downloadBase64(attachment.data, attachment.name, attachment.type)}
            className="flex items-center gap-1.5 bg-[#005B6E] hover:bg-[#004A58] text-white text-sm px-4 py-2 font-medium transition-colors rounded-sm"
          >
            <Download className="w-4 h-4" /> Download .pptx
          </button>
        </div>
      </div>
    </div>
  );
}
