// In-memory stand-in for services/gsr.ts, same exports, so page tests and `npm run demo`
// run against seeded cycles, reviews, pillars, criteria, scores and goals and never touch the network.
import type {
  ActionStep,
  Cadence,
  CompanyGoal,
  CycleOmission,
  Goal,
  GoalKind,
  GoalNote,
  GoalPrivate,
  GoalScope,
  GoalStatus,
  GsrCadence,
  GsrCriterion,
  GsrPillar,
  ImpactScore,
  Review,
  ReviewCycle,
  ReviewScore,
} from "../../types/database.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { fromAll, personaFromLocation } from "../fixtures.ts";
import { hasFullScope } from "../../lib/people.ts";
import { defaultCycleName, gsrPeriodCopy, gsrPeriodFor, isCanonicalPeriod, isGsrCadence } from "../../lib/gsr/cycles.ts";
import { actorIn, rhythmOfProfile } from "./profiles.ts";

const pillars = fromAll((b) => b.pillars).map((x) => ({ ...x }));
const criteria = fromAll((b) => b.criteria).map((x) => ({ ...x }));
const cycles = fromAll((b) => b.cycles).map((x) => ({ ...x }));
const reviews = fromAll((b) => b.reviews).map((x) => ({ ...x }));
const scores = fromAll((b) => b.scores).map((x) => ({ ...x }));
const impactScores = fromAll((b) => b.impactScores).map((x) => ({ ...x }));
const goals = fromAll((b) => b.goals).map((x) => ({ ...x, action_steps: x.action_steps.map((s) => ({ ...s })) }));
const goalNotes = fromAll((b) => b.goalNotes).map((x) => ({ ...x }));
const goalPrivate = fromAll((b) => b.goalPrivate).map((x) => ({ ...x, action_steps: x.action_steps.map((s) => ({ ...s })) }));
const companyGoals = fromAll((b) => b.companyGoals).map((x) => ({ ...x }));
const cycleOmissions = fromAll((b) => b.cycleOmissions).map((x) => ({ ...x }));

let counter = 0;
const nextId = (prefix: string) => `${prefix}-new-${++counter}`;
const now = () => new Date().toISOString();

function patchIn<T extends { id: string }>(list: T[], id: string, patch: Partial<T>): T {
  const index = list.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("Not found.");
  list[index] = { ...list[index], ...patch };
  return list[index];
}

// A delete that matched nothing is a refusal, the way the service reads an empty .select("id").
function removeFrom<T extends { id: string }>(list: T[], id: string): void {
  const index = list.findIndex((x) => x.id === id);
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  list.splice(index, 1);
}

// The refusal 0039 makes on a review in a closed cycle (guard_review_cycle), word for word: no new
// review starts in one, and a signed-off review stays signed off while it is closed.
export const CLOSED_CYCLE_MESSAGE = "This review cycle is closed. Reopen the cycle first.";

// The refusal 0046 makes on a GSR opened in a period that is not the person's rhythm
// (guard_review_rhythm), word for word.
export function rhythmMessage(personRhythm: GsrCadence, cycleCadence: Cadence): string {
  return `This person's GSRs run ${gsrPeriodCopy(personRhythm).every}, so this ${gsrPeriodCopy(cycleCadence).adjective} GSR is not theirs. Change their GSR rhythm first.`;
}

// guard_review_cycle_period (0046): a GSR runs at a GSR rhythm on a canonical period of it, and a
// review at a review rhythm. Returns the refusal word for word, or null when the cycle is fine.
export function cyclePeriodProblem(cycle: Pick<ReviewCycle, "kind" | "cadence" | "period_start" | "period_end">): string | null {
  if (cycle.kind === "gsr" && !isGsrCadence(cycle.cadence)) return "A GSR runs weekly, every two weeks, monthly or quarterly.";
  if (cycle.kind === "review" && !["quarterly", "annual", "custom"].includes(cycle.cadence)) return "A scored review runs quarterly, yearly or on dates you choose.";
  if (cycle.kind === "gsr" && !isCanonicalPeriod(cycle.cadence, cycle.period_start, cycle.period_end)) {
    switch (cycle.cadence) {
      case "weekly": return "A weekly GSR runs from a Monday to the Sunday after it.";
      case "biweekly": return "A GSR every two weeks runs from a Monday to the second Sunday after it, on the shared two-week calendar that started Monday, January 1, 2024.";
      case "monthly": return "A monthly GSR runs from the first to the last day of one month.";
      default: return "A quarterly GSR runs for one calendar quarter, from its first day to its last.";
    }
  }
  return null;
}

