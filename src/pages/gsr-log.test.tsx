// The GSRs log, a company on demand's view of its GSRs: how many were done in a window and their
// average, who has one in progress, who is due or overdue by their rhythm, and a way to start one
// for anyone the viewer leads. A company on periods keeps its monthly list, its tab label and its
// sidebar exactly as they were. Each test reads the in-memory data layer the way the page does,
// acting as the person the hub was rendered for.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
// The log's read wrapped in a spy, so a test can make it fail once.
vi.mock("../services/gsrOnDemand.ts", async () => {
  const mock = await import("../test/mocks/gsrOnDemand.ts");
  return { ...mock, listGsrsForLog: vi.fn(mock.listGsrsForLog) };
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

import App from "../App.tsx";
import { HubContext, type HubValue } from "../context/HubContext.tsx";
import { navFor, type NavLayout } from "../lib/navigation.ts";
import { listGsrsForLog } from "../services/gsrOnDemand.ts";
import { listCompanyProfiles, updateProfile } from "../services/profiles.ts";
import { listPersonGsrs, seedMockGsr, setMockGsrMode } from "../test/mocks/gsrOnDemand.ts";
import { setActingPerson } from "../test/actingPerson.ts";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import type { Gsr, GsrCadence, Profile } from "../types/database.ts";
import GsrLogPage from "./gsr/GsrLogPage.tsx";
import GsrSetupPage from "./gsr/GsrSetupPage.tsx";
import { renderWithHub } from "../test/renderWithHub.tsx";

const onDemand = { ...RBA.company, gsr_mode: "on_demand" as const };
const admin = makeHub("admin", onDemand);
const manager = makeHub("manager", onDemand);
const alex = admin.profile;
const harper = manager.profile;
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const jamie = byName("Jamie Fox");
const noor = byName("Noor Haddad");
// Rowan reports to Harper, and Kai, who has not signed in yet, to Rowan.
const rowan = byName("Rowan Ellis");
const kai = byName("Kai Bennett");

// Every link a sidebar holds.
const sidebarLinks = (layout: NavLayout) => (layout.kind === "flat" ? layout.items : layout.sections.flatMap((s) => s.items)).map((i) => i.to);

// Where the page sent the browser, so a test can read the address it left.
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderLog(hub: HubValue, path = "/gsr") {
  setActingPerson(hub.profile);
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/gsr"
            element={
              <>
                <GsrLogPage />
                <LocationProbe />
              </>
            }
          />
          <Route path="/gsr/reviews/:reviewId" element={<LocationProbe />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

const headline = () => screen.findByTestId("gsr-headline");
const table = async () => screen.findByRole("table", { name: "People and their GSRs" });
async function rowOf(name: string): Promise<HTMLElement> {
  const t = await table();
  return within(t).getByRole("rowheader", { name: new RegExp(name) }).closest("tr") as HTMLElement;
}

function seed(employeeId: string, row: Partial<Gsr> = {}): Gsr {
  return seedMockGsr({ company_id: RBA.company.id, employee_id: employeeId, started_on: "2026-09-01", status: "in_progress", ...row });
}
const done = (employeeId: string, doneOn: string, score: number | null) =>
  seed(employeeId, { started_on: doneOn, done_on: doneOn, status: "complete", gsr_score: score });

// Sets a person's rhythm for one test and puts it back after.
async function rhythm(person: Profile, cadence: GsrCadence) {
  const before = (await listCompanyProfiles(RBA.company.id)).find((p) => p.id === person.id)!.gsr_cadence;
  onTestFinished(async () => {
    setActingPerson(alex);
    await updateProfile(person.id, { gsr_cadence: before });
  });
  setActingPerson(alex);
  await updateProfile(person.id, { gsr_cadence: cadence });
}

// The scene the window tests read: three done in September, two of them this week, and one open.
function september() {
  done(jamie.id, "2026-09-14", 80);
  done(noor.id, "2026-09-15", 90);
  done(rowan.id, "2026-09-10", 50);
  seed(kai.id, { started_on: "2026-09-12" });
}

beforeEach(() => {
  setMockGsrMode(RBA.company.id, "on_demand");
  window.history.pushState({}, "", "/");
});

describe("the GSRs log", () => {
  it("counts done GSRs and averages them for this week", async () => {
    september();
    renderLog(admin);
    expect(await headline()).toHaveTextContent("2 GSRs done · Average 85 · 1 in progress");
    expect(screen.getByLabelText("Window")).toHaveValue("week");
    expect(screen.getByText("Sep 14 to Sep 20, 2026")).toBeInTheDocument();
    // Each person's own figures for the window, and the open one reads In progress.
    expect(within(await rowOf("Jamie Fox")).getByText("80")).toBeInTheDocument();
    expect(within(await rowOf("Kai Bennett")).getByText("In progress")).toBeInTheDocument();
    expect(within(await rowOf("Jamie Fox")).getByText("Sep 14, 2026")).toBeInTheDocument();
    // Each name opens the person's GSR tab.
    expect(within(await rowOf("Jamie Fox")).getByRole("link", { name: "Jamie Fox" })).toHaveAttribute("href", `/people/${jamie.id}/gsr`);
    // Worded for GSRs on demand.
    // The window's own label, This month, is the one place the word appears.
    expect(screen.queryByText(/month(?!ly)|review|period|signed off/i, { ignore: "option, script, style" })).not.toBeInTheDocument();
  });

  it("changes Done and Average with the window and leaves In progress and Overdue alone", async () => {
    const user = userEvent.setup();
    september();
    // Daily, with the last one begun on the 10th: overdue whatever the window.
    await rhythm(rowan, "daily");
    renderLog(admin);
    expect(await headline()).toHaveTextContent("2 GSRs done · Average 85 · 1 in progress");
    expect(within(await rowOf("Rowan Ellis")).getByText("Overdue")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Window"), "month");
    await waitFor(async () => expect(await headline()).toHaveTextContent("3 GSRs done · Average 73 · 1 in progress"));
    expect(within(await rowOf("Rowan Ellis")).getByText("Overdue")).toBeInTheDocument();
    expect(within(await rowOf("Rowan Ellis")).getByText("50")).toBeInTheDocument();
    expect(within(await rowOf("Kai Bennett")).getByText("In progress")).toBeInTheDocument();
  });

  it("reads custom dates only once both are in and the end is not before the start", async () => {
    const user = userEvent.setup();
    september();
    renderLog(admin);
    await headline();
    const read = vi.mocked(listGsrsForLog);
    await user.selectOptions(screen.getByLabelText("Window"), "custom");
    const calls = read.mock.calls.length;
    expect(screen.queryByTestId("gsr-headline")).not.toBeInTheDocument();
    expect(screen.getByText("Choose a start and an end date.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("From"), "2026-09-12");
    await user.type(screen.getByLabelText("To"), "2026-09-01");
    expect(screen.getByText("The end date is before the start date.")).toBeInTheDocument();
    expect(read.mock.calls.length).toBe(calls);
    await user.clear(screen.getByLabelText("To"));
    await user.type(screen.getByLabelText("To"), "2026-09-14");
    expect(await headline()).toHaveTextContent("1 GSR done · Average 80 · 1 in progress");
    expect(read).toHaveBeenLastCalledWith(RBA.company.id, { from: "2026-09-12", to: "2026-09-14" });
  });

  it("keeps the window in the address across a reload", async () => {
    const user = userEvent.setup();
    september();
    const first = renderLog(admin, "/gsr?persona=admin");
    await headline();
    await user.selectOptions(screen.getByLabelText("Window"), "month");
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("/gsr?persona=admin&window=month"));
    const address = screen.getByTestId("location").textContent!;
    first.unmount();

    renderLog(admin, address);
    expect(screen.getByLabelText("Window")).toHaveValue("month");
    expect(await headline()).toHaveTextContent("3 GSRs done · Average 73 · 1 in progress");
  });

  it("uses the company's date, not the browser's", async () => {
    // Sunday September 20 at noon in UTC is already Monday September 21 in Kiritimati.
    vi.setSystemTime(new Date("2026-09-20T12:00:00.000Z"));
    onTestFinished(() => void vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z")));
    const kiritimati = { ...onDemand, time_zone: "Pacific/Kiritimati" };
    done(jamie.id, "2026-09-20", 60);
    done(noor.id, "2026-09-21", 90);
    // Daily, last begun on Sunday the 20th: due on Monday the 21st, which is today only in the
    // company's time zone. By the browser's date it would not be due yet.
    await rhythm(jamie, "daily");
    renderLog(makeHub("admin", kiritimati));
    expect(await headline()).toHaveTextContent("1 GSR done · Average 90 · 0 in progress");
    expect(screen.getByText("Sep 21 to Sep 27, 2026")).toBeInTheDocument();
    expect(within(await rowOf("Jamie Fox")).getByText("Due today")).toBeInTheDocument();
  });

  it("shows a manager only the people they lead", async () => {
    seed(rowan.id, { started_on: "2026-09-14" });
    done(rowan.id, "2026-09-15", 90);
    // Done this week by someone Harper does not lead, with a score that would move the average.
    done(jamie.id, "2026-09-14", 10);
    renderLog(manager);
    expect(await headline()).toHaveTextContent("1 GSR done · Average 90 · 1 in progress");
    const t = await table();
    const names = within(t).getAllByRole("rowheader").map((th) => within(th).getByRole("link").textContent);
    expect(names).toEqual(["Kai Bennett", "Rowan Ellis"]);
    expect(within(t).queryByText("Jamie Fox")).not.toBeInTheDocument();
    expect(within(t).queryByText(harper.full_name!)).not.toBeInTheDocument();
    // New GSR offers the same people.
    expect(within(screen.getByLabelText("Person")).getAllByRole("option").map((o) => o.textContent)).toEqual(["Choose a person", "Kai Bennett", "Rowan Ellis"]);
    // A manager has no Setup tab.
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
  });

  it("shows a person with no account like anyone else", async () => {
    renderLog(admin);
    const row = await rowOf("Kai Bennett");
    expect(within(row).getByText("Never")).toBeInTheDocument();
    expect(within(row).getByText("Monthly")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /^Start/ })).toBeInTheDocument();
    expect(within(await rowOf("Avery Cole")).getByRole("button", { name: /^Start/ })).toBeInTheDocument();
  });

  it("flags a lapsed rhythm as Overdue and never flags rhythm None", async () => {
    await rhythm(jamie, "weekly");
    await rhythm(noor, "none");
    seed(jamie.id, { started_on: "2026-09-01", done_on: "2026-09-02", status: "complete", gsr_score: 70 });
    renderLog(admin);
    const jamieRow = await rowOf("Jamie Fox");
    expect(within(jamieRow).getByText("Overdue")).toBeInTheDocument();
    expect(within(jamieRow).getByText("Weekly")).toBeInTheDocument();
    expect(within(jamieRow).getByText("Sep 1, 2026")).toBeInTheDocument();
    const noorRow = await rowOf("Noor Haddad");
    expect(within(noorRow).getByText("None")).toBeInTheDocument();
    expect(within(noorRow).getByText("Never")).toBeInTheDocument();
    expect(within(noorRow).queryByText(/Overdue|Due today/)).not.toBeInTheDocument();
    // Never given one on a monthly rhythm: due from today, as the rule decides.
    expect(within(await rowOf("Kai Bennett")).getByText("Due today")).toBeInTheDocument();
  });

  it("starts a GSR from a row", async () => {
    const user = userEvent.setup();
    const open = seed(jamie.id, { started_on: "2026-09-10" });
    renderLog(admin);
    // A person with one in progress is opened, not started again.
    expect(within(await rowOf("Jamie Fox")).getByRole("link", { name: /^Open/ })).toHaveAttribute("href", `/gsr/reviews/${open.id}`);
    await user.click(within(await rowOf("Rowan Ellis")).getByRole("button", { name: /^Start/ }));
    const [started] = await listPersonGsrs(RBA.company.id, rowan.id);
    expect(started.started_on).toBe("2026-09-15");
    expect(await screen.findByTestId("location")).toHaveTextContent(`/gsr/reviews/${started.id}`);
  });

  it("starts a GSR from New GSR for the person chosen", async () => {
    const user = userEvent.setup();
    renderLog(manager);
    await table();
    const button = screen.getByRole("button", { name: "New GSR" });
    expect(button).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Person"), kai.id);
    await user.click(button);
    const [started] = await listPersonGsrs(RBA.company.id, kai.id);
    expect(await screen.findByTestId("location")).toHaveTextContent(`/gsr/reviews/${started.id}`);
  });

  it("reads averages as a dash in a company that does not score GSRs", async () => {
    done(jamie.id, "2026-09-14", null);
    renderLog(admin);
    expect(await headline()).toHaveTextContent("1 GSR done · Average - · 0 in progress");
    const row = await rowOf("Jamie Fox");
    expect(within(row).getByText("1")).toBeInTheDocument();
    expect(within(row).getByText("-")).toBeInTheDocument();
  });

  it("says so when the GSRs cannot be loaded and offers to try again", async () => {
    const user = userEvent.setup();
    september();
    vi.mocked(listGsrsForLog).mockRejectedValueOnce(new Error("Failed to fetch"));
    renderLog(admin);
    expect(await screen.findByText("The connection dropped. Check your signal and try again.")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "People and their GSRs" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await headline()).toHaveTextContent("2 GSRs done · Average 85 · 1 in progress");
  });
});

describe("the GSRs address", () => {
  it("opens the log for an admin and a lead, with the first tab reading GSRs", async () => {
    window.history.pushState({}, "", `/gsr?persona=admin&company=${RBA.company.slug}`);
    const first = render(<App />);
    const nav = await screen.findByRole("navigation", { name: "GSRs" }, { timeout: 4000 });
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["GSRs", "/gsr"],
      ["Setup", "/gsr/setup"],
    ]);
    expect(await headline()).toBeInTheDocument();
    first.unmount();

    window.history.pushState({}, "", `/gsr?persona=manager&company=${RBA.company.slug}`);
    render(<App />);
    expect(await headline()).toBeInTheDocument();
    expect(window.location.pathname).toBe("/gsr");
    expect(sidebarLinks(navFor(onDemand, false, false, true, () => true))).toContain("/gsr");
  });

  it("sends an employee to My GSR", async () => {
    window.history.pushState({}, "", `/gsr?persona=employee&company=${RBA.company.slug}`);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/my/gsr"), { timeout: 4000 });
    expect(screen.queryByTestId("gsr-headline")).not.toBeInTheDocument();
  });

  it("sends a month's old address to the log", async () => {
    const cycle = RBA.cycles[0];
    window.history.pushState({}, "", `/gsr/cycles/${cycle.id}?persona=admin&company=${RBA.company.slug}`);
    render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/gsr"), { timeout: 4000 });
    expect(await headline()).toBeInTheDocument();
  });

  it("keeps the monthly list, its tab label and its sidebar audience for a company on periods", async () => {
    window.history.pushState({}, "", `/gsr?persona=admin&company=${KLASIK.company.slug}`);
    const first = render(<App />);
    const nav = await screen.findByRole("navigation", { name: "GSRs" }, { timeout: 4000 });
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Periods", "/gsr"],
      ["Setup", "/gsr/setup"],
    ]);
    expect(screen.queryByTestId("gsr-headline")).not.toBeInTheDocument();
    first.unmount();

    // A manager at a company on periods is still sent to their own GSR, and has no GSRs item.
    window.history.pushState({}, "", `/gsr?persona=manager&company=${KINGDOM.company.slug}`);
    const second = render(<App />);
    await waitFor(() => expect(window.location.pathname).toBe("/my/gsr"), { timeout: 4000 });
    second.unmount();
    const managerSidebar = navFor(KINGDOM.company, false, false, true, () => true);
    expect(sidebarLinks(managerSidebar)).not.toContain("/gsr");
    const adminSidebar = navFor(KLASIK.company, true, false, true, () => true);
    expect(sidebarLinks(adminSidebar)).toContain("/gsr");

    // A month's address still opens the month.
    const month = KLASIK.cycles.find((c) => c.kind === "gsr")!;
    window.history.pushState({}, "", `/gsr/cycles/${month.id}?persona=admin&company=${KLASIK.company.slug}`);
    render(<App />);
    expect(await screen.findByRole("heading", { level: 1, name: month.name }, { timeout: 4000 })).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/gsr/cycles/${month.id}`);
  });
});

describe("GSRs, Setup", () => {
  const setup = (hub: HubValue) => renderWithHub(<GsrSetupPage />, hub, { path: "/gsr/setup", pattern: "/gsr/setup" });

  it("describes itself by GSR, not by month, in a company on demand", async () => {
    setup(admin);
    expect(await screen.findByText("What shapes every GSR: the focus topic each GSR is built on, and how many goals each one requires.")).toBeInTheDocument();
    expect(screen.queryByText(/What shapes every month/)).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "GSRs" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["GSRs", "Setup"]);
  });

  it("reads as it always has for a company on periods", async () => {
    setup(makeHub("admin", KLASIK.company));
    expect(await screen.findByText("What shapes every month: the focus topic each GSR is built on, and how many goals each one requires.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "GSRs" });
    expect(within(nav).getAllByRole("link").map((l) => l.textContent)).toEqual(["Periods", "Setup"]);
  });
});
