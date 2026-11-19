// People, Roles as a list and one open role: the list carries each role's counts and opens the
// first, each role has its own address, the search narrows the list, setup rows read as text until
// their pencil, one Add form per section, putting someone in a role, a role id from another company,
// a company with no roles, the per-role write queue for module ticks (also across a switch to
// another role and back), a retired role taking no more people, the shared busy lock on deletes, and
// the admin-only gate.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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
import { HubContext, type HubValue } from "../context/HubContext.tsx";
import * as jobRolesService from "../services/jobRoles.ts";
import { listJobRoles } from "../services/jobRoles.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import RolesPage from "./people/RolesPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const supervisor = RBA.jobRoles.find((r) => r.name === "Site Supervisor")!;
const pm = RBA.jobRoles.find((r) => r.name === "Project Manager")!;
const superintendent = RBA.jobRoles.find((r) => r.name === "Site Superintendent")!;

function Address() {
  const { pathname } = useLocation();
  return <p data-testid="address">{pathname}</p>;
}

function openRoles(hub: HubValue, path = "/people/roles") {
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people/roles/:roleId?" element={<><RolesPage /><Address /></>} />
          <Route path="*" element={<Address />} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

const address = () => screen.getByTestId("address").textContent;
const list = () => screen.getByRole("region", { name: "Job roles" });

describe("People, Roles as list and detail", () => {
  it("lists every role with its counts and opens the first", async () => {
    openRoles(rbaAdmin);
    await waitFor(() => expect(address()).toBe(`/people/roles/${supervisor.id}`));
    expect(await screen.findByRole("heading", { level: 2, name: "Site Supervisor" })).toBeInTheDocument();
    const links = within(list()).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([supervisor.id, pm.id, superintendent.id].map((id) => `/people/roles/${id}`));
    expect(within(list()).getByRole("link", { name: /Project Manager/ })).toHaveTextContent("1 person · 5 metrics");
    expect(within(list()).getByRole("link", { name: /Site Superintendent/ })).toHaveTextContent("1 person · 3 metrics");
    expect(within(list()).getByRole("link", { name: /Site Supervisor/ })).toHaveAttribute("aria-current", "true");
  });

  it("opens another role at its own address", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${supervisor.id}`);
    await user.click(await within(await screen.findByRole("region", { name: "Job roles" })).findByRole("link", { name: /Project Manager/ }));
    expect(address()).toBe(`/people/roles/${pm.id}`);
    expect(await screen.findByRole("heading", { level: 2, name: "Project Manager" })).toBeInTheDocument();
  });

  it("narrows the list with the search box", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${pm.id}`);
    await user.type(await screen.findByRole("searchbox", { name: "Search roles" }), "site");
    expect(within(list()).queryByRole("link", { name: /Project Manager/ })).not.toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /Site Supervisor/ })).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /Site Superintendent/ })).toBeInTheDocument();
  });

  it("reads a metric as text until its pencil, then saves a new name", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${superintendent.id}`);
    expect(await screen.findByText("Daily logs")).toBeInTheDocument();
    expect(screen.queryByLabelText("Metric name Daily logs")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit metric Daily logs" }));
    const name = screen.getByLabelText("Metric name Daily logs");
    await user.clear(name);
    await user.type(name, "Daily site logs");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Daily site logs")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Metric name /)).not.toBeInTheDocument();
  });

  it("adds a role goal through the one Add form", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${pm.id}`);
    const goals = (await screen.findByRole("heading", { name: "Role goals" })).closest("section") as HTMLElement;
    expect(within(goals).queryByLabelText("Add a goal for Project Manager")).not.toBeInTheDocument();
    await user.click(within(goals).getByRole("button", { name: "Add role goal" }));
    await user.type(within(goals).getByLabelText("Add a goal for Project Manager"), "Walk the budget every Friday");
    await user.click(within(goals).getByRole("button", { name: "Add role goal" }));
    expect(await within(goals).findByText("Walk the budget every Friday")).toBeInTheDocument();
    expect(within(goals).queryByLabelText("Add a goal for Project Manager")).not.toBeInTheDocument();
  });

  it("puts someone in the role and lists them under Who holds this role", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${superintendent.id}`);
    const holders = (await screen.findByRole("heading", { name: "Who holds this role" })).closest("section") as HTMLElement;
    expect(within(holders).getByRole("link", { name: "Avery Cole" })).toHaveAttribute("href", expect.stringMatching(/^\/people\//));
    expect(within(holders).getByText("RBA South")).toBeInTheDocument();
    expect(within(holders).queryByRole("link", { name: "Kai Bennett" })).not.toBeInTheDocument();
    await user.selectOptions(within(holders).getByLabelText("Put someone in this role"), within(holders).getByRole("option", { name: /Kai Bennett/ }));
    expect(await within(holders).findByRole("link", { name: "Kai Bennett" })).toBeInTheDocument();
    expect(within(list()).getByRole("link", { name: /Site Superintendent/ })).toHaveTextContent("2 people");
  });

  it("says a role from another company is not here, with the list still usable", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${KLASIK.jobRoles[0].id}`);
    expect(await screen.findByText("That role is not in this company.")).toBeInTheDocument();
    await user.click(within(list()).getByRole("link", { name: /Project Manager/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Project Manager" })).toBeInTheDocument();
  });

  it("tells a company with no roles so, and offers Add role", async () => {
    const user = userEvent.setup();
    openRoles(makeHub("admin", { ...RBA.company, id: "co-without-roles" }));
    expect(await screen.findByText(/No job roles yet\./)).toBeInTheDocument();
    expect(screen.queryByText("Nothing matches that.")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add role" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Add a job role"), "Estimator");
    await user.click(within(dialog).getByRole("button", { name: "Add role" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Estimator" })).toBeInTheDocument();
    expect(address()).toMatch(/^\/people\/roles\/role-new-/);
  });

  it("sends two quick module ticks as two writes that land in order", async () => {
    const user = userEvent.setup();
    // The first write is held until the second has been sent, so only the queue keeps the older
    // answer from landing last.
    const original = jobRolesService.updateJobRole;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const spy = vi.spyOn(jobRolesService, "updateJobRole").mockImplementation(async (id, patch) => {
      if (++calls === 1) await held;
      return original(id, patch);
    });
    openRoles(rbaAdmin, `/people/roles/${pm.id}`);
    await user.click(await screen.findByRole("button", { name: "Edit dashboard modules" }));
    const box = screen.getByRole("checkbox", { name: /^Financial figures .* for Project Manager$/ });
    await user.click(box);
    expect(box).toBeChecked();
    await user.click(box);
    expect(box).not.toBeChecked();
    release();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map(([, patch]) => patch)).toEqual([{ dashboard_modules: ["financials"] }, { dashboard_modules: [] }]);
    await waitFor(async () => {
      const stored = (await listJobRoles(RBA.company.id, true)).find((r) => r.id === pm.id)!;
      expect(stored.dashboard_modules).toEqual([]);
    });
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByText("None")).toBeInTheDocument();
    spy.mockRestore();
  });
  it("keeps two writes in order when the role is left and opened again between them", async () => {
    const user = userEvent.setup();
    const original = jobRolesService.updateJobRole;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const spy = vi.spyOn(jobRolesService, "updateJobRole").mockImplementation(async (id, patch) => {
      if (++calls === 1) await held;
      return original(id, patch);
    });
    async function rename(name: string) {
      await user.click(screen.getByRole("button", { name: "Rename role" }));
      const field = screen.getByLabelText(/^Name for /);
      await user.clear(field);
      await user.type(field, name);
      await user.click(screen.getByRole("button", { name: "Done" }));
    }
    openRoles(rbaAdmin, `/people/roles/${pm.id}`);
    await screen.findByRole("heading", { level: 2, name: "Project Manager" });
    await rename("PM first");
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // Away to another role and back: the first write is still out.
    await user.click(within(list()).getByRole("link", { name: /Site Supervisor/ }));
    await screen.findByRole("heading", { level: 2, name: "Site Supervisor" });
    await user.click(within(list()).getByRole("link", { name: /Project Manager/ }));
    await screen.findByRole("heading", { level: 2, name: "Project Manager" });
    await rename("PM second");
    release();
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map(([, patch]) => patch)).toEqual([{ name: "PM first" }, { name: "PM second" }]);
    await waitFor(async () => {
      const stored = (await listJobRoles(RBA.company.id, true)).find((r) => r.id === pm.id)!;
      expect(stored.name).toBe("PM second");
    });
    expect(await screen.findByRole("heading", { level: 2, name: "PM second" })).toBeInTheDocument();
    spy.mockRestore();
    // Put the role back as it was, for the tests that follow.
    await jobRolesService.updateJobRole(pm.id, { name: pm.name });
  });

  it("offers no one a retired role, though it still lists who holds it", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${superintendent.id}`);
    const holders = (await screen.findByRole("heading", { name: "Who holds this role" })).closest("section") as HTMLElement;
    expect(within(holders).getByLabelText("Put someone in this role")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retire" }));
    expect(await screen.findByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(holders).getByRole("link", { name: "Avery Cole" })).toBeInTheDocument();
    expect(within(holders).queryByLabelText("Put someone in this role")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore" }));
    expect(await within(holders).findByLabelText("Put someone in this role")).toBeInTheDocument();
  });

  it("opens no second dialog from a metric's Delete while the role's delete is running", async () => {
    const user = userEvent.setup();
    openRoles(rbaAdmin, `/people/roles/${superintendent.id}`);
    await user.click(await screen.findByRole("button", { name: "Edit metric Safety compliance" }));
    const metricDelete = screen.getByRole("button", { name: "Delete metric Safety compliance" });
    let fail: (err: Error) => void = () => undefined;
    const spy = vi.spyOn(jobRolesService, "deleteJobRole").mockImplementationOnce(() => new Promise<void>((_, reject) => (fail = reject)));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete role" }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));

    // Focus put on the metric's Delete under the scrim opens nothing while the delete runs.
    metricDelete.focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Site Superintendent"?');

    fail(new Error("Failed to fetch"));
    await within(screen.getByRole("dialog")).findByText(/connection dropped/i);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("the Roles gate", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it("turns a manager away from /people/roles", async () => {
    window.history.pushState({}, "", "/people/roles?persona=manager&company=rba");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });
});
