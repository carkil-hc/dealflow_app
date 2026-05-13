import { useState } from 'react';
import { ChevronUp, ChevronDown, Paperclip, ExternalLink, MessageSquare } from 'lucide-react';
import { Company, Stage, STAGE_CONFIG, ACTIVE_STAGES, formatDate } from '../types';

interface Props {
  companies: Company[];
  onSelect: (c: Company) => void;
  onStageChange: (id: string, stage: Stage) => void;
}

type SortKey = 'name' | 'stage' | 'sector' | 'askAmount' | 'updatedAt' | 'createdAt';

export default function ListView({ companies, onSelect, onStageChange }: Props) {
  void onStageChange;
  const [sortKey, setSortKey] = useState<SortKey>('updatedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [filterStage, setFilterStage] = useState<Stage | 'all'>('all');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const filtered = companies
    .filter((c) => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        c.name.toLowerCase().includes(q) ||
        (c.sector || '').toLowerCase().includes(q) ||
        (c.therapeuticArea || '').toLowerCase().includes(q) ||
        (c.leadContact || '').toLowerCase().includes(q) ||
        (c.location || '').toLowerCase().includes(q);
      return matchSearch && (filterStage === 'all' || c.stage === filterStage);
    })
    .sort((a, b) => {
      const vals: Record<SortKey, [string, string]> = {
        name:      [a.name, b.name],
        stage:     [a.stage, b.stage],
        sector:    [a.sector || '', b.sector || ''],
        askAmount: [a.askAmount || '', b.askAmount || ''],
        updatedAt: [a.updatedAt, b.updatedAt],
        createdAt: [a.createdAt, b.createdAt],
      };
      const [av, bv] = vals[sortKey];
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

  const SortIcon = ({ col }: { col: SortKey }) =>
    sortKey === col
      ? sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
      : <ChevronDown className="w-3 h-3 opacity-20" />;

  const Th = ({ label, col, className = '' }: { label: string; col: SortKey; className?: string }) => (
    <th
      onClick={() => handleSort(col)}
      className={`text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4 cursor-pointer hover:text-[#1A1A1A] select-none whitespace-nowrap ${className}`}
    >
      <span className="flex items-center gap-1">{label}<SortIcon col={col} /></span>
    </th>
  );

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <input
          type="text"
          placeholder="Search companies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 px-3 py-2 text-sm w-60 focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white"
          style={{ borderRadius: 2 }}
        />
        <select
          value={filterStage}
          onChange={(e) => setFilterStage(e.target.value as Stage | 'all')}
          className="border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white"
          style={{ borderRadius: 2 }}
        >
          <option value="all">All Stages</option>
          {ACTIVE_STAGES.map((s) => (
            <option key={s} value={s}>{STAGE_CONFIG[s].label}</option>
          ))}
        </select>
        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} {filtered.length === 1 ? 'company' : 'companies'}
        </span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: 2 }}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-200">
              <tr>
                <Th label="Company" col="name" />
                <Th label="Stage" col="stage" />
                <Th label="Sector" col="sector" />
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4 whitespace-nowrap">
                  Therapeutic Area
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4 whitespace-nowrap">
                  Dev. Stage
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4 whitespace-nowrap">
                  Location
                </th>
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4 whitespace-nowrap">
                  Owner
                </th>
                <Th label="Ask" col="askAmount" />
                <th className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                  Files
                </th>
                <Th label="Updated" col="updatedAt" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-14 text-gray-400 text-sm">
                    No companies found
                  </td>
                </tr>
              ) : (
                filtered.map((company) => {
                  const cfg = STAGE_CONFIG[company.stage];
                  return (
                    <tr
                      key={company.id}
                      onClick={() => onSelect(company)}
                      className="hover:bg-[#E0F0F5]/30 cursor-pointer transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                          <div>
                            <div className="font-medium text-[#1A1A1A] text-sm">{company.name}</div>
                            {company.leadContact && (
                              <div className="text-[11px] text-gray-400">{company.leadContact}</div>
                            )}
                          </div>
                          {company.website && (
                            <a href={company.website} target="_blank" rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-gray-300 hover:text-[#005B6E]">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {company.noteEntries.length > 0 && (
                            <span className="flex items-center gap-0.5 text-[11px] text-gray-300">
                              <MessageSquare className="w-3 h-3" />{company.noteEntries.length}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 ${cfg.badgeBg} ${cfg.badgeText}`} style={{ borderRadius: 2 }}>
                          {cfg.shortLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {company.sector || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {company.therapeuticArea || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {company.developmentStage || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {company.location || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-sm text-gray-600">
                        {company.owner || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="py-3 px-4 text-sm font-medium text-[#1A1A1A]">
                        {company.askAmount || <span className="text-gray-300 font-normal">—</span>}
                      </td>
                      <td className="py-3 px-4">
                        {company.attachments.length > 0 ? (
                          <span className="flex items-center gap-1 text-[11px] text-gray-400">
                            <Paperclip className="w-3 h-3" />{company.attachments.length}
                          </span>
                        ) : <span className="text-gray-300 text-sm">—</span>}
                      </td>
                      <td className="py-3 px-4 text-[11px] text-gray-400">{formatDate(company.updatedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
