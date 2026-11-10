// Financials, marketing and the Rococo portfolio, checked the way people use them: a figure
// that will not save is named instead of stored as a zero, an import file that cannot be read
// safely is refused with the reason, a hand edit is marked as one, the trend chart stays inside
// its box, budget totals agree across screens, and roster rows are people, not accounts.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createSnapshot, listSnapshots } from "../services/financials.ts";
import { createCampaign, listCampaigns } from "../services/marketing.ts";
import { ALL_PROFILES, KLASIK, makeHub } from "../test/fixtures.ts";
import { formatMoney } from "../lib/format.ts";
import FinancialsPage from "./FinancialsPage.tsx";
import MarketingPage from "./MarketingPage.tsx";
import ResourcesPage from "./resources/ResourcesPage.tsx";
import PortfolioPage from "./rococo/PortfolioPage.tsx";
import UsersPage from "./rococo/UsersPage.tsx";

const admin = makeHub("admin");
const rococo = makeHub("rococo", null);
const klasikId = KLASIK.company.id;

function rowFor(label: string): HTMLElement {
  return screen.getAllByText(label).map((el) => el.closest("tr")).find((tr): tr is HTMLTableRowElement => tr !== null)!;
}

describe("financials", () => {
  it("names a figure it cannot read in the period dialog instead of saving it as zero", async () => {
    const user = userEvent.setup();
    const before = (await listSnapshots(klasikId)).length;
    renderWithHub(<FinancialsPage />, admin);
    await user.click(await screen.findByRole("button", { name: /Add period/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Revenue"), "100000");
    await user.type(within(dialog).getByLabelText("Direct costs (COGS)"), "6O000");
    await user.click(within(dialog).getByRole("button", { name: "Save period" }));
    expect(await within(dialog).findByText("Enter direct costs as a number, like 268000.")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Direct costs (COGS)"));
    await user.type(within(dialog).getByLabelText("Direct costs (COGS)"), "60000");
    await user.type(within(dialog).getByLabelText("Cash on hand (optional)"), "1000000000000");
    await user.click(within(dialog).getByRole("button", { name: "Save period" }));
    expect(await within(dialog).findByText("Check cash on hand: the figure is too large to save.")).toBeInTheDocument();
    expect(await listSnapshots(klasikId)).toHaveLength(before);
  });

  it("marks an imported period as entered by hand once a figure is changed, and not for a note", async () => {
    const user = userEvent.setup();
    renderWithHub(<FinancialsPage />, admin);
    await screen.findByText("Jun 2026");
    expect(within(rowFor("Jun 2026")).getByText("CSV")).toBeInTheDocument();
    expect(within(rowFor("May 2026")).getByText("CSV")).toBeInTheDocument();

    await user.click(within(rowFor("Jun 2026")).getByRole("button", { name: "Edit period" }));
    let dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Changing a figure marks this period as entered by hand/)).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Direct costs (COGS)"));
    await user.type(within(dialog).getByLabelText("Direct costs (COGS)"), "300000");
    await user.click(within(dialog).getByRole("button", { name: "Save period" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowFor("Jun 2026")).queryByText("CSV")).not.toBeInTheDocument();

    await user.click(within(rowFor("May 2026")).getByRole("button", { name: "Edit period" }));
    dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Notes"), "Checked against the bank statement.");
    await user.click(within(dialog).getByRole("button", { name: "Save period" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(rowFor("May 2026")).getByText("CSV")).toBeInTheDocument();
  });

  it("keeps a net bar taller than any revenue inside the trend chart", async () => {
    await createSnapshot({ company_id: klasikId, period_type: "month", period_start: "2026-09-01", period_end: "2026-09-30", revenue: 450000, cogs: 0, opex: 0, net_profit: 2500000, source: "csv" });
    renderWithHub(<FinancialsPage />, admin);
    const chart = await screen.findByRole("img", { name: "Revenue and net profit by period" });
    const heights = [...chart.querySelectorAll<HTMLElement>("[style]")].map((el) => parseFloat(el.style.height));
    expect(heights.length).toBeGreaterThan(0);
    expect(Math.max(...heights)).toBeLessThanOrEqual(100);
    // The tallest bar is the net that set the scale, not a revenue squashed under it.
    expect(Math.max(...heights)).toBe(100);
  });

  it("refuses an import file it cannot read safely and says why", async () => {
    const user = userEvent.setup();
    renderWithHub(<FinancialsPage />, admin);
    await user.click(await screen.findByRole("button", { name: /Import CSV/ }));
    const box = screen.getByLabelText("CSV text");

    fireEvent.change(box, { target: { value: "period;revenue;cogs;opex\n2026-01;1000;500;200\n" } });
    expect(await screen.findByText(/separated by semicolons, not commas/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 periods" })).toBeDisabled();

    fireEvent.change(box, { target: { value: 'period,revenue,notes\nFeb 2026,200000,"draw pending\nMar 2026,210000,ok\n' } });
    expect(await screen.findByText(/Line 2: a quote opens here and never closes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 periods" })).toBeDisabled();

    fireEvent.change(box, {
      target: { value: 'period,revenue,cogs,opex,notes\nFeb 2026,100,1,1,"draw pending\nMar 2026,210000,100000,50000,ok\nApr 2026,300,3,3,"Paid, on time"\n' },
    });
    expect(await screen.findByText(/Line 2: a quote opens here and does not close until partway through a cell on line 4/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 periods" })).toBeDisabled();

    fireEvent.change(box, { target: { value: "Period,Revenue (Actual),Revenue (Budget)\nJan 2026,100000,250000\n" } });
    expect(await screen.findByText(/both read as revenue/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 periods" })).toBeDisabled();

    fireEvent.change(box, { target: { value: "Period,Income (Actual),Revenue (Budget)\nJan 2026,100000,250000\n" } });
    expect(await screen.findByText('The columns "Income (Actual)" and "Revenue (Budget)" both read as revenue. Rename or remove one, then import again.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 periods" })).toBeDisabled();

    fireEvent.change(box, { target: { value: "period,revenue,cogs,opex\nSep 2026,100000,6O000,20000\n" } });
    expect(await screen.findByText('Line 2: direct costs "6O000" is not a number.')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import 0 periods" })).toBeDisabled();
  });

  it("styles the period type filters with the shared chip and says which is on", async () => {
    renderWithHub(<FinancialsPage />, admin);
    expect(await screen.findByRole("button", { name: /^Monthly/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Quarterly (2)" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("marketing", () => {
  it("names a budget or metric it cannot read instead of saving it blank", async () => {
    const user = userEvent.setup();
    const before = (await listCampaigns(klasikId)).length;
    renderWithHub(<MarketingPage />, admin);
    await user.click(await screen.findByRole("button", { name: /New campaign/ }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Campaign"), "Truck wraps");
    await user.type(within(dialog).getByLabelText("Budget"), "12,OOO");
    await user.click(within(dialog).getByRole("button", { name: "Add campaign" }));
    expect(await within(dialog).findByText("Enter the budget as a number, like 12000.")).toBeInTheDocument();

    await user.clear(within(dialog).getByLabelText("Budget"));
    await user.type(within(dialog).getByLabelText("Budget"), "12,000");
    await user.type(within(dialog).getByLabelText("Key metric value"), "27 leads");
    await user.click(within(dialog).getByRole("button", { name: "Add campaign" }));
    expect(await within(dialog).findByText("Enter the key metric value as a number, like 27.")).toBeInTheDocument();
    expect(await listCampaigns(klasikId)).toHaveLength(before);
  });
});

describe("rococo portfolio", () => {
  it("reads a company's live budget the same way its Marketing board does", async () => {
    await createCampaign({ company_id: klasikId, name: "Truck wraps", status: "active", budget: null, actual_spend: 8000 });
    renderWithHub(<PortfolioPage />, rococo, { path: "/rococo", pattern: "/rococo" });
    const card = (await screen.findByRole("heading", { name: KLASIK.company.name })).closest("li") as HTMLElement;
    // Klasik's two budgeted live campaigns: $17,000 of budget and $9,500 spent. The truck wraps'
    // $8,000 has no budget to be measured against, so it is counted apart, not added to spend.
    expect(within(card).getByText(`${formatMoney(9500, true)} of ${formatMoney(17000, true)} · 1 with no budget set`)).toBeInTheDocument();
  });

  it("counts people, not accounts, and says how many have not signed in", async () => {
    renderWithHub(<PortfolioPage />, rococo, { path: "/rococo", pattern: "/rococo" });
    expect(await screen.findByText(/^Active people, \d+ not signed in yet$/)).toBeInTheDocument();
    expect(screen.queryByText(/accounts/)).not.toBeInTheDocument();
  });

  it("marks everyone on the People tab who has not signed in yet", async () => {
    renderWithHub(<UsersPage />, rococo, { path: "/rococo/people", pattern: "/rococo/people" });
    await screen.findByText("Austin Rococo (you)");
    const waiting = ALL_PROFILES.filter((p) => p.user_id === null);
    expect(waiting.length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not signed in yet")).toHaveLength(waiting.length);
    expect(within(rowFor(waiting[0].full_name!)).getByText("Not signed in yet")).toBeInTheDocument();
    expect(screen.queryByText(/Every account/)).not.toBeInTheDocument();
  });
});

describe("filter chips", () => {
  it("uses the shared chip for SOP categories", async () => {
    renderWithHub(<ResourcesPage tab="sops" />, admin, { path: "/resources/sops", pattern: "/resources/sops" });
    expect(await screen.findByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  });

  it("filters resources by a tag from the row of chips or from a card", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage tab="files" />, admin, { path: "/resources/files", pattern: "/resources/files" });
    const all = await screen.findByRole("button", { name: "All" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    const [cardTag] = screen.getAllByRole("button", { name: /^Filter by tag / });
    await user.click(cardTag);
    expect(all).toHaveAttribute("aria-pressed", "false");
  });
});