// What a manager may change on a GSR of someone they lead (0046): lock it in and reopen it.
const LOCK_FIELDS: ReadonlyArray<keyof ReviewPatch> = ["status", "completed_at", "gsr_score", "reviewer_id"];
// What a person may change on their own review (0035).
const OWN_FIELDS: ReadonlyArray<keyof ReviewPatch> = ["employee_reflection", "support_discussion"];

// The task link rule of 0039 and 0046, for the tasks mock: a task may be linked only to a goal in a
// GSR cycle (kind 'gsr', any rhythm) of its own assignee in its own company, and only while that month is open, not complete and the
// person is not omitted. Returns the refusal, or null when the link is fine. Unlinking never
// reaches here.
export function goalLinkProblem(task: { company_id: string; assignee_id: string | null; goal_id: string | null }): string | null {
  if (task.goal_id === null) return null;
  const goal = goals.find((g) => g.id === task.goal_id);
  if (!goal || goal.company_id !== task.company_id) return "That goal is not here any more.";
  const cycle = cycles.find((c) => c.id === goal.cycle_id);
  if (goal.scope !== "cycle" || goal.cycle_id === null || cycle?.kind !== "gsr") return "Only a monthly GSR goal can have tasks.";
  if (goal.employee_id !== task.assignee_id) return "A task on a goal belongs to that goal's person. Unlink it before assigning it to someone else.";
  const review = reviews.find((r) => r.cycle_id === goal.cycle_id && r.employee_id === goal.employee_id);
  const omitted = cycleOmissions.some((o) => o.cycle_id === goal.cycle_id && o.employee_id === goal.employee_id);
  if (!cycle || cycle.status !== "open" || review?.status === "complete" || omitted) return "That month is closed, so its goals take no new tasks.";
  return null;
}

