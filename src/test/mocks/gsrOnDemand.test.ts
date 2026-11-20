// Pins that the GSRs on demand mock behaves as 0047 does: no GSR in a company on periods, one a
// person a day, two open at most when one is started, nobody marking their own done, a done GSR's
// goals and notes frozen until it is reopened, and standalone GSRs never showing up where period
// code reads reviews. Every page test for a company on demand leans on this mock telling the same
// story the database would.
//
// Who is acting is the person the test rendered the hub with (renderWithHub records it), or one a
// unit test sets with setActingPerson; failing both, the demo persona in the address; failing that,
// the company's admin.
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { NOT_CHANGED_MESSAGE, errorMessage } from "../../lib/errors.ts";
import type { Profile } from "../../types/database.ts";
import { actingPerson, setActingPerson } from "../actingPerson.ts";
import { KLASIK, RBA, makeHub } from "../fixtures.ts";
import { renderWithHub } from "../renderWithHub.tsx";
import { getCompany } from "./companies.ts";
import { createCycle, createGoal, createGoalNote, deleteCycle, deleteGoal, deleteGoalNote, goalLinkProblem, listCompanyReviews, listEmployeeReviews, listGoals, updateCycle, updateGoal, updateGoalNote, updateReview } from "./gsr.ts";import {
  OWN_DONE_DELETE_MESSAGE,
  OWN_GSR_MESSAGE,
  deleteGsr,
  getGsr,
  listGsrsForLog,
  listLastGsrDates,
  listPersonGsrs,
  markGsrDone,
  reopenGsr,
  seedMockGsr,
  setMockGsrMode,
  startGsr,
} from "./gsrOnDemand.ts";

const rba = RBA.company.id;
const admin = RBA.profiles[0].id;
const jamie = RBA.profiles[1].id;
const noor = RBA.profiles[2].id;
const harper = RBA.profiles.find((p) => p.role === "manager")!.id;
// Kai reports to Rowan, who reports to Harper: Harper leads Kai two levels up.
const kai = RBA.profiles.find((p) => p.id === "rba-crew")!.id;
const RLS = /row-level security/;

const person = (id: string): Profile => RBA.profiles.find((p) => p.id === id)!;
const actAs = (id: string) => setActingPerson(person(id));
// The demo's path: the persona in the address, with nobody recorded.
const viaAddress = (persona: string) => window.history.pushState({}, "", `/?persona=${persona}&company=rba`);

afterEach(() => {
  window.history.pushState({}, "", "/");
  sessionStorage.clear();
});

