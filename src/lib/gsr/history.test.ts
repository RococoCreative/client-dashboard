import { describe, expect, it } from "vitest";
import { latestScoredReview, reviewHistory } from "./history.ts";
import type { GsrPillar, Review, ReviewCycle, ReviewScore } from "../../types/database.ts";

const cycle = (id: string, start: string, end: string): ReviewCycle =>
  ({ id, name: id, cadence: "monthly", period_start: start, period_end: end, status: "open" }) as ReviewCycle;
const review = (id: string, cycleId: string): Review => ({ id, cycle_id: cycleId, status: "in_progress" }) as Review;

const pillars: GsrPillar[] = [
  { id: "p1", name: "Deliverables", weight: 100, scoring_type: "rating", sort_order: 1 } as GsrPillar,
];
const score = (reviewId: string): ReviewScore =>
  ({ id: `${reviewId}-s`, review_id: reviewId, pillar_id: "p1", criterion_id: "c1", rating: 4 }) as ReviewScore;

describe("review history", () => {
  // The quarter and the month inside it start on the same day four times a year, and until the
  // order was total it was row creation time that decided which review a person's screens
  // called their latest.
  const quarter = cycle("Q3 2026", "2026-07-01", "2026-09-30");
  const july = cycle("July 2026", "2026-07-01", "2026-07-31");
  const cycles = [quarter, july];
  const reviews = [review("r-quarter", "Q3 2026"), review("r-july", "July 2026")];

  it("puts the shorter period first when two cycles start the same day, whatever the row order", () => {
    const forward = reviewHistory(reviews, cycles, pillars, []).map((r) => r.review.id);
    const back = reviewHistory([...reviews].reverse(), cycles, pillars, []).map((r) => r.review.id);
    expect(forward).toEqual(["r-july", "r-quarter"]);
    expect(back).toEqual(forward);
  });

  it("finds the newest review that carries a score, not just the newest review", () => {
    // The July row is a Goal Setting Review: it leads the history and has nothing to score.
    const rows = reviewHistory(reviews, cycles, pillars, [score("r-quarter")]);
    expect(rows[0].review.id).toBe("r-july");
    expect(rows[0].result).toBeNull();
    expect(latestScoredReview(rows)?.review.id).toBe("r-quarter");
    expect(latestScoredReview(rows)?.result?.overall).not.toBeNull();
  });

  it("has no scored review to find when nothing has been scored", () => {
    expect(latestScoredReview(reviewHistory(reviews, cycles, pillars, []))).toBeNull();
    expect(latestScoredReview([])).toBeNull();
  });
});
