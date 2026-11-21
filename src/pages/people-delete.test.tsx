// Delete person on the Setup tab (0049): offered to an admin on a signed-in person they manage and
// to nobody else here (not a manager, not on yourself, not on someone ranked above), its button held
// until the person's full name is typed exactly, a delete landing on People with a line saying who
// went, a refusal staying in the dialog in the database's words, a limited admin not offered it on a
// peer admin, and Remove for someone who never signed in: one click with nothing on their profile,
// the same typed name once the page has loaded reviews, GSRs or goals for them.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/gsrOnDemand.ts", () => import("../test/mocks/gsrOnDemand.ts"));
vi.mock("../services/employees.ts", () => import("../test/mocks/employees.ts"));
vi.mock("../services/deliverables.ts", () => import("../test/mocks/deliverables.ts"));
vi.mock("../services/jobRoles.ts", () => import("../test/mocks/jobRoles.ts"));
vi.mock("../services/projects.ts", () => import("../test/mocks/projects.ts"));
vi.mock("../services/scorecards.ts", () => import("../test/mocks/scorecards.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/projectAssignments.ts", () => import("../test/mocks/projectAssignments.ts"));
vi.mock("../services/reviewProjectNotes.ts", () => import("../test/mocks/reviewProjectNotes.ts"));
vi.mock("../services/tasks.ts", () => import("../test/mocks/tasks.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/focusTopics.ts", () => import("../test/mocks/focusTopics.ts"));
vi.mock("../services/financials.ts", () => import("../test/mocks/financials.ts"));

import { HubContext, type HubValue } from "../context/HubContext.tsx";
import { KINGDOM, KLASIK, RBA, makeHub } from "../test/fixtures.ts";
import { setActingPerson } from "../test/actingPerson.ts";
import * as gsrService from "../services/gsr.ts";
import * as profilesService from "../services/profiles.ts";
import PeoplePage from "./people/PeoplePage.tsx";
import PersonPage from "./people/PersonPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const klasikAdmin = makeHub("admin", KLASIK.company);
const kingdomAdmin = makeHub("admin", KINGDOM.company);
const byName = (people: typeof RBA.profiles, name: string) => people.find((p) => p.full_name === name)!;
const alex = byName(RBA.profiles, "Alex Morgan");
const jamie = byName(RBA.profiles, "Jamie Fox");
const noor = byName(RBA.profiles, "Noor Haddad");
const rowan = byName(RBA.profiles, "Rowan Ellis");
const kai = byName(RBA.profiles, "Kai Bennett");
const harper = byName(RBA.profiles, "Harper Quinn");
const taylor = byName(KLASIK.profiles, "Taylor Reed");
const marcus = byName(KINGDOM.profiles, "Marcus Lee");

// The person page with the real People page beside it, acting as the hub's person in the mocks.
function renderPerson(hub: HubValue, path: string) {
  setActingPerson(hub.profile);
  return render(
    <HubContext value={hub}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/people/:profileId/:tab?" element={<PersonPage />} />
          <Route path="*" element={<div>elsewhere</div>} />
        </Routes>
      </MemoryRouter>
    </HubContext>,
  );
}

async function openDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Delete person" }));
  return screen.getByRole("dialog");
}

describe("who is offered Delete person", () => {
  it("offers it to an admin on a signed-in employee they manage, apart from Deactivate", async () => {
    renderPerson(rbaAdmin, `/people/${jamie.id}/setup`);
    expect(await screen.findByRole("button", { name: "Delete person" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate Jamie Fox" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Jamie Fox" })).not.toBeInTheDocument();
  });

  it("offers it to no manager", async () => {
    renderPerson(rbaManager, `/people/${rowan.id}/setup`);
    expect(await screen.findByRole("heading", { name: "Rowan Ellis" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete person" })).not.toBeInTheDocument();
  });

  it("offers it nobody on their own page", async () => {
    renderPerson(rbaAdmin, `/people/${alex.id}/setup`);
    expect(await screen.findByText(/This is you/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete person" })).not.toBeInTheDocument();
  });

  it("offers it to a full-scope admin on a peer admin, and not to an admin limited to some divisions", async () => {
    await profilesService.updateProfile(harper.id, { role: "admin" });
    onTestFinished(() => void profilesService.updateProfile(harper.id, { role: "manager" }));
    const full = renderPerson(rbaAdmin, `/people/${harper.id}/setup`);
    expect(await screen.findByRole("button", { name: "Delete person" })).toBeInTheDocument();
    full.unmount();

    const limited: HubValue = { ...rbaAdmin, profile: { ...alex, view_all_divisions: false, view_division_ids: alex.division_ids } };
    renderPerson(limited, `/people/${harper.id}/setup`);
    expect(await screen.findByRole("button", { name: "Deactivate Harper Quinn" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete person" })).not.toBeInTheDocument();
  });

  it("offers it nobody on someone ranked above them", async () => {
    renderPerson(kingdomAdmin, `/people/${marcus.id}/setup`);
    expect(await screen.findByText("Only an owner or Rococo can deactivate or remove this person.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete person" })).not.toBeInTheDocument();
  });
});

describe("the delete dialog", () => {
  it("says what goes, offers Deactivate, and holds its button until the exact name is typed", async () => {
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${jamie.id}/setup`);
    const dialog = await openDelete(user);
    expect(dialog).toHaveTextContent(
      "This deletes Jamie Fox and everything on their profile: reviews and scores, GSRs, goals, notes, KPIs and compensation. Tasks they assigned or completed stay, without their name. Their sign-in is removed and their address can only come back with a new invitation. This cannot be undone.",
    );
    expect(dialog).toHaveTextContent(/On their profile now: \d+ reviews?, \d+ GSRs? and \d+ goals?\./);
    expect(dialog).toHaveTextContent("To keep their history, deactivate them instead.");
    expect(within(dialog).getByRole("button", { name: "Deactivate" })).toBeEnabled();

    const confirm = within(dialog).getByRole("button", { name: "Delete Jamie for good" });
    const field = within(dialog).getByLabelText("Type Jamie Fox to confirm");
    expect(confirm).toBeDisabled();
    await user.type(field, "jamie fox");
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, "Jamie Fo");
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, "  Jamie Fox ");
    expect(confirm).toBeEnabled();
  });

  it("deletes the person and lands on People with a line saying who went", async () => {
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${noor.id}/setup`);
    const dialog = await openDelete(user);
    await user.type(within(dialog).getByLabelText("Type Noor Haddad to confirm"), "Noor Haddad");
    await user.click(within(dialog).getByRole("button", { name: "Delete Noor for good" }));
    expect(await screen.findByText("Noor Haddad was deleted.")).toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(RBA.company.id)).some((p) => p.id === noor.id)).toBe(false);
    expect(await gsrService.listEmployeeReviews(RBA.company.id, noor.id)).toEqual([]);
    expect(await gsrService.listGoals(RBA.company.id, noor.id)).toEqual([]);
  });

  it("keeps a refusal in the dialog, in the database's words", async () => {
    const refused = vi.spyOn(profilesService, "deletePerson").mockRejectedValueOnce(new Error("This is the company's only owner. Make someone else an owner first."));
    onTestFinished(() => refused.mockRestore());
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${jamie.id}/setup`);
    const dialog = await openDelete(user);
    await user.type(within(dialog).getByLabelText("Type Jamie Fox to confirm"), "Jamie Fox");
    await user.click(within(dialog).getByRole("button", { name: "Delete Jamie for good" }));
    expect(await within(dialog).findByText("This is the company's only owner. Make someone else an owner first.")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(RBA.company.id)).some((p) => p.id === jamie.id)).toBe(true);
  });
});

describe("Remove for someone who never signed in", () => {
  it("asks for their name typed when the page has loaded goals for them", async () => {
    await gsrService.createGoal({ company_id: KLASIK.company.id, employee_id: taylor.id, title: "Learn the estimating tool", kind: "professional", scope: "year", year: 2026 });
    const user = userEvent.setup();
    renderPerson(klasikAdmin, `/people/${taylor.id}/setup`);
    await user.click(await screen.findByRole("button", { name: "Remove Taylor Reed" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(/On their profile now: 0 reviews, 0 GSRs and 1 goal\. This cannot be undone\./);
    const confirm = within(dialog).getByRole("button", { name: "Remove Taylor for good" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText("Type Taylor Reed to confirm"), "taylor reed");
    expect(confirm).toBeDisabled();
    await user.clear(within(dialog).getByLabelText("Type Taylor Reed to confirm"));
    await user.type(within(dialog).getByLabelText("Type Taylor Reed to confirm"), "Taylor Reed");
    await user.click(confirm);
    expect(await screen.findByRole("heading", { name: "People" })).toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(KLASIK.company.id)).some((p) => p.id === taylor.id)).toBe(false);
    expect(await gsrService.listGoals(KLASIK.company.id, taylor.id)).toEqual([]);
  });

  it("is one click, without Delete person, when nothing is on their profile", async () => {
    const user = userEvent.setup();
    renderPerson(rbaAdmin, `/people/${kai.id}/setup`);
    await user.click(await screen.findByRole("button", { name: "Remove Kai Bennett" }));
    expect(screen.queryByRole("button", { name: "Delete person" })).not.toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Remove Kai Bennett from the team?");
    expect(within(dialog).queryByLabelText(/to confirm/)).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Remove" })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await screen.findByRole("heading", { name: "People" })).toBeInTheDocument();
    expect(screen.queryByText(/was deleted\./)).not.toBeInTheDocument();
    expect((await profilesService.listCompanyProfiles(RBA.company.id)).some((p) => p.id === kai.id)).toBe(false);
  });
});
