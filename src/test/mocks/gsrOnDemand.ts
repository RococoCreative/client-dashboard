// In-memory stand-in for services/gsrOnDemand.ts, same exports, so page tests and `npm run demo`
// run GSRs on demand against seeded rows and never touch the network. Standalone GSRs live in their
// own array here, never among the cycle reviews in mocks/gsr.ts, so period code reading reviews
// never meets one, as the service's filters make sure in the database. The refusals mirror 0047:
// the wall for a company on periods, one GSR a person a day, two open at most when one is started,
// and nobody marking their own done or reopening it. "Today" is the company's.
//
// Who may act mirrors the reviews policies. The acting person is personaIn in fixtures.ts: the hub's
// person a page test rendered (renderWithHub records it) or one set with setActingPerson in
// src/test/actingPerson.ts; else the demo persona of the address, resolved in the GSR's company;
// else that company's admin. A person reads and starts their own; someone who
// leads them (ledBy, the whole chain) reads, starts, marks done and reopens theirs; an admin or
// owner of the company does all that for anyone in it and alone deletes; a Rococo admin does
// everything. Every read and write hands out a copy, never the stored row, as the service does.
//
// resetMockGsrs, setMockGsrMode and seedMockGsr are test-only extras; src/test/setup.ts resets
// after every test, which also puts every company's format back to what its fixture says.
import { companyToday } from "../../lib/wins.ts";
import type { DateRange } from "../../lib/gsr/onDemand.ts";
import type { Gsr, GsrLastStarted, GsrMode } from "../../types/database.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { isCompanyAdminRole, ledBy } from "../../lib/people.ts";
import { fromAll, personaIn } from "../fixtures.ts";
import { gsrModeOf, resetCompanyGsrModes, setCompanyGsrMode, timeZoneOf } from "./companies.ts";
import { companyOf, peopleOf } from "./profiles.ts";

export const TWO_OPEN_MESSAGE = "This person already has two GSRs open. Mark the earlier one done first.";
export const OWN_GSR_MESSAGE = "Your own GSR is marked done and reopened by someone who leads you.";
const WALL_MESSAGE = "GSRs on demand are not turned on for this company.";
// What the client surfaces for an insert no policy admits.
const INSERT_REFUSED = 'new row violates row-level security policy for table "reviews"';

const copy = (gsr: Gsr): Gsr => ({ ...gsr });
const gsrs: Gsr[] = fromAll((b) => b.gsrs).map(copy);

let counter = 0;
const nextId = () => `gsr-new-${++counter}`;
const now = () => new Date().toISOString();
const today = (companyId: string) => companyToday(timeZoneOf(companyId));

// Newest start first; the later-created row wins a tie, as the service orders them.
const newestFirst = (a: Gsr, b: Gsr) => b.started_on.localeCompare(a.started_on) || b.created_at.localeCompare(a.created_at);

// What the signed-in person may do with one person's GSRs in one company.
function reach(companyId: string, employeeId: string): { own: boolean; leads: boolean; admin: boolean } {
  const me = personaIn(companyId);
  if (me.is_rococo_admin) return { own: false, leads: true, admin: true };
  if (me.company_id !== companyId) return { own: false, leads: false, admin: false };
  const admin = isCompanyAdminRole(me.role);
  const leads = employeeId !== me.id && ledBy(me, peopleOf(companyId)).some((p) => p.id === employeeId);
  return { own: me.id === employeeId, leads: leads || (admin && employeeId !== me.id), admin };
}
const canRead = (gsr: Gsr) => {
  const r = reach(gsr.company_id, gsr.employee_id);
  return r.own || r.leads || r.admin;
};

// The stored row an update or delete reaches, or null when there is none (or none it may read).
function stored(id: string): { index: number; gsr: Gsr } | null {
  const index = gsrs.findIndex((g) => g.id === id);
  return index === -1 || !canRead(gsrs[index]) ? null : { index, gsr: gsrs[index] };
}

// Marking done and reopening: the database refuses the person themself with its own words
// (guard_review_employee_fields, 0047), and anyone else who neither leads them nor runs the company
// reaches no row, which the service's .single() reports as not changed.
function closable(id: string): { index: number; gsr: Gsr } {
  const found = stored(id);
  if (!found) throw new Error(NOT_CHANGED_MESSAGE);
  const r = reach(found.gsr.company_id, found.gsr.employee_id);
  if (r.own) throw new Error(OWN_GSR_MESSAGE);
  if (!r.leads && !r.admin) throw new Error(NOT_CHANGED_MESSAGE);
  return found;
}

function replace(index: number, patch: Partial<Gsr>): Gsr {
  gsrs[index] = { ...gsrs[index], ...patch, updated_at: now() };
  return copy(gsrs[index]);
}

function blank(companyId: string, employeeId: string, startedOn: string): Gsr {
  const stamp = now();
  return {
    id: nextId(),
    cycle_id: null,
    company_id: companyId,
    employee_id: employeeId,
    status: "not_started",
    previous_status: null,
    manager_feedback: null,
    peer_feedback: null,
    client_feedback: null,
    employee_reflection: null,
    reviewer_id: null,
    completed_at: null,
    pillar_snapshot: null,
    gsr_score: null,
    support_discussion: null,
    started_on: startedOn,
    done_on: null,
    created_at: stamp,
    updated_at: stamp,
  };
}

