// Home in a company whose GSRs are on demand: an employee's own GSR card (the current one with its
// progress and Open my GSR, or Start a GSR, and whether one is due), a manager's team with each
// report's last GSR and due state, and an admin's GSRs this week card in place of the GSR month
// card and tile, agreeing with the GSRs log by construction. A company on periods sees the Home it
// always has, with none of the on-demand reads made. Each test reads the in-memory data layer the
// way the page does, acting as the person the hub was rendered for.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
// The on-demand reads wrapped in spies, so a test can see they were never made, or fail one once.
vi.mock("../services/gsrOnDemand.ts", async () => {
  const mock = await import("../test/mocks/gsrOnDemand.ts");
  return {
    ...mock,
    listGsrsForLog: vi.fn(mock.listGsrsForLog),
    listPersonGsrs: vi.fn(mock.listPersonGsrs),
    listLastGsrDates: vi.fn(mock.listLastGsrDates),
  };
});
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
import { setActingPerson } from "../test/actingPerson.ts";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { createGoal, createPillar, deleteGoal, deletePillar, updateCycle } from "../services/gsr.ts";
import { listGsrsForLog, listLastGsrDates, listPersonGsrs } from "../services/gsrOnDemand.ts";
import { listCompanyProfiles, updateProfile } from "../services/profiles.ts";
import { listGsrsForLog as readLog, seedMockGsr, setMockGsrMode } from "../test/mocks/gsrOnDemand.ts";
import type { Gsr, GsrCadence, Profile } from "../types/database.ts";
import DashboardPage from "./DashboardPage.tsx";
import GsrLogPage from "./gsr/GsrLogPage.tsx";

const onDemand = { ...RBA.company, gsr_mode: "on_demand" as const };
const admin = makeHub("admin", onDemand);
const manager = makeHub("manager", onDemand);
const employee = makeHub("employee", onDemand);
const alex = admin.profile;
const harper = manager.profile;
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const jamie = byName("Jamie Fox");
const noor = byName("Noor Haddad");
// Rowan reports to Harper, and Kai, who has not signed in yet, to Rowan.
const rowan = byName("Rowan Ellis");
const kai = byName("Kai Bennett");
// RBA's open quarter, the scored review in play on the suite's clock (September 15), and its
// September GSR month, which a company on demand has no use for.
const q3 = RBA.cycles.find((c) => c.cadence === "quarterly" && c.status === "open")!;
const september = RBA.cycles.find((c) => c.cadence === "monthly" && c.status === "open")!;
// The words a GSR on demand never carries on Home.
const PERIOD_WORDS = /month|review|period|signed off|locked in/i;

const sectionOf = (heading: HTMLElement) => heading.closest("section") as HTMLElement;
const sections = (container: HTMLElement) => Array.from(container.querySelectorAll("section"));
// Wording that belongs to a company on periods' months, never to a GSR on demand.
const LOCKED_WORDS = /locked in|month is locked/i;
const gsrCard = async () => sectionOf(await screen.findByRole("heading", { name: "Your GSR" }));
const weekCard = async () => sectionOf(await screen.findByRole("heading", { name: "GSRs this week" }));

function seed(employeeId: string, row: Partial<Gsr> = {}): Gsr {
  return seedMockGsr({ company_id: RBA.company.id, employee_id: employeeId, started_on: "2026-09-01", status: "in_progress", ...row });
}
const done = (employeeId: string, doneOn: string, score: number | null) =>
  seed(employeeId, { started_on: doneOn, done_on: doneOn, status: "complete", gsr_score: score });

// The scene the log's own tests read: three done in September, two of them this week, one open.
function scene() {
  done(jamie.id, "2026-09-14", 80);
  done(noor.id, "2026-09-15", 90);
  done(rowan.id, "2026-09-10", 50);
  seed(kai.id, { started_on: "2026-09-12" });
}

// Changes a person for one test and puts them back after, acting as the admin.
async function change(person: Profile, patch: Partial<Pick<Profile, "gsr_cadence" | "reports_to">>) {
  const was = (await listCompanyProfiles(RBA.company.id)).find((p) => p.id === person.id)!;
  onTestFinished(async () => {
    setActingPerson(alex);
    await updateProfile(person.id, { gsr_cadence: was.gsr_cadence, reports_to: was.reports_to });
  });
  setActingPerson(alex);
  await updateProfile(person.id, patch);
}
const rhythm = (person: Profile, cadence: GsrCadence) => change(person, { gsr_cadence: cadence });

