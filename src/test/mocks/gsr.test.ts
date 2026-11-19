// Pins that the GSR and profile mocks refuse what 0046 refuses, in its words: a GSR cycle on dates
// that are not a canonical period of its rhythm, a GSR opened for someone on another rhythm, a
// manager changing anything but the lock on a GSR of someone they lead, or anything but the rhythm
// on their profile, and nobody setting their own rhythm. And that a GSR period opens itself once:
// ensureGsrCycle twice lands on one row. Page tests and the demo rely on the mocks telling the
// same story the database would.
import { describe, expect, it, onTestFinished } from "vitest";
import { RBA } from "../fixtures.ts";
import { NOT_CHANGED_MESSAGE } from "../../lib/errors.ts";
import { createCycle, ensureGsrCycle, ensureReview, getReview, listCycles, rhythmMessage, updateCycle, updateReview } from "./gsr.ts";
import { listCompanyProfiles, updateProfile } from "./profiles.ts";

const rba = RBA.company.id;
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const harper = byName("Harper Quinn");
const kai = byName("Kai Bennett");
const morgan = byName("Morgan Reyes");
const jamie = byName("Jamie Fox");
const september = RBA.cycles.find((c) => c.kind === "gsr" && c.cadence === "monthly")!;
const week = RBA.cycles.find((c) => c.kind === "gsr" && c.cadence === "weekly")!;
const q3 = RBA.cycles.find((c) => c.kind === "review" && c.status === "open")!;

// The mocks judge a write as the persona the URL names, inside its own company.
function writeAs(persona: string, company: string) {
  window.history.pushState({}, "", `/?persona=${persona}&company=${company}`);
  onTestFinished(() => window.history.pushState({}, "", "/?persona=admin&company=klasik"));
}

describe("opening a GSR period", () => {
  it("opens the canonical period once, whoever asks twice", async () => {
    const first = await ensureGsrCycle(rba, "biweekly", new Date(2026, 9, 7));
    const again = await ensureGsrCycle(rba, "biweekly", new Date(2026, 9, 13));
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ kind: "gsr", cadence: "biweekly", period_start: "2026-10-05", period_end: "2026-10-18", name: "Oct 5 to Oct 18, 2026", status: "open" });
    // The week that already exists is found, not opened twice.
    expect((await ensureGsrCycle(rba, "weekly", new Date(2026, 8, 17))).id).toBe(week.id);
    expect((await listCycles(rba)).filter((c) => c.cadence === "biweekly")).toHaveLength(1);
  });

  it("names a period a member opens the way the database does, and files it under them", async () => {
    writeAs("manager", "rba");
    const opened = await createCycle({ company_id: rba, name: "Our week", kind: "gsr", cadence: "weekly", period_start: "2026-12-28", period_end: "2027-01-03" });
    expect(opened).toMatchObject({ name: "Dec 28, 2026 to Jan 3, 2027", created_by: harper.id });
    await expect(createCycle({ company_id: rba, name: "Q4 2026", kind: "review", cadence: "quarterly", period_start: "2026-10-01", period_end: "2026-12-31" })).rejects.toThrow(/row-level security/);
    await expect(createCycle({ company_id: rba, name: "October 2026", kind: "gsr", cadence: "monthly", period_start: "2026-10-01", period_end: "2026-10-31", theme: "Safety" })).rejects.toThrow(/row-level security/);
  });

  it("refuses dates that are not a whole period of the rhythm, in the database's words", async () => {
    await expect(createCycle({ company_id: rba, name: "x", kind: "gsr", cadence: "weekly", period_start: "2026-09-15", period_end: "2026-09-21" })).rejects.toThrow("A weekly GSR runs from a Monday to the Sunday after it.");
    await expect(createCycle({ company_id: rba, name: "x", kind: "gsr", cadence: "biweekly", period_start: "2026-09-14", period_end: "2026-09-27" })).rejects.toThrow(/shared two-week calendar that started Monday, January 1, 2024/);
    await expect(createCycle({ company_id: rba, name: "x", kind: "gsr", cadence: "monthly", period_start: "2026-10-02", period_end: "2026-10-31" })).rejects.toThrow("A monthly GSR runs from the first to the last day of one month.");
    await expect(createCycle({ company_id: rba, name: "x", kind: "gsr", cadence: "annual", period_start: "2026-01-01", period_end: "2026-12-31" })).rejects.toThrow("A GSR runs weekly, every two weeks, monthly or quarterly.");
    await expect(createCycle({ company_id: rba, name: "x", kind: "review", cadence: "weekly", period_start: "2026-09-14", period_end: "2026-09-20" })).rejects.toThrow("A scored review runs quarterly, yearly or on dates you choose.");
    await expect(updateCycle(week.id, { period_start: "2026-09-15", period_end: "2026-09-21" })).rejects.toThrow("A weekly GSR runs from a Monday to the Sunday after it.");
    await expect(updateCycle(q3.id, { kind: "gsr" })).rejects.toThrow("A cycle's kind is set when it is made. Start a new cycle instead.");
  });
});

