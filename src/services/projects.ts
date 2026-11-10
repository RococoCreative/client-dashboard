// Projects and their milestones and letters, which the company enters by hand. Members read and
// admins write, by RLS (0026); nothing is deleted, only archived. company_id on a milestone comes
// from its project by trigger, so it is never sent.
import type { MilestoneKind, Project, ProjectMilestone } from "../types/database.ts";
import { db } from "./supabase.ts";

const PROJECT_COLUMNS = "id, company_id, name, reference, notes, source, source_key, archived_at, created_by, updated_by, created_at, updated_at";
const MILESTONE_COLUMNS = "id, company_id, project_id, title, description, kind, sort_order, target_date, responsible_profile_id, completed_on, archived_at, created_by, updated_by, created_at, updated_at";

export async function listProjects(companyId: string, opts?: { includeArchived?: boolean }): Promise<Project[]> {
  let query = db().from("projects").select(PROJECT_COLUMNS).eq("company_id", companyId);
  if (!opts?.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query.order("name");
  if (error) throw error;
  return (data as Project[]) ?? [];
}

export async function getProject(id: string): Promise<Project> {
  const { data, error } = await db().from("projects").select(PROJECT_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as Project;
}

export async function createProject(input: { company_id: string; name: string; reference?: string | null; notes?: string | null }): Promise<Project> {
  const { data, error } = await db().from("projects").insert(input).select(PROJECT_COLUMNS).single();
  if (error) throw error;
  return data as Project;
}

export type ProjectPatch = Partial<Pick<Project, "name" | "reference" | "notes">>;
export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  const { data, error } = await db().from("projects").update(patch).eq("id", id).select(PROJECT_COLUMNS).single();
  if (error) throw error;
  return data as Project;
}

export async function archiveProject(id: string): Promise<Project> {
  const { data, error } = await db().from("projects").update({ archived_at: new Date().toISOString() }).eq("id", id).select(PROJECT_COLUMNS).single();
  if (error) throw error;
  return data as Project;
}

export async function listMilestones(projectId: string, opts?: { includeArchived?: boolean }): Promise<ProjectMilestone[]> {
  let query = db().from("project_milestones").select(MILESTONE_COLUMNS).eq("project_id", projectId);
  if (!opts?.includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query.order("sort_order").order("created_at");
  if (error) throw error;
  return (data as ProjectMilestone[]) ?? [];
}

// Every live milestone in the company, for the project list's counts.
export async function listCompanyMilestones(companyId: string): Promise<ProjectMilestone[]> {
  const { data, error } = await db()
    .from("project_milestones")
    .select(MILESTONE_COLUMNS)
    .eq("company_id", companyId)
    .is("archived_at", null)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data as ProjectMilestone[]) ?? [];
}

export async function createMilestone(input: { project_id: string; title: string; kind: MilestoneKind; sort_order: number; description?: string | null; target_date?: string | null; responsible_profile_id?: string | null }): Promise<ProjectMilestone> {
  const { data, error } = await db().from("project_milestones").insert(input).select(MILESTONE_COLUMNS).single();
  if (error) throw error;
  return data as ProjectMilestone;
}

export type MilestonePatch = Partial<Pick<ProjectMilestone, "title" | "description" | "kind" | "target_date" | "responsible_profile_id" | "completed_on">>;
export async function updateMilestone(id: string, patch: MilestonePatch): Promise<ProjectMilestone> {
  const { data, error } = await db().from("project_milestones").update(patch).eq("id", id).select(MILESTONE_COLUMNS).single();
  if (error) throw error;
  return data as ProjectMilestone;
}

// Writes each id's place in the list (1, 2, 3...) and returns the project's items in their new order.
export async function reorderMilestones(projectId: string, orderedIds: string[]): Promise<ProjectMilestone[]> {
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await db().from("project_milestones").update({ sort_order: index + 1 }).eq("id", id).eq("project_id", projectId);
    if (error) throw error;
  }
  return listMilestones(projectId);
}

export async function archiveMilestone(id: string): Promise<ProjectMilestone> {
  const { data, error } = await db().from("project_milestones").update({ archived_at: new Date().toISOString() }).eq("id", id).select(MILESTONE_COLUMNS).single();
  if (error) throw error;
  return data as ProjectMilestone;
}
