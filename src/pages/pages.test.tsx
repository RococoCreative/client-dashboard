// Every page renders real content against the mocked data layer, for an admin and, where it
// differs, an employee. The mocks mirror the services module for module, so a page calling a
// service that does not exist fails here rather than in someone's browser.
import { fireEvent, screen, within } from "@testing-library/react";
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

import { renderWithHub } from "../test/renderWithHub.tsx";
import { COMPANIES, KLASIK, makeHub } from "../test/fixtures.ts";
import DashboardPage from "./DashboardPage.tsx";
import GsrCyclesPage from "./gsr/GsrCyclesPage.tsx";
import CyclePage from "./gsr/CyclePage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import GsrSettingsPage from "./gsr/GsrSettingsPage.tsx";
import CompanyGoalsPage from "./gsr/CompanyGoalsPage.tsx";
import MyGsrPage from "./gsr/MyGsrPage.tsx";
import MyGoalsPage from "./gsr/MyGoalsPage.tsx";
import PeoplePage from "./people/PeoplePage.tsx";
import PersonPage from "./people/PersonPage.tsx";
import SopListPage from "./sops/SopListPage.tsx";
import SopPage from "./sops/SopPage.tsx";
import SopEditPage from "./sops/SopEditPage.tsx";
import ResourcesPage from "./ResourcesPage.tsx";
import CompanySettingsPage from "./CompanySettingsPage.tsx";
import PortfolioPage from "./rococo/PortfolioPage.tsx";
import CompaniesPage from "./rococo/CompaniesPage.tsx";
import UsersPage from "./rococo/UsersPage.tsx";
import FinancialsPage from "./FinancialsPage.tsx";
import MarketingPage from "./MarketingPage.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rococo = makeHub("rococo", null);
const currentCycle = KLASIK.cycles[0];
const inProgressReview = KLASIK.reviews.find((r) => r.status === "in_progress")!;
const employeeProfile = KLASIK.profiles[1];

describe("dashboard", () => {
  it("summarizes the company for an admin", async () => {
    renderWithHub(<DashboardPage />, admin);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText(currentCycle.name)).toBeInTheDocument();
    expect(await screen.findByText("Closed sales")).toBeInTheDocument();
    expect(await screen.findByText("Jobsite safety walk")).toBeInTheDocument();
    expect(screen.getByText("Sam Ortega")).toBeInTheDocument();
    expect(await screen.findByText("Aug 2026")).toBeInTheDocument();
    expect(await screen.findByText("2 live campaigns")).toBeInTheDocument();
  });

  it("shows an employee their own score and goals only", async () => {
    renderWithHub(<DashboardPage />, employee);
    expect(await screen.findByText(/Welcome back, Sam/)).toBeInTheDocument();
    expect(await screen.findByText("Run the weekly client update without prompting")).toBeInTheDocument();
    expect(screen.queryByText("Closed sales")).not.toBeInTheDocument();
    expect(screen.queryByText("Riley Park")).not.toBeInTheDocument();
  });
});

describe("GSR", () => {
  it("lists cycles with progress", async () => {
    renderWithHub(<GsrCyclesPage />, admin);
    expect(await screen.findByText(currentCycle.name)).toBeInTheDocument();
    expect(await screen.findByText(KLASIK.cycles[1].name)).toBeInTheDocument();
    expect(screen.getAllByText(/complete$/).length).toBeGreaterThan(0);
  });

  it("shows the team table for a cycle with pillar columns", async () => {
    renderWithHub(<CyclePage />, admin, { path: `/gsr/cycles/${currentCycle.id}`, pattern: "/gsr/cycles/:cycleId" });
    expect(await screen.findByRole("heading", { name: currentCycle.name })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Brand Impact")).toBeInTheDocument();
    expect(within(table).getByText("Sam Ortega")).toBeInTheDocument();
    expect(within(table).getByText("Start review")).toBeInTheDocument();
  });

  it("lets an admin rate a criterion and the overall score updates", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /^Score/ })).toBeInTheDocument();
    const group = await screen.findByRole("radiogroup", { name: "Culture Vision rating" });
    await user.click(within(group).getByRole("radio", { name: "5 of 5" }));
    expect(await within(group).findByText("5/5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Mark complete/ })).toBeInTheDocument();
  });

  it("renders the same review read-only for the employee it belongs to", async () => {
    renderWithHub(<ReviewPage />, employee, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark complete/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Your reflection")).toBeInTheDocument();
  });

  it("shows pillars, weights, and criteria in settings", async () => {
    renderWithHub(<GsrSettingsPage />, admin);
    expect(await screen.findByText("Weights total 100%")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Deliverables")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Curiosity")).toBeInTheDocument();
  });

  it("lists company goals for the year", async () => {
    renderWithHub(<CompanyGoalsPage />, admin);
    expect(await screen.findByText("Gross margin")).toBeInTheDocument();
    expect(await screen.findByText("Hit")).toBeInTheDocument();
  });

  it("shows an employee their review history and goals", async () => {
    renderWithHub(<MyGsrPage />, employee);
    expect(await screen.findByRole("heading", { name: "My GSR" })).toBeInTheDocument();
    expect(await screen.findByText("All reviews")).toBeInTheDocument();
    expect((await screen.findAllByText(currentCycle.name)).length).toBeGreaterThan(0);
  });

  it("lets an employee tick an action step", async () => {
    const user = userEvent.setup();
    renderWithHub(<MyGoalsPage />, employee);
    const step = await screen.findByLabelText("Ask two clients how it landed");
    expect(step).not.toBeChecked();
    await user.click(step);
    expect(await screen.findByLabelText("Ask two clients how it landed")).toBeChecked();
  });
});

