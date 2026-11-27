// AccountControls, the Account block's body without its Section: it hands a finished delete to
// onGone instead of leaving the page, and it uses a pending invitation it is given rather than
// reading the invitation list itself (the People roster already knows it).
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../services/supabase.ts", () => import("../../../test/mocks/supabase.ts"));
vi.mock("../../../services/auth.ts", () => import("../../../test/mocks/auth.ts"));
vi.mock("../../../services/profiles.ts", () => import("../../../test/mocks/profiles.ts"));
vi.mock("../../../services/companies.ts", () => import("../../../test/mocks/companies.ts"));
vi.mock("../../../services/invitations.ts", () => import("../../../test/mocks/invitations.ts"));
vi.mock("../../../services/gsr.ts", () => import("../../../test/mocks/gsr.ts"));
vi.mock("../../../services/gsrOnDemand.ts", () => import("../../../test/mocks/gsrOnDemand.ts"));
vi.mock("../../../services/capabilities.ts", () => import("../../../test/mocks/capabilities.ts"));
vi.mock("../../../services/directory.ts", () => import("../../../test/mocks/directory.ts"));

import { RBA, makeHub } from "../../../test/fixtures.ts";
import { renderWithHub } from "../../../test/renderWithHub.tsx";
import * as invitationsService from "../../../services/invitations.ts";
import type { Invitation } from "../../../types/database.ts";
import { AccountControls } from "./PersonAccountActions.tsx";

const admin = makeHub("admin", RBA.company);
const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const jamie = byName("Jamie Fox");
const kai = byName("Kai Bennett");
const onPatch = async () => true;

describe("AccountControls", () => {
  it("calls onGone instead of leaving the page after a delete", async () => {
    const onGone = vi.fn();
    const user = userEvent.setup();
    renderWithHub(<AccountControls companyId={RBA.company.id} person={jamie} onPatch={onPatch} onGone={onGone} />, admin);
    await user.click(await screen.findByRole("button", { name: "Delete person" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Type Jamie Fox to confirm"), "Jamie Fox");
    await user.click(within(dialog).getByRole("button", { name: "Delete Jamie for good" }));
    await vi.waitFor(() => expect(onGone).toHaveBeenCalledWith({ kind: "deleted", name: "Jamie Fox" }));
    expect(screen.queryByText("elsewhere")).not.toBeInTheDocument();
  });

  it("uses the invitation it is given and reads none", async () => {
    const spy = vi.spyOn(invitationsService, "listInvitations");
    const invitation: Invitation = {
      id: "invite-test",
      company_id: RBA.company.id,
      email: kai.email,
      role: kai.role,
      title: null,
      profile_id: kai.id,
      invited_by: null,
      created_at: "2026-01-01T00:00:00Z",
      accepted_at: null,
      last_emailed_at: null,
    };
    renderWithHub(<AccountControls companyId={RBA.company.id} person={kai} onPatch={onPatch} pendingInvitation={invitation} />, admin);
    expect(await screen.findByText(/Cancel their invitation above first, then remove them\./)).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("offers Remove when it is given no pending invitation", async () => {
    renderWithHub(<AccountControls companyId={RBA.company.id} person={kai} onPatch={onPatch} pendingInvitation={null} />, admin);
    expect(await screen.findByRole("button", { name: `Remove ${kai.full_name}` })).toBeInTheDocument();
  });
});
