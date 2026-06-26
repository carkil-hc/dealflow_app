import { Company, HistoryEntry, uid } from '../../types';

// Append a history entry to a company, returning a new object.
export function addHistory(form: Company, entry: Omit<HistoryEntry, 'id'>): Company {
  return { ...form, history: [...(form.history || []), { id: uid(), ...entry }] };
}

// Typed field setter shared by the form tabs.
export type Setter = <K extends keyof Company>(key: K, value: Company[K]) => void;

export const REJECTION_REASONS = [
  'Too early',
  'Too late',
  'Not in scope',
  'Data strength',
  'No IP',
  'Market opportunity',
];
