// The Access dialog the People roster opens for one person: its title and status line, the
// invitation controls the roster rows used to carry (Send invite, Copy link, Email again, Cancel
// invitation) with the same words and outcomes, and the Account controls under them. The Send
// invite and Email again cases mirror invite-emails.test.tsx against the dialog itself, and a small
// stateful harness stands in for the roster, so a created or cancelled invitation comes back into
// the dialog the way the page will hand it back. The person's history (reviews, GSRs, goals) is read
// by the dialog itself, so Remove keeps its typed-name safeguard here as on Setup, and keeps it when
// that read fails. Nothing here touches the network.
import { useState } from "react";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/supabase.ts", () => import("../../test/mocks/supabase.ts"));
vi.mock("../../services/auth.ts", () => import("../../test/mocks/auth.ts"));
vi.mock("../../services/profiles.ts", () => import("../../test/mocks/profiles.ts"));
vi.mock("../../services/companies.ts", () => import("../../test/mocks/companies.ts"));
vi.mock("../../services/invitations.ts", () => import("../../test/mocks/invitations.ts"));
vi.mock("../../services/gsr.ts", () => import("../../test/mocks/gsr.ts"));
vi.mock("../../services/gsrOnDemand.ts", () => import("../../test/mocks/gsrOnDemand.ts"));
vi.mock("../../services/capabilities.ts", () => import("../../test/mocks/capabilities.ts"));
vi.mock("../../services/directory.ts", () => import("../../test/mocks/directory.ts"));

import { RBA, makeHub } from "../../test/fixtures.ts";
import { renderWithHub } from "../../test/renderWithHub.tsx";
import { deleteInvitation, invitationEmailCalls, listInvitations, setMockInvitationEmail } from "../../test/mocks/invitations.ts";
import * as invitationsService from "../../services/invitations.ts";
import * as profilesService from "../../services/profiles.ts";
import * as gsrService from "../../services/gsr.ts";
import { createGoal, deleteGoal } from "../../test/mocks/gsr.ts";
import type { Invitation, Profile } from "../../types/database.ts";
import type { AccessGone } from "./person/PersonAccountActions.tsx";
import PersonAccessDialog from "./PersonAccessDialog.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const kai = byName("Kai Bennett");
const avery = byName("Avery Cole");
const jamie = byName("Jamie Fox");
const averyInvitation = RBA.invitations.find((i) => i.profile_id === avery.id && !i.accepted_at)!;
const kaiLink = `http://localhost/?email=${encodeURIComponent(kai.email)}&company=rba`;

const pendingFor = async (email: string) => (await listInvitations(RBA.company.id)).filter((i) => i.email === email && !i.accepted_at);

// The invitations mock keeps its rows for the whole file, so the one a test creates for Kai is
// cleared again and the next test starts with Kai not invited.
afterEach(async () => {
  for (const invitation of await pendingFor(kai.email)) await deleteInvitation(invitation.id);
});

// The roster's part, in miniature: it holds the person and their pending invitation and hands every
// change back to the dialog, as the page does with its loaded rows.
function Harness({
  person: initialPerson,
  invitation: initialInvitation = null,
  canInvite = true,
  onInvitationCancelled = () => undefined,
  onPatched = () => undefined,
  onGone = () => undefined,
  onClose = () => undefined,
}: {
  person: Profile;
  invitation?: Invitation | null;
  canInvite?: boolean;
  onInvitationCancelled?: (id: string) => void;
  onPatched?: (next: Profile) => void;
  onGone?: (gone: AccessGone) => void;
  onClose?: () => void;
}) {
  const [person, setPerson] = useState(initialPerson);
  const [invitation, setInvitation] = useState(initialInvitation);
  return (
    <PersonAccessDialog
      companyId={RBA.company.id}
      companySlug={RBA.company.slug}
      person={person}
      invitation={invitation}
      canInvite={canInvite && person.is_active}
      onInvitationCreated={setInvitation}
      onInvitationCancelled={(id) => {
        setInvitation(null);
        onInvitationCancelled(id);
      }}
      onPatched={(next) => {
        setPerson(next);
        onPatched(next);
      }}
      onGone={onGone}
      onClose={onClose}
    />
  );
}

const accessDialog = () => screen.getByRole("dialog", { name: /^Access for / });

