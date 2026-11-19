// The role scorecard screens against the mocked data layer: the metrics editor on a job role (People, Roles), a
// person's scorecard, projects and division on their page, the Scorecards report, and the
// division split on the dashboard (shown only to the people allowed to see it). The fixtures are
// RBA's: Noor (Project Manager, North) and Avery (Site Superintendent, South) have results.
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
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import * as divisionsService from "../services/divisions.ts";
import * as scorecardsService from "../services/scorecards.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import type { HubValue } from "../context/HubContext.tsx";
import DashboardPage from "./DashboardPage.tsx";
import PersonPage from "./people/PersonPage.tsx";
import RolesPage from "./people/RolesPage.tsx";
import ScorecardsPage from "./gsr/ScorecardsPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
// Alex is an admin given the division view. The same admin without it, and as an owner.
const plainAdmin: HubValue = { ...rbaAdmin, profile: { ...rbaAdmin.profile, can_view_divisions: false } };
const rbaOwner: HubValue = { ...rbaAdmin, profile: { ...rbaAdmin.profile, role: "owner" } };
const rococo = makeHub("rococo", RBA.company);
const noor = RBA.profiles.find((p) => p.id === "rba-user-3")!;
const avery = RBA.profiles.find((p) => p.id === "rba-staff-invited")!;

// The person page on one of its tabs.
function personPage(hub: HubValue, id = noor.id, tab = "scorecard") {
  return renderWithHub(<PersonPage />, hub, { path: `/people/${id}/${tab}`, pattern: "/people/:profileId/:tab?" });
}

