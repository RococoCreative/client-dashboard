// The Rococo Permissions page against the mocked capabilities store: the grid reads what the
// database returned, a change is written, re-read and then shown from that re-read, the changed
// level is what loadCapabilities then returns for the company, and only a Rococo admin gets in.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/capabilities.ts", async () => {
  const mock = await import("../test/mocks/capabilities.ts");
  return {
    ...mock,
    setCompanyCapability: vi.fn(mock.setCompanyCapability),
    clearCompanyCapability: vi.fn(mock.clearCompanyCapability),
    listAllCompanyCapabilities: vi.fn(mock.listAllCompanyCapabilities),
  };
});

import App from "../App.tsx";
import PermissionsPage from "./rococo/PermissionsPage.tsx";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { COMPANIES, makeHub } from "../test/fixtures.ts";
import { setMockCapabilities } from "../test/mocks/capabilities.ts";
import {
  clearCompanyCapability,
  listAllCompanyCapabilities,
  loadCapabilities,
  setCompanyCapability,
} from "../services/capabilities.ts";

const kingdom = "co-kingdom";
const rococo = makeHub("rococo", null);
const set = vi.mocked(setCompanyCapability);
const clear = vi.mocked(clearCompanyCapability);
const reread = vi.mocked(listAllCompanyCapabilities);
const realSet = set.getMockImplementation()!;
const realClear = clear.getMockImplementation()!;
const realReread = reread.getMockImplementation()!;

beforeEach(() => {
  set.mockReset().mockImplementation(realSet);
  clear.mockReset().mockImplementation(realClear);
  reread.mockReset().mockImplementation(realReread);
});

function open() {
  return renderWithHub(<PermissionsPage />, rococo, { path: "/rococo/permissions", pattern: "/rococo/permissions" });
}

async function cell(capability: string, company: string) {
  return (await screen.findByRole("combobox", { name: `${capability} for ${company}` })) as HTMLSelectElement;
}
const shown = (el: HTMLSelectElement) => el.options[el.selectedIndex].text;
const optionNames = (el: HTMLSelectElement) => [...el.options].map((o) => o.text);

