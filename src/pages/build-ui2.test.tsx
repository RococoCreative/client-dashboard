// The role scorecard screens against the mocked data layer: the metrics editor on a job role, a
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

import { renderWithHub } from "../test/renderWithHub.tsx";
import * as divisionsService from "../services/divisions.ts";
import * as scorecardsService from "../services/scorecards.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import type { HubValue } from "../context/HubContext.tsx";
import JobRolesPanel from "../components/settings/JobRolesPanel.tsx";
import DashboardPage from "./DashboardPage.tsx";
import PersonPage from "./people/PersonPage.tsx";
import ScorecardsPage from "./gsr/ScorecardsPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
// Alex is an admin given the division view. The same admin without it, and as an owner.
const plainAdmin: HubValue = { ...rbaAdmin, profile: { ...rbaAdmin.profile, can_view_divisions: false } };
const rbaOwner: HubValue = { ...rbaAdmin, profile: { ...rbaAdmin.profile, role: "owner" } };
const rococo = makeHub("rococo", RBA.company);
const noor = RBA.profiles.find((p) => p.id === "rba-user-3")!;
const avery = RBA.profiles.find((p) => p.id === "rba-staff-invited")!;

function personPage(hub: HubValue, id = noor.id) {
  return renderWithHub(<PersonPage />, hub, { path: `/people/${id}`, pattern: "/people/:profileId" });
}

describe("role metrics editor", () => {
  it("lists a role's metrics, adds one, retires one, and explains a refused delete", async () => {
    const user = userEvent.setup();
    renderWithHub(<JobRolesPanel companyId={RBA.company.id} />, rbaAdmin);
    expect(await screen.findByDisplayValue("Job cost: gross profit")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Per project for Job cost: gross profit" })).toBeChecked();
    expect(screen.getByRole("textbox", { name: "Target for Job cost: gross profit" })).toHaveValue("30");
    // The retired metric shows as retired, with Active unticked.
    expect(screen.getByRole("checkbox", { name: "Active for Toolbox talks" })).not.toBeChecked();

    // Add a rating metric to the Site Supervisor role, which had none.
    await user.type(screen.getByRole("textbox", { name: "Add a metric for Site Supervisor" }), "Client walk");
    await user.selectOptions(screen.getByRole("combobox", { name: "Kind of new metric for Site Supervisor" }), "rating");
    const supervisorCard = screen.getByRole("textbox", { name: "Add a metric for Site Supervisor" }).closest("li") as HTMLElement;
    await user.click(within(supervisorCard).getByRole("button", { name: /Add metric/ }));
    expect(await screen.findByDisplayValue("Client walk")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Scale for Client walk" })).toHaveValue("5");

    // Set a target, then retire it.
    const target = screen.getByRole("textbox", { name: "Target for Client walk" });
    await user.type(target, "4");
    fireEvent.blur(target);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Target for Client walk" })).toHaveValue("4"));
    await user.click(screen.getByRole("checkbox", { name: "Active for Client walk" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Active for Client walk" })).not.toBeChecked());
    expect(within(supervisorCard).getByText("Retired", { selector: "span" })).toBeInTheDocument();

    // A metric with results cannot be deleted; the dialog says why and what to do instead.
    // Both scored roles have an Optimization rate; the first is the Project Manager's.
    await user.click(screen.getAllByRole("button", { name: "Delete metric Optimization rate" })[0]);
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete metric" }));
    expect(await within(dialog).findByText(/has results entered, so it cannot be deleted\. Untick Active to retire it instead/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getAllByDisplayValue("Optimization rate").length).toBeGreaterThan(0);

    // One without results goes.
    await user.click(screen.getByRole("button", { name: "Delete metric Client walk" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete metric" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Client walk")).not.toBeInTheDocument());
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
    personPage(rbaAdmin, avery.id);
    const picker = await screen.findByRole("combobox", { name: "Division" });
    expect(picker).toHaveValue("rba-division-south");
    await user.selectOptions(picker, "rba-division-north");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Division" })).toHaveValue("rba-division-north"));
    await user.selectOptions(screen.getByRole("combobox", { name: "Division" }), "rba-division-south");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Division" })).toHaveValue("rba-division-south"));
    expect(screen.queryByRole("checkbox", { name: "Can view divisions" })).not.toBeInTheDocument();
  });

  it("gives an owner and Rococo the Can view divisions toggle", async () => {
    const user = userEvent.setup();
    const { unmount } = personPage(rbaOwner, avery.id);
    const toggle = await screen.findByRole("checkbox", { name: "Can view divisions" });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Can view divisions" })).toBeChecked());
    await user.click(screen.getByRole("checkbox", { name: "Can view divisions" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Can view divisions" })).not.toBeChecked());
    unmount();
    personPage(rococo, avery.id);
    expect(await screen.findByRole("checkbox", { name: "Can view divisions" })).toBeInTheDocument();
  });

  it("stays out of the way for a company with no divisions", async () => {
    const klasikPerson = KLASIK.profiles[1];
    personPage(makeHub("owner"), klasikPerson.id);
    expect(await screen.findByLabelText("Job role")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Division" })).not.toBeInTheDocument());
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
    // Jamie's role has no metrics, and Alex has no role: both are still listed.
    const unscored = screen.getByRole("heading", { name: "2 people" }).closest("section") as HTMLElement;
    expect(within(unscored).getByRole("link", { name: "Jamie Fox" })).toBeInTheDocument();
    expect(within(unscored).getByRole("link", { name: "Alex Morgan" })).toBeInTheDocument();
  });

  it("filters by role and moves to another month", async () => {
    const user = userEvent.setup();
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    const roles = await screen.findByRole("group", { name: "Job role" });
    await user.click(within(roles).getByRole("button", { name: "Site Superintendent" }));
    expect(screen.queryByRole("link", { name: "Noor Haddad" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Avery Cole" })).toBeInTheDocument();
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
    expect(within(peopleTile()).getByText("4")).toBeInTheDocument();
    await user.click(within(division).getByRole("button", { name: "RBA North" }));
    expect(within(peopleTile()).getByText("1")).toBeInTheDocument();
    await user.click(within(division).getByRole("button", { name: "Combined" }));
    expect(within(peopleTile()).getByText("4")).toBeInTheDocument();
  });

  it("is unchanged for an admin without division access, and reads nothing for it", async () => {
    const divisionsSpy = vi.spyOn(divisionsService, "listDivisions");
    const entriesSpy = vi.spyOn(scorecardsService, "listMetricEntries");
    renderWithHub(<DashboardPage />, plainAdmin);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    await waitFor(() => expect(within(peopleTile()).getByText("4")).toBeInTheDocument());
    expect(screen.queryByRole("group", { name: "Division" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Division compare" })).not.toBeInTheDocument();
    expect(divisionsSpy).not.toHaveBeenCalled();
    expect(entriesSpy).not.toHaveBeenCalled();
    divisionsSpy.mockRestore();
    entriesSpy.mockRestore();
  });
});