export async function listPillars(companyId: string, includeInactive = false): Promise<GsrPillar[]> {
  return pillars.filter((p) => p.company_id === companyId && (includeInactive || p.is_active)).sort((a, b) => a.sort_order - b.sort_order);
}
export type PillarInput = Pick<GsrPillar, "company_id" | "name" | "weight" | "scoring_type"> & Partial<Pick<GsrPillar, "description" | "rating_scale_max" | "required_goals" | "sort_order" | "is_active">>;
export async function createPillar(input: PillarInput): Promise<GsrPillar> {
  const created: GsrPillar = { id: nextId("pillar"), description: null, rating_scale_max: 5, required_goals: 2, sort_order: 0, is_active: true, created_at: now(), updated_at: now(), ...input };
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
export type CycleInput = Pick<ReviewCycle, "company_id" | "name" | "kind" | "cadence" | "period_start" | "period_end"> & Partial<Pick<ReviewCycle, "theme" | "theme_description" | "status">>;
// Plays 0046 as well: the period rules for every writer, and a member who is not an admin opens
// only an open GSR period of their own company with no theme, named by the database and filed
// under them ("Members open a GSR period", guard_review_cycle_period).
export async function createCycle(input: CycleInput): Promise<ReviewCycle> {
  const problem = cyclePeriodProblem(input);
  if (problem) throw new Error(problem);
  const actor = actorIn(input.company_id);
  const member = actor !== null && !actor.admin;
  if (member && (input.kind !== "gsr" || (input.status ?? "open") !== "open" || input.theme || input.theme_description)) {
    throw new Error('new row violates row-level security policy for table "review_cycles"');
  }
  const created: ReviewCycle = {
    id: nextId("cycle"), theme: null, theme_description: null, status: "open", created_by: null, created_at: now(), updated_at: now(), ...input,
    ...(member ? { name: defaultCycleName(input.cadence, input.period_start, input.period_end), created_by: actor.id } : {}),
  };
  cycles.push(created);
  return created;
}
// The canonical period of the rhythm covering today, opened once: a second call finds the first
// (0046, the insert that ignores a duplicate).
export async function ensureGsrCycle(companyId: string, cadence: GsrCadence, today = new Date()): Promise<ReviewCycle> {
  const period = gsrPeriodFor(cadence, today);
  const existing = cycles.find(
    (c) => c.company_id === companyId && c.kind === "gsr" && c.cadence === cadence && c.period_start === period.period_start && c.period_end === period.period_end,
  );
  if (existing) return existing;
  return createCycle({ company_id: companyId, kind: "gsr", cadence, ...period });
}
export async function updateCycle(id: string, patch: Partial<Omit<CycleInput, "company_id">>): Promise<ReviewCycle> {
  // Only a full-scope admin changes a cycle (0038, "Full-scope admins change cycles"); anyone else's
  // update matches no row, and the service's .single() reports it as not changed.
  if (!hasFullScope(personaFromLocation().profile)) throw new Error(NOT_CHANGED_MESSAGE);
  const before = cycles.find((c) => c.id === id);
  if (before) {
    // A cycle's kind is set when it is made, and its period is judged when it moves (0046).
    if (patch.kind !== undefined && patch.kind !== before.kind) throw new Error("A cycle's kind is set when it is made. Start a new cycle instead.");
    const moved = { ...before, ...patch };
    if (moved.cadence !== before.cadence || moved.period_start !== before.period_start || moved.period_end !== before.period_end) {
      const problem = cyclePeriodProblem(moved);
      if (problem) throw new Error(problem);
    }
  }
  return patchIn(cycles, id, { ...patch, updated_at: now() } as Partial<ReviewCycle>);
}
export async function deleteCycle(id: string): Promise<void> {
  removeFrom(cycles, id);
}

export async function listCycleReviews(cycleId: string): Promise<Review[]> {
  return reviews.filter((r) => r.cycle_id === cycleId);
}
export async function listEmployeeReviews(companyId: string, employeeId: string): Promise<Review[]> {
  return reviews.filter((r) => r.company_id === companyId && r.employee_id === employeeId).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
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
  if (cycles.find((c) => c.id === cycleId)?.status === "closed") throw new Error(CLOSED_CYCLE_MESSAGE);
  if (omitted(cycleId, employeeId)) throw new Error("This person is not part of this cycle. Add them back on the cycle page first.");
  // A GSR is opened only in a period of the person's own rhythm (0046).
  const cycle = cycles.find((c) => c.id === cycleId);
  if (cycle?.kind === "gsr" && cycle.cadence !== rhythmOfProfile(employeeId)) throw new Error(rhythmMessage(rhythmOfProfile(employeeId), cycle.cadence));
  const created: Review = { id: nextId("review"), cycle_id: cycleId, company_id: companyId, employee_id: employeeId, status: "not_started", previous_status: null, manager_feedback: null, peer_feedback: null, client_feedback: null, employee_reflection: null, reviewer_id: null, completed_at: null, pillar_snapshot: null, gsr_score: null, support_discussion: null, created_at: now(), updated_at: now() };
  reviews.push(created);
  return created;
}
export type ReviewPatch = Partial<Pick<Review, "status" | "previous_status" | "manager_feedback" | "peer_feedback" | "client_feedback" | "employee_reflection" | "reviewer_id" | "completed_at" | "gsr_score" | "support_discussion">>;
export async function updateReview(id: string, patch: ReviewPatch): Promise<Review> {
  const before = reviews.find((r) => r.id === id);
  // guard_review_employee_fields (0046): someone who is not an admin of the company changes, on a
  // GSR of a person they lead, only what locks and reopens it; on their own review, only their
  // reflection and the opening discussion. Any other review (a scored one of someone they lead,
  // or anyone else's) no update policy reaches, so the row is not changed, as the service reports
  // a write RLS filtered out.
  const actor = before ? actorIn(before.company_id) : null;
  if (before && actor && !actor.admin) {
    const changed = (Object.keys(patch) as Array<keyof ReviewPatch>).filter((key) => patch[key] !== undefined && patch[key] !== before[key]);
    const gsrReview = cycles.find((c) => c.id === before.cycle_id)?.kind === "gsr";
    if (actor.leads(before.employee_id) && gsrReview) {
      if (changed.some((key) => !LOCK_FIELDS.includes(key))) throw new Error("A manager can lock and reopen a GSR, and nothing else on it.");
    } else if (before.employee_id !== actor.id) {
      throw new Error(NOT_CHANGED_MESSAGE);
    } else if (changed.some((key) => !OWN_FIELDS.includes(key))) {
      throw new Error("Only admins can edit review scores, status, and feedback.");
    }
  }
  // A signed-off review stays signed off while its cycle is closed (0039).
  if (before?.status === "complete" && patch.status !== undefined && patch.status !== "complete" && cycles.find((c) => c.id === before.cycle_id)?.status === "closed") {
    throw new Error(CLOSED_CYCLE_MESSAGE);
  }
  // Nobody signs off a review for someone left out of its cycle (0034).
  if (before && before.status !== "complete" && patch.status === "complete" && omitted(before.cycle_id, before.employee_id)) {
    throw new Error("This person is not part of this cycle. Add them back on the cycle page first.");
  }
  // A signed-off review keeps its opening discussion until it is reopened (0029 and 0035).
  if (before?.status === "complete" && (patch.status === undefined || patch.status === "complete") && patch.support_discussion !== undefined && patch.support_discussion !== before.support_discussion) {
    throw new Error("This review is signed off. Reopen it to change it.");
  }
  const next = patchIn(reviews, id, { ...patch, updated_at: now() });
  // The database keeps the pillars a review was signed off with, and lets them go on reopen
  // (0022); the mock does the same.
  if (before && before.status !== "complete" && next.status === "complete") {
    next.pillar_snapshot = pillars
      .filter((p) => p.company_id === next.company_id && p.is_active)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ id: pillarId, name, weight, scoring_type, rating_scale_max, required_goals }) => ({ id: pillarId, name, weight, scoring_type, rating_scale_max, required_goals }));
  } else if (next.status !== "complete") {
    next.pillar_snapshot = null;
  }
  // Only a completed review carries a locked month score; reopening lets it go (0023).
  if (next.status !== "complete") next.gsr_score = null;
  // The database freezes the person's current impact ratings into the review's rows on the
  // transition to complete (0017); the mock does the same so the page tests see it.
  if (before && before.status !== "complete" && next.status === "complete") {
    for (const impact of impactScores.filter((x) => x.employee_id === next.employee_id && x.company_id === next.company_id)) {
      const criterion = criteria.find((c) => c.id === impact.criterion_id);
      const pillar = pillars.find((p) => p.id === impact.pillar_id);
      if (!criterion?.is_active || !pillar?.is_active || pillar.scoring_type !== "rating") continue;
      const row = scores.find((x) => x.review_id === id && x.criterion_id === impact.criterion_id);
      if (row) patchIn(scores, row.id, { rating: impact.rating, updated_at: now() });
      else scores.push({ id: nextId("score"), review_id: id, company_id: next.company_id, pillar_id: impact.pillar_id, criterion_id: impact.criterion_id, label: null, rating: impact.rating, target: null, actual: null, notes: null, sort_order: 0, created_at: now(), updated_at: now() });
    }
  }
  return next;
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
export type GoalInput = { company_id: string; employee_id: string; title: string; kind: GoalKind; is_focus?: boolean; cycle_id?: string | null; description?: string | null; status?: GoalStatus; action_steps?: ActionStep[]; progress?: number; scope?: GoalScope; year?: number | null; carried_from_goal_id?: string | null; outcome_note?: string | null; sort_order?: number };
export async function createGoal(input: GoalInput): Promise<Goal> {
  const created: Goal = { id: nextId("goal"), is_focus: false, cycle_id: null, description: null, status: "not_started", action_steps: [], progress: 0, scope: "cycle", year: null, carried_from_goal_id: null, outcome_note: null, sort_order: 0, created_by: null, created_at: now(), updated_at: now(), ...input };
  goals.push(created);
  return created;
}
export async function updateGoal(id: string, patch: Partial<Omit<GoalInput, "company_id" | "employee_id">>): Promise<Goal> {
  return patchIn(goals, id, { ...patch, updated_at: now() } as Partial<Goal>);
}
export async function deleteGoal(id: string): Promise<void> {
  removeFrom(goals, id);
}