// The company scores its GSRs: two mandatory goals a GSR.
async function scoredGsrs() {
  const pillar = await createPillar({ company_id: RBA.company.id, name: "GSRs", weight: 20, scoring_type: "gsr_goals", required_goals: 2, sort_order: 9 });
  onTestFinished(async () => {
    await deletePillar(pillar.id);
  });
}

beforeEach(() => {
  setMockGsrMode(RBA.company.id, "on_demand");
  vi.mocked(listGsrsForLog).mockClear();
  vi.mocked(listPersonGsrs).mockClear();
  vi.mocked(listLastGsrDates).mockClear();
});

describe("an employee's Home on demand", () => {
  it("shows the current GSR with its progress and Open my GSR", async () => {
    const user = userEvent.setup();
    await scoredGsrs();
    const gsr = seed(jamie.id, { started_on: "2026-09-10" });
    for (const [i, progress] of [100, 50].entries()) {
      const goal = await createGoal({ company_id: RBA.company.id, employee_id: jamie.id, title: `Goal ${i + 1}`, kind: "role", scope: "cycle", cycle_id: null, review_id: gsr.id, progress });
      onTestFinished(async () => {
        await deleteGoal(goal.id);
      });
    }
    const { container } = renderWithHub(<DashboardPage />, employee);
    const card = await gsrCard();
    await waitFor(() => expect(sections(container)[0]).toBe(card));
    expect(within(card).getByText(/Started Sep 10, 2026/)).toBeInTheDocument();
    expect(within(card).getByText("In progress")).toBeInTheDocument();
    expect(within(card).getByText(/150% of 200%/)).toBeInTheDocument();
    // Not due yet: the last one began on the 10th, on a monthly rhythm.
    expect(within(card).queryByText("A GSR is due.")).not.toBeInTheDocument();
    // Nothing on the card marks a person's own GSR done.
    expect(within(card).queryByRole("button", { name: /done/i })).not.toBeInTheDocument();
    const open = within(card).getByRole("button", { name: /Open my GSR/ });
    expect(open.className).toContain("bg-accent");
    await screen.findByRole("heading", { name: /open goal/ });
    expect(container.querySelectorAll("button.bg-accent")).toHaveLength(1);
    await user.click(open);
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
  });

  it("offers Start a GSR and says one is due", async () => {
    const user = userEvent.setup();
    // Never had one, on a monthly rhythm: due today.
    renderWithHub(<DashboardPage />, employee);
    const card = await gsrCard();
    expect(await within(card).findByText("A GSR is due.")).toBeInTheDocument();
    const start = within(card).getByRole("button", { name: /Start a GSR/ });
    expect(start.className).toContain("bg-accent");
    await user.click(start);
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, jamie.id)).map((g) => g.started_on)).toEqual(["2026-09-15"]);
  });

  it("says a GSR is due while one is in progress, when the rhythm says so", async () => {
    seed(jamie.id, { started_on: "2026-08-01" });
    renderWithHub(<DashboardPage />, employee);
    const card = await gsrCard();
    expect(await within(card).findByText("A GSR is due.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: /Open my GSR/ })).toBeInTheDocument();
  });

  it("tells a company on demand nothing about months being locked in", async () => {
    await scoredGsrs();
    done(jamie.id, "2026-09-02", 80);
    renderWithHub(<DashboardPage />, employee);
    const card = await gsrCard();
    const impact = sectionOf(screen.getByText("Impact score"));
    // The quarter line reads the GSRs done inside the open scored review's period.
    expect(await within(impact).findByText(`GSRs, ${q3.name}`)).toBeInTheDocument();
    expect(within(impact).getByText("80%")).toBeInTheDocument();
    expect(screen.queryByText(/Monthly GSRs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No month open/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: september.name })).not.toBeInTheDocument();
    expect(within(card).queryByText(PERIOD_WORDS)).not.toBeInTheDocument();
  });

  it("says so when the GSR does not load", async () => {
    vi.mocked(listPersonGsrs).mockRejectedValueOnce(new Error("The connection dropped."));
    renderWithHub(<DashboardPage />, employee);
    const card = await gsrCard();
    expect(await within(card).findByText(/The connection dropped\./)).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Start a GSR/ })).not.toBeInTheDocument();
  });
});

