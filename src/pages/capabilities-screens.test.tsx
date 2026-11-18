// Pay, company settings and the change log on screen: an admin without the pay capability never
// requests or sees compensation, an admin without company_settings has no Company tab and is sent to
// the first tab they may open (through the real router, so a redirect loop would show), a company
// with audit_log for admins gets an Activity tab that asks for its own events only, and the Rococo
// activity page still lists every company. These render real pages; the provider tests live in
// capabilities.test.tsx, which swaps the app shell for a probe.
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi, onTestFinished } from "vitest";

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
import { KINGDOM, makeHub } from "../test/fixtures.ts";
import { setMockCapabilities } from "../test/mocks/capabilities.ts";
import * as auditService from "../services/audit.ts";
import * as employeesService from "../services/employees.ts";
import PersonPage from "./people/PersonPage.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";
import ActivityPage from "./rococo/ActivityPage.tsx";
import { SETTINGS_TABS, settingsTabsFor } from "./settings/settingsTabs.ts";

const kingdom = KINGDOM.company.id;
const adminHub = makeHub("admin", KINGDOM.company);
const ownerHub = makeHub("owner", KINGDOM.company);
const person = { path: "/people/kingdom-user-1", pattern: "/people/:profileId" };

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
    renderWithHub(<PersonPage />, adminHub, person);
    await screen.findByRole("heading", { name: "Financial figures" });
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
});

it("an owner still sees compensation", async () => {
  setMockCapabilities(kingdom, { pay: "owner" });
  const compensation = vi.spyOn(employeesService, "listCompensation");
  onTestFinished(() => compensation.mockRestore());
  renderWithHub(<PersonPage />, ownerHub, person);
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
    renderWithHub(<SettingsPage tab="roles" />, adminHub, { path: "/settings/roles", pattern: "/settings/roles" });
    const nav = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Roles", "Reviews", "Connections"]);
    expect(within(nav).queryByRole("link", { name: "Company" })).toBeNull();
    expect(settingsTabsFor(adminHub.can).map((t) => t.key)).toEqual(["roles", "reviews", "connections"]);
  });

  it("lands on Roles from /settings", async () => {
    signInThrough("/settings");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/roles"));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });

  it("is sent to Roles from /settings/company", async () => {
    signInThrough("/settings/company");
    await waitFor(() => expect(window.location.pathname).toBe("/settings/roles"));
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Company" })).toBeNull();
  });
});

it("lists five tabs in all, an admin by default gets four with Company first, and Rococo stepped in gets all five", () => {
  expect(SETTINGS_TABS.map((t) => t.key)).toEqual(["company", "roles", "reviews", "connections", "activity"]);
  expect(settingsTabsFor(adminHub.can).map((t) => t.key)).toEqual(["company", "roles", "reviews", "connections"]);
  expect(settingsTabsFor(makeHub("rococo", KINGDOM.company).can).map((t) => t.key)).toEqual(["company", "roles", "reviews", "connections", "activity"]);
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
    expect(await screen.findByText(/^companies: modules/)).toBeInTheDocument();
    expect(screen.queryByText(/^invitations: added/)).toBeNull();
  });

  it("an admin without audit_log has no Activity tab and /settings/activity sends them to their first tab", async () => {
    const hub = makeHub("admin", KINGDOM.company);
    renderWithHub(<SettingsPage tab="roles" />, hub, { path: "/settings/roles", pattern: "/settings/roles" });
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
