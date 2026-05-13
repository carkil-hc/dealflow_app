import { useRef, useState } from 'react';
import { Upload, X, AlertTriangle, CheckCircle, FileText } from 'lucide-react';
import { Company, Stage } from '../types';

interface Props {
  existingCompanies: Company[];
  onImport: (companies: Company[]) => void;
  onClose: () => void;
}

interface ParsedRow {
  name: string;
  description: string;
  stage: Stage;
  website: string;
  sector: string;
  location: string;
  therapeuticArea: string;
  developmentStage: string;
  nextMilestone: string;
  fundingStage: string;
  askAmount: string;
  valuation: string;
  leadContact: string;
  email: string;
  phone: string;
  rejectedReason: string;
}

interface RowResult extends ParsedRow {
  rowNum: number;
  isDuplicate: boolean;
  errors: string[];
}

// --- CSV parser (handles quoted fields, commas inside quotes, escaped quotes) ---
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let i = 0;

  while (i < lines.length) {
    const row: string[] = [];
    while (i < lines.length && lines[i] !== '\n') {
      if (lines[i] === '"') {
        i++; // skip opening quote
        let field = '';
        while (i < lines.length) {
          if (lines[i] === '"' && lines[i + 1] === '"') {
            field += '"'; i += 2;
          } else if (lines[i] === '"') {
            i++; break;
          } else {
            field += lines[i++];
          }
        }
        row.push(field);
        if (lines[i] === ',') i++;
      } else {
        let field = '';
        while (i < lines.length && lines[i] !== ',' && lines[i] !== '\n') {
          field += lines[i++];
        }
        row.push(field.trim());
        if (lines[i] === ',') i++;
      }
    }
    if (lines[i] === '\n') i++;
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

// Maps CSV header strings to ParsedRow keys
const HEADER_MAP: Record<string, keyof ParsedRow> = {
  name: 'name', company: 'name', 'company name': 'name',
  description: 'description', desc: 'description', summary: 'description',
  stage: 'stage', status: 'stage',
  website: 'website', url: 'website',
  sector: 'sector',
  location: 'location', country: 'location',
  'therapeutic area': 'therapeuticArea', therapeuticarea: 'therapeuticArea', therapy: 'therapeuticArea',
  'development stage': 'developmentStage', 'dev stage': 'developmentStage', devstage: 'developmentStage',
  'next milestone': 'nextMilestone', milestone: 'nextMilestone',
  'funding stage': 'fundingStage', 'financial stage': 'fundingStage', fundingstage: 'fundingStage',
  ask: 'askAmount', 'ask amount': 'askAmount', askamount: 'askAmount', raise: 'askAmount',
  valuation: 'valuation',
  'lead contact': 'leadContact', contact: 'leadContact', leadcontact: 'leadContact',
  email: 'email',
  phone: 'phone', telephone: 'phone',
  'rejected reason': 'rejectedReason', 'rejection reason': 'rejectedReason', rejectedreason: 'rejectedReason',
};

const STAGE_MAP: Record<string, Stage> = {
  new: 'new',
  'first meeting': 'first_meeting', first_meeting: 'first_meeting', meeting: 'first_meeting',
  'due diligence': 'due_diligence', due_diligence: 'due_diligence', dd: 'due_diligence',
  'terms negotiation': 'terms_negotiation', terms_negotiation: 'terms_negotiation', terms: 'terms_negotiation',
  invested: 'invested', portfolio: 'invested',
  backburner: 'backburner', 'back burner': 'backburner',
  rejected: 'rejected',
};

function parseStage(val: string): Stage {
  return STAGE_MAP[val.toLowerCase().trim()] ?? 'new';
}

function processCSV(rows: string[][], existingNames: Set<string>): RowResult[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase().trim());
  const colMap: Record<number, keyof ParsedRow> = {};
  headers.forEach((h, i) => { if (HEADER_MAP[h]) colMap[i] = HEADER_MAP[h]; });

  return rows.slice(1).map((row, idx) => {
    const parsed: ParsedRow = {
      name: '', description: '', stage: 'new', website: '', sector: '',
      location: '', therapeuticArea: '', developmentStage: '', nextMilestone: '',
      fundingStage: '', askAmount: '', valuation: '', leadContact: '',
      email: '', phone: '', rejectedReason: '',
    };
    row.forEach((val, i) => { if (colMap[i]) (parsed as Record<string, string>)[colMap[i]] = val.trim(); });
    if (parsed.stage as string) parsed.stage = parseStage(parsed.stage as unknown as string);

    const errors: string[] = [];
    if (!parsed.name) errors.push('Missing company name');

    return {
      ...parsed,
      rowNum: idx + 2,
      isDuplicate: existingNames.has(parsed.name.toLowerCase()),
      errors,
    };
  });
}

