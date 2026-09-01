// Data layer for the resource library: links, files, templates, videos, documents, each
// with tags. Admins manage, everyone browses; RLS decides, not this module.
import { db } from "./supabase.ts";
import type { Resource, ResourceKind } from "../types/database.ts";

const COLUMNS = "id, company_id, title, description, kind, url, file_path, file_name, tags, created_by, created_at, updated_at";

export async function listResources(companyId: string): Promise<Resource[]> {
  const { data, error } = await db()
    .from("resources")
    .select(COLUMNS)
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data as Resource[]) ?? []).map((r) => ({ ...r, tags: Array.isArray(r.tags) ? r.tags : [] }));
}

export type ResourceInput = {
  company_id: string;
  title: string;
  kind: ResourceKind;
  description?: string | null;
  url?: string | null;
  file_path?: string | null;
  file_name?: string | null;
  tags?: string[];
};

export async function createResource(input: ResourceInput): Promise<Resource> {
  const { data, error } = await db().from("resources").insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data as Resource;
}

export async function updateResource(id: string, patch: Partial<Omit<ResourceInput, "company_id">>): Promise<Resource> {
  const { data, error } = await db().from("resources").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as Resource;
}

export async function deleteResource(id: string): Promise<void> {
  const { error } = await db().from("resources").delete().eq("id", id);
  if (error) throw error;
}

// "safety, Onboarding ,safety" -> ["safety", "onboarding"]
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag) seen.add(tag);
  }
  return [...seen];
}
