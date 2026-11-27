// Send invite emails the invitation through the notify function, and a waiting invitation can be
// emailed again. Both live in the Access dialog a roster row opens, so these go through the row's
// Access button the way an admin does, and pin the four outcomes an admin can meet there: the email
// went, the email failed (the invitation still stands and its link is copied), the function declined
// with a reason, and Email again on an invitation made earlier, including a second press inside the
// 10 minute pause. The row behind the dialog reads Invited as soon as the invitation exists. They also
// pin that Email again is offered exactly where Copy link is: for each row's Access, both or neither.
// The email itself is the mock's: nothing here touches the network.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
vi.mock("../services/gsr.ts", () => import("../test/mocks/gsr.ts"));
vi.mock("../services/gsrOnDemand.ts", () => import("../test/mocks/gsrOnDemand.ts"));
vi.mock("../services/divisions.ts", () => import("../test/mocks/divisions.ts"));
vi.mock("../services/directory.ts", () => import("../test/mocks/directory.ts"));
vi.mock("../services/capabilities.ts", () => import("../test/mocks/capabilities.ts"));

import { renderWithHub } from "../test/renderWithHub.tsx";
import { RBA, makeHub } from "../test/fixtures.ts";
import { deleteInvitation, invitationEmailCalls, listInvitations, setMockInvitationEmail } from "../test/mocks/invitations.ts";
import PeoplePage from "./people/PeoplePage.tsx";

const rbaAdmin = makeHub("admin", RBA.company);
const kai = RBA.profiles.find((p) => p.full_name === "Kai Bennett")!;
const avery = RBA.profiles.find((p) => p.full_name === "Avery Cole")!;
const averyInvitation = RBA.invitations.find((i) => i.profile_id === avery.id && !i.accepted_at)!;
const kaiLink = `http://localhost/?email=${encodeURIComponent(kai.email)}&company=rba`;

type User = ReturnType<typeof userEvent.setup>;

const rowOf = async (name: string) => (await screen.findByText(name, { selector: "span" })).closest("tr") as HTMLElement;
const pendingFor = async (email: string) => (await listInvitations(RBA.company.id)).filter((i) => i.email === email && !i.accepted_at);

// The row's one Access button, and the dialog it opens for that person.
async function openAccess(user: User, name: string): Promise<HTMLElement> {
  await user.click(await screen.findByRole("button", { name: `Access for ${name}` }));
  return screen.getByRole("dialog", { name: `Access for ${name}` });
}

// The invitations mock keeps its rows for the whole file, so the one a test creates for Kai is
// cleared again and the next test starts with Kai not invited.
afterEach(async () => {
  for (const invitation of await pendingFor(kai.email)) await deleteInvitation(invitation.id);
});

async function sendKaiInvite() {
  const user = userEvent.setup();
  renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
  const row = await rowOf("Kai Bennett");
  const access = await openAccess(user, "Kai Bennett");
  await user.click(within(access).getByRole("button", { name: "Send the invitation to Kai Bennett" }));
  return { row, access };
}

async function openAveryAccess() {
  const user = userEvent.setup();
  renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
  const row = await rowOf("Avery Cole");
  const access = await openAccess(user, "Avery Cole");
  return { user, row, access };
}

describe("Send invite", () => {
  it("creates the invitation, emails it, and says so", async () => {
    const { row, access } = await sendKaiInvite();
    expect(await within(access).findByText(`Invitation emailed to ${kai.email}.`)).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    expect(within(access).getByText("Invited. Waiting for them to sign in.")).toBeInTheDocument();
    const [created] = await pendingFor(kai.email);
    expect(created).toBeDefined();
    expect(invitationEmailCalls).toEqual([created.id]);
  });

  it("keeps the invitation and copies its link when the email fails", async () => {
    setMockInvitationEmail({ kind: "fail", message: "The email service did not accept the message." });
    const { row, access } = await sendKaiInvite();
    expect(
      await within(access).findByText(
        "The invitation is ready but the email did not go out: The email service did not accept the message. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    expect(await pendingFor(kai.email)).toHaveLength(1);
    expect(await navigator.clipboard.readText()).toBe(kaiLink);
    expect(within(access).getByRole("button", { name: "Copy sign-in link for Kai Bennett" })).toBeInTheDocument();
    expect(within(access).getByRole("button", { name: "Email the invitation to Kai Bennett again" })).toBeInTheDocument();
  });

  it("shows the reason the email service gave for not sending", async () => {
    setMockInvitationEmail({ kind: "reason", reason: "They have already signed in." });
    const { row, access } = await sendKaiInvite();
    expect(
      await within(access).findByText(
        "The invitation is ready but the email did not go out: They have already signed in. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(kaiLink);
  });
});

describe("Email again", () => {
  it("emails a waiting invitation made earlier and says so", async () => {
    const { user, access } = await openAveryAccess();
    await user.click(within(access).getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(await within(access).findByText(`Invitation emailed to ${averyInvitation.email}.`)).toBeInTheDocument();
    expect(invitationEmailCalls).toEqual([averyInvitation.id]);
  });

  it("shows the failure line when the email does not go", async () => {
    setMockInvitationEmail({ kind: "fail", message: "Emails are not set up yet." });
    const { user, access } = await openAveryAccess();
    await user.click(within(access).getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(
      await within(access).findByText(
        "The invitation is ready but the email did not go out: Emails are not set up yet. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`http://localhost/?email=${encodeURIComponent(averyInvitation.email)}&company=rba`);
  });

  it("is paced: a second press within 10 minutes says so, and the invitation stands", async () => {
    const { user, row, access } = await openAveryAccess();
    await user.click(within(access).getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(await within(access).findByText(`Invitation emailed to ${averyInvitation.email}.`)).toBeInTheDocument();
    await user.click(within(access).getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(
      await within(access).findByText(
        "The invitation is ready but the email did not go out: An invitation email went to them in the last 10 minutes. Try again later. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    expect(await pendingFor(averyInvitation.email)).toHaveLength(1);
    expect(invitationEmailCalls).toEqual([averyInvitation.id, averyInvitation.id]);
  });

  it("is offered exactly where Copy link is, on every row's Access", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    await rowOf("Avery Cole");
    const names = screen.getAllByRole("button", { name: /^Access for / }).map((b) => b.getAttribute("aria-label")!.replace(/^Access for /, ""));
    expect(names.length).toBeGreaterThan(1);
    let offered = 0;
    for (const name of names) {
      const access = await openAccess(user, name);
      const copy = within(access).queryByRole("button", { name: /^Copy sign-in link for / });
      const again = within(access).queryByRole("button", { name: /^Email the invitation to .* again$/ });
      expect(Boolean(again)).toBe(Boolean(copy));
      if (again) offered += 1;
      await user.click(within(access).getByRole("button", { name: "Done" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    }
    expect(offered).toBeGreaterThan(0);
    const kaiAccess = await openAccess(user, "Kai Bennett");
    expect(within(kaiAccess).queryByRole("button", { name: "Email the invitation to Kai Bennett again" })).not.toBeInTheDocument();
  });
});
