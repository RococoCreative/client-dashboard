// The People tab and the access core in the app (0038): what an admin and a manager each see on the
// roster, the division chips (one division, Both, No division), the search and the inactive
// switch, adding someone already placed, a refused removal, the LeadOnly gate, names read from the
// directory where profiles are narrowed, and the "in your divisions" labels for a viewer who sees
// only some divisions. The mocks stand in for RLS by narrowing listCompanyProfiles where a test
// needs the list a manager or an employee would get.
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { renderWithHub } from "../test/renderWithHub.tsx";
import * as profilesService from "../services/profiles.ts";
import * as invitationsService from "../services/invitations.ts";
import { KINGDOM, RBA, makeHub } from "../test/fixtures.ts";
import type { HubValue } from "../context/HubContext.tsx";
import { LeadOnly } from "../App.tsx";
import AttentionCard from "../components/home/AttentionCard.tsx";
import DivisionsPanel from "../components/settings/DivisionsPanel.tsx";
import DashboardPage from "./DashboardPage.tsx";
import PeoplePage from "./people/PeoplePage.tsx";
import ProjectPage from "./production/ProjectPage.tsx";
import ScorecardsPage from "./gsr/ScorecardsPage.tsx";
import TaskPage from "./tasks/TaskPage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const rbaManager = makeHub("manager", RBA.company);
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const harper = byName("Harper Quinn");
const rowan = byName("Rowan Ellis");
const kai = byName("Kai Bennett");
const jamie = byName("Jamie Fox");

// A viewer an owner has limited to RBA North, who may see the division split.
const northOnly: HubValue = {
  ...rbaAdmin,
  profile: { ...rbaAdmin.profile, can_view_divisions: true, view_all_divisions: false, view_division_ids: ["rba-division-north"] },
};

// The row of the person named, by their name in the Person column (the same name can also be
// someone's Reports to).
function rowOf(name: string): HTMLElement {
  return screen.getByText(name, { selector: "span" }).closest("tr") as HTMLElement;
}

// What listCompanyProfiles returns under RLS for a viewer who sees only these people.
function onlySees(ids: string[]) {
  const original = profilesService.listCompanyProfiles;
  const spy = vi.spyOn(profilesService, "listCompanyProfiles").mockImplementation(async (companyId) => (await original(companyId)).filter((p) => ids.includes(p.id)));
  onTestFinished(() => spy.mockRestore());
}

describe("the fixtures behind these tests", () => {
  it("give RBA a manager with a two-level chain and someone in both divisions", () => {
    expect(rbaManager.profile.id).toBe(harper.id);
    expect(rbaManager.isLead).toBe(true);
    expect(rbaManager.isAdmin).toBe(false);
    expect(rowan.reports_to).toBe(harper.id);
    expect(kai.reports_to).toBe(rowan.id);
    expect(rowan.division_ids).toEqual(["rba-division-south", "rba-division-north"]);
    expect(makeHub("employee", RBA.company).isLead).toBe(false);
  });
});

