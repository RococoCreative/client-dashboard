// Pay, company settings and the change log on screen: an admin without the pay capability never
// requests or sees compensation, an admin without company_settings has no Company tab and is sent to
// the first tab they may open (through the real router, so a redirect loop would show), a company
// with audit_log for admins gets an Activity tab that asks for its own events only, and the Rococo
// activity page still lists every company. These render real pages; the provider tests live in
// capabilities.test.tsx, which swaps the app shell for a probe.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, onTestFinished } from "vitest";

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

import App from "../App.tsx";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { AUDIT_EVENTS, KINGDOM, makeHub } from "../test/fixtures.ts";
import { setMockCapabilities } from "../test/mocks/capabilities.ts";
import * as auditService from "../services/audit.ts";
import * as companiesService from "../services/companies.ts";
import * as profilesService from "../services/profiles.ts";
import * as employeesService from "../services/employees.ts";
import * as projectAssignmentsService from "../services/projectAssignments.ts";
import * as winsService from "../services/wins.ts";
import ProductionPage from "./production/ProductionPage.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import WinsPage from "./WinsPage.tsx";
import PersonProjects from "../components/people/PersonProjects.tsx";
import PersonPage from "./people/PersonPage.tsx";
import PeoplePage from "./people/PeoplePage.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";
import ActivityPage from "./rococo/ActivityPage.tsx";
import { SETTINGS_TABS, settingsTabsFor } from "./settings/settingsTabs.ts";

const kingdom = KINGDOM.company.id;
const adminHub = makeHub("admin", KINGDOM.company);
const ownerHub = makeHub("owner", KINGDOM.company);
// The person page on one of its tabs: Scorecard holds the financial figures and projects, Setup the pay.
const personAt = (tab: string) => ({ path: `/people/kingdom-user-1/${tab}`, pattern: "/people/:profileId/:tab?" });
const person = personAt("scorecard");

describe("an admin without the pay capability", () => {
  function withoutPay() {
    setMockCapabilities(kingdom, { pay: "owner" });
    const compensation = vi.spyOn(employeesService, "listCompensation");
    const financials = vi.spyOn(employeesService, "listEmployeeFinancials");
    onTestFinished(() => {
      compensation.mockRestore();
      financials.mockRestore();
    });
    return { compensation, financials };
  }

  it("does not request compensation", async () => {
    const { compensation } = withoutPay();
    renderWithHub(<PersonPage />, adminHub, person);
    expect(await screen.findByRole("heading", { name: "Financial figures" })).toBeInTheDocument();
    expect(compensation).not.toHaveBeenCalled();
  });

  it("shows no Annual compensation figure and no compensation table", async () => {
    withoutPay();
    renderWithHub(<PersonPage />, adminHub, personAt("setup"));
    await screen.findByRole("heading", { name: "Role and divisions" });
    expect(screen.queryByText("Annual compensation")).toBeNull();
    expect(screen.queryByText("Not recorded")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Compensation" })).toBeNull();
    expect(screen.queryByText("Total compensation")).toBeNull();
  });

  it("still shows the person's financial figures", async () => {
    const { financials } = withoutPay();
    renderWithHub(<PersonPage />, adminHub, person);
    expect(await screen.findByRole("heading", { name: "Financial figures" })).toBeInTheDocument();
    expect(financials).toHaveBeenCalled();
  });

  it("is not told on the People page that they set compensation", async () => {
    withoutPay();
    renderWithHub(<PeoplePage />, adminHub, { path: "/people", pattern: "/people" });
    expect(await screen.findByText(/set their goals and KPIs, and it is all waiting/)).toBeInTheDocument();
    expect(screen.queryByText(/compensation/)).toBeNull();
  });
});

it("an admin with pay is told on the People page that they set compensation", async () => {
  renderWithHub(<PeoplePage />, adminHub, { path: "/people", pattern: "/people" });
  expect(await screen.findByText(/set their goals, KPIs and compensation, and it is all waiting/)).toBeInTheDocument();
});

it("an owner still sees compensation", async () => {
  setMockCapabilities(kingdom, { pay: "owner" });
  const compensation = vi.spyOn(employeesService, "listCompensation");
  onTestFinished(() => compensation.mockRestore());
  renderWithHub(<PersonPage />, ownerHub, personAt("setup"));
  expect(await screen.findByText("Annual compensation")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Compensation" })).toBeInTheDocument();
  expect(compensation).toHaveBeenCalled();
});

describe("an admin without company_settings", () => {
  function signInThrough(path: string) {
    setMockCapabilities(kingdom, { company_settings: "owner" });
    window.history.pushState({}, "", `${path}?persona=admin&company=kingdom`);
    render(<App />);
  }

  it("has no Company tab", async () => {
    setMockCapabilities(kingdom, { company_settings: "owner" });
    renderWithHub(<SettingsPage tab="connections" />, adminHub, { path: "/settings/connections", pattern: "/settings/connections" });
    const nav = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Connections"]);
    expect(within(nav).queryByRole("link", { name: "Company" })).toBeNull();
    expect(settingsTabsFor(adminHub.can).map((t) => t.key)).toEqual(["connections"]);
  });

  it("lands on Connections from /settings", async () => {
    signInThrough("/settings");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/connections"));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("is sent to Connections from /settings/company", async () => {
    signInThrough("/settings/company");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/connections"));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company" })).toBeNull();
  });
});

