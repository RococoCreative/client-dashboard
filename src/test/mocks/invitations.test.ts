// Pins that the invitations mock tells the same story as the service: one invitation per address
// per company, a spent (accepted) one cleared to make way for a new one, one still waiting refused
// with words that point at it, and a delete that finds nothing read as a refusal.
import { describe, expect, it } from "vitest";
import { createInvitation, deleteInvitation, listInvitations } from "./invitations.ts";

const company = "co-invite-test";

describe("invitations mock", () => {
  it("refuses a second invitation while the first is still waiting", async () => {
    await createInvitation({ company_id: company, email: "waiting@example.com", role: "employee" });
    await expect(createInvitation({ company_id: company, email: " Waiting@Example.com ", role: "employee" })).rejects.toThrow(
      "There is already an invitation waiting for that address. Copy its link from the People page.",
    );
  });

  it("clears a spent invitation and files the new one in its place", async () => {
    const first = await createInvitation({ company_id: company, email: "back@example.com", role: "employee" });
    // Accepting is the database's own write when the person signs in; here it is set by hand.
    first.accepted_at = "2026-03-01T00:00:00Z";
    (await listInvitations(company)).find((i) => i.id === first.id)!.accepted_at = first.accepted_at;
    const again = await createInvitation({ company_id: company, email: "back@example.com", role: "admin" });
    const forAddress = (await listInvitations(company)).filter((i) => i.email === "back@example.com");
    expect(forAddress).toEqual([again]);
    expect(again.id).not.toBe(first.id);
    expect(again.accepted_at).toBeNull();
  });

  it("reads a delete that finds nothing as a refusal", async () => {
    await expect(deleteInvitation("no-such-invitation")).rejects.toThrow(/not yours to change/);
  });
});
