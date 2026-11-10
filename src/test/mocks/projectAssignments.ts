// The project assignments service on the in-memory fixtures, for page tests and the demo. Same
// exports as src/services/projectAssignments.ts. The project decides the company and the person has
// to be on that company's team, as the database's trigger has it; one assignment per person per
// project. createProjectAndAssign goes through the projects mock, as the service goes through the
// projects service.
import type { Project, ProjectAssignment } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { companyOf } from "./profiles.ts";
import { createProject, getProject } from "./projects.ts";

const assignments = fromAll((b) => b.projectAssignments).map((x) => ({ ...x }));

let counter = 0;
const nextId = () => `assignment-new-${++counter}`;
const now = () => new Date().toISOString();

export async function listProjectAssignments(companyId: string, opts?: { employeeId?: string; projectId?: string }): Promise<ProjectAssignment[]> {
  return assignments
    .filter((a) => a.company_id === companyId && (!opts?.employeeId || a.employee_id === opts.employeeId) && (!opts?.projectId || a.project_id === opts.projectId))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((a) => ({ ...a }));
}

export type ProjectAssignmentInput = { company_id: string; project_id: string; employee_id: string; role?: string | null };

export async function assignProject(input: ProjectAssignmentInput): Promise<ProjectAssignment> {
  const project = await getProject(input.project_id);
  if (companyOf(input.employee_id) !== project.company_id) throw new Error("That person is not on this company's team.");
  if (assignments.some((a) => a.project_id === input.project_id && a.employee_id === input.employee_id)) {
    throw new Error('duplicate key value violates unique constraint "project_assignments_key"');
  }
  const created: ProjectAssignment = { id: nextId(), company_id: project.company_id, project_id: project.id, employee_id: input.employee_id, role: input.role?.trim() || null, created_at: now(), updated_at: now() };
  assignments.push(created);
  return { ...created };
}

export async function updateProjectAssignment(id: string, patch: { role: string | null }): Promise<ProjectAssignment> {
  const assignment = assignments.find((a) => a.id === id);
  if (!assignment) throw new Error("That is not here any more, or it is not yours to open.");
  Object.assign(assignment, { role: patch.role?.trim() || null, updated_at: now() });
  return { ...assignment };
}

export async function unassignProject(id: string): Promise<void> {
  const index = assignments.findIndex((a) => a.id === id);
  if (index !== -1) assignments.splice(index, 1);
}

export async function createProjectAndAssign(input: { company_id: string; name: string; employee_id: string; role?: string | null }): Promise<{ project: Project; assignment: ProjectAssignment }> {
  const project = await createProject({ company_id: input.company_id, name: input.name.trim() });
  const assignment = await assignProject({ company_id: input.company_id, project_id: project.id, employee_id: input.employee_id, role: input.role ?? null });
  return { project, assignment };
}
