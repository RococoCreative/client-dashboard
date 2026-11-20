// Pins that the GSRs on demand mock behaves as 0047 does: no GSR in a company on periods, one a
// person a day, two open at most when one is started, nobody marking their own done, a done GSR's
// goals and notes frozen until it is reopened, and standalone GSRs never showing up where period
// code reads reviews. Every page test for a company on demand leans on this mock telling the same
// story the database would.
import { describe, expect, it } from "vitest";
import { KLASIK, RBA } from "../fixtures.ts";
import { getCompany } from "./companies.ts";
import { createGoal, createGoalNote, goalLinkProblem, listCompanyReviews, listEmployeeReviews, updateGoal } from "./gsr.ts";
import { OWN_GSR_MESSAGE, listPersonGsrs, markGsrDone, reopenGsr, seedMockGsr, setMockGsrMode, startGsr } from "./gsrOnDemand.ts";

const rba = RBA.company.id;
const admin = RBA.profiles[0].id;
const jamie = RBA.profiles[1].id;

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
    await expect(markGsrDone(gsr.id, 80, jamie)).rejects.toThrow(OWN_GSR_MESSAGE);
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
    expect(goalLinkProblem({ company_id: rba, assignee_id: jamie, goal_id: goal.id })).toBeNull();

    await markGsrDone(gsr.id, 90, admin);
    await expect(updateGoal(goal.id, { progress: 50 })).rejects.toThrow("This GSR is done. Reopen it to change its goals.");
    await expect(createGoal({ company_id: rba, employee_id: jamie, title: "Another", kind: "role", review_id: gsr.id })).rejects.toThrow(
      "This GSR is done. Reopen it to change its goals.",
    );
    await expect(createGoalNote({ goal_id: goal.id, company_id: rba, employee_id: jamie, author_id: jamie, body: "Late note" })).rejects.toThrow(
      "This GSR is done. Reopen it to change its notes.",
    );
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
});
