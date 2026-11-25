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
vi.mock("./services/sopCategories.ts", () => import("./test/mocks/sopCategories.ts"));
vi.mock("./services/sopSignoffs.ts", () => import("./test/mocks/sopSignoffs.ts"));
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
vi.mock("./services/connectorRequests.ts", () => import("./test/mocks/connectorRequests.ts"));
vi.mock("./services/focusTopics.ts", () => import("./test/mocks/focusTopics.ts"));
vi.mock("./services/scorecards.ts", () => import("./test/mocks/scorecards.ts"));
vi.mock("./services/divisions.ts", () => import("./test/mocks/divisions.ts"));
vi.mock("./services/directory.ts", () => import("./test/mocks/directory.ts"));
vi.mock("./services/projectAssignments.ts", () => import("./test/mocks/projectAssignments.ts"));
vi.mock("./services/reviewProjectNotes.ts", () => import("./test/mocks/reviewProjectNotes.ts"));
vi.mock("./services/tasks.ts", () => import("./test/mocks/tasks.ts"));
vi.mock("./services/capabilities.ts", () => import("./test/mocks/capabilities.ts"));

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

  // Signs in as the persona through the real gate, opens the path, and returns where the router
  // landed. It is told where the case expects to land, because "the address went quiet" is not
  // the same as "the router is done": a redirect that waits on the hub's role and company check
  // can take longer than any quiet window on a busy machine, and a helper that only waits for
  // quiet returns one hop short. So it waits, as long as the redirects take (up to 5s), for the
  // address to reach the expected pathname (and, when given, a search the case calls arrived).
  // Then the address has to hold there for 50ms on the real clock (the tests pin Date), since
  // waitFor also checks on every DOM change and two of those can land between one redirect and
  // the next. If the router never reaches the expected address, or reaches it and then moves on,
  // it returns the address it was at instead, so the caller's own assertion fails naming where
  // the app really went.
  async function landing(
    path: string,
    persona: Persona,
    slug: string,
    expected: string,
    arrived: (search: URLSearchParams) => boolean = () => true,
  ): Promise<{ pathname: string; search: string }> {
    window.history.pushState({}, "", `${path}${path.includes("?") ? "&" : "?"}persona=${persona}&company=${slug}`);
    render(<App />);
    await screen.findByRole("navigation", { name: "Primary" });
    const here = () => ({ pathname: window.location.pathname, search: window.location.search });
    const atExpected = () => window.location.pathname === expected && arrived(new URLSearchParams(window.location.search));
    try {
      await waitFor(() => {
        if (!atExpected()) throw new Error(`Not at ${expected} yet`);
      }, { timeout: 5000 });
    } catch {
      return here();
    }
    let last = "";
    let since = 0;
    let movedOn: { pathname: string; search: string } | null = null;
    await waitFor(() => {
      if (movedOn) return;
      if (!atExpected()) {
        movedOn = here();
        return;
      }
      const now = window.location.pathname + window.location.search;
      if (now !== last) {
        last = now;
        since = performance.now();
      }
      if (performance.now() - since < 50) throw new Error(`Still settling at ${now}`);
    });
    return movedOn ?? here();
  }

  // Fills a route template with ids from that company's own fixtures.
  function fill(template: string, bundle: CompanyBundle): string {
    return template
      .replace(":cycle2", bundle.cycles[2].id)
      .replace(":cycle", bundle.cycles[0].id)
      .replace(":review", bundle.reviews[0].id)
      .replace(":person", bundle.profiles[1].id)
      .replace(":sop", bundle.sops[0].id)
      .replace(":firstRole", bundle.jobRoles[0].id);
  }

  const companies: Array<[string, CompanyBundle]> = [["klasik", KLASIK], ["kingdom", KINGDOM]];

  const adminSelf = [
    "/", "/gsr", "/reviews", "/goals/company", "/goals/people", "/scorecards", "/gsr/setup",
    "/gsr/cycles/:cycle", "/reviews/cycles/:cycle2", "/gsr/reviews/:review", "/reviews/:review",
    "/my/gsr", "/my/reviews", "/my/goals", "/people", "/people/roles/:firstRole", "/people/divisions", "/people/:person", "/sops/new",
    "/sops/:sop", "/sops/:sop/edit", "/resources/sops", "/resources/files", "/financials", "/marketing",
    "/settings/company", "/reviews/setup", "/settings/connections",
  ];
  // Every address that moved in the reorganization lands on the tab that holds it now.
  const adminCases: Array<[string, string | null]> = [
    ...adminSelf.map((t): [string, null] => [t, null]),
    ["/goals", "/goals/company"],
    // The bare Roles address opens the first role on a wide screen (a test DOM counts as wide).
    ["/people/roles", "/people/roles/:firstRole"],
    ["/settings/roles", "/people/roles/:firstRole"],
    ["/goals/roles", "/people/roles/:firstRole"],
    ["/goals/focus", "/gsr/setup"],
    ["/reviews/settings", "/reviews/setup"],
    ["/gsr/settings", "/reviews/setup"],
    ["/settings/reviews", "/reviews/setup"],
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
    ["/reviews/setup", "/"],
    ["/gsr/setup", "/"],
    ["/goals/focus", "/"],
    ["/reviews/settings", "/"],
    ["/sops", "/resources/sops"],
    ["/resources", "/resources/sops"],
    ["/resources/files", "/resources/files"],
    ["/sops/:sop", "/sops/:sop"],
  ];

  for (const [slug, bundle] of companies) {
    it.each(adminCases)(`admin at ${slug}: %s lands where it always has`, async (template, expected) => {
      const path = fill(template, bundle);
      const want = expected ? fill(expected, bundle) : path;
      const landed = await landing(path, "admin", slug, want);
      expect(landed.pathname).toBe(want);
    });

    // The provider sends the browser to the company's own return path (App.tsx ConnectionReturn).
    // It lands on Settings > Connections with the outcome shown, then the outcome is taken off the
    // address so a reload does not report it again.
    it(`admin at ${slug}: a connection return lands on Settings > Connections with its outcome`, async () => {
      const message = "The sign-in was cancelled or refused. Nothing changed.";
      // It has arrived once the outcome is off the address, not merely once the path matches.
      const landed = await landing(
        `/settings/connections/${bundle.company.id}?connect_error=cancelled`,
        "admin",
        slug,
        "/settings/connections",
        (search) => !search.has("connect_error"),
      );
      expect(landed.pathname).toBe("/settings/connections");
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(new URLSearchParams(landed.search).get("connect_error")).toBeNull();
    });

    it.each(employeeCases)(`employee at ${slug}: %s lands on %s`, async (template, expected) => {
      const want = fill(expected, bundle);
      const landed = await landing(fill(template, bundle), "employee", slug, want);
      expect(landed.pathname).toBe(want);
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
    ["/tasks", "admin", "kingdom", "/tasks"],
    ["/tasks", "employee", "kingdom", "/tasks"],
    ["/tasks", "admin", "klasik", "/"],
    ["/tasks", "employee", "klasik", "/"],
    ["/tasks/everyone", "admin", "kingdom", "/tasks/everyone"],
    ["/tasks/everyone", "employee", "kingdom", "/"],
    ["/tasks/everyone", "admin", "klasik", "/"],
    ["/tasks/kingdom-task-1", "employee", "kingdom", "/tasks/kingdom-task-1"],
    ["/tasks/kingdom-task-1", "admin", "klasik", "/"],
    ["/tasks/kingdom-task-1", "employee", "klasik", "/"],
  ];
  it.each(moduleRoutes)("module routes: %s as %s at %s lands on %s", async (path, persona, slug, expected) => {
    const landed = await landing(path, persona, slug, expected);
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
