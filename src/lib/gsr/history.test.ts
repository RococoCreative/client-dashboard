import { describe, expect, it } from "vitest";
import { latestScoredReview, previousCompletedReview, reviewHistory } from "./history.ts";
import type { GsrPillar, Review, ReviewCycle, ReviewScore } from "../../types/database.ts";

const cycle = (id: string, start: string, end: string, cadence = "monthly"): ReviewCycle =>
  ({ id, name: id, cadence, period_start: start, period_end: end, status: "open" }) as ReviewCycle;
const review = (id: string, cycleId: string, status = "in_progress", completedAt: string | null = null): Review =>
  ({ id, cycle_id: cycleId, status, completed_at: completedAt }) as Review;

const pillars: GsrPillar[] = [
  { id: "p1", name: "Deliverables", weight: 100, scoring_type: "rating", sort_order: 1 } as GsrPillar,
];
const score = (reviewId: string): ReviewScore =>
  ({ id: `${reviewId}-s`, review_id: reviewId, pillar_id: "p1", criterion_id: "c1", rating: 4 }) as ReviewScore;

describe("review history", () => {
  // The quarter and the month inside it start on the same day four times a year, and until the
  // order was total it was row creation time that decided which review a person's screens
  // called their latest.
  const quarter = cycle("Q3 2026", "2026-07-01", "2026-09-30", "quarterly");
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
    const signedOff = [review("r-quarter", "Q3 2026", "complete", "2026-09-30T17:00:00Z"), review("r-july", "July 2026")];
    const rows = reviewHistory(signedOff, cycles, pillars, [score("r-quarter")]);
    expect(rows[0].review.id).toBe("r-july");
    expect(rows[0].result).toBeNull();
    expect(latestScoredReview(rows)?.review.id).toBe("r-quarter");
    expect(latestScoredReview(rows)?.result?.overall).not.toBeNull();
  });

  it("gives an open review no score of record, whatever rows it carries", () => {
    // Ratings live on the person until sign-off, so an open review's rows are never the whole
    // picture: a number built from them would read low and be featured over a finished one.
    const rows = reviewHistory(reviews, cycles, pillars, [score("r-quarter")]);
    expect(rows.every((r) => r.result === null)).toBe(true);
    expect(latestScoredReview(rows)).toBeNull();
  });

  it("does not count a completed review whose rows carry only notes", () => {
    const notesOnly = { id: "r-quarter-n", review_id: "r-quarter", pillar_id: "p1", criterion_id: "c1", rating: null, notes: "Talked it through." } as unknown as ReviewScore;
    const rows = reviewHistory([review("r-quarter", "Q3 2026", "complete", "2026-09-30T17:00:00Z")], cycles, pillars, [notesOnly]);
    expect(rows[0].result).toBeNull();
  });

  it("picks the last signed-off scored review as the baseline, never the one being looked at", () => {
    const q2 = cycle("Q2 2026", "2026-04-01", "2026-06-30", "quarterly");
    const all = [quarter, july, q2];
    const list = [
      review("r-quarter", "Q3 2026", "complete", "2026-09-30T17:00:00Z"),
      review("r-q2", "Q2 2026", "complete", "2026-06-30T17:00:00Z"),
      review("r-july", "July 2026", "complete", "2026-07-31T17:00:00Z"),
    ];
    const rows = reviewHistory(list, all, pillars, [score("r-quarter"), score("r-q2"), score("r-july")]);
    // Looking at Q3, the baseline is Q2: the July GSR is newer but a month is not a review.
    expect(previousCompletedReview(rows, { id: "r-quarter" })?.review.id).toBe("r-q2");
    // Looking at the profile, the newest signed-off review is the baseline.
    expect(previousCompletedReview(rows)?.review.id).toBe("r-quarter");
    expect(previousCompletedReview([])).toBeNull();
  });

  it("has no scored review to find when nothing has been scored", () => {
    expect(latestScoredReview(reviewHistory(reviews, cycles, pillars, []))).toBeNull();
    expect(latestScoredReview([])).toBeNull();
  });
});
