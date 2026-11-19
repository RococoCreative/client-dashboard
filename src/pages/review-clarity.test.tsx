// The review and GSR screens after the clarity sweep: on a review the yearly goals panel is one card
// among many, so no goals yet is one quiet line and New goal stays quiet beside Mark complete; on a
// cycle page the name and dates read in the header and a pencil opens them; a deliverable line item
// names its target and actual fields; a company with no cycles has one filled button, not two.
import { screen, within } from "@testing-library/react";
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
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/milestoneTemplates.ts", () => import("../test/mocks/milestoneTemplates.ts"));

import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import GoalsPanel from "../components/gsr/GoalsPanel.tsx";
import CyclePage from "./gsr/CyclePage.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const admin = makeHub("admin");

describe("yearly goals on a review", () => {
  it("says no goals yet in one quiet line, with New goal beside it", async () => {
    const person = RBA.profiles.filter((p) => p.role === "employee")[1];
    renderWithHub(<GoalsPanel companyId={RBA.company.id} employeeId={person.id} canEdit quiet />, rbaAdmin);
    expect(await screen.findByText("No goals for this year or next, and no BHAG, yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Set the first goal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New goal/ })).toBeInTheDocument();
  });

  it("keeps the full empty block where the panel is the page", async () => {
    const person = RBA.profiles.filter((p) => p.role === "employee")[1];
    renderWithHub(<GoalsPanel companyId={RBA.company.id} employeeId={person.id} canEdit />, rbaAdmin);
    expect(await screen.findByRole("heading", { name: "Set the first goal" })).toBeInTheDocument();
  });
});

describe("a cycle's details", () => {
  it("reads the name and dates in the header and opens them from a pencil", async () => {
    const user = userEvent.setup();
    const cycle = KLASIK.cycles[0];
    renderWithHub(<CyclePage />, admin, { path: `/gsr/cycles/${cycle.id}`, pattern: "/gsr/cycles/:cycleId" });
    expect(await screen.findByRole("heading", { level: 1, name: cycle.name })).toBeInTheDocument();
    const pencil = screen.getByRole("button", { name: "Edit cycle" });
    expect(pencil).toHaveAttribute("title", "Edit cycle");
    await user.click(pencil);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Name")).toHaveValue(cycle.name);
    expect(within(dialog).getByLabelText("Starts")).toHaveValue(cycle.period_start);
  });
});

describe("a deliverable line item", () => {
  it("names its target and actual fields after the deliverable", async () => {
    const review = RBA.reviews.find((r) => r.status === "in_progress")!;
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
    const label = "Jobs closed on schedule";
    expect(await screen.findByDisplayValue(label)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: `Target for ${label}` })).toHaveValue("10");
    expect(screen.getByRole("textbox", { name: `Actual for ${label}` })).toBeInTheDocument();
  });
});

describe("the Cycles page with nothing yet", () => {
  // A company with no cycles at all: its id matches no cycle in the mock store.
  const empty = makeHub("admin", { ...RBA.company, id: "co-no-cycles" });

  it.each([
    ["gsr" as const, "New month", "Open the first month"],
    ["reviews" as const, "New cycle", "Start the first review cycle"],
  ])("keeps one primary button on the %s section", async (section, label, title) => {
    renderWithHub(<CyclesPage section={section} />, empty);
    expect(await screen.findByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: new RegExp(label) })).toHaveLength(1);
  });

  it("shows the header button once there is a cycle", async () => {
    renderWithHub(<CyclesPage section="reviews" />, rbaAdmin);
    expect(await screen.findByText(RBA.cycles[0].name)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /New cycle/ })).toHaveLength(1);
  });
});