describe("a manager's Home on demand", () => {
  it("lists each report's last GSR and whether one is in progress, due or overdue", async () => {
    // Harper leads Rowan (rhythm None, one in progress), Kai (weekly, last begun the 1st: overdue,
    // and not signed in yet) and Noor (weekly, last begun the 8th: due today).
    await change(kai, { reports_to: harper.id, gsr_cadence: "weekly" });
    await change(noor, { reports_to: harper.id, gsr_cadence: "weekly" });
    await rhythm(rowan, "none");
    done(rowan.id, "2026-09-02", 70);
    const open = seed(rowan.id, { started_on: "2026-09-14" });
    done(kai.id, "2026-09-01", 60);
    done(noor.id, "2026-09-08", 75);

    const { container } = renderWithHub(<DashboardPage />, manager);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    // The GSR card first, the team right after it.
    await waitFor(() => expect(sections(container)[1]).toBe(team));
    expect(sections(container)[0]).toBe(await gsrCard());
    const row = async (person: Profile) => (await within(team).findByRole("link", { name: person.full_name! })).closest("li") as HTMLElement;

    const rowanRow = await row(rowan);
    expect(within(rowanRow).getByRole("link", { name: "Rowan Ellis" })).toHaveAttribute("href", `/people/${rowan.id}/gsr`);
    expect(await within(rowanRow).findByText(/Last GSR Sep 14, 2026/)).toBeInTheDocument();
    expect(within(rowanRow).getByText("In progress")).toBeInTheDocument();
    expect(within(rowanRow).queryByText(/Due today|Overdue/)).not.toBeInTheDocument();
    expect(within(rowanRow).getByRole("link", { name: /Open/ })).toHaveAttribute("href", `/gsr/reviews/${open.id}`);

    const kaiRow = await row(kai);
    expect(within(kaiRow).getByText(/Last GSR Sep 1, 2026/)).toBeInTheDocument();
    expect(within(kaiRow).getByText("Overdue")).toBeInTheDocument();
    expect(within(kaiRow).getByText("Not signed in yet")).toBeInTheDocument();
    expect(within(kaiRow).getByRole("button", { name: /Start/ })).toBeInTheDocument();

    const noorRow = await row(noor);
    expect(within(noorRow).getByText("Due today")).toBeInTheDocument();
    expect(within(noorRow).queryByText("In progress")).not.toBeInTheDocument();

    // Each row is the target of its name on a phone, and its control sits above that.
    expect(rowanRow.className.split(/\s+/)).toContain("relative");
    expect(within(rowanRow).getByRole("link", { name: "Rowan Ellis" }).className).toContain("tap:after:absolute tap:after:inset-0");
    // Only the control sits above the stretched name: the line that holds it does not, so a tap
    // anywhere else on that line still opens the person.
    const openLink = within(rowanRow).getByRole("link", { name: /Open/ });
    expect((openLink.parentElement as HTMLElement).className.split(/\s+/)).not.toContain("relative");
    expect(openLink.className.split(/\s+/)).toContain("relative");
    const startButton = within(kaiRow).getByRole("button", { name: /Start/ });
    expect((startButton.parentElement as HTMLElement).className.split(/\s+/)).not.toContain("relative");
    expect(startButton.className.split(/\s+/)).toContain("relative");
    expect(within(team).queryByText(PERIOD_WORDS)).not.toBeInTheDocument();
  });

  it("starts a report's GSR from their row", async () => {
    const user = userEvent.setup();
    renderWithHub(<DashboardPage />, manager);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    const rowanRow = (await within(team).findByRole("link", { name: "Rowan Ellis" })).closest("li") as HTMLElement;
    expect(within(rowanRow).getByText(/No GSR yet/)).toBeInTheDocument();
    await user.click(await within(rowanRow).findByRole("button", { name: /Start/ }));
    expect(await screen.findByText("elsewhere")).toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, rowan.id)).map((g) => g.started_on)).toEqual(["2026-09-15"]);
  });
});

