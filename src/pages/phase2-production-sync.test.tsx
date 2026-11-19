// Phase 2 Production sync: a person who may press Sync now (sync_run) but is not an admin sees, above
// the PM capacity card, each enabled Production source with when it was last updated and a Sync now
// button. The stamp is built from the source row alone, because a manager cannot read the connection
// list, so it never reads "Not connected". Admins keep the full source panel; without sync_run, without
// the data sources module, or with no Production source nothing is shown.
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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

import ProductionPage from "./production/ProductionPage.tsx";
import * as syncService from "../services/sync.ts";
import * as connectionsService from "../services/connections.ts";
import { setMockCapabilities } from "../test/mocks/capabilities.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { formatDateTime } from "../lib/format.ts";
import { KINGDOM, makeHub } from "../test/fixtures.ts";
import type { SyncSource } from "../types/database.ts";

const manager = makeHub("manager", KINGDOM.company);
const admin = makeHub("admin", KINGDOM.company);
const route = { path: "/production", pattern: "/production" };
const GOOD = "2026-09-14T15:30:00Z";
const base = KINGDOM.syncSources.find((s) => s.target_module === "pm_capacity")!;

function row(patch: Partial<SyncSource>): SyncSource {
  return { ...base, name: "Sample capacity tab", last_success_at: null, last_attempt_at: null, last_status: null, last_error: null, ...patch };
}

// What RLS gives a manager: the source rows, and an empty connection list.
function manage(rows: SyncSource[]) {
  setMockCapabilities(KINGDOM.company.id, { sync_run: "manager", production_view: "manager" });
  const live = rows.map((r) => ({ ...r }));
  vi.spyOn(syncService, "listSyncSources").mockImplementation(async () => live.map((r) => ({ ...r })));
  const connections = vi.spyOn(connectionsService, "listConnections").mockResolvedValue([]);
  return { live, connections };
}

afterEach(() => vi.restoreAllMocks());

