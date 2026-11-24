// Pins that the profiles mock deletes a person the way 0049 does: the delete policy (an admin of the
// company over the people they manage, or Rococo) and then guard_profile_delete, each refusal in the
// database's words, and a delete that cascades into the other mocks' stores.
import { describe, expect, it } from "vitest";
import { KINGDOM, KLASIK, RBA, makeHub } from "../fixtures.ts";
import { setActingPerson } from "../actingPerson.ts";
import { PERSON_NOT_DELETED, deletePerson, listCompanyProfiles, setMockRococoFlag } from "./profiles.ts";
import { listEmployeeKpis } from "./employees.ts";
import { listGoals } from "./gsr.ts";

const byName = (people: typeof RBA.profiles, name: string) => people.find((p) => p.full_name === name)!;

describe("profiles mock: deletePerson", () => {
  it("refuses yourself, someone ranked above you and a Rococo admin's profile", async () => {
    const avery = byName(KINGDOM.profiles, "Avery Stone");
    setActingPerson(avery);
    await expect(deletePerson(KINGDOM.company.id, avery.id)).rejects.toThrow("You cannot delete yourself.");
    await expect(deletePerson(KINGDOM.company.id, byName(KINGDOM.profiles, "Marcus Lee").id)).rejects.toThrow("You cannot delete someone ranked above you.");
    const placed = byName(KINGDOM.profiles, "Theo Brandt");
    setMockRococoFlag(placed.id, true);
    await expect(deletePerson(KINGDOM.company.id, placed.id)).rejects.toThrow("A Rococo admin is removed by Rococo.");
    setMockRococoFlag(placed.id, false);
  });

  it("refuses the company's only owner, even to Rococo", async () => {
    setActingPerson(makeHub("rococo", KINGDOM.company).profile);
    await expect(deletePerson(KINGDOM.company.id, byName(KINGDOM.profiles, "Marcus Lee").id)).rejects.toThrow(
      "This is the company's only owner. Make someone else an owner first.",
    );
  });

  it("deletes nobody for a manager or an admin of another company", async () => {
    const dana = byName(KINGDOM.profiles, "Dana Whitfield");
    setActingPerson(byName(KINGDOM.profiles, "Jules Carter"));
    await expect(deletePerson(KINGDOM.company.id, dana.id)).rejects.toThrow(PERSON_NOT_DELETED);
    setActingPerson(byName(KLASIK.profiles, "Jordan Vale"));
    await expect(deletePerson(KINGDOM.company.id, dana.id)).rejects.toThrow(PERSON_NOT_DELETED);
    expect((await listCompanyProfiles(KINGDOM.company.id)).some((p) => p.id === dana.id)).toBe(true);
  });

  it("deletes a signed-in person and what is theirs in the other mocks", async () => {
    const riley = byName(KLASIK.profiles, "Riley Park");
    setActingPerson(byName(KLASIK.profiles, "Jordan Vale"));
    // Named under another company, the way a stale page would, nothing goes.
    await expect(deletePerson(KINGDOM.company.id, riley.id)).rejects.toThrow(PERSON_NOT_DELETED);
    await deletePerson(KLASIK.company.id, riley.id);
    expect((await listCompanyProfiles(KLASIK.company.id)).some((p) => p.id === riley.id)).toBe(false);
    expect(await listGoals(KLASIK.company.id, riley.id)).toEqual([]);
    expect(await listEmployeeKpis(KLASIK.company.id, riley.id, 2026)).toEqual([]);
    await expect(deletePerson(KLASIK.company.id, riley.id)).rejects.toThrow(PERSON_NOT_DELETED);
  });
});
