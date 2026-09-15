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
    .sort((a, b) => (b.cycle?.period_start ?? "").localeCompare(a.cycle?.period_start ?? ""));
}
