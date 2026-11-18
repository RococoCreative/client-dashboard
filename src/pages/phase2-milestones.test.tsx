// Phase 2 milestone status: a milestone is Not started, In progress or Complete (0043), and its
// status and completed-on date stay in step. Someone who may edit milestones picks the status from
// a select, and completing dates it today in the company's zone; everyone else reads it as text.
// The project page filters to open or done items, and a milestone completed and then reopened
// leaves the project list's count where it started.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";

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
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import ProjectPage from "./production/ProjectPage.tsx";
import ProductionPage from "./production/ProductionPage.tsx";
import * as projectsService from "../services/projects.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { KINGDOM, makeHub } from "../test/fixtures.ts";

const kingdomAdmin = makeHub("admin", KINGDOM.company);
const kingdomEmployee = makeHub("employee", KINGDOM.company);
const job101 = { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" };
const job102 = { path: "/production/projects/kingdom-project-2", pattern: "/production/projects/:projectId" };
// The suite's clock is 2026-09-15 12:00 UTC (src/test/setup.ts), which is Sep 15 in Kingdom's zone.
const TODAY = "2026-09-15";

const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
const editRowOf = (title: string) => screen.getByLabelText(`Title of ${title}`).closest("li") as HTMLElement;
const badge = (row: HTMLElement, text: string) => within(row).queryByText(text, { selector: "span" });

// The done-of-total count the project list shows (milestoneCounts), read and then put away.
async function countFor(project: string): Promise<string> {
  const view = renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
  const row = (await screen.findByRole("link", { name: project })).closest("tr") as HTMLElement;
  const text = within(row).getByText(/ of \d+ done$/).textContent ?? "";
  view.unmount();
  return text;
}

// Read-only cases first, then the saves, because the mock store is shared across the file.
describe("milestone status", () => {
  it("shows Not started, In progress, or Complete with its date", async () => {
    renderWithHub(<ProjectPage />, kingdomEmployee, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    expect(badge(rowOf("Contract signed"), "Complete Jul 30, 2026")).toBeInTheDocument();
    expect(badge(rowOf("Welcome letter sent"), "Complete Aug 4, 2026")).toBeInTheDocument();
    expect(badge(rowOf("Framing complete"), "In progress")).toBeInTheDocument();
    expect(badge(rowOf("Final walkthrough"), "Not started")).toBeInTheDocument();
    expect(screen.queryByText("Open", { selector: "span" })).toBeNull();
  });

  it("someone who may not edit sees the status as text and no select", async () => {
    renderWithHub(<ProjectPage />, kingdomEmployee, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    expect(screen.queryByRole("combobox", { name: /^Status of / })).toBeNull();
    expect(screen.queryByLabelText(/^Completed on for /)).toBeNull();
    expect(badge(rowOf("Framing complete"), "In progress")).toBeInTheDocument();
  });

  it("the Open filter shows Not started and In progress; the Done filter shows Complete", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    const show = screen.getByRole("group", { name: "Show" });

    await user.click(within(show).getByRole("button", { name: "Open" }));
    expect(within(show).getByRole("button", { name: "Open" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Framing complete")).toBeInTheDocument();
    expect(screen.getByText("Final walkthrough")).toBeInTheDocument();
    expect(screen.queryByText("Contract signed")).toBeNull();
    expect(screen.queryByText("Welcome letter sent")).toBeNull();
    expect(screen.getByText("2 items")).toBeInTheDocument();

    await user.click(within(show).getByRole("button", { name: "Done" }));
    expect(screen.getByText("Contract signed")).toBeInTheDocument();
    expect(screen.getByText("Welcome letter sent")).toBeInTheDocument();
    expect(screen.queryByText("Framing complete")).toBeNull();
    expect(screen.queryByText("Final walkthrough")).toBeNull();
    // A filtered list reads, the same as the kind filters.
    expect(screen.getByText("Switch to All to edit or reorder.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Status of / })).toBeNull();
  });

  it("a person who may edit picks a status from a select; picking Complete shows today's completed date after the save", async () => {
    const update = vi.spyOn(projectsService, "updateMilestone");
    onTestFinished(() => update.mockRestore());
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    const status = screen.getByRole("combobox", { name: "Status of Permit approved" }) as HTMLSelectElement;
    expect(status.value).toBe("not_started");
    expect(within(status).getAllByRole("option").map((o) => o.textContent)).toEqual(["Not started", "In progress", "Complete"]);

    await user.selectOptions(status, "In progress");
    await waitFor(() => expect(badge(editRowOf("Permit approved"), "In progress")).toBeInTheDocument());

    await user.selectOptions(status, "Complete");
    expect(update).toHaveBeenLastCalledWith(expect.any(String), { status: "complete" });
    // The date is the one the save returned, filled in by the database, not typed here.
    expect(await within(editRowOf("Permit approved")).findByText("Complete Sep 15, 2026", { selector: "span" })).toBeInTheDocument();
    expect((screen.getByLabelText("Completed on for Permit approved") as HTMLInputElement).value).toBe(TODAY);
    expect(status.value).toBe("complete");
  });

  it("clearing the completed date puts the milestone back to Not started", async () => {
    renderWithHub(<ProjectPage />, kingdomAdmin, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    const done = screen.getByLabelText("Completed on for Permit approved") as HTMLInputElement;
    expect(done.value).toBe(TODAY);
    fireEvent.change(done, { target: { value: "" } });
    fireEvent.blur(done);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Status of Permit approved" }) as HTMLSelectElement).value).toBe("not_started"));
    expect(badge(editRowOf("Permit approved"), "Not started")).toBeInTheDocument();
    expect(badge(editRowOf("Permit approved"), "Complete Sep 15, 2026")).toBeNull();
  });

  it("typing a completed date marks the milestone Complete", async () => {
    renderWithHub(<ProjectPage />, kingdomAdmin, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    const done = screen.getByLabelText("Completed on for Foundation poured");
    fireEvent.change(done, { target: { value: "2026-09-14" } });
    fireEvent.blur(done);
    expect(await within(editRowOf("Foundation poured")).findByText("Complete Sep 14, 2026", { selector: "span" })).toBeInTheDocument();
    expect((screen.getByRole("combobox", { name: "Status of Foundation poured" }) as HTMLSelectElement).value).toBe("complete");
  });

  it("a milestone completed and then reopened clears its date, and the project list's count agrees each time", async () => {
    const user = userEvent.setup();
    const before = await countFor("Sample job 101");
    expect(before).toBe("2 of 4 done");

    const view = renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    const status = screen.getByRole("combobox", { name: "Status of Final walkthrough" }) as HTMLSelectElement;
    await user.selectOptions(status, "Complete");
    await within(editRowOf("Final walkthrough")).findByText("Complete Sep 15, 2026", { selector: "span" });
    view.unmount();
    expect(await countFor("Sample job 101")).toBe("3 of 4 done");

    const again = renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    await user.selectOptions(screen.getByRole("combobox", { name: "Status of Final walkthrough" }), "In progress");
    await waitFor(() => expect((screen.getByLabelText("Completed on for Final walkthrough") as HTMLInputElement).value).toBe(""));
    expect(badge(editRowOf("Final walkthrough"), "In progress")).toBeInTheDocument();
    again.unmount();
    expect(await countFor("Sample job 101")).toBe(before);
  });
});
