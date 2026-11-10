// Links to a company's own outside tools, such as Monday boards. Links are rows a company admin
// keeps (0031); who sees each one is decided by RLS on its audience, so this module never filters
// by audience. It reads and writes links only: nothing here calls an outside tool.
import type { ExternalLink, LinkAudience, LinkNavGroup, LinkProvider } from "../types/database.ts";
import { db } from "./supabase.ts";

const COLUMNS = "id, company_id, nav_group, label, destination_note, url, provider, embed_url, embed_is_public, audience, sort_order, created_by, updated_by, created_at, updated_at";

export interface ExternalLinkInput {
  company_id: string; nav_group: LinkNavGroup; label: string; url: string; provider: LinkProvider;
  destination_note?: string | null; embed_url?: string | null; embed_is_public?: boolean;
  audience: LinkAudience; sort_order: number;
}
export type ExternalLinkPatch = Partial<Omit<ExternalLinkInput, "company_id">>;

// By section, then the order an admin set, then label.
export async function listExternalLinks(companyId: string, opts?: { navGroup?: LinkNavGroup }): Promise<ExternalLink[]> {
  let query = db().from("external_links").select(COLUMNS).eq("company_id", companyId);
  if (opts?.navGroup) query = query.eq("nav_group", opts.navGroup);
  const { data, error } = await query.order("nav_group").order("sort_order").order("label");
  if (error) throw error;
  return (data as ExternalLink[]) ?? [];
}

export async function createExternalLink(input: ExternalLinkInput): Promise<ExternalLink> {
  const { data, error } = await db().from("external_links").insert(input).select(COLUMNS).single();
  if (error) throw error;
  return data as ExternalLink;
}

export async function updateExternalLink(id: string, patch: ExternalLinkPatch): Promise<ExternalLink> {
  const { data, error } = await db().from("external_links").update(patch).eq("id", id).select(COLUMNS).single();
  if (error) throw error;
  return data as ExternalLink;
}

export async function deleteExternalLink(id: string): Promise<void> {
  const { error } = await db().from("external_links").delete().eq("id", id);
  if (error) throw error;
}