export async function listGoalNotes(companyId: string, employeeId: string): Promise<GoalNote[]> {
  return goalNotes
    .filter((n) => n.company_id === companyId && n.employee_id === employeeId)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}
export type GoalNoteInput = { goal_id: string; company_id: string; employee_id: string; author_id: string; body: string };
// Stamped the way the database stamps it: the goal decides the company and the person, the clock
// decides the date.
export async function createGoalNote(input: GoalNoteInput): Promise<GoalNote> {
  const goal = goals.find((g) => g.id === input.goal_id);
  if (!goal) throw new Error("That goal does not exist.");
  const stamp = now();
  const created: GoalNote = { id: nextId("goal-note"), ...input, company_id: goal.company_id, employee_id: goal.employee_id, created_at: stamp, updated_at: stamp };
  goalNotes.push(created);
  return created;
}
// The suite's clock stands still, so an edit is stamped a second on to read as later than the
// note it changes, the way it always is in the database.
export async function updateGoalNote(id: string, body: string): Promise<GoalNote> {
  return patchIn(goalNotes, id, { body, updated_at: new Date(Date.now() + 1000).toISOString() });
}
export async function deleteGoalNote(id: string): Promise<void> {
  removeFrom(goalNotes, id);
}

function omitted(cycleId: string, employeeId: string): boolean {
  return cycleOmissions.some((o) => o.cycle_id === cycleId && o.employee_id === employeeId);
}
export async function listCycleOmissions(companyId: string): Promise<CycleOmission[]> {
  return cycleOmissions.filter((o) => o.company_id === companyId);
}
export type OmissionInput = { cycle_id: string; employee_id: string; company_id: string; reason: string | null };
// Stamped and refused the way the database does it (0034): the cycle decides the company, a
// closed cycle keeps its roster, and a signed-off review has to be reopened first.
export async function omitFromCycle(input: OmissionInput): Promise<CycleOmission> {
  const cycle = cycles.find((c) => c.id === input.cycle_id);
  if (!cycle) throw new Error("That review cycle does not exist.");
  if (cycle.status === "closed") throw new Error("This review cycle is closed. Reopen it to change who is in it.");
  if (reviews.some((r) => r.cycle_id === input.cycle_id && r.employee_id === input.employee_id && r.status === "complete")) {
    throw new Error("Their review in this cycle is signed off. Reopen it before leaving them out.");
  }
  if (omitted(input.cycle_id, input.employee_id)) throw new Error("They are already left out of this cycle.");
  const created: CycleOmission = { cycle_id: input.cycle_id, employee_id: input.employee_id, company_id: cycle.company_id, reason: input.reason?.trim() || null, omitted_by: null, created_at: now() };
  cycleOmissions.push(created);
  return created;
}
export async function addBackToCycle(cycleId: string, employeeId: string): Promise<void> {
  const cycle = cycles.find((c) => c.id === cycleId);
  if (cycle?.status === "closed") throw new Error("This review cycle is closed. Reopen it to change who is in it.");
  const index = cycleOmissions.findIndex((o) => o.cycle_id === cycleId && o.employee_id === employeeId);
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  cycleOmissions.splice(index, 1);
}

