// The focus topic calendar, the New month dialog reading it, and the company's divisions in
// settings, rendered against the mocked data layer the way pages.test.tsx renders every page.
// The mocks keep state for the whole file, so each test names the rows it starts from.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

import { renderWithHub } from "../test/renderWithHub.tsx";
import { KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { getCycle, updateCycle } from "../services/gsr.ts";
import { listFocusTopics } from "../services/focusTopics.ts";
import { listDivisions } from "../services/divisions.ts";
import { listCompanyProfiles } from "../services/profiles.ts";
import GsrSettingsPage from "./gsr/GsrSettingsPage.tsx";
import CyclesPage from "./gsr/CyclesPage.tsx";
import CompanySettingsPage from "./CompanySettingsPage.tsx";

const klasikAdmin = makeHub("admin");
const rbaAdmin = makeHub("admin", RBA.company);
// Klasik's September GSR carries a theme typed on the cycle; RBA's September GSR has none.
const klasikSeptember = KLASIK.cycles[0];
const rbaSeptember = RBA.cycles.find((c) => c.cadence === "monthly")!;

async function calendar() {
  const heading = await screen.findByRole("heading", { name: "Focus topic calendar" });
  const section = heading.closest("section") as HTMLElement;
  await within(section).findByLabelText("Theme for September 2026");
  return section;
}

describe("focus topic calendar", () => {
  it("lists this month and the next twelve, with the planned topics filled in", async () => {
    renderWithHub(<GsrSettingsPage />, klasikAdmin);
    const section = await calendar();
    expect(within(section).getByLabelText("Theme for September 2026")).toHaveValue("Core value: Integrity");
    expect(within(section).getByLabelText("Theme for October 2026")).toHaveValue("Core value: Ownership");
    expect(within(section).getByLabelText("Description for October 2026")).toHaveValue("Take a problem from noticed to fixed without being asked.");
    expect(within(section).getByLabelText("Theme for September 2027")).toHaveValue("");
    expect(within(section).queryByLabelText("Theme for August 2026")).not.toBeInTheDocument();
    expect(within(section).queryByLabelText("Theme for October 2027")).not.toBeInTheDocument();
    expect(within(section).getAllByLabelText(/^Theme for /)).toHaveLength(13);
    // A month with nothing planned reads as a quiet placeholder and has no description to write yet.
    expect(within(section).getByLabelText("Theme for November 2026")).toHaveAttribute("placeholder", "No topic yet");
    expect(within(section).queryByLabelText("Description for November 2026")).not.toBeInTheDocument();
  });

  it("fills a month's GSR theme and description when the GSR has none", async () => {
    const user = userEvent.setup();
    expect((await getCycle(rbaSeptember.id)).theme).toBeNull();
    renderWithHub(<GsrSettingsPage />, rbaAdmin);
    const section = await calendar();
    await user.type(within(section).getByLabelText("Theme for September 2026"), "Safety first");
    await user.tab();
    await waitFor(async () => expect((await getCycle(rbaSeptember.id)).theme).toBe("Safety first"));
    const topics = await listFocusTopics(RBA.company.id, "2026-09-01", "2026-09-01");
    expect(topics.map((t) => t.theme)).toEqual(["Safety first"]);

    // The description written next follows it onto the GSR, which now carries the calendar's theme.
    await user.type(within(section).getByLabelText("Description for September 2026"), "Walk the site before the crew starts.");
    await user.tab();
    await waitFor(async () => expect((await getCycle(rbaSeptember.id)).theme_description).toBe("Walk the site before the crew starts."));
    expect(await within(section).findByText(/On the September 2026 GSR/)).toBeInTheDocument();
  });

  it("never overwrites a theme typed on the GSR itself", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, klasikAdmin);
    const section = await calendar();
    const input = within(section).getByLabelText("Theme for September 2026");
    await user.clear(input);
    await user.type(input, "Core value: Courage");
    await user.tab();
    await waitFor(async () => {
      const topics = await listFocusTopics(KLASIK.company.id, "2026-09-01", "2026-09-01");
      expect(topics[0]?.theme).toBe("Core value: Courage");
    });
    const cycle = await getCycle(klasikSeptember.id);
    expect(cycle.theme).toBe("Core value: Integrity");
    expect(cycle.theme_description).toBe(klasikSeptember.theme_description);
    expect(await within(section).findByText(/keeps its own theme/)).toBeInTheDocument();
  });

  it("removes a topic from the calendar only, leaving the GSR's theme", async () => {
    const user = userEvent.setup();
    renderWithHub(<GsrSettingsPage />, rbaAdmin);
    const section = await calendar();
    expect(within(section).getByLabelText("Theme for September 2026")).toHaveValue("Safety first");
    await user.click(within(section).getByRole("button", { name: "Remove the September 2026 topic" }));
    await waitFor(() => expect(within(section).getByLabelText("Theme for September 2026")).toHaveValue(""));
    expect(await listFocusTopics(RBA.company.id, "2026-09-01", "2026-09-01")).toEqual([]);
    expect((await getCycle(rbaSeptember.id)).theme).toBe("Safety first");
    // Put RBA's September GSR back the way the fixtures describe it for anything after.
    await updateCycle(rbaSeptember.id, { theme: null, theme_description: null });
  });

  it("offers Remove only on a month that has a topic", async () => {
    renderWithHub(<GsrSettingsPage />, klasikAdmin);
    const section = await calendar();
    // A month with no topic has nothing to remove.
    expect(within(section).queryByRole("button", { name: "Remove the November 2026 topic" })).not.toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Remove the October 2026 topic" })).toBeInTheDocument();
  });
});

