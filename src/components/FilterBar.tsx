import { useRef, useState, useEffect } from 'react';
import { SlidersHorizontal, X, ChevronDown, Search, Check } from 'lucide-react';
import { Company, STAGE_CONFIG, STRATEGIES } from '../types';

export interface FilterState {
  sector: string[];
  therapeuticArea: string[];
  developmentStage: string[];
  fundingStage: string[];
  location: string[];
  nextMilestone: string[];
  owner: string[];
  strategy: string[];
}

export const EMPTY_FILTERS: FilterState = {
  sector: [],
  therapeuticArea: [],
  developmentStage: [],
  fundingStage: [],
  location: [],
  nextMilestone: [],
  owner: [],
  strategy: [],
};

type FilterKey = keyof FilterState;

export function applyFilters(companies: Company[], filters: FilterState): Company[] {
  return companies.filter(c => {
    if (filters.sector.length && !filters.sector.includes(c.sector ?? '')) return false;
    if (filters.therapeuticArea.length && !filters.therapeuticArea.includes(c.therapeuticArea ?? '')) return false;
    if (filters.developmentStage.length && !filters.developmentStage.includes(c.developmentStage ?? '')) return false;
    if (filters.fundingStage.length && !filters.fundingStage.includes(c.fundingStage ?? '')) return false;
    if (filters.location.length && !filters.location.includes(c.location ?? '')) return false;
    if (filters.nextMilestone.length && !filters.nextMilestone.includes(c.nextMilestone ?? '')) return false;
    if (filters.owner.length && !filters.owner.includes(c.owner ?? '')) return false;
    if (filters.strategy.length && !filters.strategy.includes(c.strategy ?? 'N/a')) return false;
    return true;
  });
}

function searchCompanies(companies: Company[], q: string): Company[] {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  return companies.filter(c => {
    const haystack = [
      c.name, c.description, c.location, c.sector, c.therapeuticArea,
      c.developmentStage, c.nextMilestone, c.fundingStage, c.askAmount,
      c.valuation, c.owner, c.leadContact, c.email, c.website,
    ].join(' ').toLowerCase();
    return haystack.includes(query);
  });
}

const FILTER_LABELS: Record<FilterKey, string> = {
  owner: 'Owner',
  sector: 'Sector',
  therapeuticArea: 'Therapeutic Area',
  developmentStage: 'Dev. Stage',
  fundingStage: 'Funding Stage',
  location: 'Location',
  nextMilestone: 'Next Milestone',
  strategy: 'Strategy',
};

const FILTER_KEYS: FilterKey[] = [
  'owner', 'sector', 'therapeuticArea', 'developmentStage', 'fundingStage', 'location', 'nextMilestone',
];

function getOptions(companies: Company[], key: FilterKey): string[] {
  const vals = new Set<string>();
  companies.forEach(c => {
    const v = c[key as keyof Company];
    if (typeof v === 'string' && v) vals.add(v);
  });
  return Array.from(vals).sort();
}

