// The external links service on the in-memory fixtures, for page tests and the demo. Same exports
// as src/services/externalLinks.ts. It returns every link of the company: it cannot know who is
// asking, and audience is decided by RLS, which the SQL test proves, never by UI code.
import type { ExternalLink, LinkAudience, LinkNavGroup, LinkProvider } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

export interface ExternalLinkInput {
  company_id: string; nav_group: LinkNavGroup; label: string; url: string; provider: LinkProvider;
  destination_note?: string | null; embed_url?: string | null; embed_is_public?: boolean;
  audience: LinkAudience; sort_order: number;
}
export type ExternalLinkPatch = Partial<Omit<ExternalLinkInput, "company_id">>;

const links = fromAll((b) => b.externalLinks).map((x) => ({ ...x }));

let counter = 0;
const now = () => new Date().toISOString();

function inOrder(a: ExternalLink, b: ExternalLink): number {
  return a.nav_group.localeCompare(b.nav_group) || a.sort_order - b.sort_order || a.label.localeCompare(b.label);
}

export async function listExternalLinks(companyId: string, opts?: { navGroup?: LinkNavGroup }): Promise<ExternalLink[]> {
  return links
    .filter((x) => x.company_id === companyId && (!opts?.navGroup || x.nav_group === opts.navGroup))
    .sort(inOrder)
    .map((x) => ({ ...x }));
}

export async function createExternalLink(input: ExternalLinkInput): Promise<ExternalLink> {
  const created: ExternalLink = {
    id: `link-new-${++counter}`,
    company_id: input.company_id,
    nav_group: input.nav_group,
    label: input.label,
    destination_note: input.destination_note ?? null,
    url: input.url,
    provider: input.provider,
    embed_url: input.embed_url ?? null,
    embed_is_public: input.embed_is_public ?? false,
    audience: input.audience,
    sort_order: input.sort_order,
    created_by: null,
    updated_by: null,
    created_at: now(),
    updated_at: now(),
  };
  links.push(created);
  return { ...created };
}

export async function updateExternalLink(id: string, patch: ExternalLinkPatch): Promise<ExternalLink> {
  const link = links.find((x) => x.id === id);
  if (!link) throw new Error("Link not found.");
  Object.assign(link, patch, { updated_at: now() });
  return { ...link };
}

export async function deleteExternalLink(id: string): Promise<void> {
  const index = links.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("Link not found.");
  links.splice(index, 1);
}
