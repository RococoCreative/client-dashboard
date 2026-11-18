// The projects service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/projects.ts; a milestone takes its company from its project here as the database
// trigger does, its status and completed-on date stay in step as sync_milestone_status keeps them
// (0043), and nothing is ever deleted, only archived.
import type { MilestoneKind, Project, ProjectMilestone } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { companyToday } from "../../lib/wins.ts";
import { timeZoneOf } from "./companies.ts";

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
// sync_milestone_status (0043): when a write changes the date, the date wins (a date completes,
// clearing it reopens to the open status the write named, or to not started); otherwise
// completing dates the milestone today in the company's zone and reopening clears the date.
function syncStatus(before: ProjectMilestone, after: ProjectMilestone): void {
  const dateChanged = after.completed_on !== before.completed_on;
  const statusChanged = after.status !== before.status;
  if (dateChanged) {
    if (after.completed_on !== null) after.status = "complete";
    else if (!statusChanged || after.status === "complete") after.status = "not_started";
  } else if (after.status === "complete" && after.completed_on === null) {
    after.completed_on = companyToday(timeZoneOf(after.company_id));
  } else if (after.status !== "complete" && after.completed_on !== null) {
    after.completed_on = null;
  }
}
function patchMilestone(id: string, patch: Partial<ProjectMilestone>): ProjectMilestone {
  const milestone = milestones.find((x) => x.id === id);
  if (!milestone) throw new Error("Milestone not found.");
  const before = { ...milestone };
  Object.assign(milestone, patch, { updated_at: now() });
  syncStatus(before, milestone);
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
    status: "not_started",
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

export type MilestonePatch = Partial<Pick<ProjectMilestone, "title" | "description" | "kind" | "target_date" | "responsible_profile_id" | "status" | "completed_on">>;
export async function updateMilestone(id: string, patch: MilestonePatch): Promise<ProjectMilestone> {
  return patchMilestone(id, patch);
}

export async function reorderMilestones(projectId: string, orderedIds: string[]): Promise<ProjectMilestone[]> {
  // Each write must find its row, as the service checks; a missing one stops the reorder there.
  orderedIds.forEach((id, index) => {
    const milestone = milestones.find((x) => x.id === id && x.project_id === projectId);
    if (!milestone) throw new Error(NOT_CHANGED_MESSAGE);
    Object.assign(milestone, { sort_order: index + 1, updated_at: now() });
  });
  return listMilestones(projectId);
}

export async function archiveMilestone(id: string): Promise<ProjectMilestone> {
  return patchMilestone(id, { archived_at: now() });
}
