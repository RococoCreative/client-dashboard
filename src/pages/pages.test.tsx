// Every page renders real content against the mocked data layer, for an admin and, where it
// differs, an employee. The mocks mirror the services module for module, so a page calling a
// service that does not exist fails here rather than in someone's browser.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

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

import { renderWithHub } from "../test/renderWithHub.tsx";
import { createGoal, createPillar, ensureReview, updatePillar, updateReview } from "../services/gsr.ts";
import * as auditService from "../services/audit.ts";
import * as companiesService from "../services/companies.ts";
import * as profilesService from "../services/profiles.ts";
import * as connectionsService from "../services/connections.ts";
import * as winsService from "../services/wins.ts";
import * as syncService from "../services/sync.ts";
import { formatDateTime } from "../lib/format.ts";
import { syncState } from "../lib/sync/state.ts";
import { AUDIT_EVENTS, COMPANIES, KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import AppLayout from "../components/AppLayout.tsx";
import DashboardPage from "./DashboardPage.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import CyclePage from "./gsr/CyclePage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import GsrSettingsPage from "./gsr/GsrSettingsPage.tsx";
import CompanyGoalsPage from "./gsr/CompanyGoalsPage.tsx";
import MyGsrPage from "./gsr/MyGsrPage.tsx";
import MyReviewsPage from "./gsr/MyReviewsPage.tsx";
import MyGoalsPage from "./gsr/MyGoalsPage.tsx";
import GoalsPage from "./gsr/GoalsPage.tsx";
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
import ActivityPage from "./rococo/ActivityPage.tsx";
import FinancialsPage from "./FinancialsPage.tsx";
import MarketingPage from "./MarketingPage.tsx";
import ProductionPage from "./production/ProductionPage.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import WinsPage from "./WinsPage.tsx";
import SalesFinancePage from "./salesFinance/SalesFinancePage.tsx";
import ControlsPage from "./salesFinance/ControlsPage.tsx";
import ConnectionsPanel from "../components/settings/ConnectionsPanel.tsx";
import MappedTable from "../components/sync/MappedTable.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rococo = makeHub("rococo", null);
const currentCycle = KLASIK.cycles[0];
// Klasik's second open cycle, overlapping the first: the quarterly that its monthly Goal
// Setting Review runs inside. Both cover today, which is the state that used to hide a
// finished review from the dashboard.
const overlappingCycle = KLASIK.cycles[2];
const inProgressReview = KLASIK.reviews.find((r) => r.status === "in_progress")!;
// Klasik runs monthly, so its reviews are Goal Setting Reviews with no scoring. RBA runs
// quarterly, which is where the scoring shape of a review still lives.
const rbaAdmin = makeHub("admin", RBA.company);
const rbaEmployee = makeHub("employee", RBA.company);
const rbaReview = RBA.reviews.find((r) => r.status === "in_progress")!;
const employeeProfile = KLASIK.profiles[1];

describe("dashboard", () => {
  it("summarizes the company for an admin", async () => {
    renderWithHub(<DashboardPage />, admin);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    // The name appears in its own block and again in the reviews-complete hint.
    expect((await screen.findAllByText(currentCycle.name)).length).toBeGreaterThan(0);
    expect(await screen.findByText("Closed sales")).toBeInTheDocument();
    expect(await screen.findByText("Jobsite safety walk")).toBeInTheDocument();
    // The roster is listed once per open cycle; the next test checks each block on its own.
    expect(screen.getAllByText("Sam Ortega").length).toBeGreaterThan(0);
    expect(await screen.findByText("Aug 2026")).toBeInTheDocument();
    expect(await screen.findByText("2 live campaigns")).toBeInTheDocument();
  });

  it("gives every open cycle its own progress instead of showing one of them", async () => {
    renderWithHub(<DashboardPage />, admin);
    // Two cycles cover today. Both get a block, each with its own fraction, so a review
    // finished in one of them is never reported as not started because the other won.
    const monthly = await screen.findByRole("heading", { name: currentCycle.name });
    const quarterly = await screen.findByRole("heading", { name: overlappingCycle.name });
    expect(monthly).toBeInTheDocument();
    expect(quarterly).toBeInTheDocument();
    // Each block lists the whole active roster under its own heading.
    for (const heading of [monthly, quarterly]) {
      const section = heading.closest("section") as HTMLElement;
      expect(within(section).getByText("Sam Ortega")).toBeInTheDocument();
      expect(within(section).getByText(/\d+ of \d+ complete/)).toBeInTheDocument();
    }
    // The monthly cycle is a Goal Setting Review with nothing to score, so it is labelled as
    // one and the quarterly is not.
    expect(within(monthly.closest("section") as HTMLElement).getByText(/Goal Setting Review/)).toBeInTheDocument();
    expect(within(quarterly.closest("section") as HTMLElement).queryByText(/Goal Setting Review/)).not.toBeInTheDocument();
  });

  it("keeps counting an open cycle after its period ends, until someone closes it", async () => {
    // October 5: nothing covers today any more, but September's GSR and Q3 are both still open,
    // with a review already signed off in September. Both stay on the dashboard, counted.
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    try {
      renderWithHub(<DashboardPage />, admin);
      const monthly = await screen.findByRole("heading", { name: currentCycle.name });
      const quarterly = await screen.findByRole("heading", { name: overlappingCycle.name });
      for (const heading of [monthly, quarterly]) {
        expect(within(heading.closest("section") as HTMLElement).getByText(/Period ended, still open/)).toBeInTheDocument();
      }
      expect(within(monthly.closest("section") as HTMLElement).getByText(/[1-9]\d* of \d+ complete/)).toBeInTheDocument();
    } finally {
      vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    }
  });

  it("shows an employee their own score and goals, plus the company goals, and nobody else's", async () => {
    renderWithHub(<DashboardPage />, employee);
    expect(await screen.findByText(/Welcome back, Sam/)).toBeInTheDocument();
    // This month's goal sits in the Goal Setting Review block; the year's in Goals.
    expect(await screen.findByText("Run the weekly client update without prompting")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: currentCycle.name })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open my GSR/ })).toBeInTheDocument();
    expect(screen.getByText("Get the OSHA 30 certification")).toBeInTheDocument();
    // A yearly goal's steps are private to Sam and kept apart from the goal, so the open-goals
    // list reads each goal by its period and completion, BHAG included.
    expect(screen.getByText("This year (2026) · 40% complete")).toBeInTheDocument();
    expect(screen.getByText("BHAG (3 to 5 years) · 10% complete")).toBeInTheDocument();
    // Klasik has never rated Sam, so the impact block says so rather than showing a zero.
    expect(screen.getByRole("heading", { name: "Not rated yet" })).toBeInTheDocument();
    // The company goals page promises these show on the dashboard for everyone, so they do.
    expect(await screen.findByText("Closed sales")).toBeInTheDocument();
    // A teammate's name is another matter: an employee's dashboard is their own.
    expect(screen.queryByText("Riley Park")).not.toBeInTheDocument();
  });
});

describe("employee dashboard", () => {
  it("shows a rated employee their impact score and how it moved since the last signed-off review", async () => {
    renderWithHub(<DashboardPage />, rbaEmployee);
    expect(await screen.findByText(/Welcome back, Jamie/)).toBeInTheDocument();
    // Jamie's working copy is their newest rated review; the baseline is the completed Q2, so
    // the block carries a number and names the review it is measured against.
    const impact = (await screen.findByText("Impact score")).closest("section") as HTMLElement;
    expect(within(impact).queryByText("Not rated yet")).not.toBeInTheDocument();
    expect(within(impact).getByText(/Against Q2 2026/)).toBeInTheDocument();
    expect(within(impact).getByText("Core Values")).toBeInTheDocument();
  });
});

