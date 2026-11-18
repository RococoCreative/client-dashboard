// Who works on which project (0035). Members read assignments and admins write them, by RLS; the
// project decides the company by trigger and the person has to be on that company's team. A new
// project is made through the projects service, then assigned, which is what
// createProjectAndAssign does in two writes, taking the project back if the second one fails.
import type { Project, ProjectAssignment } from "../types/database.ts";
import { archiveProject, createProject } from "./projects.ts";
import { db } from "./supabase.ts";
import { requireRows } from "../lib/errors.ts";

const COLUMNS = "id, company_id, project_id, employee_id, role, created_at, updated_at";

export async function listProjectAssignments(companyId: string, opts?: { employeeId?: string; projectId?: string }): Promise<ProjectAssignment[]> {
  let query = db().from("project_assignments").select(COLUMNS).eq("company_id", companyId);
  if (opts?.employeeId) query = query.eq("employee_id", opts.employeeId);
  if (opts?.projectId) query = query.eq("project_id", opts.projectId);
  const { data, error } = await query.order("created_at");
  if (error) throw error;
  return (data as ProjectAssignment[]) ?? [];
}

export type ProjectAssignmentInput = { company_id: string; project_id: string; employee_id: string; role?: string | null };

export async function assignProject(input: ProjectAssignmentInput): Promise<ProjectAssignment> {
  const { data, error } = await db()
    .from("project_assignments")
    .insert({ ...input, role: input.role?.trim() || null })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as ProjectAssignment;
}

export async function updateProjectAssignment(id: string, patch: { role: string | null }): Promise<ProjectAssignment> {
  const { data, error } = await db()
    .from("project_assignments")
    .update({ role: patch.role?.trim() || null })
    .eq("id", id)
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as ProjectAssignment;
}

export async function unassignProject(id: string): Promise<void> {
  const { data, error } = await db().from("project_assignments").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
}

// Creates a project by name (source 'manual') and assigns the person to it, in two writes. If the
// assignment is refused, the project is taken back so a retry never files a second copy beside it.
// Projects are never deleted (0026), so taking it back means archiving it, which drops it from every
// list. That is best effort: on a dropped connection it can fail too, and the assignment's error is
// the one worth showing.
export async function createProjectAndAssign(input: { company_id: string; name: string; employee_id: string; role?: string | null }): Promise<{ project: Project; assignment: ProjectAssignment }> {
  const project = await createProject({ company_id: input.company_id, name: input.name.trim() });
  try {
    const assignment = await assignProject({ company_id: input.company_id, project_id: project.id, employee_id: input.employee_id, role: input.role ?? null });
    return { project, assignment };
  } catch (err) {
    await archiveProject(project.id).catch(() => undefined);
    throw err;
  }
}
