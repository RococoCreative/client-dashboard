// The information architecture: the Goals, Settings and Resources hubs (one page each, a route per
// tab), the Where the work lives card on Home, the header links from Monthly GSRs and Reviews, and
// the empty states that say who sets a thing and where. Rendered against the mocked data layer the
// way pages.test.tsx renders every page; the redirects from old addresses are proven through the
// real router in App.rococo.test.tsx.
import { screen, waitFor, within } from "@testing-library/react";
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
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { listJobRoleGoals } from "../services/jobRoles.ts";
import DashboardPage from "./DashboardPage.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import GoalsPage from "./gsr/GoalsPage.tsx";
import ScorecardsPage from "./gsr/ScorecardsPage.tsx";
import PersonPage from "./people/PersonPage.tsx";
import ResourcesPage from "./resources/ResourcesPage.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";
import { GOALS_TABS } from "./gsr/goalsTabs.ts";
import { SETTINGS_TABS } from "./settings/settingsTabs.ts";

const admin = makeHub("admin");
const rbaAdmin = makeHub("admin", RBA.company);
const kingdomAdmin = makeHub("admin", KINGDOM.company);
const klasikWithLinks = makeHub("admin", { ...KLASIK.company, modules: ["external_links"] });
const klasikEmployeeWithLinks = makeHub("employee", { ...KLASIK.company, modules: ["external_links"] });

function tabsOf(name: string) {
  const nav = screen.getByRole("navigation", { name });
  return {
    labels: within(nav).getAllByRole("link").map((link) => link.textContent),
    current: within(nav).getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent),
    hrefs: within(nav).getAllByRole("link").map((link) => link.getAttribute("href")),
  };
}

