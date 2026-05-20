import { useRef, useState, useEffect } from 'react';
import { SlidersHorizontal, X, ChevronDown, Search, Check } from 'lucide-react';
import { Company } from '../types';

export interface FilterState {
  sector: string[];
  therapeuticArea: string[];
  developmentStage: string[];
  fundingStage: string[];
  location: string[];
  nextMilestone: string[];
  owner: string[];
}

export const EMPTY_FILTERS: FilterState = {
  sector: [],
  therapeuticArea: [],
  developmentStage: [],
  fundingStage: [],
  location: [],
  nextMilestone: [],
  owner: [],
};

type FilterKey = keyof FilterState;

export function applyFilters(companies: Company[], filters: FilterState, search = ''): Company[] {
  const q = search.trim().toLowerCase();
  return companies.filter(c => {
    if (filters.sector.length && !filters.sector.includes(c.sector ?? '')) return false;
    if (filters.therapeuticArea.length && !filters.therapeuticArea.includes(c.therapeuticArea ?? '')) return false;
    if (filters.developmentStage.length && !filters.developmentStage.includes(c.developmentStage ?? '')) return false;
    if (filters.fundingStage.length && !filters.fundingStage.includes(c.fundingStage ?? '')) return false;
    if (filters.location.length && !filters.location.includes(c.location ?? '')) return false;
    if (filters.nextMilestone.length && !filters.nextMilestone.includes(c.nextMilestone ?? '')) return false;
    if (filters.owner.length && !filters.owner.includes(c.owner ?? '')) return false;
    if (q) {
      const haystack = [
        c.name, c.description, c.location, c.sector, c.therapeuticArea,
        c.developmentStage, c.nextMilestone, c.fundingStage, c.askAmount,
        c.valuation, c.owner, c.leadContact, c.email, c.website,
      ].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
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
        } bg-white`}
        style={{ borderRadius: 2 }}
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
        <div className="absolute top-full left-0 right-0 mt-0.5 bg-white border border-gray-200 shadow-md z-50 max-h-48 overflow-y-auto" style={{ borderRadius: 2 }}>
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
  search: string;
  onSearchChange: (s: string) => void;
}

export default function FilterBar({ companies, filters, onChange, search, onSearchChange }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
          }`}
          style={{ borderRadius: 2 }}
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

        {/* Search box */}
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search companies…"
            className="pl-8 pr-7 py-1.5 text-sm border border-gray-200 hover:border-gray-300 focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] outline-none bg-white w-56 transition-colors"
            style={{ borderRadius: 2 }}
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 text-gray-300 hover:text-gray-500 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Active chips */}
        {FILTER_KEYS.map(key =>
          filters[key].map(val => (
            <span
              key={`${key}-${val}`}
              className="flex items-center gap-1 bg-[#E0F0F5] text-[#005B6E] text-xs px-2.5 py-1 font-medium"
              style={{ borderRadius: 2 }}
            >
              <span className="text-[#005B6E]/60 mr-0.5">{FILTER_LABELS[key]}:</span>
              {val}
              <button onClick={() => removeChip(key, val)} className="ml-0.5 hover:text-[#003D4D]">
                <X className="w-3 h-3" />
              </button>
            </span>
          ))
        )}

        {activeCount > 0 && (
          <button onClick={clearAll} className="text-xs text-gray-400 hover:text-red-500 transition-colors ml-1">
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