describe("whose GSR a period holds", () => {
  it("opens a GSR only at the person's rhythm, and finds one already there whatever it has become", async () => {
    await expect(ensureReview(september.id, rba, morgan.id)).rejects.toThrow(rhythmMessage("weekly", "monthly"));
    expect(rhythmMessage("weekly", "monthly")).toBe("This person's GSRs run every week, so this monthly GSR is not theirs. Change their GSR rhythm first.");
    const weekly = await ensureReview(week.id, rba, morgan.id);
    expect(weekly.status).toBe("not_started");

    // Jamie's September GSR exists; moving Jamie to weekly leaves it readable.
    const monthly = await ensureReview(september.id, rba, jamie.id);
    await updateProfile(jamie.id, { gsr_cadence: "weekly" });
    onTestFinished(async () => {
      await updateProfile(jamie.id, { gsr_cadence: "monthly" });
    });
    expect((await ensureReview(september.id, rba, jamie.id)).id).toBe(monthly.id);
    // A scored review is anyone's, whatever their rhythm.
    expect((await ensureReview(q3.id, rba, morgan.id)).cycle_id).toBe(q3.id);
  });
});

describe("a manager over a GSR", () => {
  it("locks and reopens a GSR of someone they lead, and changes nothing else on it", async () => {
    const review = await ensureReview(september.id, rba, kai.id);
    writeAs("manager", "rba");
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), reviewer_id: harper.id, gsr_score: 75 });
    expect((await getReview(review.id)).status).toBe("complete");
    await updateReview(review.id, { status: "in_progress", completed_at: null });
    expect(await getReview(review.id)).toMatchObject({ status: "in_progress", gsr_score: null });
    await expect(updateReview(review.id, { manager_feedback: "Good month" })).rejects.toThrow("A manager can lock and reopen a GSR, and nothing else on it.");
  });

  it("never touches a scored review, or the GSR of someone they do not lead", async () => {
    const scored = await ensureReview(q3.id, rba, kai.id);
    const notLed = await ensureReview(september.id, rba, jamie.id);
    writeAs("manager", "rba");
    // No update policy reaches either row, so nothing changes (RLS), as the database does it.
    await expect(updateReview(scored.id, { status: "complete", completed_at: new Date().toISOString() })).rejects.toThrow(NOT_CHANGED_MESSAGE);
    await expect(updateReview(notLed.id, { status: "complete", completed_at: new Date().toISOString() })).rejects.toThrow(NOT_CHANGED_MESSAGE);
    expect((await getReview(scored.id)).status).not.toBe("complete");
    expect((await getReview(notLed.id)).status).not.toBe("complete");
  });

  it("sets the rhythm of someone they lead and nothing else, and never their own", async () => {
    writeAs("manager", "rba");
    await updateProfile(kai.id, { gsr_cadence: "quarterly" });
    // Put back once the default persona, which the mocks do not judge here, is writing again.
    onTestFinished(async () => {
      await updateProfile(kai.id, { gsr_cadence: "monthly" });
    });
    expect((await listCompanyProfiles(rba)).find((p) => p.id === kai.id)?.gsr_cadence).toBe("quarterly");
    await expect(updateProfile(kai.id, { title: "Lead Carpenter" })).rejects.toThrow("A manager can change only the GSR rhythm of the people they lead.");
    await expect(updateProfile(jamie.id, { gsr_cadence: "weekly" })).rejects.toThrow(NOT_CHANGED_MESSAGE);
    await expect(updateProfile(harper.id, { gsr_cadence: "weekly" })).rejects.toThrow("Only admins can change employment details.");
  });
});
