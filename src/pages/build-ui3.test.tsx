// The monthly review workflow (section C of the overnight build): the opening discussion, the
// month's performance against the role scorecard, the project-by-project notes, and the goal lock
// that keeps a goal someone else set for a person from being rewritten by them. Rendered against
// the mocked data layer like every page test.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/audit.ts", () => import("../test/mocks/audit.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/wins.ts", () => import("../test/mocks/wins.ts"));
vi.mock("../services/sync.ts", () => import("../test/mocks/sync.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createGoal, ensureReview, getReview, listGoals, updateReview } from "../services/gsr.ts";
import { listMetricEntries } from "../services/scorecards.ts";
import { listReviewProjectNotes } from "../services/reviewProjectNotes.ts";
import { KLASIK, RBA, fakeSession, makeHub } from "../test/fixtures.ts";
import type { HubValue } from "../context/HubContext.tsx";
import type { GoalInput } from "../services/gsr.ts";
import ReviewPage from "./gsr/ReviewPage.tsx";
import MyGoalsPage from "./gsr/MyGoalsPage.tsx";
import GoalsPanel from "../components/gsr/GoalsPanel.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rbaAdmin = makeHub("admin", RBA.company);
const noor = RBA.profiles.find((p) => p.id === "rba-user-3")!;
const avery = RBA.profiles.find((p) => p.id === "rba-staff-invited")!;
// Noor signed in as herself: an employee reading her own review.
const noorHub: HubValue = { ...makeHub("employee", RBA.company), profile: noor, session: fakeSession(noor) };
const rbaMonth = RBA.cycles.find((c) => c.id === "rba-cycle-overlapping")!;
const klasikReview = KLASIK.reviews.find((r) => r.status === "in_progress")!;
const route = (id: string) => ({ path: `/gsr/reviews/${id}`, pattern: "/gsr/reviews/:reviewId" });
const DISCUSSION = "What would help you do your job better?";

describe("opening discussion", () => {
  it("leads the monthly review, ahead of the goals", async () => {
    renderWithHub(<ReviewPage />, admin, route(klasikReview.id));
    const box = await screen.findByLabelText(DISCUSSION);
    const goals = await screen.findByText("Goals for this month");
    // Earlier in the document than the goals.
    expect(box.compareDocumentPosition(goals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("saves for the employee on their own open month", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, employee, route(klasikReview.id));
    const box = await screen.findByLabelText(DISCUSSION);
    await user.type(box, "A second tablet for site photos.");
    fireEvent.blur(box);
    await waitFor(async () => expect((await getReview(klasikReview.id)).support_discussion).toBe("A second tablet for site photos."));
  });

  it("saves for an admin", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, admin, route(klasikReview.id));
    const box = await screen.findByLabelText(DISCUSSION);
    expect(box).toHaveValue("A second tablet for site photos.");
    await user.clear(box);
    await user.type(box, "Ordered the tablet; trial on the Lakeside job.");
    fireEvent.blur(box);
    await waitFor(async () => expect((await getReview(klasikReview.id)).support_discussion).toBe("Ordered the tablet; trial on the Lakeside job."));
  });

  it("is read-only once the review is signed off", async () => {
    const review = await ensureReview(rbaMonth.id, RBA.company.id, avery.id);
    await updateReview(review.id, { support_discussion: "Rain gear for the crew." });
    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString(), gsr_score: null });
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    expect(await screen.findByText("Rain gear for the crew.")).toBeInTheDocument();
    expect(screen.queryByLabelText(DISCUSSION)).not.toBeInTheDocument();
  });

  it("shows on a scored review too, with what was said there", async () => {
    const rbaReview = RBA.reviews.find((r) => r.id === "rba-review-current-1")!;
    renderWithHub(<ReviewPage />, rbaAdmin, route(rbaReview.id));
    expect(await screen.findByLabelText(DISCUSSION)).toHaveValue("A second set of laser levels for the island crew.");
  });
});

