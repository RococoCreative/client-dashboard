// Home read by who is looking. An employee's first card is their own GSR, with the one primary
// button on the page; a manager has their team right under it, one row per direct report with the
// month's GSR status and, where the company runs tasks, their open and overdue tasks; an admin
// opens on what needs attention and the open cycles before the tiles. An empty links panel is a
// single line at the very end; an employee or manager sees their own open tasks right after the GSR
// (and the team). Each test reads the in-memory data layer the way the page does.
import { screen, waitFor, within } from "@testing-library/react";
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
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { addBackToCycle, ensureReview, omitFromCycle, updateReview } from "../services/gsr.ts";
import { updateProfile } from "../services/profiles.ts";
import { createTask, deleteTask, listTasks } from "../services/tasks.ts";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import DashboardPage from "./DashboardPage.tsx";
import TeamBlock from "../components/home/TeamBlock.tsx";

const harper = makeHub("manager", RBA.company);
const rowan = RBA.profiles.find((p) => p.full_name === "Rowan Ellis")!;
const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;
// RBA's September GSR, the month in play on the suite's clock (September 15).
const september = RBA.cycles.find((c) => c.cadence === "monthly" && c.status === "open")!;

const sectionOf = (heading: HTMLElement) => heading.closest("section") as HTMLElement;
const sections = (container: HTMLElement) => Array.from(container.querySelectorAll("section"));
const before = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("a manager's Home", () => {
  it("puts their team under their GSR, one row per direct report, each with the month's GSR status", async () => {
    const { container } = renderWithHub(<DashboardPage />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    const rows = await within(team).findAllByRole("listitem");
    // Rowan reports to Harper; Kai reports to Rowan, so Kai is not a direct report.
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole("link", { name: "Rowan Ellis" })).toHaveAttribute("href", `/people/${rowan.id}`);
    expect(within(rows[0]).getByText("Crew Lead", { exact: false })).toBeInTheDocument();
    expect(within(team).queryByText("Kai Bennett")).not.toBeInTheDocument();
    // No review row for Rowan in September yet.
    expect(within(rows[0]).getByText("Not started")).toBeInTheDocument();
    // The GSR card comes first, the team right after it.
    const gsr = sectionOf(screen.getByRole("heading", { name: september.name }));
    expect(sections(container)[0]).toBe(gsr);
    expect(sections(container)[1]).toBe(team);
  });

  it("reads In progress and Complete from the review in the GSR cycle in play", async () => {
    const review = await ensureReview(september.id, RBA.company.id, rowan.id);
    // The mock has no delete for a review row, so it goes back to the state ensureReview made it in.
    onTestFinished(async () => {
      await updateReview(review.id, { status: "not_started", completed_at: null });
    });
    await updateReview(review.id, { status: "in_progress" });
    const first = renderWithHub(<DashboardPage />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    expect(await within(team).findByText("In progress")).toBeInTheDocument();
    first.unmount();

    await updateReview(review.id, { status: "complete", completed_at: new Date().toISOString() });
    renderWithHub(<DashboardPage />, harper);
    const again = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    expect(await within(again).findByText("Complete")).toBeInTheDocument();
  });

  it("reads Not in this cycle for a report the GSR month leaves out, never Not started", async () => {
    await omitFromCycle({ cycle_id: september.id, employee_id: rowan.id, company_id: RBA.company.id, reason: null });
    onTestFinished(async () => {
      await addBackToCycle(september.id, rowan.id);
    });
    renderWithHub(<DashboardPage />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    const row = (await within(team).findByRole("link", { name: "Rowan Ellis" })).closest("li") as HTMLElement;
    expect(await within(row).findByText("Not in this cycle")).toBeInTheDocument();
    expect(within(row).queryByText("Not started")).not.toBeInTheDocument();
  });

  it("lists their own open tasks after their team, as one quiet line when they have none", async () => {
    const { container } = renderWithHub(<DashboardPage />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    const line = await screen.findByText(/You have no open tasks\./);
    expect(line.closest("section")).toBeNull();
    expect(within(line).getByRole("link", { name: "All tasks" })).toHaveAttribute("href", "/tasks");
    expect(before(team, line)).toBe(true);
    expect(before(line, sectionOf(screen.getByRole("heading", { name: /open goal/ })))).toBe(true);
    expect(container.querySelectorAll("button.bg-accent")).toHaveLength(1);
  });

  it("counts each report's open and overdue tasks when the company runs tasks", async () => {
    const overdue = await createTask({ company_id: RBA.company.id, title: "Order the trim", assignee_id: rowan.id, due_date: "2026-09-01" });
    const later = await createTask({ company_id: RBA.company.id, title: "Book the inspection", assignee_id: rowan.id, due_date: "2026-10-01" });
    onTestFinished(async () => {
      await deleteTask(overdue.id);
      await deleteTask(later.id);
    });
    renderWithHub(<DashboardPage />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    expect(await within(team).findByText("2 open")).toBeInTheDocument();
    const flag = within(team).getByText("1 overdue");
    // The same danger mark the Tasks pages put on an overdue task.
    expect(flag.className).toContain("text-danger");
  });

  it("shows no task counts when the company does not run tasks", async () => {
    renderWithHub(<DashboardPage />, { ...harper, company: { ...RBA.company, modules: [] } });
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    await within(team).findByText(/^(Not started|In progress|Complete)$/);
    expect(within(team).queryByText(/open$/)).not.toBeInTheDocument();
    expect(within(team).queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("keeps a report who has not signed in yet, marked as such", async () => {
    await updateProfile(kai.id, { reports_to: harper.profile.id });
    onTestFinished(async () => {
      await updateProfile(kai.id, { reports_to: rowan.id });
    });
    renderWithHub(<DashboardPage />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    const kaiRow = (await within(team).findByRole("link", { name: "Kai Bennett" })).closest("li") as HTMLElement;
    expect(within(kaiRow).getByText("Not signed in yet")).toBeInTheDocument();
    expect(within(kaiRow).getByText("Not started")).toBeInTheDocument();
  });

  it("says so in one quiet line when nobody reports to them", async () => {
    renderWithHub(<DashboardPage />, makeHub("manager", KINGDOM.company));
    expect(await screen.findByText("No one reports to you yet.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your team" })).not.toBeInTheDocument();
  });
});

describe("an employee's Home", () => {
  it("opens on their GSR, with the page's one primary button", async () => {
    const { container } = renderWithHub(<DashboardPage />, makeHub("employee"));
    const gsr = sectionOf(await screen.findByRole("heading", { name: KLASIK.cycles[0].name }));
    await waitFor(() => expect(sections(container)[0]).toBe(gsr));
    const open = within(gsr).getByRole("link", { name: /Open my GSR/ });
    expect(open).toHaveAttribute("href", "/my/gsr");
    expect(within(open).getByRole("button").className).toContain("bg-accent");
    // One primary action on the page.
    await screen.findByText("Closed sales");
    expect(container.querySelectorAll("button.bg-accent")).toHaveLength(1);
    // Their goals come after it, and no team block for someone who leads nobody.
    expect(before(gsr, sectionOf(screen.getByRole("heading", { name: /open goal/ })))).toBe(true);
    expect(screen.queryByRole("heading", { name: "Your team" })).not.toBeInTheDocument();
    expect(screen.queryByText("No one reports to you yet.")).not.toBeInTheDocument();
  });

  it("offers Start my GSR when theirs has not been started", async () => {
    // Harper has no review row in September yet.
    renderWithHub(<DashboardPage />, harper);
    const gsr = sectionOf(await screen.findByRole("heading", { name: september.name }));
    const start = await within(gsr).findByRole("link", { name: "Start my GSR" });
    expect(start).toHaveAttribute("href", "/my/gsr");
    expect(within(start).getByRole("button").className).toContain("bg-accent");
  });
});

describe("an employee's own tasks on Home", () => {
  const jamie = RBA.profiles[1];

  it("come right after the GSR card and before goals, with no add control", async () => {
    const { container } = renderWithHub(<DashboardPage />, makeHub("employee", RBA.company));
    const gsr = sectionOf(await screen.findByRole("heading", { name: september.name }));
    const tasks = sectionOf(await screen.findByRole("heading", { name: "Your tasks" }));
    expect(await within(tasks).findByText("Close out the September punch list")).toBeInTheDocument();
    expect(sections(container)[0]).toBe(gsr);
    expect(sections(container)[1]).toBe(tasks);
    expect(before(tasks, sectionOf(screen.getByRole("heading", { name: /open goal/ })))).toBe(true);
    expect(within(tasks).getByRole("link", { name: "All tasks" })).toHaveAttribute("href", "/tasks");
    expect(within(tasks).queryByRole("button", { name: /Add task/ })).not.toBeInTheDocument();
    // Only their own open tasks, the next five at most: the same read Tasks makes for "mine".
    const own = await listTasks(RBA.company.id, { assigneeId: jamie.id, status: "open" });
    const everyone = await listTasks(RBA.company.id, { status: "open" });
    expect(everyone.length).toBeGreaterThan(own.length);
    const list = within(tasks).getByRole("list", { name: "Your open tasks" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(Math.min(own.length, 5));
    // The GSR button is still the page's one primary action.
    expect(container.querySelectorAll("button.bg-accent")).toHaveLength(1);
  });

  it("are not there without the tasks module", async () => {
    renderWithHub(<DashboardPage />, { ...makeHub("employee", RBA.company), company: { ...RBA.company, modules: [] } });
    await screen.findByRole("heading", { name: september.name });
    await screen.findByRole("heading", { name: /open goal/ });
    expect(screen.queryByRole("heading", { name: "Your tasks" })).not.toBeInTheDocument();
    expect(screen.queryByText(/You have no open tasks/)).not.toBeInTheDocument();
  });
});

describe("an admin's Home", () => {
  it("opens on what needs attention, then the open cycles, then the tiles", async () => {
    const { container } = renderWithHub(<DashboardPage />, makeHub("admin", KINGDOM.company));
    const attention = sectionOf(await screen.findByRole("heading", { name: "Needs attention" }));
    await waitFor(() => expect(sections(container)[0]).toBe(attention));
    const cycle = sectionOf(screen.getByRole("heading", { name: KINGDOM.cycles[0].name }));
    const tiles = screen.getByText("Team score");
    expect(before(attention, cycle)).toBe(true);
    expect(before(cycle, tiles)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Your team" })).not.toBeInTheDocument();
  });

  it("opens on the open cycles when the company has no attention card", async () => {
    const { container } = renderWithHub(<DashboardPage />, makeHub("admin"));
    const cycle = sectionOf(await screen.findByRole("heading", { name: KLASIK.cycles[0].name }));
    expect(sections(container)[0]).toBe(cycle);
    expect(before(cycle, screen.getByText("Team score"))).toBe(true);
  });
});

describe("an empty links panel", () => {
  const withLinks = { ...KLASIK.company, modules: ["external_links"] };

  it("is one line of text after every card, for an admin", async () => {
    const { container } = renderWithHub(<DashboardPage />, { ...makeHub("admin"), company: withLinks });
    const line = await screen.findByText(/No links yet\. Add the programs the team works in/);
    expect(line.closest("section")).toBeNull();
    expect(within(line).getByRole("link", { name: "Resources, Links" })).toHaveAttribute("href", "/resources/links");
    const all = sections(container);
    expect(before(all[all.length - 1], line)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Where the work lives" })).not.toBeInTheDocument();
  });

  it("is one line of text after every card, for an employee", async () => {
    const { container } = renderWithHub(<DashboardPage />, { ...makeHub("employee"), company: withLinks });
    const line = await screen.findByText(/Your admins add the programs the team works in/);
    expect(line.closest("section")).toBeNull();
    const all = sections(container);
    expect(before(all[all.length - 1], line)).toBe(true);
    expect(screen.queryByRole("heading", { name: "Where the work lives" })).not.toBeInTheDocument();
  });
});

describe("the team block with no GSR month in play", () => {
  it("says so once and shows a dash on each row", async () => {
    const people = RBA.profiles.filter((p) => p.company_id === RBA.company.id);
    renderWithHub(<TeamBlock companyId={RBA.company.id} viewer={harper.profile} people={people} cycles={[]} omissions={[]} />, harper);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    expect(within(team).getByText(/No GSR month open, so no status yet/)).toBeInTheDocument();
    const row = (await within(team).findByRole("link", { name: "Rowan Ellis" })).closest("li") as HTMLElement;
    expect(within(row).getByText("-")).toBeInTheDocument();
    expect(within(row).queryByText(/^(Not started|In progress|Complete)$/)).not.toBeInTheDocument();
  });
});

describe("an admin's Home cycle card on a large roster", () => {
  const q3 = RBA.cycles.find((c) => c.cadence === "quarterly" && c.status === "open")!;
  const admin = makeHub("admin", RBA.company);

  it("counts everyone, lists at most five (in progress first) and links to every person", async () => {
    const active = RBA.profiles.filter((p) => p.is_active);
    expect(active.length).toBeGreaterThan(6);
    // The last person on the roster is mid-review, so they come ahead of everyone not started.
    const last = active[active.length - 1];
    const review = await ensureReview(q3.id, RBA.company.id, last.id);
    onTestFinished(async () => {
      await updateReview(review.id, { status: "not_started", completed_at: null });
    });
    await updateReview(review.id, { status: "in_progress" });

    renderWithHub(<DashboardPage />, admin);
    const card = sectionOf(await screen.findByRole("heading", { name: q3.name }));
    const counts = within(card).getByText(/Complete \d+/).parentElement!;
    const [complete, inProgress, notStarted] = ["Complete", "In progress", "Not started"].map((label) => Number(new RegExp(`${label} (\\d+)`).exec(counts.textContent ?? "")![1]));
    expect(complete + inProgress + notStarted).toBe(active.length);
    expect(inProgress).toBeGreaterThanOrEqual(1);
    const rows = within(card).getAllByRole("listitem");
    expect(rows.length).toBeLessThanOrEqual(5);
    expect(within(card).getByText(last.full_name!)).toBeInTheDocument();
    expect(within(rows[0]).getByText("In progress")).toBeInTheDocument();
    expect(within(card).queryByText("Complete", { selector: "span.rounded-full" })).not.toBeInTheDocument();
    const all = within(card).getByRole("link", { name: `All ${active.length} people` });
    expect(all).toHaveAttribute("href", within(card).getByRole("link", { name: "Open cycle" }).getAttribute("href"));
  });

  it("shows every row and no link when the roster is six or fewer", async () => {
    renderWithHub(<DashboardPage />, makeHub("admin", KLASIK.company));
    const card = sectionOf(await screen.findByRole("heading", { name: KLASIK.cycles[0].name }));
    const active = KLASIK.profiles.filter((p) => p.is_active);
    expect(active.length).toBeLessThanOrEqual(6);
    expect(within(card).getAllByRole("listitem")).toHaveLength(active.length);
    expect(within(card).queryByRole("link", { name: /^All \d+ people$/ })).not.toBeInTheDocument();
  });
});

describe("Home Goals card with no goals", () => {
  it("is one quiet line under the heading, beside the Manage goals button", async () => {
    // A person with no goals of their own.
    const quiet = RBA.profiles.find((p) => p.role === "employee" && !RBA.goals.some((g) => g.employee_id === p.id))!;
    const hub = { ...makeHub("employee", RBA.company), profile: quiet };
    const { container } = renderWithHub(<DashboardPage />, hub);
    const card = sectionOf(await screen.findByRole("heading", { name: "0 open goals" }));
    expect(within(card).getByText("No goals yet. Add one for this year or next, or a BHAG.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Manage goals" })).toBeInTheDocument();
    expect(within(card).queryByText("Set your first goal")).not.toBeInTheDocument();
    expect(card.querySelector(".border-dashed")).toBeNull();
    expect(container).toBeTruthy();
  });
});
