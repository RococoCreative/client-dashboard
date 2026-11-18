// A company's standard milestones (0044): the milestones and letters every new project starts
// with. Members read and admins write, by RLS; the database copies the live rows onto each project
// as it is created, so nothing here touches projects. Nothing is deleted, only archived.
import type { MilestoneKind, MilestoneTemplate } from "../types/database.ts";
import { db } from "./supabase.ts";
import { requireRows } from "../lib/errors.ts";

const TEMPLATE_COLUMNS = "id, company_id, title, kind, sort_order, archived_at, created_at, updated_at";

// The company's live rows, in the order a new project receives them.
export async function listMilestoneTemplates(companyId: string): Promise<MilestoneTemplate[]> {
  const { data, error } = await db()
    .from("milestone_templates")
    .select(TEMPLATE_COLUMNS)
    .eq("company_id", companyId)
    .is("archived_at", null)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data as MilestoneTemplate[]) ?? [];
}

export async function createMilestoneTemplate(companyId: string, input: { title: string; kind: MilestoneKind; sort_order: number }): Promise<MilestoneTemplate> {
  const { data, error } = await db()
    .from("milestone_templates")
    .insert({ company_id: companyId, ...input })
    .select(TEMPLATE_COLUMNS)
    .single();
  if (error) throw error;
  return data as MilestoneTemplate;
}

export type MilestoneTemplatePatch = Partial<Pick<MilestoneTemplate, "title" | "kind">>;
export async function updateMilestoneTemplate(id: string, patch: MilestoneTemplatePatch): Promise<MilestoneTemplate> {
  const { data, error } = await db().from("milestone_templates").update(patch).eq("id", id).select(TEMPLATE_COLUMNS).single();
  if (error) throw error;
  return data as MilestoneTemplate;
}

export async function archiveMilestoneTemplate(id: string): Promise<MilestoneTemplate> {
  const { data, error } = await db()
    .from("milestone_templates")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .select(TEMPLATE_COLUMNS)
    .single();
  if (error) throw error;
  return data as MilestoneTemplate;
}

// Writes each id's place in the list (1, 2, 3...) and returns the company's rows in their new order.
// Each write asks for its row back, so a row that is gone or refused stops the reorder with a
// message instead of being skipped in silence; the caller reloads to show the order that stands.
export async function reorderMilestoneTemplates(companyId: string, orderedIds: string[]): Promise<MilestoneTemplate[]> {
  for (const [index, id] of orderedIds.entries()) {
    const { data, error } = await db()
      .from("milestone_templates")
      .update({ sort_order: index + 1 })
      .eq("id", id)
      .eq("company_id", companyId)
      .select("id");
    if (error) throw error;
    requireRows(data);
  }
  return listMilestoneTemplates(companyId);
}
