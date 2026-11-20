// The ways into a GSR on demand: starting one (from My GSR or from a person's GSR and goals tab),
// landing on today's when one was already started today, landing on the newest open one when the
// person already has two open and saying why, the list of a person's GSRs, and the rhythm that says
// how often a person is due one. A company on periods keeps My GSR and the person's tab exactly as
// they were. Each test reads the in-memory data layer the way the pages do, acting as the person
// the hub was rendered for.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/gsrOnDemand.ts", () => import("../test/mocks/gsrOnDemand.ts"));
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

import { HubContext, type HubValue } from "../context/HubContext.tsx";
import { getMyProfile, listCompanyProfiles, updateProfile } from "../services/profiles.ts";
import { listPersonGsrs, seedMockGsr, setMockGsrMode } from "../test/mocks/gsrOnDemand.ts";
import { setActingPerson } from "../test/actingPerson.ts";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import type { Gsr, GsrCadence, Profile } from "../types/database.ts";
import GsrPage from "./gsr/GsrPage.tsx";
import MyGsrPage from "./gsr/MyGsrPage.tsx";
import PersonPage from "./people/PersonPage.tsx";

const onDemand = { ...RBA.company, gsr_mode: "on_demand" as const };
const admin = makeHub("admin", onDemand);
const manager = makeHub("manager", onDemand);
const employee = makeHub("employee", onDemand);
const jamie = employee.profile;
const harper = manager.profile;
// Rowan reports to Harper.
const rowan = RBA.profiles.find((p) => p.full_name === "Rowan Ellis")!;
const asRowan: HubValue = { ...employee, profile: rowan };

// The router state a page was left with, so a test can see what a reload would bring back.
function StateProbe() {
  const { state } = useLocation();
  return <output data-testid="router-state">{JSON.stringify(state ?? null)}</output>;
}

type Entry = string | { pathname: string; state: unknown };

