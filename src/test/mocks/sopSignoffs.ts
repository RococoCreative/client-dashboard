// In-memory stand-in for services/sopSignoffs.ts, same exports. It plays 0053's rules: only a
// published SOP, only for yourself, one sign-off a version unless a task assigned since asks for
// another, and a sign-off closes that person's open tasks on the SOP assigned before it.
import type { SopSignoff } from "../../types/database.ts";
import { fromAll, personaIn } from "../fixtures.ts";
import { sopRow } from "./sops.ts";
import { closeTasksOnSignoff, openSopTaskSince } from "./tasks.ts";

const signoffs: SopSignoff[] = fromAll((b) => b.sopSignoffs).map((x) => ({ ...x }));
let counter = 0;

export async function listMySopSignoffs(companyId: string, profileId: string): Promise<SopSignoff[]> {
  return signoffs
    .filter((s) => s.company_id === companyId && s.profile_id === profileId)
    .sort((a, b) => (a.signed_at < b.signed_at ? 1 : -1))
    .map((s) => ({ ...s }));
}
export async function listSopSignoffs(sopId: string): Promise<SopSignoff[]> {
  return signoffs
    .filter((s) => s.sop_id === sopId)
    .sort((a, b) => (a.signed_at < b.signed_at ? 1 : -1))
    .map((s) => ({ ...s }));
}
export async function signOffSop(sopId: string, profileId: string): Promise<SopSignoff> {
  const sop = sopRow(sopId);
  if (!sop) throw new Error("Unknown SOP.");
  if (sop.status !== "published") throw new Error("Only a published SOP can be signed off.");
  const person = personaIn(sop.company_id);
  if (person.id !== profileId) throw new Error("A sign-off is your own. Nobody signs off for someone else.");
  const last = signoffs
    .filter((s) => s.sop_id === sopId && s.profile_id === profileId && s.version === sop.current_version)
    .sort((a, b) => (a.signed_at < b.signed_at ? 1 : -1))[0];
  if (last && !openSopTaskSince(sopId, profileId, last.signed_at)) throw new Error("You have already signed off this version.");
  const created: SopSignoff = {
    id: `sop-signoff-new-${++counter}`,
    company_id: sop.company_id,
    sop_id: sopId,
    profile_id: profileId,
    version: sop.current_version,
    signer_name: person.full_name,
    signed_at: new Date().toISOString(),
  };
  signoffs.push(created);
  closeTasksOnSignoff(sopId, profileId, created.signed_at);
  return { ...created };
}

// For the tasks mock: whether this person has signed off this SOP at or after a moment.
export function signedSince(sopId: string, profileId: string, since: string): boolean {
  return signoffs.some((s) => s.sop_id === sopId && s.profile_id === profileId && s.signed_at >= since);
}