describe("GSR", () => {
  it("lists the months in the GSRs section and the scored cycles in Reviews", async () => {
    // Klasik's monthly cycles are GSRs; its overlapping quarterly is a review. Same component,
    // keyed on cadence, so neither list shows the other's cycles.
    const gsrs = renderWithHub(<CyclesPage section="gsr" />, admin);
    expect(await screen.findByText(currentCycle.name)).toBeInTheDocument();
    expect(await screen.findByText(KLASIK.cycles[1].name)).toBeInTheDocument();
    expect(screen.queryByText(overlappingCycle.name)).not.toBeInTheDocument();
    expect(screen.getAllByText(/complete$/).length).toBeGreaterThan(0);
    // A month is not scored, so the list carries no team score column.
    expect(screen.queryByText("Team")).not.toBeInTheDocument();
    gsrs.unmount();

    renderWithHub(<CyclesPage section="reviews" />, admin);
    expect(await screen.findByText(overlappingCycle.name)).toBeInTheDocument();
    expect(screen.queryByText(currentCycle.name)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Pillars and weights/ })).toBeInTheDocument();
  });

  it("reports the same completion on the cycles list as on the cycle itself", async () => {
    // Both count over the active roster, so a person with no review row yet is owed one in
    // both places. The list used to count only the rows that existed.
    const list = renderWithHub(<CyclesPage section="gsr" />, admin);
    const link = (await screen.findByText(currentCycle.name)).closest("a") as HTMLElement;
    const fraction = within(link).getByText(/^\d+\/\d+ complete$/).textContent!.replace(" complete", "");
    const roster = KLASIK.profiles.filter((p) => p.is_active).length;
    expect(fraction.endsWith(`/${roster}`)).toBe(true);
    list.unmount();

    renderWithHub(<CyclePage />, admin, { path: `/gsr/cycles/${currentCycle.id}`, pattern: "/gsr/cycles/:cycleId" });
    expect(await screen.findByText(fraction)).toBeInTheDocument();
  });

  it("shows the team table for a cycle with pillar columns", async () => {
    renderWithHub(<CyclePage />, admin, { path: `/gsr/cycles/${currentCycle.id}`, pattern: "/gsr/cycles/:cycleId" });
    expect(await screen.findByRole("heading", { name: currentCycle.name })).toBeInTheDocument();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Brand Impact")).toBeInTheDocument();
    expect(within(table).getByText("Sam Ortega")).toBeInTheDocument();
    expect(within(table).getAllByText("Start review").length).toBeGreaterThan(0);
  });

  it("reads the ratings on a scoring review from the person's profile, never sets them there", async () => {
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: /^Score/ })).toBeInTheDocument();
    // The criterion is shown, read-only: no radiogroup to click, and the caption says where the
    // number comes from.
    expect(await screen.findByLabelText("Communication rating")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Communication rating" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Current ratings from/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Mark complete/ })).toBeInTheDocument();
  });

  it("sets an impact score on the profile and the open review reads it", async () => {
    const user = userEvent.setup();
    const jamie = RBA.profiles[1];
    const profile = renderWithHub(<PersonPage />, rbaAdmin, { path: `/people/${jamie.id}`, pattern: "/people/:profileId" });
    expect(await screen.findByRole("heading", { name: "Jamie Fox" })).toBeInTheDocument();
    const group = await screen.findByRole("radiogroup", { name: "Communication rating" });
    await user.click(within(group).getByRole("radio", { name: "5 of 5" }));
    expect(await within(group).findByText("5/5")).toBeInTheDocument();
    profile.unmount();

    // The review shows the number the profile now carries, without a control to change it.
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: /^Score/ })).toBeInTheDocument();
    expect(within(await screen.findByLabelText("Communication rating")).getByText("5/5")).toBeInTheDocument();
  });

  it("renders a scoring review read-only for the employee it belongs to", async () => {
    renderWithHub(<ReviewPage />, rbaEmployee, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: /^Score/ })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mark complete/ })).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Your reflection")).toBeInTheDocument();
  });

  it("makes a monthly review a Goal Setting Review with no scoring and no feedback", async () => {
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    // The meeting is the goals and the notes on them.
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.getByText("Last month at a glance")).toBeInTheDocument();
    // The notes log on each goal is the record of the conversation, so it stays.
    expect(screen.getAllByLabelText(/^New note for /).length).toBeGreaterThan(0);
    // None of the scoring or written-feedback modules belong here. Pillar sections are the ones
    // carrying a weight, which is what tells them apart from the deliverables module below that
    // happens to share Klasik's pillar name.
    expect(screen.queryByRole("heading", { name: /^Score/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/% of overall/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Brand Impact" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Manager notes and feedback" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Management feedback")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /\srating$/ })).not.toBeInTheDocument();
    // Nor does any of the year's content: KPIs, company goals, deliverables and yearly goals
    // belong to the quarterly and annual reviews and to the profile.
    expect(screen.queryByText("Personal KPIs 2026")).not.toBeInTheDocument();
    expect(screen.queryByText("Company goals 2026")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Deliverables" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Yearly goals" })).not.toBeInTheDocument();
    // Signing the review off is still the admin's call.
    expect(screen.getByRole("button", { name: /Mark complete/ })).toBeInTheDocument();
  });

  it("rates deliverables by their tasks in the review, two points a task", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    // An admin edits in place, so the headings and tasks are inputs rather than text.
    expect(await screen.findByDisplayValue("Customer Lifecycle & Retention Strategy")).toBeInTheDocument();
    // Its category heading, and the three tasks under it: Hit, Partial, Partial is 4 of 6. The
    // category holds this one heading, so both figures read the same.
    // The name also appears in the category pulldowns, so the group header is matched on its own tag.
    expect(screen.getByText("BD & Sales", { selector: "p" })).toBeInTheDocument();
    expect((await screen.findAllByText("4 of 6")).length).toBe(2);

    // Moving one task from Partial to Exceeded moves the heading, and the category with it.
    const group = screen.getByRole("radiogroup", { name: "Rating for Post occupancy value check in" });
    await user.click(within(group).getByRole("radio", { name: "Exceeded (3)" }));
    expect((await screen.findAllByText("6 of 6")).length).toBe(2);
  });

  it("files a new deliverable under the category chosen in the pulldown", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    await screen.findByDisplayValue("Customer Lifecycle & Retention Strategy");

    // Production starts with a heading of its own, so the new one has to join it rather than
    // landing in whichever category happens to be first.
    await user.type(screen.getByLabelText("New deliverable"), "Warranty response time");
    const production = RBA.deliverableCategories.find((c) => c.name === "Production")!;
    await user.selectOptions(screen.getByLabelText("Category"), production.id);
    // The quarterly review's deliverables pillar has an add button of its own, so the module's
    // is reached through the form that owns the New deliverable box.
    const form = screen.getByLabelText("New deliverable").closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: /Add deliverable/ }));

    // It arrives with no tasks, and its category pulldown reads the one it was filed under.
    const filed = await screen.findByDisplayValue("Warranty response time");
    const row = filed.closest("div.px-4") as HTMLElement;
    expect(within(row).getByLabelText("Category for Warranty response time")).toHaveValue(production.id);
    expect(within(row).getByText("No tasks yet")).toBeInTheDocument();

    // The same pulldown on the row refiles it, which is how a heading leaves Uncategorized.
    const sales = RBA.deliverableCategories.find((c) => c.name === "BD & Sales")!;
    await user.selectOptions(within(row).getByLabelText("Category for Warranty response time"), sales.id);
    await waitFor(() =>
      expect(screen.getByLabelText("Category for Warranty response time")).toHaveValue(sales.id),
    );
  });

  it("creates a category the first time a deliverable is filed under one", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    await screen.findByDisplayValue("Customer Lifecycle & Retention Strategy");

    // Klasik has never named Operations & Systems, so it is offered in the pulldown without
    // existing as a row. Choosing it is the whole step: no separate "add the category first".
    const starter = "Operations & Systems";
    expect(RBA.deliverableCategories.some((c) => c.name === starter)).toBe(false);
    await user.type(screen.getByLabelText("New deliverable"), "Fleet upkeep");
    await user.selectOptions(screen.getByLabelText("Category"), `new:${starter}`);
    // The quarterly review's deliverables pillar has an add button of its own, so the module's
    // is reached through the form that owns the New deliverable box.
    const form = screen.getByLabelText("New deliverable").closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: /Add deliverable/ }));

    // It lands under a real category heading, and the pulldown now points at the row it made.
    const filed = await screen.findByDisplayValue("Fleet upkeep");
    const section = filed.closest("section") as HTMLElement;
    expect(within(section).getByText(starter, { selector: "p" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Category")).not.toHaveValue(`new:${starter}`));
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
    renderWithHub(<MyReviewsPage />, rbaEmployee);
    expect(await screen.findByRole("heading", { name: "My reviews" })).toBeInTheDocument();
    expect(await screen.findByText("All reviews")).toBeInTheDocument();
    // RBA's scored quarters are listed; a monthly GSR never is, whatever it carries.
    expect((await screen.findAllByText(RBA.cycles[0].name)).length).toBeGreaterThan(0);
  });

  it("opens the employee's own Goal Setting Review for the live month", async () => {
    renderWithHub(<MyGsrPage />, employee);
    // Sam's September GSR is in progress, so the month renders in place: last month read back,
    // this month's goals, no back link (the tabs are the way around).
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.getByText("Last month at a glance")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GSR" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /My GSR/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Personal KPIs 2026")).not.toBeInTheDocument();
  });

  it("keeps My Goals to the year's goals", async () => {
    renderWithHub(<MyGoalsPage />, employee);
    expect(await screen.findByRole("heading", { name: "My goals" })).toBeInTheDocument();
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
    // A month goal is the GSR's, so it is neither listed nor editable here.
    expect(screen.queryByText("Run the weekly client update without prompting")).not.toBeInTheDocument();
  });

  it("lets an employee start their own GSR for the open month and prefill it", async () => {
    const user = userEvent.setup();
    // Avery has no review in September yet: nobody has started it, so they start it themselves.
    const avery = KLASIK.profiles.find((p) => p.full_name === "Avery Cole")!;
    const hub = { ...employee, profile: { ...avery, user_id: "klasik-auth-avery" } };
    renderWithHub(<MyGsrPage />, hub);
    expect(await screen.findByRole("heading", { name: "Get ready for your GSR" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start my GSR" }));
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a goal for this month")).toBeInTheDocument();
  });

  it("lets an employee tick an action step on this month's GSR", async () => {
    const user = userEvent.setup();
    // The step belongs to a month goal, and the month lives on the GSR tab now.
    renderWithHub(<MyGsrPage />, employee);
    const step = await screen.findByLabelText("Ask two clients how it landed");
    expect(step).not.toBeChecked();
    await user.click(step);
    expect(await screen.findByLabelText("Ask two clients how it landed")).toBeChecked();
  });
});

describe("people", () => {
  it("shows the roster in its three states", async () => {
    renderWithHub(<PeoplePage />, admin);
    expect(await screen.findByText("Jordan Vale (you)")).toBeInTheDocument();
    // Signed in, invited and waiting, and set up but never invited.
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByText("Not invited")).toBeInTheDocument();
    expect(screen.getByText("Avery Cole")).toBeInTheDocument();
    expect(screen.getByText("Taylor Reed")).toBeInTheDocument();
    expect(screen.getByText(/set up and not signed in yet/)).toBeInTheDocument();
  });

  it("adds staff without inviting them", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, admin);
    await user.click(await screen.findByRole("button", { name: /Add staff/ }));
    await user.type(screen.getByLabelText("Name"), "Morgan Reyes");
    await user.type(screen.getByLabelText("Email"), "morgan.reyes@beklasik.com");
    await user.type(screen.getByLabelText("Title (optional)"), "Foreman");
    await user.click(screen.getByRole("button", { name: "Add to team" }));
    expect(await screen.findByText("Morgan Reyes")).toBeInTheDocument();
    // On the roster, with no way in until somebody invites them.
    expect(screen.getByRole("button", { name: "Send the invitation to Morgan Reyes" })).toBeInTheDocument();
  });

  it("sends the invitation when the company is ready", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, admin);
    const send = await screen.findByRole("button", { name: "Send the invitation to Taylor Reed" });
    await user.click(send);
    expect(await screen.findByRole("button", { name: "Copy sign-in link for Taylor Reed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send the invitation to Taylor Reed" })).not.toBeInTheDocument();
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

  it("refuses to open another company's SOP in the editor", async () => {
    // A Rococo admin can read all three companies and the sidebar switcher changes company
    // without navigating, so a stale id must not leave another tenant's document on screen in
    // a form whose save appends a version to it.
    renderWithHub(<SopEditPage />, admin, { path: `/sops/${RBA.sops[0].id}/edit`, pattern: "/sops/:sopId/edit" });
    expect(await screen.findByText(/not in this company/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(RBA.sops[0].title)).not.toBeInTheDocument();
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
    expect(screen.getAllByText(/invitations? pending/).length).toBe(3);
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
    expect(screen.getByText("Jordan Vale")).toBeInTheDocument();
    expect(screen.getByText("Marcus Lee")).toBeInTheDocument();
    expect(screen.getByText("Alex Morgan")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Filter by company"), "co-rba");
    // RBA is the one company these tests never add anyone to, so its count is stable.
    expect(screen.getByText("4 users")).toBeInTheDocument();
    expect(screen.queryByText("Austin Rococo (you)")).not.toBeInTheDocument();
  });

  it("reads the audit log on the Activity tab, newest first", async () => {
    renderWithHub(<ActivityPage />, rococo, { path: "/rococo/activity", pattern: "/rococo/activity" });
    expect(await screen.findByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(await screen.findByText("companies: modules none to switchboard, production, wins, data_sources, external_links")).toBeInTheDocument();
    expect(screen.getByText("profiles: role employee to admin")).toBeInTheDocument();
    expect(screen.getByText("invitations: added (role employee, email new.hire@beklasik.com)")).toBeInTheDocument();
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Austin Rococo")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Rococo")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Kingdom Custom Construction")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Company user")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Activity" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("filters the Activity tab by company", async () => {
    const user = userEvent.setup();
    renderWithHub(<ActivityPage />, rococo, { path: "/rococo/activity", pattern: "/rococo/activity" });
    await screen.findByText("profiles: role employee to admin");
    await user.selectOptions(screen.getByLabelText("Filter by company"), "co-klasik");
    await waitFor(() => expect(screen.queryByText("profiles: role employee to admin")).not.toBeInTheDocument());
    expect(screen.getByText("invitations: added (role employee, email new.hire@beklasik.com)")).toBeInTheDocument();
    expect(screen.queryByText(/^companies: modules/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(2);
  });

  it("loads older events under the first page with Load more", async () => {
    const user = userEvent.setup();
    // A full first page, all newer than the fixture events, so Load more fetches those three.
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ ...AUDIT_EVENTS[1], id: `page-${i}`, created_at: new Date(Date.UTC(2026, 9, 1) - i * 60_000).toISOString() }));
    const spy = vi.spyOn(auditService, "listAuditEvents").mockResolvedValueOnce(firstPage);
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<ActivityPage />, rococo, { path: "/rococo/activity", pattern: "/rococo/activity" });
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("invitations: added (role employee, email new.hire@beklasik.com)")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(104);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("keeps events that share a timestamp across the Load more boundary", async () => {
    const user = userEvent.setup();
    // The first page ends on two events stamped at the same instant as the newest fixture event
    // (audit-1), so that instant straddles the page boundary. Paging by timestamp alone would
    // skip audit-1; the (created_at, id) cursor picks it up.
    const shared = AUDIT_EVENTS[0].created_at;
    const newer = Array.from({ length: 98 }, (_, i) => ({ ...AUDIT_EVENTS[1], id: `page-${i}`, created_at: new Date(Date.UTC(2026, 9, 1) - i * 60_000).toISOString() }));
    const tied = ["audit-1c", "audit-1b"].map((id) => ({ ...AUDIT_EVENTS[1], id, created_at: shared }));
    const spy = vi.spyOn(auditService, "listAuditEvents").mockResolvedValueOnce([...newer, ...tied]);
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<ActivityPage />, rococo, { path: "/rococo/activity", pattern: "/rococo/activity" });
    await user.click(await screen.findByRole("button", { name: "Load more" }));
    expect(await screen.findByText("companies: modules none to switchboard, production, wins, data_sources, external_links")).toBeInTheDocument();
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ before: { created_at: shared, id: "audit-1b" } }));
    expect(screen.getByText("invitations: added (role employee, email new.hire@beklasik.com)")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(104);
  });

  it("says nothing is recorded for a company with no events", async () => {
    const user = userEvent.setup();
    renderWithHub(<ActivityPage />, rococo, { path: "/rococo/activity", pattern: "/rococo/activity" });
    await screen.findByText("profiles: role employee to admin");
    await user.selectOptions(screen.getByLabelText("Filter by company"), "co-rba");
    expect(await screen.findByText("Nothing recorded yet")).toBeInTheDocument();
    expect(screen.getByText("Role, access and setup changes appear here from now on.")).toBeInTheDocument();
  });
});

