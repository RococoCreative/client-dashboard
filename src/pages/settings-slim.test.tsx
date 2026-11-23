// Settings, slimmed to the company itself: its values read as text until one Edit button opens the
// form, a failed save stays in the form, and a card signposts where the rest of setup moved.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { setMockCapabilities, resetMockCapabilities } from "../test/mocks/capabilities.ts";
import { KINGDOM, KLASIK, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";

const admin = makeHub("admin");
const at = (tab: string) => ({ path: `/settings/${tab}`, pattern: `/settings/${tab}` });

// The Company card, found by its heading; the page header repeats the company's name above it.
const companyCard = () => within(screen.getByRole("heading", { name: "Company" }).closest("section") as HTMLElement);

describe("Settings Company, read first", () => {
  it("shows name, logo and time zone as text with one Edit button, no fields", async () => {
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await screen.findByRole("heading", { name: "Company" });
    expect(companyCard().getByText("Klasik Construction")).toBeInTheDocument();
    expect(companyCard().getByText("America/New_York")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Time zone")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows the logo as an image named for the company when one is set", async () => {
    const withLogo = makeHub("admin", { ...KLASIK.company, logo_url: "https://example.com/klasik-logo.png" });
    renderWithHub(<SettingsPage tab="company" />, withLogo, at("company"));
    await screen.findByRole("heading", { name: "Company" });
    const logo = companyCard().getByRole("img", { name: "Klasik Construction logo" });
    expect(logo).toHaveAttribute("src", "https://example.com/klasik-logo.png");
    expect(companyCard().queryByText("No logo yet.")).not.toBeInTheDocument();
  });

  it("says there is no logo yet when none is set", async () => {
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await screen.findByRole("heading", { name: "Company" });
    expect(companyCard().getByText("No logo yet.")).toBeInTheDocument();
    expect(companyCard().queryByRole("img")).not.toBeInTheDocument();
  });

  it("opens the form on Edit, saves, and returns to text", async () => {
    const user = userEvent.setup();
    const { getCompany, updateCompany } = await import("../services/companies.ts");
    const id = admin.company!.id;
    onTestFinished(async () => {
      await updateCompany(id, { time_zone: "America/New_York" });
    });
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const zone = screen.getByLabelText("Time zone");
    expect(screen.getByLabelText("Name")).toHaveValue("Klasik Construction");
    await user.clear(zone);
    await user.type(zone, "America/Chicago");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Time zone")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect((await getCompany(id)).time_zone).toBe("America/Chicago");
  });

  it("stays in the form with the draft and the error when a save fails", async () => {
    const user = userEvent.setup();
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const zone = screen.getByLabelText("Time zone");
    await user.clear(zone);
    await user.type(zone, "Mars/Olympus_Mons");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("That time zone is not recognized.")).toBeInTheDocument();
    expect(screen.getByLabelText("Time zone")).toHaveValue("Mars/Olympus_Mons");
    expect(screen.queryByText("Saved.")).not.toBeInTheDocument();
  });

  it("keeps the validation line for an empty name", async () => {
    const user = userEvent.setup();
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The company needs a name.")).toBeInTheDocument();
  });

  it("drops a draft only when Cancel is chosen", async () => {
    const user = userEvent.setup();
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Name"), " Group");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(companyCard().getByText("Klasik Construction")).toBeInTheDocument();
    expect(companyCard().queryByText("Klasik Construction Group")).not.toBeInTheDocument();
  });
});

describe("Settings, set up elsewhere", () => {
  const linksIn = () => {
    const card = screen.getByRole("heading", { name: "Set up elsewhere" }).closest("section") as HTMLElement;
    return within(card).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")]);
  };

  it("lists the three moved setups for a company without the production module", async () => {
    renderWithHub(<SettingsPage tab="company" />, admin, at("company"));
    await screen.findByRole("heading", { name: "Set up elsewhere" });
    expect(linksIn()).toEqual([
      ["Job roles and divisions", "/people/roles"],
      ["Pillars, weights and deliverable categories", "/reviews/setup"],
      ["The goals a GSR requires", "/gsr/setup"],
    ]);
  });

  it("adds Standard milestones for a company with the production module", async () => {
    renderWithHub(<SettingsPage tab="company" />, makeHub("admin", KINGDOM.company), at("company"));
    await screen.findByRole("heading", { name: "Set up elsewhere" });
    expect(linksIn().at(-1)).toEqual(["Standard milestones", "/production/setup"]);
    expect(linksIn()).toHaveLength(4);
  });

  it("shows on every tab, so an admin without the Company tab still sees it", async () => {
    renderWithHub(<SettingsPage tab="connections" />, admin, at("connections"));
    expect(await screen.findByRole("heading", { name: "Set up elsewhere" })).toBeInTheDocument();
  });
});

describe("Settings through the real router", () => {
  function openApp(path: string, company: string) {
    window.history.pushState({}, "", `${path}?persona=admin&company=${company}`);
    render(<App />);
  }

  it("keeps a half-typed Company edit when the admin visits Connections and comes back", async () => {
    const user = userEvent.setup();
    openApp("/settings/company", KLASIK.company.slug);
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.type(screen.getByLabelText("Name"), " Group");
    const nav = screen.getByRole("navigation", { name: "Settings" });
    await user.click(within(nav).getByRole("link", { name: "Connections" }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/connections"));
    expect(screen.getByLabelText("Name")).not.toBeVisible();
    await user.click(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "Company" }));
    await waitFor(() => expect(window.location.pathname).toBe("/settings/company"));
    expect(screen.getByLabelText("Name")).toBeVisible();
    expect(screen.getByLabelText("Name")).toHaveValue("Klasik Construction Group");
  });

  it("gives an admin without company_settings no Company panel in the document, hidden or not", async () => {
    setMockCapabilities(KINGDOM.company.id, { company_settings: "owner" });
    onTestFinished(() => resetMockCapabilities());
    openApp("/settings/connections", KINGDOM.company.slug);
    await screen.findByRole("heading", { name: "Connections" });
    expect(document.getElementById("company-name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit", hidden: true })).toBeNull();
    expect(screen.queryByText("Hub identifier", { ignore: "none" })).toBeNull();
  });
});