describe("People tab for an admin", () => {
  it("shows each person's division, who they report to, their role and their status", async () => {
    renderWithHub(<PeoplePage />, rbaAdmin);
    expect(await screen.findByText("Alex Morgan (you)")).toBeInTheDocument();
    for (const header of ["Person", "Division", "Reports to", "Role", "Status"]) {
      expect(screen.getByRole("columnheader", { name: header })).toBeInTheDocument();
    }
    expect(within(rowOf("Rowan Ellis")).getByText("Both")).toBeInTheDocument();
    expect(within(rowOf("Rowan Ellis")).getByRole("link", { name: "Harper Quinn" })).toHaveAttribute("href", `/people/${harper.id}`);
    expect(within(rowOf("Kai Bennett")).getByText("RBA North")).toBeInTheDocument();
    expect(within(rowOf("Kai Bennett")).getByText("Not invited")).toBeInTheDocument();
    expect(within(rowOf("Alex Morgan (you)")).getByText("Nobody")).toBeInTheDocument();
    expect(within(rowOf("Kai Bennett")).getByRole("combobox", { name: "Role for Kai Bennett" })).toBeInTheDocument();
  });

  it("narrows to one division, to Both, and to No division", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, rbaAdmin);
    const chips = await screen.findByRole("group", { name: "Division" });
    await user.click(within(chips).getByRole("button", { name: "RBA North" }));
    expect(screen.getByText("Noor Haddad")).toBeInTheDocument();
    expect(screen.getByText("Rowan Ellis", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Kai Bennett", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Jamie Fox")).not.toBeInTheDocument();

    await user.click(within(chips).getByRole("button", { name: "Both" }));
    expect(screen.getByText("Rowan Ellis", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Noor Haddad")).not.toBeInTheDocument();

    await user.click(within(chips).getByRole("button", { name: "No division" }));
    expect(screen.getByText("Everyone here is placed in a division.")).toBeInTheDocument();

    await user.click(within(chips).getByRole("button", { name: "All" }));
    expect(screen.getByText("Jamie Fox")).toBeInTheDocument();
  });

  it("searches names, titles and email addresses, and says why nothing matched", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, rbaAdmin);
    const search = await screen.findByRole("searchbox", { name: "Search people" });
    await user.type(search, "carpenter");
    expect(screen.getByText("Kai Bennett", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Avery Cole")).toBeInTheDocument();
    expect(screen.queryByText("Jamie Fox")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "harper.quinn@");
    expect(screen.getByText("Harper Quinn", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByText("Noor Haddad")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "zzz");
    expect(screen.getByText('No one matches "zzz".')).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Division" })).getByRole("button", { name: "RBA South" }));
    expect(screen.getByText('No one in RBA South matches "zzz".')).toBeInTheDocument();
  });

  it("hides inactive people until asked, and says how many there are", async () => {
    const user = userEvent.setup();
    await profilesService.updateProfile(jamie.id, { is_active: false });
    onTestFinished(async () => {
      await profilesService.updateProfile(jamie.id, { is_active: true });
    });
    renderWithHub(<PeoplePage />, rbaAdmin);
    expect(await screen.findByText("Alex Morgan (you)")).toBeInTheDocument();
    expect(screen.queryByText("Jamie Fox")).not.toBeInTheDocument();
    const toggle = screen.getByRole("checkbox", { name: /Show inactive/ });
    expect(toggle).not.toBeChecked();
    expect(toggle.closest("label")).toHaveTextContent(/Show inactive\s*\(1\)/);

    await user.type(screen.getByRole("searchbox", { name: "Search people" }), "jamie");
    expect(screen.getByText('No one matches "jamie".')).toBeInTheDocument();
    expect(screen.getByText(/1 inactive person matches/)).toBeInTheDocument();

    await user.click(toggle);
    expect(within(rowOf("Jamie Fox")).getByText("Inactive")).toBeInTheDocument();
  });

  it("keeps someone just deactivated on screen so it can be undone", async () => {
    const user = userEvent.setup();
    onTestFinished(async () => {
      await profilesService.updateProfile(kai.id, { is_active: true });
    });
    renderWithHub(<PeoplePage />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Deactivate Kai Bennett" }));
    expect(await screen.findByRole("button", { name: "Reactivate Kai Bennett" })).toBeInTheDocument();
    expect(within(rowOf("Kai Bennett")).getByText("Inactive")).toBeInTheDocument();
  });

  it("adds someone already placed in a division and under a manager, and flags someone with none", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: /Add staff/ }));
    await user.type(screen.getByLabelText("Name"), "Sky Morrow");
    await user.type(screen.getByLabelText("Email"), "sky.morrow@rbaprojects.com");
    await user.click(screen.getByRole("checkbox", { name: "RBA North" }));
    const reportsTo = screen.getByLabelText("Reports to (optional)");
    await user.selectOptions(reportsTo, jamie.id);
    expect(screen.getByText("Jamie Fox is an employee, so they will not see this person until they are a manager.")).toBeInTheDocument();
    await user.selectOptions(reportsTo, harper.id);
    expect(screen.queryByText(/is an employee, so they will not see/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add to team" }));
    expect(await screen.findByText("Sky Morrow")).toBeInTheDocument();
    expect(within(rowOf("Sky Morrow")).getByText("RBA North")).toBeInTheDocument();
    expect(within(rowOf("Sky Morrow")).getByText("Harper Quinn")).toBeInTheDocument();
    const saved = (await profilesService.listCompanyProfiles(RBA.company.id)).find((p) => p.full_name === "Sky Morrow")!;
    expect(saved).toMatchObject({ division_ids: ["rba-division-north"], division_id: "rba-division-north", reports_to: harper.id });

    await user.click(screen.getByRole("button", { name: /Add staff/ }));
    await user.type(screen.getByLabelText("Name"), "Lee Unplaced");
    await user.type(screen.getByLabelText("Email"), "lee.unplaced@rbaprojects.com");
    await user.click(screen.getByRole("button", { name: "Add to team" }));
    expect(await screen.findByText("Lee Unplaced")).toBeInTheDocument();
    expect(within(rowOf("Lee Unplaced")).getByText("No division")).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Division" })).getByRole("button", { name: "No division" }));
    expect(screen.getByText("Lee Unplaced")).toBeInTheDocument();
    expect(screen.queryByText("Sky Morrow")).not.toBeInTheDocument();
  });

  it("keeps a removal the database refused on screen, with the reason", async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(profilesService, "deleteStaffProfile").mockRejectedValueOnce(new Error("That person was not removed. They may have signed in, or they are not yours to remove."));
    onTestFinished(() => spy.mockRestore());
    renderWithHub(<PeoplePage />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Remove Kai Bennett" }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));
    expect(await within(dialog).findByText(/That person was not removed/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Kai Bennett", { selector: "span" })).toBeInTheDocument();
  });
});

describe("People tab for a manager", () => {
  it("reads as Your team, with no admin controls and no invitations", async () => {
    onlySees([harper.id, rowan.id, kai.id]);
    const invitations = vi.spyOn(invitationsService, "listInvitations");
    onTestFinished(() => invitations.mockRestore());
    renderWithHub(<PeoplePage />, rbaManager);
    expect(await screen.findByRole("heading", { name: "Your team" })).toBeInTheDocument();
    expect(await screen.findByText("Rowan Ellis", { selector: "span" })).toBeInTheDocument();
    // Their own row is not part of their team.
    expect(screen.queryByText("Harper Quinn (you)")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add staff/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deactivate|Remove|Send the invitation/ })).not.toBeInTheDocument();
    expect(within(rowOf("Rowan Ellis")).getByText("Employee")).toBeInTheDocument();
    expect(within(rowOf("Rowan Ellis")).getByText("Harper Quinn")).toBeInTheDocument();
    expect(within(rowOf("Kai Bennett")).getByText("Not signed in yet")).toBeInTheDocument();
    expect(screen.queryByText("Not invited")).not.toBeInTheDocument();
    expect(screen.queryByText("Invited")).not.toBeInTheDocument();
    expect(invitations).not.toHaveBeenCalled();
  });

  it("says how a team fills when nobody reports to them yet", async () => {
    onlySees([harper.id]);
    renderWithHub(<PeoplePage />, rbaManager);
    expect(await screen.findByText("No one reports to you yet. An admin sets Reports to on each person.")).toBeInTheDocument();
  });
});