describe("an admin's Home on demand", () => {
  it("gives an admin one GSRs this week card with done, average, in progress and who is overdue", async () => {
    scene();
    // Daily, with the last one begun on the 10th: overdue.
    await rhythm(rowan, "daily");
    renderWithHub(<DashboardPage />, admin);
    const card = await weekCard();
    expect(screen.getAllByRole("heading", { name: "GSRs this week" })).toHaveLength(1);
    expect(await within(card).findByText("2 GSRs done · Average 85 · 1 in progress")).toBeInTheDocument();
    expect(within(card).getByText("Sep 14 to Sep 20, 2026")).toBeInTheDocument();
    const overdue = within(card).getByRole("list", { name: "Overdue" });
    expect(within(overdue).getByRole("link", { name: "Rowan Ellis" })).toHaveAttribute("href", `/people/${rowan.id}/gsr`);
    expect(within(card).getByRole("link", { name: /All GSRs/ })).toHaveAttribute("href", "/gsr");
    // The GSR month card and tile give way; the scored review card and tile stay.
    expect(screen.queryByText("GSRs complete")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: september.name })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: q3.name })).toBeInTheDocument();
    expect(screen.getByText("Reviews complete")).toBeInTheDocument();
    expect(within(card).queryByText(PERIOD_WORDS)).not.toBeInTheDocument();
  });

  it("says nobody is overdue in one plain line", async () => {
    renderWithHub(<DashboardPage />, admin);
    const card = await weekCard();
    expect(await within(card).findByText("Nobody is overdue a GSR.")).toBeInTheDocument();
    expect(within(card).queryByRole("list", { name: "Overdue" })).not.toBeInTheDocument();
  });

  it("says how many more are overdue past five", async () => {
    const people = RBA.profiles.filter((p) => p.company_id === RBA.company.id && p.is_active && !p.is_rococo_admin);
    expect(people.length).toBeGreaterThan(6);
    // Everyone's last GSR began in July, a day apart, on a monthly rhythm: all overdue, the
    // first of them the most.
    people.forEach((person, i) => done(person.id, `2026-07-${String(i + 1).padStart(2, "0")}`, 70));
    renderWithHub(<DashboardPage />, admin);
    const card = await weekCard();
    const overdue = await within(card).findByRole("list", { name: "Overdue" });
    const names = within(overdue).getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(people.slice(0, 5).map((p) => p.full_name));
    expect(within(card).getByText(`${people.length - 5} more overdue.`)).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /All GSRs/ })).toHaveAttribute("href", "/gsr");
  });

  it("agrees with the log's headline for the same data", async () => {
    scene();
    await rhythm(rowan, "daily");
    const log = renderWithHub(<GsrLogPage />, admin, { path: "/gsr", pattern: "/gsr" });
    const logHeadline = (await screen.findByTestId("gsr-headline")).textContent;
    const table = await screen.findByRole("table", { name: "People and their GSRs" });
    const logOverdue = within(table)
      .getAllByText("Overdue")
      .map((badge) => within(badge.closest("tr") as HTMLElement).getByRole("rowheader").querySelector("a")!.textContent)
      .sort();
    log.unmount();

    renderWithHub(<DashboardPage />, admin);
    const card = await weekCard();
    const headline = await within(card).findByTestId("gsr-week-headline");
    expect(headline.textContent).toBe(logHeadline);
    const cardOverdue = within(within(card).getByRole("list", { name: "Overdue" }))
      .getAllByRole("link")
      .map((a) => a.textContent)
      .sort();
    expect(cardOverdue).toEqual(logOverdue);
  });

  it("shows an admin no still-open reminder for a GSR month", async () => {
    const withSwitchboard = { ...onDemand, modules: [...onDemand.modules, "switchboard"] };
    renderWithHub(<DashboardPage />, { ...admin, company: withSwitchboard });
    const attention = sectionOf(await screen.findByRole("heading", { name: "Needs attention" }));
    await waitFor(() => expect(within(attention).queryByRole("status")).not.toBeInTheDocument());
    await screen.findByRole("heading", { name: "GSRs this week" });
    for (const month of RBA.cycles.filter((c) => c.cadence === "monthly")) {
      expect(within(attention).queryByText(`${month.name} is still open`)).not.toBeInTheDocument();
    }
  });

  it("says so when this week's GSRs do not load", async () => {
    // This week's read fails; the division strip's read of the month still answers.
    vi.mocked(listGsrsForLog).mockImplementation(async (companyId, range) => {
      if (range.from === "2026-09-14") throw new Error("The connection dropped.");
      return readLog(companyId, range);
    });
    onTestFinished(() => {
      vi.mocked(listGsrsForLog).mockImplementation(readLog);
    });
    renderWithHub(<DashboardPage />, admin);
    const card = await weekCard();
    expect(await within(card).findByText(/The connection dropped\./)).toBeInTheDocument();
    expect(within(card).queryByText(/GSRs? done/)).not.toBeInTheDocument();
  });
});