describe("new month dialog", () => {
  it("pre-fills the theme from the calendar and follows the month until the admin types their own", async () => {
    const user = userEvent.setup();
    renderWithHub(<CyclesPage section="gsr" />, klasikAdmin);
    await user.click(await screen.findByRole("button", { name: "New month" }));
    const dialog = await screen.findByRole("dialog");
    const theme = within(dialog).getByLabelText("Theme (optional)") as HTMLInputElement;
    const [september] = await listFocusTopics(KLASIK.company.id, "2026-09-01", "2026-09-01");
    await waitFor(() => expect(theme).toHaveValue(september.theme));

    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-10-01" } });
    await waitFor(() => expect(theme).toHaveValue("Core value: Ownership"));
    expect(within(dialog).getByLabelText("Theme description")).toHaveValue("Take a problem from noticed to fixed without being asked.");
    expect(within(dialog).getByText(/From the focus topic calendar/)).toBeInTheDocument();

    // A month with nothing planned leaves the theme empty.
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-11-01" } });
    await waitFor(() => expect(theme).toHaveValue(""));

    // Once the admin types a theme, changing the month keeps it.
    await user.type(theme, "Year-end push");
    fireEvent.change(within(dialog).getByLabelText("Starts"), { target: { value: "2026-10-01" } });
    expect(within(dialog).getByLabelText("Name")).toHaveValue("October 2026");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(theme).toHaveValue("Year-end push");
  });

  it("links the GSR list to the calendar", async () => {
    renderWithHub(<CyclesPage section="gsr" />, klasikAdmin);
    const link = await screen.findByRole("link", { name: /Focus topics/ });
    expect(link).toHaveAttribute("href", "/reviews/settings#focus-topics");
  });
});

describe("divisions in company settings", () => {
  async function panel() {
    const heading = await screen.findByRole("heading", { name: "Divisions" });
    const section = heading.closest("section") as HTMLElement;
    await within(section).findByLabelText("Division name RBA South");
    return section;
  }

  it("lists, adds, renames and removes a company's divisions", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, rbaAdmin);
    const section = await panel();
    expect(within(section).getByLabelText("Division name RBA North")).toBeInTheDocument();
    expect(within(section).getByText("3 people")).toBeInTheDocument();
    expect(within(section).getByText("1 person")).toBeInTheDocument();

    await user.type(within(section).getByLabelText("New division"), "West office");
    await user.click(within(section).getByRole("button", { name: /Add division/ }));
    expect(await within(section).findByLabelText("Division name West office")).toBeInTheDocument();
    expect((await listDivisions(RBA.company.id)).map((d) => d.name)).toEqual(["RBA South", "RBA North", "West office"]);

    const north = within(section).getByLabelText("Division name RBA North");
    await user.clear(north);
    await user.type(north, "North office");
    await user.tab();
    await waitFor(async () => expect((await listDivisions(RBA.company.id)).map((d) => d.name)).toContain("North office"));

    await user.click(within(section).getByRole("button", { name: "Remove RBA South" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/3 people in it are left with no division/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove division" }));
    await waitFor(() => expect(within(section).queryByLabelText("Division name RBA South")).not.toBeInTheDocument());
    expect((await listDivisions(RBA.company.id)).map((d) => d.name)).toEqual(["North office", "West office"]);
    const people = await listCompanyProfiles(RBA.company.id);
    expect(people.filter((p) => p.division_id === "rba-division-south")).toEqual([]);
  });

  it("says why a duplicate name will not save", async () => {
    const user = userEvent.setup();
    renderWithHub(<CompanySettingsPage />, rbaAdmin);
    const heading = await screen.findByRole("heading", { name: "Divisions" });
    const section = heading.closest("section") as HTMLElement;
    await within(section).findByLabelText("Division name West office");
    await user.type(within(section).getByLabelText("New division"), "West office");
    await user.click(within(section).getByRole("button", { name: /Add division/ }));
    expect(await within(section).findByText("That already exists.")).toBeInTheDocument();
  });

  it("starts empty for a company with no divisions", async () => {
    renderWithHub(<CompanySettingsPage />, klasikAdmin);
    const heading = await screen.findByRole("heading", { name: "Divisions" });
    const section = heading.closest("section") as HTMLElement;
    expect(await within(section).findByText(/No divisions/)).toBeInTheDocument();
  });
});
