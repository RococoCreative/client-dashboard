// Phase 2 company settings on Rococo > Companies: how many days a win stays on Home, and whether a
// company keeps the manual Financials page. Both save through the page's own write queue, one
// company at a time, and a bad number is refused with a plain line before anything is sent. Also
// the screens that read the days: the Home wins card and the Wins page with its Archive.
import { screen, waitFor, within } from "@testing-library/react";
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

import CompaniesPage from "./rococo/CompaniesPage.tsx";
import WinsPage from "./WinsPage.tsx";
import WinsCard from "../components/home/WinsCard.tsx";
import * as winsService from "../services/wins.ts";
import * as companiesService from "../services/companies.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import { KINGDOM, makeHub } from "../test/fixtures.ts";

const rococo = makeHub("rococo", null);

function open() {
  return renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
}

async function daysField(company: string) {
  const group = await screen.findByRole("group", { name: `Display settings for ${company}` });
  return within(group).getByLabelText("Days a win stays on Home") as HTMLInputElement;
}

afterEach(async () => {
  // The mock store is shared across tests, so put it back.
  for (const id of ["co-kingdom", "co-klasik", "co-rba"]) {
    await companiesService.updateCompany(id, { wins_home_days: null, manual_financials: true });
  }
});

describe("Rococo Companies display settings", () => {
  it("saves 14 days for a company on blur and shows it after a reload of the list", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(companiesService, "updateCompany");
    const view = open();
    const field = await daysField("Klasik Construction");
    expect(field.value).toBe("");
    await user.type(field, "14");
    await user.tab();
    await waitFor(() => expect(spy).toHaveBeenCalledWith("co-klasik", { wins_home_days: 14 }));
    expect((await companiesService.getCompany("co-klasik")).wins_home_days).toBe(14);
    // A fresh render reads the stored value back.
    view.unmount();
    open();
    await waitFor(async () => expect((await screen.findAllByLabelText("Days a win stays on Home")).some((el) => (el as HTMLInputElement).value === "14")).toBe(true));
    spy.mockRestore();
  });

  it("clears the days back to blank as null", async () => {
    const user = userEvent.setup();
    await companiesService.updateCompany("co-klasik", { wins_home_days: 14 });
    const spy = vi.spyOn(companiesService, "updateCompany");
    open();
    const field = await daysField("Klasik Construction");
    expect(field.value).toBe("14");
    await user.clear(field);
    await user.tab();
    await waitFor(() => expect(spy).toHaveBeenCalledWith("co-klasik", { wins_home_days: null }));
    spy.mockRestore();
  });

  it("refuses 0 and negative days with a plain line and does not save", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(companiesService, "updateCompany");
    open();
    const field = await daysField("Klasik Construction");
    await user.type(field, "0");
    await user.tab();
    expect(await screen.findByText("Enter a whole number of days, 1 or more, or leave it blank.")).toBeInTheDocument();
    await user.clear(field);
    await user.type(field, "-3");
    await user.tab();
    expect(screen.getByText("Enter a whole number of days, 1 or more, or leave it blank.")).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    expect(field.value).toBe("");
    spy.mockRestore();
  });

  it("switches manual Financials off for one company only", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(companiesService, "updateCompany");
    open();
    const group = await screen.findByRole("group", { name: "Display settings for Klasik Construction" });
    const box = within(group).getByRole("checkbox", { name: "Manual Financials page" });
    expect(box).toBeChecked();
    await user.click(box);
    await waitFor(() => expect(spy).toHaveBeenCalledWith("co-klasik", { manual_financials: false }));
    await waitFor(() => expect(within(group).getByRole("checkbox", { name: "Manual Financials page" })).not.toBeChecked());
    const other = within(screen.getByRole("group", { name: "Display settings for Kingdom Custom Construction" })).getByRole("checkbox", { name: "Manual Financials page" });
    expect(other).toBeChecked();
    expect((await companiesService.getCompany("co-kingdom")).manual_financials).toBe(true);
    spy.mockRestore();
  });
});

