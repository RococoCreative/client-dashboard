// Pins what the GSRs log and Home's GSR cards share: who a viewer sees, the headline over them,
// each person's row, who is most overdue, and the day a person's last GSR began.
import { describe, expect, it } from "vitest";
import { RBA } from "../../test/fixtures.ts";
import type { Gsr, Profile } from "../../types/database.ts";
import { gsrHeadline, gsrPeopleFor, gsrStanding, lastStartedOn, mostOverdue, type GsrStandingRow } from "./gsrStanding.ts";

const byName = (name: string) => RBA.profiles.find((p) => p.full_name === name)!;
const alex = byName("Alex Morgan");
const harper = byName("Harper Quinn");
const jamie = byName("Jamie Fox");
const noor = byName("Noor Haddad");
const rowan = byName("Rowan Ellis");
const kai = byName("Kai Bennett");
const range = { from: "2026-09-14", to: "2026-09-20" };
const today = "2026-09-15";

function gsr(employeeId: string, startedOn: string, extra: Partial<Gsr> = {}): Gsr {
  return {
    id: `${employeeId}-${startedOn}`,
    employee_id: employeeId,
    company_id: RBA.company.id,
    cycle_id: null,
    status: "in_progress",
    started_on: startedOn,
    done_on: null,
    gsr_score: null,
    created_at: `${startedOn}T12:00:00.000Z`,
    ...extra,
  } as Gsr;
}
const done = (employeeId: string, day: string, score: number | null) => gsr(employeeId, day, { status: "complete", done_on: day, gsr_score: score });
const row = (person: Profile, due: GsrStandingRow["due"], dueOn: string | null): GsrStandingRow => ({ person, last: null, done: 0, average: null, open: null, due, dueOn, canStart: true });

describe("who a viewer sees GSRs for", () => {
  it("is every active person for an admin, by name", () => {
    const gone = { ...noor, is_active: false };
    const people = [rowan, gone, alex, jamie];
    expect(gsrPeopleFor(alex, true, people).map((p) => p.full_name)).toEqual(["Alex Morgan", "Jamie Fox", "Rowan Ellis"]);
  });

  it("is the active people they lead for anyone else, by name, however deep", () => {
    const people = RBA.profiles.filter((p) => p.company_id === RBA.company.id);
    expect(gsrPeopleFor(harper, false, people).map((p) => p.full_name)).toEqual(["Kai Bennett", "Rowan Ellis"]);
    expect(gsrPeopleFor(harper, false, people.map((p) => (p.id === kai.id ? { ...p, is_active: false } : p))).map((p) => p.full_name)).toEqual(["Rowan Ellis"]);
    // An employee leads nobody.
    expect(gsrPeopleFor(jamie, false, people)).toEqual([]);
  });
});

describe("where each person stands", () => {
  it("adds up the window over the people given and gives each a row in their order", () => {
    const gsrs = [done(jamie.id, "2026-09-14", 80), done(noor.id, "2026-09-15", 90), gsr(rowan.id, "2026-09-12"), done(alex.id, "2026-09-15", 10)];
    const lastDates = [
      { employee_id: jamie.id, last_started_on: "2026-09-14" },
      { employee_id: rowan.id, last_started_on: "2026-09-12" },
    ];
    const people = [{ ...rowan, gsr_cadence: "daily" as const }, jamie, noor];
    const { figures, rows } = gsrStanding(people, gsrs, lastDates, range, today);
    // Alex is not among the people, so their GSR counts nowhere.
    expect(figures).toEqual({ done: 2, average: 85, inProgress: 1 });
    expect(rows.map((r) => r.person.id)).toEqual([rowan.id, jamie.id, noor.id]);
    expect(rows[0]).toMatchObject({ last: "2026-09-12", done: 0, average: null, due: "overdue", dueOn: "2026-09-14", canStart: true });
    expect(rows[0].open?.id).toBe(`${rowan.id}-2026-09-12`);
    expect(rows[1]).toMatchObject({ last: "2026-09-14", done: 1, average: 80, open: null, due: "ok" });
    // No last start on record: due today on a monthly rhythm.
    expect(rows[2]).toMatchObject({ last: null, done: 1, average: 90, due: "due", dueOn: today });
  });

  it("never offers a Rococo admin a GSR of their own", () => {
    const { rows } = gsrStanding([{ ...alex, is_rococo_admin: true }], [], [], range, today);
    expect(rows[0].canStart).toBe(false);
  });
});

describe("the headline", () => {
  it("reads done, average and in progress", () => {
    expect(gsrHeadline({ done: 2, average: 85, inProgress: 1 })).toBe("2 GSRs done · Average 85 · 1 in progress");
    expect(gsrHeadline({ done: 1, average: null, inProgress: 0 })).toBe("1 GSR done · Average - · 0 in progress");
  });
});

describe("who is most overdue", () => {
  it("keeps the overdue only, earliest due day first, and a tie by name", () => {
    const rows = [row(rowan, "overdue", "2026-09-10"), row(jamie, "due", "2026-09-15"), row(noor, "overdue", "2026-09-01"), row(alex, "overdue", "2026-09-10"), row(kai, "none", null)];
    expect(mostOverdue(rows).map((r) => r.person.full_name)).toEqual(["Noor Haddad", "Alex Morgan", "Rowan Ellis"]);
    expect(mostOverdue([row(jamie, "ok", "2026-10-01")])).toEqual([]);
  });
});

describe("the day a person's last GSR began", () => {
  it("is the latest start, whatever the order, and null with none", () => {
    expect(lastStartedOn([{ started_on: "2026-09-01" }, { started_on: "2026-09-12" }, { started_on: "2026-08-30" }])).toBe("2026-09-12");
    expect(lastStartedOn([])).toBeNull();
  });
});
