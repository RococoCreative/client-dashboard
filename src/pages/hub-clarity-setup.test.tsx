// Reviews, Setup: the tab row on Reviews (Cycles, Setup), pillars as a short list with one open at a
// time, setup fields that read as text until their pencil, criteria as read-first rows with one Add
// form, the pillar actions at the foot of the open pillar, Settings without a Reviews tab, and the
// three old addresses landing on Setup through the real router.
// GSRs, Setup: the tab row, the calendar and goal count, and the old address. Projects, Setup: the
// tab row on Projects for an admin (the Projects tab only for someone who can open Projects), the
// standard milestones panel on its own route, Settings without a Production tab, and the old
// address redirecting.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/sopCategories.ts", () => import("../test/mocks/sopCategories.ts"));
vi.mock("../services/sopSignoffs.ts", () => import("../test/mocks/sopSignoffs.ts"));
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
vi.mock("../services/connectorRequests.ts", () => import("../test/mocks/connectorRequests.ts"));
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
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { resetMockCapabilities, setMockCapabilities } from "../test/mocks/capabilities.ts";
import { createPillar, deletePillar, listPillars } from "../services/gsr.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import GsrSetupPage from "./gsr/GsrSetupPage.tsx";
import ReviewsSetupPage from "./gsr/ReviewsSetupPage.tsx";
import ProductionPage from "./production/ProductionPage.tsx";
import ProductionSetupPage from "./production/ProductionSetupPage.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";

const admin = makeHub("admin");

function openSetup() {
  return renderWithHub(<ReviewsSetupPage />, admin, { path: "/reviews/setup", pattern: "/reviews/setup" });
}

// The row that opens a pillar, found by the pillar's name.
const panelOf = (name: string) => screen.getByRole("region", { name: new RegExp(`^\\d+\\s*${name}`) });
const rowOf = (name: string) => screen.getByRole("button", { name: new RegExp(`^\\d+\\s*${name}`) });

