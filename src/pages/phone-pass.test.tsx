// The phone pass (Task 19), where it can be seen in jsdom: the roster carries every column label for
// its stacked phone rows and keeps its links and actions for exactly the people who had them; the
// tables that turn into blocks on a phone keep explicit table roles, so the structure survives for a
// screen reader; and an SOP page names its Edit, Download and Remove controls. Layout itself is
// checked in a browser at 390px, not here.
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

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { ROLE_LABELS } from "../types/database.ts";
import PeoplePage from "./people/PeoplePage.tsx";
import ScorecardsPage from "./gsr/ScorecardsPage.tsx";
import ReviewPage from "./gsr/ReviewPage.tsx";
import SopPage from "./sops/SopPage.tsx";
import CyclePage from "./gsr/CyclePage.tsx";
import RolesPage from "./people/RolesPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const klasikAdmin = makeHub("admin");
const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;

const rowOf = async (name: string) => (await screen.findByText(name, { selector: "span" })).closest("tr") as HTMLElement;
const labelsOf = (row: HTMLElement) => [...row.querySelectorAll("td[data-label]")].map((td) => td.getAttribute("data-label"));

describe("the roster at phone width", () => {
  it("keeps table roles and labels each cell, with the person's links and actions on the row", async () => {
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    const row = await rowOf("Kai Bennett");
    const table = row.closest("table") as HTMLElement;
    expect(table).toHaveAttribute("role", "table");
    expect(row).toHaveAttribute("role", "row");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Person", "Division", "Reports to", "Role", "Status", "Actions"]);
    expect(labelsOf(row)).toEqual(["Division", "Reports to", "Role", "Status"]);
    for (const td of row.querySelectorAll("td")) expect(td).toHaveAttribute("role", "cell");
    expect(within(row).getByRole("link", { name: /Kai Bennett/ })).toHaveAttribute("href", `/people/${kai.id}`);
    expect(within(row).getByText(ROLE_LABELS[kai.role])).toBeInTheDocument();
    expect(within(row).getByText("Not invited")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Send the invitation to Kai Bennett" })).toBeInTheDocument();
  });

  it("gives a manager the same labelled rows and still no row actions", async () => {
    renderWithHub(<PeoplePage />, rbaManager, { path: "/people", pattern: "/people" });
    const row = await rowOf("Kai Bennett");
    expect(labelsOf(row)).toEqual(["Division", "Reports to", "Role", "Status"]);
    expect(within(row.closest("table") as HTMLElement).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Person", "Division", "Reports to", "Role", "Status"]);
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("the roster's row actions", () => {
  it("draws Send invite in the secondary style, leaving Add staff the page's one primary", async () => {
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    const row = await rowOf("Kai Bennett");
    const send = within(row).getByRole("button", { name: "Send the invitation to Kai Bennett" });
    expect(send.className).toContain("border-line");
    expect(send.className).not.toContain("bg-accent");
    expect(screen.getByRole("button", { name: "Add staff" }).className).toContain("bg-accent");
  });
});

describe("a role open on a phone", () => {
  it("names its list beside the back arrow", async () => {
    renderWithHub(<RolesPage />, rbaAdmin, { path: "/people/roles/rba-role-1", pattern: "/people/roles/:roleId?" });
    const back = await screen.findByRole("link", { name: "Back to Roles" });
    expect(back).toHaveTextContent("Roles");
    expect(back).toHaveAttribute("href", "/people/roles");
  });
});

describe("tables that stack on a phone keep their roles", () => {
  it("on Scorecards", async () => {
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    const link = await screen.findByRole("link", { name: "Noor Haddad" });
    const row = link.closest("tr") as HTMLElement;
    const table = row.closest("table") as HTMLElement;
    expect(table).toHaveAttribute("role", "table");
    for (const group of table.querySelectorAll("thead, tbody")) expect(group).toHaveAttribute("role", "rowgroup");
    for (const tr of table.querySelectorAll("tr")) expect(tr).toHaveAttribute("role", "row");
    for (const th of table.querySelectorAll("thead th")) expect(th).toHaveAttribute("role", "columnheader");
    expect(link.closest("th")).toHaveAttribute("role", "rowheader");
    for (const td of row.querySelectorAll("td")) expect(td).toHaveAttribute("role", "cell");
  });

  it("keeps a scorecard name's hit area inside its own row header", async () => {
    renderWithHub(<ScorecardsPage />, rbaAdmin);
    const link = await screen.findByRole("link", { name: "Noor Haddad" });
    // The link covers its row header and nothing past it, so two rows' links never overlap on a
    // touch tablet; the header itself is a real 44px box under a finger.
    expect(link.className).toContain("tap:after:inset-0");
    expect(link.className).not.toMatch(/after:-inset/);
    expect(link.closest("th")?.className).toContain("tap:min-h-11");
  });

  it("on a review's deliverable line items", async () => {
    const review = RBA.reviews.find((r) => r.status === "in_progress")!;
    renderWithHub(<ReviewPage />, rbaAdmin, { path: `/gsr/reviews/${review.id}`, pattern: "/gsr/reviews/:reviewId" });
    const remove = (await screen.findAllByRole("button", { name: "Remove deliverable" }))[0];
    const table = remove.closest("table") as HTMLElement;
    expect(table).toHaveAttribute("role", "table");
    for (const group of table.querySelectorAll("thead, tbody")) expect(group).toHaveAttribute("role", "rowgroup");
    for (const tr of table.querySelectorAll("tr")) expect(tr).toHaveAttribute("role", "row");
    for (const th of table.querySelectorAll("thead th")) expect(th).toHaveAttribute("role", "columnheader");
    for (const td of table.querySelectorAll("tbody td")) expect(td).toHaveAttribute("role", "cell");
  });
});

describe("a cycle's team table at phone width", () => {
  it("keeps table roles and labels each score and the status for its stacked rows", async () => {
    const scored = RBA.cycles[0];
    renderWithHub(<CyclePage />, rbaAdmin, { path: `/reviews/cycles/${scored.id}`, pattern: "/reviews/cycles/:cycleId" });
    const table = await screen.findByRole("table");
    expect(table).toHaveAttribute("role", "table");
    for (const group of table.querySelectorAll("thead, tbody")) expect(group).toHaveAttribute("role", "rowgroup");
    for (const tr of table.querySelectorAll("tr")) expect(tr).toHaveAttribute("role", "row");
    for (const th of table.querySelectorAll("thead th")) expect(th).toHaveAttribute("role", "columnheader");
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    const row = within(table).getByText("Jamie Fox").closest("tr") as HTMLElement;
    for (const td of row.querySelectorAll("td")) expect(td).toHaveAttribute("role", "cell");
    // Every column between the person and the actions names itself on the stacked row.
    expect([...row.querySelectorAll("td[data-label]")].map((td) => td.getAttribute("data-label"))).toEqual(headers.slice(1, -1));
  });
});

describe("an SOP page's own controls", () => {
  it("links its pencil to the edit page and names each file's Download and Remove", async () => {
    const user = userEvent.setup();
    const sop = KLASIK.sops[0];
    const file = KLASIK.attachments[0].file_name;
    renderWithHub(<SopPage />, klasikAdmin, { path: `/sops/${sop.id}`, pattern: "/sops/:sopId" });
    const edit = await screen.findByRole("link", { name: "Edit SOP" });
    expect(edit).toHaveAttribute("href", `/sops/${sop.id}/edit`);
    expect(edit).toHaveAttribute("title", "Edit SOP");
    expect(await screen.findByRole("button", { name: `Download ${file}` })).toHaveAttribute("title", `Download ${file}`);
    await user.click(screen.getByRole("button", { name: `Remove ${file}` }));
    const dialog = screen.getByRole("dialog", { name: `Remove "${file}"?` });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText(file)).toBeInTheDocument();
  });
});