describe("Goals hub", () => {
  it("has a route per tab, in the order Company, By role, Monthly focus, People", () => {
    expect(GOALS_TABS.map((t) => [t.label, t.to])).toEqual([
      ["Company", "/goals/company"],
      ["By role", "/goals/roles"],
      ["Monthly focus", "/goals/focus"],
      ["People", "/goals/people"],
    ]);
  });

  it("opens Company on its route with the year's company goals", async () => {
    renderWithHub(<GoalsPage tab="company" />, admin, { path: "/goals/company", pattern: "/goals/company" });
    expect(screen.getByRole("heading", { level: 1, name: "Goals" })).toBeInTheDocument();
    expect(tabsOf("Goals")).toEqual({
      labels: ["Company", "By role", "Monthly focus", "People"],
      current: ["Company"],
      hrefs: ["/goals/company", "/goals/roles", "/goals/focus", "/goals/people"],
    });
    expect(await screen.findByRole("heading", { name: "Company goals 2026" })).toBeInTheDocument();
    expect(await screen.findByText("Gross margin")).toBeInTheDocument();
  });

  it("edits each job role's goals on By role, the ones Add role goals files into a month", async () => {
    const user = userEvent.setup();
    renderWithHub(<GoalsPage tab="roles" />, admin, { path: "/goals/roles", pattern: "/goals/roles" });
    expect(tabsOf("Goals").current).toEqual(["By role"]);
    const role = KLASIK.jobRoles[0];
    expect(await screen.findByLabelText("Role goal Walk every active site once a week")).toHaveValue("Walk every active site once a week");
    const card = screen.getByRole("heading", { name: role.name }).closest("section") as HTMLElement;
    expect(card.parentElement).toHaveAttribute("id", `role-goals-${role.id}`);

    await user.type(within(card).getByLabelText(`Add a goal for ${role.name}`), "Close every punch list in five days");
    await user.click(within(card).getByRole("button", { name: /Add role goal/ }));
    expect(await within(card).findByLabelText("Role goal Close every punch list in five days")).toBeInTheDocument();
    expect((await listJobRoleGoals(KLASIK.company.id, role.id)).map((g) => g.title)).toContain("Close every punch list in five days");

    await user.click(within(card).getByRole("button", { name: "Remove role goal Close every punch list in five days" }));
    await waitFor(() => expect(within(card).queryByLabelText("Role goal Close every punch list in five days")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Job roles" })).toHaveAttribute("href", "/settings/roles");
  });

  it("says a role with no goals yet what goes there", async () => {
    renderWithHub(<GoalsPage tab="roles" />, rbaAdmin, { path: "/goals/roles", pattern: "/goals/roles" });
    const card = (await screen.findByRole("heading", { name: "Project Manager" })).closest("section") as HTMLElement;
    expect(within(card).getByText(/No role goals yet\. Add the goals everyone in Project Manager works on every month/)).toBeInTheDocument();
    expect(within(card).getByText("1 person in this role")).toBeInTheDocument();
  });

  it("points a company with no job roles to Settings > Roles", async () => {
    const empty = makeHub("admin", { ...KLASIK.company, id: "co-without-roles" });
    renderWithHub(<GoalsPage tab="roles" />, empty, { path: "/goals/roles", pattern: "/goals/roles" });
    expect(await screen.findByRole("heading", { name: "No job roles yet" })).toBeInTheDocument();
    expect(screen.getByText(/An admin adds the company's job roles in Settings, Roles/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add job roles" })).toHaveAttribute("href", "/settings/roles");
  });

  it("plans the focus topics on Monthly focus", async () => {
    renderWithHub(<GoalsPage tab="focus" />, admin, { path: "/goals/focus", pattern: "/goals/focus" });
    expect(tabsOf("Goals").current).toEqual(["Monthly focus"]);
    expect(await screen.findByRole("heading", { name: "Focus topic calendar" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Theme for October 2026")).toHaveValue("Core value: Ownership");
  });

  it("lists each person's goals for the year on People", async () => {
    renderWithHub(<GoalsPage tab="people" />, admin, { path: "/goals/people", pattern: "/goals/people" });
    expect(tabsOf("Goals").current).toEqual(["People"]);
    expect(await screen.findByRole("heading", { name: "People's goals" })).toBeInTheDocument();
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
  });
});

describe("Settings hub", () => {
  it("has a route per tab, in the order Company, Roles, Reviews, Connections", () => {
    expect(SETTINGS_TABS.map((t) => [t.label, t.to])).toEqual([
      ["Company", "/settings/company"],
      ["Roles", "/settings/roles"],
      ["Reviews", "/settings/reviews"],
      ["Connections", "/settings/connections"],
    ]);
  });

  it("keeps the company's name, logo, theme and sign-in domains on Company", async () => {
    renderWithHub(<SettingsPage tab="company" />, admin, { path: "/settings/company", pattern: "/settings/company" });
    expect(tabsOf("Settings").current).toEqual(["Company"]);
    expect(await screen.findByDisplayValue("Klasik Construction")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Theme and sign-in" })).toBeInTheDocument();
    expect(await screen.findByText("beklasik.com")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Job roles" })).not.toBeInTheDocument();
  });

  it("keeps job roles, their scorecard metrics and the divisions on Roles", async () => {
    renderWithHub(<SettingsPage tab="roles" />, rbaAdmin, { path: "/settings/roles", pattern: "/settings/roles" });
    expect(tabsOf("Settings").current).toEqual(["Roles"]);
    expect(await screen.findByRole("heading", { name: "Job roles" })).toBeInTheDocument();
    expect(await screen.findAllByLabelText("Metric name Optimization rate")).toHaveLength(2);
    expect(await screen.findByRole("heading", { name: "Divisions" })).toBeInTheDocument();
    const pm = (await screen.findByLabelText("Name for Project Manager")).closest("li") as HTMLElement;
    expect(within(pm).getByRole("link", { name: "Add in Goals, By role" })).toHaveAttribute("href", "/goals/roles#role-goals-rba-role-pm");
    expect(screen.queryByRole("heading", { name: "Pillars and weights" })).not.toBeInTheDocument();
  });

  it("keeps pillars, the Monthly GSRs rule and deliverable categories on Reviews", async () => {
    renderWithHub(<SettingsPage tab="reviews" />, admin, { path: "/settings/reviews", pattern: "/settings/reviews" });
    expect(tabsOf("Settings").current).toEqual(["Reviews"]);
    expect(await screen.findByRole("heading", { name: "Pillars and weights" })).toBeInTheDocument();
    expect(await screen.findByText("Weights total 100%")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Deliverable categories" })).toBeInTheDocument();
    // The focus topics moved to Goals; Reviews no longer carries the calendar.
    expect(screen.queryByRole("heading", { name: "Focus topic calendar" })).not.toBeInTheDocument();
  });

  it("keeps connections and data sources on Connections, and points to Resources for links", async () => {
    renderWithHub(<SettingsPage tab="connections" />, kingdomAdmin, { path: "/settings/connections", pattern: "/settings/connections" });
    expect(tabsOf("Settings").current).toEqual(["Connections"]);
    expect(await screen.findByRole("heading", { name: "Connections" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Data sources" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Links" })).toHaveAttribute("href", "/resources/links");
    expect(screen.getByRole("heading", { name: "Links to outside tools" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Label for Sample sales board")).not.toBeInTheDocument();
  });

  it("leaves the links pointer off for a company without the module", async () => {
    renderWithHub(<SettingsPage tab="connections" />, admin, { path: "/settings/connections", pattern: "/settings/connections" });
    expect(await screen.findByText("GoHighLevel")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Links" })).not.toBeInTheDocument();
  });
});

describe("Resources hub", () => {
  it("opens the SOP library on SOPs, with no Links tab for a company without the module", async () => {
    renderWithHub(<ResourcesPage tab="sops" />, admin, { path: "/resources/sops", pattern: "/resources/sops" });
    expect(tabsOf("Resources")).toEqual({ labels: ["SOPs", "Files & media"], current: ["SOPs"], hrefs: ["/resources/sops", "/resources/files"] });
    expect(await screen.findByRole("heading", { name: "SOP library" })).toBeInTheDocument();
    expect(await screen.findByText("Jobsite safety walk")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /New SOP/ })).toHaveAttribute("href", "/sops/new");
  });

  it("opens the files and media library on Files & media", async () => {
    renderWithHub(<ResourcesPage tab="files" />, admin, { path: "/resources/files", pattern: "/resources/files" });
    expect(tabsOf("Resources").current).toEqual(["Files & media"]);
    expect(await screen.findByRole("heading", { name: "Files & media" })).toBeInTheDocument();
    expect(await screen.findByText("Change order template")).toBeInTheDocument();
  });

  it("adds the Links tab once the company carries the module", async () => {
    renderWithHub(<ResourcesPage tab="links" />, klasikWithLinks, { path: "/resources/links", pattern: "/resources/links" });
    expect(tabsOf("Resources")).toEqual({
      labels: ["SOPs", "Files & media", "Links"],
      current: ["Links"],
      hrefs: ["/resources/sops", "/resources/files", "/resources/links"],
    });
    // An admin manages the links here; Klasik has none yet.
    expect(await screen.findByRole("heading", { name: "Links to outside tools" })).toBeInTheDocument();
    expect(await screen.findByText(/No links yet\. Add the programs the team works in below/)).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Add a link" })).toBeInTheDocument();
  });

  it("tells an employee who adds links when there are none", async () => {
    renderWithHub(<ResourcesPage tab="links" />, klasikEmployeeWithLinks, { path: "/resources/links", pattern: "/resources/links" });
    expect(await screen.findByRole("heading", { name: "No links yet" })).toBeInTheDocument();
    expect(screen.getByText(/Your admins add links to the programs the team works in/)).toBeInTheDocument();
  });
});

describe("Where the work lives on Home", () => {
  it("shows the card to an admin of any company with the module, and says where links are added", async () => {
    renderWithHub(<DashboardPage />, klasikWithLinks);
    const heading = await screen.findByRole("heading", { name: "Where the work lives" });
    const card = heading.closest("section") as HTMLElement;
    expect(await within(card).findByText(/No links yet\. Add the programs the team works in/)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Resources, Links" })).toHaveAttribute("href", "/resources/links");
  });

  it("shows it on an employee's Home too", async () => {
    renderWithHub(<DashboardPage />, klasikEmployeeWithLinks);
    const heading = await screen.findByRole("heading", { name: "Where the work lives" });
    const card = heading.closest("section") as HTMLElement;
    expect(await within(card).findByText(/Your admins add the programs the team works in/)).toBeInTheDocument();
  });

  it("is not there without the module", async () => {
    renderWithHub(<DashboardPage />, admin);
    expect(await screen.findByText("Closed sales")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where the work lives" })).not.toBeInTheDocument();
  });
});

describe("header links from Monthly GSRs and Reviews", () => {
  it("links Monthly GSRs to Goals > Monthly focus and Settings > Reviews", async () => {
    renderWithHub(<CyclesPage section="gsr" />, admin);
    expect(await screen.findByRole("link", { name: /Focus topics/ })).toHaveAttribute("href", "/goals/focus");
    expect(screen.getByRole("link", { name: /Review settings/ })).toHaveAttribute("href", "/settings/reviews");
  });

  it("links Reviews to Goals > Company and Settings > Reviews", async () => {
    renderWithHub(<CyclesPage section="reviews" />, admin);
    expect(await screen.findByRole("link", { name: /Company goals/ })).toHaveAttribute("href", "/goals/company");
    expect(screen.getByRole("link", { name: /Review settings/ })).toHaveAttribute("href", "/settings/reviews");
  });
});

describe("person page", () => {
  it("reads in one order: scorecard, goals, projects, KPIs, compensation, review history", async () => {
    const noor = RBA.profiles.find((p) => p.id === "rba-user-3")!;
    renderWithHub(<PersonPage />, rbaAdmin, { path: `/people/${noor.id}`, pattern: "/people/:profileId" });
    expect(await screen.findByRole("heading", { name: "Noor Haddad" })).toBeInTheDocument();
    await screen.findByRole("heading", { name: "This year, next year and the BHAG" });
    const order = ["Details", "This year, next year and the BHAG", "Personal KPIs", "Compensation", "Review history"];
    await waitFor(() => expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(expect.arrayContaining(order)));
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const at = (name: string | RegExp) => headings.findIndex((h) => (typeof name === "string" ? h === name : name.test(h)));
    const projects = at(/^On \d+ projects?$|^Projects$/);
    expect(at("Details")).toBeLessThan(at("This year, next year and the BHAG"));
    expect(at("This year, next year and the BHAG")).toBeLessThan(projects);
    expect(projects).toBeLessThan(at("Personal KPIs"));
    expect(at("Personal KPIs")).toBeLessThan(at("Compensation"));
    expect(at("Compensation")).toBeLessThan(at("Review history"));
    const history = screen.getByRole("heading", { name: "Review history" }).closest("section") as HTMLElement;
    expect(within(history).getByRole("link", { name: "Review cycles" })).toHaveAttribute("href", "/reviews");
  });
});

describe("empty states point to where a thing is set", () => {
  it("sends the Scorecards report to Settings > Roles when no role has metrics", async () => {
    renderWithHub(<ScorecardsPage />, admin, { path: "/scorecards", pattern: "/scorecards" });
    expect(await screen.findByRole("heading", { name: "No scorecard metrics yet" })).toBeInTheDocument();
    expect(screen.getByText(/An admin adds the metrics each job role is scored on in Settings, Roles/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Settings, Roles" })).toHaveAttribute("href", "/settings/roles");
  });
});