describe("Reviews tabs", () => {
  it("shows Cycles and Setup on Reviews, Cycles current", async () => {
    renderWithHub(<CyclesPage section="reviews" />, admin, { path: "/reviews", pattern: "/reviews" });
    const nav = await screen.findByRole("navigation", { name: "Reviews" });
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Cycles", "/reviews"],
      ["Setup", "/reviews/setup"],
    ]);
    expect(within(nav).getByRole("link", { name: "Cycles" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps the Reviews tab row off GSRs and points its settings link at Setup", async () => {
    renderWithHub(<CyclesPage section="gsr" />, admin, { path: "/gsr", pattern: "/gsr" });
    expect(await screen.findByRole("link", { name: /Review settings/ })).toHaveAttribute("href", "/reviews/setup");
    expect(screen.queryByRole("navigation", { name: "Reviews" })).not.toBeInTheDocument();
  });

  it("marks Setup current on the setup page", async () => {
    openSetup();
    const nav = await screen.findByRole("navigation", { name: "Reviews" });
    expect(within(nav).getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
  });
});

describe("pillars on Setup", () => {
  it("lists every pillar closed, with its number, name, scoring type and weight", async () => {
    openSetup();
    expect(await screen.findByText("Weights total 100%")).toBeInTheDocument();
    const deliverables = rowOf("Deliverables");
    expect(deliverables).toHaveTextContent("1");
    expect(deliverables).toHaveTextContent("Target vs actual");
    expect(deliverables).toHaveTextContent("50%");
    expect(rowOf("Brand Impact")).toHaveTextContent("Rated criteria");
    expect(rowOf("Brand Impact")).toHaveTextContent("25%");
    expect(screen.getAllByRole("button", { expanded: false })).toHaveLength(3);
    // Nothing is open, so no field or criterion shows.
    expect(screen.queryByLabelText("Weight %")).not.toBeInTheDocument();
    expect(screen.queryByText("Curiosity")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete pillar" })).not.toBeInTheDocument();
  });

  it("opens one pillar to show its criteria, and opening another closes it", async () => {
    const user = userEvent.setup();
    openSetup();
    await screen.findByText("Weights total 100%");
    await user.click(rowOf("Character & Values"));
    expect(rowOf("Character & Values")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Curiosity")).toBeInTheDocument();
    expect(screen.queryByText("DNA")).not.toBeInTheDocument();

    await user.click(rowOf("Brand Impact"));
    expect(screen.getByText("DNA")).toBeInTheDocument();
    expect(screen.queryByText("Curiosity")).not.toBeInTheDocument();
    expect(rowOf("Character & Values")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);

    // The open row closes again from its own header.
    await user.click(rowOf("Brand Impact"));
    expect(screen.queryByText("DNA")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { expanded: true })).not.toBeInTheDocument();
  });

  it("reads a weight as text until its pencil, then saves it and moves the total", async () => {
    const user = userEvent.setup();
    openSetup();
    await screen.findByText("Weights total 100%");
    await user.click(rowOf("Deliverables"));
    expect(screen.queryByLabelText("Weight %")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit weight" }));
    const weight = screen.getByLabelText("Weight %");
    expect(weight).toHaveValue(50);
    await user.clear(weight);
    await user.type(weight, "40");
    await user.tab();
    expect(await screen.findByText("Weights total 90%")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Weight %")).not.toBeInTheDocument();
    expect(rowOf("Deliverables")).toHaveTextContent("40%");

    // The mocks keep what is saved for the rest of the file, so put the weight back.
    await user.click(screen.getByRole("button", { name: "Edit weight" }));
    const again = screen.getByLabelText("Weight %");
    await user.clear(again);
    await user.type(again, "50");
    await user.tab();
    expect(await screen.findByText("Weights total 100%")).toBeInTheDocument();
  });

  it("keeps the Move and Delete actions at the foot of the open pillar, in words", async () => {
    const user = userEvent.setup();
    openSetup();
    await screen.findByText("Weights total 100%");
    await user.click(rowOf("Deliverables"));
    const open = panelOf("Deliverables");
    expect(within(open).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(open).getByRole("button", { name: "Move down" })).toBeEnabled();
    expect(within(open).getByRole("button", { name: "Delete pillar" })).toHaveTextContent("Delete pillar");
    await user.click(within(open).getByRole("button", { name: "Move down" }));
    // The pillar moved to second place and stays open.
    await waitFor(() => expect(rowOf("Deliverables")).toHaveTextContent(/^2/));
    expect(rowOf("Deliverables")).toHaveAttribute("aria-expanded", "true");
    // And back, so the order the mocks hold is the one the other tests expect.
    await user.click(within(panelOf("Deliverables")).getByRole("button", { name: "Move up" }));
    await waitFor(() => expect(rowOf("Deliverables")).toHaveTextContent(/^1/));
  });

  it("closes the scale row when Scoring moves off Rating, so switching back shows it as text", async () => {
    const user = userEvent.setup();
    openSetup();
    await screen.findByText("Weights total 100%");
    await user.click(rowOf("Character & Values"));
    await user.click(screen.getByRole("button", { name: "Edit scale" }));
    expect(screen.getByLabelText("Scale (1 to)")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit scoring" }));
    await user.selectOptions(screen.getByLabelText("Scoring"), "Target vs actual");
    await waitFor(() => expect(screen.queryByLabelText("Scale (1 to)")).not.toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Scoring"), "Rated criteria");
    // The scale is back, read first: its pencil is offered and its select is not open.
    expect(await screen.findByRole("button", { name: "Edit scale" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Scale (1 to)")).not.toBeInTheDocument();
  });

  it("lets a criterion add run without disabling Add pillar", async () => {
    const user = userEvent.setup();
    const gate = { release: () => {} };
    const { createCriterion } = await import("../services/gsr.ts");
    const spy = vi.spyOn(await import("../services/gsr.ts"), "createCriterion").mockImplementationOnce(
      (input) => new Promise((resolve) => { gate.release = () => resolve(createCriterion(input)); }),
    );
    onTestFinished(() => spy.mockRestore());
    openSetup();
    await screen.findByText("Weights total 100%");
    await user.click(rowOf("Character & Values"));
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    await user.type(screen.getByLabelText("New criterion for Character & Values"), "Reliability");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(screen.getByRole("button", { name: "Add pillar" })).toBeEnabled();
    gate.release();
    expect(await screen.findByText("Reliability")).toBeInTheDocument();
  });

  it("reads criteria as text, with one Add criterion form behind its button", async () => {
    const user = userEvent.setup();
    openSetup();
    await screen.findByText("Weights total 100%");
    await user.click(rowOf("Character & Values"));
    expect(screen.queryByLabelText("Criterion name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New criterion for Character & Values")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    await user.type(screen.getByLabelText("New criterion for Character & Values"), "Punctuality");
    await user.click(screen.getByRole("button", { name: "Add criterion" }));
    expect(await screen.findByText("Punctuality")).toBeInTheDocument();
    expect(screen.queryByLabelText("New criterion for Character & Values")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit criterion Curiosity" }));
    const name = screen.getByLabelText("Criterion name");
    await user.clear(name);
    await user.type(name, "Curiosity and drive");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByText("Curiosity and drive")).toBeInTheDocument();
  });

  it("holds the deliverable categories on the same page", async () => {
    openSetup();
    expect(await screen.findByRole("heading", { name: "Deliverable categories" })).toBeInTheDocument();
  });
});

describe("Settings without a Reviews tab", () => {
  it("lists no Reviews tab, and points to Reviews, Setup", async () => {
    renderWithHub(<SettingsPage tab="company" />, admin, { path: "/settings/company", pattern: "/settings/company" });
    const nav = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(nav).queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Pillars, weights and deliverable categories" })).toHaveAttribute("href", "/reviews/setup");
    expect(screen.queryByRole("heading", { name: "Pillars and weights" })).not.toBeInTheDocument();
  });
});

describe("the old addresses", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it.each(["/settings/reviews", "/reviews/settings", "/gsr/settings"])("sends %s to Reviews, Setup", async (address) => {
    window.history.pushState({}, "", `${address}?persona=admin&company=${KLASIK.company.slug}`);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/reviews/setup"));
    expect(await screen.findByRole("heading", { name: "Pillars and weights" })).toBeInTheDocument();
  });
});

describe("Projects tabs", () => {
  const kingdomAdmin = makeHub("admin", KINGDOM.company);
  const kingdomEmployee = makeHub("employee", KINGDOM.company);
  const projectsAt = { path: "/production", pattern: "/production" };
  const linksOf = (nav: HTMLElement) => within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);

  it("shows Projects and Setup to an admin, Projects current", async () => {
    renderWithHub(<ProductionPage />, kingdomAdmin, projectsAt);
    const nav = await screen.findByRole("navigation", { name: "Projects" });
    expect(linksOf(nav)).toEqual([
      ["Projects", "/production"],
      ["Setup", "/production/setup"],
    ]);
    expect(within(nav).getByRole("link", { name: "Projects" })).toHaveAttribute("aria-current", "page");
  });

  it("shows an employee no tab row", async () => {
    renderWithHub(<ProductionPage />, kingdomEmployee, projectsAt);
    await screen.findByRole("heading", { level: 1, name: "Production" });
    expect(screen.queryByRole("navigation", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("leaves the Projects tab off Setup for an admin who cannot open Projects", async () => {
    setMockCapabilities(KINGDOM.company.id, { production_view: "owner" });
    onTestFinished(() => resetMockCapabilities());
    renderWithHub(<ProductionSetupPage />, kingdomAdmin, { path: "/production/setup", pattern: "/production/setup" });
    const nav = await screen.findByRole("navigation", { name: "Projects" });
    expect(linksOf(nav)).toEqual([["Setup", "/production/setup"]]);
  });

  it("renders the standard milestones on Setup with the tab row, Setup current", async () => {
    renderWithHub(<ProductionSetupPage />, kingdomAdmin, { path: "/production/setup", pattern: "/production/setup" });
    const nav = await screen.findByRole("navigation", { name: "Projects" });
    expect(within(nav).getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
    expect(await screen.findByRole("heading", { name: "Standard milestones" })).toBeInTheDocument();
  });
});

describe("Settings without a Production tab", () => {
  it("lists no Production tab, and points a company with the module to Standard milestones", async () => {
    renderWithHub(<SettingsPage tab="company" />, makeHub("admin", KINGDOM.company), { path: "/settings/company", pattern: "/settings/company" });
    const nav = await screen.findByRole("navigation", { name: "Settings" });
    expect(within(nav).queryByRole("link", { name: "Production" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Standard milestones" })).toHaveAttribute("href", "/production/setup");
  });

  it("does not point a company without the module to Standard milestones", async () => {
    renderWithHub(<SettingsPage tab="company" />, admin, { path: "/settings/company", pattern: "/settings/company" });
    await screen.findByRole("navigation", { name: "Settings" });
    expect(screen.queryByRole("link", { name: "Standard milestones" })).not.toBeInTheDocument();
  });
});

describe("the standard milestones addresses", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));

  it("sends /settings/production to Projects, Setup", async () => {
    window.history.pushState({}, "", "/settings/production?persona=admin&company=kingdom");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/production/setup"));
    expect(await screen.findByRole("heading", { name: "Standard milestones" })).toBeInTheDocument();
  });

  it("sends an employee from /production/setup Home", async () => {
    window.history.pushState({}, "", "/production/setup?persona=employee&company=kingdom");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("heading", { name: "Standard milestones" })).not.toBeInTheDocument();
  });

  it("sends a company without the module Home", async () => {
    window.history.pushState({}, "", `/production/setup?persona=admin&company=${KLASIK.company.slug}`);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
    expect(screen.queryByRole("heading", { name: "Standard milestones" })).not.toBeInTheDocument();
  });
});

describe("GSRs, Setup", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));
  const openGsrSetup = (hub = admin) => renderWithHub(<GsrSetupPage />, hub, { path: "/gsr/setup", pattern: "/gsr/setup" });

  it("shows Periods and Setup on GSRs, Periods current", async () => {
    renderWithHub(<CyclesPage section="gsr" />, admin, { path: "/gsr", pattern: "/gsr" });
    const nav = await screen.findByRole("navigation", { name: "GSRs" });
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Periods", "/gsr"],
      ["Setup", "/gsr/setup"],
    ]);
    expect(within(nav).getByRole("link", { name: "Periods" })).toHaveAttribute("aria-current", "page");
  });

  it("hides the Setup tab from someone who cannot reach it", async () => {
    // The GSR list is an admin's page: anyone else is sent to their own GSR and never sees its tabs.
    window.history.pushState({}, "", "/gsr?persona=employee&company=klasik");
    const { unmount } = render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/my/gsr"));
    expect(screen.queryByRole("navigation", { name: "GSRs" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
    unmount();
  });

  it("says GSRs are not scored here for a company with no Monthly GSRs pillar, and still shows the calendar", async () => {
    openGsrSetup();
    expect(await screen.findByText("GSRs are not scored here yet.")).toBeInTheDocument();
    expect(screen.queryByText("Goals each GSR requires")).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Focus topic calendar" })).toBeInTheDocument();
    expect(await screen.findByLabelText("Theme for October 2026")).toHaveValue("Core value: Ownership");
    const nav = screen.getByRole("navigation", { name: "GSRs" });
    expect(within(nav).getByRole("link", { name: "Setup" })).toHaveAttribute("aria-current", "page");
  });

  it("treats a company whose only Monthly GSRs pillar is inactive as not scoring GSRs", async () => {
    const inactive = await createPillar({ company_id: RBA.company.id, name: "Monthly GSRs", weight: 0, scoring_type: "gsr_goals", required_goals: 3, sort_order: 9, is_active: false });
    onTestFinished(() => deletePillar(inactive.id));
    openGsrSetup(makeHub("admin", RBA.company));
    expect(await screen.findByText("GSRs are not scored here yet.")).toBeInTheDocument();
    expect(screen.queryByText(/goals each GSR requires/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Goals each GSR requires" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Focus topic calendar" })).toBeInTheDocument();
  });

  it("reads the stored goal count as text, and saves a change through updatePillar", async () => {
    const user = userEvent.setup();
    const pillar = await createPillar({ company_id: KINGDOM.company.id, name: "Monthly GSRs", weight: 0, scoring_type: "gsr_goals", required_goals: 3, sort_order: 9 });
    openGsrSetup(makeHub("admin", KINGDOM.company));
    expect(await screen.findByText("Goals each GSR requires")).toBeInTheDocument();
    expect(screen.queryByText("GSRs are not scored here yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit Goals each GSR requires" }));
    const field = screen.getByLabelText("Goals each GSR requires");
    expect(field).toHaveValue("3");
    await user.selectOptions(field, "4");
    await waitFor(async () => expect((await listPillars(KINGDOM.company.id)).find((p) => p.id === pillar.id)?.required_goals).toBe(4));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Goals each GSR requires")).not.toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(await screen.findByLabelText("Theme for October 2026")).toBeInTheDocument();
  });

  it("shows one field per Monthly GSRs pillar, each named", async () => {
    await createPillar({ company_id: KINGDOM.company.id, name: "Second GSR pillar", weight: 0, scoring_type: "gsr_goals", required_goals: 1, sort_order: 10 });
    openGsrSetup(makeHub("admin", KINGDOM.company));
    expect(await screen.findByText("Monthly GSRs: goals each GSR requires")).toBeInTheDocument();
    expect(screen.getByText("Second GSR pillar: goals each GSR requires")).toBeInTheDocument();
  });

  it("sends /goals/focus to GSRs, Setup, and an employee Home", async () => {
    window.history.pushState({}, "", "/goals/focus?persona=admin&company=klasik");
    const { unmount } = render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/gsr/setup"));
    expect(await screen.findByRole("heading", { name: "Focus topic calendar" })).toBeInTheDocument();
    unmount();
    window.history.pushState({}, "", "/gsr/setup?persona=employee&company=klasik");
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/"));
  });

  it("names the sidebar item GSRs", async () => {
    window.history.pushState({}, "", "/?persona=admin&company=klasik");
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Primary" });
    expect(within(nav).getByRole("link", { name: "GSRs" })).toHaveAttribute("href", "/gsr");
    expect(within(nav).queryByRole("link", { name: "Monthly GSRs" })).not.toBeInTheDocument();
  });
});
