// Data layer for the GSR module: pillar configuration, review cycles, reviews and their
// scores, employee goals, and company goals. Plain async functions that throw; the pages
// catch and message. Every insert passes company_id explicitly (Rococo admins act on
// behalf of a chosen company), and child rows are re-stamped by database triggers so a
// score can never land under the wrong company.
import { db } from "./supabase.ts";
import type {
  ActionStep,
  CompanyGoal,
  Goal,
  GoalKind,
  GoalScope,
  GoalStatus,
  GsrCriterion,
  GsrPillar,
  Review,
  ReviewCycle,
  ReviewScore,
} from "../types/database.ts";

const PILLAR_COLUMNS =
  "id, company_id, name, description, weight, scoring_type, rating_scale_max, sort_order, is_active, created_at, updated_at";
const CRITERION_COLUMNS = "id, pillar_id, company_id, name, description, sort_order, is_active, created_at, updated_at";
const CYCLE_COLUMNS =
  "id, company_id, name, cadence, period_start, period_end, theme, theme_description, status, created_by, created_at, updated_at";
const REVIEW_COLUMNS =
  "id, cycle_id, company_id, employee_id, status, previous_status, manager_feedback, peer_feedback, client_feedback, employee_reflection, reviewer_id, completed_at, created_at, updated_at";
const SCORE_COLUMNS =
  "id, review_id, company_id, pillar_id, criterion_id, label, rating, target, actual, notes, sort_order, created_at, updated_at";
const GOAL_COLUMNS =
  "id, company_id, employee_id, cycle_id, kind, title, description, status, action_steps, progress_notes, progress, scope, year, carried_from_goal_id, outcome_note, sort_order, created_by, created_at, updated_at";
const COMPANY_GOAL_COLUMNS =
  "id, company_id, year, name, target_display, current_display, target_numeric, current_numeric, is_hit, sort_order, created_at, updated_at";

// Pillars and criteria -----------------------------------------------------------------------

export async function listPillars(companyId: string, includeInactive = false): Promise<GsrPillar[]> {
  let query = db().from("gsr_pillars").select(PILLAR_COLUMNS).eq("company_id", companyId);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("sort_order").order("created_at");
  if (error) throw error;
  return (data as GsrPillar[]) ?? [];
}

export type PillarInput = Pick<GsrPillar, "company_id" | "name" | "weight" | "scoring_type"> &
  Partial<Pick<GsrPillar, "description" | "rating_scale_max" | "sort_order" | "is_active">>;

export async function createPillar(input: PillarInput): Promise<GsrPillar> {
  const { data, error } = await db().from("gsr_pillars").insert(input).select(PILLAR_COLUMNS).single();
  if (error) throw error;
  return data as GsrPillar;
}

export async function updatePillar(id: string, patch: Partial<PillarInput>): Promise<GsrPillar> {
  const { data, error } = await db().from("gsr_pillars").update(patch).eq("id", id).select(PILLAR_COLUMNS).single();
  if (error) throw error;
  return data as GsrPillar;
}

export async function deletePillar(id: string): Promise<void> {
  const { error } = await db().from("gsr_pillars").delete().eq("id", id);
  if (error) throw error;
}

export async function listCriteria(companyId: string, includeInactive = false): Promise<GsrCriterion[]> {
  let query = db().from("gsr_criteria").select(CRITERION_COLUMNS).eq("company_id", companyId);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("sort_order").order("created_at");
  if (error) throw error;
  return (data as GsrCriterion[]) ?? [];
}

export async function createCriterion(input: {
  pillar_id: string;
  company_id: string;
  name: string;
  description?: string | null;
  sort_order?: number;
}): Promise<GsrCriterion> {
  const { data, error } = await db().from("gsr_criteria").insert(input).select(CRITERION_COLUMNS).single();
  if (error) throw error;
  return data as GsrCriterion;
}

export async function updateCriterion(
  id: string,
  patch: Partial<Pick<GsrCriterion, "name" | "description" | "sort_order" | "is_active">>,
): Promise<GsrCriterion> {
  const { data, error } = await db().from("gsr_criteria").update(patch).eq("id", id).select(CRITERION_COLUMNS).single();
  if (error) throw error;
  return data as GsrCriterion;
}

export async function deleteCriterion(id: string): Promise<void> {
  const { error } = await db().from("gsr_criteria").delete().eq("id", id);
  if (error) throw error;
}

// Cycles -----------------------------------------------------------------------------------

