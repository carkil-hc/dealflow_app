import { useState, useEffect } from 'react';
import { Company, Stage, ACTIVE_STAGES, uid } from './types';
import { getCompanies, upsertCompany, deleteCompany as apiDeleteCompany, bulkUpsertCompanies } from './store';
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

// Local development runs without Azure Easy Auth. Everywhere else the identity
// must come from Microsoft sign-in.
const IS_LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

export default function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [view, setView] = useState<View>('kanban');
  const [selected, setSelected] = useState<Company | null | 'new'>(null);
  const [currentUser, setCurrentUser] = useState<string>(() => localStorage.getItem(USER_KEY) ?? '');
  const [showUserSetup, setShowUserSetup] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [pendingBackburner, setPendingBackburner] = useState<Company | null>(null);

  // Identify the user via Easy Auth. In production, if there is no Microsoft
  // session, send the browser to the Microsoft sign-in page rather than showing
  // the manual name-entry screen (which exists only for local development).
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(({ name }: { name: string | null }) => {
        if (name) {
          localStorage.setItem(USER_KEY, name);
          setCurrentUser(name);
          setAuthChecked(true);
        } else if (!IS_LOCALHOST) {
          window.location.href = '/.auth/login/aad?post_login_redirect_uri=/';
        } else {
          setAuthChecked(true);
        }
      })
      .catch(() => setAuthChecked(true));
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

  // Persist changes made inside the open modal (e.g. adding a note) without
  // closing it. Deliberately does not touch `selected`: changing the modal's
  // `company` prop would reset its form and active tab.
  const handleAutoSave = (company: Company) => {
    const exists = companies.some(c => c.id === company.id);
    persist(
      exists ? companies.map(c => c.id === company.id ? company : c) : [...companies, company],
      company,
    );
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

  // Persist an imported batch in awaited chunks (not one request per row, which
  // floods the connection pool and silently drops most). Reload from the DB at
  // the end so the UI reflects exactly what was saved.
  const handleImport = async (imported: Company[]) => {
    const CHUNK = 200;
    for (let i = 0; i < imported.length; i += CHUNK) {
      const batch = imported.slice(i, i + CHUNK);
      try {
        await bulkUpsertCompanies(batch);
      } catch (e) {
        console.error(`Import chunk ${i}–${i + batch.length} failed`, e);
      }
    }
    try {
      setCompanies(await getCompanies());
    } catch {
      setCompanies(prev => [...prev, ...imported]); // fallback to optimistic
    }
  };

  const handleExport = () => {
    const cols = [
      'name', 'stage', 'strategy', 'sector', 'therapeuticArea', 'developmentStage',
      'nextMilestone', 'fundingStage', 'askAmount', 'valuation', 'owner',
      'location', 'website', 'leadContact', 'email', 'phone', 'description',
      'createdAt', 'updatedAt', 'rejectedReason', 'rejectedAt',
    ] as const;

    const escape = (v: unknown) => {
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };

    const rows = [
      cols.join(','),
      ...companies.map(c => cols.map(k => escape(c[k as keyof typeof c])).join(',')),
    ].join('\n');

    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dealflow-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
      id: uid(),
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

  // Production: wait for the Microsoft identity check before rendering anything
  // (avoids briefly flashing stale/cached UI, and we redirect to sign-in if needed).
  if (!IS_LOCALHOST && !authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FAFAFA] text-sm text-gray-400">
        Signing in…
      </div>
    );
  }

  // Manual name entry is for local development only; in production identity comes
  // from Microsoft. showUserSetup still allows an explicit "change user" action.
  if ((IS_LOCALHOST && !currentUser) || showUserSetup) {
    return <UserSetup onConfirm={handleConfirmUser} existing={currentUser || undefined} />;
  }

  return (
    <div className="min-h-screen bg-[#FAFAFA] flex flex-col">
      <Header
        view={view}
        setView={setView}
        onExport={handleExport}
        onImport={() => setShowImport(true)}
        counts={counts}
        rejectedCount={rejectedCompanies.length}
        currentUser={currentUser}
        onChangeUser={() => setShowUserSetup(true)}
      />

      <FilterBar companies={companies} filters={filters} onChange={setFilters} onSelectCompany={setSelected} />

      <main className="flex-1 px-8 py-6">
        {view === 'kanban' && (
          <KanbanView companies={activeCompanies} onSelect={setSelected} onStageChange={handleStageChange} onAdd={() => setSelected('new')} />
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
          onImport={handleImport}
          onClose={() => setShowImport(false)}
        />
      )}

      {selected !== null && (
        <CompanyModal
          company={selected === 'new' ? null : selected}
          currentUser={currentUser}
          onSave={handleSave}
          onAutoSave={handleAutoSave}
          onDelete={handleDelete}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
