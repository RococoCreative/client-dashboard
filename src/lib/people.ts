// People helpers shared by the review header, the people table, the person page, and the
// dashboard: tenure from a hire date, the annual total of a compensation table, how far a
// person's own financial figure is from its target, which roles a person may hand out, who sees
// the division split, and the app's reading of who leads whom and which divisions a viewer may
// see (0038). The database is the wall for all of it; these decide what a screen offers and how
// it labels what came back.
import { formatDate, parseDate } from "./format.ts";
import { ROLE_LABELS, keysOf, type CompanyDivision, type DirectoryEntry, type EmployeeFinancial, type Profile, type Role } from "../types/database.ts";

// Progress against target as a fraction, or null when either side is missing or the target
// is zero, so a blank never reads as zero percent.
export function financialProgress(row: Pick<EmployeeFinancial, "target" | "current">): number | null {
  if (row.target === null || row.current === null || row.target === 0) return null;
  return row.current / row.target;
}

// "3 years, 2 months", "7 months", "Less than a month", or "Starts Oct 1, 2026".
export function formatTenure(hireDate: string | null | undefined, today = new Date()): string | null {
  const start = parseDate(hireDate);
  if (!start) return null;
  let months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth());
  if (today.getDate() < start.getDate()) months -= 1;
  if (months < 0) return `Starts ${formatDate(hireDate)}`;
  if (months === 0) return "Less than a month";
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = years === 0 ? "" : `${years} ${years === 1 ? "year" : "years"}`;
  const m = rest === 0 ? "" : `${rest} ${rest === 1 ? "month" : "months"}`;
  return [y, m].filter(Boolean).join(", ");
}

// Someone on the roster who has signed in at least once.
//
// This marks a row, it does not gate one. Staff an admin has set up but not invited yet are
// part of the company in every way that matters: they get reviews, goals, KPIs and
// compensation, all keyed to a profile id that survives their first sign-in. The only thing
// they cannot do is open any of it themselves, so screens use this to say so.
export function hasAccount(person: { user_id: string | null }): boolean {
  return person.user_id !== null;
}

export function totalAnnual(items: Array<{ annual_amount: number }>): number {
  return items.reduce((sum, item) => sum + (Number.isFinite(item.annual_amount) ? item.annual_amount : 0), 0);
}

// The app's reading of the same role ranking the database enforces (0033). The database is the
// wall; these only decide what a select offers and whether it is locked.
export const ROLE_RANK: Record<Role, number> = { employee: 1, manager: 2, admin: 3, owner: 4 };

// Owners and admins get the admin screens of the hub for their company. A manager is not one: they
// lead people (isLeadRole) without running the company.
export function isCompanyAdminRole(role: Role): boolean {
  return role === "owner" || role === "admin";
}

// Owners, admins and managers lead the people who report to them, and their teams below. An
// employee someone reports to gets nothing from it until they are made a manager.
export function isLeadRole(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "manager";
}

// The same depth limit the database's chain walk has (private.chain_ids).
const CHAIN_DEPTH = 50;

// Everyone below rootId through reports_to: their direct reports, those people's reports, and so on,
// active or not. The root is never in it, and a loop in the data ends the walk instead of spinning.
export function chainOf(people: ReadonlyArray<Pick<Profile, "id" | "reports_to">>, rootId: string): Set<string> {
  const reportsOf = new Map<string, string[]>();
  for (const person of people) {
    if (!person.reports_to) continue;
    const list = reportsOf.get(person.reports_to) ?? [];
    list.push(person.id);
    reportsOf.set(person.reports_to, list);
  }
  const found = new Set<string>();
  let level = [rootId];
  for (let depth = 0; depth < CHAIN_DEPTH && level.length > 0; depth += 1) {
    const next: string[] = [];
    for (const id of level) {
      for (const report of reportsOf.get(id) ?? []) {
        if (report === rootId || found.has(report)) continue;
        found.add(report);
        next.push(report);
      }
    }
    level = next;
  }
  return found;
}

type Viewer = Pick<Profile, "id" | "role" | "is_rococo_admin" | "view_all_divisions" | "view_division_ids">;

// Reads every row of the company: an owner, a Rococo admin, or an admin who sees every division
// (private.has_full_scope). Only these add, rename or remove a division.
export function hasFullScope(viewer: Pick<Profile, "role" | "is_rococo_admin" | "view_all_divisions">): boolean {
  return viewer.is_rococo_admin || viewer.role === "owner" || (viewer.role === "admin" && viewer.view_all_divisions);
}

// An admin or a manager who sees only some divisions. Their company-wide figures cover only the
// people the database shows them, so screens label those figures "in your divisions".
export function isDivisionLimited(viewer: Pick<Profile, "role" | "is_rococo_admin" | "view_all_divisions">): boolean {
  if (viewer.is_rococo_admin || viewer.role === "owner") return false;
  if (viewer.role !== "admin" && viewer.role !== "manager") return false;
  return !viewer.view_all_divisions;
}

// Whether a viewer's division view access covers a division. Owners and Rococo see all of them;
// admins and managers see what an owner gave them; an employee sees only themselves.
export function canViewDivision(viewer: Omit<Viewer, "id">, divisionId: string): boolean {
  if (viewer.is_rococo_admin || viewer.role === "owner") return true;
  if (viewer.role !== "admin" && viewer.role !== "manager") return false;
  return viewer.view_all_divisions || viewer.view_division_ids.includes(divisionId);
}

