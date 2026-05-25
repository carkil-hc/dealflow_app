import { useState, useEffect } from 'react';
import { Company, Stage, ACTIVE_STAGES } from './types';
import { getCompanies, upsertCompany, deleteCompany as apiDeleteCompany } from './store';
import Header, { View } from './components/Header';
import KanbanView from './components/KanbanView';
import ListView from './components/ListView';
import RejectedView from './components/RejectedView';
import CompanyModal from './components/CompanyModal';
import ImportModal from './components/ImportModal';
import FilterBar, { FilterState, EMPTY_FILTERS, applyFilters } from './components/FilterBar';
import BackburnerDialog from './components/BackburnerDialog';
import UserSetup from './components/UserSetup';

const USER_KEY = 'hc-current-user';

export default function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [view, setView] = useState<View>('kanban');
  const [selected, setSelected] = useState<Company | null | 'new'>(null);
  const [currentUser, setCurrentUser] = useState<string>(() => localStorage.getItem(USER_KEY) ?? '');
  const [showUserSetup, setShowUserSetup] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [pendingBackburner, setPendingBackburner] = useState<Company | null>(null);

  // Auto-identify user via Easy Auth (production only).
  // If the header is present the name is set silently — no setup screen needed.
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(({ name }: { name: string | null }) => {
        if (name) {
          localStorage.setItem(USER_KEY, name);
          setCurrentUser(name);
        }
      })
      .catch(() => { /* local dev — fall through to manual setup */ });
  }, []);

  useEffect(() => {
    getCompanies().then(async (remote) => {
      setCompanies(remote);
      // One-time migration: if localStorage has companies and the DB is empty, migrate them
      if (remote.length === 0) {
        try {
          const raw = localStorage.getItem('dealflow-companies');
          if (raw) {
            const local = JSON.parse(raw) as Company[];
            if (local.length > 0) {
              await Promise.all(local.map(c => upsertCompany(c)));
              localStorage.removeItem('dealflow-companies');
              setCompanies(local);
            }
          }
        } catch {
          // ignore migration errors
        }
      }
    }).catch(console.error);
  }, []);

  const handleConfirmUser = (name: string) => {
    localStorage.setItem(USER_KEY, name);
    setCurrentUser(name);
    setShowUserSetup(false);
  };

  const persist = (updated: Company[], changed?: Company, deletedId?: string) => {
    setCompanies(updated);
    if (deletedId) apiDeleteCompany(deletedId).catch(console.error);
    else if (changed) upsertCompany(changed).catch(console.error);
  };

  const handleSave = (company: Company) => {
    const prev = companies.find(c => c.id === company.id);
    const movingToBackburner = company.stage === 'backburner' && prev?.stage !== 'backburner';
    if (movingToBackburner) {
      setPendingBackburner(company);
      setSelected(null);
      return;
    }
    const exists = companies.some(c => c.id === company.id);
    persist(
      exists ? companies.map(c => c.id === company.id ? company : c) : [...companies, company],
      company,
    );
    setSelected(null);
  };

  const commitBackburner = (company: Company, reminderDate: string | undefined) => {
    const updated = { ...company, backburnerReminder: reminderDate };
    const exists = companies.some(c => c.id === updated.id);
    persist(
      exists ? companies.map(c => c.id === updated.id ? updated : c) : [...companies, updated],
      updated,
    );
    setPendingBackburner(null);
  };

  const handleImport = (imported: Company[]) => {
    setCompanies([...companies, ...imported]);
    imported.forEach(c => upsertCompany(c).catch(console.error));
  };

  const handleDelete = (id: string) => {
    persist(companies.filter(c => c.id !== id), undefined, id);
    setSelected(null);
  };

  const handleStageChange = (id: string, stage: Stage) => {
    const now = new Date().toISOString();
    const company = companies.find(c => c.id === id);
    if (!company) return;
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      type: 'stage_changed' as const,
      fromStage: company.stage,
      toStage: stage,
      timestamp: now,
      user: currentUser,
    };
    const updated = { ...company, stage, updatedAt: now, history: [...(company.history || []), entry] };
    if (stage === 'backburner') {
      setPendingBackburner(updated);
      return;
    }
    persist(companies.map(c => c.id === id ? updated : c), updated);
  };

  const activeCompanies = applyFilters(companies.filter(c => c.stage !== 'rejected'), filters);
  const rejectedCompanies = applyFilters(companies.filter(c => c.stage === 'rejected'), filters);

  const counts: Record<string, number> = {};
  for (const s of ACTIVE_STAGES) counts[s] = companies.filter(c => c.stage === s).length;

  // Show user setup on first visit or when triggered
  if (!currentUser || showUserSetup) {
    return <UserSetup onConfirm={handleConfirmUser} existing={currentUser || undefined} />;
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      <Header
        view={view}
        setView={setView}
        onAdd={() => setSelected('new')}
        onImport={() => setShowImport(true)}
        counts={counts}
        rejectedCount={rejectedCompanies.length}
        currentUser={currentUser}
        onChangeUser={() => setShowUserSetup(true)}
      />

      <FilterBar companies={companies} filters={filters} onChange={setFilters} onSelectCompany={setSelected} />

      <main className="flex-1 px-8 py-6">
        {view === 'kanban' && (
          <KanbanView companies={activeCompanies} onSelect={setSelected} onStageChange={handleStageChange} />
        )}
        {view === 'list' && (
          <ListView companies={activeCompanies} onSelect={setSelected} onStageChange={handleStageChange} />
        )}
        {view === 'rejected' && (
          <RejectedView companies={rejectedCompanies} onSelect={setSelected} />
        )}
      </main>

      {pendingBackburner && (
        <BackburnerDialog
          company={pendingBackburner}
          onConfirm={(c, date) => commitBackburner(c, date)}
          onSkip={(c) => commitBackburner(c, undefined)}
        />
      )}

      {showImport && (
        <ImportModal
          existingCompanies={companies}
          onImport={(imported) => { handleImport(imported); setShowImport(false); }}
          onClose={() => setShowImport(false)}
        />
      )}

      {selected !== null && (
        <CompanyModal
          company={selected === 'new' ? null : selected}
          currentUser={currentUser}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
