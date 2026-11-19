// People's Roster, Roles and Divisions tabs: an admin sees all three, a manager keeps "Your team"
// with no tab row, the roster reads a person's hub role as text (it is changed on their profile),
// Divisions and Roles open at their own addresses, and the old Settings and Goals addresses for
// roles redirect to People, Roles through the real router.
import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { RBA, makeHub } from "../test/fixtures.ts";
import { ROLE_LABELS } from "../types/database.ts";
import DivisionsPage from "./people/DivisionsPage.tsx";
import PeoplePage from "./people/PeoplePage.tsx";
import RolesPage from "./people/RolesPage.tsx";
import { peopleTabsFor } from "./people/peopleTabs.ts";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;

describe("People tabs", () => {
  it("gives an admin Roster, Roles and Divisions, and a manager no tabs", () => {
    expect(peopleTabsFor(true).map((t) => [t.label, t.to])).toEqual([
      ["Roster", "/people"],
      ["Roles", "/people/roles"],
      ["Divisions", "/people/divisions"],
    ]);
    expect(peopleTabsFor(false)).toEqual([]);
  });

  it("shows an admin the tab row on the roster", async () => {
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    const nav = await screen.findByRole("navigation", { name: "People" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Roster", "Roles", "Divisions"]);
    expect(within(nav).getByRole("link", { name: "Roster" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
  });

  it("keeps a manager on Your team with no tab row", async () => {
    renderWithHub(<PeoplePage />, rbaManager, { path: "/people", pattern: "/people" });
    expect(await screen.findByRole("heading", { level: 1, name: "Your team" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "People" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Your profile and team" })).toBeInTheDocument();
  });
});

describe("the roster", () => {
  it("reads each person's hub role as text, with the invite actions still there", async () => {
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    const row = (await screen.findByText("Kai Bennett", { selector: "span" })).closest("tr") as HTMLElement;
    expect(within(row).getByText(ROLE_LABELS[kai.role])).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /^Role for / })).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Send the invitation to Kai Bennett" })).toBeInTheDocument();
  });
});

describe("Divisions and Roles", () => {
  it("opens the divisions panel under the People tabs", async () => {
    renderWithHub(<DivisionsPage />, rbaAdmin, { path: "/people/divisions", pattern: "/people/divisions" });
    const nav = await screen.findByRole("navigation", { name: "People" });
    expect(within(nav).getByRole("link", { name: "Divisions" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByLabelText("Division name RBA North")).toBeInTheDocument();
  });

  it("keeps job roles and role goals editable on Roles", async () => {
    renderWithHub(<RolesPage />, rbaAdmin, { path: "/people/roles", pattern: "/people/roles" });
    const nav = await screen.findByRole("navigation", { name: "People" });
    expect(within(nav).getByRole("link", { name: "Roles" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByLabelText("Name for Project Manager")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Role goals" })).toBeInTheDocument();
  });
});

describe("the old addresses", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  async function openAs(address: string) {
    window.history.pushState({}, "", `${address}?persona=admin&company=rba`);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/people/roles"));
    expect(await screen.findByRole("navigation", { name: "People" })).toBeInTheDocument();
  }

  it("sends /settings/roles to People, Roles", async () => {
    await openAs("/settings/roles");
  });

  it("sends /goals/roles to People, Roles", async () => {
    await openAs("/goals/roles");
  });

  it("drops a hash on the old address and still lands on People, Roles", async () => {
    window.history.pushState({}, "", "/goals/roles?persona=admin&company=rba#role-goals-x");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/people/roles"));
    expect(await screen.findByRole("navigation", { name: "People" })).toBeInTheDocument();
  });
});