// The divisions a viewer may pick as a filter, in the company's order.
export function viewerDivisions<D extends Pick<CompanyDivision, "id">>(viewer: Omit<Viewer, "id">, divisions: readonly D[]): D[] {
  return divisions.filter((d) => canViewDivision(viewer, d.id));
}

// The people a viewer leads, out of the people they can see, mirroring the database's led set
// (private.led_person_ids) as far as the client can: an owner, a Rococo admin and a full-scope
// admin lead the whole company; any other admin leads themselves and the people ranked below them
// that the database showed them (the list is already narrowed, and an admin of the same rank in
// their reach is seen but not led); a manager leads their chain, minus anyone ranked at or above
// them; an employee leads nobody. The viewer is in it only when the list holds them and their
// scope does.
//
// The chain is walked through everyone in the list, a manager under the viewer included, so the
// people below that manager are reached. That manager is never in the led set: they are ranked the
// same as the viewer. This needs the mid-chain manager in the list the viewer reads, which is why
// the database shows a manager the managers in their chain.
export function ledBy<T extends Pick<Profile, "id" | "reports_to" | "role">>(viewer: Viewer, people: readonly T[]): T[] {
  if (hasFullScope(viewer)) return [...people];
  if (viewer.role === "admin") return people.filter((p) => p.id === viewer.id || ROLE_RANK[p.role] < ROLE_RANK.admin);
  if (viewer.role !== "manager") return [];
  const chain = chainOf(people, viewer.id);
  return people.filter((p) => chain.has(p.id) && ROLE_RANK[p.role] < ROLE_RANK[viewer.role]);
}

// The company's divisions a person works in, in the company's order. Ids that are not one of the
// company's divisions (one just deleted, say) are left out.
function placedIn<D extends Pick<CompanyDivision, "id">>(divisionIds: readonly string[], divisions: readonly D[]): D[] {
  return divisions.filter((d) => divisionIds.includes(d.id));
}

// In every one of the company's divisions, when it has two or more ("Both" at a two-division
// company). A company with one division has no Both.
export function inEveryDivision(divisionIds: readonly string[], divisions: ReadonlyArray<Pick<CompanyDivision, "id">>): boolean {
  return divisions.length >= 2 && placedIn(divisionIds, divisions).length === divisions.length;
}

// How a person's divisions read in a list: "RBA North", "Both" (every division of a two-division
// company), "All divisions" (every one of three or more), "RBA North, RBA East", or "No division".
export function divisionLabel(divisionIds: readonly string[], divisions: ReadonlyArray<Pick<CompanyDivision, "id" | "name">>): string {
  const placed = placedIn(divisionIds, divisions);
  if (placed.length === 0) return "No division";
  if (inEveryDivision(divisionIds, divisions)) return divisions.length === 2 ? "Both" : "All divisions";
  return placed.map((d) => d.name).join(", ");
}

// A name from the company directory (profile_directory), which every member reads: who assigned a
// task, who owns a milestone. Someone not in it (no id, or a Rococo admin who stepped in) reads as
// the fallback; someone in it with no name yet reads as "Unnamed".
export function nameFromDirectory(
  directory: ReadonlyMap<string, Pick<DirectoryEntry, "full_name">>,
  id: string | null | undefined,
  fallback: string,
): string {
  if (!id) return fallback;
  const entry = directory.get(id);
  if (!entry) return fallback;
  return entry.full_name?.trim() || "Unnamed";
}

// The directory keyed by person, for nameFromDirectory.
export function directoryById<E extends Pick<DirectoryEntry, "id">>(entries: readonly E[]): Map<string, E> {
  return new Map(entries.map((e) => [e.id, e]));
}

// Rococo grants anything, only an owner grants owner, and nobody grants above their own rank.
export function canGrantRole(granter: Pick<Profile, "role" | "is_rococo_admin">, role: Role): boolean {
  if (granter.is_rococo_admin) return true;
  if (role === "owner") return granter.role === "owner";
  return ROLE_RANK[role] <= ROLE_RANK[granter.role];
}

// The roles a select offers this granter, in ROLE_LABELS order.
export function grantableRoles(granter: Pick<Profile, "role" | "is_rococo_admin">): Role[] {
  return keysOf(ROLE_LABELS).filter((r) => canGrantRole(granter, r));
}

// Who sees a company's division split (Combined / North / South) on the dashboard and the
// Scorecards report: owners, Rococo admins, and anyone an owner or Rococo has let see it
// (can_view_divisions, 0035). Everyone else sees the combined company only. Only those same two
// may change can_view_divisions, so this is also who gets the toggle.
export function canSeeDivisions(viewer: Pick<Profile, "role" | "is_rococo_admin" | "can_view_divisions">): boolean {
  return viewer.is_rococo_admin || viewer.role === "owner" || viewer.can_view_divisions;
}

export function canSetDivisionAccess(viewer: Pick<Profile, "role" | "is_rococo_admin">): boolean {
  return viewer.is_rococo_admin || viewer.role === "owner";
}