export async function listCycles(companyId: string): Promise<ReviewCycle[]> {
  const { data, error } = await db()
    .from("review_cycles")
    .select(CYCLE_COLUMNS)
    .eq("company_id", companyId)
    .order("period_start", { ascending: false });
  if (error) throw error;
  return (data as ReviewCycle[]) ?? [];
}

export async function getCycle(id: string): Promise<ReviewCycle> {
  const { data, error } = await db().from("review_cycles").select(CYCLE_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as ReviewCycle;
}

export type CycleInput = Pick<ReviewCycle, "company_id" | "name" | "cadence" | "period_start" | "period_end"> &
  Partial<Pick<ReviewCycle, "theme" | "theme_description" | "status">>;

export async function createCycle(input: CycleInput): Promise<ReviewCycle> {
  const { data, error } = await db().from("review_cycles").insert(input).select(CYCLE_COLUMNS).single();
  if (error) throw error;
  return data as ReviewCycle;
}

export async function updateCycle(id: string, patch: Partial<Omit<CycleInput, "company_id">>): Promise<ReviewCycle> {
  const { data, error } = await db().from("review_cycles").update(patch).eq("id", id).select(CYCLE_COLUMNS).single();
  if (error) throw error;
  return data as ReviewCycle;
}

export async function deleteCycle(id: string): Promise<void> {
  const { error } = await db().from("review_cycles").delete().eq("id", id);
  if (error) throw error;
}

// Reviews and scores ------------------------------------------------------------------------

export async function listCycleReviews(cycleId: string): Promise<Review[]> {
  const { data, error } = await db().from("reviews").select(REVIEW_COLUMNS).eq("cycle_id", cycleId);
  if (error) throw error;
  return (data as Review[]) ?? [];
}

export async function listEmployeeReviews(employeeId: string): Promise<Review[]> {
  const { data, error } = await db()
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("employee_id", employeeId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Review[]) ?? [];
}

export async function listCompanyReviews(companyId: string): Promise<Review[]> {
  const { data, error } = await db().from("reviews").select(REVIEW_COLUMNS).eq("company_id", companyId);
  if (error) throw error;
  return (data as Review[]) ?? [];
}

export async function getReview(id: string): Promise<Review> {
  const { data, error } = await db().from("reviews").select(REVIEW_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as Review;
}

// One review per employee per cycle: return the existing row or create it.
export async function ensureReview(cycleId: string, companyId: string, employeeId: string): Promise<Review> {
  const { data: existing, error: findError } = await db()
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("cycle_id", cycleId)
    .eq("employee_id", employeeId)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing as Review;
  const { data, error } = await db()
    .from("reviews")
    .insert({ cycle_id: cycleId, company_id: companyId, employee_id: employeeId })
    .select(REVIEW_COLUMNS)
    .single();
  if (error) throw error;
  return data as Review;
}

export type ReviewPatch = Partial<
  Pick<
    Review,
    | "status"
    | "previous_status"
    | "manager_feedback"
    | "peer_feedback"
    | "client_feedback"
    | "employee_reflection"
    | "reviewer_id"
    | "completed_at"
  >
>;

export async function updateReview(id: string, patch: ReviewPatch): Promise<Review> {
  const { data, error } = await db().from("reviews").update(patch).eq("id", id).select(REVIEW_COLUMNS).single();
  if (error) throw error;
  return data as Review;
}

export async function listReviewScores(reviewId: string): Promise<ReviewScore[]> {
  const { data, error } = await db()
    .from("review_scores")
    .select(SCORE_COLUMNS)
    .eq("review_id", reviewId)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data as ReviewScore[]) ?? [];
}

export async function listScoresForReviews(reviewIds: string[]): Promise<ReviewScore[]> {
  if (reviewIds.length === 0) return [];
  const { data, error } = await db().from("review_scores").select(SCORE_COLUMNS).in("review_id", reviewIds);
  if (error) throw error;
  return (data as ReviewScore[]) ?? [];
}

export type ScoreInput = {
  review_id: string;
  company_id: string;
  pillar_id: string;
  criterion_id?: string | null;
  label?: string | null;
  rating?: number | null;
  target?: number | null;
  actual?: number | null;
  notes?: string | null;
  sort_order?: number;
};

export async function createScore(input: ScoreInput): Promise<ReviewScore> {
  const { data, error } = await db().from("review_scores").insert(input).select(SCORE_COLUMNS).single();
  if (error) throw error;
  return data as ReviewScore;
}

export async function updateScore(
  id: string,
  patch: Partial<Pick<ReviewScore, "label" | "rating" | "target" | "actual" | "notes" | "sort_order">>,
): Promise<ReviewScore> {
  const { data, error } = await db().from("review_scores").update(patch).eq("id", id).select(SCORE_COLUMNS).single();
  if (error) throw error;
  return data as ReviewScore;
}

export async function deleteScore(id: string): Promise<void> {
  const { error } = await db().from("review_scores").delete().eq("id", id);
  if (error) throw error;
}

// Goals --------------------------------------------------------------------------------------

export async function listGoals(companyId: string, employeeId?: string): Promise<Goal[]> {
  let query = db().from("goals").select(GOAL_COLUMNS).eq("company_id", companyId);
  if (employeeId) query = query.eq("employee_id", employeeId);
  const { data, error } = await query.order("sort_order").order("created_at");
  if (error) throw error;
  return ((data as Goal[]) ?? []).map(normalizeGoal);
}

// action_steps is jsonb; guard against hand-edited rows so the UI never sees a non-array.
function normalizeGoal(goal: Goal): Goal {
  const steps = Array.isArray(goal.action_steps) ? goal.action_steps : [];
  return {
    ...goal,
    progress: Math.min(100, Math.max(0, Number(goal.progress ?? 0))),
    scope: goal.scope === "year" ? "year" : "cycle",
    year: goal.year ?? null,
    carried_from_goal_id: goal.carried_from_goal_id ?? null,
    outcome_note: goal.outcome_note ?? null,
    action_steps: steps
      .filter((s): s is ActionStep => typeof s === "object" && s !== null && "text" in s)
      .map((s) => ({ text: String(s.text ?? ""), done: Boolean(s.done) })),
  };
}

export type GoalInput = {
  company_id: string;
  employee_id: string;
  title: string;
  kind: GoalKind;
  cycle_id?: string | null;
  description?: string | null;
  status?: GoalStatus;
  action_steps?: ActionStep[];
  progress_notes?: string | null;
  progress?: number;
  scope?: GoalScope;
  year?: number | null;
  carried_from_goal_id?: string | null;
  outcome_note?: string | null;
  sort_order?: number;
};

export async function createGoal(input: GoalInput): Promise<Goal> {
  const { data, error } = await db().from("goals").insert(input).select(GOAL_COLUMNS).single();
  if (error) throw error;
  return normalizeGoal(data as Goal);
}

export async function updateGoal(id: string, patch: Partial<Omit<GoalInput, "company_id" | "employee_id">>): Promise<Goal> {
  const { data, error } = await db().from("goals").update(patch).eq("id", id).select(GOAL_COLUMNS).single();
  if (error) throw error;
  return normalizeGoal(data as Goal);
}

export async function deleteGoal(id: string): Promise<void> {
  const { error } = await db().from("goals").delete().eq("id", id);
  if (error) throw error;
}

// Company goals ------------------------------------------------------------------------------

export async function listCompanyGoals(companyId: string, year: number): Promise<CompanyGoal[]> {
  const { data, error } = await db()
    .from("company_goals")
    .select(COMPANY_GOAL_COLUMNS)
    .eq("company_id", companyId)
    .eq("year", year)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data as CompanyGoal[]) ?? [];
}

export type CompanyGoalInput = Pick<CompanyGoal, "company_id" | "year" | "name"> &
  Partial<Pick<CompanyGoal, "target_display" | "current_display" | "target_numeric" | "current_numeric" | "is_hit" | "sort_order">>;

export async function createCompanyGoal(input: CompanyGoalInput): Promise<CompanyGoal> {
  const { data, error } = await db().from("company_goals").insert(input).select(COMPANY_GOAL_COLUMNS).single();
  if (error) throw error;
  return data as CompanyGoal;
}

export async function updateCompanyGoal(
  id: string,
  patch: Partial<Omit<CompanyGoalInput, "company_id">>,
): Promise<CompanyGoal> {
  const { data, error } = await db()
    .from("company_goals")
    .update(patch)
    .eq("id", id)
    .select(COMPANY_GOAL_COLUMNS)
    .single();
  if (error) throw error;
  return data as CompanyGoal;
}

export async function deleteCompanyGoal(id: string): Promise<void> {
  const { error } = await db().from("company_goals").delete().eq("id", id);
  if (error) throw error;
}