describe("PersonAccessDialog", () => {
  it("titles itself for the person and links to their profile", async () => {
    renderWithHub(<Harness person={kai} />, rbaAdmin);
    expect(await screen.findByRole("heading", { name: "Access for Kai Bennett" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open profile" })).toHaveAttribute("href", `/people/${kai.id}`);
  });

  it("says an active person signs in with their address", async () => {
    renderWithHub(<Harness person={jamie} />, rbaAdmin);
    expect(await screen.findByText(`Active. They sign in as ${jamie.email}.`)).toBeInTheDocument();
  });

  it("says an invited person has not signed in yet", async () => {
    renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
    expect(await screen.findByText("Invited. Waiting for them to sign in.")).toBeInTheDocument();
  });

  it("says a person with no account and no invitation is not invited yet", async () => {
    renderWithHub(<Harness person={kai} />, rbaAdmin);
    expect(await screen.findByText("Not invited yet.")).toBeInTheDocument();
  });

  it("says an inactive person cannot sign in", async () => {
    renderWithHub(<Harness person={{ ...jamie, is_active: false }} />, rbaAdmin);
    expect(await screen.findByText("Inactive. They cannot sign in, and their record is kept.")).toBeInTheDocument();
  });

  it("offers no Send invite when the viewer may not invite them", async () => {
    renderWithHub(<Harness person={kai} canInvite={false} />, rbaAdmin);
    await screen.findByRole("heading", { name: "Access for Kai Bennett" });
    expect(screen.queryByRole("button", { name: "Send the invitation to Kai Bennett" })).not.toBeInTheDocument();
  });

  it("closes on Done", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithHub(<Harness person={kai} onClose={onClose} />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves Deactivate through the profile and hands the new row back", async () => {
    const onPatched = vi.fn();
    const user = userEvent.setup();
    renderWithHub(<Harness person={jamie} onPatched={onPatched} />, rbaAdmin);
    try {
      await user.click(await screen.findByRole("button", { name: "Deactivate Jamie Fox" }));
      await vi.waitFor(() => expect(onPatched).toHaveBeenCalledWith(expect.objectContaining({ id: jamie.id, is_active: false })));
      expect(await screen.findByText("Inactive. They cannot sign in, and their record is kept.")).toBeInTheDocument();
    } finally {
      await profilesService.updateProfile(jamie.id, { is_active: true });
    }
  });

  it("shows a Deactivate that did not save in the dialog", async () => {
    const spy = vi.spyOn(profilesService, "updateProfile").mockRejectedValueOnce(new Error("The change did not save."));
    try {
      const onPatched = vi.fn();
      const user = userEvent.setup();
      renderWithHub(<Harness person={jamie} onPatched={onPatched} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Deactivate Jamie Fox" }));
      expect(await within(accessDialog()).findByText("The change did not save.")).toBeInTheDocument();
      expect(onPatched).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("gives a Rococo admin no Account controls and reads none of their history", async () => {
    const reviews = vi.spyOn(gsrService, "listEmployeeReviews");
    const goals = vi.spyOn(gsrService, "listGoals");
    try {
      renderWithHub(<Harness person={{ ...jamie, is_rococo_admin: true }} />, rbaAdmin);
      expect(await screen.findByText(`Active. They sign in as ${jamie.email}.`)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Open profile" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^(Deactivate|Reactivate) / })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Delete person" })).not.toBeInTheDocument();
      expect(reviews).not.toHaveBeenCalled();
      expect(goals).not.toHaveBeenCalled();
    } finally {
      reviews.mockRestore();
      goals.mockRestore();
    }
  });
});

describe("History and Remove", () => {
  it("reads no history for someone the viewer may not change, or for themselves", async () => {
    // An owner set up on the roster, ranked above the admin viewing: no Remove or Delete for them.
    const owner: Profile = { ...kai, id: "rba-roster-owner", email: "pat.owner@rbaconstruction.com", full_name: "Pat Owner", role: "owner" };
    const reviews = vi.spyOn(gsrService, "listEmployeeReviews");
    const goals = vi.spyOn(gsrService, "listGoals");
    try {
      const first = renderWithHub(<Harness person={owner} />, rbaAdmin);
      expect(await screen.findByText("Only an owner or Rococo can deactivate or remove this person.")).toBeInTheDocument();
      first.unmount();
      renderWithHub(<Harness person={rbaAdmin.profile} />, rbaAdmin);
      expect(await screen.findByText("This is you. Another admin deactivates your account if it comes to that.")).toBeInTheDocument();
      expect(reviews).not.toHaveBeenCalled();
      expect(goals).not.toHaveBeenCalled();
    } finally {
      reviews.mockRestore();
      goals.mockRestore();
    }
  });

  it("asks for the typed name to remove someone with history", async () => {
    const goal = await createGoal({ company_id: RBA.company.id, employee_id: kai.id, title: "Learn the estimating tool", kind: "professional" });
    try {
      const user = userEvent.setup();
      renderWithHub(<Harness person={kai} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Remove Kai Bennett" }));
      const confirm = screen.getByRole("dialog", { name: "Remove Kai Bennett from the team?" });
      expect(confirm).toHaveTextContent(/On their profile now: .*1 goal\. This cannot be undone\./);
      const go = within(confirm).getByRole("button", { name: "Remove Kai for good" });
      expect(go).toBeDisabled();
      await user.type(within(confirm).getByLabelText("Type Kai Bennett to confirm"), "Kai Bennett");
      expect(go).toBeEnabled();
    } finally {
      await deleteGoal(goal.id);
    }
  });

  it("removes someone with no history in one click", async () => {
    const remove = vi.spyOn(profilesService, "deleteStaffProfile").mockResolvedValueOnce(undefined);
    try {
      const onGone = vi.fn();
      const user = userEvent.setup();
      renderWithHub(<Harness person={kai} onGone={onGone} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Remove Kai Bennett" }));
      const confirm = screen.getByRole("dialog", { name: "Remove Kai Bennett from the team?" });
      expect(within(confirm).queryByRole("textbox")).not.toBeInTheDocument();
      await user.click(within(confirm).getByRole("button", { name: "Remove" }));
      await vi.waitFor(() => expect(onGone).toHaveBeenCalledWith({ kind: "removed", name: "Kai Bennett" }));
      expect(remove).toHaveBeenCalledWith(kai.id);
    } finally {
      remove.mockRestore();
    }
  });

  it("asks for the typed name when their history did not load", async () => {
    const goals = vi.spyOn(gsrService, "listGoals").mockRejectedValueOnce(new Error("Goals did not load."));
    try {
      const user = userEvent.setup();
      renderWithHub(<Harness person={kai} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Remove Kai Bennett" }));
      const confirm = screen.getByRole("dialog", { name: "Remove Kai Bennett from the team?" });
      expect(confirm).not.toHaveTextContent(/On their profile now/);
      expect(confirm).toHaveTextContent(/This cannot be undone\./);
      const go = within(confirm).getByRole("button", { name: "Remove Kai for good" });
      expect(go).toBeDisabled();
      await user.type(within(confirm).getByLabelText("Type Kai Bennett to confirm"), "Kai Bennett");
      expect(go).toBeEnabled();
    } finally {
      goals.mockRestore();
    }
  });

  it("says what is on their profile in the Delete person confirm", async () => {
    const user = userEvent.setup();
    renderWithHub(<Harness person={jamie} />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Delete person" }));
    const confirm = screen.getByRole("dialog", { name: "Delete Jamie Fox?" });
    expect(await within(confirm).findByText(/^On their profile now: /)).toBeInTheDocument();
  });
});

async function sendKaiInvite() {
  const user = userEvent.setup();
  renderWithHub(<Harness person={kai} />, rbaAdmin);
  await user.click(await screen.findByRole("button", { name: "Send the invitation to Kai Bennett" }));
}

describe("Send invite", () => {
  it("creates the invitation, emails it, and says so", async () => {
    await sendKaiInvite();
    expect(await screen.findByText(`Invitation emailed to ${kai.email}.`)).toBeInTheDocument();
    expect(screen.getByText("Invited. Waiting for them to sign in.")).toBeInTheDocument();
    const [created] = await pendingFor(kai.email);
    expect(created).toBeDefined();
    expect(invitationEmailCalls).toEqual([created.id]);
  });

  it("keeps the invitation and copies its link when the email fails", async () => {
    setMockInvitationEmail({ kind: "fail", message: "The email service did not accept the message." });
    await sendKaiInvite();
    expect(
      await screen.findByText(
        "The invitation is ready but the email did not go out: The email service did not accept the message. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Invited. Waiting for them to sign in.")).toBeInTheDocument();
    expect(await pendingFor(kai.email)).toHaveLength(1);
    expect(await navigator.clipboard.readText()).toBe(kaiLink);
    expect(screen.getByRole("button", { name: "Copy sign-in link for Kai Bennett" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email the invitation to Kai Bennett again" })).toBeInTheDocument();
  });

  it("shows the reason the email service gave for not sending", async () => {
    setMockInvitationEmail({ kind: "reason", reason: "They have already signed in." });
    await sendKaiInvite();
    expect(
      await screen.findByText(
        "The invitation is ready but the email did not go out: They have already signed in. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Invited. Waiting for them to sign in.")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(kaiLink);
  });
});

describe("While sending", () => {
  it("holds still: Escape does nothing, and Open profile and the Account controls are inert", async () => {
    let release: (value: { sent: boolean }) => void = () => undefined;
    const email = vi.spyOn(invitationsService, "emailInvitation").mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    try {
      const onClose = vi.fn();
      const user = userEvent.setup();
      renderWithHub(<Harness person={avery} invitation={averyInvitation} onClose={onClose} />, rbaAdmin);
      await screen.findByRole("button", { name: "Deactivate Avery Cole" });
      await user.click(screen.getByRole("button", { name: "Email the invitation to Avery Cole again" }));
      expect(await screen.findByText("Sending...")).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
      expect(screen.getByText("Open profile").closest("[inert]")).not.toBeNull();
      expect(screen.getByText("Deactivating keeps them out of the hub and keeps everything set up for them on record.").closest("[inert]")).not.toBeNull();
      release({ sent: true });
      expect(await screen.findByText(`Invitation emailed to ${averyInvitation.email}.`)).toBeInTheDocument();
      expect(screen.getByText("Open profile").closest("[inert]")).toBeNull();
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      email.mockRestore();
    }
  });

  it("moves focus to the title once Send invite has made the invitation", async () => {
    await sendKaiInvite();
    expect(await screen.findByText(`Invitation emailed to ${kai.email}.`)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Access for Kai Bennett" })).toHaveFocus();
  });
});

describe("Email again", () => {
  it("emails a waiting invitation made earlier and says so", async () => {
    const user = userEvent.setup();
    renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(await screen.findByText(`Invitation emailed to ${averyInvitation.email}.`)).toBeInTheDocument();
    expect(invitationEmailCalls).toEqual([averyInvitation.id]);
  });

  it("shows the failure line when the email does not go", async () => {
    setMockInvitationEmail({ kind: "fail", message: "Emails are not set up yet." });
    const user = userEvent.setup();
    renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(
      await screen.findByText("The invitation is ready but the email did not go out: Emails are not set up yet. Its link is copied, so you can send it yourself."),
    ).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`http://localhost/?email=${encodeURIComponent(averyInvitation.email)}&company=rba`);
  });

  it("is paced: a second press within 10 minutes says so, and the invitation stands", async () => {
    const user = userEvent.setup();
    renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(await screen.findByText(`Invitation emailed to ${averyInvitation.email}.`)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(
      await screen.findByText(
        "The invitation is ready but the email did not go out: An invitation email went to them in the last 10 minutes. Try again later. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Invited. Waiting for them to sign in.")).toBeInTheDocument();
    expect(await pendingFor(averyInvitation.email)).toHaveLength(1);
    expect(invitationEmailCalls).toEqual([averyInvitation.id, averyInvitation.id]);
  });

  it("is offered with Copy link, and not before there is an invitation", async () => {
    const view = renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
    expect(await screen.findByRole("button", { name: "Copy sign-in link for Avery Cole" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email the invitation to Avery Cole again" })).toBeInTheDocument();
    view.unmount();
    renderWithHub(<Harness person={kai} />, rbaAdmin);
    await screen.findByRole("button", { name: "Send the invitation to Kai Bennett" });
    expect(screen.queryByRole("button", { name: "Copy sign-in link for Kai Bennett" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Email the invitation to Kai Bennett again" })).not.toBeInTheDocument();
  });
});

describe("Cancel invitation", () => {
  it("cancels an invitation and then offers Remove in the same dialog", async () => {
    const created = await invitationsService.createInvitation({ company_id: RBA.company.id, email: kai.email, role: kai.role, profile_id: kai.id });
    const onInvitationCancelled = vi.fn();
    const user = userEvent.setup();
    renderWithHub(<Harness person={kai} invitation={created} onInvitationCancelled={onInvitationCancelled} />, rbaAdmin);
    expect(await screen.findByText(/Cancel their invitation above first, then remove them\./)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel invitation for Kai Bennett" }));
    const confirm = screen.getByRole("dialog", { name: "Cancel the invitation for Kai Bennett?" });
    expect(confirm).toHaveTextContent(/sign-in domains/);
    await user.click(within(confirm).getByRole("button", { name: "Cancel invitation" }));
    await vi.waitFor(() => expect(onInvitationCancelled).toHaveBeenCalledWith(created.id));
    expect(screen.queryByRole("dialog", { name: "Cancel the invitation for Kai Bennett?" })).not.toBeInTheDocument();
    expect(await within(accessDialog()).findByRole("button", { name: "Remove Kai Bennett" })).toBeInTheDocument();
    expect(screen.getByText("Not invited yet.")).toBeInTheDocument();
  });

  it("keeps the confirm open on a cancel that failed, with its own reason", async () => {
    const spy = vi.spyOn(invitationsService, "deleteInvitation").mockRejectedValueOnce(new Error("The invitation could not be cancelled."));
    try {
      const onInvitationCancelled = vi.fn();
      const user = userEvent.setup();
      renderWithHub(<Harness person={avery} invitation={averyInvitation} onInvitationCancelled={onInvitationCancelled} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Cancel invitation for Avery Cole" }));
      const confirm = screen.getByRole("dialog", { name: "Cancel the invitation for Avery Cole?" });
      await user.click(within(confirm).getByRole("button", { name: "Cancel invitation" }));
      expect(await within(confirm).findByText("The invitation could not be cancelled.")).toBeInTheDocument();
      expect(onInvitationCancelled).not.toHaveBeenCalled();
      await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Cancel invitation for Avery Cole" }));
      expect(within(screen.getByRole("dialog", { name: "Cancel the invitation for Avery Cole?" })).queryByText("The invitation could not be cancelled.")).not.toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("moves focus to the title after a cancel, not out of the dialog", async () => {
    // The delete is answered without touching the fixture row, so later tests still find it waiting.
    const cancel = vi.spyOn(invitationsService, "deleteInvitation").mockResolvedValueOnce(undefined);
    try {
      const user = userEvent.setup();
      renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Cancel invitation for Avery Cole" }));
      await user.click(within(screen.getByRole("dialog", { name: "Cancel the invitation for Avery Cole?" })).getByRole("button", { name: "Cancel invitation" }));
      await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Cancel the invitation for Avery Cole?" })).not.toBeInTheDocument());
      expect(screen.getByRole("heading", { name: "Access for Avery Cole" })).toHaveFocus();
    } finally {
      cancel.mockRestore();
    }
  });

  it("clears a copy that failed once Copy link works", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Blocked."));
    try {
      renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
      const copy = await screen.findByRole("button", { name: "Copy sign-in link for Avery Cole" });
      await user.click(copy);
      expect(await screen.findByText(/^Could not copy\. The link is: /)).toBeInTheDocument();
      await user.click(copy);
      await vi.waitFor(() => expect(copy).toHaveTextContent("Copied"));
      expect(screen.queryByText(/^Could not copy/)).not.toBeInTheDocument();
    } finally {
      write.mockRestore();
    }
  });

  it("clears a copy that failed once Email again runs", async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("Blocked."));
    try {
      renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
      await user.click(await screen.findByRole("button", { name: "Copy sign-in link for Avery Cole" }));
      expect(await screen.findByText(/^Could not copy\. The link is: /)).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Email the invitation to Avery Cole again" }));
      // Emailed, or paced and copied instead: either way the old copy failure is not left beside it.
      expect(await screen.findByText(/^(Invitation emailed to|The invitation is ready but)/)).toBeInTheDocument();
      expect(screen.queryByText(/^Could not copy/)).not.toBeInTheDocument();
    } finally {
      write.mockRestore();
    }
  });

  it("keeps Copied up for its full beat after a second copy", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderWithHub(<Harness person={avery} invitation={averyInvitation} />, rbaAdmin);
      const copy = await screen.findByRole("button", { name: "Copy sign-in link for Avery Cole" });
      await user.click(copy);
      await vi.waitFor(() => expect(copy).toHaveTextContent("Copied"));
      act(() => void vi.advanceTimersByTime(1000));
      await user.click(copy);
      // Past the first copy's beat: its timer is cleared, so the second one's still holds.
      act(() => void vi.advanceTimersByTime(1000));
      expect(copy).toHaveTextContent("Copied");
      act(() => void vi.advanceTimersByTime(700));
      expect(copy).toHaveTextContent("Copy link");
    } finally {
      vi.useRealTimers();
    }
  });

  it("Escape on the cancel confirm closes only the confirm", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderWithHub(<Harness person={avery} invitation={averyInvitation} onClose={onClose} />, rbaAdmin);
    await user.click(await screen.findByRole("button", { name: "Cancel invitation for Avery Cole" }));
    expect(screen.getByRole("dialog", { name: "Cancel the invitation for Avery Cole?" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Cancel the invitation for Avery Cole?" })).not.toBeInTheDocument();
    expect(accessDialog()).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(await pendingFor(averyInvitation.email)).toHaveLength(1);
  });
});
