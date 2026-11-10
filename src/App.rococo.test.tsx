// The Rococo admin path through the real gate and router: sign in with no company, land on
// the portfolio in the Rococo theme with no "My GSR", open a company from its card, and the
// hub switches to that company's dashboard and theme with a way back. It also proves every
// route lands in the same place for a company with modules on as for one with none, that
// ModuleOnly keeps a module's pages to the companies that have it, and that a module route
// typed by someone who may not see it redirects home.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./services/supabase.ts", () => import("./test/mocks/supabase.ts"));
vi.mock("./services/auth.ts", () => import("./test/mocks/auth.ts"));
vi.mock("./services/profiles.ts", () => import("./test/mocks/profiles.ts"));
vi.mock("./services/companies.ts", () => import("./test/mocks/companies.ts"));
vi.mock("./services/invitations.ts", () => import("./test/mocks/invitations.ts"));
vi.mock("./services/gsr.ts", () => import("./test/mocks/gsr.ts"));
vi.mock("./services/sops.ts", () => import("./test/mocks/sops.ts"));
vi.mock("./services/resources.ts", () => import("./test/mocks/resources.ts"));
vi.mock("./services/storage.ts", () => import("./test/mocks/storage.ts"));
vi.mock("./services/financials.ts", () => import("./test/mocks/financials.ts"));
vi.mock("./services/marketing.ts", () => import("./test/mocks/marketing.ts"));
vi.mock("./services/employees.ts", () => import("./test/mocks/employees.ts"));
vi.mock("./services/deliverables.ts", () => import("./test/mocks/deliverables.ts"));
vi.mock("./services/jobRoles.ts", () => import("./test/mocks/jobRoles.ts"));
vi.mock("./services/connections.ts", () => import("./test/mocks/connections.ts"));
vi.mock("./services/audit.ts", () => import("./test/mocks/audit.ts"));
vi.mock("./services/projects.ts", () => import("./test/mocks/projects.ts"));
vi.mock("./services/wins.ts", () => import("./test/mocks/wins.ts"));
vi.mock("./services/sync.ts", () => import("./test/mocks/sync.ts"));
vi.mock("./services/externalLinks.ts", () => import("./test/mocks/externalLinks.ts"));
vi.mock("./services/focusTopics.ts", () => import("./test/mocks/focusTopics.ts"));
vi.mock("./services/scorecards.ts", () => import("./test/mocks/scorecards.ts"));
vi.mock("./services/divisions.ts", () => import("./test/mocks/divisions.ts"));
vi.mock("./services/projectAssignments.ts", () => import("./test/mocks/projectAssignments.ts"));
vi.mock("./services/reviewProjectNotes.ts", () => import("./test/mocks/reviewProjectNotes.ts"));

import App, { ModuleOnly } from "./App.tsx";
import { renderWithHub } from "./test/renderWithHub.tsx";
import { KINGDOM, KLASIK, makeHub, type CompanyBundle } from "./test/fixtures.ts";