describe("Production sync for people who may sync", () => {
  it("a manager with sync_run sees each enabled Production source with 'Last updated' and its time", async () => {
    manage([row({ last_success_at: GOOD, last_status: "succeeded" }), row({ id: "other", name: "Off tab", enabled: false }), row({ id: "sales", name: "Sales tab", target_module: "sales_reporting" })]);
    renderWithHub(<ProductionPage />, manager, route);
    expect(await screen.findByText("Sample capacity tab")).toBeInTheDocument();
    expect(screen.getByText(`Last updated ${formatDateTime(GOOD)}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Sample capacity tab now" })).toBeEnabled();
    expect(screen.queryByText("Off tab")).not.toBeInTheDocument();
    expect(screen.queryByText("Sales tab")).not.toBeInTheDocument();
  });

  it("a source never synced reads 'Not synced yet'", async () => {
    manage([row({})]);
    renderWithHub(<ProductionPage />, manager, route);
    expect(await screen.findByText("Not synced yet")).toBeInTheDocument();
  });

  it("a source whose last sync failed says so and still shows the last good time", async () => {
    manage([row({ last_success_at: GOOD, last_status: "failed", last_error: "Column missing", last_attempt_at: "2026-09-15T09:00:00Z" })]);
    renderWithHub(<ProductionPage />, manager, route);
    expect(await screen.findByText(`The last sync did not finish. Showing figures from ${formatDateTime(GOOD)}.`)).toBeInTheDocument();
    expect(screen.queryByText(/Column missing/)).not.toBeInTheDocument();
  });

  it("a failed sync with no good time yet says so without a time", async () => {
    manage([row({ last_status: "abandoned", last_attempt_at: "2026-09-15T09:00:00Z" })]);
    renderWithHub(<ProductionPage />, manager, route);
    expect(await screen.findByText("The last sync did not finish. No figures yet.")).toBeInTheDocument();
  });

  it("a running sync reads 'Syncing' and keeps the button disabled", async () => {
    manage([row({ last_success_at: GOOD, last_status: "running", last_attempt_at: "2026-09-15T11:59:00Z" })]);
    renderWithHub(<ProductionPage />, manager, route);
    expect(await screen.findByText("Syncing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Sample capacity tab now" })).toBeDisabled();
  });

  it("a run cut off by the platform reads as did not finish and the button is enabled", async () => {
    manage([row({ last_success_at: GOOD, last_status: "running", last_attempt_at: "2026-09-14T08:00:00Z" })]);
    renderWithHub(<ProductionPage />, manager, route);
    expect(await screen.findByText(`The last sync did not finish. Showing figures from ${formatDateTime(GOOD)}.`)).toBeInTheDocument();
    expect(screen.queryByText("Syncing")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Sample capacity tab now" })).toBeEnabled();
  });

  it("never reads 'Not connected' because the connection list is empty", async () => {
    const { connections } = manage([row({ last_success_at: GOOD, last_status: "succeeded" })]);
    renderWithHub(<ProductionPage />, manager, route);
    await screen.findByText("Sample capacity tab");
    expect(screen.queryByText(/Not connected/)).not.toBeInTheDocument();
    expect(connections).not.toHaveBeenCalled();
  });

  it("Sync now calls requestSync for that source, disables while it runs, then re-reads the sources and shows the new time", async () => {
    const { live } = manage([row({ last_success_at: GOOD, last_status: "succeeded" })]);
    const NEW = "2026-09-15T11:58:00Z";
    let finish: () => void = () => undefined;
    const request = vi.spyOn(syncService, "requestSync").mockImplementation(
      () => new Promise((resolve) => {
        finish = () => {
          live[0].last_success_at = NEW;
          resolve({ status: "succeeded", message: null, rows_applied: 3 });
        };
      }),
    );
    renderWithHub(<ProductionPage />, manager, route);
    const button = await screen.findByRole("button", { name: "Sync Sample capacity tab now" });
    await userEvent.click(button);
    expect(request).toHaveBeenCalledWith(base.id);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sync Sample capacity tab now" })).toBeDisabled());
    expect(screen.getByText(`Last updated ${formatDateTime(GOOD)}`)).toBeInTheDocument();
    finish();
    expect(await screen.findByText(`Last updated ${formatDateTime(NEW)}`)).toBeInTheDocument();
    expect(screen.getByText(/Sample capacity tab synced: 3 rows/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Sample capacity tab now" })).toBeEnabled();
  });

  it("shows the server's plain reason when a sync is refused", async () => {
    manage([row({})]);
    vi.spyOn(syncService, "requestSync").mockRejectedValue(new Error("This company does not have data sources switched on."));
    renderWithHub(<ProductionPage />, manager, route);
    await userEvent.click(await screen.findByRole("button", { name: "Sync Sample capacity tab now" }));
    expect(await screen.findByText("This company does not have data sources switched on.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync Sample capacity tab now" })).toBeEnabled();
  });

  it("a failed result shows a fixed line and never the runner's raw message", async () => {
    manage([row({})]);
    vi.spyOn(syncService, "requestSync").mockResolvedValue({ status: "failed", message: 'Expected a number but found "abc"', rows_applied: 0 });
    renderWithHub(<ProductionPage />, manager, route);
    await userEvent.click(await screen.findByRole("button", { name: "Sync Sample capacity tab now" }));
    expect(await screen.findByText("The sync did not finish. Ask an admin to check the source.")).toBeInTheDocument();
    expect(screen.queryByText(/abc/)).not.toBeInTheDocument();
  });

  it("a locked result shows its info notice", async () => {
    manage([row({})]);
    vi.spyOn(syncService, "requestSync").mockResolvedValue({ status: "locked", message: null, rows_applied: 0 });
    renderWithHub(<ProductionPage />, manager, route);
    await userEvent.click(await screen.findByRole("button", { name: "Sync Sample capacity tab now" }));
    expect(await screen.findByText("A sync is already running for this connection. Try again in a few minutes.")).toBeInTheDocument();
  });

  it("is absent without sync_run", async () => {
    const { live } = manage([row({})]);
    setMockCapabilities(KINGDOM.company.id, { sync_run: "admin", production_view: "manager" });
    const list = vi.spyOn(syncService, "listSyncSources");
    renderWithHub(<ProductionPage />, manager, route);
    await screen.findByRole("heading", { name: "Production" });
    expect(screen.queryByRole("button", { name: /Sync .* now/ })).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
    expect(live).toHaveLength(1);
  });

  it("is absent when the company does not have data sources", async () => {
    manage([row({})]);
    const without = { ...KINGDOM.company, modules: ["production" as const] };
    const hub = { ...makeHub("manager", without), company: without };
    renderWithHub(<ProductionPage />, hub, route);
    await screen.findByRole("heading", { name: "Production" });
    expect(screen.queryByRole("button", { name: /Sync .* now/ })).not.toBeInTheDocument();
    expect(syncService.listSyncSources).not.toHaveBeenCalled();
  });

  it("shows nothing when the company has no Production source", async () => {
    manage([row({ target_module: "sales_reporting" })]);
    renderWithHub(<ProductionPage />, manager, route);
    await screen.findByRole("heading", { name: "Production" });
    await waitFor(() => expect(syncService.listSyncSources).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Sync .* now/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Not synced yet")).not.toBeInTheDocument();
  });

  it("an admin still gets the full source panel as before", async () => {
    renderWithHub(<ProductionPage />, admin, route);
    expect(await screen.findByText("Sample capacity tab")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sync .* now/ })).not.toBeInTheDocument();
    expect(screen.getByText("Connected. No data yet.")).toBeInTheDocument();
  });
});
