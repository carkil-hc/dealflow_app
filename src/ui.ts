// Shared UI class strings and helpers used across components.
import type { RiskLevel } from './types';

// Standard text input / select / textarea styling.
export const INPUT =
  'w-full border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] bg-white rounded-sm';

// Field label above an input.
export const LABEL = 'block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1';

// ── Risk-level colours (1 = low/green … 5 = high/red) ────────────────────────
export const RISK_LABEL: Record<RiskLevel, string> = {
  1: 'Low', 2: 'Low–Medium', 3: 'Medium', 4: 'High', 5: 'Very High',
};

// Read-only pill (background + text + border).
export const RISK_PILL: Record<RiskLevel, string> = {
  1: 'text-green-700 bg-green-50 border-green-200',
  2: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  3: 'text-amber-700 bg-amber-50 border-amber-200',
  4: 'text-orange-700 bg-orange-50 border-orange-200',
  5: 'text-red-700 bg-red-50 border-red-200',
};

// Interactive selector button (selected `on` vs unselected `off`).
export const RISK_BUTTON: Record<RiskLevel, { on: string; off: string }> = {
  1: { on: 'bg-green-600 text-white border-green-600',     off: 'text-green-700 border-green-300 hover:bg-green-50' },
  2: { on: 'bg-emerald-600 text-white border-emerald-600', off: 'text-emerald-700 border-emerald-300 hover:bg-emerald-50' },
  3: { on: 'bg-amber-500 text-white border-amber-500',     off: 'text-amber-700 border-amber-300 hover:bg-amber-50' },
  4: { on: 'bg-orange-600 text-white border-orange-600',   off: 'text-orange-700 border-orange-300 hover:bg-orange-50' },
  5: { on: 'bg-red-600 text-white border-red-600',         off: 'text-red-700 border-red-300 hover:bg-red-50' },
};

// Trigger a browser download of base64-encoded bytes.
export function downloadBase64(base64: string, filename: string, mime: string) {
  const chars = atob(base64);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i++) bytes[i] = chars.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
