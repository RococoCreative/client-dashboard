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
} from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const pillars = fromAll((b) => b.pillars).map((x) => ({ ...x }));
const criteria = fromAll((b) => b.criteria).map((x) => ({ ...x }));
const cycles = fromAll((b) => b.cycles).map((x) => ({ ...x }));
const reviews = fromAll((b) => b.reviews).map((x) => ({ ...x }));
const scores = fromAll((b) => b.scores).map((x) => ({ ...x }));
const goals = fromAll((b) => b.goals).map((x) => ({ ...x, action_steps: x.action_steps.map((s) => ({ ...s })) }));
const companyGoals = fromAll((b) => b.companyGoals).map((x) => ({ ...x }));

let counter = 0;
const nextId = (prefix: string) => `${prefix}-new-${++counter}`;
const now = () => new Date().toISOString();

function patchIn<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T {
  const index = list.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("Not found.");
  list[index] = { ...list[index], ...patch };
  return list[index];
}

function removeFrom<T extends { id: string }>(list: T[], id: string): void {
  const index = list.findIndex((x) => x.id === id);
  if (index !== -1) list.splice(index, 1);
}

export async function listPillars(companyId: string, includeInactive = false): Promise<GsrPillar[]> {
  return pillars.filter((p) => p.company_id === companyId && (includeInactive || p.is_active)).sort((a, b) => a.sort_order - b.sort_order);
}
export type PillarInput = Pick<GsrPillar, "company_id" | "name" | "weight" | "scoring_type"> & Partial<Pick<GsrPillar, "description" | "rating_scale_max" | "sort_order" | "is_active">>;
export async function createPillar(input: PillarInput): Promise<GsrPillar> {
  const created: GsrPillar = { id: nextId("pillar"), description: null, rating_scale_max: 5, sort_order: 0, is_active: true, created_at: now(), updated_at: now(), ...input };
  pillars.push(created);
  return created;
}
export async function updatePillar(id: string, patch: Partial<PillarInput>): Promise<GsrPillar> {
  return patchIn(pillars, id, { ...patch, updated_at: now() } as Partial<GsrPillar>);
}
export async function deletePillar(id: string): Promise<void> {
  removeFrom(pillars, id);
}

export async function listCriteria(companyId: string, includeInactive = false): Promise<GsrCriterion[]> {
  return criteria.filter((c) => c.company_id === companyId && (includeInactive || c.is_active)).sort((a, b) => a.sort_order - b.sort_order);
}
export async function createCriterion(input: { pillar_id: string; company_id: string; name: string; description?: string | null; sort_order?: number }): Promise<GsrCriterion> {
  const created: GsrCriterion = { id: nextId("criterion"), description: null, sort_order: 0, is_active: true, created_at: now(), updated_at: now(), ...input };
  criteria.push(created);
  return created;
}
export async function updateCriterion(id: string, patch: Partial<Pick<GsrCriterion, "name" | "description" | "sort_order" | "is_active">>): Promise<GsrCriterion> {
  return patchIn(criteria, id, { ...patch, updated_at: now() });
}
export async function deleteCriterion(id: string): Promise<void> {
  removeFrom(criteria, id);
}

export async function listCycles(companyId: string): Promise<ReviewCycle[]> {
  return cycles.filter((c) => c.company_id === companyId).sort((a, b) => (a.period_start < b.period_start ? 1 : -1));
}
export async function getCycle(id: string): Promise<ReviewCycle> {
  const found = cycles.find((c) => c.id === id);
  if (!found) throw new Error("Cycle not found.");
  return found;
}
export type CycleInput = Pick<ReviewCycle, "company_id" | "name" | "cadence" | "period_start" | "period_end"> & Partial<Pick<ReviewCycle, "theme" | "theme_description" | "status">>;
export async function createCycle(input: CycleInput): Promise<ReviewCycle> {
  const created: ReviewCycle = { id: nextId("cycle"), theme: null, theme_description: null, status: "open", created_by: null, created_at: now(), updated_at: now(), ...input };
  cycles.push(created);
  return created;
}
export async function updateCycle(id: string, patch: Partial<Omit<CycleInput, "company_id">>): Promise<ReviewCycle> {
  return patchIn(cycles, id, { ...patch, updated_at: now() } as Partial<ReviewCycle>);
}
export async function deleteCycle(id: string): Promise<void> {
  removeFrom(cycles, id);
}