// The screens this task joins up, at their app addresses, acting as the hub's person.
function renderApp(hub: HubValue, entry: Entry) {
  setActingPerson(hub.profile);
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/my/gsr" element={<MyGsrPage />} />
          <Route path="/people/:profileId/:tab?" element={<PersonPage />} />
          <Route
            path="/gsr/reviews/:reviewId"
            element={
              <>
                <GsrPage />
                <StateProbe />
              </>
            }
          />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

const gsrTab = (hub: HubValue, person: Profile) => renderApp(hub, `/people/${person.id}/gsr`);
const gsrsSection = async () => (await screen.findByRole("heading", { name: "GSRs" })).closest("section") as HTMLElement;
const pageTitle = (name: string) => screen.findByRole("heading", { level: 1, name }, { timeout: 3000 });

function seed(employeeId: string, row: Partial<Gsr> = {}): Gsr {
  return seedMockGsr({ company_id: RBA.company.id, employee_id: employeeId, started_on: "2026-09-01", status: "in_progress", ...row });
}

// Puts a person's rhythm back after a test that changed it.
async function keepRhythm(person: Profile) {
  const before = (await listCompanyProfiles(RBA.company.id)).find((p) => p.id === person.id)!.gsr_cadence;
  onTestFinished(async () => {
    setActingPerson(admin.profile);
    await updateProfile(person.id, { gsr_cadence: before });
  });
}

beforeEach(() => {
  setMockGsrMode(RBA.company.id, "on_demand");
});

describe("starting a GSR", () => {
  it("starts a GSR and opens it", async () => {
    const user = userEvent.setup();
    gsrTab(manager, rowan);
    const section = await gsrsSection();
    expect(await within(section).findByText("No GSRs yet.")).toBeInTheDocument();
    // Worded for a GSR, which has no month and no period.
    expect(within(section).queryByText(/month(?!ly)|review|period|signed off/i)).not.toBeInTheDocument();
    await user.click(within(section).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/already has two GSRs open/)).not.toBeInTheDocument();
    const rows = await listPersonGsrs(RBA.company.id, rowan.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].started_on).toBe("2026-09-15");
  });

  it("opens today's GSR when one was already started today", async () => {
    const user = userEvent.setup();
    const first = gsrTab(manager, rowan);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 15, 2026")).toBeInTheDocument();
    const [started] = await listPersonGsrs(RBA.company.id, rowan.id);
    first.unmount();

    // An admin starts one for Rowan on the same day and lands on the one Harper started.
    gsrTab(admin, rowan);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 15, 2026")).toBeInTheDocument();
    const rows = await listPersonGsrs(RBA.company.id, rowan.id);
    expect(rows.map((g) => g.id)).toEqual([started.id]);
    expect(screen.queryByText(/already has two GSRs open/)).not.toBeInTheDocument();
  });

  it("opens the newest and says why when two are open", async () => {
    const user = userEvent.setup();
    seed(rowan.id, { started_on: "2026-09-01" });
    const newest = seed(rowan.id, { started_on: "2026-09-10" });
    const first = gsrTab(manager, rowan);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 10, 2026")).toBeInTheDocument();
    expect(screen.getByTestId("router-state")).toBeInTheDocument();
    expect(
      await screen.findByText("Rowan already has two GSRs open. Mark the earlier one done first. You can do it here, in Last GSR."),
    ).toBeInTheDocument();
    // The earlier one is in the Last GSR panel, with Mark done there.
    const last = (screen.getByRole("heading", { name: "Last GSR" }).closest("section") as HTMLElement);
    expect(within(last).getByText("Started Sep 1, 2026")).toBeInTheDocument();
    expect(within(last).getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, rowan.id)).map((g) => g.id)).toContain(newest.id);
    expect(await listPersonGsrs(RBA.company.id, rowan.id)).toHaveLength(2);
    first.unmount();

    // With a done GSR between the two open ones, the earlier open one is not the last GSR, so the
    // notice links to it instead.
    seed(rowan.id, { started_on: "2026-09-05", status: "complete", done_on: "2026-09-06", gsr_score: 80 });
    const second = gsrTab(manager, rowan);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 10, 2026")).toBeInTheDocument();
    expect(await screen.findByText(/Rowan already has two GSRs open\. Mark the earlier one done first\./)).toBeInTheDocument();
    expect(screen.queryByText(/You can do it here, in Last GSR/)).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open the GSR from Sep 1, 2026" });
    await user.click(link);
    expect(await pageTitle("GSR · Sep 1, 2026")).toBeInTheDocument();
    second.unmount();

    // A person starting their own at the limit hears that their manager closes the earlier one,
    // and is offered Mark done nowhere.
    seed(harper.id, { started_on: "2026-09-02" });
    seed(harper.id, { started_on: "2026-09-08" });
    gsrTab(manager, harper);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 8, 2026")).toBeInTheDocument();
    expect(await screen.findByText("You already have two GSRs open. Your manager marks the earlier one done first.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });

  it("opens the newest without a notice when one of the two open was started today", async () => {
    const user = userEvent.setup();
    seed(rowan.id, { started_on: "2026-09-01" });
    const today = seed(rowan.id, { started_on: "2026-09-15" });
    gsrTab(manager, rowan);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 15, 2026")).toBeInTheDocument();
    expect((await listPersonGsrs(RBA.company.id, rowan.id)).map((g) => g.id)).toContain(today.id);
    expect(await listPersonGsrs(RBA.company.id, rowan.id)).toHaveLength(2);
    expect(screen.queryByText(/already has two GSRs open/)).not.toBeInTheDocument();
  });

  it("does not land on a done GSR at the limit", async () => {
    const user = userEvent.setup();
    seed(rowan.id, { started_on: "2026-09-01" });
    seed(rowan.id, { started_on: "2026-09-05" });
    // The newest by start date is done, as after a GSR before it was reopened.
    seed(rowan.id, { started_on: "2026-09-10", status: "complete", done_on: "2026-09-11", gsr_score: 70 });
    gsrTab(manager, rowan);
    await user.click(within(await gsrsSection()).getByRole("button", { name: "New GSR" }));
    expect(await pageTitle("GSR · Sep 5, 2026")).toBeInTheDocument();
    expect(await screen.findByText("Rowan already has two GSRs open. Mark the earlier one done first. You can do it here, in Last GSR.")).toBeInTheDocument();
    expect(await listPersonGsrs(RBA.company.id, rowan.id)).toHaveLength(3);
  });

  it("shows the limit notice once and not after a reload", async () => {
    seed(rowan.id, { started_on: "2026-09-01" });
    const newest = seed(rowan.id, { started_on: "2026-09-10" });
    const path = `/gsr/reviews/${newest.id}`;
    const first = renderApp(manager, { pathname: path, state: { atLimit: true } });
    expect(await screen.findByText(/Rowan already has two GSRs open/)).toBeInTheDocument();
    // The page takes the notice off the address's state, so a reload does not bring it back.
    await waitFor(() => expect(screen.getByTestId("router-state")).toHaveTextContent("null"));
    expect(screen.getByText(/Rowan already has two GSRs open/)).toBeInTheDocument();
    first.unmount();

    renderApp(manager, path);
    expect(await pageTitle("GSR · Sep 10, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/already has two GSRs open/)).not.toBeInTheDocument();
  });

  it("says a failed start beside the control and lets it be tried again", async () => {
    const user = userEvent.setup();
    // The company is on periods in the data layer while the screen still reads on demand.
    setMockGsrMode(RBA.company.id, "periods");
    gsrTab(manager, rowan);
    const section = await gsrsSection();
    await user.click(within(section).getByRole("button", { name: "New GSR" }));
    expect(await within(section).findByText("GSRs on demand are not turned on for this company.")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "New GSR" })).toBeEnabled();
  });
});

describe("a person's GSRs", () => {
  it("lists a person's GSRs newest first and opens a done one read only", async () => {
    const user = userEvent.setup();
    seed(rowan.id, { started_on: "2026-08-03", status: "complete", done_on: "2026-08-10", gsr_score: 72, reviewer_id: harper.id });
    seed(rowan.id, { started_on: "2026-09-01" });
    seed(rowan.id, { started_on: "2026-07-06", status: "complete", done_on: "2026-07-08", gsr_score: null });
    const first = gsrTab(manager, rowan);
    const section = await gsrsSection();
    const list = await within(section).findByRole("list", { name: "GSRs" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((i) => within(i).getByRole("link").textContent)).toEqual(["Sep 1, 2026", "Aug 3, 2026", "Jul 6, 2026"]);
    expect(within(items[0]).getByText("In progress")).toBeInTheDocument();
    expect(within(items[1]).getByText("Done Aug 10, 2026")).toBeInTheDocument();
    expect(within(items[1]).getByText("72%")).toBeInTheDocument();
    expect(within(items[2]).getByText("Done Jul 8, 2026")).toBeInTheDocument();
    expect(within(items[2]).queryByText(/%/)).not.toBeInTheDocument();

    await user.click(within(items[1]).getByRole("link", { name: "Aug 3, 2026" }));
    expect(await pageTitle("GSR · Aug 3, 2026")).toBeInTheDocument();
    expect(screen.getByText("Done Aug 10, 2026")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a goal for this GSR" })).not.toBeInTheDocument();
    first.unmount();

    // The person reads the same list on My GSR, and a done one opens read only for them too.
    renderApp(asRowan, "/my/gsr");
    const mine = await screen.findByRole("list", { name: "GSRs" });
    expect(within(mine).getAllByRole("link").map((l) => l.textContent)).toEqual(["Sep 1, 2026", "Aug 3, 2026", "Jul 6, 2026"]);
    await user.click(within(mine).getByRole("link", { name: "Aug 3, 2026" }));
    expect(await pageTitle("GSR · Aug 3, 2026")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Add a goal for this GSR" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen" })).not.toBeInTheDocument();
  });

  it("offers Start a GSR on My GSR when none is open", async () => {
    const user = userEvent.setup();
    // Jamie's rhythm is monthly and the last one began on August 3, so one is due.
    seed(jamie.id, { started_on: "2026-08-03", status: "complete", done_on: "2026-08-05", gsr_score: 90 });
    const first = renderApp(employee, "/my/gsr");
    expect(await screen.findByRole("heading", { level: 1, name: "My GSR" })).toBeInTheDocument();
    const start = await screen.findByRole("button", { name: "Start a GSR" });
    expect(screen.getByText("A GSR is due.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open my GSR" })).not.toBeInTheDocument();
    // Worded for a GSR, which has no month and no period.
    expect(document.body.textContent).not.toMatch(/month|review|period|signed off/i);
    await user.click(start);
    expect(await pageTitle("GSR · Sep 15, 2026")).toBeInTheDocument();
    first.unmount();

    // With one open, My GSR opens it, and nothing is due.
    renderApp(employee, "/my/gsr");
    await user.click(await screen.findByRole("button", { name: "Open my GSR" }));
    expect(await pageTitle("GSR · Sep 15, 2026")).toBeInTheDocument();
    expect(screen.queryByText("A GSR is due.")).not.toBeInTheDocument();
  });

  it("says nothing is due for a person whose rhythm is None", async () => {
    await keepRhythm(jamie);
    setActingPerson(admin.profile);
    await updateProfile(jamie.id, { gsr_cadence: "none" });
    const hub: HubValue = { ...employee, profile: { ...jamie, gsr_cadence: "none" } };
    renderApp(hub, "/my/gsr");
    expect(await screen.findByRole("button", { name: "Start a GSR" })).toBeInTheDocument();
    expect(screen.queryByText("A GSR is due.")).not.toBeInTheDocument();
  });
});

