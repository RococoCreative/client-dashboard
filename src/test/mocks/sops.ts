import type { Sop, SopAttachment, SopCategory, SopStatus, SopVersion } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const sops = fromAll((b) => b.sops).map((x) => ({ ...x }));
const versions = fromAll((b) => b.versions).map((x) => ({ ...x }));
const attachments = fromAll((b) => b.attachments).map((x) => ({ ...x }));
let counter = 0;
const now = () => new Date().toISOString();

export async function listSops(companyId: string): Promise<Sop[]> {
  return sops.filter((s) => s.company_id === companyId);
}
export async function getSop(id: string): Promise<Sop> {
  const found = sops.find((s) => s.id === id);
  if (!found) throw new Error("SOP not found.");
  return found;
}
export async function createSop(input: { company_id: string; title: string; category: SopCategory; summary?: string | null; status?: SopStatus; body_md: string; change_note?: string | null }): Promise<Sop> {
  const { body_md, change_note, ...doc } = input;
  const created: Sop = { id: `sop-new-${++counter}`, summary: null, status: "draft", current_version: 0, created_by: null, updated_by: null, created_at: now(), updated_at: now(), ...doc };
  sops.push(created);
  await addSopVersion(created.id, created.company_id, body_md, change_note ?? "First version");
  return created;
}
export async function updateSop(id: string, patch: Partial<Pick<Sop, "title" | "category" | "summary" | "status">>): Promise<Sop> {
  const index = sops.findIndex((s) => s.id === id);
  if (index === -1) throw new Error("SOP not found.");
  sops[index] = { ...sops[index], ...patch, updated_at: now() };
  return sops[index];
}
export async function deleteSop(id: string): Promise<void> {
  const index = sops.findIndex((s) => s.id === id);
  if (index !== -1) sops.splice(index, 1);
}
export async function listSopVersions(sopId: string): Promise<SopVersion[]> {
  return versions.filter((v) => v.sop_id === sopId).sort((a, b) => b.version - a.version);
}
export async function getCurrentSopVersion(sopId: string): Promise<SopVersion | null> {
  return (await listSopVersions(sopId))[0] ?? null;
}
export async function addSopVersion(sopId: string, companyId: string, bodyMd: string, changeNote: string | null): Promise<SopVersion> {
  const existing = versions.filter((v) => v.sop_id === sopId);
  const version = existing.length + 1;
  const created: SopVersion = { id: `${sopId}-v${version}`, sop_id: sopId, company_id: companyId, version, body_md: bodyMd, change_note: changeNote, created_by: null, created_at: now() };
  versions.push(created);
  const index = sops.findIndex((s) => s.id === sopId);
  if (index !== -1) sops[index] = { ...sops[index], current_version: version, updated_at: now() };
  return created;
}
export async function listSopAttachments(sopId: string): Promise<SopAttachment[]> {
  return attachments.filter((a) => a.sop_id === sopId);
}
export async function addSopAttachment(input: { sop_id: string; company_id: string; file_name: string; file_path: string; content_type: string | null; size_bytes: number | null }): Promise<SopAttachment> {
  const created: SopAttachment = { id: `attachment-new-${++counter}`, created_by: null, created_at: now(), ...input };
  attachments.push(created);
  return created;
}
export async function removeSopAttachment(id: string): Promise<void> {
  const index = attachments.findIndex((a) => a.id === id);
  if (index !== -1) attachments.splice(index, 1);
}
export async function listRecentSops(companyId: string, limit = 5): Promise<Sop[]> {
  return sops.filter((s) => s.company_id === companyId).sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)).slice(0, limit);
}