describe("LeadOnly", () => {
  const gate = (hub: HubValue) => renderWithHub(<LeadOnly><p>Team page</p></LeadOnly>, hub, { path: "/people", pattern: "/people" });

  it("lets a manager and an admin in, and sends an employee Home", () => {
    const manager = gate(rbaManager);
    expect(screen.getByText("Team page")).toBeInTheDocument();
    manager.unmount();
    const admin = gate(rbaAdmin);
    expect(screen.getByText("Team page")).toBeInTheDocument();
    admin.unmount();
    gate(makeHub("employee", RBA.company));
    expect(screen.queryByText("Team page")).not.toBeInTheDocument();
    expect(screen.getByText("elsewhere")).toBeInTheDocument();
  });
});

describe("names from the directory", () => {
  it("names who assigned an employee's task though the employee cannot see that person", async () => {
    onlySees([jamie.id]);
    renderWithHub(<TaskPage />, makeHub("employee", RBA.company), { path: "/tasks/rba-task-1", pattern: "/tasks/:taskId" });
    expect(await screen.findByRole("heading", { name: "Close out the September punch list" })).toBeInTheDocument();
    expect(screen.getByText("Assigned by").nextElementSibling).toHaveTextContent("Alex Morgan");
    expect(screen.getByText("Assignee").nextElementSibling).toHaveTextContent("Jamie Fox");
  });

  it("names a milestone's owner for a member who cannot see them", async () => {
    const dana = KINGDOM.profiles[1];
    onlySees([dana.id]);
    renderWithHub(<ProjectPage />, makeHub("employee", KINGDOM.company), { path: "/production/projects/kingdom-project-1", pattern: "/production/projects/:projectId" });
    expect(await screen.findByText("Contract signed")).toBeInTheDocument();
    expect(screen.getByText("Contract signed").closest("li")).toHaveTextContent("Marcus Lee");
  });
});

