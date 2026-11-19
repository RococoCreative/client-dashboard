// The person page as six short tabs: Overview, GSR and goals, Scorecard, Tasks, Reviews and Setup.
// Pins who gets which tab (a manager has no Setup, a Rococo admin's row no Tasks), that an address
// for a tab the viewer does not have lands on Overview, that switching tabs never loads the person
// again, what each tab holds, and the account actions that moved here
// from the roster: Deactivate, Reactivate and Remove, with the roster's rules and confirm copy.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

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

import { HubContext, type HubValue } from "../context/HubContext.tsx";
import App from "../App.tsx";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { setMockCapabilities } from "../test/mocks/capabilities.ts";
import * as employeesService from "../services/employees.ts";
import * as invitationsService from "../services/invitations.ts";
import * as profilesService from "../services/profiles.ts";
import * as tasksService from "../services/tasks.ts";
import PersonPage from "./people/PersonPage.tsx";
import { personTabsFor } from "./people/personTabs.ts";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const klasikAdmin = makeHub("admin");
const kingdomAdmin = makeHub("admin", KINGDOM.company);
const byName = (people: typeof RBA.profiles, name: string) => people.find((p) => p.full_name === name)!;
const noor = byName(RBA.profiles, "Noor Haddad");
const jamie = byName(RBA.profiles, "Jamie Fox");
const harper = byName(RBA.profiles, "Harper Quinn");
const rowan = byName(RBA.profiles, "Rowan Ellis");
const sam = byName(KLASIK.profiles, "Sam Ortega");
const taylor = byName(KLASIK.profiles, "Taylor Reed");
const avery = byName(KLASIK.profiles, "Avery Cole");
const marcus = KINGDOM.profiles[0];

