// The standard milestones service on an in-memory list, for page tests and the demo. Same exports
// as src/services/milestoneTemplates.ts. It starts empty for every company, which is where every
// company starts; the projects mock reads it to copy the live rows onto a new project, as the
// database trigger does (0044). Nothing is deleted, only archived.
import type { MilestoneKind, MilestoneTemplate } from "../../types/database.ts";

const templates: MilestoneTemplate[] = [];

let counter = 0;
const nextId = () => `milestone-template-new-${++counter}`;
const now = () => new Date().toISOString();

function byOrder(a: MilestoneTemplate, b: MilestoneTemplate): number {
  return a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

function find(id: string): MilestoneTemplate {
  const row = templates.find((t) => t.id === id);
  if (!row) throw new Error("That standard milestone is no longer listed.");
  return row;
}

export async function listMilestoneTemplates(companyId: string): Promise<MilestoneTemplate[]> {
  return templates
    .filter((t) => t.company_id === companyId && t.archived_at === null)
    .sort(byOrder)
    .map((t) => ({ ...t }));
}

export async function createMilestoneTemplate(companyId: string, input: { title: string; kind: MilestoneKind; sort_order: number }): Promise<MilestoneTemplate> {
  const created: MilestoneTemplate = { id: nextId(), company_id: companyId, archived_at: null, created_at: now(), updated_at: now(), ...input };
  templates.push(created);
  return { ...created };
}

export type MilestoneTemplatePatch = Partial<Pick<MilestoneTemplate, "title" | "kind">>;
export async function updateMilestoneTemplate(id: string, patch: MilestoneTemplatePatch): Promise<MilestoneTemplate> {
  const row = find(id);
  Object.assign(row, patch, { updated_at: now() });
  return { ...row };
}

export async function archiveMilestoneTemplate(id: string): Promise<MilestoneTemplate> {
  const row = find(id);
  Object.assign(row, { archived_at: now(), updated_at: now() });
  return { ...row };
}

export async function reorderMilestoneTemplates(companyId: string, orderedIds: string[]): Promise<MilestoneTemplate[]> {
  orderedIds.forEach((id, index) => {
    const row = templates.find((t) => t.id === id && t.company_id === companyId);
    if (!row) throw new Error("That standard milestone is no longer listed.");
    Object.assign(row, { sort_order: index + 1, updated_at: now() });
  });
  return listMilestoneTemplates(companyId);
}
