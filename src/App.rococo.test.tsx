// The Rococo admin path through the real gate and router: sign in with no company, land on
// the portfolio in the Rococo theme with no "My GSR", open a company from its card, and the
// hub switches to that company's dashboard and theme with a way back.
import { render, screen } from "@testing-library/react";
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

import App from "./App.tsx";

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
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("kingdom");
    expect(screen.getByText("Back to portfolio")).toBeInTheDocument();
    expect(screen.queryByText("My GSR")).not.toBeInTheDocument();
    expect(screen.getByText("Rococo view")).toBeInTheDocument();

    await user.click(screen.getByText("Back to portfolio"));
    expect(await screen.findByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("rococo");
  });
});