describe("role metrics editor", () => {
  it("lists a role's metrics, adds one, retires one, and explains a refused delete", async () => {
    const user = userEvent.setup();
    renderWithHub(<RolesPage />, rbaAdmin, { path: "/people/roles/rba-role-pm", pattern: "/people/roles/:roleId?" });
    const roles = await screen.findByRole("region", { name: "Job roles" });
    await user.click(await screen.findByRole("button", { name: "Edit metric Job cost: gross profit" }));
    expect(await screen.findByDisplayValue("Job cost: gross profit")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Per project for Job cost: gross profit" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Target for Job cost: gross profit" })).toHaveValue("30");
    await user.click(screen.getByRole("button", { name: "Done" }));

    // A metric with results cannot be deleted; the dialog says why and what to do instead.
    // Both scored roles have an Optimization rate; this is the Project Manager's.
    await user.click(screen.getByRole("button", { name: "Edit metric Optimization rate" }));
    await user.click(screen.getByRole("button", { name: "Delete metric Optimization rate" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete metric" }));
    expect(await within(dialog).findByText(/has results entered, so it cannot be deleted\. Untick Active to retire it instead/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByDisplayValue("Optimization rate").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Done" }));

    // The retired metric shows as retired, with Active unticked.
    await user.click(within(roles).getByRole("link", { name: /Site Superintendent/ }));
    const superMetrics = (await screen.findByRole("heading", { name: "Scorecard metrics" })).closest("section") as HTMLElement;
    expect(within(superMetrics).getByText("Retired", { selector: "span" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit metric Toolbox talks" }));
    expect(screen.getByRole("checkbox", { name: "Active for Toolbox talks" })).not.toBeChecked();

    // Add a rating metric to the Site Supervisor role, which had none.
    await user.click(within(roles).getByRole("link", { name: /Site Supervisor/ }));
    await screen.findByRole("heading", { level: 2, name: "Site Supervisor" });
    const supervisorMetrics = screen.getByRole("heading", { name: "Scorecard metrics" }).closest("section") as HTMLElement;
    await user.click(within(supervisorMetrics).getByRole("button", { name: /Add metric/ }));
    await user.type(screen.getByRole("textbox", { name: "Add a metric for Site Supervisor" }), "Client walk");
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind of new metric for Site Supervisor" }), "rating");
    await user.click(within(supervisorMetrics).getByRole("button", { name: /Add metric/ }));
    expect(await within(supervisorMetrics).findByText("Client walk")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit metric Client walk" }));
    expect(screen.getByRole("combobox", { name: "Scale for Client walk" })).toHaveValue("5");

    // Set a target, then retire it.
    const target = screen.getByRole("textbox", { name: "Target for Client walk" });
    await user.type(target, "4");
    fireEvent.blur(target);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Target for Client walk" })).toHaveValue("4"));
    await user.click(screen.getByRole("checkbox", { name: "Active for Client walk" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Active for Client walk" })).not.toBeChecked());
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(within(supervisorMetrics).getByText("Retired", { selector: "span" })).toBeInTheDocument();
    expect(within(supervisorMetrics).getByText(/Target 4/)).toBeInTheDocument();

    // One without results goes.
    await user.click(screen.getByRole("button", { name: "Edit metric Client walk" }));
    await user.click(screen.getByRole("button", { name: "Delete metric Client walk" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete metric" }));
    await waitFor(() => expect(screen.queryByText("Client walk")).not.toBeInTheDocument());
  });
});

describe("person scorecard", () => {
  it("shows each month against target and the year to date", async () => {
    personPage(rbaAdmin);
    const sep = await screen.findByRole("button", { name: "Optimization rate, September 2026: 85%, hit" });
    expect(within(sep).getByText("85%")).toHaveClass("text-success");
    expect(screen.getByRole("button", { name: "Optimization rate, July 2026: 76%, missed" })).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: "Optimization rate, July 2026: 76%, missed" })).getByText("76%")).toHaveClass("text-danger");
    expect(screen.getByLabelText("Optimization rate, year to date: 81%, hit")).toBeInTheDocument();
    // A rating reads against its scale; one with no target is shown but never judged.
    expect(screen.getByLabelText("Client journey satisfaction, year to date: 4.5 / 5, hit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compliance to SOPs, September 2026: 3 / 5" })).toBeInTheDocument();
    // The note shows under the grid.
    expect(screen.getByText("Two crews short for a week.")).toBeInTheDocument();
  });

  it("gives a per-project metric a combined row and a row per assigned project", async () => {
    personPage(rbaAdmin);
    // The combined row is read, never typed into.
    expect(await screen.findByLabelText("Job cost: gross profit, September 2026: 28.5%, missed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Job cost: gross profit, September 2026: 28.5%, missed" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Job cost: gross profit, Lakeside residence, September 2026: 31%, hit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Job cost: gross profit, Island cottage, September 2026: 26%, missed" })).toBeInTheDocument();
    expect(screen.getByLabelText("Job cost: gross profit, year to date: 28.3%, missed")).toBeInTheDocument();
  });

  it("lets an admin enter a month's result and a note, and shows what the database refuses", async () => {
    const user = userEvent.setup();
    personPage(rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Optimization rate, October 2026: no result" }));
    const editor = screen.getByRole("group", { name: "Entering Optimization rate, October 2026" });
    const result = within(editor).getByLabelText("Result");
    await user.type(result, "150");
    fireEvent.blur(result);
    expect(await within(editor).findByText("A percent is between 0 and 100.")).toBeInTheDocument();
    await user.clear(result);
    await user.type(result, "78");
    fireEvent.blur(result);
    expect(await screen.findByRole("button", { name: "Optimization rate, October 2026: 78%, missed" })).toBeInTheDocument();
    const note = within(editor).getByLabelText("Note");
    await user.type(note, "New starter on the crew.");
    fireEvent.blur(note);
    expect(await screen.findByText("New starter on the crew.", { selector: "li *, li" })).toBeInTheDocument();
    // Clear removes it.
    await user.click(within(editor).getByRole("button", { name: "Clear" }));
    expect(await screen.findByRole("button", { name: "Optimization rate, October 2026: no result" })).toBeInTheDocument();
  });

  it("changes year and reads an earlier one", async () => {
    const user = userEvent.setup();
    personPage(rbaAdmin);
    await user.selectOptions(await screen.findByRole("combobox", { name: "Scorecard year" }), "2025");
    expect(await screen.findByRole("button", { name: "Optimization rate, December 2025: 70%, missed" })).toBeInTheDocument();
  });

  it("shows the employee their own scorecard on the dashboard, read only", async () => {
    // Avery is in a scored role; the dashboard reads the same grid without the inputs.
    renderWithHub(<DashboardPage />, { ...makeHub("employee", RBA.company), profile: avery, isAdmin: false });
    expect(await screen.findByRole("heading", { name: "Your scorecard" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Optimization rate, September 2026: 91%, hit")).toBeInTheDocument();
    expect(screen.getByLabelText("Daily logs, year to date: 3.5 / 5, missed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Optimization rate, September 2026/ })).not.toBeInTheDocument();
  });

  it("leaves an employee in an unscored role without a scorecard card", async () => {
    renderWithHub(<DashboardPage />, makeHub("employee", RBA.company));
    expect(await screen.findByText(/Welcome back, Jamie/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Your scorecard" })).not.toBeInTheDocument());
  });
});

describe("person projects", () => {
  it("assigns an existing project, creates one by name, sets the role, and unassigns", async () => {
    const user = userEvent.setup();
    personPage(rbaAdmin);
    const section = (await screen.findByRole("heading", { name: "On 2 projects" })).closest("section") as HTMLElement;
    expect(within(section).getByText("Lakeside residence")).toBeInTheDocument();
    expect(within(section).getByRole("textbox", { name: "Role on Lakeside residence" })).toHaveValue("Project manager");

    await user.selectOptions(within(section).getByLabelText("Project"), "rba-project-3");
    await user.type(within(section).getByLabelText("Their role"), "Estimator");
    await user.click(within(section).getByRole("button", { name: /^Assign$/ }));
    expect(await within(section).findByRole("textbox", { name: "Role on Harbour house" })).toHaveValue("Estimator");
    // Assigning gives the per-project metric a row for it straight away.
    expect(screen.getByRole("button", { name: "Job cost: gross profit, Harbour house, September 2026: no result" })).toBeInTheDocument();

    await user.selectOptions(within(section).getByLabelText("Project"), "new");
    await user.type(within(section).getByRole("textbox", { name: "New project name" }), "Cedar lane");
    await user.click(within(section).getByRole("button", { name: /Create and assign/ }));
    expect(await within(section).findByText("Cedar lane")).toBeInTheDocument();

    const role = within(section).getByRole("textbox", { name: "Role on Island cottage" });
    await user.clear(role);
    await user.type(role, "Lead");
    fireEvent.blur(role);
    await waitFor(() => expect(within(section).getByRole("textbox", { name: "Role on Island cottage" })).toHaveValue("Lead"));

    await user.click(within(section).getByRole("button", { name: "Unassign Cedar lane" }));
    await waitFor(() => expect(within(section).queryByRole("textbox", { name: "Role on Cedar lane" })).not.toBeInTheDocument());
    // Unassigned, it is offered again.
    expect(within(section).getByRole("option", { name: "Cedar lane" })).toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "Unassign Harbour house" }));
    await waitFor(() => expect(within(section).queryByRole("textbox", { name: "Role on Harbour house" })).not.toBeInTheDocument());
  });
});

describe("person division", () => {
  it("lets an admin pick the division, without the access toggle", async () => {
    const user = userEvent.setup();
    personPage(rbaAdmin, avery.id, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    const group = await screen.findByRole("group", { name: "Divisions" });
    const south = within(group).getByRole("checkbox", { name: "RBA South" });
    const north = within(group).getByRole("checkbox", { name: "RBA North" });
    expect(south).toBeChecked();
    expect(north).not.toBeChecked();
    // Ticking North as well puts them in Both; unticking it puts them back in South only.
    await user.click(north);
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Divisions" })).getByRole("checkbox", { name: "RBA North" })).toBeChecked());
    expect(screen.getByText(/Works in: Both/)).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Divisions" })).getByRole("checkbox", { name: "RBA North" }));
    await waitFor(() => expect(within(screen.getByRole("group", { name: "Divisions" })).getByRole("checkbox", { name: "RBA North" })).not.toBeChecked());
    expect(screen.queryByRole("checkbox", { name: "Can view divisions" })).not.toBeInTheDocument();
  });

  it("gives an owner and Rococo the Can view divisions toggle", async () => {
    const user = userEvent.setup();
    const { unmount } = personPage(rbaOwner, avery.id, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    const toggle = await screen.findByRole("checkbox", { name: "Can view divisions" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Can view divisions" })).toBeChecked());
    await user.click(screen.getByRole("checkbox", { name: "Can view divisions" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Can view divisions" })).not.toBeChecked());
    unmount();
    personPage(rococo, avery.id, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit divisions and view access" }));
    expect(await screen.findByRole("checkbox", { name: "Can view divisions" })).toBeInTheDocument();
  });

  it("stays out of the way for a company with no divisions", async () => {
    const user = userEvent.setup();
    const klasikPerson = KLASIK.profiles[1];
    personPage(makeHub("owner"), klasikPerson.id, "setup");
    await user.click(await screen.findByRole("button", { name: "Edit job role" }));
    expect(await screen.findByLabelText("Job role")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("group", { name: "Divisions" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Edit divisions and view access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Can view divisions" })).not.toBeInTheDocument();
  });
});

describe("Scorecards report", () => {
  it("lists everyone by role with the month against target and the year to date", async () => {
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    expect(await screen.findByRole("heading", { name: "Scorecards" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Noor Haddad, Optimization rate, September 2026: 85%, hit; year to date 81%, hit")).toBeInTheDocument();
    expect(screen.getByLabelText("Avery Cole, Daily logs, September 2026: 3 / 5, missed; year to date 3.5 / 5, missed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Noor Haddad" })).toHaveAttribute("href", `/people/${noor.id}`);
    // Jamie's role has no metrics, and Alex, Harper Quinn's team and Morgan Reyes have no role: all
    // are still listed.
    const unscored = screen.getByRole("heading", { name: "6 people" }).closest("section") as HTMLElement;
    expect(within(unscored).getByRole("link", { name: "Jamie Fox" })).toBeInTheDocument();
    expect(within(unscored).getByRole("link", { name: "Alex Morgan" })).toBeInTheDocument();
  });

  it("offers only roles that have people, and shows just the chosen role's block", async () => {
    const user = userEvent.setup();
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    const select = await screen.findByLabelText("Job role");
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toBe("All roles");
    expect(options).toContain("Site Superintendent");
    // Jamie's role has no metrics, so it has no block and is not offered.
    expect(options).not.toContain("Site Supervisor");
    expect(screen.getByRole("heading", { name: "Site Superintendent" })).toBeInTheDocument();
    await user.selectOptions(select, "Site Superintendent");
    expect(screen.queryByRole("link", { name: "Noor Haddad" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Avery Cole" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).filter((h) => options.includes(h.textContent))).toHaveLength(1);
    // The other role's block is gone with its column headings, not only its heading.
    expect(screen.queryByRole("heading", { name: "Project Manager" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Job cost: gross profit/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Daily logs/ })).toBeInTheDocument();
    await user.selectOptions(select, "All roles");
    expect(screen.getByRole("link", { name: "Noor Haddad" })).toBeInTheDocument();
  });

  it("hides the role select when only one role has people in view", async () => {
    const user = userEvent.setup();
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    await screen.findByLabelText("Job role");
    await user.click(within(screen.getByRole("group", { name: "Division" })).getByRole("button", { name: "RBA North" }));
    expect(screen.queryByLabelText("Job role")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Manager" })).toBeInTheDocument();
  });

  it("leaves out a role that has metrics but nobody in view, and falls back to all roles when the chosen one empties", async () => {
    const user = userEvent.setup();
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    await screen.findByLabelText("Job role");
    // Avery, the only Site Superintendent, works in RBA South. In RBA North nobody holds that role.
    const division = screen.getByRole("group", { name: "Division" });
    await user.click(within(division).getByRole("button", { name: "RBA North" }));
    // Only one role is left in view, so there is nothing to choose between and the select steps aside.
    expect(screen.queryByLabelText("Job role")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Site Superintendent" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Project Manager" })).toBeInTheDocument();
    // Choose Site Superintendent in the whole company, then move to a division it is not in.
    await user.click(within(division).getByRole("button", { name: "Combined" }));
    await user.selectOptions(screen.getByLabelText("Job role"), "Site Superintendent");
    expect(screen.queryByRole("heading", { name: "Project Manager" })).not.toBeInTheDocument();
    await user.click(within(division).getByRole("button", { name: "RBA North" }));
    expect(screen.getByRole("heading", { name: "Project Manager" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Noor Haddad" })).toBeInTheDocument();
    // Back in the whole company the choice, which was only set aside, applies again.
    await user.click(within(division).getByRole("button", { name: "Combined" }));
    expect((screen.getByLabelText("Job role") as HTMLSelectElement).value).toBe("rba-role-super");
    expect(screen.queryByRole("heading", { name: "Project Manager" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Job role"), "All roles");
    expect(screen.getByRole("heading", { name: "Project Manager" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Site Superintendent" })).toBeInTheDocument();
  });

  it("reads People in the page label and gives each role block its own column headings", async () => {
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    expect(await screen.findByText("People", { selector: "p.eyebrow" })).toBeInTheDocument();
    const block = screen.getByRole("heading", { name: "Site Superintendent" }).closest("table") as HTMLElement;
    expect(within(block).getByRole("columnheader", { name: /Daily logs/ })).toBeInTheDocument();
    const pm = screen.getByRole("heading", { name: "Project Manager" }).closest("table") as HTMLElement;
    expect(within(pm).queryByRole("columnheader", { name: /Daily logs/ })).not.toBeInTheDocument();
  });

  it("moves to another month", async () => {
    const user = userEvent.setup();
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    await screen.findByLabelText("Job role");
    await user.selectOptions(screen.getByLabelText("Month"), "2026-08-01");
    expect(await screen.findByLabelText("Avery Cole, Optimization rate, August 2026: 88%, missed; year to date 90.3%, hit")).toBeInTheDocument();
  });

  it("gives someone allowed the division switch and the compare strip", async () => {
    const user = userEvent.setup();
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    const strip = await screen.findByRole("region", { name: "Division compare" });
    expect(within(within(strip).getByRole("listitem", { name: "Combined" })).getByText("88%")).toBeInTheDocument();
    expect(within(within(strip).getByRole("listitem", { name: "RBA South" })).getByText("91%")).toBeInTheDocument();
    expect(within(within(strip).getByRole("listitem", { name: "RBA North" })).getByText("85%")).toBeInTheDocument();
    const division = screen.getByRole("group", { name: "Division" });
    await user.click(within(division).getByRole("button", { name: "RBA North" }));
    expect(screen.getByRole("link", { name: "Noor Haddad" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Avery Cole" })).not.toBeInTheDocument();
  });

  it("hides the division switch and the strip from an admin without access", async () => {
    const spy = vi.spyOn(divisionsService, "listDivisions");
    renderWithHub(<ScorecardsPage />, plainAdmin);
    expect(await screen.findByLabelText(/^Noor Haddad, Optimization rate, September 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Division" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Division compare" })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("points a company with no metrics to the job roles", async () => {
    renderWithHub(<ScorecardsPage />, makeHub("admin"));
    expect(await screen.findByRole("heading", { name: "No scorecard metrics yet" })).toBeInTheDocument();
  });
});

describe("dashboard division split", () => {
  function peopleTile() {
    return screen.getByText("People", { selector: "p" }).parentElement as HTMLElement;
  }

  it("narrows the people tiles to a division and shows the compare strip", async () => {
    const user = userEvent.setup();
    renderWithHub(<DashboardPage />, rbaAdmin);
    const division = await screen.findByRole("group", { name: "Division" });
    expect(screen.getByRole("region", { name: "Division compare" })).toBeInTheDocument();
    expect(within(peopleTile()).getByText("8")).toBeInTheDocument();
    // Noor, Kai Bennett, and Rowan Ellis, who works in both divisions and so counts in each.
    await user.click(within(division).getByRole("button", { name: "RBA North" }));
    expect(within(peopleTile()).getByText("3")).toBeInTheDocument();
    await user.click(within(division).getByRole("button", { name: "Combined" }));
    expect(within(peopleTile()).getByText("8")).toBeInTheDocument();
  });

  it("is unchanged for an admin without division access, and reads nothing for it", async () => {
    const divisionsSpy = vi.spyOn(divisionsService, "listDivisions");
    const entriesSpy = vi.spyOn(scorecardsService, "listMetricEntries");
    renderWithHub(<DashboardPage />, plainAdmin);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    await waitFor(() => expect(within(peopleTile()).getByText("8")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Division" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Division compare" })).not.toBeInTheDocument();
    expect(divisionsSpy).not.toHaveBeenCalled();
    expect(entriesSpy).not.toHaveBeenCalled();
    divisionsSpy.mockRestore();
    entriesSpy.mockRestore();
  });
});