describe("people", () => {
  it("lists people and pending invitations", async () => {
    renderWithHub(<PeoplePage />, admin);
    expect(await screen.findByText("Jordan Vale (you)")).toBeInTheDocument();
    expect(await screen.findByText("new.hire@beklasik.com")).toBeInTheDocument();
    expect(screen.getByText("1 pending")).toBeInTheDocument();
  });

  it("shows one person's history and goals", async () => {
    renderWithHub(<PersonPage />, admin, { path: `/people/${employeeProfile.id}`, pattern: "/people/:profileId" });
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    expect(await screen.findByText("Review history")).toBeInTheDocument();
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
  });
});

describe("library", () => {
  it("lists SOPs by category, drafts visible to admins only", async () => {
    renderWithHub(<SopListPage />, admin);
    expect(await screen.findByText("Jobsite safety walk")).toBeInTheDocument();
    expect(await screen.findByText("Weekly invoicing")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("renders an SOP body from Markdown with versions and attachments", async () => {
    renderWithHub(<SopPage />, employee, { path: `/sops/${KLASIK.sops[0].id}`, pattern: "/sops/:sopId" });
    expect(await screen.findByRole("heading", { name: "Jobsite safety walk" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Purpose" })).toBeInTheDocument();
    expect(await screen.findByText("Safety-walk-checklist.pdf")).toBeInTheDocument();
    expect(screen.getByText("2 versions")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument();
  });

  it("loads the current text into the editor", async () => {
    renderWithHub(<SopEditPage />, admin, { path: `/sops/${KLASIK.sops[0].id}/edit`, pattern: "/sops/:sopId/edit" });
    expect(await screen.findByDisplayValue("Jobsite safety walk")).toBeInTheDocument();
    expect((await screen.findByLabelText(/Body/)).textContent).toContain("Added this month");
  });

  it("filters resources by tag", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage />, employee);
    expect(await screen.findByText("Change order template")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "culture" }));
    expect(screen.queryByText("Change order template")).not.toBeInTheDocument();
    expect(screen.getByText("Brand and culture deck")).toBeInTheDocument();
  });
});

describe("admin", () => {
  it("shows company settings with the managed theme and domains", async () => {
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByDisplayValue("Klasik Construction")).toBeInTheDocument();
    expect(await screen.findByText("beklasik.com")).toBeInTheDocument();
  });

  it("shows the portfolio with a card and signals per company", async () => {
    renderWithHub(<PortfolioPage />, rococo, { path: "/rococo", pattern: "/rococo" });
    expect(await screen.findByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    for (const company of COMPANIES) {
      expect(await screen.findByRole("heading", { name: company.name })).toBeInTheDocument();
    }
    expect((await screen.findAllByText(/September 2026/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("1 invitation pending").length).toBe(3);
    expect(screen.getAllByRole("button", { name: /Open hub/ }).length).toBe(3);
  });

  it("manages companies and domains on the Companies tab", async () => {
    renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
    expect(await screen.findByRole("heading", { name: "Companies" })).toBeInTheDocument();
    expect(await screen.findByText("beklasik.com")).toBeInTheDocument();
    expect(await screen.findByDisplayValue("RBA Projects")).toBeInTheDocument();
  });

  it("lists every user across companies on the People tab", async () => {
    const user = userEvent.setup();
    renderWithHub(<UsersPage />, rococo, { path: "/rococo/people", pattern: "/rococo/people" });
    expect(await screen.findByText("Austin Rococo (you)")).toBeInTheDocument();
    expect(screen.getByText("12 users")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by company"), "co-rba");
    expect(screen.getByText("3 users")).toBeInTheDocument();
    expect(screen.queryByText("Austin Rococo (you)")).not.toBeInTheDocument();
  });
});

describe("phase 2 modules", () => {
  it("shows financial periods with derived margins and a CSV preview", async () => {
    const user = userEvent.setup();
    renderWithHub(<FinancialsPage />, admin);
    expect(await screen.findByRole("heading", { name: "Financials" })).toBeInTheDocument();
    expect(await screen.findByText("Aug 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Gross margin").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Quarterly (2)" }));
    expect(await screen.findByText("Q2 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Import CSV/ }));
    await user.click(screen.getByRole("button", { name: "Load a sample" }));
    expect(await screen.findByRole("button", { name: "Import 2 periods" })).toBeEnabled();
  });

  it("lays campaigns out by status with budget against spend", async () => {
    renderWithHub(<MarketingPage />, admin);
    expect(await screen.findByRole("heading", { name: "Marketing" })).toBeInTheDocument();
    expect(await screen.findByText("Spring remodel showcase")).toBeInTheDocument();
    expect(screen.getByText("Fall home show booth")).toBeInTheDocument();
    expect(screen.getByText(/\$7,400 of \$12,000/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Planned" })).toBeInTheDocument();
  });
});

describe("monthly goal setting review", () => {
  const at = { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" };

  it("reads last month back as hit or miss, with the year's goals and focus topics alongside", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    expect(await screen.findByText("Last month at a glance")).toBeInTheDocument();
    expect(await screen.findByText("2 of 4 goals hit")).toBeInTheDocument();
    expect(screen.getByText("Close out the punch list within five days")).toBeInTheDocument();
    expect(screen.getByText("Missed at 30%")).toBeInTheDocument();
    expect(screen.getByText("Carried into this month")).toBeInTheDocument();
    expect(screen.getByLabelText("Why for Send the Friday client update every week")).toHaveValue("Two Fridays slipped to Monday when closings ran late.");
    expect(screen.getByRole("heading", { name: "Yearly goals" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title for Get the OSHA 30 certification")).toBeInTheDocument();
    // The month's focus topic is a goal seeded from the cycle theme, listed first.
    expect(screen.getByLabelText("Title for Core value: Integrity")).toBeInTheDocument();
    expect(screen.getAllByText("Focus topic").length).toBeGreaterThan(0);
  });

  it("carries a missed goal into this month with only the steps not taken", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, admin, at);
    await user.click(await screen.findByRole("button", { name: "Carry Finish OSHA modules 1 to 10 into this month" }));
    expect(await screen.findByLabelText("Title for Finish OSHA modules 1 to 10")).toBeInTheDocument();
    expect(screen.getAllByText(/Carried from August 2026/).length).toBe(2);
    expect(screen.getByLabelText("Modules 6 to 10")).not.toBeChecked();
    expect(screen.queryByLabelText("Modules 1 to 5")).not.toBeInTheDocument();
  });

  it("marks a goal complete when its progress reaches 100", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    const slider = await screen.findByLabelText("Progress for Run the weekly client update without prompting");
    expect(slider).toHaveValue("65");
    fireEvent.change(slider, { target: { value: "100" } });
    fireEvent.blur(slider);
    expect(await screen.findByText("Complete")).toBeInTheDocument();
  });

  it("lets the person move their own progress but not set goals", async () => {
    renderWithHub(<ReviewPage />, employee, at);
    expect(await screen.findByText("Last month at a glance")).toBeInTheDocument();
    expect(screen.getByLabelText("Progress for Get the OSHA 30 certification")).not.toBeDisabled();
    expect(screen.queryByLabelText("Add a goal for this month")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /into this month/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Why for/)).not.toBeInTheDocument();
    expect(screen.getByText("Every crew logged daily. Two misses in week one, none after.")).toBeInTheDocument();
  });

  it("opens with the employee snapshot: tenure, KPIs, and company goals", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    expect(await screen.findByText("$2M in newly closed sales")).toBeInTheDocument();
    expect(screen.getByText("Personal KPIs 2026")).toBeInTheDocument();
    expect(screen.getByText("Company goals 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Gross margin").length).toBeGreaterThan(0);
    expect(screen.getByText(/May 26, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Jordan Vale")).toBeInTheDocument();
    expect(screen.queryByText("Total compensation")).not.toBeInTheDocument();
  });
});

describe("employee profile", () => {
  it("shows compensation with its total, KPIs, and employment details on the person page", async () => {
    renderWithHub(<PersonPage />, admin, { path: `/people/${employeeProfile.id}`, pattern: "/people/:profileId" });
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    expect(await screen.findByText("Total compensation")).toBeInTheDocument();
    expect(screen.getAllByText("$77,760").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Annual for Base salary")).toHaveValue("75000");
    expect(screen.getByLabelText("KPI 35 new sales journey leads")).toBeInTheDocument();
    expect(screen.getByLabelText("Hire date")).toHaveValue("2026-05-26");
    expect(screen.getByLabelText("Reports to")).toHaveValue(KLASIK.profiles[0].id);
    expect(screen.getByLabelText("Department")).toHaveValue("Production");
  });

  it("lists department and tenure in the people table", async () => {
    renderWithHub(<PeoplePage />, admin);
    expect(await screen.findByText("Jordan Vale (you)")).toBeInTheDocument();
    expect(screen.getAllByText("Production").length).toBeGreaterThan(0);
    expect(screen.getByText("May 26, 2026")).toBeInTheDocument();
  });
});
