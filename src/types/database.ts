// Hand-written row types mirroring supabase/migrations/, which are the source of truth;
// update both together. Timestamps are ISO strings as delivered by PostgREST; numerics
// arrive as JSON numbers. Label maps for every enum live here so pages, badges, and
// selects all agree on one vocabulary.

import type { ScoringType } from "../lib/gsr/scoring.ts";

export type ThemeKey = "rococo" | "klasik" | "kingdom" | "rba";
export type Role = "admin" | "employee";

export interface Company {
  id: string;
  slug: string;
  name: string;
  theme_key: ThemeKey;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
}

// What the anonymous login screen may see of a company.
export interface PublicCompany {
  id: string;
  name: string;
  slug: string;
  theme_key: ThemeKey;
  logo_url: string | null;
}

export interface CompanyDomain {
  domain: string;
  company_id: string;
  created_at: string;
}

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  title: string | null;
  // Null until an invitation or domain match places the user; unassigned users see a
  // holding screen.
  company_id: string | null;
  role: Role;
  is_rococo_admin: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  role: Role;
  title: string | null;
  invited_by: string | null;
  created_at: string;
  accepted_at: string | null;
}

// GSR ---------------------------------------------------------------------------------------

// The scoring engine owns this union; re-exported so row types and pages share one name.
export type { ScoringType };

export interface GsrPillar {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  weight: number;
  scoring_type: ScoringType;
  rating_scale_max: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface GsrCriterion {
  id: string;
  pillar_id: string;
  company_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type Cadence = "monthly" | "quarterly" | "semiannual" | "annual" | "custom";
export type CycleStatus = "open" | "closed";

export interface ReviewCycle {
  id: string;
  company_id: string;
  name: string;
  cadence: Cadence;
  period_start: string;
  period_end: string;
  theme: string | null;
  theme_description: string | null;
  status: CycleStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReviewStatus = "not_started" | "in_progress" | "complete";
export type PreviousStatus = "hit" | "partial" | "miss" | "pending";

export interface Review {
  id: string;
  cycle_id: string;
  company_id: string;
  employee_id: string;
  status: ReviewStatus;
  previous_status: PreviousStatus | null;
  manager_feedback: string | null;
  peer_feedback: string | null;
  client_feedback: string | null;
  employee_reflection: string | null;
  reviewer_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewScore {
  id: string;
  review_id: string;
  company_id: string;
  pillar_id: string;
  criterion_id: string | null;
  label: string | null;
  rating: number | null;
  target: number | null;
  actual: number | null;
  notes: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type GoalKind = "professional" | "personal" | "role";
export type GoalStatus = "not_started" | "in_progress" | "on_track" | "achieved" | "missed";

export interface ActionStep {
  text: string;
  done: boolean;
}

export interface Goal {
  id: string;
  company_id: string;
  employee_id: string;
  cycle_id: string | null;
  kind: GoalKind;
  title: string;
  description: string | null;
  status: GoalStatus;
  action_steps: ActionStep[];
  progress_notes: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyGoal {
  id: string;
  company_id: string;
  year: number;
  name: string;
  target_display: string | null;
  current_display: string | null;
  target_numeric: number | null;
  current_numeric: number | null;
  is_hit: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// Library -----------------------------------------------------------------------------------

export type SopCategory = "safety" | "process" | "client" | "admin" | "field";
export type SopStatus = "draft" | "published" | "archived";

export interface Sop {
  id: string;
  company_id: string;
  title: string;
  category: SopCategory;
  summary: string | null;
  status: SopStatus;
  current_version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SopVersion {
  id: string;
  sop_id: string;
  company_id: string;
  version: number;
  body_md: string;
  change_note: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SopAttachment {
  id: string;
  sop_id: string;
  company_id: string;
  file_name: string;
  file_path: string;
  content_type: string | null;
  size_bytes: number | null;
  created_by: string | null;
  created_at: string;
}

export type ResourceKind = "link" | "file" | "template" | "video" | "doc";

export interface Resource {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  kind: ResourceKind;
  url: string | null;
  file_path: string | null;
  file_name: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Labels ------------------------------------------------------------------------------------

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  employee: "Employee",
};

export const SCORING_TYPE_LABELS: Record<ScoringType, string> = {
  rating: "Rated criteria",
  deliverables: "Target vs actual",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
};

export const PREVIOUS_STATUS_LABELS: Record<PreviousStatus, string> = {
  hit: "Hit",
  partial: "Partial",
  miss: "Miss",
  pending: "Pending",
};

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  professional: "Professional",
  personal: "Personal",
  role: "Role",
};

export const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  on_track: "On track",
  achieved: "Achieved",
  missed: "Missed",
};

export const SOP_CATEGORY_LABELS: Record<SopCategory, string> = {
  safety: "Safety",
  process: "Process",
  client: "Client",
  admin: "Admin",
  field: "Field",
};

export const SOP_STATUS_LABELS: Record<SopStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  link: "Link",
  file: "File",
  template: "Template",
  video: "Video",
  doc: "Document",
};

export function keysOf<K extends string>(labels: Record<K, string>): K[] {
  return Object.keys(labels) as K[];
}

// Financials and marketing (Phase 2) --------------------------------------------------------

export type PeriodType = "month" | "quarter" | "year";
export type SnapshotSource = "manual" | "csv" | "quickbooks";

export interface FinancialSnapshot {
  id: string;
  company_id: string;
  period_type: PeriodType;
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  opex: number;
  net_profit: number | null;
  cash_on_hand: number | null;
  notes: string | null;
  source: SnapshotSource;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignStatus = "planned" | "active" | "paused" | "complete";

export interface MarketingCampaign {
  id: string;
  company_id: string;
  name: string;
  channel: string | null;
  status: CampaignStatus;
  start_date: string | null;
  end_date: string | null;
  budget: number | null;
  actual_spend: number | null;
  goal: string | null;
  key_metric_label: string | null;
  key_metric_value: number | null;
  results: string | null;
  notes: string | null;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const PERIOD_TYPE_LABELS: Record<PeriodType, string> = {
  month: "Monthly",
  quarter: "Quarterly",
  year: "Annual",
};

export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  planned: "Planned",
  active: "Active",
  paused: "Paused",
  complete: "Complete",
};

// Suggestions for the channel field; it stays free text so a company can name its own.
export const CAMPAIGN_CHANNELS = [
  "Google Ads",
  "Meta Ads",
  "SEO",
  "Email",
  "Referral program",
  "Events",
  "Print",
  "Signage",
  "Social (organic)",
  "Direct mail",
];
