// In-memory stand-in for services/sops.ts, same exports, so page tests and `npm run demo`
// run against seeded SOPs, versions and attachments and never touch the network. It plays the
// database's part from 0053: numbering versions, naming who saved them and who last changed an
// SOP, deriving a version's text, tidying tags, and matching a search by word prefixes.
import type { Sop, SopAttachment, SopDocJson, SopStatus, SopVersion } from "../../types/database.ts";
import type { SopBody } from "../../services/sops.ts";
import { fromAll, personaIn } from "../fixtures.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { searchTerms } from "../../lib/sops/search.ts";

const sops: Sop[] = fromAll((b) => b.sops).map((x) => ({ ...x, tags: [...x.tags] }));
const versions: SopVersion[] = fromAll((b) => b.versions).map((x) => ({ ...x }));
const attachments: SopAttachment[] = fromAll((b) => b.attachments).map((x) => ({ ...x }));
let counter = 0;
const now = () => new Date().toISOString();

function docText(doc: SopDocJson): string {
  const out: string[] = [];
  const walk = (node: SopDocJson) => {
    if (typeof node.text === "string") out.push(node.text);
    (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return out.join(" ");
}

// normalize_sop: trimmed, no blanks, no repeats in any case, at most 20 of 40 characters.
function tidyTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags ?? []) {
    const tag = raw.trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  if (out.length > 20 || out.some((t) => t.length > 40)) throw new Error("An SOP takes up to 20 tags of 40 characters each.");
  return out;
}

function stampWriter(sop: Sop): void {
  const person = personaIn(sop.company_id);
  sop.updated_by = person.user_id;
  sop.updated_by_profile_id = person.id;
  sop.updated_by_name = person.full_name;
  sop.updated_at = now();
}

function matches(sop: Sop, query: string): boolean {
  const words = searchTerms([sop.title, sop.tags.join(" "), sop.summary ?? "", sop.body_text ?? ""].join(" "));
  return searchTerms(query).every((term) => words.some((w) => w.startsWith(term)));
}

export async function listSops(companyId: string, opts?: { query?: string }): Promise<Sop[]> {
  const query = opts?.query && searchTerms(opts.query).length ? opts.query : null;
  return sops
    .filter((s) => s.company_id === companyId)
    .filter((s) => !query || matches(s, query))
    .sort((a, b) => (a.updated_at === b.updated_at ? a.title.localeCompare(b.title) : a.updated_at < b.updated_at ? 1 : -1))
    .map((s) => {
      const { body_text, ...rest } = s;
      return query ? { ...rest, tags: [...s.tags], body_text } : { ...rest, tags: [...s.tags] };
    });
}
export async function getSop(id: string): Promise<Sop> {
  const found = sops.find((s) => s.id === id);
  if (!found) throw new Error("SOP not found.");
  const { body_text: _text, ...rest } = found;
  void _text;
  return { ...rest, tags: [...found.tags] };
}
export async function createSop(input: { company_id: string; title: string; category_id: string | null; summary?: string | null; status?: SopStatus; tags?: string[]; body: SopBody; change_note?: string | null }): Promise<Sop> {
  const { body, change_note, tags, ...doc } = input;
  const person = personaIn(input.company_id);
  const created: Sop = {
    id: `sop-new-${++counter}`,
    summary: null,
    status: "draft",
    current_version: 0,
    created_by: person.user_id,
    updated_by: person.user_id,
    created_by_profile_id: person.id,
    created_by_name: person.full_name,
    updated_by_profile_id: person.id,
    updated_by_name: person.full_name,
    created_at: now(),
    updated_at: now(),
    body_text: null,
    ...doc,
    tags: tidyTags(tags),
  };
  sops.push(created);
  try {
    await addSopVersion(created.id, created.company_id, body, change_note ?? "First version");
  } catch (err) {
    await deleteSop(created.id);
    throw err;
  }
  return getSop(created.id);
}
export async function updateSop(id: string, patch: Partial<Pick<Sop, "title" | "category_id" | "summary" | "status" | "tags">>): Promise<Sop> {
  const index = sops.findIndex((s) => s.id === id);
  if (index === -1) throw new Error("SOP not found.");
  const next = { ...sops[index], ...patch, tags: patch.tags ? tidyTags(patch.tags) : sops[index].tags };
  stampWriter(next);
  sops[index] = next;
  return getSop(id);
}
export async function deleteSop(id: string): Promise<void> {
  const index = sops.findIndex((s) => s.id === id);
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  sops.splice(index, 1);
}
export async function listSopVersions(sopId: string): Promise<SopVersion[]> {
  return versions.filter((v) => v.sop_id === sopId).sort((a, b) => b.version - a.version).map((v) => ({ ...v }));
}
export async function getCurrentSopVersion(sopId: string): Promise<SopVersion | null> {
  return (await listSopVersions(sopId))[0] ?? null;
}
export async function addSopVersion(sopId: string, companyId: string, body: SopBody, changeNote: string | null): Promise<SopVersion> {
  const existing = versions.filter((v) => v.sop_id === sopId);
  const version = existing.length + 1;
  const person = personaIn(companyId);
  const json = "json" in body ? body.json : null;
  const md = "md" in body ? body.md : null;
  const created: SopVersion = {
    id: `${sopId}-v${version}`,
    sop_id: sopId,
    company_id: companyId,
    version,
    body_md: md,
    body_json: json,
    body_text: json ? docText(json) : md,
    change_note: changeNote?.trim() || null,
    created_by: person.user_id,
    author_profile_id: person.id,
    author_name: person.full_name,
    created_at: now(),
  };
  versions.push(created);
  const sop = sops.find((s) => s.id === sopId);
  if (sop) {
    sop.current_version = version;
    sop.body_text = created.body_text;
    stampWriter(sop);
  }
  return { ...created };
}
export async function restoreSopVersion(version: SopVersion): Promise<SopVersion> {
  const body: SopBody = version.body_json ? { json: version.body_json } : { md: version.body_md ?? "" };
  return addSopVersion(version.sop_id, version.company_id, body, `Restored from v${version.version}`);
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
  if (index === -1) throw new Error(NOT_CHANGED_MESSAGE);
  attachments.splice(index, 1);
}
export async function listRecentSops(companyId: string, limit = 5): Promise<Sop[]> {
  return (await listSops(companyId)).slice(0, limit);
}

// For the other mocks: what the database knows about an SOP when a task links to it.
export function sopRow(id: string): Sop | undefined {
  return sops.find((s) => s.id === id);
}
