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

// ── Due diligence ────────────────────────────────────────────────────────

export type RiskLevel = 1 | 2 | 3 | 4 | 5;

// A single sourced contribution to a risk category. Manual entries are
// first-class; file/transcript entries (later phases) carry provenance and a
// *suggested* risk level that a person confirms.
export interface DDFinding {
  id: string;
  text: string;
  source: 'manual' | 'file' | 'transcript';
  sourceRef?: string;              // filename, meeting date, or author
  riskLevelSuggested?: RiskLevel;  // AI proposal; never auto-committed
  createdAt: string;
  createdBy?: string;
}

export type DDStatus = 'not_started' | 'in_progress' | 'assessed';

export interface DDRiskItem {
  category: string;                // e.g. 'Target biology'
  question: string;                // guiding question (stored for portability)
  comments: string;                // working comment / synthesis
  riskLevel: RiskLevel | null;     // committed 1–5 score (person decides)
  status: DDStatus;
  findings?: DDFinding[];          // sourced contributions (phase 2+)
}

export interface DDAssessment {
  template: string;                // e.g. 'pharmaceutical'
  items: DDRiskItem[];
  updatedAt?: string;
  updatedBy?: string;
}

// Pharmaceutical DD framework (from the HealthCap risk-assessment template).
export const DD_PHARMA_TEMPLATE: { category: string; question: string }[] = [
  { category: 'Target biology', question: 'Is the MoA relevant for the disease of interest?' },
  { category: 'Translatability', question: 'Can results from preclinical models reliably be translated to clinical disease?' },
  { category: 'PK / Biodistribution', question: 'Will the molecule reach the target in sufficient quantity?' },
  { category: 'Toxicology', question: 'Is the molecule safe and are there specific tolerability questions?' },
  { category: 'CMC', question: 'Is manufacturing feasible at relevant clinical scale?' },
  { category: 'Clinical development / Regulatory', question: 'Is it possible to prove the TPP in a realistic time, recruit patients, and establish a dosing regimen? Is there a clear regulatory path (endpoints etc)?' },
  { category: 'Commercial', question: 'Market size? Differentiation?' },
  { category: 'Intellectual property', question: 'Is there IP to allow adequate protection from competition?' },
  { category: 'Main differentiator', question: 'What aspect in the technology/target will be the main differentiator to competitors?' },
];

// Which template applies to a company (by sector). Returns null if none yet.
export function ddTemplateFor(sector: string | undefined): { id: string; items: { category: string; question: string }[] } | null {
  if (sector === 'Pharmaceutical') return { id: 'pharmaceutical', items: DD_PHARMA_TEMPLATE };
  return null;
}

// Derive a risk item's status from its content.
export function ddItemStatus(item: Pick<DDRiskItem, 'comments' | 'riskLevel'>): DDStatus {
  if (item.riskLevel != null) return 'assessed';
  if (item.comments.trim()) return 'in_progress';
  return 'not_started';
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
  ddAssessment?: DDAssessment;
  // Set on the lightweight list (where attachment blobs aren't loaded) to
  // indicate the company has files without shipping them.
  hasAttachments?: boolean;
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
    headerBg: 'bg-hc-teal-50',
    headerText: 'text-hc-teal',
    badgeBg: 'bg-hc-teal-50',
    badgeText: 'text-hc-teal',
    dot: 'bg-hc-teal',
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

// Stages shown as columns on the board. Invested is a valid stage (still
// selectable in the company modal) but has its own dedicated view, so it is
// not a board column.
export const BOARD_STAGES: Stage[] = [
  'new', 'first_meeting', 'due_diligence', 'terms_negotiation', 'backburner',
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

// Generate a reasonably-unique id for client-created entities (companies,
// notes, history entries, attachments).
export function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

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
