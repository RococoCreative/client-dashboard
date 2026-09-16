import { describe, expect, it } from "vitest";
import { RATING_LABELS, groupByCategory, scoreCategory, scoreDeliverable } from "./deliverables.ts";
import type { DeliverableTask, EmployeeDeliverable } from "../../types/database.ts";

const task = (rating: number | null, deliverable_id = "d1"): Pick<DeliverableTask, "rating" | "deliverable_id"> => ({
  rating,
  deliverable_id,
});

describe("RATING_LABELS", () => {
  it("names the four steps the client uses", () => {
    expect(RATING_LABELS[0]).toBe("Miss");
    expect(RATING_LABELS[1]).toBe("Partial");
    expect(RATING_LABELS[2]).toBe("Hit");
    expect(RATING_LABELS[3]).toBe("Exceeded");
  });
});

describe("scoreDeliverable", () => {
  it("targets two points a task, which is a Hit on every one", () => {
    // The client's workbook reads a target of 8 against a heading with four tasks.
    expect(scoreDeliverable([task(2), task(2), task(2), task(2)])).toMatchObject({
      target: 8,
      actual: 8,
      percent: 100,
      hit: true,
    });
  });

  it("lets an Exceeded carry a Partial", () => {
    expect(scoreDeliverable([task(3), task(1)])).toMatchObject({ target: 4, actual: 4, percent: 100, hit: true });
  });

  it("counts an unrated task toward the target but not the score", () => {
    const score = scoreDeliverable([task(2), task(null)]);
    expect(score).toMatchObject({ target: 4, actual: 2, rated: 1, total: 2, percent: 50 });
    // Not hit: half of it has not been looked at, so it must not read as finished.
    expect(score.hit).toBe(false);
  });

  it("is not hit until every task is rated, even when the points are already there", () => {
    expect(scoreDeliverable([task(3), task(3), task(null)]).hit).toBe(false);
    expect(scoreDeliverable([task(3), task(3), task(0)]).hit).toBe(true);
  });

  it("has nothing to say about a heading with no tasks yet", () => {
    expect(scoreDeliverable([])).toMatchObject({ target: 0, actual: 0, percent: null, hit: false });
  });

  it("reads a miss as zero rather than as unrated", () => {
    expect(scoreDeliverable([task(0), task(0)])).toMatchObject({ actual: 0, rated: 2, percent: 0, hit: false });
  });
});

describe("scoreCategory", () => {
  it("adds up the headings in it", () => {
    const deliverables = [{ id: "d1" }, { id: "d2" }];
    const tasks = [task(2, "d1"), task(2, "d1"), task(3, "d2"), task(1, "d2"), task(0, "other")];
    // Four tasks across the two headings: target 8, actual 8. The stray task is not counted.
    expect(scoreCategory(deliverables, tasks)).toMatchObject({ target: 8, actual: 8, percent: 100 });
  });
});

describe("groupByCategory", () => {
  const categories = [
    { id: "c2", name: "Production", sort_order: 2 },
    { id: "c1", name: "BD & Sales", sort_order: 1 },
  ];
  const deliverable = (id: string, category_id: string | null): EmployeeDeliverable => ({
    id,
    company_id: "co",
    employee_id: "e1",
    category_id,
    year: 2026,
    name: id,
    sort_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  });

  it("orders categories the way the company set them", () => {
    const groups = groupByCategory([deliverable("a", "c2"), deliverable("b", "c1")], categories);
    expect(groups.map((g) => g.name)).toEqual(["BD & Sales", "Production"]);
  });

  it("drops a category with nothing filed under it", () => {
    const groups = groupByCategory([deliverable("a", "c1")], categories);
    expect(groups.map((g) => g.name)).toEqual(["BD & Sales"]);
  });

  it("keeps a heading whose category was deleted rather than losing it", () => {
    const groups = groupByCategory([deliverable("a", "c1"), deliverable("orphan", null), deliverable("gone", "deleted")], categories);
    expect(groups.map((g) => g.name)).toEqual(["BD & Sales", "Uncategorized"]);
    expect(groups[1].deliverables.map((d) => d.id)).toEqual(["orphan", "gone"]);
  });
});
