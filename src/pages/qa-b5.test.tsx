// Regression tests for the QA batch on action steps, the connections round trip and the outcome
// it reports. Each one pins a behaviour a person relies on: two quick ticks both stick, the remove
// control is the shared icon button, the provider sends a Rococo admin back into the company they
// connected, and only the connection service's own words are shown as its outcome.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

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
// The review page reads the role scorecard, project assignments and project notes (0035).
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
// The mock, with startConnection watched so a test can read the return address it was given.
vi.mock("../services/connections.ts", async () => {
  const mock = await import("../test/mocks/connections.ts");
  return { ...mock, startConnection: vi.fn(mock.startConnection) };
});
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { HubContext } from "../context/HubContext.tsx";
import { listGoalPrivate, listGoals } from "../services/gsr.ts";
import { startConnection } from "../services/connections.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import App from "../App.tsx";
import MyGoalsPage from "./gsr/MyGoalsPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";
import DeliverablesPanel from "../components/people/DeliverablesPanel.tsx";
import type { DeliverableScore } from "../lib/gsr/deliverables.ts";

const admin = makeHub("admin");
const employee = makeHub("employee");
const employeeProfile = KLASIK.profiles[1];
const inProgressReview = KLASIK.reviews.find((r) => r.status === "in_progress")!;

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderSettings(path: string) {
  return render(
    <HubContext value={admin}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/settings/connections"
            element={
              <>
                <SettingsPage tab="connections" />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

afterEach(() => {
  window.history.pushState({}, "", "/");
});

describe("action steps", () => {
  it("keeps both of two quick ticks on a yearly goal's private steps", async () => {
    renderWithHub(<MyGoalsPage />, employee);
    expect(await screen.findByText("Get the OSHA 30 certification")).toBeInTheDocument();
    const card = screen.getByText("Get the OSHA 30 certification").closest("li") as HTMLElement;
    const register = await within(card).findByLabelText("Register for the course");
    expect(register).toBeChecked();

    // Two changes inside one round trip: untick the first step, tick the second.
    fireEvent.click(register);
    fireEvent.click(within(card).getByLabelText("Finish modules 1 to 15"));
    expect(within(card).getByLabelText("Register for the course")).not.toBeChecked();
    expect(within(card).getByLabelText("Finish modules 1 to 15")).toBeChecked();

    await waitFor(async () => {
      const [row] = (await listGoalPrivate(KLASIK.company.id, employeeProfile.id)).filter((r) => r.action_steps.length === 2);
      expect(row.action_steps.map((s) => s.done)).toEqual([false, true]);
    });
    expect(await within(card).findByText("1 of 2 done")).toBeInTheDocument();
    expect(within(card).getByLabelText("Register for the course")).not.toBeChecked();
    expect(within(card).getByLabelText("Finish modules 1 to 15")).toBeChecked();
  });

  it("keeps both of two quick ticks on a monthly goal", async () => {
    renderWithHub(<ReviewPage />, employee, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    const draft = await screen.findByLabelText("Draft the summary template");
    expect(draft).toBeChecked();
    expect(screen.getByLabelText("Ask two clients how it landed")).not.toBeChecked();

    fireEvent.click(draft);
    fireEvent.click(screen.getByLabelText("Ask two clients how it landed"));

    await waitFor(async () => {
      const goal = (await listGoals(KLASIK.company.id, employeeProfile.id)).find((g) => g.title === "Run the weekly client update without prompting")!;
      expect(goal.action_steps.map((s) => s.done)).toEqual([false, true, true]);
    });
    await waitFor(() => expect(screen.getByLabelText("Draft the summary template")).not.toBeChecked());
    expect(screen.getByLabelText("Ask two clients how it landed")).toBeChecked();
  });

  it("removes a step with the shared icon button", async () => {
    const user = userEvent.setup();
    renderWithHub(<ReviewPage />, employee, { path: `/gsr/reviews/${inProgressReview.id}`, pattern: "/gsr/reviews/:reviewId" });
    const remove = await screen.findByRole("button", { name: "Remove step: Send three Fridays in a row" });
    // IconButton labels its tooltip with the same words and gives the glyph a full hit target.
    expect(remove).toHaveAttribute("title", "Remove step: Send three Fridays in a row");
    expect(remove.className).toContain("h-8 w-8");
    await user.click(remove);
    await waitFor(() => expect(screen.queryByLabelText("Send three Fridays in a row")).not.toBeInTheDocument());
  });
});

describe("connection outcome on settings", () => {
  it("sends the provider back to a path that names the company", async () => {
    const user = userEvent.setup();
    vi.mocked(startConnection).mockRejectedValueOnce(new Error("Stopped before leaving the page."));
    renderSettings("/settings/connections");
    await user.click(await screen.findByRole("button", { name: "Connect QuickBooks Online" }));
    expect(vi.mocked(startConnection)).toHaveBeenCalledWith(KLASIK.company.id, "quickbooks", `${window.location.origin}/settings/connections/${KLASIK.company.id}`);
  });

  it("lets go of Opening... when Back restores the page from the browser's cache", async () => {
    const user = userEvent.setup();
    // The browser is on its way to the provider: startConnection's answer never comes back here.
    vi.mocked(startConnection).mockImplementationOnce(() => new Promise<string>(() => {}));
    renderSettings("/settings/connections");
    await user.click(await screen.findByRole("button", { name: "Connect QuickBooks Online" }));
    expect(await screen.findByText("Opening...")).toBeInTheDocument();
    // Back from the provider restores this page as it was left.
    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });
    await waitFor(() => expect(screen.queryByText("Opening...")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Connect QuickBooks Online" })).not.toBeDisabled();
  });

  it("shows a known outcome and clears it from the address", async () => {
    renderSettings(`/settings/connections?connect_error=${encodeURIComponent("QuickBooks did not say which company was connected.")}`);
    expect(await screen.findByText("QuickBooks did not say which company was connected.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/settings/connections"));
  });

  it("never shows words from the address that the connection service did not write", async () => {
    renderSettings(`/settings/connections?connect_error=${encodeURIComponent("Your session expired. Call IT at 555-0100.")}`);
    expect(await screen.findByText("The connection did not finish. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/555-0100/)).not.toBeInTheDocument();
  });

  it("drops the connected notice once the provider is disconnected", async () => {
    const user = userEvent.setup();
    renderSettings("/settings/connections?connected=gohighlevel");
    expect(await screen.findByText("GoHighLevel is connected.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/settings/connections"));
    await user.click(await screen.findByRole("button", { name: "Disconnect GoHighLevel" }));
    await waitFor(() => expect(screen.getAllByText("Not connected")).toHaveLength(2));
    expect(screen.queryByText("GoHighLevel is connected.")).not.toBeInTheDocument();
  });
});

describe("connection return trip", () => {
  it("puts a Rococo admin back in the company they connected, with the outcome", async () => {
    // The outcome names a provider whose row reads connected for this company: the panel says
    // "is connected" only over such a row.
    window.history.pushState({}, "", `/settings/connections/${RBA.company.id}?persona=rococo&connected=gohighlevel`);
    render(<App />);
    expect(await screen.findByText("GoHighLevel is connected.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Settings" })).getByRole("link", { name: "Connections" })).toHaveAttribute("aria-current", "page");
    expect(screen.getAllByText(RBA.company.name).length).toBeGreaterThan(0);
    expect(document.documentElement.dataset.theme).toBe(RBA.company.theme_key);
    await waitFor(() => expect(window.location.pathname).toBe("/settings/connections"));
    await waitFor(() => expect(window.location.search).not.toContain("connected"));
  });

  it("sends a Rococo admin to the portfolio when the company is not one of theirs to open", async () => {
    window.history.pushState({}, "", "/settings/connections/co-unknown?persona=rococo&connected=quickbooks");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Portfolio" })).toBeInTheDocument();
    expect(screen.queryByText("QuickBooks Online is connected.")).not.toBeInTheDocument();
  });

  it("lands a company admin on their own settings with the outcome", async () => {
    window.history.pushState({}, "", `/settings/connections/${KLASIK.company.id}?persona=admin&company=klasik&connect_error=${encodeURIComponent("The sign-in was cancelled or refused. Nothing changed.")}`);
    render(<App />);
    expect(await screen.findByText("The sign-in was cancelled or refused. Nothing changed.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/settings/connections"));
  });

  it("does not take a company admin into another company's return path", async () => {
    window.history.pushState({}, "", `/settings/connections/${RBA.company.id}?persona=admin&company=klasik&connected=quickbooks`);
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Home" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
    expect(screen.queryByText("QuickBooks Online is connected.")).not.toBeInTheDocument();
  });
});

describe("deliverables rollup", () => {
  it("withdraws the rollup while a different person's deliverables load", async () => {
    const reports: Array<DeliverableScore | null> = [];
    const [first, second] = [KLASIK.profiles[1], KLASIK.profiles[2]];
    function Harness() {
      const [employeeId, setEmployeeId] = useState(first.id);
      return (
        <>
          <button type="button" onClick={() => setEmployeeId(second.id)}>
            next person
          </button>
          <DeliverablesPanel companyId={KLASIK.company.id} employeeId={employeeId} year={2026} canEdit={false} onRollup={(score) => reports.push(score)} />
        </>
      );
    }
    render(<Harness />);
    await waitFor(() => expect(reports.some((r) => r !== null && r.target > 0)).toBe(true));
    const before = reports.length;

    fireEvent.click(screen.getByRole("button", { name: "next person" }));
    // The first person's figure must not stand in for the next person's while theirs loads: the
    // review reads this to score and freeze the module at sign-off.
    await waitFor(() => expect(reports.length).toBeGreaterThan(before + 1));
    expect(reports[before]).toBeNull();
    expect(reports[reports.length - 1]).toEqual(expect.objectContaining({ target: 0 }));
  });
});
