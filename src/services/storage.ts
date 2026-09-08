// Files live in the private 'hub-files' bucket under {company_id}/{area}/... so the
// storage policies in 0005_storage.sql can wall them per company from the path alone.
// Reads go through short-lived signed URLs (the SELECT policy still applies), uploads and
// deletes are admin-only by policy.
import { db } from "./supabase.ts";

const BUCKET = "hub-files";
const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Keep the original name readable but safe for a URL path.
function safeFileName(name: string): string {
  const trimmed = name.trim().replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-");
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "file";
}

export function buildObjectPath(
  companyId: string,
  area: "sops" | "resources",
  parentId: string | null,
  fileName: string,
): string {
  const unique = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
  const folder = parentId ? `${companyId}/${area}/${parentId}` : `${companyId}/${area}`;
  return `${folder}/${unique}-${safeFileName(fileName)}`;
}

export async function uploadFile(path: string, file: File): Promise<void> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is over the 50 MB limit.");
  const { error } = await db().storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
}

export async function getSignedUrl(path: string, expiresInSeconds = 600): Promise<string> {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function removeFile(path: string): Promise<void> {
  const { error } = await db().storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
