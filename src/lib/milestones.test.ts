// Pins the milestone rules the Production pages lean on: complete means a completed-on date, the
// order a project's items are read in, the next sort order, the done-of-total count, the next
// target date, and the id order a move up or down produces.
import { describe, expect, it } from "vitest";
import type { ProjectMilestone } from "../types/database.ts";
import { isComplete, milestoneCounts, moveMilestone, nextSortOrder, nextTargetDate, sortMilestones } from "./milestones.ts";

let seq = 0;
function ms(overrides: Partial<ProjectMilestone> = {}): ProjectMilestone {
  seq += 1;
  return {
    id: `m-${seq}`,
    company_id: "co",
    project_id: "p",
    title: `Item ${seq}`,
    description: null,
    kind: "milestone",
    sort_order: seq,
    target_date: null,
    responsible_profile_id: null,
    completed_on: null,
    archived_at: null,
    created_by: null,
    updated_by: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("isComplete", () => {
  it("is true only with a completed-on date", () => {
    expect(isComplete({ completed_on: null })).toBe(false);
    expect(isComplete({ completed_on: "2026-09-01" })).toBe(true);
  });
});

describe("sortMilestones", () => {
  it("orders by sort_order", () => {
    const rows = [ms({ sort_order: 3 }), ms({ sort_order: 1 }), ms({ sort_order: 2 })];
    expect(sortMilestones(rows).map((m) => m.sort_order)).toEqual([1, 2, 3]);
  });

  it("falls back to created_at on equal sort_order", () => {
    const late = ms({ id: "late", sort_order: 1, created_at: "2026-02-01T00:00:00Z" });
    const early = ms({ id: "early", sort_order: 1, created_at: "2026-01-01T00:00:00Z" });
    expect(sortMilestones([late, early]).map((m) => m.id)).toEqual(["early", "late"]);
  });

  it("does not mutate its input", () => {
    const rows = [ms({ id: "b", sort_order: 2 }), ms({ id: "a", sort_order: 1 })];
    sortMilestones(rows);
    expect(rows.map((m) => m.id)).toEqual(["b", "a"]);
  });
});

describe("nextSortOrder", () => {
  it("is 1 for an empty list", () => {
    expect(nextSortOrder([])).toBe(1);
  });

  it("is one past the highest", () => {
    expect(nextSortOrder([{ sort_order: 1 }, { sort_order: 3 }, { sort_order: 2 }])).toBe(4);
    expect(nextSortOrder([{ sort_order: 0 }])).toBe(1);
  });
});

describe("milestoneCounts", () => {
  it("counts done and total over non-archived rows, letters included", () => {
    const rows = [
      ms({ completed_on: "2026-07-30" }),
      ms({ kind: "letter", completed_on: "2026-08-04" }),
      ms(),
      ms({ completed_on: "2026-08-10", archived_at: "2026-08-11T00:00:00Z" }),
    ];
    expect(milestoneCounts(rows)).toEqual({ done: 2, total: 3 });
  });
});

describe("nextTargetDate", () => {
  it("is the earliest target of open, non-archived rows", () => {
    const rows = [
      ms({ target_date: "2026-11-20" }),
      ms({ target_date: "2026-10-02" }),
      ms({ target_date: "2026-08-01", completed_on: "2026-07-30" }),
      ms({ target_date: "2026-09-01", archived_at: "2026-08-11T00:00:00Z" }),
      ms(),
    ];
    expect(nextTargetDate(rows)).toBe("2026-10-02");
  });

  it("is null when everything is complete", () => {
    const rows = [ms({ target_date: "2026-08-01", completed_on: "2026-07-30" }), ms({ completed_on: "2026-08-02" })];
    expect(nextTargetDate(rows)).toBeNull();
  });
});

describe("moveMilestone", () => {
  const a = ms({ id: "a", sort_order: 1 });
  const b = ms({ id: "b", sort_order: 2 });
  const c = ms({ id: "c", sort_order: 3 });

  it("swaps with the neighbour", () => {
    expect(moveMilestone([a, b, c], "c", "up")).toEqual(["a", "c", "b"]);
    expect(moveMilestone([a, b, c], "a", "down")).toEqual(["b", "a", "c"]);
  });

  it("leaves the order alone at the ends", () => {
    expect(moveMilestone([a, b, c], "a", "up")).toEqual(["a", "b", "c"]);
    expect(moveMilestone([a, b, c], "c", "down")).toEqual(["a", "b", "c"]);
  });

  it("leaves the order alone for an unknown id", () => {
    expect(moveMilestone([a, b, c], "zzz", "up")).toEqual(["a", "b", "c"]);
  });

  it("sorts unsorted input first", () => {
    expect(moveMilestone([c, a, b], "b", "up")).toEqual(["b", "a", "c"]);
  });
});
