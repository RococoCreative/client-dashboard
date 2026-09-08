function safeFileName(name: string): string {
  const trimmed = name.trim().replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "-");
  return trimmed.length > 0 ? trimmed.slice(0, 120) : "file";
}
export function buildObjectPath(companyId: string, area: "sops" | "resources", parentId: string | null, fileName: string): string {
  const folder = parentId ? `${companyId}/${area}/${parentId}` : `${companyId}/${area}`;
  return `${folder}/mock-${safeFileName(fileName)}`;
}
export async function uploadFile(): Promise<void> {
  return undefined;
}
export async function getSignedUrl(path: string): Promise<string> {
  return `https://example.com/signed/${encodeURIComponent(path)}`;
}
export async function removeFile(): Promise<void> {
  return undefined;
}
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