describe("performance this month", () => {
  it("shows the role's metrics for the month, hit or miss, with the year to date", async () => {
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    const section = (await screen.findByRole("heading", { name: "Performance this month" })).closest("section") as HTMLElement;
    const row = (name: string) => within(section).getByText(name).closest("li") as HTMLElement;

    // Optimization rate: 85% in September against 80, hit; 81% for the year, hit.
    const opt = row("Optimization rate");
    expect(within(opt).getByLabelText("Optimization rate, September 2026")).toHaveValue("85");
    expect(within(opt).getByText("Hit")).toBeInTheDocument();
    expect(within(opt).getByText("81%")).toBeInTheDocument();
    expect(within(opt).getByLabelText("Note on Optimization rate, September 2026")).toHaveValue("Two crews short for a week.");

    // Client journey satisfaction: 5 of 5 against 4, and 4.5 for the year.
    const client = row("Client journey satisfaction");
    expect(within(client).getByLabelText("Client journey satisfaction, September 2026")).toHaveValue("5");
    expect(within(client).getByText("4.5 / 5")).toBeInTheDocument();

    // No target on Compliance to SOPs, so nothing to judge.
    const sops = row("Compliance to SOPs");
    expect(within(sops).queryByText("Hit")).not.toBeInTheDocument();
    expect(within(sops).queryByText(/^Miss/)).not.toBeInTheDocument();
  });

  it("gives a per-project metric one row per assigned project under the month's combined result", async () => {
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    const section = (await screen.findByRole("heading", { name: "Performance this month" })).closest("section") as HTMLElement;
    const gp = within(section).getByText("Job cost: gross profit").closest("li") as HTMLElement;
    // The metric's own line, above its project rows: 31 and 26 average to 28.5, under the 30
    // target; 28.3 for the year.
    const head = gp.firstElementChild as HTMLElement;
    expect(within(head).getByText("28.5%")).toBeInTheDocument();
    expect(within(head).getByText("Miss by 1.5%")).toBeInTheDocument();
    expect(within(head).getByText("28.3%")).toBeInTheDocument();
    // Each project is judged on its own too: Lakeside at 31 hits, Island cottage at 26 misses.
    expect(within(gp).getByText("Hit")).toBeInTheDocument();
    expect(within(gp).getByText("Miss by 4%")).toBeInTheDocument();
    expect(within(gp).getByLabelText("Job cost: gross profit, Lakeside residence, September 2026")).toHaveValue("31");
    expect(within(gp).getByLabelText("Job cost: gross profit, Island cottage, September 2026")).toHaveValue("26");

    // Net profit has only Lakeside entered; Island cottage is there to fill in.
    const np = within(section).getByText("Job cost: net profit").closest("li") as HTMLElement;
    expect(within(np).getByLabelText("Job cost: net profit, Island cottage, September 2026")).toHaveValue("");
  });

  it("saves an admin's entry and its note", async () => {
    const user = userEvent.setup();
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    const input = await screen.findByLabelText("Job cost: net profit, Island cottage, September 2026");
    await user.type(input, "9{Enter}");
    await waitFor(async () => {
      const saved = (await listMetricEntries(RBA.company.id, { employeeId: noor.id, year: 2026 })).find((e) => e.metric_id === "rba-metric-pm-np" && e.project_id === "rba-project-2");
      expect(saved?.value).toBe(9);
    });
    // The combined month now reads both projects: 11 and 9 average to 10, which is the year to date
    // too, September being the only month entered.
    const np = screen.getByText("Job cost: net profit").closest("li") as HTMLElement;
    await waitFor(() => expect(within(np.firstElementChild as HTMLElement).getAllByText("10%")).toHaveLength(2));

    await user.click(await within(np).findByRole("button", { name: "Add a note on Job cost: net profit, Island cottage, September 2026" }));
    const note = await within(np).findByLabelText("Note on Job cost: net profit, Island cottage, September 2026");
    await user.type(note, "Change order still open.");
    fireEvent.blur(note);
    await waitFor(async () => {
      const saved = (await listMetricEntries(RBA.company.id, { employeeId: noor.id, year: 2026 })).find((e) => e.metric_id === "rba-metric-pm-np" && e.project_id === "rba-project-2");
      expect(saved?.note).toBe("Change order still open.");
    });
  });

  it("refuses a value that is not a number, in the section", async () => {
    const user = userEvent.setup();
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    const input = await screen.findByLabelText("Compliance to SOPs, September 2026");
    await user.clear(input);
    await user.type(input, "lots{Enter}");
    expect(await screen.findByText("Enter a number.")).toBeInTheDocument();
    expect(input).toHaveValue("3");
  });

  it("is read-only for the employee", async () => {
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, noorHub, route(review.id));
    const section = (await screen.findByRole("heading", { name: "Performance this month" })).closest("section") as HTMLElement;
    expect(within(section).queryAllByRole("textbox")).toHaveLength(0);
    const opt = within(section).getByText("Optimization rate").closest("li") as HTMLElement;
    expect(within(opt).getByText("85%")).toBeInTheDocument();
    expect(within(opt).getByText("Two crews short for a week.")).toBeInTheDocument();
  });

  it("says so when the person's role has no scorecard", async () => {
    const jamie = RBA.profiles.find((p) => p.id === "rba-user-2")!;
    const review = await ensureReview(rbaMonth.id, RBA.company.id, jamie.id);
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    const section = (await screen.findByRole("heading", { name: "Performance this month" })).closest("section") as HTMLElement;
    expect(within(section).getByText(/No scorecard metrics/)).toBeInTheDocument();
  });

  it("stays off a company that keeps no scorecards", async () => {
    renderWithHub(<ReviewPage />, admin, route(klasikReview.id));
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Performance this month" })).not.toBeInTheDocument();
  });
});