describe("GSRs on demand mock", () => {
  it("refuses a GSR in a company on periods", async () => {
    await expect(startGsr(KLASIK.company.id, KLASIK.profiles[1].id)).rejects.toThrow("GSRs on demand are not turned on for this company.");
    // RBA is on periods until a test turns it on.
    await expect(startGsr(rba, jamie)).rejects.toThrow("GSRs on demand are not turned on for this company.");
    expect(await listPersonGsrs(rba, jamie)).toEqual([]);
  });

  it("starts one GSR however many times it is asked the same day", async () => {
    setMockGsrMode(rba, "on_demand");
    expect((await getCompany(rba)).gsr_mode).toBe("on_demand");
    const first = await startGsr(rba, jamie);
    const again = await startGsr(rba, jamie);
    const third = await startGsr(rba, jamie);
    expect(first.atLimit).toBe(false);
    expect(again.gsr.id).toBe(first.gsr.id);
    expect(third.gsr.id).toBe(first.gsr.id);
    // Stamped with the company's date: noon UTC on 15 September is the morning of the 15th in New York.
    expect(first.gsr).toMatchObject({ cycle_id: null, company_id: rba, employee_id: jamie, status: "not_started", started_on: "2026-09-15", done_on: null });
    expect(await listPersonGsrs(rba, jamie)).toHaveLength(1);
  });

  it("returns the newest with atLimit when two are open", async () => {
    setMockGsrMode(rba, "on_demand");
    seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-08-25", status: "in_progress" });
    const newer = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08" });
    const result = await startGsr(rba, jamie);
    expect(result.atLimit).toBe(true);
    expect(result.gsr.id).toBe(newer.id);
    expect(await listPersonGsrs(rba, jamie)).toHaveLength(2);
    // Newest first.
    expect((await listPersonGsrs(rba, jamie)).map((g) => g.started_on)).toEqual(["2026-09-08", "2026-08-25"]);
  });

  it("refuses the person marking their own GSR done", async () => {
    setMockGsrMode(rba, "on_demand");
    const gsr = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    const doneBefore = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70 });
    actAs(jamie);
    await expect(markGsrDone(gsr.id, 80, jamie)).rejects.toThrow(OWN_GSR_MESSAGE);
    await expect(reopenGsr(doneBefore.id)).rejects.toThrow(OWN_GSR_MESSAGE);
    actAs(admin);
    const done = await markGsrDone(gsr.id, 80, admin);
    expect(done).toMatchObject({ status: "complete", gsr_score: 80, reviewer_id: admin, done_on: "2026-09-15" });
    expect(done.completed_at).not.toBeNull();
    const reopened = await reopenGsr(gsr.id);
    expect(reopened).toMatchObject({ status: "in_progress", completed_at: null, gsr_score: null, done_on: null });
  });

  it("freezes a done GSR's goals", async () => {
    setMockGsrMode(rba, "on_demand");
    const gsr = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    const goal = await createGoal({ company_id: rba, employee_id: jamie, title: "Walk every site", kind: "role", review_id: gsr.id });
    expect(goal.review_id).toBe(gsr.id);
    const note = await createGoalNote({ goal_id: goal.id, company_id: rba, employee_id: jamie, author_id: jamie, body: "Started" });
    expect(goalLinkProblem({ company_id: rba, assignee_id: jamie, goal_id: goal.id })).toBeNull();

    await markGsrDone(gsr.id, 90, admin);
    await expect(updateGoal(goal.id, { progress: 50 })).rejects.toThrow("This GSR is done. Reopen it to change its goals.");
    await expect(createGoal({ company_id: rba, employee_id: jamie, title: "Another", kind: "role", review_id: gsr.id })).rejects.toThrow(
      "This GSR is done. Reopen it to change its goals.",
    );
    await expect(createGoalNote({ goal_id: goal.id, company_id: rba, employee_id: jamie, author_id: jamie, body: "Late note" })).rejects.toThrow(
      "This GSR is done. Reopen it to change its notes.",
    );
    await expect(deleteGoal(goal.id)).rejects.toThrow("This GSR is done. Reopen it to change its goals.");
    await expect(updateGoalNote(note.id, "Edited")).rejects.toThrow("This GSR is done. Reopen it to change its notes.");
    await expect(deleteGoalNote(note.id)).rejects.toThrow("This GSR is done. Reopen it to change its notes.");
    expect(goalLinkProblem({ company_id: rba, assignee_id: jamie, goal_id: goal.id })).toBe("That GSR is done, so its goals take no new tasks.");

    await reopenGsr(gsr.id);
    expect((await updateGoal(goal.id, { progress: 50 })).progress).toBe(50);
  });

  it("keeps period reviews and standalone GSRs in separate lists", async () => {
    setMockGsrMode(rba, "on_demand");
    const periodReviews = await listEmployeeReviews(rba, jamie);
    const companyReviews = await listCompanyReviews(rba);
    expect(periodReviews.length).toBeGreaterThan(0);
    const gsr = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08" });
    expect((await listEmployeeReviews(rba, jamie)).map((r) => r.id)).toEqual(periodReviews.map((r) => r.id));
    expect((await listCompanyReviews(rba)).map((r) => r.id)).toEqual(companyReviews.map((r) => r.id));
    expect((await listPersonGsrs(rba, jamie)).map((g) => g.id)).toEqual([gsr.id]);
  });

  it("hands out a new object on every change, never the one it stores", async () => {
    setMockGsrMode(rba, "on_demand");
    const seeded = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    const before = await getGsr(seeded.id);
    const after = await markGsrDone(seeded.id, 80, admin);
    expect(after).not.toBe(before);
    expect(before.status).toBe("in_progress");
    expect(after.status).toBe("complete");
    const reopened = await reopenGsr(seeded.id);
    expect(reopened).not.toBe(after);
    expect(after.status).toBe("complete");
    // A row read from a list is a copy: changing it changes nothing stored.
    const [listed] = await listPersonGsrs(rba, jamie);
    listed.status = "complete";
    expect((await getGsr(seeded.id)).status).toBe("in_progress");
  });

  it("lets a peer neither start, close, reopen nor delete someone's GSR", async () => {
    setMockGsrMode(rba, "on_demand");
    const open = seedMockGsr({ company_id: rba, employee_id: noor, started_on: "2026-09-08", status: "in_progress" });
    const done = seedMockGsr({ company_id: rba, employee_id: noor, started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70 });
    actAs(jamie);
    await expect(startGsr(rba, noor)).rejects.toThrow(RLS);
    await expect(markGsrDone(open.id, 80, jamie)).rejects.toThrow(NOT_CHANGED_MESSAGE);
    await expect(reopenGsr(done.id)).rejects.toThrow(NOT_CHANGED_MESSAGE);
    await expect(deleteGsr(open.id)).rejects.toThrow(NOT_CHANGED_MESSAGE);
    // Their own they start.
    expect((await startGsr(rba, jamie)).gsr.employee_id).toBe(jamie);
    actAs(admin);
    expect((await listPersonGsrs(rba, noor)).map((g) => g.status)).toEqual(["in_progress", "complete"]);
  });

  it("lets a leader two levels up start and close a GSR, but not delete it", async () => {
    setMockGsrMode(rba, "on_demand");
    viaAddress("manager");
    const { gsr } = await startGsr(rba, kai);
    expect(gsr.employee_id).toBe(kai);
    expect((await markGsrDone(gsr.id, 75, harper)).status).toBe("complete");
    expect((await reopenGsr(gsr.id)).status).toBe("in_progress");
    await expect(deleteGsr(gsr.id)).rejects.toThrow(NOT_CHANGED_MESSAGE);
  });

  it("lets an admin delete a GSR, and its goals go with it", async () => {
    setMockGsrMode(rba, "on_demand");
    const gsr = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    const goal = await createGoal({ company_id: rba, employee_id: jamie, title: "Walk every site", kind: "role", review_id: gsr.id });
    actAs(admin);
    await deleteGsr(gsr.id);
    await expect(getGsr(gsr.id)).rejects.toThrow();
    expect((await listGoals(rba, jamie)).some((g) => g.id === goal.id)).toBe(false);
  });

  it("shows an employee nothing of a peer's GSRs", async () => {
    setMockGsrMode(rba, "on_demand");
    const theirs = seedMockGsr({ company_id: rba, employee_id: noor, started_on: "2026-09-08", status: "in_progress" });
    const mine = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-09", status: "in_progress" });
    actAs(jamie);
    expect(await listPersonGsrs(rba, noor)).toEqual([]);
    await expect(getGsr(theirs.id)).rejects.toThrow("Review not found.");
    expect((await listGsrsForLog(rba, { from: "2026-09-01", to: "2026-09-30" })).map((g) => g.id)).toEqual([mine.id]);
    expect(await listLastGsrDates(rba)).toEqual([{ employee_id: jamie, last_started_on: "2026-09-09" }]);
  });

  it("acts as the person the hub was rendered with, with nothing in the address", async () => {
    setMockGsrMode(rba, "on_demand");
    const mine = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    renderWithHub(createElement("div"), makeHub("employee", { ...RBA.company, gsr_mode: "on_demand" }));
    expect(actingPerson()?.id).toBe(jamie);
    await expect(markGsrDone(mine.id, 80, jamie)).rejects.toThrow(OWN_GSR_MESSAGE);
    await expect(startGsr(rba, noor)).rejects.toThrow(RLS);
  });

  it("forgets the acting person after each test, so the next acts as the admin", async () => {
    expect(actingPerson()).toBeNull();
    setMockGsrMode(rba, "on_demand");
    const mine = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    expect((await markGsrDone(mine.id, 80, admin)).status).toBe("complete");
  });

  it("names an address persona that matches nobody instead of acting as someone else", async () => {
    setMockGsrMode(rba, "on_demand");
    viaAddress("wizard");
    await expect(startGsr(rba, jamie)).rejects.toThrow('The demo persona "wizard" matches nobody at RBA Projects.');
  });

  it("answers the wall only to those the database admits, in a company on periods", async () => {
    // RBA is on periods here. The person, a leader and an admin hear the wall; a peer is refused by
    // row level security before the database says anything about the company.
    actAs(noor);
    await expect(startGsr(rba, jamie)).rejects.toThrow(RLS);
    actAs(jamie);
    await expect(startGsr(rba, jamie)).rejects.toThrow("GSRs on demand are not turned on for this company.");
    actAs(harper);
    await expect(startGsr(rba, kai)).rejects.toThrow("GSRs on demand are not turned on for this company.");
    actAs(admin);
    await expect(startGsr(rba, noor)).rejects.toThrow("GSRs on demand are not turned on for this company.");
  });

  it("keeps a done GSR from its own person's delete, whatever their role, as 0047 does", async () => {
    setMockGsrMode(rba, "on_demand");
    const open = seedMockGsr({ company_id: rba, employee_id: admin, started_on: "2026-09-08", status: "in_progress" });
    const done = seedMockGsr({ company_id: rba, employee_id: admin, started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 70 });
    const reportsDone = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-01", status: "complete", done_on: "2026-09-04", gsr_score: 60 });
    actAs(admin);
    await expect(deleteGsr(done.id)).rejects.toThrow(OWN_DONE_DELETE_MESSAGE);
    expect(OWN_DONE_DELETE_MESSAGE).toBe("Your own GSR stays once it is done. Someone who leads you can delete it.");
    await deleteGsr(open.id);
    await deleteGsr(reportsDone.id);
    expect((await listPersonGsrs(rba, admin)).map((g) => g.id)).toEqual([done.id]);
    expect(await listPersonGsrs(rba, jamie)).toEqual([]);
  });

  it("records who is acting as the one who marked a GSR done, whatever id is sent", async () => {
    setMockGsrMode(rba, "on_demand");
    const gsr = seedMockGsr({ company_id: rba, employee_id: kai, started_on: "2026-09-08", status: "in_progress" });
    actAs(harper);
    expect((await markGsrDone(gsr.id, 70, admin)).reviewer_id).toBe(harper);
    expect((await getGsr(gsr.id)).reviewer_id).toBe(harper);
  });

  it("refuses marking a done GSR done again, as the database does", async () => {
    setMockGsrMode(rba, "on_demand");
    const gsr = seedMockGsr({ company_id: rba, employee_id: jamie, started_on: "2026-09-08", status: "in_progress" });
    actAs(admin);
    const done = await markGsrDone(gsr.id, 70, admin);
    await expect(markGsrDone(gsr.id, 95, admin)).rejects.toThrow("This review is signed off. Reopen it to change it.");
    expect(await getGsr(gsr.id)).toMatchObject({ status: "complete", gsr_score: 70, completed_at: done.completed_at });
  });

  it("opens no GSR month in a company on demand, as 0047 does, and leaves review cycles and periods as they were", async () => {
    const message = "This company has GSRs on demand, so it opens no GSR months.";
    setMockGsrMode(rba, "on_demand");
    actAs(admin);
    const month = { company_id: rba, name: "October 2031", cadence: "monthly" as const, period_start: "2031-10-01", period_end: "2031-10-31", theme: null, theme_description: null };
    await expect(createCycle(month)).rejects.toThrow(message);
    const quarter = await createCycle({ ...month, name: "Q4 2031", cadence: "quarterly", period_end: "2031-12-31" });
    expect(quarter.kind).toBe("review");
    await expect(updateCycle(quarter.id, { cadence: "monthly" })).rejects.toThrow(message);
    expect(errorMessage(new Error(message))).toBe(message);
    const klasikMonth = await createCycle({ ...month, company_id: KLASIK.company.id });
    expect(klasikMonth.kind).toBe("gsr");
    await deleteCycle(quarter.id);
    await deleteCycle(klasikMonth.id);
  });

  it("lets only an admin and the person write a GSR's opening discussion, and freezes a done one", async () => {
    setMockGsrMode(rba, "on_demand");
    const gsr = seedMockGsr({ company_id: rba, employee_id: kai, started_on: "2026-09-14", status: "in_progress" });
    // Harper leads Kai but is not an admin: a leader locks and reopens, and nothing else.
    actAs(harper);
    await expect(updateReview(gsr.id, { support_discussion: "More crew" })).rejects.toThrow("A manager can lock and reopen a GSR, and nothing else on it.");
    actAs(kai);
    expect((await updateReview(gsr.id, { support_discussion: "More crew" })).support_discussion).toBe("More crew");
    actAs(admin);
    expect((await updateReview(gsr.id, { support_discussion: "More crew, and a truck" })).support_discussion).toBe("More crew, and a truck");
    await markGsrDone(gsr.id, null, admin);
    await expect(updateReview(gsr.id, { support_discussion: "Too late" })).rejects.toThrow("This review is signed off. Reopen it to change it.");
    expect((await getGsr(gsr.id)).support_discussion).toBe("More crew, and a truck");
  });
});
