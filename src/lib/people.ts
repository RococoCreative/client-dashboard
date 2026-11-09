// People helpers shared by the review header, the people table, the person page, and the
// dashboard: tenure from a hire date, the annual total of a compensation table, how far a
// person's own financial figure is from its target, and which roles a person may hand out.
import { formatDate, parseDate } from "./format.ts";
import { ROLE_LABELS, keysOf, type EmployeeFinancial, type Profile, type Role } from "../types/database.ts";

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

// The app's reading of the same role ranking the database enforces (0031). The database is the
// wall; these only decide what a select offers and whether it is locked.
const ROLE_RANK: Record<Role, number> = { employee: 1, manager: 2, admin: 3, owner: 4 };

// Owners and admins both get the whole hub for their company; a manager is employee-level for now.
export function isCompanyAdminRole(role: Role): boolean {
  return role === "owner" || role === "admin";
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