export async function listCycleReviews(cycleId: string): Promise<Review[]> {
  return reviews.filter((r) => r.cycle_id === cycleId);
}
export async function listEmployeeReviews(employeeId: string): Promise<Review[]> {
  return reviews.filter((r) => r.employee_id === employeeId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
export async function listCompanyReviews(companyId: string): Promise<Review[]> {
  return reviews.filter((r) => r.company_id === companyId);
}
export async function getReview(id: string): Promise<Review> {
  const found = reviews.find((r) => r.id === id);
  if (!found) throw new Error("Review not found.");
  return found;
}
export async function ensureReview(cycleId: string, companyId: string, employeeId: string): Promise<Review> {
  const existing = reviews.find((r) => r.cycle_id === cycleId && r.employee_id === employeeId);
  if (existing) return existing;
  const created: Review = { id: nextId("review"), cycle_id: cycleId, company_id: companyId, employee_id: employeeId, status: "not_started", previous_status: null, manager_feedback: null, peer_feedback: null, client_feedback: null, employee_reflection: null, reviewer_id: null, completed_at: null, created_at: now(), updated_at: now() };
  reviews.push(created);
  return created;
}
export type ReviewPatch = Partial<Pick<Review, "status" | "previous_status" | "manager_feedback" | "peer_feedback" | "client_feedback" | "employee_reflection" | "reviewer_id" | "completed_at">>;
export async function updateReview(id: string, patch: ReviewPatch): Promise<Review> {
  return patchIn(reviews, id, { ...patch, updated_at: now() });
}

export async function listReviewScores(reviewId: string): Promise<ReviewScore[]> {
  return scores.filter((s) => s.review_id === reviewId);
}
export async function listScoresForReviews(reviewIds: string[]): Promise<ReviewScore[]> {
  return scores.filter((s) => reviewIds.includes(s.review_id));
}
export type ScoreInput = { review_id: string; company_id: string; pillar_id: string; criterion_id?: string | null; label?: string | null; rating?: number | null; target?: number | null; actual?: number | null; notes?: string | null; sort_order?: number };
export async function createScore(input: ScoreInput): Promise<ReviewScore> {
  const created: ReviewScore = { id: nextId("score"), criterion_id: null, label: null, rating: null, target: null, actual: null, notes: null, sort_order: 0, created_at: now(), updated_at: now(), ...input };
  scores.push(created);
  return created;
}
export async function updateScore(id: string, patch: Partial<Pick<ReviewScore, "label" | "rating" | "target" | "actual" | "notes" | "sort_order">>): Promise<ReviewScore> {
  return patchIn(scores, id, { ...patch, updated_at: now() });
}
export async function deleteScore(id: string): Promise<void> {
  removeFrom(scores, id);
}

export async function listGoals(companyId: string, employeeId?: string): Promise<Goal[]> {
  return goals.filter((g) => g.company_id === companyId && (!employeeId || g.employee_id === employeeId));
}
export type GoalInput = { company_id: string; employee_id: string; title: string; kind: GoalKind; cycle_id?: string | null; description?: string | null; status?: GoalStatus; action_steps?: ActionStep[]; progress_notes?: string | null; progress?: number; scope?: GoalScope; year?: number | null; carried_from_goal_id?: string | null; outcome_note?: string | null; sort_order?: number };
export async function createGoal(input: GoalInput): Promise<Goal> {
  const created: Goal = { id: nextId("goal"), cycle_id: null, description: null, status: "not_started", action_steps: [], progress_notes: null, progress: 0, scope: "cycle", year: null, carried_from_goal_id: null, outcome_note: null, sort_order: 0, created_by: null, created_at: now(), updated_at: now(), ...input };
  goals.push(created);
  return created;
}
export async function updateGoal(id: string, patch: Partial<Omit<GoalInput, "company_id" | "employee_id">>): Promise<Goal> {
  return patchIn(goals, id, { ...patch, updated_at: now() } as Partial<Goal>);
}
export async function deleteGoal(id: string): Promise<void> {
  removeFrom(goals, id);
}

export async function listCompanyGoals(companyId: string, year: number): Promise<CompanyGoal[]> {
  return companyGoals.filter((g) => g.company_id === companyId && g.year === year);
}
export type CompanyGoalInput = Pick<CompanyGoal, "company_id" | "year" | "name"> & Partial<Pick<CompanyGoal, "target_display" | "current_display" | "target_numeric" | "current_numeric" | "is_hit" | "sort_order">>;
export async function createCompanyGoal(input: CompanyGoalInput): Promise<CompanyGoal> {
  const created: CompanyGoal = { id: nextId("company-goal"), target_display: null, current_display: null, target_numeric: null, current_numeric: null, is_hit: false, sort_order: 0, created_at: now(), updated_at: now(), ...input };
  companyGoals.push(created);
  return created;
}
export async function updateCompanyGoal(id: string, patch: Partial<Omit<CompanyGoalInput, "company_id">>): Promise<CompanyGoal> {
  return patchIn(companyGoals, id, { ...patch, updated_at: now() } as Partial<CompanyGoal>);
}
export async function deleteCompanyGoal(id: string): Promise<void> {
  removeFrom(companyGoals, id);
}
