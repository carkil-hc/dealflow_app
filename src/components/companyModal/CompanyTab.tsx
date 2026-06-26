import {
  Company, Stage, Strategy, STAGE_CONFIG, ACTIVE_STAGES,
  SECTORS, STRATEGIES, DEVELOPMENT_STAGES, THERAPEUTIC_AREAS, NEXT_MILESTONES,
  formatDate,
} from '../../types';
import { INPUT, LABEL } from '../../ui';
import { Setter } from './helpers';

interface CompanyTabProps {
  form: Company;
  set: Setter;
  errors: { name?: string };
  onRejectClick: () => void;
}

export default function CompanyTab({ form, set, errors, onRejectClick }: CompanyTabProps) {
  const isRejected = form.stage === 'rejected';

  return (
    <div className="space-y-5">
      {/* Name + description */}
      <div>
        <label className={LABEL}>Company Name <span className="text-red-400 normal-case font-normal">*</span></label>
        <input type="text" value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. Genomica Therapeutics"
          className={`${INPUT} ${errors.name ? 'border-red-400' : ''}`} />
        {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
      </div>

      <div>
        <label className={LABEL}>Description</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)}
          rows={3} placeholder="Brief description of the company and its technology…"
          className={`${INPUT} resize-none`} />
      </div>

      {/* 2-col grid */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Sector</label>
          <select value={form.sector || ''} onChange={e => set('sector', e.target.value || undefined)}
            className={INPUT}>
            <option value="">Select…</option>
            {SECTORS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Therapeutic Area</label>
          <select value={form.therapeuticArea || ''} onChange={e => set('therapeuticArea', e.target.value || undefined)}
            className={INPUT}>
            <option value="">Select…</option>
            {THERAPEUTIC_AREAS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Strategy</label>
          <div className="flex gap-2 flex-wrap pt-0.5">
            {STRATEGIES.map(s => (
              <button key={s} type="button"
                onClick={() => set('strategy', s as Strategy)}
                className={`px-3 py-1.5 text-xs font-medium border transition-colors ${
                  (form.strategy ?? 'N/a') === s
                    ? 'bg-[#005B6E] text-white border-[#005B6E]'
                    : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                } rounded-sm`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className={LABEL}>Owner</label>
          <input type="text" value={form.owner || ''}
            onChange={e => set('owner', e.target.value || undefined)}
            placeholder="e.g. Carl" className={INPUT} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Development Stage</label>
          <select value={form.developmentStage || ''} onChange={e => set('developmentStage', e.target.value || undefined)}
            className={INPUT}>
            <option value="">Select…</option>
            {DEVELOPMENT_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={LABEL}>Next Milestone</label>
          <select value={form.nextMilestone || ''} onChange={e => set('nextMilestone', e.target.value || undefined)}
            className={INPUT}>
            <option value="">Select…</option>
            {NEXT_MILESTONES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Country</label>
          <input type="text" value={form.location || ''}
            onChange={e => set('location', e.target.value || undefined)}
            placeholder="e.g. Sweden" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Website</label>
          <input type="url" value={form.website || ''}
            onChange={e => set('website', e.target.value || undefined)}
            placeholder="https://…" className={INPUT} />
        </div>
      </div>

      {/* Pipeline stage selector */}
      <div>
        <label className={LABEL}>Pipeline Stage</label>
        <div className="flex flex-wrap gap-2">
          {([...ACTIVE_STAGES, 'rejected' as Stage]).map((s) => {
            const sc = STAGE_CONFIG[s];
            return (
              <button key={s} type="button"
                onClick={() => s === 'rejected' ? onRejectClick() : set('stage', s)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border ${
                  form.stage === s
                    ? `${sc.badgeBg} ${sc.badgeText} border-current`
                    : 'bg-white text-gray-400 border-gray-200 hover:border-gray-400 hover:text-gray-700'
                } rounded-sm`}>
                {sc.label}
              </button>
            );
          })}
        </div>
      </div>

      {form.stage === 'backburner' && (
        <div className="bg-stone-50 border border-stone-200 px-4 py-3 rounded-sm">
          <label className="block text-xs font-semibold text-stone-500 uppercase tracking-wide mb-2">
            Follow-up Reminder
          </label>
          <input
            type="date"
            value={form.backburnerReminder || ''}
            onChange={e => set('backburnerReminder', e.target.value || undefined)}
            className="w-full border border-stone-200 px-3 py-2 text-sm focus:outline-none focus:border-stone-400 bg-white rounded-sm"
          />
        </div>
      )}

      {isRejected && form.rejectedReason && (
        <div className="bg-red-50 border border-red-100 px-4 py-3 rounded-sm">
          <p className="text-[11px] font-semibold text-red-500 uppercase tracking-wide mb-1">Rejection Reason</p>
          <p className="text-sm text-red-700">{form.rejectedReason}</p>
          {form.rejectedAt && <p className="text-[11px] text-red-400 mt-1">Rejected {formatDate(form.rejectedAt)}</p>}
        </div>
      )}
    </div>
  );
}
