// A person's reviews the way every screen that lists them reads them: newest period first,
// each paired with its cycle and its score.
//
// Three screens derived this separately, and one of them ordered by row creation time rather
// than by the period the review covers. Start a review out of order and the same person's
// dashboard, My GSR and person page disagreed about which review was the latest. The order a
// review belongs in is a property of its cycle, so it is decided once, here.
import { computeReviewScore, type PillarConfig, type ReviewScoreResult } from "./scoring.ts";
import type { Review, ReviewCycle, ReviewScore } from "../../types/database.ts";

export interface ReviewHistoryRow {
  review: Review;
  cycle: ReviewCycle | null;
  // null until something in the review has been scored.
  result: ReviewScoreResult | null;
}

export function reviewHistory(
  reviews: Review[],
  cycles: ReviewCycle[],
  pillars: PillarConfig[],
  scores: ReviewScore[],
): ReviewHistoryRow[] {
  return reviews
    .map((review) => {
      const cycle = cycles.find((c) => c.id === review.cycle_id) ?? null;
      const own = scores.filter((s) => s.review_id === review.id);
      return { review, cycle, result: own.length > 0 ? computeReviewScore(pillars, own) : null };
    })
    .sort(
      (a, b) =>
        // Newest period first, then the shorter period of two that start together, so a
        // September review inside Q3 leads the quarter it sits in. Without the later keys the
        // comparator returns 0 for that pair and row creation order decides, which is the very
        // thing this module exists to stop.
        (b.cycle?.period_start ?? "").localeCompare(a.cycle?.period_start ?? "") ||
        (a.cycle?.period_end ?? "").localeCompare(b.cycle?.period_end ?? "") ||
        (a.cycle?.id ?? "").localeCompare(b.cycle?.id ?? ""),
    );
}

// The newest review that actually carries a score.
//
// "Latest review" and "latest score" are not the same row. A monthly cycle is a Goal Setting
// Review with no scoring at all, so it never has a score, and it starts later than the quarter
// it sits inside. Reading the score off the newest row therefore shows a blank ring and hides a
// finished, rated review one line below it. Every screen that puts a number on a person reads
// that number from here instead.
//
// Keyed on whether a row has a result, not on cadence: a company that scores its monthly cycles
// is then served by the same rule.
export function latestScoredReview(rows: ReviewHistoryRow[]): ReviewHistoryRow | null {
  return rows.find((row) => row.result !== null) ?? null;
}
