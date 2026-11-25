// Data layer for the SOP library. A document is a sops row plus an append-only chain of
// sop_versions; saving an edit inserts a new version (the database numbers it, names who saved
// it, derives its text and advances the document), never rewrites an old one. Restoring an old
// version saves its body again as a new one. Attachments are rows pointing at files in the
// private hub-files bucket (see storage.ts). Search runs on the database's own index (0053).
import { db } from "./supabase.ts";
import { requireRows } from "../lib/errors.ts";
import { toPrefixQuery } from "../lib/sops/search.ts";
import type { Sop, SopAttachment, SopDocJson, SopStatus, SopVersion } from "../types/database.ts";

const SOP_COLUMNS =
  "id, company_id, title, category_id, summary, status, tags, current_version, created_by, updated_by, created_by_profile_id, created_by_name, updated_by_profile_id, updated_by_name, created_at, updated_at";
const VERSION_COLUMNS =
  "id, sop_id, company_id, version, body_md, body_json, body_text, change_note, created_by, author_profile_id, author_name, created_at";
const ATTACHMENT_COLUMNS = "id, sop_id, company_id, file_name, file_path, content_type, size_bytes, created_by, created_at";

// A version's body: an editor document, or Markdown for a version from before the editor.
export type SopBody = { json: SopDocJson } | { md: string };

function bodyColumns(body: SopBody): { body_json: SopDocJson | null; body_md: string | null } {
  return "json" in body ? { body_json: body.json, body_md: null } : { body_json: null, body_md: body.md };
}

// The company's SOPs, newest change first. With a query, only those the database's search
// matches, each with its text so the list can show the matching line.
export async function listSops(companyId: string, opts?: { query?: string }): Promise<Sop[]> {
  const tsquery = opts?.query ? toPrefixQuery(opts.query) : null;
  let request = db()
    .from("sops")
    .select(tsquery ? `${SOP_COLUMNS}, body_text` : SOP_COLUMNS)
    .eq("company_id", companyId);
  if (tsquery) request = request.textSearch("search", tsquery, { config: "english" });
  const { data, error } = await request.order("updated_at", { ascending: false }).order("title");
  if (error) throw error;
  return (data as unknown as Sop[]) ?? [];
}

export async function getSop(id: string): Promise<Sop> {
  const { data, error } = await db().from("sops").select(SOP_COLUMNS).eq("id", id).single();
  if (error) throw error;
  return data as unknown as Sop;
}

export async function createSop(input: {
  company_id: string;
  title: string;
  category_id: string | null;
  summary?: string | null;
  status?: SopStatus;
  tags?: string[];
  body: SopBody;
  change_note?: string | null;
}): Promise<Sop> {
  const { body, change_note, ...doc } = input;
  const { data, error } = await db().from("sops").insert(doc).select(SOP_COLUMNS).single();
  if (error) throw error;
  const sop = data as unknown as Sop;
  // The document and its first version are two writes. If the version does not save, the
  // document goes again, so the library is not left holding a copy with no text that a retry
  // would then sit a second copy beside. Taking it back is best effort: on a connection that
  // has dropped outright it can fail too, and the original error is the one worth showing.
  try {
    await addSopVersion(sop.id, sop.company_id, body, change_note ?? "First version");
  } catch (err) {
    await deleteSop(sop.id).catch(() => undefined);
    throw err;
  }
  return { ...sop, current_version: 1 };
}

export async function updateSop(
  id: string,
  patch: Partial<Pick<Sop, "title" | "category_id" | "summary" | "status" | "tags">>,
): Promise<Sop> {
  const { data, error } = await db().from("sops").update(patch).eq("id", id).select(SOP_COLUMNS).single();
  if (error) throw error;
  return data as unknown as Sop;
}

export async function deleteSop(id: string): Promise<void> {
  const { data, error } = await db().from("sops").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
}

export async function listSopVersions(sopId: string): Promise<SopVersion[]> {
  const { data, error } = await db()
    .from("sop_versions")
    .select(VERSION_COLUMNS)
    .eq("sop_id", sopId)
    .order("version", { ascending: false });
  if (error) throw error;
  return (data as unknown as SopVersion[]) ?? [];
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
  return (data as unknown as SopVersion | null) ?? null;
}

export async function addSopVersion(
  sopId: string,
  companyId: string,
  body: SopBody,
  changeNote: string | null,
): Promise<SopVersion> {
  const { data, error } = await db()
    .from("sop_versions")
    .insert({ sop_id: sopId, company_id: companyId, ...bodyColumns(body), change_note: changeNote?.trim() || null })
    .select(VERSION_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as SopVersion;
}

// Restoring never rewrites history: the old body is saved again as the newest version.
export async function restoreSopVersion(version: SopVersion): Promise<SopVersion> {
  const body: SopBody = version.body_json ? { json: version.body_json } : { md: version.body_md ?? "" };
  return addSopVersion(version.sop_id, version.company_id, body, `Restored from v${version.version}`);
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
  const { data, error } = await db().from("sop_attachments").delete().eq("id", id).select("id");
  if (error) throw error;
  requireRows(data);
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
  return (data as unknown as Sop[]) ?? [];
}
