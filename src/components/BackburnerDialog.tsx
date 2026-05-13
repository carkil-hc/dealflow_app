import { useState } from 'react';
import { Clock, X } from 'lucide-react';
import { Company } from '../types';

interface Props {
  company: Company;
  onConfirm: (company: Company, reminderDate: string | undefined) => void;
  onSkip: (company: Company) => void;
}

const QUICK_OPTIONS = [
  { label: '2 weeks', days: 14 },
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
];

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatReminder(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function BackburnerDialog({ company, onConfirm, onSkip }: Props) {
  const [date, setDate] = useState('');

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm shadow-xl border border-gray-200" style={{ borderRadius: 2 }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-stone-400" />
            <h2 className="text-sm font-semibold text-[#1A1A1A]">Set a Follow-up Reminder</h2>
          </div>
          <button onClick={() => onSkip(company)} className="text-gray-400 hover:text-[#1A1A1A] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-gray-500">
            When would you like to follow up on <strong className="text-[#1A1A1A]">{company.name}</strong>?
          </p>

          {/* Quick pick */}
          <div className="grid grid-cols-2 gap-2">
            {QUICK_OPTIONS.map(opt => {
              const val = addDays(opt.days);
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setDate(val)}
                  className={`px-3 py-2 text-sm border transition-colors text-left ${
                    date === val
                      ? 'border-stone-400 bg-stone-50 text-stone-700 font-medium'
                      : 'border-gray-200 text-gray-600 hover:border-gray-400 hover:text-[#1A1A1A]'
                  }`}
                  style={{ borderRadius: 2 }}
                >
                  {opt.label}
                  <span className="block text-[11px] text-gray-400 font-normal mt-0.5">{formatReminder(val)}</span>
                </button>
              );
            })}
          </div>

          {/* Custom date */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
              Or pick a date
            </label>
            <input
              type="date"
              value={date}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setDate(e.target.value)}
              className="w-full border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white"
              style={{ borderRadius: 2 }}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-200 flex items-center justify-between gap-2">
          <button
            onClick={() => onSkip(company)}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip reminder
          </button>
          <button
            onClick={() => onConfirm(company, date || undefined)}
            disabled={!date}
            className="px-4 py-2 text-sm font-medium bg-stone-600 hover:bg-stone-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderRadius: 2 }}
          >
            Set Reminder
          </button>
        </div>
      </div>
    </div>
  );
}