export async function listGoalPrivate(companyId: string, employeeId: string): Promise<GoalPrivate[]> {
  return goalPrivate.filter((row) => row.company_id === companyId && row.employee_id === employeeId);
}
export async function saveGoalSteps(input: { goal_id: string; company_id: string; employee_id: string; action_steps: ActionStep[] }): Promise<GoalPrivate> {
  const existing = goalPrivate.find((row) => row.goal_id === input.goal_id);
  if (existing) {
    existing.action_steps = input.action_steps.map((step) => ({ ...step }));
    existing.updated_at = now();
    return existing;
  }
  const created: GoalPrivate = { ...input, action_steps: input.action_steps.map((step) => ({ ...step })), created_at: now(), updated_at: now() };
  goalPrivate.push(created);
  return created;
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

export async function listImpactScores(companyId: string, employeeId?: string): Promise<ImpactScore[]> {
  return impactScores.filter((i) => i.company_id === companyId && (!employeeId || i.employee_id === employeeId));
}
export type ImpactScoreInput = { employee_id: string; criterion_id: string; rating: number; note?: string | null; set_by?: string | null };
export async function upsertImpactScore(input: ImpactScoreInput): Promise<ImpactScore> {
  // The inherit trigger stamps company and pillar from the criterion and refuses a rating off
  // the pillar's scale; so does this, so a page behaves here the way it will in production.
  const criterion = criteria.find((c) => c.id === input.criterion_id);
  if (!criterion) throw new Error("That criterion does not exist.");
  const pillar = pillars.find((p) => p.id === criterion.pillar_id)!;
  if (input.rating < 1 || input.rating > pillar.rating_scale_max) throw new Error(`The rating must be between 1 and ${pillar.rating_scale_max}.`);
  const existing = impactScores.find((i) => i.employee_id === input.employee_id && i.criterion_id === input.criterion_id);
  if (existing) return patchIn(impactScores, existing.id, { rating: input.rating, note: input.note ?? existing.note, set_by: input.set_by ?? existing.set_by, updated_at: now() });
  const created: ImpactScore = {
    id: nextId("impact"),
    company_id: criterion.company_id,
    employee_id: input.employee_id,
    pillar_id: criterion.pillar_id,
    criterion_id: input.criterion_id,
    rating: input.rating,
    note: input.note ?? null,
    set_by: input.set_by ?? null,
    created_at: now(),
    updated_at: now(),
  };
  impactScores.push(created);
  return created;
}