describe("Rococo admin sign-in", () => {
  it("lands on the portfolio, then steps into a company and back", async () => {
    window.history.pushState({}, "", "/?persona=rococo");
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("rococo");
    expect(screen.queryByText("My GSR")).not.toBeInTheDocument();
    expect(screen.getAllByText("Rococo Creative").length).toBeGreaterThan(0);

    const openButtons = await screen.findAllByRole("button", { name: /Open hub/ });
    await user.click(openButtons[0]);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("kingdom");
    expect(screen.getByText("Back to portfolio")).toBeInTheDocument();
    expect(screen.queryByText("My GSR")).not.toBeInTheDocument();
    expect(screen.getByText("Rococo view")).toBeInTheDocument();

    await user.click(screen.getByText("Back to portfolio"));
    expect(await screen.findByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("rococo");
  });
});

describe("ModuleOnly", () => {
  const gated = <ModuleOnly module="wins"><p>wins page</p></ModuleOnly>;

  it("renders its page for a company with the module on", () => {
    renderWithHub(gated, makeHub("admin", KINGDOM.company), { path: "/x", pattern: "/x" });
    expect(screen.getByText("wins page")).toBeInTheDocument();
  });

  it("sends a company without the module home", () => {
    renderWithHub(gated, makeHub("admin"), { path: "/x", pattern: "/x" });
    expect(screen.getByText("elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("wins page")).not.toBeInTheDocument();
  });

  it("sends a Rococo admin with no company to the portfolio", () => {
    renderWithHub(gated, makeHub("rococo", null), { path: "/x", pattern: "/x" });
    expect(screen.getByText("elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("wins page")).not.toBeInTheDocument();
  });
});

describe("routes land the same with modules on", () => {
  type Persona = "admin" | "employee";

  // Signs in as the persona through the real gate, opens the path, and waits until the
  // router stops redirecting. Returns where it landed.
  async function landing(path: string, persona: Persona, slug: string): Promise<{ pathname: string; search: string }> {
    window.history.pushState({}, "", `${path}${path.includes("?") ? "&" : "?"}persona=${persona}&company=${slug}`);
    render(<App />);
    await screen.findByRole("navigation", { name: "Primary" });
    let last = "";
    await waitFor(() => {
      const now = window.location.pathname + window.location.search;
      const settled = now === last;
      last = now;
      if (!settled) throw new Error("Still redirecting");
    });
    return { pathname: window.location.pathname, search: window.location.search };
  }

  // Fills a route template with ids from that company's own fixtures.
  function fill(template: string, bundle: CompanyBundle): string {
    return template
      .replace(":cycle2", bundle.cycles[2].id)
      .replace(":cycle", bundle.cycles[0].id)
      .replace(":review", bundle.reviews[0].id)
      .replace(":person", bundle.profiles[1].id)
      .replace(":sop", bundle.sops[0].id);
  }

  const companies: Array<[string, CompanyBundle]> = [["klasik", KLASIK], ["kingdom", KINGDOM]];

  const adminSelf = [
    "/", "/gsr", "/reviews", "/goals/company", "/goals/roles", "/goals/focus", "/goals/people", "/scorecards",
    "/gsr/cycles/:cycle", "/reviews/cycles/:cycle2", "/gsr/reviews/:review", "/reviews/:review",
    "/my/gsr", "/my/reviews", "/my/goals", "/people", "/people/:person", "/sops/new",
    "/sops/:sop", "/sops/:sop/edit", "/resources/sops", "/resources/files", "/financials", "/marketing",
    "/settings/company", "/settings/roles", "/settings/reviews", "/settings/connections",
  ];
  // Every address that moved in the reorganization lands on the tab that holds it now.
  const adminCases: Array<[string, string | null]> = [
    ...adminSelf.map((t): [string, null] => [t, null]),
    ["/goals", "/goals/company"],
    ["/reviews/settings", "/settings/reviews"],
    ["/gsr/settings", "/settings/reviews"],
    ["/reviews/company-goals", "/goals/company"],
    ["/gsr/company-goals", "/goals/company"],
    ["/settings", "/settings/company"],
    ["/sops", "/resources/sops"],
    ["/resources", "/resources/sops"],
    ["/my", "/my/gsr"],
    ["/rococo", "/"],
    ["/nope", "/"],
    ["/settings/nope", "/"],
  ];
  const employeeCases: Array<[string, string]> = [
    ["/gsr", "/my/gsr"],
    ["/reviews", "/my/reviews"],
    ["/goals", "/my/goals"],
    ["/goals/company", "/"],
    ["/people", "/"],
    ["/settings", "/"],
    ["/settings/reviews", "/"],
    ["/reviews/settings", "/"],
    ["/sops", "/resources/sops"],
    ["/resources", "/resources/sops"],
    ["/resources/files", "/resources/files"],
    ["/sops/:sop", "/sops/:sop"],
  ];

  for (const [slug, bundle] of companies) {
    it.each(adminCases)(`admin at ${slug}: %s lands where it always has`, async (template, expected) => {
      const path = fill(template, bundle);
      const landed = await landing(path, "admin", slug);
      expect(landed.pathname).toBe(expected ?? path);
    });

    // The provider sends the browser to the company's own return path (App.tsx ConnectionReturn).
    // It lands on Settings > Connections with the outcome shown, then the outcome is taken off the
    // address so a reload does not report it again.
    it(`admin at ${slug}: a connection return lands on Settings > Connections with its outcome`, async () => {
      const message = "The sign-in was cancelled or refused. Nothing changed.";
      const landed = await landing(`/settings/connections/${bundle.company.id}?connect_error=${encodeURIComponent(message)}`, "admin", slug);
      expect(landed.pathname).toBe("/settings/connections");
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(new URLSearchParams(landed.search).get("connect_error")).toBeNull();
    });

    it.each(employeeCases)(`employee at ${slug}: %s lands on %s`, async (template, expected) => {
      const landed = await landing(fill(template, bundle), "employee", slug);
      expect(landed.pathname).toBe(fill(expected, bundle));
    });
  }

  // Module routes: Tasks 4, 5 and 6 append [path, persona, slug, expected] rows here.
  const moduleRoutes: Array<[string, Persona, string, string]> = [
    ["/production", "admin", "kingdom", "/production"],
    ["/production", "admin", "klasik", "/"],
    ["/production/projects/kingdom-project-1", "employee", "kingdom", "/production/projects/kingdom-project-1"],
    ["/production/projects/kingdom-project-1", "employee", "klasik", "/"],
    ["/wins", "admin", "kingdom", "/wins"],
    ["/wins", "admin", "klasik", "/"],
    ["/wins", "employee", "kingdom", "/wins"],
    ["/wins", "employee", "klasik", "/"],
    ["/resources/links", "admin", "kingdom", "/resources/links"],
    ["/resources/links", "employee", "kingdom", "/resources/links"],
    ["/resources/links", "admin", "klasik", "/resources/sops"],
    ["/resources/links", "employee", "klasik", "/resources/sops"],
  ];
  it.each(moduleRoutes)("module routes: %s as %s at %s lands on %s", async (path, persona, slug, expected) => {
    const landed = await landing(path, persona, slug);
    expect(landed.pathname).toBe(expected);
  });

  it.each(["/sales-finance", "/sales-finance/controls"])("keeps a company without data sources out of Sales & Finance: %s", async (path) => {
    window.history.pushState({}, "", `${path}?persona=admin&company=klasik`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sales & Finance" })).not.toBeInTheDocument();
  });

  it.each(["/sales-finance", "/sales-finance/controls"])("sends an employee who types the address back home: %s", async (path) => {
    window.history.pushState({}, "", `${path}?persona=employee&company=kingdom`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: /Welcome back/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sales & Finance" })).not.toBeInTheDocument();
  });

  it("opens both pages for a Kingdom admin", async () => {
    window.history.pushState({}, "", "/sales-finance?persona=admin&company=kingdom");
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sales & Finance" })).toBeInTheDocument();
    await user.click(within(screen.getByRole("navigation", { name: "Sections" })).getByRole("link", { name: "Controls" }));
    expect(await screen.findByRole("heading", { name: "Controls" })).toBeInTheDocument();
  });
});