describe("the Permissions page", () => {
  it("shows seven rows, the default column and a column per company, all on Default with no overrides", async () => {
    open();
    await cell("See pay", "Kingdom Custom Construction");
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(8);
    const headers = within(rows[0]).getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Permission", "Default", ...COMPANIES.map((c) => c.name)]);
    expect(within(rows[1]).getByText("See pay")).toBeInTheDocument();
    expect(within(rows[1]).getAllByRole("cell")[0]).toHaveTextContent("Admins and owners");
    expect(within(rows[3]).getAllByRole("cell")[0]).toHaveTextContent("Rococo only");
    for (const select of screen.getAllByRole("combobox")) expect(shown(select as HTMLSelectElement)).toBe("Default");
    expect(screen.getAllByRole("combobox")).toHaveLength(7 * COMPANIES.length);
    expect(screen.getByText(/Each permission is the lowest role that holds it/)).toBeInTheDocument();
  });

  it("shows a company's own level and marks it as differing from the default", async () => {
    setMockCapabilities(kingdom, { pay: "owner" });
    open();
    const king = await cell("See pay", "Kingdom Custom Construction");
    expect(shown(king)).toBe("Owners only");
    expect(king).toHaveAttribute("data-differs", "true");
    const klasik = await cell("See pay", "Klasik Construction");
    expect(shown(klasik)).toBe("Default");
    expect(klasik).not.toHaveAttribute("data-differs");
  });

  it("writes the change, re-reads, and reports it", async () => {
    const user = userEvent.setup();
    open();
    const el = await cell("Edit milestones", "Kingdom Custom Construction");
    await user.selectOptions(el, "Managers and up");
    expect(set).toHaveBeenCalledWith(kingdom, "milestones_edit", "manager");
    expect(await screen.findByText("Saved. Edit milestones for Kingdom Custom Construction: Managers and up.")).toBeInTheDocument();
    expect(reread).toHaveBeenCalledTimes(2);
    expect(shown(await cell("Edit milestones", "Kingdom Custom Construction"))).toBe("Managers and up");
  });

  it("applies: the changed level is what the company then loads", async () => {
    const user = userEvent.setup();
    open();
    expect((await loadCapabilities(kingdom)).milestones_edit).toBe("admin");
    await user.selectOptions(await cell("Edit milestones", "Kingdom Custom Construction"), "Managers and up");
    await screen.findByText(/^Saved\./);
    expect((await loadCapabilities(kingdom)).milestones_edit).toBe("manager");
  });

  it("clears an override when Default is chosen", async () => {
    setMockCapabilities(kingdom, { wins_post: "employee" });
    const user = userEvent.setup();
    open();
    const el = await cell("Record wins", "Kingdom Custom Construction");
    expect(shown(el)).toBe("Everyone");
    await user.selectOptions(el, "Default");
    expect(clear).toHaveBeenCalledWith(kingdom, "wins_post");
    expect(await screen.findByText("Saved. Record wins for Kingdom Custom Construction: Default.")).toBeInTheDocument();
    expect(shown(await cell("Record wins", "Kingdom Custom Construction"))).toBe("Default");
    expect((await loadCapabilities(kingdom)).wins_post).toBe("admin");
  });

  it("shows what the re-read returned, and says Not changed when it differs from the pick", async () => {
    set.mockImplementation(async (companyId, capability, level) => ({ id: "x", company_id: companyId, capability, min_role: level }));
    const user = userEvent.setup();
    open();
    await user.selectOptions(await cell("Edit milestones", "Kingdom Custom Construction"), "Managers and up");
    expect(await screen.findByText("Not changed. Edit milestones for Kingdom Custom Construction is still Default.")).toBeInTheDocument();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
    expect(shown(await cell("Edit milestones", "Kingdom Custom Construction"))).toBe("Default");
  });

  it("says Not changed when a clear leaves the row in place", async () => {
    setMockCapabilities(kingdom, { wins_post: "employee" });
    clear.mockImplementation(async () => undefined);
    const user = userEvent.setup();
    open();
    await user.selectOptions(await cell("Record wins", "Kingdom Custom Construction"), "Default");
    expect(await screen.findByText("Not changed. Record wins for Kingdom Custom Construction is still Everyone.")).toBeInTheDocument();
    expect(screen.queryByText(/^Saved\./)).toBeNull();
    expect(shown(await cell("Record wins", "Kingdom Custom Construction"))).toBe("Everyone");
  });

  it("drops a read started before a save that lands after the save's re-read", async () => {
    const user = userEvent.setup();
    open();
    await cell("Edit milestones", "Kingdom Custom Construction");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    reread.mockImplementationOnce(async () => {
      const before = await realReread();
      await gate;
      return before;
    });
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(reread).toHaveBeenCalledTimes(2));
    await user.selectOptions(await cell("Edit milestones", "Kingdom Custom Construction"), "Managers and up");
    await screen.findByText("Saved. Edit milestones for Kingdom Custom Construction: Managers and up.");
    await act(async () => release());
    expect(shown(await cell("Edit milestones", "Kingdom Custom Construction"))).toBe("Managers and up");
  });

  it("shows a friendly line and the stored value when the write is rejected", async () => {
    set.mockRejectedValue(new Error("new row violates row-level security policy"));
    const user = userEvent.setup();
    open();
    const el = await cell("Edit milestones", "Kingdom Custom Construction");
    await user.selectOptions(el, "Managers and up");
    expect(await screen.findByText("You do not have permission to do that.")).toBeInTheDocument();
    expect(shown(await cell("Edit milestones", "Kingdom Custom Construction"))).toBe("Default");
    expect(el).toBeEnabled();
  });

  it("says the change was saved when only the refresh fails, and Reload runs the load again", async () => {
    const user = userEvent.setup();
    open();
    const el = await cell("Edit milestones", "Kingdom Custom Construction");
    reread.mockRejectedValueOnce(new Error("offline"));
    await user.selectOptions(el, "Managers and up");
    expect(await screen.findByText(/saved, but the page could not refresh/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.queryByText(/could not refresh/i)).toBeNull());
    expect(shown(await cell("Edit milestones", "Kingdom Custom Construction"))).toBe("Managers and up");
  });

  it("offers each capability only the levels it may take", async () => {
    open();
    const company = "Kingdom Custom Construction";
    expect(optionNames(await cell("Press Sync now", company))).toEqual(["Default", "Everyone", "Managers and up", "Admins and owners"]);
    expect(optionNames(await cell("Read the change log", company))).toEqual(["Default", "Admins and owners", "Owners only", "Rococo only"]);
    expect(optionNames(await cell("See pay", company))).toEqual(["Default", "Admins and owners", "Owners only"]);
  });

  it("keeps a stored level outside the allowed list selected", async () => {
    setMockCapabilities(kingdom, { pay: "manager" });
    open();
    expect(shown(await cell("See pay", "Kingdom Custom Construction"))).toBe("Managers and up");
  });

  it("says so when no permissions are defined", async () => {
    const catalog = await import("../services/capabilities.ts");
    const spy = vi.spyOn(catalog, "listCapabilityCatalog").mockResolvedValue([]);
    open();
    expect(await screen.findByText("No permissions are defined yet.")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("the Permissions route", () => {
  it("sends a company admin away", async () => {
    window.history.pushState({}, "", "/rococo/permissions?persona=admin&company=kingdom");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).not.toBe("/rococo/permissions"));
    expect(screen.queryByRole("heading", { name: "Permissions" })).toBeNull();
  });

  it("lists Permissions between People and Activity in the sidebar and the tab strip", async () => {
    window.history.pushState({}, "", "/rococo/permissions?persona=rococo");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Permissions" })).toBeInTheDocument();
    for (const name of ["Sections"]) {
      const labels = within(screen.getByRole("navigation", { name })).getAllByRole("link").map((l) => l.textContent);
      expect(labels).toEqual(["Portfolio", "Companies", "People", "Permissions", "Activity"]);
    }
    const links = screen.getAllByRole("link").map((l) => l.textContent);
    const i = links.indexOf("Permissions");
    expect(links.slice(i - 1, i + 2)).toEqual(["People", "Permissions", "Activity"]);
  });
});