describe("navigation and modules", () => {
  it("groups a Kingdom admin's sidebar into sections with Home first", () => {
    renderWithHub(<AppLayout />, makeHub("admin", KINGDOM.company));
    const nav = screen.getByRole("navigation", { name: "Primary" });
    for (const name of ["Home", "Sales & Finance", "Production", "People / HR", "More"]) {
      expect(within(nav).getByRole("group", { name })).toBeInTheDocument();
    }
    expect(within(nav).getByRole("link", { name: "Home" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("groups a Kingdom employee's sidebar without Sales & Finance", () => {
    renderWithHub(<AppLayout />, makeHub("employee", KINGDOM.company));
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryByRole("group", { name: "Sales & Finance" })).not.toBeInTheDocument();
    for (const name of ["Home", "People / HR", "More"]) {
      expect(within(nav).getByRole("group", { name })).toBeInTheDocument();
    }
    for (const name of ["My GSR", "My Reviews", "My Goals"]) {
      expect(within(nav).getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("keeps Klasik's flat sidebar exactly as it was", () => {
    renderWithHub(<AppLayout />, admin);
    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(within(nav).queryAllByRole("group")).toHaveLength(0);
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual(["Dashboard", "GSRs", "Reviews", "Goals", "People", "SOPs", "Resources", "Financials", "Marketing", "My GSR", "Settings"]);
  });

  it("titles the dashboard Home under the switchboard module", async () => {
    renderWithHub(<DashboardPage />, makeHub("admin", KINGDOM.company));
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).not.toBeInTheDocument();
  });

  it("switches modules per company on the Companies tab", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
    const kingdom = await screen.findByRole("group", { name: "Modules for Kingdom Custom Construction" });
    const klasik = screen.getByRole("group", { name: "Modules for Klasik Construction" });
    const kingdomBoxes = within(kingdom).getAllByRole("checkbox");
    expect(kingdomBoxes).toHaveLength(5);
    for (const box of kingdomBoxes) expect(box).toBeChecked();
    const klasikBoxes = within(klasik).getAllByRole("checkbox");
    expect(klasikBoxes).toHaveLength(5);
    for (const box of klasikBoxes) expect(box).not.toBeChecked();

    // Checked and unchecked again, so the shared mock store is back to [] for later tests.
    await user.click(within(klasik).getByRole("checkbox", { name: "Wins" }));
    await waitFor(() => expect(within(klasik).getByRole("checkbox", { name: "Wins" })).toBeChecked());
    await user.click(within(klasik).getByRole("checkbox", { name: "Wins" }));
    await waitFor(() => expect(within(klasik).getByRole("checkbox", { name: "Wins" })).not.toBeChecked());
  });

  it("lands two module ticks in a row without dropping the first", async () => {
    const user = userEvent.setup();
    const save = companiesService.updateCompany;
    // Each save waits on a gate the test opens, so the first is still in flight when the second
    // tick comes in.
    const gates: Array<() => void> = [];
    const spy = vi.spyOn(companiesService, "updateCompany").mockImplementation(async (id, patch) => {
      await new Promise<void>((resolve) => gates.push(resolve));
      return save(id, patch);
    });
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
    const klasik = await screen.findByRole("group", { name: "Modules for Klasik Construction" });
    const wins = within(klasik).getByRole("checkbox", { name: "Wins" });
    const production = within(klasik).getByRole("checkbox", { name: "Production" });

    // Two ticks in one go, before the page has a chance to re-render: the second builds on the first.
    act(() => {
      fireEvent.click(wins);
      fireEvent.click(production);
    });
    expect(wins).toBeChecked();
    expect(production).toBeChecked();
    // While a save is in flight the module checkboxes wait for it.
    expect(klasik).toBeDisabled();
    // The saves go out one at a time, in order, each carrying the whole list so far.
    for (const expected of [["wins"], ["wins", "production"]]) {
      await waitFor(() => expect(gates).toHaveLength(1));
      expect(spy.mock.calls[spy.mock.calls.length - 1][1].modules).toEqual(expected);
      await act(async () => gates.shift()!());
    }
    await waitFor(() => expect(klasik).not.toBeDisabled());
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await companiesService.getCompany("co-klasik")).modules).toEqual(["wins", "production"]);
    expect(wins).toBeChecked();
    expect(production).toBeChecked();

    // A tick after the save settles builds on what the database now holds, and puts the shared
    // mock store back to [] for later tests.
    spy.mockRestore();
    await user.click(wins);
    await waitFor(() => expect(wins).not.toBeChecked());
    await user.click(production);
    await waitFor(() => expect(production).not.toBeChecked());
    expect((await companiesService.getCompany("co-klasik")).modules).toEqual([]);
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

  it("reads last month back as hit or miss, with the focus topic leading this month", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    expect(await screen.findByText("Last month at a glance")).toBeInTheDocument();
    expect(await screen.findByText("2 of 4 goals hit")).toBeInTheDocument();
    expect(screen.getByText("Close out the punch list within five days")).toBeInTheDocument();
    expect(screen.getByText("Missed at 30%")).toBeInTheDocument();
    expect(screen.getByText("Carried into this month")).toBeInTheDocument();
    expect(screen.getByLabelText("Why for Send the Friday client update every week")).toHaveValue("Two Fridays slipped to Monday when closings ran late.");
    // The year's goals are not part of the month's meeting.
    expect(screen.queryByRole("heading", { name: "Yearly goals" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Title for Get the OSHA 30 certification")).not.toBeInTheDocument();
    // Sam's GSR for the month's focus topic reads after any role goals and ahead of the rest.
    expect(screen.getByLabelText("Title for Core value: Integrity")).toBeInTheDocument();
    expect(screen.getAllByText("Focus topic").length).toBeGreaterThan(0);
    // Klasik does not score its GSRs yet, so nothing is counted or called a stretch goal.
    expect(screen.queryByText("Counts")).not.toBeInTheDocument();
    expect(screen.queryByText(/mandatory GSR/)).not.toBeInTheDocument();
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
    const slider = await screen.findByLabelText("Agreed completion for Run the weekly client update without prompting");
    expect(slider).toHaveValue("65");
    fireEvent.change(slider, { target: { value: "100" } });
    fireEvent.blur(slider);
    expect(await screen.findByText("Complete")).toBeInTheDocument();
  });

  it("lets the person prefill their own month: goals, steps, notes and the why on last month", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, employee, at);
    expect(await screen.findByText(/Fill these in before the meeting/)).toBeInTheDocument();
    expect(screen.getByLabelText("Agreed completion for Run the weekly client update without prompting")).not.toBeDisabled();
    expect(screen.getByLabelText("Title for Run the weekly client update without prompting")).toBeInTheDocument();
    expect(screen.getByLabelText("New note for Run the weekly client update without prompting")).toBeInTheDocument();
    expect(screen.getByLabelText("Why for Send the Friday client update every week")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Add a goal for this month"), "Shadow an estimator for a day{Enter}");
    expect(await screen.findByLabelText("Title for Shadow an estimator for a day")).toBeInTheDocument();
  });

  it("keeps a closed month read-only for the person", async () => {
    // August, closed: the guard refuses any goal write, so the page offers none.
    const closed = KLASIK.cycles.find((c) => c.cadence === "monthly" && c.status === "closed")!;
    const review = KLASIK.reviews.find((r) => r.cycle_id === closed.id && r.employee_id === employeeProfile.id)!;
    renderWithHub(<ReviewPage />, employee, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a goal for this month")).not.toBeInTheDocument();
    // The month's notes stay on record and take no more: the database freezes them with the goals.
    expect(screen.getByText("Two of four Fridays.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^New note for /)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit note from / })).not.toBeInTheDocument();
  });

  it("keeps the focus topic and what it means on the month, in place of the banner", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    expect(screen.queryByText(/Theme for this cycle/)).not.toBeInTheDocument();
    // Sam has a GSR for the topic already, so the card names it and offers no second one.
    const card = screen.getByText(/Their #1 GSR for this topic/).closest("div") as HTMLElement;
    expect(within(card).getByText(currentCycle.theme_description!)).toBeInTheDocument();
    expect(within(card).getAllByText(currentCycle.theme!).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /monthly GSR based on this focus topic/ })).not.toBeInTheDocument();
  });

  it("sets a GSR of the person's own from the focus topic, in their words", async () => {
    const user = userEvent.setup();
    // Riley's September review has no goals yet, so the card offers to set one from the topic.
    const riley = KLASIK.reviews.find((r) => r.cycle_id === currentCycle.id && r.status === "complete")!;
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${riley.id}`, pattern: "/gsr/reviews/:reviewId" });
    await user.click(await screen.findByRole("button", { name: "Set their monthly GSR based on this focus topic" }));
    // The #1 GSR is a role or professional goal, never a personal one.
    const kind = screen.getByLabelText("Kind for the focus topic GSR");
    expect(within(kind).getAllByRole("option").map((o) => o.textContent)).toEqual(["Role", "Professional"]);
    await user.selectOptions(kind, "role");
    await user.type(screen.getByLabelText("GSR for this focus topic"), "Own one slipped date out loud each Monday{Enter}");
    expect(await screen.findByLabelText("Title for Own one slipped date out loud each Monday")).toBeInTheDocument();
    expect(screen.getByLabelText("Kind for Own one slipped date out loud each Monday")).toHaveValue("role");
    expect(screen.getByText("Focus topic GSR")).toBeInTheDocument();
    // The topic's explanation stays on the card rather than being copied into the goal.
    expect(screen.getByLabelText("Description for Own one slipped date out loud each Monday")).toHaveValue("");
    expect(screen.getByText(/Their #1 GSR for this topic/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /monthly GSR based on this focus topic/ })).not.toBeInTheDocument();
  });

  it("reads the month's goals focus GSR first, then role, then professional, and personal last", async () => {
    const user = userEvent.setup();
    const riley = KLASIK.reviews.find((r) => r.cycle_id === currentCycle.id && r.status === "complete")!;
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${riley.id}`, pattern: "/gsr/reviews/:reviewId" });
    const add = async (title: string, kind?: string) => {
      await user.type(await screen.findByLabelText("Add a goal for this month"), `${title}{Enter}`);
      const select = await screen.findByLabelText(`Kind for ${title}`);
      if (kind) await user.selectOptions(select, kind);
    };
    await add("Run the river 10k", "personal");
    await add("Call every client back the same day");
    await add("Walk every site weekly", "role");
    await waitFor(() => {
      const order = screen.getAllByLabelText(/^Title for /).map((el) => (el as HTMLInputElement).value);
      // The focus GSR the test before this one set for Riley leads, then the role goal.
      expect(order[0]).toBe("Own one slipped date out loud each Monday");
      expect(order.indexOf("Walk every site weekly")).toBe(1);
      expect(order.indexOf("Call every client back the same day")).toBeLessThan(order.indexOf("Run the river 10k"));
      expect(order.at(-1)).toBe("Run the river 10k");
    });
  });

  it("counts a goal's action steps beside their heading, apart from the agreed completion", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    const card = (await screen.findByLabelText("Title for Run the weekly client update without prompting")).closest("li") as HTMLElement;
    // An earlier test ticks the third step, so the count is read, not fixed.
    expect(within(card).getByText(/^\d of 3 done$/)).toBeInTheDocument();
    expect(within(card).getByText("Agreed completion")).toBeInTheDocument();
    expect(within(card).queryByText(/steps done/)).not.toBeInTheDocument();
  });

  it("keeps a dated notes log on each goal: add one, correct your own, delete it", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, admin, at);
    const card = (await screen.findByLabelText("Title for Run the weekly client update without prompting")).closest("li") as HTMLElement;
    // Sam's note and the manager's, each dated and named; only your own carries a pencil.
    expect(within(card).getByText("Two of three done. Third Friday is this week.")).toBeInTheDocument();
    expect(within(card).getByText("Sep 8, 2026 · Sam")).toBeInTheDocument();
    expect(within(card).getByText("Sep 12, 2026 · Jordan")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Edit note from Sep 12, 2026" })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Edit note from Sep 8, 2026" })).not.toBeInTheDocument();
    // A new note is stamped with today's date and the field clears for the next one.
    const field = within(card).getByLabelText("New note for Run the weekly client update without prompting");
    await user.type(field, "Client asked for site photos in the update{Enter}");
    expect(await within(card).findByText("Client asked for site photos in the update")).toBeInTheDocument();
    expect(within(card).getByText("Sep 15, 2026 · Jordan")).toBeInTheDocument();
    expect(field).toHaveValue("");
    // Corrected with the pencil: the date stays and the entry says it was edited.
    await user.click(within(card).getByRole("button", { name: "Edit note from Sep 15, 2026" }));
    const edit = within(card).getByLabelText("Edit note from Sep 15, 2026");
    await user.clear(edit);
    await user.type(edit, "Client asked for site photos every Friday{Enter}");
    expect(await within(card).findByText("Client asked for site photos every Friday")).toBeInTheDocument();
    expect(within(card).getByText("Sep 15, 2026 · Jordan · edited")).toBeInTheDocument();
    // Removed behind a confirm.
    await user.click(within(card).getByRole("button", { name: "Edit note from Sep 15, 2026" }));
    await user.click(within(card).getByRole("button", { name: "Delete note from Sep 15, 2026" }));
    await user.click(await screen.findByRole("button", { name: "Delete note" }));
    await waitFor(() => expect(within(card).queryByText("Client asked for site photos every Friday")).not.toBeInTheDocument());
  });

  it("reads last month's notes back with each goal, without a way to add to them", async () => {
    renderWithHub(<ReviewPage />, admin, at);
    expect(await screen.findByText("Four days on both closings.")).toBeInTheDocument();
    expect(screen.getByText("Two of four Fridays.")).toBeInTheDocument();
    expect(screen.queryByLabelText("New note for Close out the punch list within five days")).not.toBeInTheDocument();
  });

  it("opens a scored review with the employee snapshot: tenure, KPIs, and company goals", async () => {
    // The snapshot is annual content, so it belongs to the quarterly review, not the monthly GSR.
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByText("$2M in newly closed sales")).toBeInTheDocument();
    expect(screen.getByText("Personal KPIs 2026")).toBeInTheDocument();
    expect(screen.getByText("Company goals 2026")).toBeInTheDocument();
    expect(screen.getAllByText("Projects under contract").length).toBeGreaterThan(0);
    expect(screen.getByText(/May 26, 2026/)).toBeInTheDocument();
    expect(screen.getByText("Alex Morgan")).toBeInTheDocument();
    expect(screen.queryByText("Total compensation")).not.toBeInTheDocument();
  });
});

