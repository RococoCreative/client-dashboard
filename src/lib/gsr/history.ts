// A person's reviews the way every screen that lists them reads them: newest period first,
// each paired with its cycle and its score.
//
// Three screens derived this separately, and one of them ordered by row creation time rather
// than by the period the review covers. Start a review out of order and the same person's
// dashboard, My GSR and person page disagreed about which review was the latest. The order a
// review belongs in is a property of its cycle, so it is decided once, here.
import { computeReviewScore, hasScoredItem, pillarsForReview, type PillarConfig, type ReviewScoreResult } from "./scoring.ts";
import type { Review, ReviewCycle, ReviewScore } from "../../types/database.ts";

export interface ReviewHistoryRow {
  review: Review;
  cycle: ReviewCycle | null;
  // The review's frozen score, or null: an open review has no score of record yet, because its
  // ratings live on the person until sign-off, and a review whose rows carry only notes has
  // nothing to score. Every list, ring and average reads this, so an open quarter reads "-"
  // rather than a number built from half its inputs.
  result: ReviewScoreResult | null;
}

// A review's score of record, or null when it has none: it is open, its rows carry nothing to
// score, or it belongs to a monthly cycle. A month is a Goal Setting Review whose number is the
// GSR score an admin locks in (reviews.gsr_score), never a pillar score. Locking a month in still
// flips it to complete, and the database freezes the person's ratings into it like any review
// (0017), so without the cadence check a month read as a review scored on its ratings alone,
// with its deliverables and GSR pillars at zero. Every screen that lists review scores reads them
// through here, so none of them can forget.
export function scoreOfRecord(
  review: Review,
  cycle: Pick<ReviewCycle, "cadence"> | null,
  pillars: PillarConfig[],
  own: ReviewScore[],
): ReviewScoreResult | null {
  if (review.status !== "complete" || cycle?.cadence === "monthly" || !hasScoredItem(own)) return null;
  return computeReviewScore(pillarsForReview(review, pillars), own);
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
      return { review, cycle, result: scoreOfRecord(review, cycle, pillars, own) };
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
// Review with no pillar scoring, so it never has a review score (scoreOfRecord), and it starts
// later than the quarter it sits inside. Reading the score off the newest row therefore shows a
// blank ring and hides a finished, rated review one line below it. Every screen that puts a
// number on a person reads that number from here instead.
export function latestScoredReview(rows: ReviewHistoryRow[]): ReviewHistoryRow | null {
  return rows.find((row) => row.result !== null) ?? null;
}

// The baseline a person's current impact score is compared against: the most recently signed
// off scored review, other than the one being looked at. Ordered by when it was completed, then
// by period, because a quarter and the month inside it can share a start date and previousCycle
// wants the same cadence, which is the wrong question here.
export function previousCompletedReview(rows: ReviewHistoryRow[], except?: { id: string }): ReviewHistoryRow | null {
  return (
    [...rows]
      .filter((r) => r.result !== null && r.review.id !== except?.id && r.cycle?.cadence !== "monthly")
      .sort(
        (a, b) =>
          (b.review.completed_at ?? "").localeCompare(a.review.completed_at ?? "") ||
          (b.cycle?.period_start ?? "").localeCompare(a.cycle?.period_start ?? ""),
      )[0] ?? null
  );
}
