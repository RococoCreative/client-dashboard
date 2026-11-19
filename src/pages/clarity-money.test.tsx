// Task 17 of the hub clarity plan: data sources on Settings, Connections become a list with each
// source at its own address once a company holds more than three, and read first inside a source;
// with three or fewer they stay as rows. The gate in front of the Connections tab and the module
// gate stay exactly as they were. The read-first steps added to Projects, Setup, a project's details
// and Wins are proven here too. Rendered against the mocked data layer, as pages.test.tsx is.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/milestoneTemplates.ts", () => import("../test/mocks/milestoneTemplates.ts"));

import App from "../App.tsx";
import { HubContext, type HubValue } from "../context/HubContext.tsx";
import * as syncService from "../services/sync.ts";
import * as templatesService from "../services/milestoneTemplates.ts";
import { KINGDOM, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";
import ProductionSetupPage from "./production/ProductionSetupPage.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import WinsPage from "./WinsPage.tsx";

const kingdomAdmin = makeHub("admin", KINGDOM.company);
const byName = [...KINGDOM.syncSources].sort((a, b) => a.name.localeCompare(b.name));
const source = (name: string) => KINGDOM.syncSources.find((s) => s.name === name)!;
const sourcePath = (name: string) => `/settings/connections/sources/${source(name).id}`;

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

// Settings, Connections at both of its addresses, the way App.tsx routes them.
function renderConnections(hub: HubValue, path = "/settings/connections") {
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/settings/connections" element={<SettingsPage tab="connections" />} />
          <Route path="/settings/connections/sources/:sourceId" element={<SettingsPage tab="connections" />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
        <Where />
      </MemoryRouter>
    </HubContext>,
  );
}

const sourceList = () => screen.getByRole("region", { name: "Data sources" });

describe("data sources as a list, past three", () => {
  it("gives each source its own address", async () => {
    renderConnections(kingdomAdmin);
    await screen.findByRole("heading", { name: "Data sources" });
    const list = await waitFor(() => sourceList());
    for (const s of byName) {
      expect(within(list).getByRole("link", { name: new RegExp(`^${s.name}`) })).toHaveAttribute("href", `/settings/connections/sources/${s.id}`);
    }
  });

  it("opens the first source by itself on a wide screen and leaves the address alone", async () => {
    renderConnections(kingdomAdmin);
    expect(await screen.findByRole("heading", { name: byName[0].name })).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent(/^\/settings\/connections$/);
  });

  it("opens a source at its address, its setup read first behind a pencil", async () => {
    const user = userEvent.setup();
    renderConnections(kingdomAdmin, sourcePath("Sample sales tab"));
    const heading = await screen.findByRole("heading", { name: "Sample sales tab" });
    const detail = heading.closest("article") as HTMLElement;
    expect(within(detail).getByText("Sales reporting")).toBeInTheDocument();
    expect(within(detail).getByText("Contract amount")).toBeInTheDocument();
    expect(within(detail).queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Edit Sample sales tab" }));
    const dialog = screen.getByRole("dialog", { name: "Edit data source" });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("Sample sales tab");
  });

  it("keeps Sync now and Enabled live inside the source, with its recent runs", async () => {
    const user = userEvent.setup();
    renderConnections(kingdomAdmin, sourcePath("Sample sales tab"));
    const detail = (await screen.findByRole("heading", { name: "Sample sales tab" })).closest("article") as HTMLElement;
    expect(within(detail).getByRole("checkbox", { name: "Enable Sample sales tab" })).toBeChecked();
    expect(await within(detail).findByText("Succeeded")).toBeInTheDocument();
    await user.click(within(detail).getByRole("button", { name: "Sync Sample sales tab now" }));
    expect(await screen.findByText("Sample sales tab synced: 2 rows.")).toBeInTheDocument();
  });

  it("says so when the address names a source this company does not hold", async () => {
    renderConnections(kingdomAdmin, "/settings/connections/sources/rba-source-1");
    expect(await screen.findByText("That data source is not in this company.")).toBeInTheDocument();
  });
});

describe("data sources as rows, at three or fewer", () => {
  function onlyThree() {
    const spy = vi.spyOn(syncService, "listSyncSources").mockResolvedValue(byName.slice(0, 3).map((s) => ({ ...s })));
    onTestFinished(() => spy.mockRestore());
  }

  it("stays as rows, with the pencil opening the editor", async () => {
    onlyThree();
    const user = userEvent.setup();
    renderConnections(kingdomAdmin);
    await screen.findByRole("heading", { name: "Data sources" });
    expect(await screen.findByRole("button", { name: `Sync ${byName[0].name} now` })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Data sources" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: new RegExp(`^${byName[0].name}`) })).not.toBeInTheDocument();
    const edit = screen.getByRole("button", { name: `Edit ${byName[1].name}` });
    expect(edit).toHaveAttribute("title", `Edit ${byName[1].name}`);
    await user.click(edit);
    expect(screen.getByRole("dialog", { name: "Edit data source" })).toBeInTheDocument();
  });

  it("sends a source's address back to the rows", async () => {
    onlyThree();
    renderConnections(kingdomAdmin, `/settings/connections/sources/${byName[0].id}`);
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent(/^\/settings\/connections$/));
    expect(await screen.findByRole("button", { name: `Sync ${byName[0].name} now` })).toBeInTheDocument();
  });
});

describe("a source's address keeps the Connections gate", () => {
  async function landing(path: string, persona: "admin" | "employee" | "manager", slug: string): Promise<string> {
    window.history.pushState({}, "", `${path}?persona=${persona}&company=${slug}`);
    render(<App />);
    await screen.findByRole("navigation", { name: "Primary" });
    let last = "";
    let since = 0;
    await waitFor(() => {
      const now = window.location.pathname;
      if (now !== last) {
        last = now;
        since = performance.now();
      }
      if (performance.now() - since < 50) throw new Error("Still redirecting");
    });
    return window.location.pathname;
  }
  const path = `/settings/connections/sources/${KINGDOM.syncSources[0].id}`;

  it("opens for an admin at a company with data sources", async () => {
    expect(await landing(path, "admin", "kingdom")).toBe(path);
    expect(await screen.findByRole("heading", { name: KINGDOM.syncSources[0].name })).toBeInTheDocument();
  });

  it.each([["employee"], ["manager"]] as const)("sends a %s Home", async (persona) => {
    expect(await landing(path, persona, "kingdom")).toBe("/");
  });

  it("sends an admin at a company without data sources to Connections", async () => {
    expect(await landing(path, "admin", "klasik")).toBe("/settings/connections");
  });
});

describe("set-once fields read first", () => {
  it("shows a standard milestone as text, its pencil opening the title, kind and Remove", async () => {
    await templatesService.createMilestoneTemplate(KINGDOM.company.id, { title: "Sample step R", kind: "letter", sort_order: 1 });
    const user = userEvent.setup();
    renderWithHub(<ProductionSetupPage />, kingdomAdmin, { path: "/production/setup", pattern: "/production/setup" });
    const edit = await screen.findByRole("button", { name: "Edit Sample step R" });
    expect(edit).toHaveAttribute("title", "Edit Sample step R");
    const row = edit.closest("li") as HTMLElement;
    expect(within(row).getByText("Sample step R")).toBeInTheDocument();
    expect(within(row).getByText("Letter")).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Move Sample step R up" })).toBeInTheDocument();
    await user.click(edit);
    expect(within(row).getByLabelText("Title of Sample step R")).toHaveValue("Sample step R");
    expect(within(row).getByRole("combobox", { name: "Kind of Sample step R" })).toHaveValue("letter");
    expect(within(row).getByRole("button", { name: "Remove Sample step R" })).toHaveTextContent("Remove");
    await user.click(within(row).getByRole("button", { name: "Done" }));
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows a project's details as text for an admin, each behind its pencil", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" });
    const details = (await screen.findByRole("heading", { name: "Details" })).closest("section") as HTMLElement;
    expect(within(details).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(details).getByText("Sample job 101")).toBeInTheDocument();
    await user.click(within(details).getByRole("button", { name: "Edit name" }));
    expect(within(details).getByLabelText("Project name")).toHaveValue("Sample job 101");
    expect(within(details).getByRole("button", { name: "Archive project" })).toBeInTheDocument();
  });

  it("shows each win as text for an admin, its pencil opening the fields and Remove", async () => {
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, kingdomAdmin, { path: "/wins", pattern: "/wins" });
    const edit = await screen.findByRole("button", { name: "Edit Sample win 1" });
    expect(edit).toHaveAttribute("title", "Edit Sample win 1");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sample win 1" })).not.toBeInTheDocument();
    const row = edit.closest("li") as HTMLElement;
    expect(within(row).getByText("Sample win 1")).toBeInTheDocument();
    await user.click(edit);
    expect(within(row).getByLabelText("Title of Sample win 1")).toHaveValue("Sample win 1");
    expect(within(row).getByLabelText("Won on for Sample win 1")).toHaveValue("2026-09-12");
    expect(within(row).getByRole("button", { name: "Remove Sample win 1" })).toHaveTextContent("Remove");
  });
});
