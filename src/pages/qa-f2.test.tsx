// Follow-up QA round, group F2: dialogs, settings and connections. Each test pins a defect a
// reviewer reproduced on the merged QA branch: a job role delete whose failure showed up in another
// role's dialog, a pillar weight message that stayed under a valid number, a company goals notice
// that outlived the action it was about, and a "connected" line shown over a row that says it is not.
//
// The mocks are the usual in-memory data layer, with the calls these defects get wrong watched so a
// test can make one fail or hold it in flight.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", async () => {
  const mock = await import("../test/mocks/gsr.ts");
  return { ...mock, updatePillar: vi.fn(mock.updatePillar), updateCompanyGoal: vi.fn(mock.updateCompanyGoal), deleteCompanyGoal: vi.fn(mock.deleteCompanyGoal) };
});
vi.mock("../services/sops.ts", () => import("../test/mocks/sops.ts"));
vi.mock("../services/resources.ts", () => import("../test/mocks/resources.ts"));
vi.mock("../services/storage.ts", () => import("../test/mocks/storage.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));
vi.mock("../services/marketing.ts", () => import("../test/mocks/marketing.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", async () => {
  const mock = await import("../test/mocks/jobRoles.ts");
  return { ...mock, deleteJobRole: vi.fn(mock.deleteJobRole) };
});
vi.mock("../services/connections.ts", () => import("../test/mocks/connections.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/externalLinks.ts", () => import("../test/mocks/externalLinks.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { deleteCompanyGoal, updateCompanyGoal, updatePillar } from "../services/gsr.ts";
import { deleteJobRole } from "../services/jobRoles.ts";
import { makeHub } from "../test/fixtures.ts";
import GoalsPage from "./gsr/GoalsPage.tsx";
import SettingsPage from "./settings/SettingsPage.tsx";

const admin = makeHub("admin");

// A call that stays in flight until the test settles it, so a test can act while it runs.
function pending() {
  let settle: { resolve: () => void; reject: (err: Error) => void } = { resolve: () => undefined, reject: () => undefined };
  const promise = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  return { promise, ...settle };
}

const dropped = "The connection dropped. Check your signal and try again.";

// Settings > Roles with a second job role beside the seeded Production Manager. The mock keeps
// what a test adds for the rest of the file, so each test names its own.
async function renderRolesWith(user: ReturnType<typeof userEvent.setup>, name: string) {
  renderWithHub(<SettingsPage tab="roles" />, admin);
  await screen.findByLabelText("Name for Production Manager");
  await user.type(screen.getByLabelText("Add a job role"), name);
  await user.click(screen.getByRole("button", { name: "Add role" }));
  await screen.findByLabelText(`Name for ${name}`);
}

describe("deleting a job role", () => {
  it("waits for a delete already sent, opens no other role's dialog meanwhile, and keeps its failure in its own dialog", async () => {
    const user = userEvent.setup();
    await renderRolesWith(user, "Estimator");

    await user.click(screen.getByRole("button", { name: "Delete Production Manager" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent('Delete "Production Manager"?');
    const call = pending();
    vi.mocked(deleteJobRole).mockImplementationOnce(() => call.promise);
    await user.click(within(dialog).getByRole("button", { name: "Delete role" }));
    expect(within(dialog).getByRole("button", { name: "Working..." })).toBeDisabled();

    // Cancel, Escape and the backdrop wait for the answer.
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(dialog);
    expect(screen.getByRole("dialog")).toBe(dialog);

    // Focus put on another role's Delete under the scrim opens nothing while the delete runs.
    screen.getByRole("button", { name: "Delete Estimator" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Production Manager"?');

    call.reject(new Error("Failed to fetch"));
    expect(await within(dialog).findByText(dropped)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Production Manager"?');
    expect(screen.getAllByText(dropped)).toHaveLength(1);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete Estimator" }));
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Estimator"?');
    expect(screen.queryByText(dropped)).not.toBeInTheDocument();
  });

  it("opens another role's dialog without the last one's failure", async () => {
    const user = userEvent.setup();
    await renderRolesWith(user, "Site Lead");

    await user.click(screen.getByRole("button", { name: "Delete Production Manager" }));
    vi.mocked(deleteJobRole).mockRejectedValueOnce(new Error("Failed to fetch"));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete role" }));
    expect(await within(screen.getByRole("dialog")).findByText(dropped)).toBeInTheDocument();

    // The failed dialog is still up; a Delete reached under it shows that role's dialog clean.
    screen.getByRole("button", { name: "Delete Site Lead" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog")).toHaveTextContent('Delete "Site Lead"?');
    expect(screen.queryByText(dropped)).not.toBeInTheDocument();
  });
});

describe("pillar weights", () => {
  it("clears the weight message once the box is back in use, holding the stored weight", async () => {
    const user = userEvent.setup();
    renderWithHub(<SettingsPage tab="reviews" />, admin);
    const section = (await screen.findByDisplayValue("Deliverables")).closest("section") as HTMLElement;
    const weight = within(section).getByLabelText("Weight %");
    vi.mocked(updatePillar).mockClear();

    await user.clear(weight);
    await user.type(weight, "120");
    await user.tab();
    expect(within(section).getByRole("alert")).toHaveTextContent("Enter a weight from 0 to 100.");
    expect(weight).toHaveValue(50);

    // Back in the box, which holds the stored weight, and out again with nothing changed.
    await user.click(weight);
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
    await user.tab();
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();

    // Typing the stored weight back, which BlurInput never sends as a save.
    await user.clear(weight);
    await user.type(weight, "-5");
    await user.tab();
    expect(within(section).getByRole("alert")).toHaveTextContent("Enter a weight from 0 to 100.");
    await user.clear(weight);
    await user.type(weight, "50");
    await user.tab();
    expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
    expect(weight).toHaveValue(50);
    expect(updatePillar).not.toHaveBeenCalled();
  });
});

describe("company goals notice", () => {
  it("goes when a delete starts", async () => {
    const user = userEvent.setup();
    renderWithHub(<GoalsPage tab="company" />, admin);
    const row = (await screen.findByText("Closed sales")).closest("li") as HTMLElement;
    vi.mocked(updateCompanyGoal).mockRejectedValueOnce(new Error("The hit did not save."));
    await user.click(within(row).getByRole("button", { name: "Mark hit" }));
    expect(await screen.findByText("The hit did not save.")).toBeInTheDocument();

    const other = screen.getByText("Google reviews").closest("li") as HTMLElement;
    await user.click(within(other).getByRole("button", { name: "Delete goal" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete goal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deleteCompanyGoal).toHaveBeenCalled();
    expect(screen.queryByText("Google reviews")).not.toBeInTheDocument();
    expect(screen.queryByText("The hit did not save.")).not.toBeInTheDocument();
  });

  it("goes when the year changes", async () => {
    const user = userEvent.setup();
    renderWithHub(<GoalsPage tab="company" />, admin);
    const row = (await screen.findByText("Closed sales")).closest("li") as HTMLElement;
    vi.mocked(updateCompanyGoal).mockRejectedValueOnce(new Error("The hit did not save."));
    await user.click(within(row).getByRole("button", { name: "Mark hit" }));
    expect(await screen.findByText("The hit did not save.")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Year"), "2025");
    expect(await screen.findByRole("heading", { name: "Company goals 2025" })).toBeInTheDocument();
    expect(screen.queryByText("The hit did not save.")).not.toBeInTheDocument();
  });

  it("stays away when a toggle from the year before fails after the move", async () => {
    const user = userEvent.setup();
    renderWithHub(<GoalsPage tab="company" />, admin);
    const row = (await screen.findByText("Closed sales")).closest("li") as HTMLElement;
    let fail: (err: Error) => void = () => undefined;
    vi.mocked(updateCompanyGoal).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    await user.click(within(row).getByRole("button", { name: "Mark hit" }));

    await user.selectOptions(screen.getByLabelText("Year"), "2025");
    expect(await screen.findByRole("heading", { name: "Company goals 2025" })).toBeInTheDocument();
    fail(new Error("The hit did not save."));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("The hit did not save.")).not.toBeInTheDocument();
  });
});

describe("connection outcome", () => {
  it("says a provider is connected only when its row reads connected", async () => {
    renderWithHub(<SettingsPage tab="connections" />, admin, { path: "/?connected=quickbooks" });
    // QuickBooks is not connected for this company, whatever a hand-made link says.
    expect(await screen.findByRole("button", { name: "Connect QuickBooks Online" })).toBeInTheDocument();
    expect(screen.queryByText("QuickBooks Online is connected.")).not.toBeInTheDocument();
  });

  it("still says so when the row does read connected", async () => {
    renderWithHub(<SettingsPage tab="connections" />, admin, { path: "/?connected=gohighlevel" });
    expect(await screen.findByText("GoHighLevel is connected.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disconnect GoHighLevel" })).toBeInTheDocument();
  });
});