export default function ImportModal({ existingCompanies, onImport, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rows, setRows] = useState<RowResult[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [done, setDone] = useState<{ imported: number; skipped: number } | null>(null);

  const existingNames = new Set(existingCompanies.map(c => c.name.toLowerCase()));

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv')) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const csvRows = parseCSV(text);
      setRows(processCSV(csvRows, existingNames));
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const validRows = rows?.filter(r => r.errors.length === 0) ?? [];
  const toImport = skipDuplicates ? validRows.filter(r => !r.isDuplicate) : validRows;
  const duplicateCount = validRows.filter(r => r.isDuplicate).length;
  const errorCount = rows?.filter(r => r.errors.length > 0).length ?? 0;

  const handleImport = () => {
    const now = new Date().toISOString();
    const companies: Company[] = toImport.map(r => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: r.name,
      description: r.description,
      stage: r.stage,
      website: r.website || undefined,
      sector: r.sector || undefined,
      location: r.location || undefined,
      therapeuticArea: r.therapeuticArea || undefined,
      developmentStage: r.developmentStage || undefined,
      nextMilestone: r.nextMilestone || undefined,
      fundingStage: r.fundingStage || undefined,
      askAmount: r.askAmount || undefined,
      valuation: r.valuation || undefined,
      leadContact: r.leadContact || undefined,
      email: r.email || undefined,
      phone: r.phone || undefined,
      rejectedReason: r.rejectedReason || undefined,
      noteEntries: [],
      attachments: [],
      createdAt: now,
      updatedAt: now,
    }));
    onImport(companies);
    setDone({ imported: companies.length, skipped: (rows?.length ?? 0) - companies.length });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-3xl max-h-[85vh] flex flex-col shadow-xl" style={{ borderRadius: 2 }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-base font-semibold text-[#1A1A1A]">Import Companies from CSV</h2>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-[#1A1A1A] transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">

          {done ? (
            <div className="flex flex-col items-center py-10 gap-3">
              <CheckCircle className="w-10 h-10 text-[#005B6E]" />
              <p className="text-lg font-semibold text-[#1A1A1A]">{done.imported} {done.imported === 1 ? 'company' : 'companies'} imported</p>
              {done.skipped > 0 && <p className="text-sm text-gray-400">{done.skipped} row{done.skipped !== 1 ? 's' : ''} skipped</p>}
              <button onClick={onClose} className="mt-2 bg-[#005B6E] hover:bg-[#004A58] text-white px-5 py-2 text-sm font-medium transition-colors" style={{ borderRadius: 2 }}>
                Done
              </button>
            </div>
          ) : (
            <>
              {/* Drop zone */}
              {!rows && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                  className={`border-2 border-dashed px-8 py-12 text-center cursor-pointer transition-colors ${dragging ? 'border-[#005B6E] bg-[#E0F0F5]' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                  style={{ borderRadius: 2 }}
                >
                  <Upload className={`w-8 h-8 mx-auto mb-3 ${dragging ? 'text-[#005B6E]' : 'text-gray-300'}`} />
                  <p className="text-sm font-medium text-gray-600">Drop a CSV file here or click to browse</p>
                  <p className="text-xs text-gray-400 mt-1">Accepted columns: name, stage, sector, location, therapeutic area, development stage, funding stage, ask amount, lead contact, website, and more</p>
                  <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                </div>
              )}

              {/* Template hint */}
              {!rows && (
                <div className="bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500 space-y-1" style={{ borderRadius: 2 }}>
                  <p className="font-semibold text-gray-600">CSV column names (case-insensitive):</p>
                  <p>name · stage · sector · location · therapeutic area · development stage · funding stage · ask amount · valuation · lead contact · email · phone · website · description · next milestone · rejected reason</p>
                  <p className="mt-1"><span className="font-medium">Stage values:</span> New · First Meeting · Due Diligence · Terms Negotiation · Invested · Backburner · Rejected</p>
                </div>
              )}

              {/* Preview */}
              {rows && (
                <>
                  <div className="flex items-center gap-3">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <span className="text-sm text-gray-600 font-medium">{fileName}</span>
                    <span className="text-xs text-gray-400">{rows.length} row{rows.length !== 1 ? 's' : ''} found</span>
                    <button onClick={() => { setRows(null); setFileName(''); }} className="ml-auto text-xs text-gray-400 hover:text-[#1A1A1A] underline">
                      Change file
                    </button>
                  </div>

                  {/* Stats */}
                  <div className="flex flex-wrap gap-3">
                    <div className="bg-green-50 border border-green-100 px-3 py-2 text-xs" style={{ borderRadius: 2 }}>
                      <span className="font-semibold text-green-700">{validRows.length}</span>
                      <span className="text-green-600 ml-1">valid</span>
                    </div>
                    {duplicateCount > 0 && (
                      <div className="bg-amber-50 border border-amber-100 px-3 py-2 text-xs" style={{ borderRadius: 2 }}>
                        <span className="font-semibold text-amber-700">{duplicateCount}</span>
                        <span className="text-amber-600 ml-1">duplicate{duplicateCount !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {errorCount > 0 && (
                      <div className="bg-red-50 border border-red-100 px-3 py-2 text-xs" style={{ borderRadius: 2 }}>
                        <span className="font-semibold text-red-600">{errorCount}</span>
                        <span className="text-red-500 ml-1">error{errorCount !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                    {duplicateCount > 0 && (
                      <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer ml-auto">
                        <input type="checkbox" checked={skipDuplicates} onChange={e => setSkipDuplicates(e.target.checked)} className="accent-[#005B6E]" />
                        Skip duplicates
                      </label>
                    )}
                  </div>

                  {/* Table */}
                  <div className="border border-gray-200 overflow-hidden" style={{ borderRadius: 2 }}>
                    <div className="overflow-x-auto max-h-64">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                          <tr>
                            <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-2 px-3 w-6">#</th>
                            <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-2 px-3">Name</th>
                            <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-2 px-3">Stage</th>
                            <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-2 px-3">Sector</th>
                            <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-2 px-3">Location</th>
                            <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-2 px-3">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {rows.map(r => (
                            <tr key={r.rowNum} className={r.errors.length > 0 ? 'bg-red-50' : r.isDuplicate ? 'bg-amber-50/50' : ''}>
                              <td className="py-2 px-3 text-gray-400">{r.rowNum}</td>
                              <td className="py-2 px-3 font-medium text-[#1A1A1A]">{r.name || <span className="text-red-400 italic">missing</span>}</td>
                              <td className="py-2 px-3 text-gray-600 capitalize">{r.stage.replace(/_/g, ' ')}</td>
                              <td className="py-2 px-3 text-gray-600">{r.sector || '—'}</td>
                              <td className="py-2 px-3 text-gray-600">{r.location || '—'}</td>
                              <td className="py-2 px-3">
                                {r.errors.length > 0 ? (
                                  <span className="flex items-center gap-1 text-red-500"><AlertTriangle className="w-3 h-3" />{r.errors[0]}</span>
                                ) : r.isDuplicate ? (
                                  <span className="text-amber-600">Duplicate</span>
                                ) : (
                                  <span className="text-green-600">Ready</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {rows && !done && (
          <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
            <p className="text-sm text-gray-500">
              {toImport.length} {toImport.length === 1 ? 'company' : 'companies'} will be imported
            </p>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-[#1A1A1A] border border-gray-200 hover:border-gray-300 transition-colors" style={{ borderRadius: 2 }}>
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={toImport.length === 0}
                className="px-4 py-2 text-sm font-medium bg-[#005B6E] hover:bg-[#004A58] text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ borderRadius: 2 }}
              >
                Import {toImport.length > 0 ? toImport.length : ''} {toImport.length === 1 ? 'Company' : 'Companies'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