describe("a viewer who sees only some divisions", () => {
  it("gets chips for their divisions only, and reads the whole as theirs on Home", async () => {
    renderWithHub(<DashboardPage />, northOnly);
    const chips = await screen.findByRole("group", { name: "Division" });
    expect(within(chips).getByRole("button", { name: "In your divisions" })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: "RBA North" })).toBeInTheDocument();
    expect(within(chips).queryByRole("button", { name: "RBA South" })).not.toBeInTheDocument();
    expect(screen.getByText("People in your divisions")).toBeInTheDocument();
  });

  it("gets the same on Scorecards", async () => {
    renderWithHub(<ScorecardsPage />, northOnly);
    const chips = await screen.findByRole("group", { name: "Division" });
    expect(within(chips).getByRole("button", { name: "In your divisions" })).toBeInTheDocument();
    expect(within(chips).queryByRole("button", { name: "RBA South" })).not.toBeInTheDocument();
    expect(screen.getByText(/for the people in your divisions/)).toBeInTheDocument();
  });

  it("reads the divisions in Settings without changing them", async () => {
    renderWithHub(<DivisionsPanel companyId={RBA.company.id} />, northOnly);
    expect(await screen.findByText("RBA South")).toBeInTheDocument();
    expect(screen.getByText(/only an owner, Rococo, or an admin who sees every division/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove|Add division/ })).not.toBeInTheDocument();
  });

  it("says the not-signed-in count covers their divisions", async () => {
    const kingdomAdmin = makeHub("admin", KINGDOM.company);
    const limited: HubValue = { ...kingdomAdmin, profile: { ...kingdomAdmin.profile, view_all_divisions: false } };
    renderWithHub(<AttentionCard company={KINGDOM.company} />, limited);
    expect(await screen.findByText("People not signed in, in your divisions")).toBeInTheDocument();
  });

  it("leaves a full-scope admin's labels as they were", async () => {
    renderWithHub(<DivisionsPanel companyId={RBA.company.id} />, rbaAdmin);
    expect(await screen.findByLabelText("Division name RBA South")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Remove RBA South" })).toBeInTheDocument());
  });
});