it("lists three tabs in all, an admin by default gets two with Company first, and Rococo stepped in gets all three", () => {
  expect(SETTINGS_TABS.map((t) => t.key)).toEqual(["company", "connections", "activity"]);
  expect(settingsTabsFor(adminHub.can).map((t) => t.key)).toEqual(["company", "connections"]);
  expect(settingsTabsFor(makeHub("rococo", KINGDOM.company).can).map((t) => t.key)).toEqual(["company", "connections", "activity"]);
});

describe("the company Activity tab", () => {
  it("an admin with audit_log sees an Activity tab listing only their company's events", async () => {
    setMockCapabilities(kingdom, { audit_log: "admin" });
    const spy = vi.spyOn(auditService, "listAuditEvents");
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<SettingsPage tab="activity" />, adminHub, { path: "/settings/activity", pattern: "/settings/activity" });
    expect(screen.getByText("Changes to roles, access and settings for this company.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    expect(within(nav).getByRole("link", { name: "Activity" })).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ companyId: kingdom, limit: 100 }));
    expect(spy.mock.calls.every(([filter]) => filter?.companyId === kingdom)).toBe(true);
    expect(await screen.findByText(/^Company: modules changed from none to/)).toBeInTheDocument();
    expect(screen.queryByText(/^Invitation/)).toBeNull();
  });

  it("reads a role change in plain words, naming the person, with no id and no column name", async () => {
    setMockCapabilities(kingdom, { audit_log: "admin" });
    const roleChange = {
      ...AUDIT_EVENTS[1],
      id: "audit-plain",
      row_id: "kingdom-user-2",
      changed: {
        role: { old: "employee", new: "manager" },
        reports_to: { old: "kingdom-user-1", new: "3f2a6c1e-8b4d-4e1a-9c2f-1a2b3c4d5e6f" },
      },
    };
    const spy = vi.spyOn(auditService, "listAuditEvents").mockResolvedValue([roleChange]);
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<SettingsPage tab="activity" />, adminHub, { path: "/settings/activity", pattern: "/settings/activity" });
    const row = await screen.findByText(/^Dana Whitfield: role changed from Employee to Manager/);
    expect(row.textContent).toContain("Dana Whitfield: role changed from Employee to Manager; reports to changed from Marcus Lee to someone");
    expect(row.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
    expect(row.textContent).not.toMatch(/reports_to|kingdom-user/);
    expect(screen.queryByRole("columnheader", { name: "Company" })).toBeNull();
  });

  it("reads people by company and never lists every company or every person", async () => {
    setMockCapabilities(kingdom, { audit_log: "admin" });
    const companies = vi.spyOn(companiesService, "listCompanies");
    const everyone = vi.spyOn(profilesService, "listAllProfiles");
    const byCompany = vi.spyOn(profilesService, "listCompanyProfiles");
    onTestFinished(() => {
      companies.mockRestore();
      everyone.mockRestore();
      byCompany.mockRestore();
    });
    renderWithHub(<SettingsPage tab="activity" />, adminHub, { path: "/settings/activity", pattern: "/settings/activity" });
    expect(await screen.findByText(/^Company: modules changed/)).toBeInTheDocument();
    expect(byCompany).toHaveBeenCalledWith(kingdom);
    expect(companies).not.toHaveBeenCalled();
    expect(everyone).not.toHaveBeenCalled();
  });

  it("an admin without audit_log has no Activity tab and /settings/activity sends them to their first tab", async () => {
    const hub = makeHub("admin", KINGDOM.company);
    renderWithHub(<SettingsPage tab="connections" />, hub, { path: "/settings/connections", pattern: "/settings/connections" });
    const nav = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(nav).queryByRole("link", { name: "Activity" })).toBeNull();
    window.history.pushState({}, "", "/settings/activity?persona=admin&company=kingdom");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/settings/company"));
  });
});

