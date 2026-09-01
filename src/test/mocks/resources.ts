import type { Resource, ResourceKind } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const resources = fromAll((b) => b.resources).map((x) => ({ ...x, tags: [...x.tags] }));
let counter = 0;
const now = () => new Date().toISOString();

export async function listResources(companyId: string): Promise<Resource[]> {
  return resources.filter((r) => r.company_id === companyId);
}
export type ResourceInput = { company_id: string; title: string; kind: ResourceKind; description?: string | null; url?: string | null; file_path?: string | null; file_name?: string | null; tags?: string[] };
export async function createResource(input: ResourceInput): Promise<Resource> {
  const created: Resource = { id: `resource-new-${++counter}`, description: null, url: null, file_path: null, file_name: null, tags: [], created_by: null, created_at: now(), updated_at: now(), ...input };
  resources.unshift(created);
  return created;
}
export async function updateResource(id: string, patch: Partial<Omit<ResourceInput, "company_id">>): Promise<Resource> {
  const index = resources.findIndex((r) => r.id === id);
  if (index === -1) throw new Error("Resource not found.");
  resources[index] = { ...resources[index], ...patch, updated_at: now() } as Resource;
  return resources[index];
}
export async function deleteResource(id: string): Promise<void> {
  const index = resources.findIndex((r) => r.id === id);
  if (index !== -1) resources.splice(index, 1);
}
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(/[,\n]/)) {
    const tag = part.trim().toLowerCase().replace(/\s+/g, " ");
    if (tag) seen.add(tag);
  }
  return [...seen];
}
