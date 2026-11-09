// The wins service on the in-memory fixtures, for page tests and the demo. Same exports as
// src/services/wins.ts; a created win is manual with no source_ref, as the database forces, and
// nothing is ever deleted, only archived.
import type { Win } from "../../types/database.ts";
import { fromAll } from "../fixtures.ts";

const wins = fromAll((b) => b.wins).map((x) => ({ ...x }));

let counter = 0;
const now = () => new Date().toISOString();

function newestFirst(a: Win, b: Win): number {
  return b.won_on.localeCompare(a.won_on) || b.created_at.localeCompare(a.created_at);
}
function patchWin(id: string, patch: Partial<Win>): Win {
  const win = wins.find((x) => x.id === id);
  if (!win) throw new Error("Win not found.");
  Object.assign(win, patch, { updated_at: now() });
  return { ...win };
}

export async function listWins(companyId: string, opts?: { includeArchived?: boolean; limit?: number }): Promise<Win[]> {
  const rows = wins
    .filter((x) => x.company_id === companyId && (opts?.includeArchived || x.archived_at === null))
    .sort(newestFirst)
    .map((x) => ({ ...x }));
  return opts?.limit === undefined ? rows : rows.slice(0, opts.limit);
}

export async function createWin(input: { company_id: string; title: string; won_on: string; description?: string | null; project_id?: string | null }): Promise<Win> {
  const created: Win = {
    id: `win-new-${++counter}`,
    company_id: input.company_id,
    title: input.title,
    description: input.description ?? null,
    won_on: input.won_on,
    project_id: input.project_id ?? null,
    source_type: "manual",
    source_ref: null,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: now(),
    updated_at: now(),
  };
  wins.push(created);
  return { ...created };
}

export type WinPatch = Partial<Pick<Win, "title" | "description" | "won_on" | "project_id">>;
export async function updateWin(id: string, patch: WinPatch): Promise<Win> {
  return patchWin(id, patch);
}

export async function archiveWin(id: string): Promise<Win> {
  return patchWin(id, { archived_at: now() });
}