it("the Rococo activity page still lists every company", async () => {
  const spy = vi.spyOn(auditService, "listAuditEvents");
  onTestFinished(() => spy.mockRestore());
  renderWithHub(<ActivityPage />, makeHub("rococo", null), { path: "/rococo/activity", pattern: "/rococo/activity" });
  expect(await screen.findByText(/^companies: modules/)).toBeInTheDocument();
  expect(screen.getByText(/^invitations: added/)).toBeInTheDocument();
  expect(spy).toHaveBeenCalledWith({ companyId: undefined, limit: 100 });
});

it("the Rococo activity page keeps its wording, its Company column and its every-company reads", async () => {
  const companies = vi.spyOn(companiesService, "listCompanies");
  const everyone = vi.spyOn(profilesService, "listAllProfiles");
  onTestFinished(() => {
    companies.mockRestore();
    everyone.mockRestore();
  });
  renderWithHub(<ActivityPage />, makeHub("rococo", null), { path: "/rococo/activity", pattern: "/rococo/activity" });
  expect(await screen.findByText("profiles: role employee to admin")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Company" })).toBeInTheDocument();
  expect(companies).toHaveBeenCalled();
  expect(everyone).toHaveBeenCalled();
});

describe("wins, milestones and Production follow their capabilities", () => {
  const employeeHub = makeHub("employee", KINGDOM.company);
  const managerHub = makeHub("manager", KINGDOM.company);
  const winsRoute = { path: "/wins", pattern: "/wins" };
  const job102 = { path: "/production/projects/kingdom-project-2", pattern: "/production/projects/:projectId" };
  const asEmployee = (path: string) => {
    window.history.pushState({}, "", `${path}?persona=employee&company=kingdom`);
    render(<App />);
  };

  it("an employee can record a win but sees no edit or archive control", async () => {
    setMockCapabilities(kingdom, { wins_post: "employee" });
    const create = vi.spyOn(winsService, "createWin");
    onTestFinished(() => create.mockRestore());
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, employeeHub, winsRoute);
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    await user.click(screen.getByRole("button", { name: "New win" }));
    const dialog = screen.getByRole("dialog", { name: "New win" });
    await user.type(within(dialog).getByLabelText("Title"), "Sample win from staff");
    await user.selectOptions(within(dialog).getByLabelText("Project"), "Sample job 101");
    await user.click(within(dialog).getByRole("button", { name: "Add win" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(expect.objectContaining({ company_id: kingdom, title: "Sample win from staff", project_id: "kingdom-project-1" })));
    expect(await screen.findByText("Sample win from staff")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an employee's empty wins page invites them to record one", async () => {
    setMockCapabilities(kingdom, { wins_post: "employee" });
    const list = vi.spyOn(winsService, "listWins").mockResolvedValue([]);
    onTestFinished(() => list.mockRestore());
    renderWithHub(<WinsPage />, employeeHub, winsRoute);
    expect(await screen.findByText("Record a win. It shows here and on Home.")).toBeInTheDocument();
  });

  it("with defaults an employee cannot record a win and the empty page does not invite one", async () => {
    const list = vi.spyOn(winsService, "listWins").mockResolvedValue([]);
    onTestFinished(() => list.mockRestore());
    renderWithHub(<WinsPage />, employeeHub, winsRoute);
    expect(await screen.findByText("Wins your team records show here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New win" })).toBeNull();
  });

  it("a manager can add, edit and complete a milestone", async () => {
    setMockCapabilities(kingdom, { milestones_edit: "manager" });
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, managerHub, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    await user.type(screen.getByLabelText("New milestone title"), "Sample inspection");
    await user.click(screen.getByRole("button", { name: "Add milestone" }));
    expect(await screen.findByRole("combobox", { name: "Status of Sample inspection" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Permit approved" }));
    const title = screen.getByLabelText("Title of Permit approved");
    await user.clear(title);
    await user.type(title, "Permit issued");
    await user.tab();
    expect(await screen.findByDisplayValue("Permit issued")).toBeInTheDocument();
    const done = screen.getByLabelText("Completed on for Sample inspection");
    fireEvent.change(done, { target: { value: "2026-09-14" } });
    fireEvent.blur(done);
    expect(await screen.findByText("Complete Sep 14, 2026")).toBeInTheDocument();
  });

  it("a manager still cannot rename or archive the project", async () => {
    setMockCapabilities(kingdom, { milestones_edit: "manager" });
    renderWithHub(<ProjectPage />, managerHub, job102);
    await screen.findByLabelText("New milestone title");
    expect(screen.queryByLabelText("Project name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Archive project" })).toBeNull();
  });

  it("with defaults a manager has no milestone controls", async () => {
    renderWithHub(<ProjectPage />, managerHub, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    expect(screen.queryByLabelText("New milestone title")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
  });

  it("a manager sees no New project button and no project edit control", async () => {
    setMockCapabilities(kingdom, { milestones_edit: "manager", production_view: "manager" });
    renderWithHub(<ProductionPage />, managerHub, { path: "/production", pattern: "/production" });
    expect(await screen.findByRole("link", { name: "Sample job 101" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
  });

  it("an employee has no Projects item in the nav and /production sends them Home", async () => {
    setMockCapabilities(kingdom, { production_view: "manager" });
    asEmployee("/production");
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("link", { name: "Projects" })).toBeNull();
  });

  it("a project page sends an employee without production_view Home too", async () => {
    setMockCapabilities(kingdom, { production_view: "manager" });
    asEmployee("/production/projects/kingdom-project-1");
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("a manager has Projects in the nav", async () => {
    setMockCapabilities(kingdom, { production_view: "manager" });
    window.history.pushState({}, "", "/?persona=manager&company=kingdom");
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Projects" })).toBeInTheDocument();
  });

  it("with defaults an employee still opens Production read-only and cannot record a win", async () => {
    asEmployee("/production");
    expect(await screen.findByRole("link", { name: "Sample job 101" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/production");
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "Projects" })).toBeInTheDocument();
  });
});

describe("links into Production", () => {
  const assignment = { id: "a1", company_id: kingdom, profile_id: "kingdom-user-1", project_id: "kingdom-project-1", role: "Lead", created_at: "", updated_at: "" };
  const project = { id: "kingdom-project-1", company_id: kingdom, name: "Sample job 101", reference: null, notes: null, archived_at: null, created_at: "", updated_at: "" };
  const baseProps = { companyId: kingdom, employeeId: "kingdom-user-1", firstName: "Sample", assignments: [assignment], projects: [project], canEdit: false, onAssignments: () => undefined, onProjects: () => undefined, onError: () => undefined };

  it("PersonProjects renders the project name as plain text without a link", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderWithHub(<PersonProjects {...(baseProps as any)} linkProjects={false} />, adminHub);
    expect(screen.getByText("Sample job 101")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sample job 101" })).toBeNull();
  });
});

describe("a person page links a project only to someone who may open Production", () => {
  // Kingdom has no assignments of its own, so give this person one on its first project.
  const assignment = { id: "assignment-1", company_id: kingdom, project_id: "kingdom-project-1", employee_id: "kingdom-user-1", role: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
  const noorRoute = person;
  beforeEach(() => {
    const spy = vi.spyOn(projectAssignmentsService, "listProjectAssignments").mockResolvedValue([assignment]);
    onTestFinished(() => spy.mockRestore());
  });
  it("shows project names as plain text without production_view", async () => {
    setMockCapabilities(kingdom, { production_view: "owner" });
    renderWithHub(<PersonPage />, adminHub, noorRoute);
    await screen.findByRole("heading", { name: "Financial figures" });
    const heading = await screen.findByText(/^On \d+ projects?$/);
    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getAllByText(/^Sample job/).length).toBeGreaterThan(0);
    expect(within(section).queryAllByRole("link")).toHaveLength(0);
  });

  it("links them by default", async () => {
    renderWithHub(<PersonPage />, adminHub, noorRoute);
    await screen.findByRole("heading", { name: "Financial figures" });
    const heading = await screen.findByText(/^On \d+ projects?$/);
    const section = heading.closest("section") as HTMLElement;
    expect(within(section).getAllByRole("link").length).toBeGreaterThan(0);
  });
});