describe("the whole Home of a company on demand", () => {
  it("tells an employee nothing about months being locked in", async () => {
    await scoredGsrs();
    done(jamie.id, "2026-09-02", 80);
    const { container } = renderWithHub(<DashboardPage />, employee);
    await screen.findByText(`GSRs, ${q3.name}`);
    await screen.findByRole("heading", { name: /open goal/ });
    expect(container.textContent).not.toMatch(LOCKED_WORDS);
  });

  it("tells a manager nothing about months being locked in", async () => {
    await scoredGsrs();
    const { container } = renderWithHub(<DashboardPage />, manager);
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    await within(team).findByRole("link", { name: "Rowan Ellis" });
    await screen.findByRole("heading", { name: /open goal/ });
    expect(container.textContent).not.toMatch(LOCKED_WORDS);
  });

  it("tells an admin nothing about months being locked in", async () => {
    await scoredGsrs();
    const { container } = renderWithHub(<DashboardPage />, admin);
    const card = await weekCard();
    await within(card).findByTestId("gsr-week-headline");
    await screen.findByRole("heading", { name: q3.name });
    expect(container.textContent).not.toMatch(LOCKED_WORDS);
  });
});

describe("an admin's Home with no review cycle open", () => {
  // Closes every open RBA cycle for one test and opens them again after.
  async function closeAll() {
    const open = RBA.cycles.filter((c) => c.status === "open");
    for (const cycle of open) await updateCycle(cycle.id, { status: "closed" });
    onTestFinished(async () => {
      for (const cycle of open) await updateCycle(cycle.id, { status: "open" });
    });
  }

  it("starts a cycle on the reviews page in a company on demand, where /gsr is the GSRs log", async () => {
    await closeAll();
    renderWithHub(<DashboardPage />, admin);
    const start = await screen.findByRole("button", { name: "Start a cycle" });
    expect(start.closest("a")).toHaveAttribute("href", "/reviews");
  });

  it("starts a cycle where it always has in a company on periods", async () => {
    await closeAll();
    setMockGsrMode(RBA.company.id, "periods");
    renderWithHub(<DashboardPage />, makeHub("admin", RBA.company));
    const start = await screen.findByRole("button", { name: "Start a cycle" });
    expect(start.closest("a")).toHaveAttribute("href", "/gsr");
  });
});

describe("a company on periods", () => {
  const noOnDemandReads = () => {
    expect(listGsrsForLog).not.toHaveBeenCalled();
    expect(listPersonGsrs).not.toHaveBeenCalled();
    expect(listLastGsrDates).not.toHaveBeenCalled();
  };

  it("shows a company on periods the same Home as before, for an employee", async () => {
    setMockGsrMode(RBA.company.id, "periods");
    const { container } = renderWithHub(<DashboardPage />, makeHub("employee"));
    const gsr = sectionOf(await screen.findByRole("heading", { name: KLASIK.cycles[0].name }));
    await waitFor(() => expect(sections(container)[0]).toBe(gsr));
    const open = within(gsr).getByRole("link", { name: /Open my GSR/ });
    expect(open).toHaveAttribute("href", "/my/gsr");
    await screen.findByText("Closed sales");
    expect(container.querySelectorAll("button.bg-accent")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Your GSR" })).not.toBeInTheDocument();
    noOnDemandReads();
  });

  it("shows a company on periods the same Home as before, for a manager", async () => {
    setMockGsrMode(RBA.company.id, "periods");
    const { container } = renderWithHub(<DashboardPage />, makeHub("manager", RBA.company));
    const team = sectionOf(await screen.findByRole("heading", { name: "Your team" }));
    const rows = await within(team).findAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByRole("link", { name: "Rowan Ellis" })).toHaveAttribute("href", `/people/${rowan.id}`);
    expect(within(rows[0]).getByText("Not started")).toBeInTheDocument();
    const gsr = sectionOf(screen.getByRole("heading", { name: september.name }));
    expect(sections(container)[0]).toBe(gsr);
    expect(sections(container)[1]).toBe(team);
    expect(within(gsr).getByRole("link", { name: "Start my GSR" })).toHaveAttribute("href", "/my/gsr");
    noOnDemandReads();
  });

  it("shows a company on periods the same Home as before, for an admin", async () => {
    setMockGsrMode(RBA.company.id, "periods");
    const { container } = renderWithHub(<DashboardPage />, makeHub("admin", KINGDOM.company));
    const attention = sectionOf(await screen.findByRole("heading", { name: "Needs attention" }));
    await waitFor(() => expect(sections(container)[0]).toBe(attention));
    expect(screen.getByRole("heading", { name: KINGDOM.cycles[0].name })).toBeInTheDocument();
    expect(screen.getByText("Team score")).toBeInTheDocument();
    expect(screen.getByText("GSRs complete")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "GSRs this week" })).not.toBeInTheDocument();
    noOnDemandReads();
  });
});
