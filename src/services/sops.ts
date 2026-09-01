// Data layer for the SOP library. A document is a sops row plus an append-only chain of
// sop_versions; saving an edit inserts a new version (the database numbers it and advances
// the document), never rewrites an old one. Attachments are rows pointing at files in the
// private hub-files bucket (see storage.ts).
import { db } from "./supabase.ts";
import type { Sop, SopAttachment, SopCategory, SopStatus, SopVersion } from "../types/database.ts";

const SOP_COLUMNS =
  "id, company_id, title, category, summary, status, current_version, created_by, updated_by, created_at, updated_at";
const VERSION_COLUMNS = "id, sop_id, company_id, version, body_md, change_note, created_by, created_at";
const ATTACHMENT_COLUMNS = "id, sop_id, company_id, file_name, file_path, content_type, size_bytes, created_by, created_at";

export async function listSops(companyId: string): Promise<Sop[]> {
  const { data, error } = await db()
    .from("sops")
    .select(SOP_COLUMNS)
    .eq("company_id", companyId)
    .order("category")
    .order("title");
  if (error) throw error;
  return (data as Sop[]) ?? [];
}

export async function getSop(id: string): Promise<Sop> {
  const { data, error } = await db().from("sops").select(SOP_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as Sop;
}

export async function createSop(input: {
  company_id: string;
  title: string;
  category: SopCategory;
  summary?: string | null;
  status?: SopStatus;
  body_md: string;
  change_note?: string | null;
}): Promise<Sop> {
  const { body_md, change_note, ...doc } = input;
  const { data, error } = await db().from("sops").insert(doc).select(SOP_COLUMNS).single();
  if (error) throw error;
  const sop = data as Sop;
  await addSopVersion(sop.id, sop.company_id, body_md, change_note ?? "First version");
  return { ...sop, current_version: 1 };
}

export async function updateSop(
  id: string,
  patch: Partial<Pick<Sop, "title" | "category" | "summary" | "status">>,
): Promise<Sop> {
  const { data, error } = await db().from("sops").update(patch).eq("id", id).select(SOP_COLUMNS).single();
  if (error) throw error;
  return data as Sop;
}

export async function deleteSop(id: string): Promise<void> {
  const { error } = await db().from("sops").delete().eq("id", id);
  if (error) throw error;
}

export async function listSopVersions(sopId: string): Promise<SopVersion[]> {
  const { data, error } = await db()
    .from("sop_versions")
    .select(VERSION_COLUMNS)
    .eq("sop_id", sopId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data as SopVersion[]) ?? [];
}

export async function getCurrentSopVersion(sopId: string): Promise<SopVersion | null> {
  const { data, error } = await db()
    .from("sop_versions")
    .select(VERSION_COLUMNS)
    .eq("sop_id", sopId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SopVersion | null) ?? null;
}

export async function addSopVersion(
  sopId: string,
  companyId: string,
  bodyMd: string,
  changeNote: string | null,
): Promise<SopVersion> {
  const { data, error } = await db()
    .from("sop_versions")
    .insert({ sop_id: sopId, company_id: companyId, body_md: bodyMd, change_note: changeNote?.trim() || null })
    .select(VERSION_COLUMNS)
    .single();
  if (error) throw error;
  return data as SopVersion;
}

export async function listSopAttachments(sopId: string): Promise<SopAttachment[]> {
  const { data, error } = await db()
    .from("sop_attachments")
    .select(ATTACHMENT_COLUMNS)
    .eq("sop_id", sopId)
    .order("created_at");
  if (error) throw error;
  return (data as SopAttachment[]) ?? [];
}

export async function addSopAttachment(input: {
  sop_id: string;
  company_id: string;
  file_name: string;
  file_path: string;
  content_type: string | null;
  size_bytes: number | null;
}): Promise<SopAttachment> {
  const { data, error } = await db().from("sop_attachments").insert(input).select(ATTACHMENT_COLUMNS).single();
  if (error) throw error;
  return data as SopAttachment;
}

export async function removeSopAttachment(id: string): Promise<void> {
  const { error } = await db().from("sop_attachments").delete().eq("id", id);
  if (error) throw error;
}

// Recently updated documents for the dashboard card.
export async function listRecentSops(companyId: string, limit = 5): Promise<Sop[]> {
  const { data, error } = await db()
    .from("sops")
    .select(SOP_COLUMNS)
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as Sop[]) ?? [];
}
