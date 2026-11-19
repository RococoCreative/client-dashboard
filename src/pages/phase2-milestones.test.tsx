// Phase 2 milestone status: a milestone is Not started, In progress or Complete (0043), and its
// status and completed-on date stay in step. Someone who may edit milestones picks the status from
// a select, and completing dates it today in the company's zone; everyone else reads it as text.
// The project page filters to open or done items, and a milestone completed and then reopened
// leaves the project list's count where it started.
// A company's standard milestones (0044): Projects > Setup, for a company with the module,
// lists the milestones and letters every new project starts with, in order, to add, rename, mark
// as a letter, reorder and remove.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

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
vi.mock("../services/milestoneTemplates.ts", () => import("../test/mocks/milestoneTemplates.ts"));

import ProjectPage from "./production/ProjectPage.tsx";
import ProductionPage from "./production/ProductionPage.tsx";
import * as projectsService from "../services/projects.ts";
import App from "../App.tsx";
import ProductionSetupPage from "./production/ProductionSetupPage.tsx";
import * as templatesService from "../services/milestoneTemplates.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { KINGDOM, makeHub } from "../test/fixtures.ts";

const kingdomAdmin = makeHub("admin", KINGDOM.company);
const kingdomEmployee = makeHub("employee", KINGDOM.company);
const job101 = { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" };
const job102 = { path: "/production/projects/kingdom-project-2", pattern: "/production/projects/:projectId" };
// The suite's clock is 2026-09-15 12:00 UTC (src/test/setup.ts), which is Sep 15 in Kingdom's zone.
const TODAY = "2026-09-15";

const rowOf = (title: string) => screen.getByText(title).closest("li") as HTMLElement;
// An editable item, found by its live status select (its title reads as text until opened).
const editRowOf = (title: string) => screen.getByRole("combobox", { name: `Status of ${title}` }).closest("li") as HTMLElement;
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
    // No status badge reads "Open" (the Open filter chip draws its label in a span inside its button).
    expect(screen.queryAllByText("Open", { selector: "span" }).filter((el) => !el.closest("button"))).toEqual([]);
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

describe("standard milestones in Projects, Setup", () => {
  const kingdom = KINGDOM.company.id;
  const production = { path: "/production/setup", pattern: "/production/setup" };
  // Rows read first, so the order is read off each row's down arrow, which shows whether or not the row is open.
  const titles = () => screen.getAllByRole("button", { name: /^Move .* down$/ }).map((el) => el.getAttribute("aria-label")!.replace(/^Move (.*) down$/, "$1"));
  const open = async (user: ReturnType<typeof userEvent.setup>, title: string) => user.click(await screen.findByRole("button", { name: `Edit ${title}` }));

  it("Projects shows a Setup tab only to an admin, and /production/setup is closed to a company without the module", async () => {
    const view = renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
    const nav = await screen.findByRole("navigation", { name: "Projects" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Projects", "Setup"]);
    view.unmount();

    // Opened by address at a company without the module, it lands Home, as any module-gated page does.
    window.history.pushState({}, "", "/production/setup?persona=admin&company=klasik");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("heading", { name: "Standard milestones" })).toBeNull();
  });

  it("an empty list explains what it is for", async () => {
    renderWithHub(<ProductionSetupPage />, kingdomAdmin, production);
    expect(await screen.findByText("No standard milestones yet. Add the checkpoints every project should start with.")).toBeInTheDocument();
  });

  it("says plainly that the list applies to projects created from now on", async () => {
    renderWithHub(<ProductionSetupPage />, kingdomAdmin, production);
    expect(await screen.findByText("Every new project starts with these. Projects that already exist keep the milestones they have.")).toBeInTheDocument();
  });

  describe("with rows", () => {
    beforeAll(async () => {
      // Created out of order, so the list has to read sort_order rather than when a row was added.
      await templatesService.createMilestoneTemplate(kingdom, { title: "Sample step B", kind: "milestone", sort_order: 2 });
      await templatesService.createMilestoneTemplate(kingdom, { title: "Sample step A", kind: "milestone", sort_order: 1 });
      await templatesService.createMilestoneTemplate(kingdom, { title: "Sample step C", kind: "milestone", sort_order: 3 });
    });

    it("lists the standard milestones in order and adds one at the end", async () => {
      const create = vi.spyOn(templatesService, "createMilestoneTemplate");
      onTestFinished(() => create.mockRestore());
      const user = userEvent.setup();
      renderWithHub(<ProductionSetupPage />, kingdomAdmin, production);
      await screen.findByRole("button", { name: "Edit Sample step A" });
      expect(titles()).toEqual(["Sample step A", "Sample step B", "Sample step C"]);

      await user.type(screen.getByLabelText("New standard milestone title"), "Sample step D");
      await user.click(screen.getByRole("button", { name: "Add" }));
      expect(create).toHaveBeenCalledWith(kingdom, { title: "Sample step D", kind: "milestone", sort_order: 4 });
      await screen.findByRole("button", { name: "Edit Sample step D" });
      expect(titles()).toEqual(["Sample step A", "Sample step B", "Sample step C", "Sample step D"]);
      expect((screen.getByLabelText("New standard milestone title") as HTMLInputElement).value).toBe("");
    });

    it("marks a row as a letter", async () => {
      const update = vi.spyOn(templatesService, "updateMilestoneTemplate");
      onTestFinished(() => update.mockRestore());
      const user = userEvent.setup();
      renderWithHub(<ProductionSetupPage />, kingdomAdmin, production);
      await open(user, "Sample step B");
      const kind = (await screen.findByRole("combobox", { name: "Kind of Sample step B" })) as HTMLSelectElement;
      expect(kind.value).toBe("milestone");
      await user.selectOptions(kind, "Letter");
      expect(update).toHaveBeenLastCalledWith(expect.any(String), { kind: "letter" });
      await waitFor(() => expect((screen.getByRole("combobox", { name: "Kind of Sample step B" }) as HTMLSelectElement).value).toBe("letter"));
      expect((await templatesService.listMilestoneTemplates(kingdom)).find((t) => t.title === "Sample step B")?.kind).toBe("letter");
    });

    it("renames on blur, reorders with the arrows, and removes after a confirm", async () => {
      const user = userEvent.setup();
      renderWithHub(<ProductionSetupPage />, kingdomAdmin, production);
      await open(user, "Sample step C");
      const title = await screen.findByLabelText("Title of Sample step C");
      fireEvent.change(title, { target: { value: "Sample step C, renamed" } });
      fireEvent.blur(title);
      await screen.findByLabelText("Title of Sample step C, renamed");
      expect((await templatesService.listMilestoneTemplates(kingdom)).map((t) => t.title)).toContain("Sample step C, renamed");

      await user.click(screen.getByRole("button", { name: "Move Sample step C, renamed up" }));
      await waitFor(() => expect(titles()).toEqual(["Sample step A", "Sample step C, renamed", "Sample step B", "Sample step D"]));
      await user.click(screen.getByRole("button", { name: "Move Sample step A down" }));
      await waitFor(() => expect(titles()).toEqual(["Sample step C, renamed", "Sample step A", "Sample step B", "Sample step D"]));
      expect((await templatesService.listMilestoneTemplates(kingdom)).map((t) => t.title)).toEqual(["Sample step C, renamed", "Sample step A", "Sample step B", "Sample step D"]);

      await open(user, "Sample step B");
      await user.click(screen.getByRole("button", { name: "Remove Sample step B" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText(/Projects that already have it keep it/)).toBeInTheDocument();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.getByLabelText("Title of Sample step B")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Remove Sample step B" }));
      await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
      await waitFor(() => expect(screen.queryByLabelText("Title of Sample step B")).toBeNull());
      expect(titles()).toEqual(["Sample step C, renamed", "Sample step A", "Sample step D"]);
      expect((await templatesService.listMilestoneTemplates(kingdom)).map((t) => t.title)).toEqual(["Sample step C, renamed", "Sample step A", "Sample step D"]);
    });
  });
});

// Last in the file: it adds a project to the shared mock store.
describe("a new project's row", () => {
  it("shows the standard milestones the database copied onto it, not 0 of 0", async () => {
    const standard = (await templatesService.listMilestoneTemplates(KINGDOM.company.id)).length;
    expect(standard).toBeGreaterThan(0);
    const user = userEvent.setup();
    renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
    await screen.findByRole("link", { name: "Sample job 101" });
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Name"), "Sample job 900");
    await user.click(screen.getByRole("button", { name: "Add project" }));
    const row = (await screen.findByRole("link", { name: "Sample job 900" })).closest("tr") as HTMLElement;
    await waitFor(() => expect(within(row).getByText(`0 of ${standard} done`)).toBeInTheDocument());
  });

  it("when the re-read fails the project stays listed once, a plain line shows, and it was created once", async () => {
    const create = vi.spyOn(projectsService, "createProject");
    const reread = vi.spyOn(projectsService, "listCompanyMilestones");
    onTestFinished(() => { create.mockRestore(); reread.mockRestore(); });
    const user = userEvent.setup();
    renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
    await screen.findByRole("link", { name: "Sample job 101" });
    reread.mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: "New project" }));
    await user.type(screen.getByLabelText("Name"), "Sample job 901");
    await user.click(screen.getByRole("button", { name: "Add project" }));
    expect(await screen.findByText("The project was added. Reload to see its milestones.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Sample job 901" })).toHaveLength(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
