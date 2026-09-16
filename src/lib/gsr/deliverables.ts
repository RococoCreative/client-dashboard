// How a deliverable is scored, pure and tested. A deliverable is a heading with support tasks
// under it; the person is rated on the heading by how well they do the tasks, so the rating sits
// on the task and the heading's figure is worked out from them.
//
//   Miss 0, Partial 1, Hit 2, Exceeded 3
//   target = two points for every task on the deliverable
//   actual = the sum of the ratings given
//
// Hitting every task lands exactly on target; exceeding one puts the person over. That is the
// arithmetic the client's workbook uses, where a heading with four tasks reads a target of 8.
//
// Unrated tasks count nothing toward actual but still count toward target, so a half-reviewed
// deliverable reads low rather than flattering. That matches the unscored-is-zero rule the
// review engine follows in scoring.ts.
import type { DeliverableTask, EmployeeDeliverable } from "../../types/database.ts";

export const DELIVERABLE_RATINGS = [0, 1, 2, 3] as const;
export type DeliverableRating = (typeof DELIVERABLE_RATINGS)[number];

export const RATING_LABELS: Record<DeliverableRating, string> = {
  0: "Miss",
  1: "Partial",
  2: "Hit",
  3: "Exceeded",
};

// Hit is the bar, and the bar is what a target is made of.
export const POINTS_PER_TASK = 2;

// Offered to a company that has not named its own categories yet, as one-click starters. They are
// suggestions, not a fixed list: categories are company data, a company can name them anything,
// and nothing in the code depends on these five existing.
export const SUGGESTED_CATEGORIES = ["Sales", "Production", "Operations", "Financial", "Leadership"] as const;

export function isDeliverableRating(value: unknown): value is DeliverableRating {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

export interface DeliverableScore {
  target: number;
  actual: number;
  // How many of the tasks have been rated at all, and how many there are.
  rated: number;
  total: number;
  // actual as a share of target, or null when there is nothing to score yet. This goes above 100
  // when tasks are rated Exceeded, which is the point of the scale, so a caller that wants a bar
  // clamps it deliberately rather than assuming it arrives clamped.
  percent: number | null;
  // On or over target with every task rated.
  hit: boolean;
}

export function scoreDeliverable(tasks: Array<Pick<DeliverableTask, "rating">>): DeliverableScore {
  const total = tasks.length;
  const target = total * POINTS_PER_TASK;
  const rated = tasks.filter((t) => t.rating !== null).length;
  const actual = tasks.reduce((sum, t) => sum + (t.rating ?? 0), 0);
  return {
    target,
    actual,
    rated,
    total,
    percent: target === 0 ? null : Math.round((actual / target) * 100),
    hit: total > 0 && rated === total && actual >= target,
  };
}

// Every deliverable in one category, added up the same way: the category's target is the sum of
// its headings' targets, so a category is just a bigger deliverable.
export function scoreCategory(
  deliverables: Array<Pick<EmployeeDeliverable, "id">>,
  tasks: Array<Pick<DeliverableTask, "deliverable_id" | "rating">>,
): DeliverableScore {
  const own = deliverables.flatMap((d) => tasks.filter((t) => t.deliverable_id === d.id));
  return scoreDeliverable(own);
}

// Deliverables grouped the way both screens read them: categories in their configured order,
// then anything whose category was deleted, under a heading of its own so it is never lost.
export interface DeliverableGroup {
  categoryId: string | null;
  name: string;
  deliverables: EmployeeDeliverable[];
}

export function groupByCategory(
  deliverables: EmployeeDeliverable[],
  categories: Array<{ id: string; name: string; sort_order: number }>,
): DeliverableGroup[] {
  const byOrder = [...categories].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const groups: DeliverableGroup[] = byOrder.map((c) => ({
    categoryId: c.id,
    name: c.name,
    deliverables: deliverables.filter((d) => d.category_id === c.id),
  }));
  const orphans = deliverables.filter((d) => d.category_id === null || !categories.some((c) => c.id === d.category_id));
  if (orphans.length > 0) groups.push({ categoryId: null, name: "Uncategorized", deliverables: orphans });
  return groups.filter((g) => g.deliverables.length > 0);
}
