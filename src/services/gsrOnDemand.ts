// Data layer for Goal Setting Reviews that stand on their own, in a company whose gsr_mode is
// on demand (0047): a reviews row with no cycle, stamped by the database with the company's date
// when it starts (started_on) and when it is marked done (done_on). Plain async functions that
// throw; the pages catch and message. The app never sends either date, and the database is the
// wall: it refuses a GSR in a company on periods, a third open one, and anyone marking their own
// done or reopening it. A review in a cycle is read through services/gsr.ts, never here.
import { requireRows } from "../lib/errors.ts";
import { readAllByKey } from "../lib/paging.ts";
import type { DateRange } from "../lib/gsr/onDemand.ts";
import type { Gsr, GsrLastStarted } from "../types/database.ts";
import { REVIEW_COLUMNS } from "./gsr.ts";
import { db } from "./supabase.ts";

// Refusals the database makes, word for word, so a caller can tell one from another.
export const TWO_OPEN_MESSAGE = "This person already has two GSRs open. Mark the earlier one done first.";
export const OWN_GSR_MESSAGE = "Your own GSR is marked done and reopened by someone who leads you.";
export const OWN_DONE_DELETE_MESSAGE = "Your own GSR stays once it is done. Someone who leads you can delete it.";

export async function getGsr(id: string): Promise<Gsr> {
  const { data, error } = await db().from("reviews").select(REVIEW_COLUMNS).eq("id", id).is("cycle_id", null).single();
  if (error) throw error;
  return data as Gsr;
}

// Newest start first; the later-created row wins a tie, and the id settles the rest. The order
// every caller of the two lists below sees.
const newestFirst = (a: Gsr, b: Gsr) =>
  b.started_on.localeCompare(a.started_on) || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

// The part of a query builder the paging below uses. The builders the two lists pass are typed
// to their select; this is the shape they share.
interface GsrQuery extends PromiseLike<{ data: unknown; error: unknown }> {
  gt(column: "id", value: string): GsrQuery;
  order(column: "id", options: { ascending: boolean }): GsrQuery;
  limit(count: number): GsrQuery;
}

// Every page of a GSR query, read by id (readAllByKey: a key that never changes, so a GSR started
// or deleted between two requests is never read twice or missed), then put newest first.
async function readAllGsrs(query: () => unknown): Promise<Gsr[]> {
  const rows = await readAllByKey<Gsr, string>(
    async (after, limit) => {
      const q = query() as GsrQuery;
      const { data, error } = await (after === null ? q : q.gt("id", after)).order("id", { ascending: true }).limit(limit);
      return { data: data as Gsr[] | null, error };
    },
    (gsr) => gsr.id,
  );
  return rows.sort(newestFirst);
}

// One person's GSRs in one company, newest start first, every one of them.
export async function listPersonGsrs(companyId: string, employeeId: string): Promise<Gsr[]> {
  return readAllGsrs(() => db().from("reviews").select(REVIEW_COLUMNS).eq("company_id", companyId).eq("employee_id", employeeId).is("cycle_id", null));
}

// The GSRs a log over a date range reads: those marked done inside the range, and every one open
// now, whenever it began. Every one of them, so a company doing fifty GSRs a day is never
// undercounted; newest start first.
export async function listGsrsForLog(companyId: string, range: DateRange): Promise<Gsr[]> {
  return readAllGsrs(() =>
    db()
      .from("reviews")
      .select(REVIEW_COLUMNS)
      .eq("company_id", companyId)
      .is("cycle_id", null)
      .or(`and(done_on.gte.${range.from},done_on.lte.${range.to}),status.neq.complete`),
  );
}

// The day each person's last GSR began, for the due flag (view gsr_last_started, read through the
// reviews wall). A person with none has no row.
export async function listLastGsrDates(companyId: string): Promise<Array<Pick<GsrLastStarted, "employee_id" | "last_started_on">>> {
  const { data, error } = await db().from("gsr_last_started").select("employee_id, last_started_on").eq("company_id", companyId);
  if (error) throw error;
  return (data as Array<Pick<GsrLastStarted, "employee_id" | "last_started_on">>) ?? [];
}

// Start a GSR for a person: a blank row (company, person, no cycle) that the database stamps with
// today. A start on a day the person already has one ignores the duplicate on
// reviews_person_day_key, so two people starting at once land on the same GSR; then the person's
// newest is read, whoever's insert won. A person with two open already is refused by the database;
// that is not a failure here: the newest comes back with atLimit, for the page to name the one to
// close first.
export async function startGsr(companyId: string, employeeId: string): Promise<{ gsr: Gsr; atLimit: boolean }> {
  const { error } = await db()
    .from("reviews")
    .upsert({ company_id: companyId, employee_id: employeeId, cycle_id: null }, { onConflict: "employee_id,started_on", ignoreDuplicates: true });
  const atLimit = error?.message === TWO_OPEN_MESSAGE;
  if (error && !atLimit) throw error;
  const { data, error: readError } = await db()
    .from("reviews")
    .select(REVIEW_COLUMNS)
    .eq("company_id", companyId)
    .eq("employee_id", employeeId)
    .is("cycle_id", null)
    .order("started_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);
  if (readError) throw readError;
  const newest = ((data as Gsr[] | null) ?? [])[0];
  if (!newest) throw new Error("That GSR could not be opened. Reload the page and try again.");
  return { gsr: newest, atLimit };
}

// Mark a GSR done with its score (0 to 100, from scoreMonth over its goals; null where the company
// does not score its GSRs) and who marked it. The database stamps done_on.
export async function markGsrDone(id: string, score: number | null, reviewerId: string): Promise<Gsr> {
  const { data, error } = await db()
    .from("reviews")
    .update({ status: "complete", completed_at: new Date().toISOString(), gsr_score: score, reviewer_id: reviewerId })
    .eq("id", id)
    .is("cycle_id", null)
    .select(REVIEW_COLUMNS)
    .single();
  if (error) throw error;
  return data as Gsr;
}

// Reopen a done GSR. The database clears done_on and lets the score go.
export async function reopenGsr(id: string): Promise<Gsr> {
  const { data, error } = await db()
    .from("reviews")
    .update({ status: "in_progress", completed_at: null })
    .eq("id", id)
    .is("cycle_id", null)
    .select(REVIEW_COLUMNS)
    .single();
  if (error) throw error;
  return data as Gsr;
}

// An admin's, as for every review, but never their own once it is done (the database refuses it
// with OWN_DONE_DELETE_MESSAGE); its goals go with it.
export async function deleteGsr(id: string): Promise<void> {
  const { data, error } = await db().from("reviews").delete().eq("id", id).is("cycle_id", null).select("id");
  if (error) throw error;
  requireRows(data);
}
