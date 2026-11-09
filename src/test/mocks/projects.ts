// The projects service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/projects.ts; a milestone takes its company from its project here as the database
// trigger does, and nothing is ever deleted, only archived.
import type { MilestoneKind, Project, ProjectMilestone } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const projects = fromAll((b) => b.projects).map((x) => ({ ...x }));
const milestones = fromAll((b) => b.milestones).map((x) => ({ ...x }));

let counter = 0;
const nextId = (prefix: string) => `${prefix}-new-${++counter}`;
const now = () => new Date().toISOString();

function findProject(id: string): Project {
  const project = projects.find((x) => x.id === id);
  if (!project) throw new Error("Project not found.");
  return project;
}
function patchProject(id: string, patch: Partial<Project>): Project {
  const project = findProject(id);
  Object.assign(project, patch, { updated_at: now() });
  return { ...project };
}
function patchMilestone(id: string, patch: Partial<ProjectMilestone>): ProjectMilestone {
  const milestone = milestones.find((x) => x.id === id);
  if (!milestone) throw new Error("Milestone not found.");
  Object.assign(milestone, patch, { updated_at: now() });
  return { ...milestone };
}
function byOrder(a: ProjectMilestone, b: ProjectMilestone): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at);
}

export async function listProjects(companyId: string, opts?: { includeArchived?: boolean }): Promise<Project[]> {
  return projects
    .filter((x) => x.company_id === companyId && (opts?.includeArchived || x.archived_at === null))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((x) => ({ ...x }));
}

export async function getProject(id: string): Promise<Project> {
  return { ...findProject(id) };
}

export async function createProject(input: { company_id: string; name: string; reference?: string | null; notes?: string | null }): Promise<Project> {
  const created: Project = {
    id: nextId("project"),
    company_id: input.company_id,
    name: input.name,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    source: "manual",
    source_key: null,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: now(),
    updated_at: now(),
  };
  projects.push(created);
  return { ...created };
}

export type ProjectPatch = Partial<Pick<Project, "name" | "reference" | "notes">>;
export async function updateProject(id: string, patch: ProjectPatch): Promise<Project> {
  return patchProject(id, patch);
}

export async function archiveProject(id: string): Promise<Project> {
  return patchProject(id, { archived_at: now() });
}

export async function listMilestones(projectId: string, opts?: { includeArchived?: boolean }): Promise<ProjectMilestone[]> {
  return milestones
    .filter((x) => x.project_id === projectId && (opts?.includeArchived || x.archived_at === null))
    .sort(byOrder)
    .map((x) => ({ ...x }));
}

export async function listCompanyMilestones(companyId: string): Promise<ProjectMilestone[]> {
  return milestones
    .filter((x) => x.company_id === companyId && x.archived_at === null)
    .sort(byOrder)
    .map((x) => ({ ...x }));
}

export async function createMilestone(input: { project_id: string; title: string; kind: MilestoneKind; sort_order: number; description?: string | null; target_date?: string | null; responsible_profile_id?: string | null }): Promise<ProjectMilestone> {
  const project = findProject(input.project_id);
  const created: ProjectMilestone = {
    id: nextId("milestone"),
    company_id: project.company_id,
    project_id: project.id,
    title: input.title,
    description: input.description ?? null,
    kind: input.kind,
    sort_order: input.sort_order,
    target_date: input.target_date ?? null,
    responsible_profile_id: input.responsible_profile_id ?? null,
    completed_on: null,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: now(),
    updated_at: now(),
  };
  milestones.push(created);
  return { ...created };
}

export type MilestonePatch = Partial<Pick<ProjectMilestone, "title" | "description" | "kind" | "target_date" | "responsible_profile_id" | "completed_on">>;
export async function updateMilestone(id: string, patch: MilestonePatch): Promise<ProjectMilestone> {
  return patchMilestone(id, patch);
}

export async function reorderMilestones(projectId: string, orderedIds: string[]): Promise<ProjectMilestone[]> {
  orderedIds.forEach((id, index) => {
    const milestone = milestones.find((x) => x.id === id && x.project_id === projectId);
    if (milestone) Object.assign(milestone, { sort_order: index + 1, updated_at: now() });
  });
  return listMilestones(projectId);
}

export async function archiveMilestone(id: string): Promise<ProjectMilestone> {
  return patchMilestone(id, { archived_at: now() });
}