// --- Searchable multi-select combobox for a single filter field ---
function ComboFilter({ label, options, selected, onChange }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));

  const toggle = (val: string) => {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val]);
  };

  const handleOpen = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div ref={ref} className="relative min-w-[160px] flex-1">
      <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
        {label}
      </div>

      {/* Trigger input */}
      <div
        onClick={handleOpen}
        className={`flex items-center gap-1.5 border px-2.5 py-1.5 cursor-pointer transition-colors ${
          open ? 'border-[#005B6E] ring-1 ring-[#005B6E]' : 'border-gray-200 hover:border-gray-300'
        } bg-white rounded-sm`}
      >
        <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        {open ? (
          <input
            ref={inputRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}…`}
            className="flex-1 text-sm outline-none bg-transparent min-w-0"
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 text-sm truncate min-w-0">
            {selected.length === 0
              ? <span className="text-gray-400">All</span>
              : selected.length === 1
                ? <span className="text-[#1A1A1A]">{selected[0]}</span>
                : <span className="text-[#005B6E] font-medium">{selected.length} selected</span>
            }
          </span>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {/* Dropdown list */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 shadow-md z-50 max-h-48 overflow-y-auto rounded-sm">
          {filtered.length === 0 ? (
            <div className="px-3 py-2.5 text-sm text-gray-400">No matches</div>
          ) : (
            <>
              {/* All option */}
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false); setSearch(''); }}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-gray-50 border-b border-gray-100 ${
                  selected.length === 0 ? 'text-[#005B6E] font-medium' : 'text-gray-500 italic'
                }`}
              >
                All
                {selected.length === 0 && <Check className="w-3.5 h-3.5" />}
              </button>
              {filtered.map(opt => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => toggle(opt)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-[#E0F0F5]/50 hover:text-[#1A1A1A] transition-colors"
                >
                  <span>{opt}</span>
                  {selected.includes(opt) && <Check className="w-3.5 h-3.5 text-[#005B6E] shrink-0" />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// --- Main FilterBar ---
interface Props {
  companies: Company[];
  filters: FilterState;
  onChange: (f: FilterState) => void;
  onSelectCompany: (c: Company) => void;
}

export default function FilterBar({ companies, filters, onChange, onSelectCompany }: Props) {
  const [open, setOpen] = useState(false);
  const [strategyOpen, setStrategyOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const strategyRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (strategyRef.current && !strategyRef.current.contains(e.target as Node)) setStrategyOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const searchResults = searchCompanies(companies, search);

  const handleSelectResult = (company: Company) => {
    onSelectCompany(company);
    setSearch('');
    setSearchOpen(false);
  };

  const activeCount = Object.values(filters).reduce((n, arr) => n + arr.length, 0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const clearAll = () => onChange(EMPTY_FILTERS);

  const removeChip = (key: FilterKey, val: string) => {
    onChange({ ...filters, [key]: filters[key].filter(v => v !== val) });
  };

  const activeGroups = FILTER_KEYS.filter(k => getOptions(companies, k).length > 0);

  return (
    <div ref={containerRef} className="relative bg-white border-b border-gray-200 z-20">
      {/* Bar */}
      <div className="px-8 py-2.5 flex items-center gap-3 flex-wrap">
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border transition-colors shrink-0 ${
            open || activeCount > 0
              ? 'border-[#005B6E] text-[#005B6E] bg-[#E0F0F5]'
              : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-[#1A1A1A] bg-white'
          } rounded-sm`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="bg-[#005B6E] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
              {activeCount}
            </span>
          )}
          <ChevronDown className={`w-3 h-3 ml-0.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Strategy filter button */}
        <div ref={strategyRef} className="relative">
          <button
            onClick={() => setStrategyOpen(o => !o)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm border transition-colors shrink-0 ${
              strategyOpen || filters.strategy.length > 0
                ? 'border-[#005B6E] text-[#005B6E] bg-[#E0F0F5]'
                : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-[#1A1A1A] bg-white'
            } rounded-sm`}
          >
            Strategy
            {filters.strategy.length > 0 && (
              <span className="bg-[#005B6E] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {filters.strategy.length}
              </span>
            )}
            <ChevronDown className={`w-3 h-3 ml-0.5 transition-transform ${strategyOpen ? 'rotate-180' : ''}`} />
          </button>

          {strategyOpen && (
            <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 shadow-md z-50 w-36 rounded-sm">
              <button
                type="button"
                onClick={() => onChange({ ...filters, strategy: [] })}
                className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-gray-50 border-b border-gray-100 ${
                  filters.strategy.length === 0 ? 'text-[#005B6E] font-medium' : 'text-gray-500 italic'
                }`}
              >
                All
                {filters.strategy.length === 0 && <Check className="w-3.5 h-3.5" />}
              </button>
              {STRATEGIES.map(s => {
                const active = filters.strategy.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onChange({
                      ...filters,
                      strategy: active ? filters.strategy.filter(v => v !== s) : [...filters.strategy, s],
                    })}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm text-gray-700 hover:bg-[#E0F0F5]/50 transition-colors"
                  >
                    {s}
                    {active && <Check className="w-3.5 h-3.5 text-[#005B6E]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Search box with dropdown */}
        <div ref={searchRef} className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none z-10" />
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}
            onFocus={() => { if (search) setSearchOpen(true); }}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setSearchOpen(false); } }}
            placeholder="Search companies…"
            className="pl-8 pr-7 py-1.5 text-sm border border-gray-200 hover:border-gray-300 focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] outline-none bg-white w-64 transition-colors rounded-sm"
          />
          {search && (
            <button
              onClick={() => { setSearch(''); setSearchOpen(false); searchInputRef.current?.focus(); }}
              className="absolute right-2 text-gray-300 hover:text-gray-500 transition-colors z-10"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Results dropdown */}
          {searchOpen && search.trim() && (
            <div className="absolute top-full left-0 mt-1 w-96 bg-white border border-gray-200 shadow-lg z-50 max-h-80 overflow-y-auto rounded-sm">
              {searchResults.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-400">No results for "{search}"</div>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    {searchResults.length} {searchResults.length === 1 ? 'result' : 'results'}
                  </div>
                  {searchResults.map(company => (
                    <button
                      key={company.id}
                      type="button"
                      onClick={() => handleSelectResult(company)}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-[#E0F0F5]/50 transition-colors text-left border-b border-gray-50 last:border-0"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-[#1A1A1A] truncate">{company.name}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {company.stage && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 ${STAGE_CONFIG[company.stage].badgeBg} ${STAGE_CONFIG[company.stage].badgeText} rounded-sm`}>
                              {STAGE_CONFIG[company.stage].label}
                            </span>
                          )}
                          {company.sector && <span className="text-[11px] text-gray-400">{company.sector}</span>}
                          {company.therapeuticArea && <span className="text-[11px] text-gray-400">{company.therapeuticArea}</span>}
                          {company.location && <span className="text-[11px] text-gray-400">{company.location}</span>}
                        </div>
                      </div>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {/* Active chips */}
        {FILTER_KEYS.map(key =>
          filters[key].map(val => (
            <span
              key={`${key}-${val}`}
              className="flex items-center gap-1 bg-[#E0F0F5] text-[#005B6E] text-xs px-2.5 py-1 font-medium rounded-sm"
            >
              <span className="text-[#005B6E]/60 mr-0.5">{FILTER_LABELS[key]}:</span>
              {val}
              <button onClick={() => removeChip(key, val)} className="ml-0.5 hover:text-[#003D4D]">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))
        )}

        {/* Strategy chips */}
        {filters.strategy.map(val => (
          <span key={`strategy-${val}`} className="flex items-center gap-1 bg-[#E0F0F5] text-[#005B6E] text-xs px-2.5 py-1 font-medium rounded-sm">
            <span className="text-[#005B6E]/60 mr-0.5">Strategy:</span>
            {val}
            <button onClick={() => onChange({ ...filters, strategy: filters.strategy.filter(v => v !== val) })} className="ml-0.5 hover:text-[#003D4D]">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {(activeCount > 0 || filters.strategy.length > 0) && (
          <button onClick={() => { clearAll(); onChange({ ...EMPTY_FILTERS }); }} className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-1">
            Clear all
          </button>
        )}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute top-full left-0 right-0 bg-white border-b border-gray-200 shadow-md px-8 py-5 z-40">
          {activeGroups.length === 0 ? (
            <p className="text-sm text-gray-400 py-2">No filterable data yet — add companies first.</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              {activeGroups.map(key => (
                <ComboFilter
                  key={key}
                  label={FILTER_LABELS[key]}
                  options={getOptions(companies, key)}
                  selected={filters[key]}
                  onChange={val => onChange({ ...filters, [key]: val })}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
