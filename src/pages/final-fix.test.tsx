// The final review fix wave of the hub clarity plan: the read-first rows hand focus over the same
// way everywhere, Divisions reads first, every destructive control carries a word, Goals points to
// what left it, and the small consistency fixes. Rendered against the mocked data layer, as
// pages.test.tsx is.
import { screen } from "@testing-library/react";
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

import { KINGDOM, makeHub } from "../test/fixtures.ts";
import { renderWithHub } from "../test/renderWithHub.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import UsersPage from "./rococo/UsersPage.tsx";

const kingdomAdmin = makeHub("admin", KINGDOM.company);
const rococo = makeHub("rococo", null);
const job101 = { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" };

describe("read-first rows hand focus over", () => {
  it("moves focus into a milestone on open and back to its pencil on Escape", async () => {
    const user = userEvent.setup();
    renderWithHub(<ProjectPage />, kingdomAdmin, job101);
    await screen.findByRole("heading", { name: "Sample job 101" });
    const pencil = screen.getAllByRole("button", { name: /^Edit / })[0];
    const title = pencil.getAttribute("aria-label")!.replace(/^Edit /, "");
    await user.click(pencil);
    expect(screen.getByLabelText(`Title of ${title}`)).toHaveFocus();
    // The danger action stays worded beside Done.
    expect(screen.getByRole("button", { name: `Archive ${title}` })).toHaveTextContent("Archive");
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText(`Title of ${title}`)).toBeNull();
    expect(screen.getByRole("button", { name: `Edit ${title}` })).toHaveFocus();
  });

  it("moves focus to a person's company on open and back to the pencil on Done in Rococo People", async () => {
    const user = userEvent.setup();
    const marcus = KINGDOM.profiles[0];
    renderWithHub(<UsersPage />, rococo, { path: "/rococo/people", pattern: "/rococo/people" });
    await screen.findByText("Austin Rococo (you)");
    await user.click(screen.getByRole("button", { name: `Edit ${marcus.email}` }));
    expect(screen.getByRole("combobox", { name: `Company for ${marcus.email}` })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: `Edit ${marcus.email}` })).toHaveFocus();
  });
});