describe("scored review", () => {
  it("reads back the Goal Setting Reviews that ran inside the period", async () => {
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: "The months in this period" })).toBeInTheDocument();
    // RBA's September GSR sits inside its Q3 cycle; Jamie has no goals filed against the month
    // and no review row in it yet, and the block says both plainly rather than inventing a hit rate.
    const block = screen.getByRole("heading", { name: "The months in this period" }).closest("section") as HTMLElement;
    expect(within(block).getByText(RBA.cycles[2].name)).toBeInTheDocument();
    expect(within(block).getByText("No goals set")).toBeInTheDocument();
    expect(within(block).getByText("Not started")).toBeInTheDocument();
  });

  it("keeps the theme banner on a scored review, which has no focus card", async () => {
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByText(/Theme for this cycle/)).toBeInTheDocument();
  });

  it("keeps the year's goals on the quarterly review and leaves the month's goals to the GSR", async () => {
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: "Yearly goals" })).toBeInTheDocument();
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
    // The reviewer sees the shared part of each goal; its steps and notes stay with the person.
    expect(screen.getByText(/Action steps and progress notes are private to Jamie/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Register for the course")).not.toBeInTheDocument();
    // A cycle goal is the Goal Setting Review's, and the yearly panel files nothing but years.
    expect(screen.queryByText("Run the weekly client update without prompting")).not.toBeInTheDocument();
    expect(screen.queryByText("Goals for this month")).not.toBeInTheDocument();
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

  it("puts people who have never signed in into the review cycle, marked as not signed in", async () => {
    renderWithHub(<CyclePage />, admin, { path: `/gsr/cycles/${currentCycle.id}`, pattern: "/gsr/cycles/:cycleId" });
    const table = await screen.findByRole("table");
    // A company sets its reviews up before anyone has an account, so the whole active roster
    // is here: someone invited but not yet signed in, and someone never invited at all.
    expect(within(table).getByText("Sam Ortega")).toBeInTheDocument();
    expect(within(table).getByText("Avery Cole")).toBeInTheDocument();
    expect(within(table).getByText("Taylor Reed")).toBeInTheDocument();
    // Each row says whether that person can open theirs yet, so the admin is never misled.
    const rowFor = (name: string) => within(table).getByText(name).closest("tr")!;
    expect(rowFor("Avery Cole")).toHaveTextContent("not signed in yet");
    expect(rowFor("Taylor Reed")).toHaveTextContent("not signed in yet");
    expect(rowFor("Sam Ortega")).not.toHaveTextContent("not signed in yet");
  });
});

// Last, because signing the review off changes the mocked data every earlier test reads.
describe("sign-off", () => {
  it("freezes the profile's ratings into the review when it is marked complete", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByRole("heading", { name: /^Score/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Current ratings from/).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /Mark complete/ }));
    // The database copies the person's current ratings into the review on the status flip (the
    // mock does the same), and the page reads the frozen copy back.
    expect((await screen.findAllByText("Ratings as they were when this review was signed off.")).length).toBeGreaterThan(0);
    expect(within(screen.getByLabelText("Communication rating")).getByText("5/5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reopen/ })).toBeInTheDocument();
    // Reopened, the review reads the working copy again.
    await user.click(screen.getByRole("button", { name: /Reopen/ }));
    expect((await screen.findAllByText(/Current ratings from/)).length).toBeGreaterThan(0);
  });
});

