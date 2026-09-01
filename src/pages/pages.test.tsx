// Every page renders real content against the mocked data layer, for an admin and, where it
// differs, an employee. The mocks mirror the services module for module, so a page calling a
// service that does not exist fails here rather than in someone's browser.
import { screen, within } from "@testing-library/react";
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
import RococoPage from "./RococoPage.tsx";

const admin = makeHub("admin");
const employee = makeHub("employee");
const rococo = makeHub("rococo", KLASIK.company);
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

  it("lists every company and user for Rococo", async () => {
    renderWithHub(<RococoPage />, rococo);
    for (const company of COMPANIES) {
      expect(await screen.findByRole("heading", { name: company.name })).toBeInTheDocument();
    }
    expect(await screen.findByText("Austin Rococo (you)")).toBeInTheDocument();
    expect(screen.getByText(/users$/)).toBeInTheDocument();
  });
});
