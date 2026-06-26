import { Company, FUNDING_STAGES } from '../../types';
import { INPUT, LABEL } from '../../ui';
import { Setter } from './helpers';

interface DealTabProps {
  form: Company;
  set: Setter;
}

export default function DealTab({ form, set }: DealTabProps) {
  return (
    <div className="space-y-5">
      <div>
        <label className={LABEL}>Owner</label>
        <input type="text" value={form.owner || ''}
          onChange={e => set('owner', e.target.value || undefined)}
          placeholder="e.g. Anna Lindqvist"
          className={INPUT} />
      </div>

      <div className="border-t border-gray-100 pt-5">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={LABEL}>Financial Stage</label>
            <select value={form.fundingStage || ''} onChange={e => set('fundingStage', e.target.value || undefined)}
              className={INPUT}>
              <option value="">Select…</option>
              {FUNDING_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label className={LABEL}>Ask Amount</label>
            <input type="text" value={form.askAmount || ''}
              onChange={e => set('askAmount', e.target.value || undefined)}
              placeholder="e.g. €15M" className={INPUT} />
          </div>
        </div>
      </div>

      <div>
        <label className={LABEL}>Pre-Money Valuation</label>
        <input type="text" value={form.valuation || ''}
          onChange={e => set('valuation', e.target.value || undefined)}
          placeholder="e.g. €60M" className={INPUT} />
      </div>

      <div className="border-t border-gray-100 pt-5">
        <label className={LABEL}>Lead Contact</label>
        <input type="text" value={form.leadContact || ''}
          onChange={e => set('leadContact', e.target.value || undefined)}
          placeholder="Full name" className={INPUT} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Email</label>
          <input type="email" value={form.email || ''}
            onChange={e => set('email', e.target.value || undefined)}
            placeholder="contact@company.com" className={INPUT} />
        </div>
        <div>
          <label className={LABEL}>Phone</label>
          <input type="tel" value={form.phone || ''}
            onChange={e => set('phone', e.target.value || undefined)}
            placeholder="+1 (555) 000-0000" className={INPUT} />
        </div>
      </div>
    </div>
  );
}