describe("job roles", () => {
  it("manages job roles, their modules, and their goals in settings", async () => {
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByText("Job roles")).toBeInTheDocument();
    // Klasik's one role so far, with the module it carries and the goal it brings.
    expect(await screen.findByLabelText("Name for Production Manager")).toHaveValue("Production Manager");
    expect(screen.getByLabelText(/^Financial figures .* for Production Manager$/)).toBeChecked();
    expect(screen.getByLabelText("Role goal Walk every active site once a week")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Add a job role"), "Estimator");
    await userEvent.click(screen.getByRole("button", { name: "Add role" }));
    expect(await screen.findByLabelText("Name for Estimator")).toHaveValue("Estimator");
    // A new role carries nothing until an admin says so.
    expect(screen.getByLabelText(/^Financial figures .* for Estimator$/)).not.toBeChecked();
  });

  it("places a person in a job role and keeps their own figures on the profile", async () => {
    renderWithHub(<PersonPage />, admin, { path: `/people/${employeeProfile.id}`, pattern: "/people/:profileId" });
    expect(await screen.findByRole("heading", { name: "Sam Ortega" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Job role")).toHaveValue(KLASIK.jobRoles[0].id);
    expect(screen.getByLabelText("Target for Revenue managed")).toHaveValue("2000000");
    expect(screen.getByLabelText("Current for Revenue managed")).toHaveValue("640000");
    expect(screen.getByText(/32% of target/)).toBeInTheDocument();
    // The section says where the figures go, which is the role's call.
    expect(screen.getByText(/On their dashboard, because Production Manager carries the module/)).toBeInTheDocument();
    const form = screen.getByLabelText("Add a figure for 2026").closest("form") as HTMLElement;
    await userEvent.type(screen.getByLabelText("Add a figure for 2026"), "Gross profit on my jobs");
    await userEvent.type(screen.getByLabelText("New figure target"), "$450,000");
    await userEvent.click(within(form).getByRole("button", { name: "Add" }));
    expect(await screen.findByLabelText("Target for Gross profit on my jobs")).toHaveValue("450000");
  });

  it("shows an employee the figures their job role carries on the dashboard", async () => {
    renderWithHub(<DashboardPage />, employee);
    expect(await screen.findByText(/Welcome back, Sam/)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Your figures" })).toBeInTheDocument();
    expect(screen.getByText("Revenue managed")).toBeInTheDocument();
    expect(screen.getByText("$640,000 of $2,000,000")).toBeInTheDocument();
  });

  it("files the job role's goals into the month with one click", async () => {
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByText("Goals for this month")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: /Add role goals/ }));
    expect(await screen.findByLabelText("Title for Walk every active site once a week")).toHaveValue("Walk every active site once a week");
    expect(screen.getByLabelText("Kind for Walk every active site once a week")).toHaveValue("role");
    // Filed once: the offer goes away, and it is a goal of the month like any other.
    expect(screen.queryByRole("button", { name: /Add role goals/ })).not.toBeInTheDocument();
  });
});

describe("connections", () => {
  it("shows the company's own connections and disconnects one from settings", async () => {
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByText("Connections")).toBeInTheDocument();
    // HighLevel is connected by the owner, with the account it points at; QuickBooks is not.
    expect(await screen.findByText("Klasik Construction (HighLevel)", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Disconnect GoHighLevel" }));
    await waitFor(() => expect(screen.getAllByText("Not connected")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Connect GoHighLevel" })).toBeInTheDocument();
  });

  it("keeps Google Sheets off the Connections card until a page asks for it", async () => {
    const { unmount } = renderWithHub(<ConnectionsPanel companyId={KLASIK.company.id} />, admin);
    expect(await screen.findByRole("button", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    expect(screen.queryByText("Google Sheets")).not.toBeInTheDocument();
    unmount();

    renderWithHub(<ConnectionsPanel companyId={KLASIK.company.id} providers={["gohighlevel", "quickbooks", "google_sheets"]} />, admin);
    expect(await screen.findByText("Google Sheets")).toBeInTheDocument();
    expect(screen.getByText("Reporting tabs from the company's own spreadsheets, read-only, refreshed on a schedule.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect Google Sheets" })).toBeInTheDocument();
  });
});

// Last of all, because these file and tick goals the earlier tests read.
describe("goals beyond the month", () => {
  it("shows the owner their private steps and progress notes, and says what is shared", async () => {
    const user = userEvent.setup();
    renderWithHub(<MyGoalsPage />, employee);
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
    expect(screen.getByText(/Your action steps and progress notes stay private to you/)).toBeInTheDocument();
    const card = screen.getByText("Get the OSHA 30 certification").closest("li") as HTMLElement;
    expect(within(card).getByText("This year (2026)")).toBeInTheDocument();
    expect(await within(card).findByLabelText("Register for the course")).toBeChecked();
    expect(within(card).getByText("1 of 2 done")).toBeInTheDocument();
    expect(within(card).getByText("Booked the exam for November.")).toBeInTheDocument();
    // Ticking a step saves it to the goal's private half.
    await user.click(within(card).getByLabelText("Finish modules 1 to 15"));
    expect(await within(card).findByText("2 of 2 done")).toBeInTheDocument();
  });

  it("shows an admin the shared part of someone's goals and nothing private", async () => {
    renderWithHub(<PersonPage />, admin, { path: `/people/${employeeProfile.id}`, pattern: "/people/:profileId" });
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
    expect(screen.getByText("Action steps and progress notes are private to Sam.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Register for the course")).not.toBeInTheDocument();
    expect(screen.queryByText("Booked the exam for November.")).not.toBeInTheDocument();
    // The BHAG sits with the year's goals; the month's goals belong to the GSR.
    expect(screen.getByText("Lead a project from bid to closeout")).toBeInTheDocument();
    expect(screen.getByText("BHAG (3 to 5 years)")).toBeInTheDocument();
    expect(screen.queryByText("Run the weekly client update without prompting")).not.toBeInTheDocument();
  });

  it("files a goal for this year, next year or a BHAG, in the words the form asks for", async () => {
    const user = userEvent.setup();
    renderWithHub(<MyGoalsPage />, employee);
    await user.click(await screen.findByRole("button", { name: /New goal/ }));
    expect(screen.getByLabelText("Goal")).toHaveAttribute("placeholder", "What is a goal you want to achieve?");
    expect(screen.getByLabelText("Description (optional)")).toHaveAttribute("placeholder", "What does success look like?");
    const period = screen.getByLabelText("Period");
    expect(within(period).getAllByRole("option").map((o) => o.textContent)).toEqual(["This year (2026)", "Next year (2027)", "BHAG (3 to 5 years)"]);
    // The focus topic is the month's and is filed from a GSR, so it is no kind here.
    expect(within(screen.getByLabelText("Kind")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Role", "Professional", "Personal"]);
    await user.type(screen.getByLabelText("Goal"), "Open a second office");
    await user.selectOptions(period, "bhag");
    await user.click(screen.getByRole("button", { name: "Add goal" }));
    const card = (await screen.findByText("Open a second office")).closest("li") as HTMLElement;
    expect(within(card).getByText("BHAG (3 to 5 years)")).toBeInTheDocument();
  });

  it("lists everyone's goals and BHAGs for admins, without their steps", async () => {
    renderWithHub(<GoalsPage />, admin);
    const row = (await screen.findByText("Get the OSHA 30 certification")).closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Professional · 40%");
    expect(row).not.toHaveTextContent(/steps/);
    const bhag = screen.getByText("Lead a project from bid to closeout").closest("li") as HTMLElement;
    expect(bhag).toHaveTextContent("BHAG · Professional · 10%");
  });
});

// A company scores its GSRs by adding a Monthly GSRs pillar. Klasik and RBA do here, at the very
// end, because every earlier test reads their pillars as the fixtures ship them.
describe("monthly GSRs, scored", () => {
  let rbaPillarId = "";
  beforeAll(async () => {
    await createPillar({ company_id: KLASIK.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 });
    rbaPillarId = (await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 4 })).id;
  });

  it("offers the mandatory count in settings and says how the pillar scores", async () => {
    renderWithHub(<GsrSettingsPage />, admin);
    expect(await screen.findByLabelText("Mandatory a month")).toHaveValue("2");
    expect(screen.getByText(/Scored from the Goal Setting Reviews inside each review's period/)).toBeInTheDocument();
  });

  it("adds the month up the way Justin set it: two mandatory GSRs make 200%, and a stretch goal adds", async () => {
    const casey = KLASIK.profiles.find((p) => p.full_name === "Casey Nguyen")!;
    const review = KLASIK.reviews.find((r) => r.cycle_id === currentCycle.id && r.employee_id === casey.id)!;
    // His example: GSR #1 at 50, GSR #2 at 30, a stretch GSR at 80 is 160% of 200%.
    const month = [
      ["Feel better day to day", "personal", 80, false],
      ["Price every change order inside a day", "role", 30, false],
      ["Teach the team the new estimate template", "professional", 50, true],
    ] as const;
    for (const [i, [title, kind, progress, isFocus]] of month.entries()) {
      await createGoal({ company_id: KLASIK.company.id, employee_id: casey.id, title, kind, progress, is_focus: isFocus, scope: "cycle", cycle_id: currentCycle.id, sort_order: i + 1 });
    }
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByText("2 of 2 mandatory GSRs set · 160% of 200% so far, a month score of 80%")).toBeInTheDocument();
    const card = (title: string) => screen.getByLabelText(`Title for ${title}`).closest("li") as HTMLElement;
    expect(within(card("Teach the team the new estimate template")).getByText("#1 · Focus topic GSR")).toBeInTheDocument();
    expect(within(card("Price every change order inside a day")).getByText("Mandatory")).toBeInTheDocument();
    expect(within(card("Feel better day to day")).getByText("Stretch")).toBeInTheDocument();
    // The focus GSR leads the month, and the personal goal reads last.
    const order = screen.getAllByLabelText(/^Title for /).map((el) => (el as HTMLInputElement).value);
    expect(order).toEqual(["Teach the team the new estimate template", "Price every change order inside a day", "Feel better day to day"]);
  });

  it("lets the person adjust the completion too, until an admin locks the month in", async () => {
    renderWithHub(<ReviewPage />, employee, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByLabelText("Agreed completion for Run the weekly client update without prompting")).not.toBeDisabled();
    // Only an admin marks the month complete.
    expect(screen.queryByRole("button", { name: /Mark complete/ })).not.toBeInTheDocument();
  });

  it("locks the month in at its score when an admin marks it complete", async () => {
    const user = userEvent.setup();
    const casey = KLASIK.profiles.find((p) => p.full_name === "Casey Nguyen")!;
    const review = KLASIK.reviews.find((r) => r.cycle_id === currentCycle.id && r.employee_id === casey.id)!;
    renderWithHub(<ReviewPage />, admin, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
    await user.click(await screen.findByRole("button", { name: /Mark complete/ }));
    expect(await screen.findByRole("heading", { name: "Lock in Casey's September 2026 GSR at 80%?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Mark complete and lock in" }));
    expect(await screen.findByText("Locked in at 80%")).toBeInTheDocument();
    // The month is on record: nothing to add or move until the review is reopened.
    expect(screen.queryByLabelText("Add a goal for this month")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Agreed completion for Feel better day to day")).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reopen/ })).toBeInTheDocument();
  });

  it("counts only the locked-in months in a review period, and writes them into the review at sign-off", async () => {
    const user = userEvent.setup();
    const september = RBA.cycles[2];
    for (const [i, [title, kind, progress]] of ([["Walk two jobs a week with the PM", "role", 100], ["Price change orders inside a day", "professional", 75]] as const).entries()) {
      await createGoal({ company_id: RBA.company.id, employee_id: rbaReview.employee_id, title, kind, progress, scope: "cycle", cycle_id: september.id, sort_order: i + 1 });
    }
    const { unmount } = renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    const open = (await screen.findByRole("heading", { name: "Monthly GSRs" })).closest("section") as HTMLElement;
    // September adds up to 175% of 200% so far, but nothing is applied until it is locked in.
    expect(within(open).getByText(/Not locked in yet, 88% so far/)).toBeInTheDocument();
    expect(within(open).getByText(/No month in this period is locked in yet/)).toBeInTheDocument();
    unmount();

    // Jamie's manager marks September complete, which locks it in at 88.
    const month = await ensureReview(september.id, RBA.company.id, rbaReview.employee_id);
    await updateReview(month.id, { status: "complete", completed_at: new Date().toISOString(), gsr_score: 88 });
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    const pillar = (await screen.findByRole("heading", { name: "Monthly GSRs" })).closest("section") as HTMLElement;
    expect(within(pillar).getByText(september.name)).toBeInTheDocument();
    expect(within(pillar).getByText("88%")).toBeInTheDocument();
    expect(within(pillar).getByText(/^88% across 1 locked-in month/)).toBeInTheDocument();
    const months = screen.getByRole("heading", { name: "The months in this period" }).closest("section") as HTMLElement;
    expect(within(months).getByText(/GSR 88%/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Mark complete/ }));
    const signed = (await screen.findByRole("heading", { name: "Monthly GSRs" })).closest("section") as HTMLElement;
    expect(await within(signed).findByText("88% across 1 locked-in month of GSRs, as signed off.")).toBeInTheDocument();
  });

  it("keeps a signed-off review on the weights it was signed off with when the company re-weights", async () => {
    await updatePillar(rbaPillarId, { weight: 50 });
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${rbaReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    expect(await screen.findByText("Monthly GSRs (20%)")).toBeInTheDocument();
    expect(screen.queryByText("Monthly GSRs (50%)")).not.toBeInTheDocument();
  });

  it("shows where this quarter's locked-in GSRs stand on the impact score card, under the ratings", async () => {
    renderWithHub(<DashboardPage />, rbaEmployee);
    const impact = (await screen.findByText("Impact score")).closest("section") as HTMLElement;
    expect(within(impact).getByText(`Monthly GSRs, ${RBA.cycles[0].name}`)).toBeInTheDocument();
    expect(within(impact).getByText("88%")).toBeInTheDocument();
    expect(within(impact).getByText(/1 month locked in so far/)).toBeInTheDocument();
  });
});

describe("production", () => {
  // Read-only cases first, then the mutations, because the mock store is shared.
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const job101 = { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" };
  const job102 = { path: "/production/projects/kingdom-project-2", pattern: "/production/projects/:projectId" };
  const titleOrder = () => screen.getAllByLabelText(/^Title of /).map((input) => (input as HTMLInputElement).value);

  it("lists projects with their counts and next target for an admin", async () => {
    renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
    expect(await screen.findByRole("heading", { name: "Production" })).toBeInTheDocument();
    const first = (await screen.findByRole("link", { name: "Sample job 101" })).closest("tr") as HTMLElement;
    expect(within(first).getByText("2 of 4 done")).toBeInTheDocument();
    expect(within(first).getByText("Oct 2, 2026")).toBeInTheDocument();
    const second = screen.getByRole("link", { name: "Sample job 102" }).closest("tr") as HTMLElement;
    expect(within(second).getByText("0 of 2 done")).toBeInTheDocument();
    expect(within(second).getByText("Sep 25, 2026")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New project" })).toBeInTheDocument();
  });

  it("describes the project reference in industry-neutral words", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
    await user.click(await screen.findByRole("button", { name: "New project" }));
    expect(screen.getByText("A project number or any short code your team uses.")).toBeInTheDocument();
    expect(screen.queryByText(/job number/)).not.toBeInTheDocument();
  });

  it("lists the same projects for a member, without New project", async () => {
    renderWithHub(<ProductionPage />, kingdomEmployee, { path: "/production", pattern: "/production" });
    const first = (await screen.findByRole("link", { name: "Sample job 101" })).closest("tr") as HTMLElement;
    expect(within(first).getByText("2 of 4 done")).toBeInTheDocument();
    expect(within(first).getByText("Oct 2, 2026")).toBeInTheDocument();
    const second = screen.getByRole("link", { name: "Sample job 102" }).closest("tr") as HTMLElement;
    expect(within(second).getByText("0 of 2 done")).toBeInTheDocument();
    expect(within(second).getByText("Sep 25, 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New project" })).not.toBeInTheDocument();
  });

  it("shows a member the project read-only", async () => {
    renderWithHub(<ProjectPage />, kingdomEmployee, job101);
    expect(await screen.findByRole("heading", { name: "Sample job 101" })).toBeInTheDocument();
    expect(screen.getByText("Framing complete")).toBeInTheDocument();
    expect(screen.getAllByText("Letter")).toHaveLength(1);
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add milestone" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move .* up$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Archive / })).not.toBeInTheDocument();
  });

  it("refuses another company's project", async () => {
    renderWithHub(<ProjectPage />, admin, job101);
    expect(await screen.findByText(/not in this company/)).toBeInTheDocument();
    expect(screen.queryByText("Sample job 101")).not.toBeInTheDocument();
  });

  it("filters to letters, read-only, and back to all", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    expect(await screen.findByRole("heading", { name: "Sample job 101" })).toBeInTheDocument();
    const show = screen.getByRole("group", { name: "Show" });
    await user.click(within(show).getByRole("button", { name: "Letters" }));
    expect(within(show).getByRole("button", { name: "Letters" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Welcome letter sent")).toBeInTheDocument();
    expect(screen.queryByText("Contract signed")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Title of /)).not.toBeInTheDocument();
    expect(screen.getByText("Switch to All to edit or reorder.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    await user.click(within(show).getByRole("button", { name: "All" }));
    expect(titleOrder()).toEqual(["Contract signed", "Welcome letter sent", "Framing complete", "Final walkthrough"]);
  });

  it("moves an item up", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    expect(titleOrder()).toEqual(["Permit approved", "Foundation poured"]);
    await user.click(screen.getByRole("button", { name: "Move Foundation poured up" }));
    await waitFor(() => expect(titleOrder()).toEqual(["Foundation poured", "Permit approved"]));
  });

  it("edits an item's title and completed-on date", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    const title = screen.getByLabelText("Title of Permit approved");
    await user.clear(title);
    await user.type(title, "Permit issued");
    await user.tab();
    expect(await screen.findByDisplayValue("Permit issued")).toBeInTheDocument();
    const done = screen.getByLabelText("Completed on for Foundation poured");
    fireEvent.change(done, { target: { value: "2026-09-14" } });
    fireEvent.blur(done);
    expect(await screen.findByText("Done Sep 14, 2026")).toBeInTheDocument();
  });

  it("adds a letter at the end", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job102);
    await screen.findByRole("heading", { name: "Sample job 102" });
    await user.type(screen.getByLabelText("New milestone title"), "Sample milestone");
    await user.selectOptions(screen.getByLabelText("New milestone kind"), "Letter");
    await user.click(screen.getByRole("button", { name: "Add milestone" }));
    await waitFor(() => expect(titleOrder().at(-1)).toBe("Sample milestone"));
    const row = screen.getByLabelText("Title of Sample milestone").closest("li") as HTMLElement;
    expect(within(row).getByText("Letter", { selector: "span" })).toBeInTheDocument();
  });

  it("creates a project from the list", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProductionPage />, kingdomAdmin, { path: "/production", pattern: "/production" });
    await user.click(await screen.findByRole("button", { name: "New project" }));
    const dialog = screen.getByRole("dialog", { name: "New project" });
    await user.click(within(dialog).getByRole("button", { name: "Add project" }));
    expect(within(dialog).getByText("Give the project a name.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "Sample job 103");
    await user.click(within(dialog).getByRole("button", { name: "Add project" }));
    const row = (await screen.findByRole("link", { name: "Sample job 103" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("0 of 0 done")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("home cards", () => {
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

  it("gives a Kingdom admin Attention, Shortcuts and the five most recent wins", async () => {
    renderWithHub(<DashboardPage />, kingdomAdmin);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(await screen.findByText("People not signed in")).toBeInTheDocument();
    const attention = card("Needs attention");
    expect(within(attention).getByText("1 person has not signed in yet.")).toBeInTheDocument();
    expect(within(attention).getByRole("link", { name: "Open: People not signed in" })).toHaveAttribute("href", "/people");
    const shortcuts = card("Sections");
    expect(within(shortcuts).getByRole("link", { name: "Production" })).toHaveAttribute("href", "/production");
    expect(within(shortcuts).getByRole("link", { name: "People / HR" })).toHaveAttribute("href", "/gsr");
    expect(within(shortcuts).getByRole("link", { name: "Sales & Finance" })).toHaveAttribute("href", "/sales-finance");
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    const wins = card("Recent wins");
    expect(within(wins).getByText("Sample win 6")).toBeInTheDocument();
    expect(within(wins).queryByText("Sample win 5")).not.toBeInTheDocument();
    expect(within(wins).queryByText("Sample win 7")).not.toBeInTheDocument();
    expect(within(wins).getAllByText("Manual").length).toBeGreaterThan(0);
    expect(within(wins).getByRole("link", { name: "All wins" })).toHaveAttribute("href", "/wins");
  });

  it("gives a Kingdom employee wins and shortcuts, never Attention", async () => {
    renderWithHub(<DashboardPage />, kingdomEmployee);
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent wins" })).toBeInTheDocument();
    const shortcuts = card("Sections");
    expect(within(shortcuts).getByRole("link", { name: "Production" })).toHaveAttribute("href", "/production");
    expect(within(shortcuts).getByRole("link", { name: "People / HR" })).toHaveAttribute("href", "/my/gsr");
    expect(within(shortcuts).queryByRole("link", { name: "Sales & Finance" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Needs attention" })).not.toBeInTheDocument();
  });

  it("leaves Klasik's dashboard as it was, with no card and no extra call", async () => {
    const winsSpy = vi.spyOn(winsService, "listWins");
    const connectionsSpy = vi.spyOn(connectionsService, "listConnections");
    onTestFinished(() => {
      winsSpy.mockRestore();
      connectionsSpy.mockRestore();
    });
    for (const hub of [admin, employee]) {
      const { unmount } = renderWithHub(<DashboardPage />, hub);
      expect(await screen.findByText("Closed sales")).toBeInTheDocument();
      for (const name of ["Needs attention", "Recent wins", "Sections"]) {
        expect(screen.queryByRole("heading", { name })).not.toBeInTheDocument();
      }
      unmount();
    }
    expect(winsSpy).not.toHaveBeenCalled();
    expect(connectionsSpy).not.toHaveBeenCalled();
  });
});

describe("wins", () => {
  // Read-only cases first, then the mutations, because the mock store is shared.
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const winsRoute = { path: "/wins", pattern: "/wins" };

  it("shows a member the wins read-only, newest first, with a win's project", async () => {
    renderWithHub(<WinsPage />, kingdomEmployee, winsRoute);
    expect(await screen.findByRole("heading", { name: "Wins" })).toBeInTheDocument();
    expect(await screen.findByText("Sample win 1")).toBeInTheDocument();
    const fourth = screen.getByText("Sample win 4").closest("li") as HTMLElement;
    expect(within(fourth).getByText("Sample job 101")).toBeInTheDocument();
    expect(screen.queryByText("Sample win 5")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New win" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Archive / })).not.toBeInTheDocument();
  });

  it("gives an admin every field to edit in place", async () => {
    renderWithHub(<WinsPage />, kingdomAdmin, winsRoute);
    expect(await screen.findByDisplayValue("Sample win 1")).toBeInTheDocument();
    expect(screen.getAllByText("Manual").length).toBe(6);
    expect(screen.getByLabelText("Project for Sample win 4")).toHaveDisplayValue("Sample job 101");
    expect(screen.getByLabelText("Won on for Sample win 1")).toHaveValue("2026-09-12");
    expect(screen.getByRole("button", { name: "New win" })).toBeInTheDocument();
  });

  it("creates a win by hand", async () => {
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, kingdomAdmin, winsRoute);
    await user.click(await screen.findByRole("button", { name: "New win" }));
    const dialog = screen.getByRole("dialog", { name: "New win" });
    await user.click(within(dialog).getByRole("button", { name: "Add win" }));
    expect(within(dialog).getByText("Give the win a title.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Title"), "Sample win 8");
    fireEvent.change(within(dialog).getByLabelText("Won on"), { target: { value: "" } });
    await user.click(within(dialog).getByRole("button", { name: "Add win" }));
    expect(within(dialog).getByText("Pick the date it was won.")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("Won on"), { target: { value: "2026-06-01" } });
    await user.click(within(dialog).getByRole("button", { name: "Add win" }));
    const row = (await screen.findByDisplayValue("Sample win 8")).closest("li") as HTMLElement;
    expect(within(row).getByText("Manual")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Oldest, so it sits last.
    const titles = screen.getAllByLabelText(/^Title of /).map((input) => (input as HTMLInputElement).value);
    expect(titles.at(-1)).toBe("Sample win 8");
  });

  it("saves a description on blur", async () => {
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, kingdomAdmin, winsRoute);
    const description = await screen.findByLabelText("Description of Sample win 2");
    await user.type(description, "Closed on the first walkthrough.");
    await user.tab();
    await waitFor(async () => {
      const saved = (await winsService.listWins(KINGDOM.company.id)).find((w) => w.title === "Sample win 2");
      expect(saved?.description).toBe("Closed on the first walkthrough.");
    });
    expect(screen.getByLabelText("Description of Sample win 2")).toHaveValue("Closed on the first walkthrough.");
  });

  it("archives a win after confirming", async () => {
    const user = userEvent.setup();
    renderWithHub(<WinsPage />, kingdomAdmin, winsRoute);
    await user.click(await screen.findByRole("button", { name: "Archive Sample win 7" }));
    const dialog = screen.getByRole("dialog", { name: "Archive this win?" });
    expect(within(dialog).getByText("It leaves this list and the Home card. It is kept, not deleted.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByDisplayValue("Sample win 7")).not.toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("scaffolds", () => {
  // A company with the modules on and nothing configured, so later tasks that give Kingdom its
  // sources do not move these assertions.
  const freshAdmin = makeHub("admin", { ...RBA.company, modules: ["production", "data_sources"] });
  const freshEmployee = makeHub("employee", { ...RBA.company, modules: ["production", "data_sources"] });
  const productionCards = ["Client score", "Cleanliness", "Job health", "Warranty", "PM capacity"];

  async function expectScaffold(name: string) {
    const region = await screen.findByRole("region", { name });
    within(region).getByText("Not configured");
    expect(region.textContent).not.toMatch(/\d/);
    expect(region.querySelector("svg")).toBeNull();
  }

  it("shows Sales & Finance reporting as not configured, with no figures", async () => {
    const { container } = renderWithHub(<SalesFinancePage />, freshAdmin, { path: "/sales-finance", pattern: "/sales-finance" });
    expect(await screen.findByRole("heading", { name: "Sales & Finance" })).toBeInTheDocument();
    const tabs = screen.getByRole("navigation", { name: "Sections" });
    expect(within(tabs).getByRole("link", { name: "Reporting" })).toHaveAttribute("href", "/sales-finance");
    expect(within(tabs).getByRole("link", { name: "Controls" })).toHaveAttribute("href", "/sales-finance/controls");
    await expectScaffold("Sales reporting");
    await expectScaffold("Financial reporting");
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(screen.getByRole("link", { name: "Financials" })).toHaveAttribute("href", "/financials");
    expect(screen.getByRole("link", { name: "Marketing" })).toHaveAttribute("href", "/marketing");
  });

  it("shows Controls as not configured", async () => {
    renderWithHub(<ControlsPage />, freshAdmin, { path: "/sales-finance/controls", pattern: "/sales-finance/controls" });
    expect(await screen.findByRole("heading", { name: "Controls" })).toBeInTheDocument();
    await expectScaffold("QuickBooks controls");
  });

  it("keeps the Production cards unscored", async () => {
    renderWithHub(<ProductionPage />, freshAdmin, { path: "/production", pattern: "/production" });
    for (const name of productionCards) await expectScaffold(name);
  });

  it("shows an employee the same Production cards, read-only", async () => {
    renderWithHub(<ProductionPage />, freshEmployee, { path: "/production", pattern: "/production" });
    for (const name of productionCards) {
      await expectScaffold(name);
      const region = await screen.findByRole("region", { name });
      expect(within(region).queryAllByRole("button")).toHaveLength(0);
    }
  });
});

describe("data sources", () => {
  // Read-only cases first, then Settings, which syncs and adds a source in the shared mock store.
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const source = (name: string) => KINGDOM.syncSources.find((s) => s.name === name)!;
  const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
  const salesRoute = { path: "/sales-finance", pattern: "/sales-finance" };

  it("carries one Kingdom source in each sync state", () => {
    const states = KINGDOM.syncSources.map((s) => syncState(s, KINGDOM.connections.find((c) => c.id === s.connection_id) ?? null));
    expect([...states].sort()).toEqual(["awaiting_first_sync", "failed", "not_connected", "stale", "synced", "syncing"]);
  });

  it("shows synced values read-only, with blanks as a hyphen", async () => {
    renderWithHub(<SalesFinancePage />, kingdomAdmin, salesRoute);
    await screen.findByRole("heading", { name: "Sample sales tab" });
    const sales = card("Sample sales tab");
    expect(within(sales).getByText("Synced")).toBeInTheDocument();
    const headers = within(sales).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["Job", "Contract amount (USD)", "Margin", "Units", "Signed on", "Notes", "Source"]);
    for (const text of ["Sample job 101", "$250,000", "25.0%", "Aug 14, 2026"]) expect(within(sales).getByText(text)).toBeInTheDocument();
    const blankRow = within(sales).getByText("Sample job 102").closest("tr") as HTMLElement;
    expect(within(blankRow).getAllByRole("cell").filter((td) => td.textContent === "-")).toHaveLength(5);
    const links = within(sales).getAllByRole("link", { name: "Open in Google Sheets" });
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toContain("docs.google.com/spreadsheets/d/sample-sheet-1");
    expect(links[0].getAttribute("href")).toContain("range=A2");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0].getAttribute("rel")).toContain("noopener");
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
    for (const cell of screen.getAllByRole("cell")) expect(["$0", "0%", "0.0%"]).not.toContain(cell.textContent);
  });

  it("keeps the last good values and their time when a sync fails, never a 0", async () => {
    renderWithHub(<SalesFinancePage />, kingdomAdmin, salesRoute);
    await screen.findByRole("heading", { name: "Sample financial tab" });
    const financial = card("Sample financial tab");
    expect(within(financial).getByText("Sync failed")).toBeInTheDocument();
    const when = formatDateTime(source("Sample financial tab").last_success_at);
    expect(within(financial).getByText((text) => text.includes(`Showing data from ${when}`))).toBeInTheDocument();
    expect(within(financial).getByText((text) => text.includes('The column "Gross profit" is missing.'))).toBeInTheDocument();
    expect(within(financial).getByText("$120,000")).toBeInTheDocument();
    expect(financial.textContent).not.toContain("$0");
  });

  it("keeps the last good values visible while a sync runs", async () => {
    renderWithHub(<SalesFinancePage />, kingdomAdmin, salesRoute);
    await screen.findByRole("heading", { name: "Sample syncing tab" });
    const syncing = card("Sample syncing tab");
    expect(within(syncing).getByText("Syncing")).toBeInTheDocument();
    expect(within(syncing).getByText("$80,000")).toBeInTheDocument();
  });

  it("marks stale data with its age", async () => {
    renderWithHub(<SalesFinancePage />, kingdomAdmin, salesRoute);
    await screen.findByRole("heading", { name: "Sample stale tab" });
    const stale = card("Sample stale tab");
    expect(within(stale).getByText("Stale data")).toBeInTheDocument();
    expect(within(stale).getByText(/^Stale: last synced /)).toBeInTheDocument();
  });

  it("shows a QuickBooks source that is not connected yet", async () => {
    renderWithHub(<ControlsPage />, kingdomAdmin, { path: "/sales-finance/controls", pattern: "/sales-finance/controls" });
    await screen.findByRole("heading", { name: "Sample invoices" });
    const invoices = card("Sample invoices");
    expect(within(invoices).getByText("Not connected")).toBeInTheDocument();
    expect(within(invoices).getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings");
    expect(within(invoices).queryByRole("table")).not.toBeInTheDocument();
  });

  it("links a QuickBooks invoice row to QuickBooks with a sign-in note", () => {
    const invoices = source("Sample invoices");
    const record = {
      id: "sample-record",
      company_id: KINGDOM.company.id,
      source_id: invoices.id,
      run_id: "sample-run",
      record_key: '["1001"]',
      data: { doc_number: "1001" },
      source_ref: { entity: "Invoice", Id: "101", realmId: "sample-realm", sandbox: true },
      created_at: "2026-11-09T14:00:00.000Z",
    };
    render(<MappedTable source={{ ...invoices, current_run_id: "sample-run" }} records={[record]} />);
    const link = screen.getByRole("link", { name: "Open in QuickBooks" });
    expect(link).toHaveAttribute("href", "https://app.sandbox.qbo.intuit.com/app/invoice?txnId=101");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText("Opens QuickBooks, sign-in required")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "1001" })).toBeInTheDocument();
    expect(screen.getByText("Read-only, from QuickBooks Online.")).toBeInTheDocument();
  });

  it("shows the PM capacity source's state to admins only", async () => {
    const productionRoute = { path: "/production", pattern: "/production" };
    const { unmount } = renderWithHub(<ProductionPage />, kingdomAdmin, productionRoute);
    await screen.findByRole("heading", { name: "Sample capacity tab" });
    const capacity = card("Sample capacity tab");
    expect(within(capacity).getByText("Awaiting first sync")).toBeInTheDocument();
    expect(within(capacity).getByText("Connected. No data yet.")).toBeInTheDocument();
    unmount();

    renderWithHub(<ProductionPage />, kingdomEmployee, productionRoute);
    const region = await screen.findByRole("region", { name: "PM capacity" });
    expect(within(region).getByText("Not configured")).toBeInTheDocument();
    expect(screen.queryByText("Sample capacity tab")).not.toBeInTheDocument();
  });

  it("lists every source's freshness on Kingdom Home", async () => {
    renderWithHub(<DashboardPage />, kingdomAdmin);
    await screen.findByRole("heading", { name: "Freshness" });
    const freshness = card("Freshness");
    const names = ["Sample capacity tab", "Sample financial tab", "Sample invoices", "Sample sales tab", "Sample stale tab", "Sample syncing tab"];
    for (const name of names) expect(await within(freshness).findByRole("link", { name })).toBeInTheDocument();
    expect(within(freshness).getByRole("link", { name: "Sample sales tab" })).toHaveAttribute("href", "/sales-finance");
    expect(within(freshness).getByRole("link", { name: "Sample invoices" })).toHaveAttribute("href", "/sales-finance/controls");
    expect(within(freshness).getByRole("link", { name: "Sample capacity tab" })).toHaveAttribute("href", "/production");
    const financialRow = within(freshness).getByRole("link", { name: "Sample financial tab" }).closest("li") as HTMLElement;
    expect(financialRow.textContent).toContain(formatDateTime(source("Sample financial tab").last_success_at));
    const attention = card("Needs attention");
    expect(await within(attention).findByText("Sample financial tab: sync failed")).toBeInTheDocument();
    expect(within(attention).getByText("Sample stale tab: stale data")).toBeInTheDocument();
  });

  it("adds nothing to a company without data sources", async () => {
    const spy = vi.spyOn(syncService, "listSyncSources");
    onTestFinished(() => spy.mockRestore());
    const { unmount } = renderWithHub(<DashboardPage />, admin);
    expect(await screen.findByText("Closed sales")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Freshness" })).not.toBeInTheDocument();
    unmount();
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByText("Connections")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Data sources" })).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("configures sources and syncs one now from Settings", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, kingdomAdmin, { path: "/settings", pattern: "/settings" });
    await screen.findByRole("heading", { name: "Data sources" });
    const panel = card("Data sources");
    for (const s of KINGDOM.syncSources) expect(await within(panel).findByText(s.name)).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Sync Sample sales tab now" }));
    expect(await within(panel).findByText("Sample sales tab synced: 2 rows.")).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Add source" }));
    const dialog = screen.getByRole("dialog", { name: "New data source" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(within(dialog).getByText("The source needs a name.")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Name"), "Sample new tab");
    fireEvent.change(within(dialog).getByLabelText("Google Sheets link"), { target: { value: "https://docs.google.com/spreadsheets/d/sample-new-sheet/edit#gid=42" } });
    expect(within(dialog).getByText("Spreadsheet sample-new-sheet, tab 42")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Column header 1"), "Job");
    expect(within(dialog).getByLabelText("Key 1")).toHaveValue("job");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(panel).getByText("Sample new tab")).toBeInTheDocument();
  });

  it("shows the Google Sheets connection only to a company with data sources", async () => {
    const { unmount } = renderWithHub(<CompanySettingsPage />, kingdomAdmin, { path: "/settings", pattern: "/settings" });
    await screen.findByRole("heading", { name: "Connections" });
    const connections = card("Connections");
    const row = (await within(connections).findByText("Google Sheets")).closest("li") as HTMLElement;
    expect(within(row).getByText("Connected")).toBeInTheDocument();
    expect(within(row).getByText((text) => text.includes("sample-reports@example.com"))).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Disconnect Google Sheets" })).toBeInTheDocument();
    unmount();

    renderWithHub(<CompanySettingsPage />, admin, { path: "/settings", pattern: "/settings" });
    expect(await screen.findByText("GoHighLevel")).toBeInTheDocument();
    expect(screen.queryByText("Google Sheets")).not.toBeInTheDocument();
  });

  it("confirms a Google Sheets connection on the way back", async () => {
    renderWithHub(<CompanySettingsPage />, kingdomAdmin, { path: "/settings?connected=google_sheets", pattern: "/settings" });
    expect(await screen.findByText("Google Sheets is connected.")).toBeInTheDocument();
  });

  it("reads a sheet's headers into the field map", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, kingdomAdmin, { path: "/settings", pattern: "/settings" });
    await screen.findByRole("heading", { name: "Data sources" });
    const panel = card("Data sources");
    await within(panel).findByText("Sample sales tab");
    await user.click(within(panel).getByRole("button", { name: "Add source" }));
    const dialog = screen.getByRole("dialog", { name: "New data source" });
    fireEvent.change(within(dialog).getByLabelText("Google Sheets link"), { target: { value: "https://docs.google.com/spreadsheets/d/sample-new-sheet/edit#gid=42" } });
    await user.click(within(dialog).getByRole("button", { name: "Read headers" }));
    expect(await within(dialog).findByText("Sample reporting workbook, tab Sample finance")).toBeInTheDocument();
    expect(within(dialog).getByText("Added 4 fields.")).toBeInTheDocument();
    // The label inputs repeat each header, so the header inputs are read by their own names.
    const headerInputs = within(dialog).getAllByRole("textbox", { name: /^Column header / });
    expect(headerInputs.map((input) => (input as HTMLInputElement).value)).toEqual(["Job", "Contract amount", "Margin", "Signed on"]);
    expect(within(dialog).getByDisplayValue("job")).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue("contract_amount")).toBeInTheDocument();
  });

  it("keeps Read headers off until the link names a tab", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, kingdomAdmin, { path: "/settings", pattern: "/settings" });
    await screen.findByRole("heading", { name: "Data sources" });
    const panel = card("Data sources");
    await within(panel).findByText("Sample sales tab");
    await user.click(within(panel).getByRole("button", { name: "Add source" }));
    const dialog = screen.getByRole("dialog", { name: "New data source" });
    expect(within(dialog).getByRole("button", { name: "Read headers" })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Google Sheets link"), { target: { value: "https://docs.google.com/spreadsheets/d/sample-new-sheet/edit" } });
    expect(within(dialog).getByRole("button", { name: "Read headers" })).toBeDisabled();
  });
});

describe("external links", () => {
  // Read-only cases first, then Settings, which adds, renames and removes links in the shared mock store.
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const card = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;

  it("lists Sales & Finance links with where they go", async () => {
    renderWithHub(<SalesFinancePage />, kingdomAdmin, { path: "/sales-finance", pattern: "/sales-finance" });
    const link = await screen.findByRole("link", { name: "Sample sales board, opens in a new tab" });
    expect(link).toHaveAttribute("href", "https://example.com/monday/sample-sales-board");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
    expect(within(link).getByText("example.com")).toBeInTheDocument();
    expect(within(link).getByText("Opens in a new tab")).toBeInTheDocument();
    expect(within(link).getByText("The sales CRM board. Monday asks you to sign in.")).toBeInTheDocument();
    expect(screen.queryByText("Sample production board")).not.toBeInTheDocument();
  });

  it("embeds only a view flagged as public, with the direct link beside it", async () => {
    const { container } = renderWithHub(<ProductionPage />, kingdomEmployee, { path: "/production", pattern: "/production" });
    expect(await screen.findByText("Sample production board")).toBeInTheDocument();
    const frames = container.querySelectorAll("iframe");
    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame).toHaveAttribute("title", "Sample schedule view");
    expect(frame).toHaveAttribute("src", "https://example.com/embed/sample-schedule");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-forms");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(frame).toHaveAttribute("loading", "lazy");
    const figure = frame.closest("figure") as HTMLElement;
    expect(within(figure).getByText("Public share view")).toBeInTheDocument();
    expect(within(figure).getByRole("link", { name: "Sample schedule view, opens in a new tab" })).toHaveAttribute("href", "https://example.com/monday/sample-schedule");
    expect(screen.getByRole("link", { name: "Sample production board, opens in a new tab" }).closest("figure")).toBeNull();
  });

  it("groups every readable link under its section on Home", async () => {
    const { container } = renderWithHub(<DashboardPage />, kingdomAdmin);
    await screen.findByRole("heading", { name: "Sections" });
    const shortcuts = card("Sections");
    const group = async (name: string) => within(shortcuts).findByRole("group", { name });
    expect(within(await group("Home")).getByText("Sample owner report")).toBeInTheDocument();
    expect(within(await group("Sales & Finance")).getByText("Sample sales board")).toBeInTheDocument();
    const production = await group("Production");
    expect(within(production).getByText("Sample production board")).toBeInTheDocument();
    expect(within(production).getByText("Sample schedule view")).toBeInTheDocument();
    expect(within(shortcuts).getAllByRole("group")).toHaveLength(3);
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("shows no links to a company without the module", async () => {
    const { unmount } = renderWithHub(<DashboardPage />, admin);
    expect(await screen.findByText("Closed sales")).toBeInTheDocument();
    expect(screen.queryByText("Outside tools")).not.toBeInTheDocument();
    expect(screen.queryByText("Sample sales board")).not.toBeInTheDocument();
    unmount();
    renderWithHub(<CompanySettingsPage />, admin);
    expect(await screen.findByText("Connections")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "External links" })).not.toBeInTheDocument();
  });

  it("keeps the links in Settings", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, kingdomAdmin, { path: "/settings", pattern: "/settings" });
    await screen.findByRole("heading", { name: "External links" });
    const panel = card("External links");
    for (const label of ["Sample sales board", "Sample production board", "Sample owner report", "Sample schedule view"]) {
      expect(await within(panel).findByLabelText(`Label for ${label}`)).toHaveValue(label);
    }

    const add = within(panel).getByRole("form", { name: "Add a link" });
    await user.type(within(add).getByLabelText("Label"), "Sample insecure board");
    await user.type(within(add).getByLabelText("Link"), "http://example.com/x");
    await user.click(within(add).getByRole("button", { name: "Add link" }));
    expect(within(panel).getByText("Links must start with https://.")).toBeInTheDocument();
    expect(within(panel).queryByLabelText("Label for Sample insecure board")).not.toBeInTheDocument();

    await user.clear(within(add).getByLabelText("Label"));
    await user.type(within(add).getByLabelText("Label"), "Sample estimating board");
    await user.clear(within(add).getByLabelText("Link"));
    await user.type(within(add).getByLabelText("Link"), "https://example.com/monday/sample-estimating");
    await user.click(within(add).getByRole("button", { name: "Add link" }));
    expect(await within(panel).findByLabelText("Label for Sample estimating board")).toHaveValue("Sample estimating board");
    expect(within(panel).queryByText("Links must start with https://.")).not.toBeInTheDocument();

    const sales = within(panel).getByLabelText("Label for Sample sales board");
    await user.clear(sales);
    await user.type(sales, "Sample sales pipeline");
    await user.tab();
    expect(await within(panel).findByLabelText("Label for Sample sales pipeline")).toHaveValue("Sample sales pipeline");

    await user.click(within(panel).getByLabelText("Show as a public embed for Sample production board"));
    expect(within(panel).getByText("Add the share view's embed link first.")).toBeInTheDocument();
    expect(within(panel).getByLabelText("Show as a public embed for Sample production board")).not.toBeChecked();

    await user.click(within(panel).getByRole("button", { name: "Remove Sample owner report" }));
    const dialog = screen.getByRole("dialog", { name: "Remove this link?" });
    expect(within(dialog).getByText("People will no longer see it in the hub. The page it points to is not affected.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(panel).queryByLabelText("Label for Sample owner report")).not.toBeInTheDocument();
  });
});

describe("roles", () => {
  const kingdomOwner = makeHub("owner", KINGDOM.company);
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomManager = makeHub("manager", KINGDOM.company);
  const optionsOf = (select: HTMLElement) => within(select).getAllByRole("option").map((o) => o.textContent);

  it("gives an owner what an admin gets", async () => {
    expect(kingdomOwner.isAdmin).toBe(true);
    expect(kingdomOwner.profile.full_name).toBe("Marcus Lee");
    renderWithHub(<DashboardPage />, kingdomOwner);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    const people = (await screen.findAllByText("People")).map((el) => el.parentElement!).find((el) => el.textContent?.includes("not signed in yet"));
    expect(people).toBeDefined();
    expect(within(people!).getByText("1 not signed in yet")).toBeInTheDocument();
  });

  it("counts an owner as the company's admin on the portfolio", async () => {
    const original = profilesService.listCompanyProfiles;
    const spy = vi
      .spyOn(profilesService, "listCompanyProfiles")
      .mockImplementation(async (id) => (await original(id)).filter((p) => id !== KINGDOM.company.id || p.role !== "admin"));
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<PortfolioPage />, rococo, { path: "/rococo", pattern: "/rococo" });
    expect(await screen.findByRole("heading", { name: KINGDOM.company.name })).toBeInTheDocument();
    await waitFor(() => expect(spy).toHaveBeenCalledWith(KINGDOM.company.id));
    expect((await screen.findAllByText(/invitations? pending/)).length).toBe(3);
    expect(screen.queryByText("No admin yet")).not.toBeInTheDocument();
  });

  it("gives a manager the employee dashboard", async () => {
    expect(kingdomManager.isAdmin).toBe(false);
    renderWithHub(<DashboardPage />, kingdomManager);
    expect(await screen.findByRole("heading", { name: /Welcome back, Jules/ })).toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
  });

  it("offers Owner only to an owner", async () => {
    const first = renderWithHub(<PeoplePage />, kingdomAdmin);
    const dana = await screen.findByLabelText("Role for Dana Whitfield");
    expect(optionsOf(dana)).toEqual(["Admin", "Manager", "Employee"]);
    const marcus = screen.getByLabelText("Role for Marcus Lee");
    expect(marcus).toBeDisabled();
    expect(marcus).toHaveDisplayValue("Owner");
    expect(marcus).toHaveAttribute("title", "Only an owner or Rococo can change this person's role.");
    first.unmount();
    renderWithHub(<PeoplePage />, kingdomOwner);
    expect(optionsOf(await screen.findByLabelText("Role for Dana Whitfield"))).toEqual(["Owner", "Admin", "Manager", "Employee"]);
  });

  it("leaves the row actions for someone ranked above an admin to an owner or Rococo", async () => {
    // An owner set up on the roster who has not signed in yet, the state owners usually start in.
    const rosterOwner = {
      ...KINGDOM.profiles[0],
      id: "kingdom-roster-owner",
      user_id: null,
      email: "sample.owner@kingdomcustomconstruction.com",
      full_name: "Sample Roster Owner",
    };
    const original = profilesService.listCompanyProfiles;
    const spy = vi
      .spyOn(profilesService, "listCompanyProfiles")
      .mockImplementation(async (id) => [...(await original(id)), ...(id === KINGDOM.company.id ? [rosterOwner] : [])]);
    onTestFinished(() => spy.mockRestore());
    const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

    const first = renderWithHub(<PeoplePage />, kingdomAdmin);
    expect(await screen.findByText("Sample Roster Owner")).toBeInTheDocument();
    expect(rowOf("Sample Roster Owner")).toHaveTextContent("Not invited");
    expect(screen.queryByRole("button", { name: "Send the invitation to Sample Roster Owner" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sample Roster Owner" })).not.toBeInTheDocument();
    expect(within(rowOf("Marcus Lee")).queryByRole("button", { name: /Deactivate|Reactivate/ })).not.toBeInTheDocument();
    // Everyone the admin does not rank below keeps their actions.
    expect(within(rowOf("Dana Whitfield")).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    first.unmount();

    for (const hub of [kingdomOwner, makeHub("rococo", KINGDOM.company)]) {
      const view = renderWithHub(<PeoplePage />, hub);
      expect(await screen.findByRole("button", { name: "Send the invitation to Sample Roster Owner" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Remove Sample Roster Owner" })).toBeInTheDocument();
      view.unmount();
    }
    const rococoView = renderWithHub(<PeoplePage />, makeHub("rococo", KINGDOM.company));
    await screen.findByText("Sample Roster Owner");
    expect(within(rowOf("Marcus Lee")).getByRole("button", { name: "Deactivate" })).toBeInTheDocument();
    rococoView.unmount();
  });

  it("explains each role when adding staff", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, kingdomAdmin);
    await user.click(await screen.findByRole("button", { name: /Add staff/ }));
    const role = screen.getByLabelText("Role");
    expect(optionsOf(role)).not.toContain("Owner");
    await user.selectOptions(role, "manager");
    expect(screen.getByText("Managers see what employees see for now. Team access comes later.")).toBeInTheDocument();
  });

  it("keeps an owner's role out of an admin's hands on the person page", async () => {
    renderWithHub(<PersonPage />, kingdomAdmin, { path: "/people/kingdom-user-1", pattern: "/people/:profileId" });
    const role = await screen.findByLabelText("Role");
    expect(role).toBeDisabled();
    expect(role).toHaveValue("owner");
    expect(screen.getByText("Only an owner or Rococo can change this person's role.")).toBeInTheDocument();
  });

  it("lets Rococo grant any role", async () => {
    renderWithHub(<UsersPage />, rococo, { path: "/rococo/people", pattern: "/rococo/people" });
    const marcus = await screen.findByLabelText(`Role for ${KINGDOM.profiles[0].email}`);
    expect(optionsOf(marcus)).toEqual(["Owner", "Admin", "Manager", "Employee"]);
    expect(marcus).toHaveDisplayValue("Owner");
  });

  it("leaves Klasik's roster as it was, plus the Manager value", async () => {
    renderWithHub(<PeoplePage />, admin);
    expect(optionsOf(await screen.findByLabelText("Role for Sam Ortega"))).toEqual(["Admin", "Manager", "Employee"]);
  });
});
