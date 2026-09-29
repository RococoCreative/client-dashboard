import type { DashboardModule, JobRole, JobRoleGoal } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const roles = fromAll((b) => b.jobRoles).map((x) => ({ ...x, dashboard_modules: [...x.dashboard_modules] }));
const roleGoals = fromAll((b) => b.jobRoleGoals).map((x) => ({ ...x }));

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

export async function listJobRoles(companyId: string, includeInactive = false): Promise<JobRole[]> {
  return roles.filter((r) => r.company_id === companyId && (includeInactive || r.is_active)).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
}
export type JobRoleInput = { company_id: string; name: string; description?: string | null; dashboard_modules?: DashboardModule[]; sort_order?: number };
export async function createJobRole(input: JobRoleInput): Promise<JobRole> {
  const created: JobRole = { id: nextId("role"), description: null, dashboard_modules: [], sort_order: 0, is_active: true, created_at: now(), updated_at: now(), ...input };
  roles.push(created);
  return created;
}
export async function updateJobRole(id: string, patch: Partial<Pick<JobRole, "name" | "description" | "dashboard_modules" | "sort_order" | "is_active">>): Promise<JobRole> {
  return patchIn(roles, id, { ...patch, updated_at: now() });
}
export async function deleteJobRole(id: string): Promise<void> {
  for (const g of roleGoals.filter((g) => g.job_role_id === id)) removeFrom(roleGoals, g.id);
  removeFrom(roles, id);
}

export async function listJobRoleGoals(companyId: string, jobRoleId?: string): Promise<JobRoleGoal[]> {
  return roleGoals.filter((g) => g.company_id === companyId && g.is_active && (!jobRoleId || g.job_role_id === jobRoleId)).sort((a, b) => a.sort_order - b.sort_order);
}
export type JobRoleGoalInput = { job_role_id: string; title: string; description?: string | null; kind?: JobRoleGoal["kind"]; sort_order?: number };
export async function createJobRoleGoal(input: JobRoleGoalInput): Promise<JobRoleGoal> {
  const role = roles.find((r) => r.id === input.job_role_id);
  if (!role) throw new Error("That job role does not exist.");
  const created: JobRoleGoal = { id: nextId("rolegoal"), company_id: role.company_id, description: null, kind: "role", sort_order: 0, is_active: true, created_at: now(), updated_at: now(), ...input };
  roleGoals.push(created);
  return created;
}
export async function updateJobRoleGoal(id: string, patch: Partial<Pick<JobRoleGoal, "title" | "description" | "kind" | "sort_order" | "is_active">>): Promise<JobRoleGoal> {
  return patchIn(roleGoals, id, { ...patch, updated_at: now() });
}
export async function deleteJobRoleGoal(id: string): Promise<void> {
  removeFrom(roleGoals, id);
}