// The person page at an address, with the roster beside it so leaving for /people lands somewhere.
function renderPerson(hub: HubValue, path: string) {
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people" element={<div>roster</div>} />
          <Route path="/people/:profileId/:tab?" element={<PersonPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

const tabRow = async () => screen.findByRole("navigation", { name: "Person" });
const tabNames = async () => within(await tabRow()).getAllByRole("link").map((l) => l.textContent);

describe("personTabsFor", () => {
  const base = { personId: "p1", isAdmin: true, tasksOn: true, rococoPerson: false };
  it("gives an admin six tabs, each at its own address", () => {
    expect(personTabsFor(base).map((t) => [t.label, t.to])).toEqual([
      ["Overview", "/people/p1"],
      ["GSR and goals", "/people/p1/gsr"],
      ["Scorecard", "/people/p1/scorecard"],
      ["Tasks", "/people/p1/tasks"],
      ["Reviews", "/people/p1/reviews"],
      ["Setup", "/people/p1/setup"],
    ]);
  });

  it("leaves Setup to admins, Tasks to a company with the module, and no Tasks on a Rococo admin's row", () => {
    expect(personTabsFor({ ...base, isAdmin: false }).map((t) => t.key)).toEqual(["overview", "gsr", "scorecard", "tasks", "reviews"]);
    expect(personTabsFor({ ...base, tasksOn: false }).map((t) => t.key)).toEqual(["overview", "gsr", "scorecard", "reviews", "setup"]);
    expect(personTabsFor({ ...base, rococoPerson: true }).map((t) => t.key)).toEqual(["overview", "gsr", "scorecard", "reviews", "setup"]);
    expect(personTabsFor({ ...base, rococoPerson: true, isAdmin: false }).map((t) => t.key)).toEqual(["overview", "gsr", "scorecard", "reviews"]);
  });
});

describe("the person page for an admin", () => {
  it("opens on Overview at the old address, with six tabs and the Overview cards", async () => {
    renderPerson(rbaAdmin, `/people/${noor.id}`);
    expect(await screen.findByRole("heading", { name: "Noor Haddad" })).toBeInTheDocument();
    expect(await tabNames()).toEqual(["Overview", "GSR and goals", "Scorecard", "Tasks", "Reviews", "Setup"]);
    expect(within(await tabRow()).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    const details = (await screen.findByRole("heading", { name: "Details" })).closest("section") as HTMLElement;
    expect(within(details).getByText(noor.email)).toBeInTheDocument();
    expect(within(details).getByRole("link", { name: "Project Manager" })).toHaveAttribute("href", "/people/roles/rba-role-pm");
    expect(within(details).getByRole("link", { name: "Edit in Setup" })).toHaveAttribute("href", `/people/${noor.id}/setup`);
    expect(screen.getByText("Latest score")).toBeInTheDocument();
    expect(screen.getByText("Average")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Tasks" })).toBeInTheDocument();
    // Nothing from the other tabs.
    expect(screen.queryByRole("heading", { name: "Personal KPIs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review history" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("shows the details on Setup read first, with Deactivate", async () => {
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${noor.id}/setup`);
    expect(await screen.findByRole("heading", { name: "Noor Haddad" })).toBeInTheDocument();
    expect(within(await tabRow()).getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Deactivate Noor Haddad" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit title" }));
    expect(screen.getByLabelText("Title")).toHaveValue(noor.title ?? "");
  });

  it("holds ratings and review history on Reviews, and KPIs on Scorecard", async () => {
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${jamie.id}/reviews`);
    expect(await screen.findByRole("radiogroup", { name: "Communication rating" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Review history" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deliverables" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Personal KPIs" })).not.toBeInTheDocument();
    await user.click(within(await tabRow()).getByRole("link", { name: "Scorecard" }));
    expect(await screen.findByRole("heading", { name: "Personal KPIs" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Financial figures" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review history" })).not.toBeInTheDocument();
  });

  it("does not load the person again when switching tabs", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(profilesService, "listCompanyProfiles");
    onTestFinished(() => spy.mockRestore());
    renderPerson(rbaAdmin, `/people/${jamie.id}`);
    expect(await screen.findByRole("heading", { name: "Jamie Fox" })).toBeInTheDocument();
    for (const name of ["GSR and goals", "Scorecard", "Tasks", "Reviews", "Setup", "Overview"]) {
      await user.click(within(await tabRow()).getByRole("link", { name }));
      expect(within(await tabRow()).getByRole("link", { name })).toHaveAttribute("aria-current", "page");
    }
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps an owner's hub role out of an admin's hands on Setup", async () => {
    const user = userEvent.setup();
    renderPerson(kingdomAdmin, `/people/${marcus.id}/setup`);
    await user.click(await screen.findByRole("button", { name: "Edit role" }));
    const role = screen.getByLabelText("Role");
    expect(role).toBeDisabled();
    expect(role).toHaveValue("owner");
    expect(screen.getByText("Only an owner or Rococo can change this person's role.")).toBeInTheDocument();
  });

  it("shows three open tasks on Overview with a way to all of them", async () => {
    const created = await tasksService.createTask({ company_id: RBA.company.id, title: "Sample fourth task", assignee_id: jamie.id, due_date: "2026-12-30" });
    onTestFinished(() => tasksService.deleteTask(created.id));
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${jamie.id}`);
    const list = await screen.findByRole("list", { name: "Open tasks for Jamie Fox" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("The next 3 of 4 open tasks, earliest due first.")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "All tasks" }));
    expect(within(await tabRow()).getByRole("link", { name: "Tasks" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByText("Sample fourth task")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Open tasks for Jamie Fox" })).getAllByRole("listitem")).toHaveLength(4);
  });
});

describe("the person page for a manager", () => {
  it("has no Setup tab, and an address for one lands on Overview", async () => {
    for (const path of [`/people/${rowan.id}/setup`, `/people/${rowan.id}/nope`]) {
      const view = renderPerson({ ...rbaManager, profile: harper }, path);
      expect(await screen.findByRole("heading", { name: "Rowan Ellis" })).toBeInTheDocument();
      expect(await tabNames()).toEqual(["Overview", "GSR and goals", "Scorecard", "Tasks", "Reviews"]);
      expect(within(await tabRow()).getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      expect(await screen.findByRole("heading", { name: "Details" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Edit in Setup" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("a Rococo admin's row", () => {
  it("keeps every tab but Tasks, with no role scorecard and no account actions", async () => {
    // Noor is placed on RBA's roster as a Rococo admin; RBA has the tasks module.
    const user = userEvent.setup();
    await profilesService.updateProfile(noor.id, { is_rococo_admin: true });
    onTestFinished(() => profilesService.updateProfile(noor.id, { is_rococo_admin: false }).then(() => undefined));
    renderPerson(rbaAdmin, `/people/${noor.id}`);
    expect(await screen.findByRole("heading", { name: "Noor Haddad" })).toBeInTheDocument();
    expect(await tabNames()).toEqual(["Overview", "GSR and goals", "Scorecard", "Reviews", "Setup"]);
    expect(screen.getByText("Rococo Creative")).toBeInTheDocument();
    expect(await screen.findByText("RBA North")).toBeInTheDocument();

    await user.click(within(await tabRow()).getByRole("link", { name: "Reviews" }));
    expect(await screen.findByRole("heading", { name: "Review history" })).toBeInTheDocument();

    await user.click(within(await tabRow()).getByRole("link", { name: "Scorecard" }));
    expect(await screen.findByRole("heading", { name: "Personal KPIs" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Scorecard year" })).not.toBeInTheDocument();
    expect(screen.queryByText(/^On \d+ projects?$/)).not.toBeInTheDocument();

    await user.click(within(await tabRow()).getByRole("link", { name: "Setup" }));
    await user.click(await screen.findByRole("button", { name: "Edit name" }));
    expect(screen.getByLabelText("Name")).toBeEnabled();
    expect(screen.getByText("Rococo Creative")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit role" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit divisions and view access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deactivate|Reactivate|Remove/ })).not.toBeInTheDocument();
  });
});

describe("pay", () => {
  it("shows no compensation on any tab to an admin without pay", async () => {
    setMockCapabilities(KINGDOM.company.id, { pay: "owner" });
    onTestFinished(() => setMockCapabilities(KINGDOM.company.id, {}));
    const compensation = vi.spyOn(employeesService, "listCompensation");
    onTestFinished(() => compensation.mockRestore());
    const user = userEvent.setup();
    const kingdomEmployee = KINGDOM.profiles[1];
    renderPerson(kingdomAdmin, `/people/${kingdomEmployee.id}`);
    expect(await screen.findByRole("heading", { name: "Details" })).toBeInTheDocument();
    for (const name of ["Overview", "GSR and goals", "Scorecard", "Tasks", "Reviews", "Setup"]) {
      await user.click(within(await tabRow()).getByRole("link", { name }));
      await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Person" })).getByRole("link", { name })).toHaveAttribute("aria-current", "page"));
      expect(screen.queryByText("Annual compensation")).not.toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Compensation" })).not.toBeInTheDocument();
    }
    expect(compensation).not.toHaveBeenCalled();
  });

  it("shows an admin with pay the compensation on Setup only", async () => {
    renderPerson(klasikAdmin, `/people/${sam.id}/setup`);
    expect(await screen.findByRole("heading", { name: "Compensation" })).toBeInTheDocument();
    expect(screen.getByText("Annual compensation")).toBeInTheDocument();
  });
});

describe("account actions on Setup", () => {
  it("deactivates and reactivates someone", async () => {
    const user = userEvent.setup();
    renderPerson(klasikAdmin, `/people/${sam.id}/setup`);
    await user.click(await screen.findByRole("button", { name: "Deactivate Sam Ortega" }));
    expect(await screen.findByRole("button", { name: "Reactivate Sam Ortega" })).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(KLASIK.company.id)).find((p) => p.id === sam.id)?.is_active).toBe(false);
    await user.click(screen.getByRole("button", { name: "Reactivate Sam Ortega" }));
    expect(await screen.findByRole("button", { name: "Deactivate Sam Ortega" })).toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(KLASIK.company.id)).find((p) => p.id === sam.id)?.is_active).toBe(true);
  });

  it("offers Remove only to someone with no account and no pending invitation", async () => {
    const withAccount = renderPerson(klasikAdmin, `/people/${sam.id}/setup`);
    expect(await screen.findByRole("button", { name: "Deactivate Sam Ortega" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sam Ortega" })).not.toBeInTheDocument();
    withAccount.unmount();

    renderPerson(klasikAdmin, `/people/${avery.id}/setup`);
    expect(await screen.findByText(/Cancel their invitation on the roster first/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Avery Cole" })).not.toBeInTheDocument();
  });

  it("reads invitations only when Remove could be offered", async () => {
    const spy = vi.spyOn(invitationsService, "listInvitations");
    onTestFinished(() => spy.mockRestore());
    const withAccount = renderPerson(klasikAdmin, `/people/${sam.id}/setup`);
    expect(await screen.findByRole("button", { name: "Deactivate Sam Ortega" })).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    withAccount.unmount();

    renderPerson(klasikAdmin, `/people/${taylor.id}/setup`);
    expect(await screen.findByRole("button", { name: "Remove Taylor Reed" })).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("removes a never-signed-in person with no invitation and returns to the roster", async () => {
    const user = userEvent.setup();
    renderPerson(klasikAdmin, `/people/${taylor.id}/setup`);
    await user.click(await screen.findByRole("button", { name: "Remove Taylor Reed" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove Taylor Reed from the team?");
    expect(dialog).toHaveTextContent(/reviews/);
    expect(dialog).toHaveTextContent(/goals/);
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("roster")).toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(KLASIK.company.id)).some((p) => p.id === taylor.id)).toBe(false);
  });
});

describe("addresses through the app", () => {
  it("opens a tab at its own address", async () => {
    window.history.pushState({}, "", `/people/${marcus.id}/reviews?persona=admin&company=kingdom`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Review history" })).toBeInTheDocument();
    expect(within(await tabRow()).getByRole("link", { name: "Reviews" })).toHaveAttribute("aria-current", "page");
  });
});
