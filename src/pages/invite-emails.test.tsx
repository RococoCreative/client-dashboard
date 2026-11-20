// Send invite now emails the invitation through the notify function, and a waiting invitation can
// be emailed again. These pin the four outcomes an admin can meet on the roster: the email went,
// the email failed (the invitation still stands and its link is copied), the function declined with
// a reason, and Email again on an invitation made earlier. They also pin that Email again sits
// exactly where Copy link does. The email itself is the mock's: nothing here touches the network.
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/supabase.ts", () => import("../test/mocks/supabase.ts"));
vi.mock("../services/auth.ts", () => import("../test/mocks/auth.ts"));
vi.mock("../services/profiles.ts", () => import("../test/mocks/profiles.ts"));
vi.mock("../services/companies.ts", () => import("../test/mocks/companies.ts"));
vi.mock("../services/invitations.ts", () => import("../test/mocks/invitations.ts"));
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

const rowOf = async (name: string) => (await screen.findByText(name, { selector: "span" })).closest("tr") as HTMLElement;
const pendingFor = async (email: string) => (await listInvitations(RBA.company.id)).filter((i) => i.email === email && !i.accepted_at);

// The invitations mock keeps its rows for the whole file, so the one a test creates for Kai is
// cleared again and the next test starts with Kai not invited.
afterEach(async () => {
  for (const invitation of await pendingFor(kai.email)) await deleteInvitation(invitation.id);
});

async function sendKaiInvite() {
  const user = userEvent.setup();
  renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
  const row = await rowOf("Kai Bennett");
  await user.click(within(row).getByRole("button", { name: "Send the invitation to Kai Bennett" }));
  return row;
}

describe("Send invite", () => {
  it("creates the invitation, emails it, and says so", async () => {
    const row = await sendKaiInvite();
    expect(await screen.findByText(`Invitation emailed to ${kai.email}.`)).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    const [created] = await pendingFor(kai.email);
    expect(created).toBeDefined();
    expect(invitationEmailCalls).toEqual([created.id]);
  });

  it("keeps the invitation and copies its link when the email fails", async () => {
    setMockInvitationEmail({ kind: "fail", message: "The email service did not accept the message." });
    const row = await sendKaiInvite();
    expect(
      await screen.findByText(
        "The invitation is ready but the email did not go out: The email service did not accept the message. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    expect(await pendingFor(kai.email)).toHaveLength(1);
    expect(await navigator.clipboard.readText()).toBe(kaiLink);
    expect(within(row).getByRole("button", { name: "Copy sign-in link for Kai Bennett" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Email the invitation to Kai Bennett again" })).toBeInTheDocument();
  });

  it("shows the reason the email service gave for not sending", async () => {
    setMockInvitationEmail({ kind: "reason", reason: "They have already signed in." });
    const row = await sendKaiInvite();
    expect(
      await screen.findByText(
        "The invitation is ready but the email did not go out: They have already signed in. Its link is copied, so you can send it yourself.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("Invited")).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(kaiLink);
  });
});

describe("Email again", () => {
  it("emails a waiting invitation made earlier and says so", async () => {
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    const row = await rowOf("Avery Cole");
    await user.click(within(row).getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(await screen.findByText(`Invitation emailed to ${averyInvitation.email}.`)).toBeInTheDocument();
    expect(invitationEmailCalls).toEqual([averyInvitation.id]);
  });

  it("shows the failure line when the email does not go", async () => {
    setMockInvitationEmail({ kind: "fail", message: "Emails are not set up yet." });
    const user = userEvent.setup();
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    const row = await rowOf("Avery Cole");
    await user.click(within(row).getByRole("button", { name: "Email the invitation to Avery Cole again" }));
    expect(
      await screen.findByText("The invitation is ready but the email did not go out: Emails are not set up yet. Its link is copied, so you can send it yourself."),
    ).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(`http://localhost/?email=${encodeURIComponent(averyInvitation.email)}&company=rba`);
  });

  it("is offered on exactly the rows that offer Copy link", async () => {
    renderWithHub(<PeoplePage />, rbaAdmin, { path: "/people", pattern: "/people" });
    await rowOf("Avery Cole");
    const rows = screen.getAllByRole("row").slice(1);
    let offered = 0;
    for (const row of rows) {
      const copy = within(row).queryByRole("button", { name: /^Copy sign-in link for / });
      const again = within(row).queryByRole("button", { name: /^Email the invitation to .* again$/ });
      expect(Boolean(again)).toBe(Boolean(copy));
      if (again) offered += 1;
    }
    expect(offered).toBeGreaterThan(0);
    const kaiRow = await rowOf("Kai Bennett");
    expect(within(kaiRow).queryByRole("button", { name: "Email the invitation to Kai Bennett again" })).not.toBeInTheDocument();
  });
});
