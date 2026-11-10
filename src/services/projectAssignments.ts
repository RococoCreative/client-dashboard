// Who works on which project (0035). Members read assignments and admins write them, by RLS; the
// project decides the company by trigger and the person has to be on that company's team. A new
// project is made through the projects service, then assigned, which is what
// createProjectAndAssign does in two writes.
import type { Project, ProjectAssignment } from "../types/database.ts";
import { createProject } from "./projects.ts";
import { db } from "./supabase.ts";

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
  const { error } = await db().from("project_assignments").delete().eq("id", id);
  if (error) throw error;
}

// Creates a project by name (source 'manual') and assigns the person to it. If the assignment is
// refused, the project stays, as any project an admin created would; the error says why.
export async function createProjectAndAssign(input: { company_id: string; name: string; employee_id: string; role?: string | null }): Promise<{ project: Project; assignment: ProjectAssignment }> {
  const project = await createProject({ company_id: input.company_id, name: input.name.trim() });
  const assignment = await assignProject({ company_id: input.company_id, project_id: project.id, employee_id: input.employee_id, role: input.role ?? null });
  return { project, assignment };
}