// The status of a standalone GSR, for the goals and tasks mocks to freeze a done one's goals;
// null when there is no such GSR (it was deleted, and its goals went with it).
export function mockGsrStatus(id: string): Gsr["status"] | null {
  return gsrs.find((g) => g.id === id)?.status ?? null;
}

export function resetMockGsrs(): void {
  gsrs.splice(0, gsrs.length, ...fromAll((b) => b.gsrs).map(copy));
  resetCompanyGsrModes();
}

export function setMockGsrMode(companyId: string, mode: GsrMode): void {
  setCompanyGsrMode(companyId, mode);
}

// A GSR put straight into the store, the way a test sets the scene: no wall, no limit, dates as
// given. Created at noon on its start day, so the order newest first is the order of start days.
export function seedMockGsr(row: Partial<Gsr> & Pick<Gsr, "company_id" | "employee_id" | "started_on">): Gsr {
  const created: Gsr = { ...blank(row.company_id, row.employee_id, row.started_on), created_at: `${row.started_on}T12:00:00.000Z`, ...row, cycle_id: null };
  gsrs.push(created);
  return copy(created);
}

// A row the reader may not see reads as missing, as getReview's does.
export async function getGsr(id: string): Promise<Gsr> {
  const found = gsrs.find((g) => g.id === id);
  if (!found || !canRead(found)) throw new Error("Review not found.");
  return copy(found);
}

export async function listPersonGsrs(companyId: string, employeeId: string): Promise<Gsr[]> {
  return gsrs.filter((g) => g.company_id === companyId && g.employee_id === employeeId && canRead(g)).sort(newestFirst).map(copy);
}

export async function listGsrsForLog(companyId: string, range: DateRange): Promise<Gsr[]> {
  return gsrs
    .filter((g) => g.company_id === companyId && canRead(g) && ((g.done_on !== null && g.done_on >= range.from && g.done_on <= range.to) || g.status !== "complete"))
    .sort(newestFirst)
    .map(copy);
}

export async function listLastGsrDates(companyId: string): Promise<Array<Pick<GsrLastStarted, "employee_id" | "last_started_on">>> {
  const last = new Map<string, string>();
  for (const g of gsrs.filter((x) => x.company_id === companyId && canRead(x))) {
    const seen = last.get(g.employee_id);
    if (!seen || g.started_on > seen) last.set(g.employee_id, g.started_on);
  }
  return [...last].map(([employee_id, last_started_on]) => ({ employee_id, last_started_on }));
}

// As the service: the insert ignores a duplicate on the person's day, the two-open refusal comes
// back as atLimit, and either way the person's newest is returned. The company is the person's.
// stamp_standalone_gsr answers only a caller a policy would admit (the person, those who lead or
// manage them, Rococo): they hear the wall in a company on periods. Anyone else is refused by row
// level security without learning anything about the company, so that check comes first here.
export async function startGsr(companyId: string, employeeId: string): Promise<{ gsr: Gsr; atLimit: boolean }> {
  const company = companyOf(employeeId) ?? companyId;
  const r = reach(company, employeeId);
  if (!r.own && !r.leads && !r.admin) throw new Error(INSERT_REFUSED);
  if (gsrModeOf(company) !== "on_demand") throw new Error(WALL_MESSAGE);
  const day = today(company);
  const theirs = gsrs.filter((g) => g.employee_id === employeeId);
  let atLimit = false;
  if (!theirs.some((g) => g.started_on === day)) {
    if (theirs.filter((g) => g.company_id === company && g.status !== "complete").length >= 2) atLimit = true;
    else gsrs.push(blank(company, employeeId, day));
  }
  const [newest] = await listPersonGsrs(companyId, employeeId);
  if (!newest) throw new Error("That GSR could not be opened. Reload the page and try again.");
  return { gsr: newest, atLimit };
}

export async function markGsrDone(id: string, score: number | null, reviewerId: string): Promise<Gsr> {
  const { index, gsr } = closable(id);
  const doneOn = gsr.status === "complete" ? gsr.done_on : today(gsr.company_id);
  return replace(index, { status: "complete", completed_at: now(), gsr_score: score, reviewer_id: reviewerId, done_on: doneOn });
}

// The database clears done_on and lets the score go on reopen (0023, 0047).
export async function reopenGsr(id: string): Promise<Gsr> {
  const { index } = closable(id);
  return replace(index, { status: "in_progress", completed_at: null, gsr_score: null, done_on: null });
}

// An admin's or a Rococo admin's alone (0038). Its goals go with it: the goals mock drops a goal
// whose GSR is gone.
export async function deleteGsr(id: string): Promise<void> {
  const found = stored(id);
  if (!found || !reach(found.gsr.company_id, found.gsr.employee_id).admin) throw new Error(NOT_CHANGED_MESSAGE);
  gsrs.splice(found.index, 1);
}
