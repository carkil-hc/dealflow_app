export type Stage =
  | 'new'
  | 'first_meeting'
  | 'due_diligence'
  | 'terms_negotiation'
  | 'invested'
  | 'backburner'
  | 'rejected';

export interface NoteEntry {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
}

export type HistoryEventType =
  | 'created'
  | 'stage_changed'
  | 'note_added'
  | 'note_edited'
  | 'note_deleted'
  | 'file_added'
  | 'file_removed'
  | 'rejected'
  | 'reactivated';

export interface HistoryEntry {
  id: string;
  type: HistoryEventType;
  timestamp: string;
  user?: string;
  fromStage?: string;
  toStage?: string;
  detail?: string;
}

export interface Attachment {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  /** Base64-encoded file data — present for server-ingested attachments (e.g. pitch decks) */
  data?: string;
}

export interface Company {
  id: string;
  name: string;
  description: string;
  stage: Stage;
  // Company details
  website?: string;
  sector?: string;
  location?: string;          // country only
  therapeuticArea?: string;
  developmentStage?: string;
  nextMilestone?: string;
  // Deal details
  fundingStage?: string;
  askAmount?: string;
  valuation?: string;
  // Strategy
  strategy?: Strategy;
  // Ownership
  owner?: string;
  // Backburner
  backburnerReminder?: string; // ISO date string (date only)
  // Contact
  leadContact?: string;
  email?: string;
  phone?: string;
  // Notes
  noteEntries: NoteEntry[];
  attachments: Attachment[];
  history: HistoryEntry[];
  // Meta
  createdAt: string;
  updatedAt: string;
  rejectedReason?: string;
  rejectedAt?: string;
}

export interface StageConfig {
  label: string;
  shortLabel: string;
  headerBg: string;
  headerText: string;
  badgeBg: string;
  badgeText: string;
  dot: string;
}

export const STAGE_CONFIG: Record<Stage, StageConfig> = {
  new: {
    label: 'New',
    shortLabel: 'New',
    headerBg: 'bg-gray-100',
    headerText: 'text-gray-700',
    badgeBg: 'bg-gray-100',
    badgeText: 'text-gray-600',
    dot: 'bg-gray-400',
  },
  first_meeting: {
    label: 'First Meeting',
    shortLabel: 'Meeting',
    headerBg: 'bg-blue-50',
    headerText: 'text-blue-700',
    badgeBg: 'bg-blue-50',
    badgeText: 'text-blue-700',
    dot: 'bg-blue-400',
  },
  due_diligence: {
    label: 'Due Diligence',
    shortLabel: 'Due Diligence',
    headerBg: 'bg-violet-50',
    headerText: 'text-violet-700',
    badgeBg: 'bg-violet-50',
    badgeText: 'text-violet-700',
    dot: 'bg-violet-400',
  },
  terms_negotiation: {
    label: 'Terms Negotiation',
    shortLabel: 'Terms',
    headerBg: 'bg-amber-50',
    headerText: 'text-amber-700',
    badgeBg: 'bg-amber-50',
    badgeText: 'text-amber-700',
    dot: 'bg-amber-400',
  },
  invested: {
    label: 'Invested',
    shortLabel: 'Invested',
    headerBg: 'bg-[#E0F0F5]',
    headerText: 'text-[#005B6E]',
    badgeBg: 'bg-[#E0F0F5]',
    badgeText: 'text-[#005B6E]',
    dot: 'bg-[#005B6E]',
  },
  backburner: {
    label: 'Backburner',
    shortLabel: 'Backburner',
    headerBg: 'bg-stone-100',
    headerText: 'text-stone-500',
    badgeBg: 'bg-stone-100',
    badgeText: 'text-stone-500',
    dot: 'bg-stone-400',
  },
  rejected: {
    label: 'Rejected',
    shortLabel: 'Rejected',
    headerBg: 'bg-red-50',
    headerText: 'text-red-600',
    badgeBg: 'bg-red-50',
    badgeText: 'text-red-600',
    dot: 'bg-red-400',
  },
};

export const ACTIVE_STAGES: Stage[] = [
  'new', 'first_meeting', 'due_diligence', 'terms_negotiation', 'invested', 'backburner',
];

export const PIPELINE_STAGES: Stage[] = [
  'new', 'first_meeting', 'due_diligence', 'terms_negotiation', 'invested',
];

export const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  new: 'first_meeting',
  first_meeting: 'due_diligence',
  due_diligence: 'terms_negotiation',
  terms_negotiation: 'invested',
};

export type Strategy = 'N/a' | 'Biotech' | 'Tech' | 'Growth';

export const STRATEGIES: Strategy[] = ['N/a', 'Biotech', 'Tech', 'Growth'];

export const SECTORS = [
  'Pharmaceutical',
  'Medtech',
  'Healthtech',
  'Tool',
  'Other',
];

export const DEVELOPMENT_STAGES = [
  'Preclinical',
  'IND-stage',
  'Phase I',
  'Phase II',
  'Phase III',
  'Marketed',
];

export const THERAPEUTIC_AREAS = [
  'Cardiology',
  'Cardiovascular',
  'CNS',
  'Dermatology',
  'Endocrinology',
  'GI',
  'Hematology',
  'Immunology',
  'Infectious Disease',
  'Kidney Disease',
  'Liver Disease',
  'Metabolic',
  'Musculoskeletal',
  'Oncology',
  'Ophthalmology',
  'Pain',
  'Psychiatry',
  'Rare Disease',
  'Respiratory',
  'Urology',
  "Women's Health",
];

export const FUNDING_STAGES = [
  'Seed',
  'Series A',
  'Series B',
  'Series C+',
  'IPO',
  'Public',
];

export const NEXT_MILESTONES = [
  'Preclinical PoC',
  'IND',
  'Clinical PoC',
  'Approval',
  'Revenue Growth',
];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function userInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Deterministic color from user name (for avatar backgrounds)
const AVATAR_COLORS = [
  '#1B5E4E', '#2563B0', '#7C3AED', '#B45309', '#0F766E',
  '#9D174D', '#1D4ED8', '#059669', '#D97706', '#7C3AED',
];
export function userColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
