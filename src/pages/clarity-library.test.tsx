// Task 18 of the hub clarity plan: the read-first and quiet-row steps added to a project's
// milestones, Resources > Links, the Files & media cards, and the Rococo Companies and People tabs.
// Everyday controls (a milestone's status, the module and Financials switches, Rococo and Active)
// stay live, and every action keeps the name it had. Rendered against the mocked data layer, as
// pages.test.tsx is.
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
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/milestoneTemplates.ts", () => import("../test/mocks/milestoneTemplates.ts"));

import { KINGDOM, KLASIK, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import ResourcesPage from "./resources/ResourcesPage.tsx";
import CompaniesPage from "./rococo/CompaniesPage.tsx";
import UsersPage from "./rococo/UsersPage.tsx";

const kingdomAdmin = makeHub("admin", KINGDOM.company);
const klasikAdmin = makeHub("admin", KLASIK.company);
const rococo = makeHub("rococo", null);
const job101 = { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" };

describe("a project's milestones read first", () => {
  it("shows each item as text with its status live, and opens one item with Archive beside Done", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    // Nothing is a text box at rest, but every status is still a live select.
    expect(screen.queryByLabelText(/^Title of /)).toBeNull();
    expect(screen.queryByLabelText(/^Notes for /)).toBeNull();
    expect(screen.getAllByRole("combobox", { name: /^Status of / })).toHaveLength(4);
    expect(screen.queryByRole("button", { name: /^Archive (?!project)/ })).toBeNull();

    const pencil = screen.getByRole("button", { name: "Edit Framing complete" });
    expect(pencil).toHaveAttribute("title", "Edit Framing complete");
    await user.click(pencil);
    expect(screen.getByLabelText("Title of Framing complete")).toHaveValue("Framing complete");
    expect(screen.getByLabelText("Notes for Framing complete")).toBeInTheDocument();
    const archive = screen.getByRole("button", { name: "Archive Framing complete" });
    expect(archive).toHaveTextContent("Archive");

    // One item at a time.
    await user.click(screen.getByRole("button", { name: "Edit Final walkthrough" }));
    expect(screen.queryByLabelText("Title of Framing complete")).toBeNull();
    // The filter chips have a Done of their own, so Done is read inside the open item.
    const open = screen.getByLabelText("Title of Final walkthrough").closest("li") as HTMLElement;
    await user.click(within(open).getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText(/^Title of /)).toBeNull();
  });
});

describe("Resources > Links reads first", () => {
  it("shows each link as text with a pencil, and opens one with Remove beside Done", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage tab="links" />, kingdomAdmin, { path: "/resources/links", pattern: "/resources/links" });
    await screen.findByRole("heading", { name: "Links to outside tools" });
    expect(await screen.findByText("Sample sales board")).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Label for /)).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    // The single add form stays.
    expect(screen.getByRole("form", { name: "Add a link" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Sample sales board" }));
    expect(screen.getByLabelText("Label for Sample sales board")).toHaveValue("Sample sales board");
    expect(screen.getByRole("button", { name: "Remove Sample sales board" })).toHaveTextContent("Remove");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText(/^Label for /)).toBeNull();
  });
});

describe("Files & media cards", () => {
  it("carry one pencil, and Delete resource sits in the resource's own dialog", async () => {
    const user = userEvent.setup();
    renderWithHub(<ResourcesPage tab="files" />, klasikAdmin, { path: "/resources/files", pattern: "/resources/files" });
    const card = (await screen.findByText("Change order template")).closest("li") as HTMLElement;
    expect(within(card).queryByRole("button", { name: "Delete resource" })).toBeNull();
    await user.click(within(card).getByRole("button", { name: "Edit resource" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete resource" }));
    const confirm = screen.getByRole("dialog", { name: 'Delete "Change order template"?' });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Change order template")).toBeInTheDocument();
  });
});

describe("Rococo Companies reads first", () => {
  it("shows name, theme and logo as text, keeps the switches live, and puts Delete at the foot", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompaniesPage />, rococo, { path: "/rococo/companies", pattern: "/rococo/companies" });
    await screen.findByRole("heading", { name: "Companies" });
    expect(await screen.findByRole("button", { name: "Edit name for Klasik Construction" })).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Klasik Construction")).toBeNull();
    expect(screen.queryByLabelText("Logo URL")).toBeNull();
    const modules = screen.getByRole("group", { name: "Modules for Klasik Construction" });
    expect(within(modules).getAllByRole("checkbox").length).toBeGreaterThan(0);
    const display = screen.getByRole("group", { name: "Display settings for Klasik Construction" });
    expect(within(display).getByRole("checkbox", { name: "Manual Financials page" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Klasik Construction" })).toHaveTextContent("Delete");

    await user.click(screen.getByRole("button", { name: "Edit theme for Klasik Construction" }));
    expect(screen.getByLabelText("Theme")).toHaveDisplayValue("Klasik");
    // One value open at a time.
    await user.click(screen.getByRole("button", { name: "Edit name for Klasik Construction" }));
    expect(screen.queryByLabelText("Theme")).toBeNull();
    expect(screen.getByDisplayValue("Klasik Construction")).toBeInTheDocument();
  });
});

describe("Rococo People reads first", () => {
  it("shows company and role as text until the row's pencil opens them; Rococo and Active stay live", async () => {
    const user = userEvent.setup();
    const marcus = KINGDOM.profiles[0];
    renderWithHub(<UsersPage />, rococo, { path: "/rococo/people", pattern: "/rococo/people" });
    await screen.findByText("Austin Rococo (you)");
    expect(screen.queryByRole("combobox", { name: /^Role for / })).toBeNull();
    expect(screen.queryByRole("combobox", { name: /^Company for / })).toBeNull();
    expect(screen.getByRole("checkbox", { name: `Active: ${marcus.email}` })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: `Rococo admin: ${marcus.email}` })).toBeEnabled();

    const pencil = screen.getByRole("button", { name: `Edit ${marcus.email}` });
    expect(pencil).toHaveAttribute("title", `Edit ${marcus.email}`);
    await user.click(pencil);
    expect(screen.getByRole("combobox", { name: `Role for ${marcus.email}` })).toHaveDisplayValue("Owner");
    expect(screen.getByRole("combobox", { name: `Company for ${marcus.email}` })).toHaveDisplayValue("Kingdom Custom Construction");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("combobox", { name: /^Role for / })).toBeNull();
  });
});