// Kingdom's sample wins: 09-12, 09-05, 08-28, 08-20, a removed one on 08-11, 07-30, 07-15. The test
// clock is 2026-09-15 12:00Z, which is the 15th in New York and the 16th in Kiritimati.
describe("wins leave Home after the company's days", () => {
  const withDays = (days: number | null, time_zone = "America/New_York") => ({ ...KINGDOM.company, wins_home_days: days, time_zone });
  const adminFor = (company: ReturnType<typeof withDays>) => makeHub("admin", company);
  const winsRoute = { path: "/wins", pattern: "/wins" };
  const originals = new Map<string, string>();

  // Move two sample wins onto the edge of a 14 day window and put them back after.
  async function setEdge() {
    const all = await winsService.listWins("co-kingdom");
    for (const [title, won_on] of [["Sample win 2", "2026-09-02"], ["Sample win 3", "2026-09-01"]] as const) {
      const win = all.find((w) => w.title === title)!;
      originals.set(win.id, win.won_on);
      await winsService.updateWin(win.id, { won_on });
    }
  }
  afterEach(async () => {
    for (const [id, won_on] of originals) await winsService.updateWin(id, { won_on });
    originals.clear();
  });

  it("the Home card shows a win won 13 days ago and not one won 14 days ago", async () => {
    await setEdge();
    renderWithHub(<WinsCard company={withDays(14)} />, adminFor(withDays(14)));
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    expect(screen.getByText("Sample win 2")).toBeInTheDocument();
    expect(screen.queryByText("Sample win 3")).not.toBeInTheDocument();
  });

  it("the Home card with no setting still shows the five newest", async () => {
    renderWithHub(<WinsCard company={withDays(null)} />, adminFor(withDays(null)));
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    for (const n of [1, 2, 3, 4, 6]) expect(screen.getByText(`Sample win ${n}`)).toBeInTheDocument();
    expect(screen.queryByText("Sample win 7")).not.toBeInTheDocument();
  });

  it("the Wins page has Recent and Archive when the company has a setting, and one list when it does not", async () => {
    const user = userEvent.setup();
    const view = renderWithHub(<WinsPage />, adminFor(withDays(14)), winsRoute);
    expect(await screen.findByRole("tab", { name: "Recent" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Archive" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Sample win 2")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Sample win 3")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Archive" }));
    expect(await screen.findByDisplayValue("Sample win 3")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Sample win 2")).not.toBeInTheDocument();
    view.unmount();

    renderWithHub(<WinsPage />, adminFor(withDays(null)), winsRoute);
    expect(await screen.findByDisplayValue("Sample win 1")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Sample win 7")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("Archive lists wins older than the cut-off, newest first, and never a win an admin removed", async () => {
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, makeHub("employee", withDays(14)), winsRoute);
    await user.click(await screen.findByRole("tab", { name: "Archive" }));
    expect(await screen.findByText("Sample win 3")).toBeInTheDocument();
    const titles = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    const order = [3, 4, 6, 7].map((n) => titles.findIndex((t) => t.includes(`Sample win ${n}`)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.queryByText("Sample win 5")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample win 1")).not.toBeInTheDocument();
  });

  it("an empty Archive says so plainly", async () => {
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, adminFor(withDays(365)), winsRoute);
    await user.click(await screen.findByRole("tab", { name: "Archive" }));
    expect(await screen.findByText("No older wins yet.")).toBeInTheDocument();
  });

  it("uses the company's day, not the browser's", async () => {
    await setEdge();
    // 12:00Z is already the 16th in Kiritimati, so the 14 day window starts on the 3rd and the
    // win from the 2nd has left Home; in New York it is still the 15th and the win stays.
    const { unmount } = renderWithHub(<WinsCard company={withDays(14, "Pacific/Kiritimati")} />, adminFor(withDays(14, "Pacific/Kiritimati")));
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    expect(screen.queryByText("Sample win 2")).not.toBeInTheDocument();
    unmount();
    renderWithHub(<WinsCard company={withDays(14, "America/New_York")} />, adminFor(withDays(14, "America/New_York")));
    expect(await screen.findByText("Sample win 2")).toBeInTheDocument();
  });
});
