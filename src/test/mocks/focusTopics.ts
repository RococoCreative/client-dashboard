// The focus topics service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/focusTopics.ts; one topic per company per month, as the database's unique key keeps
// it, and a blank theme is refused as its check constraint refuses it.
import type { FocusTopic } from "../../types/database.ts";
import { fromAll, personaFromLocation } from "../fixtures.ts";

const topics = fromAll((b) => b.focusTopics).map((x) => ({ ...x }));

let counter = 0;
const nextId = () => `focus-new-${++counter}`;
const now = () => new Date().toISOString();

export async function listFocusTopics(companyId: string, fromMonth: string, toMonth: string): Promise<FocusTopic[]> {
  return topics
    .filter((t) => t.company_id === companyId && t.month >= fromMonth && t.month <= toMonth)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((t) => ({ ...t }));
}

export async function upsertFocusTopic(companyId: string, month: string, theme: string, description: string | null): Promise<FocusTopic> {
  if (!theme.trim()) throw new Error('new row for relation "focus_topics" violates check constraint "focus_topics_theme_check"');
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new Error('new row for relation "focus_topics" violates check constraint "focus_topics_month_check"');
  const actor = personaFromLocation().profile.id;
  const existing = topics.find((t) => t.company_id === companyId && t.month === month);
  if (existing) {
    Object.assign(existing, { theme: theme.trim(), description: description?.trim() || null, updated_by: actor, updated_at: now() });
    return { ...existing };
  }
  const created: FocusTopic = { id: nextId(), company_id: companyId, month, theme: theme.trim(), description: description?.trim() || null, created_by: actor, updated_by: actor, created_at: now(), updated_at: now() };
  topics.push(created);
  return { ...created };
}

export async function deleteFocusTopic(id: string): Promise<void> {
  const index = topics.findIndex((t) => t.id === id);
  if (index !== -1) topics.splice(index, 1);
}
