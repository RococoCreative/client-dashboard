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

// Every file a company holds, removed when the company itself is deleted. The rows that point
// at files cascade away with the company, but stored objects are not rows and the database
// refuses a plain DELETE on them, so they are listed under {company_id}/ and removed through the
// Storage API. The whole tree is listed before anything is removed, so paging is never thrown off
// by the removals. Returns how many files went.
const PAGE = 100;

export async function removeCompanyFiles(companyId: string): Promise<number> {
  const bucket = db().storage.from(BUCKET);
  const paths: string[] = [];
  async function walk(prefix: string): Promise<void> {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await bucket.list(prefix, { limit: PAGE, offset });
      if (error) throw error;
      for (const entry of data) {
        const path = `${prefix}/${entry.name}`;
        // A folder comes back with no id; a file has one.
        if (entry.id === null) await walk(path);
        else paths.push(path);
      }
      if (data.length < PAGE) return;
    }
  }
  await walk(companyId);
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await bucket.remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
  return paths.length;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
