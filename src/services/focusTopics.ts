// A company's focus topic calendar: one theme per month, planned ahead (0035). Members read and
// admins write, by RLS; the database stamps who created and last changed a topic. Months are the
// first of the month (YYYY-MM-01), the same shape the database checks.
import type { FocusTopic } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, month, theme, description, created_by, updated_by, created_at, updated_at";

// The topics from fromMonth to toMonth inclusive, earliest first.
export async function listFocusTopics(companyId: string, fromMonth: string, toMonth: string): Promise<FocusTopic[]> {
  const { data, error } = await db()
    .from("focus_topics")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .gte("month", fromMonth)
    .lte("month", toMonth)
    .order("month");
  if (error) throw error;
  return (data as FocusTopic[]) ?? [];
}

// Writes the month's topic, replacing the one already there. A blank theme is refused by the
// database; clearing a month is deleteFocusTopic.
export async function upsertFocusTopic(companyId: string, month: string, theme: string, description: string | null): Promise<FocusTopic> {
  const { data, error } = await db()
    .from("focus_topics")
    .upsert({ company_id: companyId, month, theme: theme.trim(), description: description?.trim() || null }, { onConflict: "company_id,month" })
    .select(COLUMNS)
    .single();
  if (error) throw error;
  return data as FocusTopic;
}

export async function deleteFocusTopic(id: string): Promise<void> {
  const { error } = await db().from("focus_topics").delete().eq("id", id);
  if (error) throw error;
}
