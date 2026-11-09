// The Rococo admin path through the real gate and router: sign in with no company, land on
// the portfolio in the Rococo theme with no "My GSR", open a company from its card, and the
// hub switches to that company's dashboard and theme with a way back. It also proves every
// route lands in the same place for a company with modules on as for one with none, and that
// ModuleOnly keeps a module's pages to the companies that have it.
import { render, screen, waitFor } from "@testing-library/react";
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
    "/", "/gsr", "/reviews", "/goals", "/reviews/settings", "/reviews/company-goals",
    "/gsr/cycles/:cycle", "/reviews/cycles/:cycle2", "/gsr/reviews/:review", "/reviews/:review",
    "/my/gsr", "/my/reviews", "/my/goals", "/people", "/people/:person", "/sops", "/sops/new",
    "/sops/:sop", "/sops/:sop/edit", "/resources", "/financials", "/marketing", "/settings",
  ];
  const adminCases: Array<[string, string | null]> = [
    ...adminSelf.map((t): [string, null] => [t, null]),
    ["/gsr/settings", "/reviews/settings"],
    ["/gsr/company-goals", "/reviews/company-goals"],
    ["/my", "/my/gsr"],
    ["/rococo", "/"],
    ["/nope", "/"],
  ];
  const employeeCases: Array<[string, string]> = [
    ["/gsr", "/my/gsr"],
    ["/reviews", "/my/reviews"],
    ["/goals", "/my/goals"],
    ["/people", "/"],
    ["/settings", "/"],
    ["/sops", "/sops"],
  ];

  for (const [slug, bundle] of companies) {
    it.each(adminCases)(`admin at ${slug}: %s lands where it always has`, async (template, expected) => {
      const path = fill(template, bundle);
      const landed = await landing(path, "admin", slug);
      expect(landed.pathname).toBe(expected ?? path);
    });

    it(`admin at ${slug}: a connection callback keeps its query string`, async () => {
      const landed = await landing("/settings?connected=gohighlevel", "admin", slug);
      expect(landed.pathname).toBe("/settings");
      expect(new URLSearchParams(landed.search).get("connected")).toBe("gohighlevel");
    });

    it.each(employeeCases)(`employee at ${slug}: %s lands on %s`, async (path, expected) => {
      const landed = await landing(path, "employee", slug);
      expect(landed.pathname).toBe(expected);
    });
  }

  // Module routes: Tasks 4, 5 and 6 append [path, persona, slug, expected] rows here.
  const moduleRoutes: Array<[string, Persona, string, string]> = [
    ["/production", "admin", "kingdom", "/production"],
    ["/production", "admin", "klasik", "/"],
    ["/production/projects/kingdom-project-1", "employee", "kingdom", "/production/projects/kingdom-project-1"],
    ["/production/projects/kingdom-project-1", "employee", "klasik", "/"],
  ];
  it.each(moduleRoutes)("module routes: %s as %s at %s lands on %s", async (path, persona, slug, expected) => {
    const landed = await landing(path, persona, slug);
    expect(landed.pathname).toBe(expected);
  });
});
