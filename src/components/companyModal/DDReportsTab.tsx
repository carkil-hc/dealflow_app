import { Dispatch, SetStateAction } from 'react';
import { Company, uid } from '../../types';
import { addHistory } from './helpers';
import AgentReportCard from './AgentReportCard';

type Report = { text: string; runAt: string };

interface DDReportsTabProps {
  form: Company;
  setForm: Dispatch<SetStateAction<Company>>;
  onSave: (c: Company) => void;
  reports: Record<string, Report | null>;
  setReports: Dispatch<SetStateAction<Record<string, Report | null>>>;
  running: Record<string, boolean>;
  setRunning: Dispatch<SetStateAction<Record<string, boolean>>>;
  copied: Record<string, boolean>;
  setCopied: Dispatch<SetStateAction<Record<string, boolean>>>;
}

export default function DDReportsTab({
  form, setForm, onSave, reports, setReports, running, setRunning, copied, setCopied,
}: DDReportsTabProps) {
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">Run AI-powered due diligence analyses. Results are generated fresh each time and can be copied or saved as a note.</p>

      {/* Competitive Landscape */}
      <AgentReportCard
        title="Competitive Landscape"
        description="Identifies key competitors, market positioning, and differentiation based on the company's therapeutic area, sector, and technology."
        report={reports['competitive_landscape'] ?? null}
        running={running['competitive_landscape'] ?? false}
        copied={copied['competitive_landscape'] ?? false}
        onRun={async () => {
          setRunning(r => ({ ...r, competitive_landscape: true }));
          try {
            const res = await fetch(`/api/companies/${form.id}/reports/competitive-landscape`, { method: 'POST' });
            const data = await res.json();
            const runAt = new Date().toISOString();
            setReports(r => ({ ...r, competitive_landscape: { text: data.report, runAt } }));
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
            setRunning(r => ({ ...r, competitive_landscape: false }));
          }
        }}
        onCopy={(text) => {
          navigator.clipboard.writeText(text);
          setCopied(r => ({ ...r, competitive_landscape: true }));
          setTimeout(() => setCopied(r => ({ ...r, competitive_landscape: false })), 2000);
        }}
        onSaveAsNote={() => {
          const r = reports['competitive_landscape'];
          if (!r) return;
          const note = {
            id: uid(),
            text: `**Competitive Landscape Analysis**\n\n${r.text}`,
            createdAt: r.runAt,
            createdBy: 'Claude',
          };
          setForm(f => ({ ...f, noteEntries: [...f.noteEntries, note] }));
        }}
      />
    </div>
  );
}
