import { useRef, useState, useEffect } from 'react';
import { LayoutGrid, List, XCircle, Plus, ChevronDown, Upload } from 'lucide-react';

export type View = 'kanban' | 'list' | 'rejected';

interface Props {
  view: View;
  setView: (v: View) => void;
  onAdd: () => void;
  onImport: () => void;
  counts: Record<string, number>;
  rejectedCount: number;
  currentUser: string;
  onChangeUser: () => void;
}

export default function Header({ view, setView, onAdd, onImport, counts, rejectedCount, currentUser, onChangeUser }: Props) {
  const totalActive = Object.values(counts).reduce((a, b) => a + b, 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="px-8 h-[60px] flex items-center justify-between gap-6">

        {/* HealthCap logo */}
        <div className="flex items-center gap-6 shrink-0">
          <div className="flex items-center gap-3 select-none">
            <img src="/logo.jpg" alt="HealthCap" className="h-8 w-auto" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span className="font-light text-[#1A1A1A] text-base">Dealflow</span>
          </div>

          {/* Pipeline count */}
          <span className="hidden lg:block text-xs text-gray-400">
            <span className="font-medium text-[#1A1A1A]">{totalActive}</span> active
            {rejectedCount > 0 && <> · <span className="text-red-500 font-medium">{rejectedCount}</span> rejected</>}
          </span>
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1">
          {([
            { id: 'kanban' as View, label: 'Board',    Icon: LayoutGrid },
            { id: 'list'   as View, label: 'List',     Icon: List },
            { id: 'rejected' as View, label: 'Rejected', Icon: XCircle, count: rejectedCount },
          ]).map(({ id, label, Icon, count }) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm transition-colors ${
                view === id
                  ? 'bg-[#E0F0F5] text-[#005B6E] font-medium'
                  : 'text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-50'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
              {count != null && count > 0 && (
                <span className="ml-0.5 bg-red-100 text-red-600 text-xs font-semibold rounded-full px-1.5 py-0.5 leading-none">
                  {count}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          {/* User chip */}
          <button
            onClick={onChangeUser}
            className="hidden sm:flex items-center gap-1.5 text-xs text-gray-500 hover:text-[#1A1A1A] transition-colors"
            title="Change user"
          >
            <span className="w-6 h-6 rounded-full bg-[#005B6E] text-white text-[10px] font-bold flex items-center justify-center">
              {currentUser.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
            </span>
            <span className="font-medium">{currentUser}</span>
          </button>

          {/* Actions dropdown */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setMenuOpen(o => !o)}
              className="flex items-center gap-1.5 border border-gray-200 hover:border-gray-300 text-gray-600 hover:text-[#1A1A1A] px-3 py-2 text-sm transition-colors bg-white"
              style={{ borderRadius: 2 }}
            >
              Actions
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 shadow-md w-44 z-50" style={{ borderRadius: 2 }}>
                <button
                  onClick={() => { setMenuOpen(false); onImport(); }}
                  className="flex items-center gap-2.5 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 hover:text-[#1A1A1A] transition-colors"
                >
                  <Upload className="w-4 h-4 text-gray-400" />
                  Import from CSV
                </button>
              </div>
            )}
          </div>

          {/* Add Company */}
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 bg-[#005B6E] hover:bg-[#004A58] text-white px-4 py-2 text-sm font-medium transition-colors"
            style={{ borderRadius: 2 }}
          >
            <Plus className="w-4 h-4" />
            Add Company
          </button>
        </div>
      </div>
    </header>
  );
}
