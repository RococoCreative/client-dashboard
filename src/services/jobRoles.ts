// Job roles and the goals they bring with them. A role belongs to a company; company_id on a
// role goal is stamped from the role by trigger, so the caller sends the role and the text.
import type { DashboardModule, JobRole, JobRoleGoal } from "../types/database.ts";
import { db } from "./supabase.ts";

const ROLE_COLUMNS = "id, company_id, name, description, dashboard_modules, sort_order, is_active, created_at, updated_at";
const ROLE_GOAL_COLUMNS = "id, company_id, job_role_id, title, description, kind, sort_order, is_active, created_at, updated_at";

export async function listJobRoles(companyId: string, includeInactive = false): Promise<JobRole[]> {
  let query = db().from("job_roles").select(ROLE_COLUMNS).eq("company_id", companyId);
  if (!includeInactive) query = query.eq("is_active", true);
  const { data, error } = await query.order("sort_order").order("name");
  if (error) throw error;
  return (data as JobRole[]) ?? [];
}
export type JobRoleInput = { company_id: string; name: string; description?: string | null; dashboard_modules?: DashboardModule[]; sort_order?: number };
export async function createJobRole(input: JobRoleInput): Promise<JobRole> {
  const { data, error } = await db().from("job_roles").insert(input).select(ROLE_COLUMNS).single();
  if (error) throw error;
  return data as JobRole;
}
export async function updateJobRole(id: string, patch: Partial<Pick<JobRole, "name" | "description" | "dashboard_modules" | "sort_order" | "is_active">>): Promise<JobRole> {
  const { data, error } = await db().from("job_roles").update(patch).eq("id", id).select(ROLE_COLUMNS).single();
  if (error) throw error;
  return data as JobRole;
}
export async function deleteJobRole(id: string): Promise<void> {
  const { error } = await db().from("job_roles").delete().eq("id", id);
  if (error) throw error;
}

export async function listJobRoleGoals(companyId: string, jobRoleId?: string): Promise<JobRoleGoal[]> {
  let query = db().from("job_role_goals").select(ROLE_GOAL_COLUMNS).eq("company_id", companyId).eq("is_active", true);
  if (jobRoleId) query = query.eq("job_role_id", jobRoleId);
  const { data, error } = await query.order("sort_order").order("created_at");
  if (error) throw error;
  return (data as JobRoleGoal[]) ?? [];
}
export type JobRoleGoalInput = { job_role_id: string; title: string; description?: string | null; kind?: JobRoleGoal["kind"]; sort_order?: number };
export async function createJobRoleGoal(input: JobRoleGoalInput): Promise<JobRoleGoal> {
  const { data, error } = await db().from("job_role_goals").insert(input).select(ROLE_GOAL_COLUMNS).single();
  if (error) throw error;
  return data as JobRoleGoal;
}
export async function updateJobRoleGoal(id: string, patch: Partial<Pick<JobRoleGoal, "title" | "description" | "kind" | "sort_order" | "is_active">>): Promise<JobRoleGoal> {
  const { data, error } = await db().from("job_role_goals").update(patch).eq("id", id).select(ROLE_GOAL_COLUMNS).single();
  if (error) throw error;
  return data as JobRoleGoal;
}
export async function deleteJobRoleGoal(id: string): Promise<void> {
  const { error } = await db().from("job_role_goals").delete().eq("id", id);
  if (error) throw error;
}