describe("the GSR rhythm", () => {
  async function pick(rhythm: string) {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit GSR rhythm" }));
    await user.selectOptions(screen.getByLabelText("GSR rhythm"), rhythm);
    await user.click(screen.getByRole("button", { name: "Done" }));
  }

  it("lets an admin and the person's manager change the rhythm, and nobody else", async () => {
    await keepRhythm(rowan);
    const first = gsrTab(admin, rowan);
    const section = await gsrsSection();
    expect(within(section).getByText("Monthly")).toBeInTheDocument();
    await pick("Weekly");
    expect(await within(section).findByText("Weekly")).toBeInTheDocument();
    first.unmount();

    const second = gsrTab(manager, rowan);
    expect(await within(await gsrsSection()).findByText("Weekly")).toBeInTheDocument();
    await pick("Every two weeks");
    expect(await within(await gsrsSection()).findByText("Every two weeks")).toBeInTheDocument();
    second.unmount();

    // The person reads their rhythm and cannot change it.
    const third = gsrTab(asRowan, rowan);
    expect(await within(await gsrsSection()).findByText("Every two weeks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit GSR rhythm" })).not.toBeInTheDocument();
    third.unmount();

    // Nor can a colleague who does not lead them.
    gsrTab(employee, rowan);
    expect(await within(await gsrsSection()).findByText("Every two weeks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit GSR rhythm" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New GSR" })).not.toBeInTheDocument();
  });

  it("shows no rhythm and no New GSR in a company on periods", async () => {
    setMockGsrMode(RBA.company.id, "periods");
    gsrTab(makeHub("admin", RBA.company), rowan);
    expect(await screen.findByRole("heading", { name: "This year, next year and the BHAG" })).toBeInTheDocument();
    expect(screen.queryByText("GSR rhythm")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New GSR" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "GSRs" })).not.toBeInTheDocument();
  });
});

describe("a company on periods", () => {
  it("keeps My GSR and a person's GSR and goals tab unchanged for a company on periods", async () => {
    // My GSR, as an existing test reads it: the open month's GSR with its action steps.
    const mine = renderApp(makeHub("employee"), "/my/gsr");
    expect(await screen.findByLabelText("Ask two clients how it landed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a GSR" })).not.toBeInTheDocument();
    mine.unmount();

    // A person's GSR and goals tab, as an existing test reads it: this month's GSR, then the goals.
    const noor = RBA.profiles.find((p) => p.id === "rba-user-3")!;
    renderApp(makeHub("admin", RBA.company), `/people/${noor.id}/gsr`);
    await screen.findByRole("heading", { name: "Noor Haddad" });
    const at = (name: string) => screen.getAllByRole("heading").map((h) => h.textContent ?? "").indexOf(name);
    await waitFor(() => expect(at("This month's GSR")).toBeGreaterThan(-1));
    expect(at("This month's GSR")).toBeLessThan(at("This year, next year and the BHAG"));
    expect(screen.queryByText("GSR rhythm")).not.toBeInTheDocument();
    expect(KLASIK.company.gsr_mode).toBe("periods");
  });
});

describe("the profiles mock", () => {
  const rhythm = async (by: Profile, cadence: GsrCadence, extra: Partial<Profile> = {}) => {
    setActingPerson(by);
    return updateProfile(rowan.id, { gsr_cadence: cadence, ...extra });
  };

  it("lets an admin and a leader in a company on demand set a rhythm, and refuses the rest as the database does", async () => {
    await keepRhythm(rowan);
    expect((await rhythm(admin.profile, "weekly")).gsr_cadence).toBe("weekly");
    expect((await rhythm(harper, "daily")).gsr_cadence).toBe("daily");
    // The person themself.
    await expect(rhythm(rowan, "none")).rejects.toThrow("Only admins can change employment details.");
    // A colleague who does not lead them: no policy reaches the row.
    await expect(rhythm(jamie, "none")).rejects.toThrow("JSON object requested, multiple (or no) rows returned");
    // A leader changing anything beside the rhythm.
    await expect(rhythm(harper, "weekly", { title: "Lead" })).rejects.toThrow("A manager can change only the GSR rhythm of the people they lead.");
    // A leader in a company on periods: the policy is for a company on demand only.
    setMockGsrMode(RBA.company.id, "periods");
    await expect(rhythm(harper, "weekly")).rejects.toThrow("JSON object requested, multiple (or no) rows returned");
    // An admin still sets it there.
    expect((await rhythm(admin.profile, "quarterly")).gsr_cadence).toBe("quarterly");
    // Nothing the refusals touched changed.
    setActingPerson(admin.profile);
    expect((await listCompanyProfiles(RBA.company.id)).find((p) => p.id === rowan.id)).toMatchObject({ gsr_cadence: "quarterly", title: rowan.title });
    expect(await getMyProfile()).toBeTruthy();
  });
});