describe("project notes", () => {
  it("lists each assigned project and saves an admin's note", async () => {
    const user = userEvent.setup();
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, rbaAdmin, route(review.id));
    const section = (await screen.findByRole("heading", { name: "Projects" })).closest("section") as HTMLElement;
    expect(within(section).getByText("Lakeside residence")).toBeInTheDocument();
    expect(within(section).getByText("Island cottage")).toBeInTheDocument();
    const box = within(section).getByLabelText("Note on Lakeside residence");
    await user.type(box, "Framing inspection passed.");
    fireEvent.blur(box);
    await waitFor(async () => {
      const notes = await listReviewProjectNotes(review.id);
      expect(notes.find((n) => n.project_id === "rba-project-1")?.note).toBe("Framing inspection passed.");
    });
  });

  it("lets the person read the notes on their own review, not write them", async () => {
    const review = await ensureReview(rbaMonth.id, RBA.company.id, noor.id);
    renderWithHub(<ReviewPage />, noorHub, route(review.id));
    const section = (await screen.findByRole("heading", { name: "Projects" })).closest("section") as HTMLElement;
    expect(await within(section).findByText("Framing inspection passed.")).toBeInTheDocument();
    expect(within(section).queryByLabelText("Note on Lakeside residence")).not.toBeInTheDocument();
  });

  it("keeps a signed-off review's notes as they were", async () => {
    const signedOff = RBA.reviews.find((r) => r.id === "rba-review-current-2")!;
    renderWithHub(<ReviewPage />, rbaAdmin, route(signedOff.id));
    const section = (await screen.findByRole("heading", { name: "Projects" })).closest("section") as HTMLElement;
    expect(within(section).getByText("Framing closed out on schedule; the client walk went well.")).toBeInTheDocument();
    expect(within(section).queryByRole("textbox")).not.toBeInTheDocument();
  });
});

describe("goal lock", () => {
  const setByAdmin = "Core value: Integrity";
  const own = "Run the weekly client update without prompting";

  it("keeps a goal the manager set read-only for the employee, completion still theirs to move", async () => {
    renderWithHub(<ReviewPage />, employee, route(klasikReview.id));
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: setByAdmin }).closest("li") as HTMLElement;
    expect(within(card).getByText("Set by your manager")).toBeInTheDocument();
    expect(screen.queryByLabelText(`Title for ${setByAdmin}`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`Kind for ${setByAdmin}`)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(`Description for ${setByAdmin}`)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: `Delete ${setByAdmin}` })).not.toBeInTheDocument();
    // Completion and notes stay usable.
    expect(screen.getByLabelText(`New note for ${setByAdmin}`)).toBeInTheDocument();
    const slider = screen.getByLabelText(`Agreed completion for ${setByAdmin}`);
    expect(slider).not.toBeDisabled();
    fireEvent.change(slider, { target: { value: "40" } });
    fireEvent.blur(slider);
    await waitFor(async () => {
      const goals = await listGoals(KLASIK.company.id, klasikReview.employee_id);
      expect(goals.find((g) => g.title === setByAdmin)?.progress).toBe(40);
    });
    // Their own goal is theirs in full.
    expect(screen.getByLabelText(`Title for ${own}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Delete ${own}` })).toBeInTheDocument();
    expect(within(screen.getByLabelText(`Title for ${own}`).closest("li") as HTMLElement).queryByText("Set by your manager")).not.toBeInTheDocument();
  });

  it("lets the employee add their own goal, make it personal and edit it", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, employee, route(klasikReview.id));
    await user.type(await screen.findByLabelText("Add a goal for this month"), "Run the half marathon{Enter}");
    const kind = await screen.findByLabelText("Kind for Run the half marathon");
    await user.selectOptions(kind, "personal");
    await waitFor(async () => {
      const goals = await listGoals(KLASIK.company.id, klasikReview.employee_id);
      expect(goals.find((g) => g.title === "Run the half marathon")?.kind).toBe("personal");
    });
    const title = screen.getByLabelText("Title for Run the half marathon");
    await user.clear(title);
    await user.type(title, "Run the fall half marathon{Enter}");
    expect(await screen.findByLabelText("Title for Run the fall half marathon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Run the fall half marathon" })).toBeInTheDocument();
  });

  it("leaves every goal editable for an admin", async () => {
    renderWithHub(<ReviewPage />, admin, route(klasikReview.id));
    expect(await screen.findByLabelText(`Title for ${setByAdmin}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `Delete ${setByAdmin}` })).toBeInTheDocument();
    expect(screen.queryByText("Set by your manager")).not.toBeInTheDocument();
  });

  it("locks a yearly goal the manager set on the employee's My goals, completion still theirs", async () => {
    const employeeId = employee.profile.id;
    await createGoal({
      company_id: KLASIK.company.id,
      employee_id: employeeId,
      title: "Earn the superintendent certificate",
      kind: "professional",
      scope: "year",
      year: 2026,
      cycle_id: null,
      created_by: admin.profile.id,
    } as GoalInput);
    renderWithHub(<MyGoalsPage />, employee);
    const card = (await screen.findByRole("heading", { name: "Earn the superintendent certificate" })).closest("li") as HTMLElement;
    expect(within(card).getByText("Set by your manager")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Edit goal" })).not.toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Delete goal" })).not.toBeInTheDocument();
    expect(within(card).getByLabelText("Completion for Earn the superintendent certificate")).not.toBeDisabled();
    // Their own goals keep Edit and Delete.
    const ownCard = screen.getByRole("heading", { name: "Get the OSHA 30 certification" }).closest("li") as HTMLElement;
    expect(within(ownCard).getByRole("button", { name: "Edit goal" })).toBeInTheDocument();
    expect(within(ownCard).getByRole("button", { name: "Delete goal" })).toBeInTheDocument();
  });

  it("leaves that yearly goal editable for an admin", async () => {
    renderWithHub(<GoalsPanel companyId={KLASIK.company.id} employeeId={employee.profile.id} canEdit />, admin);
    const card = (await screen.findByRole("heading", { name: "Earn the superintendent certificate" })).closest("li") as HTMLElement;
    expect(within(card).getByRole("button", { name: "Edit goal" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Delete goal" })).toBeInTheDocument();
    expect(within(card).queryByText("Set by your manager")).not.toBeInTheDocument();
  });
});
